import { Hono } from "hono";
import type { Env } from "./env";
import {
  createDefaultMedication,
  deletePendingFutureDoses,
  deletePushSubscriptionByEndpoint,
  getActiveMedication,
  getDose,
  getHousehold,
  getUserByEmail,
  type Lang,
  listDosesForRange,
  listHouseholdUsers,
  markDoseTaken,
  newId,
  type ScheduleType,
  untakeDoseByMarker,
} from "./lib/db";
import { magicLinkEmail, sendEmail } from "./lib/email";
import {
  createSession,
  destroySession,
  getSessionUser,
  setSessionCookie,
} from "./lib/session";
import { addDays, localDateTimeToUnixMs, localNow } from "./lib/time";
import { runCron } from "./cron";

const app = new Hono<{ Bindings: Env }>();

const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;

function pickLang(input: unknown, fallback: Lang = "pl"): Lang {
  return input === "pl" || input === "en" ? input : fallback;
}

// --- Auth: request magic link --------------------------------------------------
app.post("/api/auth/request", async (c) => {
  const { email, lang } = await c.req.json<{ email: string; lang?: Lang }>();
  if (!email || !email.includes("@")) return c.json({ error: "bad_email" }, 400);

  const normalized = email.toLowerCase().trim();
  const existing = await getUserByEmail(c.env, normalized);

  if (!existing) {
    // Do not disclose whether the account exists. Return generic success response.
    return c.json({ ok: true });
  }

  // Existing users: prefer their persisted lang; fall back to request hint.
  const emailLang = existing.lang ?? pickLang(lang);

  const token = newId().replace(/-/g, "") + newId().replace(/-/g, "");
  const expires = Date.now() + MAGIC_LINK_TTL_MS;
  await c.env.DB.prepare(
    `INSERT INTO magic_links (token, email, household_id, expires_at, created_at)
     VALUES (?, ?, NULL, ?, ?)`,
  )
    .bind(token, normalized, expires, Date.now())
    .run();

  const url = `${c.env.APP_URL}/api/auth/verify?token=${token}`;
  const tpl = magicLinkEmail(url, false, emailLang);
  await sendEmail(c.env, { to: normalized, subject: tpl.subject, html: tpl.html, text: tpl.text });

  return c.json({ ok: true });
});

// --- Auth: bootstrap first household + first user (one-time, no auth required) ---
app.post("/api/auth/bootstrap", async (c) => {
  const { email, name, lang } = await c.req.json<{
    email: string;
    name?: string;
    lang?: Lang;
  }>();
  if (!email || !email.includes("@")) return c.json({ error: "bad_email" }, 400);

  const count = await c.env.DB.prepare("SELECT COUNT(*) as n FROM households").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return c.json({ error: "bootstrap_closed" }, 403);

  const userLang = pickLang(lang);
  const householdId = newId();
  const userId = newId();
  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO households (id, name, tz, created_at) VALUES (?, 'Dom', 'Europe/Warsaw', ?)`,
    ).bind(householdId, now),
    c.env.DB.prepare(
      `INSERT INTO users (id, household_id, email, name, lang, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(userId, householdId, email.toLowerCase(), name ?? null, userLang, now),
  ]);

  // Default medication so the cron has something to schedule from day one.
  await createDefaultMedication(c.env, householdId);

  // Send magic link to log them in
  const token = newId().replace(/-/g, "") + newId().replace(/-/g, "");
  await c.env.DB.prepare(
    `INSERT INTO magic_links (token, email, household_id, expires_at, created_at)
     VALUES (?, ?, NULL, ?, ?)`,
  )
    .bind(token, email.toLowerCase(), Date.now() + MAGIC_LINK_TTL_MS, Date.now())
    .run();

  const url = `${c.env.APP_URL}/api/auth/verify?token=${token}`;
  const tpl = magicLinkEmail(url, false, userLang);
  await sendEmail(c.env, { to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });

  return c.json({ ok: true });
});

