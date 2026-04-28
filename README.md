# Dawka

A small, mobile-first PWA that reminds you to give your child their daily medication. Two parents share one dose: when either marks it as given, both stop receiving reminders. Push notifications first, email fallback if the dose hasn't been marked an hour after the first push.

Available languages: Polish, English.

## How it works

- Reminders fire in a window you choose (default 08:00–10:00, Europe/Warsaw).
- A cron Worker runs every 15 minutes and decides per household whether to push, escalate, or send a fallback email.
- Today's dose is a single shared row: any household member tapping "Mark as given" silences notifications for everyone.
- History view shows a 35-day grid and your current streak.

## Stack

- **Frontend**: Vite + React + TypeScript, served as static assets from a Cloudflare Worker.
- **Backend**: a single Cloudflare Worker using Hono. Same Worker handles HTTP, scheduled cron, and asset serving.
- **Database**: Cloudflare D1 (SQLite at the edge).
- **Push**: Web Push (VAPID) via [`webpush-webcrypto`](https://github.com/alastaircoote/webpush-webcrypto), which works on the Workers runtime.
- **Email**: [Resend](https://resend.com) for magic-link auth and reminder fallbacks.
- **Auth**: passwordless magic links; long-lived session cookies stored in D1.

Everything fits within the free tier.

## One-time setup

You need: a Cloudflare account, a domain registered in Cloudflare DNS, and a Resend account.

If you're using your own domain, replace `dawka.org` everywhere in `wrangler.toml` (`routes`, `APP_URL`, `EMAIL_FROM`, `VAPID_SUBJECT`) before you start.

```bash
# 1. Cloudflare auth + database
npx wrangler login
npx wrangler d1 create dawka
# → paste the returned database_id into wrangler.toml under [[d1_databases]]

# 2. VAPID keys (Web Push)
npm run vapid:generate
# → outputs { "publicKey": "...", "privateKey": "..." }
# Use printf (not echo) so no trailing newline ends up in the secret:
printf "%s" "<publicKey>"  | npx wrangler secret put VAPID_PUBLIC_KEY
printf "%s" "<privateKey>" | npx wrangler secret put VAPID_PRIVATE_KEY

# 3. Resend
# - sign up at resend.com
# - verify your domain (add SPF, DKIM, return-path DNS records to Cloudflare DNS)
# - create an API key
printf "%s" "<resend_api_key>" | npx wrangler secret put RESEND_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" \
  | npx wrangler secret put SESSION_SECRET

# 4. Apply migrations + first deploy
npm run db:migrate:remote
npm run deploy
# → wrangler attaches the routes from wrangler.toml as Custom Domains
#   (your domain must be active in Cloudflare DNS for this to succeed)
```

After deploying, bootstrap the first user and household:

```bash
curl -X POST https://dawka.org/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","name":"You","lang":"en"}'
```

The bootstrap endpoint refuses to run once any household exists, so it's safe to leave enabled. After bootstrap, all subsequent users join via household invites from the Settings tab.

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill in real values (you can reuse the Resend key and VAPID keys)

npm install
npm run db:migrate:local
npm run dev
```

`npm run dev` starts both Vite (5173) and `wrangler dev` (8787). Vite proxies `/api/*` to the Worker.

## Project layout

```
worker/         Cloudflare Worker — HTTP + cron + static-asset fallthrough
  index.ts      Hono routes
  cron.ts       scheduled() handler — push escalation + email fallback
  lib/          db, session, time/tz, web-push, email helpers
web/            Vite frontend
  src/          React app, service worker, i18n
  public/       manifest, icons
migrations/     D1 SQL migrations
tests/          Vitest unit tests (tz/window logic)
```

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Wrangler in parallel |
| `npm run build` | Production build of the frontend |
| `npm run deploy` | Build, then `wrangler deploy` |
| `npm run typecheck` | `tsc --noEmit` for app + service worker |
| `npm test` | Vitest unit tests |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:remote` | Apply migrations to production D1 |
| `npm run vapid:generate` | Print a fresh VAPID keypair as JSON |

## Testing reminders without waiting for the next cron tick

The cron runs every 15 minutes (`*/15 * * * *` UTC). To trigger the full reminder logic on demand — useful for verifying that push delivery works end-to-end — call the dev endpoint while authenticated:

```js
// In your PWA, while logged in, paste in the JS console:
fetch('/api/dev/run-cron', { method: 'POST', credentials: 'include' })
  .then(r => r.json()).then(console.log)
```

It runs `scheduled()` synchronously and returns `{ ok: true }`. The endpoint is auth-gated and only ever pushes/emails members of the caller's own household, so the blast radius is bounded.

## iOS Web Push, briefly

iOS supports Web Push only after a PWA has been installed to the home screen (Share → Add to Home Screen). The app shows a banner if push hasn't been enabled. The email fallback exists for exactly this reason — if a push doesn't arrive (Focus mode, device off, anything), an email lands an hour after the first push attempt.

When clicking the magic link in an email, the link must reach your PWA's browser context (Safari on iOS) — not an in-app browser inside Gmail/Outlook/etc. If sign-in seems silently to fail, copy the URL from the email and paste it into Safari's address bar instead.

## License

[MIT](./LICENSE).
