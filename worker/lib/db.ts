import type { Env } from "../env";

export type Household = {
  id: string;
  name: string;
  tz: string;
  remind_from: string;
  remind_until: string;
  created_at: number;
};

export type User = {
  id: string;
  household_id: string;
  email: string;
  name: string | null;
  created_at: number;
};

export type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  last_seen_at: number;
};

export type Dose = {
  id: string;
  household_id: string;
  date: string;
  taken_at: number | null;
  taken_by_user_id: string | null;
  first_push_at: number | null;
  last_push_at: number | null;
  email_sent_at: number | null;
};

export function newId(): string {
  return crypto.randomUUID();
}

export async function getHousehold(
  env: Env,
  id: string,
): Promise<Household | null> {
  return await env.DB.prepare("SELECT * FROM households WHERE id = ?")
    .bind(id)
    .first<Household>();
}

export async function listAllHouseholds(env: Env): Promise<Household[]> {
  const r = await env.DB.prepare("SELECT * FROM households").all<Household>();
  return r.results;
}

export async function getUserById(env: Env, id: string): Promise<User | null> {
  return await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first<User>();
}

export async function getUserByEmail(
  env: Env,
  email: string,
): Promise<User | null> {
  return await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<User>();
}

export async function listHouseholdUsers(
  env: Env,
  householdId: string,
): Promise<User[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM users WHERE household_id = ? ORDER BY created_at",
  )
    .bind(householdId)
    .all<User>();
  return r.results;
}

export async function listHouseholdSubscriptions(
  env: Env,
  householdId: string,
): Promise<PushSubscription[]> {
  const r = await env.DB.prepare(
    `SELECT ps.* FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE u.household_id = ?`,
  )
    .bind(householdId)
    .all<PushSubscription>();
  return r.results;
}

export async function upsertTodayDose(
  env: Env,
  householdId: string,
  date: string,
): Promise<Dose> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO doses (id, household_id, date)
     VALUES (?, ?, ?)
     ON CONFLICT(household_id, date) DO NOTHING`,
  )
    .bind(id, householdId, date)
    .run();

  const dose = await env.DB.prepare(
    "SELECT * FROM doses WHERE household_id = ? AND date = ?",
  )
    .bind(householdId, date)
    .first<Dose>();

  if (!dose) throw new Error("upsertTodayDose: dose missing after upsert");
  return dose;
}

export async function markDoseTaken(
  env: Env,
  doseId: string,
  userId: string,
  takenAt: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE doses SET taken_at = ?, taken_by_user_id = ?
     WHERE id = ? AND taken_at IS NULL`,
  )
    .bind(takenAt, userId, doseId)
    .run();
}

export async function deletePushSubscriptionByEndpoint(
  env: Env,
  endpoint: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
    .bind(endpoint)
    .run();
}
