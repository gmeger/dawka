export type Me = {
  user: {
    id: string;
    household_id: string;
    email: string;
    name: string | null;
  };
  household: {
    id: string;
    name: string;
    tz: string;
    remind_from: string;
    remind_until: string;
  };
  today: {
    date: string;
    dose: {
      id: string;
      taken_at: number | null;
      taken_by_user_id: string | null;
    };
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
  requestLogin: (email: string) =>
    req<{ ok: boolean }>("/api/auth/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  bootstrap: (email: string, name?: string) =>
    req<{ ok: boolean }>("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ email, name }),
    }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  takeDose: () =>
    req<{ ok: boolean }>("/api/dose/today/take", { method: "POST" }),
  history: (days = 30) =>
    req<{ doses: Array<{ date: string; taken_at: number | null }> }>(
      `/api/dose/history?days=${days}`,
    ),
  invite: (email: string) =>
    req<{ ok: boolean }>("/api/household/invite", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  updateHousehold: (patch: {
    remind_from?: string;
    remind_until?: string;
    tz?: string;
    name?: string;
  }) =>
    req<{ ok: boolean }>("/api/household", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  subscribePush: (sub: PushSubscriptionJSON) =>
    req<{ ok: boolean }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub),
    }),
};
