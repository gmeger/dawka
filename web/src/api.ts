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

export type Me = {
  user: {
    id: string;
    household_id: string;
    email: string;
    name: string | null;
    lang: "pl" | "en";
  };
  household: {
    id: string;
    name: string;
    tz: string;
  };
  medication: Medication;
  today: {
    date: string; // YYYY-MM-DD in household tz
    doses: Dose[];
  };
  members: { id: string; email: string; name: string | null }[];
  vapidPublicKey: string;
};

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  me: () => req<Me | { user: null }>("/api/me"),
  requestLogin: (email: string, lang?: "pl" | "en") =>
    req<{ ok: boolean }>("/api/auth/request", {
      method: "POST",
      body: JSON.stringify({ email, lang }),
    }),
  bootstrap: (email: string, name?: string, lang?: "pl" | "en") =>
    req<{ ok: boolean }>("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ email, name, lang }),
    }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  takeDose: (id: string) =>
    req<{ ok: boolean }>(`/api/dose/${id}/take`, { method: "POST" }),
  untakeDose: (id: string) =>
    req<{ ok: boolean }>(`/api/dose/${id}/untake`, { method: "POST" }),
  history: (days = 35) =>
    req<{ doses: Dose[] }>(`/api/dose/history?days=${days}`),
  day: (date: string) =>
    req<{ date: string; doses: Dose[] }>(
      `/api/dose/day?date=${encodeURIComponent(date)}`,
    ),
  invite: (email: string) =>
    req<{ ok: boolean }>("/api/household/invite", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  updateMedication: (patch: Partial<Medication>) =>
    req<{ ok: boolean }>("/api/medication", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  subscribePush: (sub: PushSubscriptionJSON) =>
    req<{ ok: boolean }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub),
    }),
};
