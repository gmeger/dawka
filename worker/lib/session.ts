import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import type { User } from "./db";
import { getUserById, newId } from "./db";

const COOKIE_NAME = "dawka_session";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export async function createSession(
  env: Env,
  userId: string,
): Promise<string> {
  const token = newId() + newId(); // 64-hex chars
  const expires = Date.now() + SESSION_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(token, userId, expires, Date.now())
    .run();
  return token;
}

export function setSessionCookie(
  c: Context<{ Bindings: Env }>,
  token: string,
): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSessionUser(
  c: Context<{ Bindings: Env }>,
): Promise<User | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;

  const row = await c.env.DB.prepare(
    "SELECT user_id, expires_at FROM sessions WHERE token = ?",
  )
    .bind(token)
    .first<{ user_id: string; expires_at: number }>();

  if (!row || row.expires_at < Date.now()) return null;
  return await getUserById(c.env, row.user_id);
}

export async function destroySession(
  c: Context<{ Bindings: Env }>,
): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?")
      .bind(token)
      .run();
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}
