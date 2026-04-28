import type { Env } from "../env";

export type Lang = "pl" | "en";

export type Household = {
  id: string;
  name: string;
  tz: string;
  created_at: number;
};

export type User = {
  id: string;
  household_id: string;
  email: string;
  name: string | null;
  lang: Lang;
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

export type ScheduleType = "slots" | "hours";

export type Medication = {
  id: string;
  household_id: string;
  name: string;
  dose: string;
  schedule_type: ScheduleType;
  schedule_pattern: string;
  morning_at: string;
  noon_at: string;
  evening_at: string;
  hours_anchor: number | null;
  hours_until: number | null;
  active: number;
  created_at: number;
  updated_at: number;
};

export type Dose = {
  id: string;
  medication_id: string;
  household_id: string;
  scheduled_at: number;
  scheduled_label: string;
  taken_at: number | null;
  taken_by_user_id: string | null;
  first_alert_at: number | null;
  last_alert_at: number | null;
  email_sent_at: number | null;
};

export function newId(): string {
  return crypto.randomUUID();
}

// --- Household / users -------------------------------------------------------

export async function getHousehold(env: Env, id: string): Promise<Household | null> {
  return await env.DB.prepare("SELECT * FROM households WHERE id = ?")
    .bind(id)
    .first<Household>();
}

export async function listAllHouseholds(env: Env): Promise<Household[]> {
  const r = await env.DB.prepare("SELECT * FROM households").all<Household>();
  return r.results;
}

export async function getUserById(env: Env, id: string): Promise<User | null> {
  return await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}

export async function getUserByEmail(env: Env, email: string): Promise<User | null> {
  return await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<User>();
}

export async function listHouseholdUsers(env: Env, householdId: string): Promise<User[]> {
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

export async function deletePushSubscriptionByEndpoint(
  env: Env,
  endpoint: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
    .bind(endpoint)
    .run();
}

// --- Medications -------------------------------------------------------------

export async function getActiveMedication(
  env: Env,
  householdId: string,
): Promise<Medication | null> {
  return await env.DB.prepare(
    "SELECT * FROM medications WHERE household_id = ? AND active = 1",
  )
    .bind(householdId)
    .first<Medication>();
}

export async function createDefaultMedication(
  env: Env,
  householdId: string,
): Promise<Medication> {
  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO medications (
       id, household_id, name, dose, schedule_type, schedule_pattern,
       morning_at, noon_at, evening_at, active, created_at, updated_at
     ) VALUES (?, ?, 'Lek', '1 dawka', 'slots', '1-0-0', '08:00', '14:00', '20:00', 1, ?, ?)`,
  )
    .bind(id, householdId, now, now)
    .run();

  const med = await getActiveMedication(env, householdId);
  if (!med) throw new Error("createDefaultMedication: insert succeeded but lookup failed");
  return med;
}

// --- Doses -------------------------------------------------------------------

export async function listDosesForRange(
  env: Env,
  householdId: string,
  fromMs: number,
  toMs: number,
): Promise<Dose[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM doses
     WHERE household_id = ? AND scheduled_at >= ? AND scheduled_at < ?
     ORDER BY scheduled_at`,
  )
    .bind(householdId, fromMs, toMs)
    .all<Dose>();
  return r.results;
}

export async function listPendingDoses(env: Env, medicationId: string): Promise<Dose[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM doses
     WHERE medication_id = ? AND taken_at IS NULL
     ORDER BY scheduled_at`,
  )
    .bind(medicationId)
    .all<Dose>();
  return r.results;
}

export async function getDose(env: Env, id: string): Promise<Dose | null> {
  return await env.DB.prepare("SELECT * FROM doses WHERE id = ?").bind(id).first<Dose>();
}

export async function upsertDose(
  env: Env,
  args: {
    medicationId: string;
    householdId: string;
    scheduledAt: number;
    scheduledLabel: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO doses (
       id, medication_id, household_id, scheduled_at, scheduled_label
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(medication_id, scheduled_at) DO NOTHING`,
  )
    .bind(newId(), args.medicationId, args.householdId, args.scheduledAt, args.scheduledLabel)
    .run();
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

export async function untakeDoseByMarker(
  env: Env,
  doseId: string,
  userId: string,
): Promise<boolean> {
  // Resets push/email tracking too — cron re-evaluates from scratch on next tick.
  const r = await env.DB.prepare(
    `UPDATE doses
     SET taken_at = NULL, taken_by_user_id = NULL,
         first_alert_at = NULL, last_alert_at = NULL, email_sent_at = NULL
     WHERE id = ? AND taken_by_user_id = ?`,
  )
    .bind(doseId, userId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function deletePendingFutureDoses(
  env: Env,
  medicationId: string,
  fromMs: number,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM doses
     WHERE medication_id = ? AND taken_at IS NULL AND scheduled_at > ?`,
  )
    .bind(medicationId, fromMs)
    .run();
}
