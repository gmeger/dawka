// Web Push wrapper. Uses webpush-webcrypto (pure WebCrypto, no Node deps).
//
// VAPID keys: generate once with `npm run vapid:generate`, store as wrangler secrets:
//   wrangler secret put VAPID_PUBLIC_KEY
//   wrangler secret put VAPID_PRIVATE_KEY

import {
  ApplicationServerKeys,
  generatePushHTTPRequest,
} from "webpush-webcrypto";
import type { Env } from "../env";
import type { PushSubscription } from "./db";
import { deletePushSubscriptionByEndpoint } from "./db";

let keysPromise: Promise<ApplicationServerKeys> | null = null;

function getKeys(env: Env): Promise<ApplicationServerKeys> {
  return (keysPromise ??= ApplicationServerKeys.fromJSON({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  }));
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
};

export async function sendPush(
  env: Env,
  sub: PushSubscription,
  payload: PushPayload,
): Promise<{ ok: boolean; gone: boolean }> {
  try {
    const keys = await getKeys(env);
    const { headers, body, endpoint } = await generatePushHTTPRequest({
      applicationServerKeys: keys,
      payload: JSON.stringify(payload),
      target: {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      adminContact: env.VAPID_SUBJECT,
      ttl: 60 * 60, // 1h — stale reminder is useless
      urgency: "high",
    });

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: body as BodyInit,
    });

    // 404/410 = subscription expired. Clean up so we don't keep retrying.
    if (res.status === 404 || res.status === 410) {
      await deletePushSubscriptionByEndpoint(env, sub.endpoint);
      return { ok: false, gone: true };
    }

    return { ok: res.ok, gone: false };
  } catch (err) {
    console.error("sendPush failed", { endpoint: sub.endpoint, err });
    return { ok: false, gone: false };
  }
}
