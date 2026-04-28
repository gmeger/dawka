# CLAUDE.md

Operational context for future sessions on this repo. The README is for someone setting it up; this file is for someone *modifying* it.

## What this is

A single-Worker Cloudflare app that reminds household members to give a daily medication. One dose per household per day; any member tapping "Mark as given" silences notifications for everyone. Push first, email fallback after 60 min.

Production: `https://dawka.org` (and `www.dawka.org`). One Worker named `dawka`, one D1 database named `dawka` (`f56e5c71-0ddc-4f6f-a8d3-f4a5f18d4c36`). Cron `*/15 * * * *` UTC. Free tier across the board.

## Architecture

One Worker, two entrypoints (`fetch` + `scheduled`), three things in one deployable: HTTP routes, cron handler, static-asset serving.

```
worker/
  index.ts       Hono app — all /api/* routes + asset fallthrough
  cron.ts        scheduled() — picks up pending doses, decides push vs email
  env.ts         Env type for DB, ASSETS, vars, secrets
  types.d.ts     Ambient module decls (webpush-webcrypto has none)
  lib/
    db.ts        Typed D1 query helpers
    session.ts   Cookie auth (signed-token + DB lookup)
    time.ts      tz/window logic (Intl.DateTimeFormat, hourCycle:h23)
    webpush.ts   sendPush() wrapper around webpush-webcrypto
    email.ts     Resend client + magic-link / reminder templates (PL/EN)
web/
  src/
    App.tsx      One-file SPA — Today / History / Settings + Login
    api.ts       Typed fetch client (credentials: include)
    push.ts      pushManager.subscribe + permission flow
    sw.ts        Service worker — push + notificationclick handlers only
    i18n.ts      Hand-rolled t(key, vars) + React context
    styles.css   Single stylesheet, dark mode via prefers-color-scheme
migrations/
  0001_init.sql  Full schema. Edit in place until first remote apply.
```

Frontend builds to `dist/`, served by the Worker via `[assets]` binding. The Worker also handles the SPA fallback (`not_found_handling = "single-page-application"`) — but see "run_worker_first" below.

## Data model (D1)

| Table | Purpose |
| --- | --- |
| `households` | Shared dose unit. tz + remind window live here. |
| `users` | Members. `lang` column drives email language. |
| `push_subscriptions` | One per device. Endpoint is unique; we delete on APNs 404/410. |
| `doses` | One row per household per day. `taken_at IS NULL` = pending. |
| `magic_links` | Login + invite tokens, 30 min TTL, `used_at` blocks reuse. `household_id IS NOT NULL` = invite. |
| `sessions` | Long-lived (1 year) cookie-token → user_id mapping. |

`UNIQUE(household_id, date)` on doses is load-bearing — `upsertTodayDose` relies on `ON CONFLICT DO NOTHING`.

## Reminder logic (worker/cron.ts)

Per household, on each cron tick:
1. Compute local date+time via `localNow(now, household.tz)`.
2. Skip if outside `[remind_from, remind_until]` window.
3. Upsert today's dose; skip if `taken_at` is set.
4. **Push**: if no push in last 14 min, send to every subscription in the household. Title escalates after 30 min from `first_push_at`.
5. **Email**: if 60 min passed since `first_push_at` and `email_sent_at IS NULL`, send reminder email to each member in their own `lang`, mark `email_sent_at`.

`first_push_at` is sticky (`COALESCE`) — once set, the 60-min email timer counts from there even if someone disables/re-enables push.

## Auth flow

Two endpoints can mint magic links:
- `POST /api/auth/bootstrap` — creates the first household + first user. Refuses if any household exists. The only way to onboard the very first user.
- `POST /api/auth/request` — sends a login link to an existing user.
- `POST /api/household/invite` — sends a magic link with `household_id` set; verify creates a new user joined to that household.

`GET /api/auth/verify?token=...` validates, marks used, creates a session row, sets `dawka_session` cookie (HttpOnly, Secure, SameSite=Lax, 1 year), redirects to `/`.

## Production setup state

| Thing | Value |
| --- | --- |
| Worker name | `dawka` |
| D1 database name / id | `dawka` / `f56e5c71-0ddc-4f6f-a8d3-f4a5f18d4c36` |
| Custom domains | `dawka.org`, `www.dawka.org` |
| Email from | `Dawka <noreply@dawka.org>` (verified in Resend) |
| Cron | `*/15 * * * *` UTC |
| Required secrets | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, `SESSION_SECRET` |

`SESSION_SECRET` is currently set but *not used* — sessions are random tokens validated against the DB, no HMAC. The secret stays defined as a placeholder so the Env type is happy and we can add HMAC signing later without a config change.

## Useful operational recipes

**Inspect remote DB:**
```bash
npx wrangler d1 execute dawka --remote --command "SELECT * FROM doses ORDER BY date DESC LIMIT 5"
npx wrangler d1 execute dawka --remote --json --command "SELECT email, lang FROM users"
```

**Trigger cron on demand** (auth-gated, runs `runCron(env)` synchronously):
```bash
# from your PWA console (logged in):
fetch('/api/dev/run-cron', { method: 'POST', credentials: 'include' }).then(r => r.json()).then(console.log)

# or mint a session in D1 and curl with the cookie (see git history of this file
# for an example one-liner — leaving it out here so it doesn't get copy-pasted blindly).
```

