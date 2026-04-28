import type { Env } from "./env";
import type { Dose, Household, Medication } from "./lib/db";
import {
  getActiveMedication,
  listAllHouseholds,
  listHouseholdSubscriptions,
  listHouseholdUsers,
  listPendingDoses,
  upsertDose,
} from "./lib/db";
import { reminderEmail, sendEmail } from "./lib/email";
import { addDays, formatLocalHHMM, localDateTimeToUnixMs, localNow } from "./lib/time";
import { sendPush } from "./lib/webpush";

// Alert window per dose: from scheduled_at to scheduled_at + 3h. Inside the window we ping
// every 15 min until taken; after the window the dose is considered missed.
const ALERT_WINDOW_MS = 3 * 60 * 60 * 1000;
const PUSH_DEBOUNCE_MS = 14 * 60 * 1000; // a hair under 15 min so the cron tick doesn't skip
const EMAIL_AFTER_MS = 60 * 60 * 1000; // 1 hour after first alert
const ESCALATE_AFTER_MS = 30 * 60 * 1000;

// How far around `now` we materialize doses on each tick. Covers DST, worker downtime,
// and midnight rollover.
const MATERIALIZE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runCron(env: Env, now: Date = new Date()): Promise<void> {
  const households = await listAllHouseholds(env);
  await Promise.all(households.map((h) => processHousehold(env, h, now)));
}

async function processHousehold(env: Env, household: Household, now: Date): Promise<void> {
  const med = await getActiveMedication(env, household.id);
  if (!med) return;

  await materializeDoses(env, household, med, now);

  const pending = await listPendingDoses(env, med.id);
  await Promise.all(pending.map((d) => processDose(env, household, med, d, now)));
}

// --- Materialization ---------------------------------------------------------

type ScheduledDose = { scheduled_at: number; scheduled_label: string };

export function computeExpectedDoses(
  med: Medication,
  now: Date,
  tz: string,
  windowMs: number = MATERIALIZE_WINDOW_MS,
): ScheduledDose[] {
  const fromMs = now.getTime() - windowMs;
  const toMs = now.getTime() + windowMs;

  const all =
    med.schedule_type === "slots"
      ? expandSlotDoses(med, now, tz)
      : expandHourDoses(med, fromMs, toMs, tz);

  return all.filter((d) => d.scheduled_at >= fromMs && d.scheduled_at <= toMs);
}

function expandSlotDoses(med: Medication, now: Date, tz: string): ScheduledDose[] {
  const today = localNow(now, tz).date;
  const dates = [addDays(today, -1), today, addDays(today, 1)];

  const pattern = med.schedule_pattern.split("-");
  const slots: { active: boolean; label: string; time: string }[] = [
    { active: pattern[0] === "1", label: "morning", time: med.morning_at },
    { active: pattern[1] === "1", label: "noon", time: med.noon_at },
    { active: pattern[2] === "1", label: "evening", time: med.evening_at },
  ];

  const out: ScheduledDose[] = [];
  for (const date of dates) {
    for (const slot of slots) {
      if (!slot.active) continue;
      out.push({
        scheduled_at: localDateTimeToUnixMs(date, slot.time, tz),
        scheduled_label: slot.label,
      });
    }
  }
  return out;
}

function expandHourDoses(
  med: Medication,
  fromMs: number,
  toMs: number,
  tz: string,
): ScheduledDose[] {
  if (!med.hours_anchor) return [];
  const interval = Number(med.schedule_pattern);
  if (!Number.isFinite(interval) || interval <= 0) return [];

  const intervalMs = interval * 60 * 60 * 1000;
  const anchor = med.hours_anchor;
  const upper = Math.min(toMs, med.hours_until ?? toMs);

  const out: ScheduledDose[] = [];
  // Start from the first dose at-or-after fromMs.
  const offset = Math.max(0, fromMs - anchor);
  const firstStep = Math.floor(offset / intervalMs);
  for (let i = firstStep; ; i++) {
    const t = anchor + i * intervalMs;
    if (t > upper) break;
    if (t < fromMs) continue;
    out.push({
      scheduled_at: t,
      scheduled_label: formatLocalHHMM(t, tz),
    });
  }
  return out;
}

