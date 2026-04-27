export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;

  // vars (wrangler.toml)
  APP_URL: string;
  EMAIL_FROM: string;
  VAPID_SUBJECT: string;

  // secrets (wrangler secret put)
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  RESEND_API_KEY: string;
  SESSION_SECRET: string;
};