**Mint a magic link without sending email** (for direct verify-URL testing):
```bash
TOKEN=$(node -e "console.log([0,1].map(()=>require('crypto').randomUUID().replace(/-/g,'')).join(''))")
EXP=$(node -e "console.log(Date.now() + 30*60*1000)")
NOW=$(node -e "console.log(Date.now())")
npx wrangler d1 execute dawka --remote --command \
  "INSERT INTO magic_links (token, email, household_id, expires_at, created_at) \
   VALUES ('$TOKEN', 'you@example.com', NULL, $EXP, $NOW)"
echo "https://dawka.org/api/auth/verify?token=$TOKEN"
```

**Don't `curl -I` the verify URL to test it** — HEAD still runs the handler in Hono, marking the token used. Use mint-fresh-without-email above.

**Tail production logs:**
```bash
npx wrangler tail dawka --format=pretty
```

**Reset today's dose to pending** (e.g. for a re-test):
```bash
npx wrangler d1 execute dawka --remote --command \
  "UPDATE doses SET taken_at=NULL, taken_by_user_id=NULL, first_push_at=NULL, last_push_at=NULL, email_sent_at=NULL WHERE date = date('now')"
```

## Gotchas we hit (preserve these — easy to re-discover painfully)

### `run_worker_first = ["/api/*"]` is required
Without it, browser navigations to `/api/auth/verify?token=...` get the SPA's `index.html` (HTTP 200) instead of hitting our handler. Cloudflare Static Assets in `single-page-application` mode short-circuits any request with `Sec-Fetch-Dest: document` — i.e. every link click in an email or paste in the address bar. `curl` works fine because it doesn't send `Sec-Fetch-Dest`, which is exactly what made this confusing to diagnose.

The fix lives in `wrangler.toml`:
```toml
[assets]
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

The array form requires wrangler ≥ 4.0. Wrangler 3.x only accepts a boolean.

### `webpush-webcrypto` doesn't see `globalThis.crypto`
The library only checks `self.crypto`, which is undefined in Node. The `vapid:generate` script wires up Node's webcrypto explicitly:
```js
const m = await import('webpush-webcrypto');
const c = await import('node:crypto');
m.setWebCrypto(c.webcrypto);
const k = await m.ApplicationServerKeys.generate();
```
On Cloudflare Workers `self.crypto` *is* defined, so production code in `worker/lib/webpush.ts` doesn't need this.

### `wrangler secret put` with `echo` adds a trailing newline
Resend will reject the API key with a 401 "API key is invalid" if there's a `\n` baked into the secret value. Use `printf "%s" "$VALUE" | npx wrangler secret put NAME` always.

### Magic links + email apps with in-app browsers
Some email clients on iOS (Gmail, Outlook) open links in their own webview, which doesn't share cookies with the user's Safari/PWA. The session is set in the in-app browser only, and the PWA stays logged out. We document the workaround (paste URL in Safari) in the README. A long-term fix could be a 6-digit code flow.

### Hono `setCookie` + `c.redirect`
These compose correctly — `setCookie` adds to the context's headers, `c.redirect` inherits them. We verified `Set-Cookie` survives the 302 in production. If a refactor touches this, re-test end-to-end (curl with `-L -c jar.txt`).

## Things deliberately not done

- **PWA icons (PNG 192/512)**: manifest references them, but only `icon.svg` exists. Browsers fall back to SVG; iOS may use a default-style icon for home-screen install. Generate from `web/public/icon.svg` with `sharp` if/when polish matters.
- **Multi-medication / multi-child**: schema is single-dose-per-household. Adding a `medications` table is straightforward but out of scope for v1.
- **Account deletion / GDPR endpoints**: not implemented.
- **Rate limiting on `/api/auth/request`**: a determined actor could spam Resend. Cloudflare has rate-limit rules in the dashboard if it becomes a problem.
- **DST sanity check**: `Intl.DateTimeFormat` with `timeZone: 'Europe/Warsaw'` handles DST correctly per `tests/time.test.ts`. If we get reports of the reminder window drifting in October/March, look here.
- **Service-worker fetch caching**: `sw.ts` only handles `push` + `notificationclick`. No precaching, no offline mode. The Worker serves a small enough app that it's not worth the complexity.

## Coding conventions

- Hono routes inline in `worker/index.ts`. Don't split per-resource files — current size doesn't warrant it.
- Frontend strings go through `useI18n().t(key, vars)`. New strings need entries in *both* `pl` and `en` blocks of `web/src/i18n.ts`.
- D1 queries: prepare → bind → run/first/all. No raw string concatenation. `crypto.randomUUID()` for IDs.
- Tests: Vitest, pure functions only. Don't test through D1; the cron logic in `cron.ts` deliberately calls small testable helpers that get covered indirectly.
- TypeScript strict + `noUncheckedIndexedAccess`. Avoid `any`. Casts via `as` only at irreducible boundaries (e.g. `body as BodyInit` for `webpush-webcrypto` returns).

## Repo and references

- GitHub: https://github.com/gmeger/dawka (public, MIT)
- Cloudflare Static Assets docs: https://developers.cloudflare.com/workers/static-assets/
- Resend API: https://resend.com/docs/api-reference/emails/send-email
- webpush-webcrypto: https://github.com/alastaircoote/webpush-webcrypto
