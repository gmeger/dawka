import { Hono } from "hono";
import type { Env } from "./env";
import {
  deletePushSubscriptionByEndpoint,
  getHousehold,
  getUserByEmail,
  type Lang,
  listHouseholdUsers,
  markDoseTaken,
  newId,
  upsertTodayDose,
} from "./lib/db";
import { magicLinkEmail, sendEmail } from "./lib/email";
import {
  createSession,
  destroySession,
  getSessionUser,
  setSessionCookie,
} from "./lib/session";
import { localNow } from "./lib/time";
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
// Used only when there are zero households in the DB. After that, users are added by invite.
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
      `INSERT INTO households (id, name, tz, remind_from, remind_until, created_at)
       VALUES (?, 'Dom', 'Europe/Warsaw', '08:00', '10:00', ?)`,
    ).bind(householdId, now),
    c.env.DB.prepare(
      `INSERT INTO users (id, household_id, email, name, lang, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(userId, householdId, email.toLowerCase(), name ?? null, userLang, now),
  ]);

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

// --- Me: current user + household + today's dose ------------------------------
app.get("/api/me", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ user: null }, 401);

  const household = await getHousehold(c.env, user.household_id);
  if (!household) return c.json({ error: "no_household" }, 500);

  const local = localNow(new Date(), household.tz);
  const dose = await upsertTodayDose(c.env, household.id, local.date);
  const members = await listHouseholdUsers(c.env, household.id);

  return c.json({
    user,
    household,
    today: { date: local.date, dose },
    members: members.map((m) => ({ id: m.id, email: m.email, name: m.name })),
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY,
  });
});

// --- Dose: mark today taken ---------------------------------------------------
app.post("/api/dose/today/take", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const household = await getHousehold(c.env, user.household_id);
  if (!household) return c.json({ error: "no_household" }, 500);

  const local = localNow(new Date(), household.tz);
  const dose = await upsertTodayDose(c.env, household.id, local.date);
  await markDoseTaken(c.env, dose.id, user.id, Date.now());

  return c.json({ ok: true });
});

// --- Dose: undo "taken" for today (only by the user who marked it) ------------
app.post("/api/dose/today/untake", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const household = await getHousehold(c.env, user.household_id);
  if (!household) return c.json({ error: "no_household" }, 500);

  const local = localNow(new Date(), household.tz);
  const dose = await c.env.DB.prepare(
    "SELECT id, taken_at, taken_by_user_id FROM doses WHERE household_id = ? AND date = ?",
  )
    .bind(household.id, local.date)
    .first<{ id: string; taken_at: number | null; taken_by_user_id: string | null }>();

  if (!dose || dose.taken_at === null) return c.json({ error: "not_taken" }, 404);
  if (dose.taken_by_user_id !== user.id) {
    return c.json({ error: "not_yours_to_undo" }, 403);
  }

  // Reset push/email tracking too — cron will re-evaluate from scratch on next tick.
  await c.env.DB.prepare(
    `UPDATE doses
     SET taken_at = NULL, taken_by_user_id = NULL,
         first_push_at = NULL, last_push_at = NULL, email_sent_at = NULL
     WHERE id = ?`,
  )
    .bind(dose.id)
    .run();

  return c.json({ ok: true });
});

// --- History ------------------------------------------------------------------
app.get("/api/dose/history", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const days = Math.min(Number(c.req.query("days") ?? 30), 365);
  const r = await c.env.DB.prepare(
    `SELECT * FROM doses
     WHERE household_id = ?
     ORDER BY date DESC
     LIMIT ?`,
  )
    .bind(user.household_id, days)
    .all();

  return c.json({ doses: r.results });
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
  // Upsert by endpoint
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
  // Use inviter's language as default for invitee — they can switch after joining.
  const tpl = magicLinkEmail(url, true, user.lang);
  await sendEmail(c.env, { to: normalized, subject: tpl.subject, html: tpl.html, text: tpl.text });

  return c.json({ ok: true });
});

// --- User: update preferred language ------------------------------------------
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

  const body = await c.req.json<{
    tz?: string;
    remind_from?: string;
    remind_until?: string;
    name?: string;
  }>();

  const fields: string[] = [];
  const values: (string | number)[] = [];
  for (const k of ["tz", "remind_from", "remind_until", "name"] as const) {
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

// --- Dev: trigger cron on demand (auth-gated; useful for testing push) -------
app.post("/api/dev/run-cron", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  await runCron(c.env);
  return c.json({ ok: true });
});

// --- Static assets fallthrough ------------------------------------------------
// Anything not /api/* falls through to Workers Static Assets binding (Vite build).
// `not_found_handling = "single-page-application"` in wrangler.toml routes unknown
// paths to index.html so client-side routing works.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runCron(env));
  },
};