// --- Auth: verify magic link → session ----------------------------------------
app.get("/api/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.text("Missing token", 400);

  const link = await c.env.DB.prepare(
    "SELECT * FROM magic_links WHERE token = ?",
  )
    .bind(token)
    .first<{
      token: string;
      email: string;
      household_id: string | null;
      expires_at: number;
      used_at: number | null;
    }>();

  if (!link || link.used_at || link.expires_at < Date.now()) {
    return c.text("Link wygasł lub został już użyty.", 400);
  }

  let user = await getUserByEmail(c.env, link.email);

  // Invite flow: create user in the named household if not yet present.
  if (!user && link.household_id) {
    const userId = newId();
    await c.env.DB.prepare(
      `INSERT INTO users (id, household_id, email, created_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(userId, link.household_id, link.email, Date.now())
      .run();
    user = await getUserByEmail(c.env, link.email);
  }

  if (!user) return c.text("Nie znaleziono użytkownika.", 404);

  await c.env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE token = ?")
    .bind(Date.now(), token)
    .run();

  const sessionToken = await createSession(c.env, user.id);
  setSessionCookie(c, sessionToken);
  return c.redirect("/");
});

app.post("/api/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// --- Me: current user + household + medication + today's doses ----------------
app.get("/api/me", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ user: null }, 401);

  const household = await getHousehold(c.env, user.household_id);
  if (!household) return c.json({ error: "no_household" }, 500);

  // Auto-bootstrap medication for households missing one (e.g. immediately after the
  // 0002 migration on a freshly-created household). Idempotent: getActive returns null
  // only when nothing exists; createDefault inserts and we re-fetch.
  let medication = await getActiveMedication(c.env, household.id);
  if (!medication) {
    medication = await createDefaultMedication(c.env, household.id);
  }

  const local = localNow(new Date(), household.tz);
  const todayStartMs = localDateTimeToUnixMs(local.date, "00:00", household.tz);
  const tomorrowStartMs = localDateTimeToUnixMs(addDays(local.date, 1), "00:00", household.tz);
  const todayDoses = await listDosesForRange(
    c.env,
    household.id,
    todayStartMs,
    tomorrowStartMs,
  );

  const members = await listHouseholdUsers(c.env, household.id);

  return c.json({
    user,
    household,
    medication,
    today: { date: local.date, doses: todayDoses },
    members: members.map((m) => ({ id: m.id, email: m.email, name: m.name })),
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY,
  });
});

// --- Dose: take/untake a specific dose ----------------------------------------
async function ensureDoseInUserHousehold(
  c: import("hono").Context<{ Bindings: Env }>,
  doseId: string,
) {
  const user = await getSessionUser(c);
  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const dose = await getDose(c.env, doseId);
  if (!dose) return { error: "not_found" as const, status: 404 as const };
  if (dose.household_id !== user.household_id) {
    return { error: "forbidden" as const, status: 403 as const };
  }
  return { user, dose };
}

app.post("/api/dose/:id/take", async (c) => {
  const r = await ensureDoseInUserHousehold(c, c.req.param("id"));
  if ("error" in r) return c.json({ error: r.error }, r.status);
  await markDoseTaken(c.env, r.dose.id, r.user.id, Date.now());
  return c.json({ ok: true });
});

app.post("/api/dose/:id/untake", async (c) => {
  const r = await ensureDoseInUserHousehold(c, c.req.param("id"));
  if ("error" in r) return c.json({ error: r.error }, r.status);

  const ok = await untakeDoseByMarker(c.env, r.dose.id, r.user.id);
  if (!ok) return c.json({ error: "not_yours_to_undo" }, 403);
  return c.json({ ok: true });
});

// --- History: doses across a date range ---------------------------------------
app.get("/api/dose/history", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const household = await getHousehold(c.env, user.household_id);
  if (!household) return c.json({ error: "no_household" }, 500);

  const days = Math.min(Number(c.req.query("days") ?? 35), 365);
  const local = localNow(new Date(), household.tz);
  const fromMs = localDateTimeToUnixMs(addDays(local.date, -(days - 1)), "00:00", household.tz);
  const toMs = localDateTimeToUnixMs(addDays(local.date, 1), "00:00", household.tz);
  const doses = await listDosesForRange(c.env, household.id, fromMs, toMs);
  return c.json({ doses });
});

// --- Day detail: all doses for a specific YYYY-MM-DD --------------------------
app.get("/api/dose/day", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const household = await getHousehold(c.env, user.household_id);
  if (!household) return c.json({ error: "no_household" }, 500);

  const date = c.req.query("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "bad_date" }, 400);
  }

  const fromMs = localDateTimeToUnixMs(date, "00:00", household.tz);
  const toMs = localDateTimeToUnixMs(addDays(date, 1), "00:00", household.tz);
  const doses = await listDosesForRange(c.env, household.id, fromMs, toMs);
  return c.json({ date, doses });
});

// --- Push subscription --------------------------------------------------------
app.post("/api/push/subscribe", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const sub = await c.req.json<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }>();

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(newId(), user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, now, now)
    .run();

  return c.json({ ok: true });
});

app.delete("/api/push/subscribe", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const { endpoint } = await c.req.json<{ endpoint: string }>();
  await deletePushSubscriptionByEndpoint(c.env, endpoint);
  return c.json({ ok: true });
});

// --- Household: invite + settings ---------------------------------------------
app.post("/api/household/invite", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const { email } = await c.req.json<{ email: string }>();
  const normalized = email.toLowerCase().trim();
  if (!normalized.includes("@")) return c.json({ error: "bad_email" }, 400);

  const token = newId().replace(/-/g, "") + newId().replace(/-/g, "");
  await c.env.DB.prepare(
    `INSERT INTO magic_links (token, email, household_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(token, normalized, user.household_id, Date.now() + MAGIC_LINK_TTL_MS, Date.now())
    .run();

  const url = `${c.env.APP_URL}/api/auth/verify?token=${token}`;
  const tpl = magicLinkEmail(url, true, user.lang);
  await sendEmail(c.env, { to: normalized, subject: tpl.subject, html: tpl.html, text: tpl.text });

  return c.json({ ok: true });
});

app.post("/api/me/lang", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const { lang } = await c.req.json<{ lang?: Lang }>();
  const next = pickLang(lang, user.lang);
  await c.env.DB.prepare("UPDATE users SET lang = ? WHERE id = ?")
    .bind(next, user.id)
    .run();
  return c.json({ ok: true, lang: next });
});

app.patch("/api/household", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ tz?: string; name?: string }>();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  for (const k of ["tz", "name"] as const) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(body[k]!);
    }
  }
  if (fields.length === 0) return c.json({ ok: true });
  values.push(user.household_id);

  await c.env.DB.prepare(
    `UPDATE households SET ${fields.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();

  return c.json({ ok: true });
});

// --- Medication: edit ---------------------------------------------------------
function validateMedicationPatch(body: Record<string, unknown>): string | null {
  if (body.schedule_type !== undefined && body.schedule_type !== "slots" && body.schedule_type !== "hours") {
    return "bad_schedule_type";
  }
  if (body.schedule_pattern !== undefined) {
    const p = String(body.schedule_pattern);
    const t = body.schedule_type;
    if (t === "slots" || (t === undefined && /^[01]-[01]-[01]$/.test(p))) {
      if (!/^[01]-[01]-[01]$/.test(p)) return "bad_pattern_slots";
    } else if (t === "hours") {
      const n = Number(p);
      if (!Number.isFinite(n) || n <= 0 || n > 24) return "bad_pattern_hours";
    }
  }
  for (const k of ["morning_at", "noon_at", "evening_at"] as const) {
    if (body[k] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body[k]))) {
      return `bad_${k}`;
    }
  }
  return null;
}

app.patch("/api/medication", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const med = await getActiveMedication(c.env, user.household_id);
  if (!med) return c.json({ error: "no_medication" }, 404);

  const body = await c.req.json<{
    name?: string;
    dose?: string;
    schedule_type?: ScheduleType;
    schedule_pattern?: string;
    morning_at?: string;
    noon_at?: string;
    evening_at?: string;
    hours_anchor?: number | null;
    hours_until?: number | null;
    active?: 0 | 1;
  }>();

  const validationError = validateMedicationPatch(body as Record<string, unknown>);
  if (validationError) return c.json({ error: validationError }, 400);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const allowed = [
    "name",
    "dose",
    "schedule_type",
    "schedule_pattern",
    "morning_at",
    "noon_at",
    "evening_at",
    "hours_anchor",
    "hours_until",
    "active",
  ] as const;
  for (const k of allowed) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(body[k] as string | number | null);
    }
  }
  if (fields.length === 0) return c.json({ ok: true });

  fields.push("updated_at = ?");
  values.push(Date.now());
  values.push(med.id);

  await c.env.DB.prepare(`UPDATE medications SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  // Schedule changed → drop pending future doses; cron will re-materialize on the
  // next tick per the new pattern.
  const scheduleChanged = [
    "schedule_type",
    "schedule_pattern",
    "morning_at",
    "noon_at",
    "evening_at",
    "hours_anchor",
    "hours_until",
  ].some((k) => body[k as keyof typeof body] !== undefined);
  if (scheduleChanged) {
    await deletePendingFutureDoses(c.env, med.id, Date.now());
  }

  return c.json({ ok: true });
});

// --- Dev: trigger cron on demand (auth-gated) ---------------------------------
app.post("/api/dev/run-cron", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  await runCron(c.env);
  return c.json({ ok: true });
});

// --- Static assets fallthrough ------------------------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runCron(env));
  },
};