async function materializeDoses(
  env: Env,
  household: Household,
  med: Medication,
  now: Date,
): Promise<void> {
  const expected = computeExpectedDoses(med, now, household.tz);
  for (const e of expected) {
    await upsertDose(env, {
      medicationId: med.id,
      householdId: household.id,
      scheduledAt: e.scheduled_at,
      scheduledLabel: e.scheduled_label,
    });
  }
}

// --- Per-dose alert decision -------------------------------------------------

async function processDose(
  env: Env,
  household: Household,
  med: Medication,
  dose: Dose,
  now: Date,
): Promise<void> {
  const nowMs = now.getTime();

  if (nowMs < dose.scheduled_at) return; // not yet
  if (nowMs > dose.scheduled_at + ALERT_WINDOW_MS) return; // missed window
  if (dose.taken_at !== null) return; // already taken (defensive — query filters this too)

  await maybePush(env, household, med, dose, nowMs);
  await maybeEmail(env, household, med, dose, nowMs);
}

async function maybePush(
  env: Env,
  household: Household,
  med: Medication,
  dose: Dose,
  nowMs: number,
): Promise<void> {
  if (dose.last_alert_at && nowMs - dose.last_alert_at < PUSH_DEBOUNCE_MS) return;

  const subs = await listHouseholdSubscriptions(env, household.id);
  if (subs.length === 0) {
    // No subscribers — still record first_alert_at so the email-fallback timer starts.
    if (dose.first_alert_at === null) {
      await env.DB.prepare(
        `UPDATE doses SET first_alert_at = ?, last_alert_at = ? WHERE id = ?`,
      )
        .bind(nowMs, nowMs, dose.id)
        .run();
    }
    return;
  }

  const elapsed = dose.first_alert_at ? nowMs - dose.first_alert_at : 0;
  const escalated = elapsed >= ESCALATE_AFTER_MS;

  const slotName = humanSlotName(dose.scheduled_label);
  const payload = {
    title: escalated
      ? `⚠️ ${med.name}: wciąż nie podane`
      : `💊 ${med.name} — pora podać`,
    body: escalated
      ? `Slot ${slotName}: minęło już pół godziny. Stuknij gdy podasz.`
      : `${med.dose || "Dawka"} (${slotName}). Stuknij gdy podasz.`,
    tag: `dose-${dose.id}`,
    url: env.APP_URL,
  };

  await Promise.all(subs.map((sub) => sendPush(env, sub, payload)));

  await env.DB.prepare(
    `UPDATE doses
     SET first_alert_at = COALESCE(first_alert_at, ?),
         last_alert_at = ?
     WHERE id = ?`,
  )
    .bind(nowMs, nowMs, dose.id)
    .run();
}

async function maybeEmail(
  env: Env,
  household: Household,
  med: Medication,
  dose: Dose,
  nowMs: number,
): Promise<void> {
  if (dose.email_sent_at !== null) return;
  if (dose.first_alert_at === null) return;
  if (nowMs - dose.first_alert_at < EMAIL_AFTER_MS) return;

  const users = await listHouseholdUsers(env, household.id);
  const slotName = humanSlotName(dose.scheduled_label);

  await Promise.all(
    users.map((u) => {
      const tpl = reminderEmail(u.lang, med.name, slotName);
      return sendEmail(env, {
        to: u.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      }).catch((err) => console.error("reminder email failed", { user: u.email, err }));
    }),
  );

  await env.DB.prepare("UPDATE doses SET email_sent_at = ? WHERE id = ?")
    .bind(nowMs, dose.id)
    .run();
}

function humanSlotName(label: string): string {
  if (label === "morning") return "rano";
  if (label === "noon") return "południe";
  if (label === "evening") return "wieczór";
  return label; // already HH:MM for hours-based meds
}
