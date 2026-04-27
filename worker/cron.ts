import type { Env } from "./env";
import type { Dose, Household } from "./lib/db";
import {
  listAllHouseholds,
  listHouseholdSubscriptions,
  listHouseholdUsers,
  upsertTodayDose,
} from "./lib/db";
import { sendEmail, reminderEmail } from "./lib/email";
import { isWithinWindow, localNow } from "./lib/time";
import { sendPush } from "./lib/webpush";

// Push cadence (minutes since first push):
//  0  → first push (gentle)
//  15 → second push if still pending
//  30 → escalated push
//  45 → escalated push
//  60 → email fallback (one-shot)
const MIN_PUSH_INTERVAL_MS = 14 * 60 * 1000; // 14 min — guard against duplicate pushes within same cron tick
const EMAIL_AFTER_MS = 60 * 60 * 1000; // 1 hour after first push
const ESCALATE_AFTER_MS = 30 * 60 * 1000;

export async function runCron(env: Env, now: Date = new Date()): Promise<void> {
  const households = await listAllHouseholds(env);
  await Promise.all(households.map((h) => processHousehold(env, h, now)));
}

async function processHousehold(
  env: Env,
  household: Household,
  now: Date,
): Promise<void> {
  const local = localNow(now, household.tz);

  if (!isWithinWindow(local.minutes, household.remind_from, household.remind_until)) {
    return;
  }

  const dose = await upsertTodayDose(env, household.id, local.date);

  if (dose.taken_at !== null) return; // already taken — done for today

  const nowMs = now.getTime();
  await maybePush(env, household, dose, nowMs);
  await maybeEmail(env, household, dose, nowMs);
}

async function maybePush(
  env: Env,
  household: Household,
  dose: Dose,
  nowMs: number,
): Promise<void> {
  if (dose.last_push_at && nowMs - dose.last_push_at < MIN_PUSH_INTERVAL_MS) {
    return;
  }

  const subs = await listHouseholdSubscriptions(env, household.id);
  if (subs.length === 0) return;

  const elapsed = dose.first_push_at ? nowMs - dose.first_push_at : 0;
  const escalated = elapsed >= ESCALATE_AFTER_MS;

  const payload = {
    title: escalated ? "⚠️ Lek wciąż nie podany" : "💊 Pora na dawkę",
    body: escalated
      ? "Minęło już pół godziny. Odhacz w aplikacji jak tylko podasz."
      : "Pamiętaj o porannej dawce. Stuknij gdy podasz.",
    tag: `dose-${dose.id}`,
    url: env.APP_URL,
  };

  await Promise.all(subs.map((sub) => sendPush(env, sub, payload)));

  await env.DB.prepare(
    `UPDATE doses
     SET first_push_at = COALESCE(first_push_at, ?),
         last_push_at = ?
     WHERE id = ?`,
  )
    .bind(nowMs, nowMs, dose.id)
    .run();
}

async function maybeEmail(
  env: Env,
  household: Household,
  dose: Dose,
  nowMs: number,
): Promise<void> {
  if (dose.email_sent_at !== null) return;
  if (dose.first_push_at === null) return;
  if (nowMs - dose.first_push_at < EMAIL_AFTER_MS) return;

  const users = await listHouseholdUsers(env, household.id);

  await Promise.all(
    users.map((u) => {
      const tpl = reminderEmail(u.lang);
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
