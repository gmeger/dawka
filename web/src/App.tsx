import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { getPushState, subscribePush, type PushState } from "./push";

type View = "today" | "history" | "settings";

export function App() {
  const [me, setMe] = useState<Me | { user: null } | null>(null);
  const [view, setView] = useState<View>("today");

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe({ user: null }));
  }, []);

  if (!me) return <div className="card">Ładowanie…</div>;
  if (me.user === null) return <Login onDone={() => api.me().then(setMe)} />;

  const refresh = () => api.me().then(setMe);

  return (
    <>
      <header>
        <h1>Dawka</h1>
        <button className="btn-ghost" onClick={() => api.logout().then(refresh)}>
          Wyloguj
        </button>
      </header>

      <nav className="tabs">
        <button aria-selected={view === "today"} onClick={() => setView("today")}>
          Dziś
        </button>
        <button aria-selected={view === "history"} onClick={() => setView("history")}>
          Historia
        </button>
        <button aria-selected={view === "settings"} onClick={() => setView("settings")}>
          Ustawienia
        </button>
      </nav>

      {view === "today" && <Today me={me} onTake={refresh} />}
      {view === "history" && <History />}
      {view === "settings" && <Settings me={me} onSaved={refresh} />}
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      if (bootstrapMode) {
        await api.bootstrap(email, name || undefined);
      } else {
        await api.requestLogin(email);
      }
      setSent(true);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("404")) {
        setError("Nie znaleziono konta dla tego maila. Jeśli jesteś pierwszym użytkownikiem, użyj 'Pierwszy raz tutaj'.");
      } else {
        setError("Coś poszło nie tak. Spróbuj jeszcze raz.");
      }
    }
  };

  if (sent) {
    return (
      <div className="card">
        <h2>Sprawdź mail</h2>
        <p>Wysłaliśmy link na <strong>{email}</strong>. Kliknij w niego, żeby się zalogować. Link wygasa za 30 minut.</p>
      </div>
    );
  }

  return (
    <>
      <header>
        <h1>Dawka</h1>
      </header>
      <div className="card">
        <h2>{bootstrapMode ? "Załóż konto" : "Zaloguj się"}</h2>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Wpisz email — wyślemy link bez hasła.
        </p>
        <input
          className="input"
          type="email"
          placeholder="ty@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          style={{ marginBottom: 12 }}
        />
        {bootstrapMode && (
          <input
            className="input"
            type="text"
            placeholder="Imię (opcjonalnie)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        )}
        <button className="btn-primary" onClick={submit} disabled={!email.includes("@")}>
          Wyślij link
        </button>
        {error && <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 12 }}>{error}</p>}
        <button
          className="btn-ghost"
          onClick={() => setBootstrapMode((b) => !b)}
          style={{ marginTop: 16, width: "100%" }}
        >
          {bootstrapMode ? "Mam już konto" : "Pierwszy raz tutaj"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
        Po zalogowaniu — dodaj tę stronę do ekranu początkowego, żeby otrzymywać powiadomienia push.
      </p>
    </>
  );
}

function Today({ me, onTake }: { me: Me; onTake: () => void }) {
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setPushState);
  }, []);

  const taken = me.today.dose.taken_at !== null;
  const takenBy = taken
    ? me.members.find((m) => m.id === me.today.dose.taken_by_user_id)
    : null;

  const enablePush = async () => {
    setBusy(true);
    await subscribePush(me.vapidPublicKey).catch(() => {});
    setPushState(await getPushState());
    setBusy(false);
  };

  const take = async () => {
    setBusy(true);
    try {
      await api.takeDose();
      onTake();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {pushState?.kind === "default" && (
        <div className="banner">
          <strong>Włącz powiadomienia</strong>
          <p style={{ margin: "4px 0 8px" }}>
            Bez tego nic nie przyleci. Na iPhonie najpierw dodaj stronę do ekranu początkowego.
          </p>
          <button className="btn-ghost" onClick={enablePush} disabled={busy} style={{ padding: 0 }}>
            Włącz
          </button>
        </div>
      )}
      {pushState?.kind === "denied" && (
        <div className="banner">
          Powiadomienia zablokowane. Włącz je w ustawieniach systemowych telefonu.
        </div>
      )}
      {pushState?.kind === "unsupported" && (
        <div className="banner">
          Ta przeglądarka nie wspiera powiadomień push. Email fallback wciąż działa.
        </div>
      )}

      <div className="card dose-state">
        <div className="status">{taken ? "Dziś — zrobione" : "Dziś — do zrobienia"}</div>
        <h2 className="headline">
          {taken ? "✓ Lek podany" : "Lek do podania"}
        </h2>
        <p className="sub">
          {taken
            ? `O ${formatTime(me.today.dose.taken_at!)} przez ${takenBy?.name ?? takenBy?.email ?? "kogoś z domu"}`
            : `Okno przypomnień: ${me.household.remind_from}–${me.household.remind_until}`}
        </p>
        {!taken && (
          <button className="btn-primary" onClick={take} disabled={busy}>
            Podane ✓
          </button>
        )}
      </div>
    </>
  );
}

function History() {
  const [doses, setDoses] = useState<{ date: string; taken_at: number | null }[] | null>(null);

  useEffect(() => {
    api.history(35).then((r) => setDoses(r.doses));
  }, []);

  if (!doses) return <div className="card">Ładowanie…</div>;

  // Build a 5x7 grid of last 35 days, ending today.
  const today = new Date();
  const cells: { date: string; state: "taken" | "missed" | "future" | "empty" }[] = [];
  const map = new Map(doses.map((d) => [d.date, d.taken_at !== null]));
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (map.has(key)) {
      cells.push({ date: key, state: map.get(key) ? "taken" : "missed" });
    } else {
      cells.push({ date: key, state: "empty" });
    }
  }

  const streak = computeStreak(doses);

  return (
    <>
      <div className="card">
        <div className="row">
          <span className="label">Aktualna seria</span>
          <strong>{streak} {streak === 1 ? "dzień" : "dni"}</strong>
        </div>
        <div className="row">
          <span className="label">Ostatnie 35 dni</span>
          <strong>{cells.filter((c) => c.state === "taken").length} z {cells.length}</strong>
        </div>
      </div>
      <div className="card">
        <div className="history-grid">
          {cells.map((c) => (
            <div
              key={c.date}
              className={`history-cell ${c.state === "taken" ? "taken" : c.state === "missed" ? "missed" : ""}`}
              title={c.date}
            >
              {Number(c.date.slice(8))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Settings({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [from, setFrom] = useState(me.household.remind_from);
  const [until, setUntil] = useState(me.household.remind_until);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await api.updateHousehold({ remind_from: from, remind_until: until });
    setBusy(false);
    onSaved();
  };

  const invite = async () => {
    setBusy(true);
    await api.invite(inviteEmail);
    setInviteSent(true);
    setBusy(false);
  };

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Okno przypomnień</h3>
        <div className="row">
          <span className="label">Od</span>
          <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
        <div className="row">
          <span className="label">Do</span>
          <input className="input" type="time" value={until} onChange={(e) => setUntil(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
        <button className="btn-primary" onClick={save} disabled={busy} style={{ marginTop: 12 }}>
          Zapisz
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Domownicy</h3>
        {me.members.map((m) => (
          <div key={m.id} className="row">
            <span>{m.name ?? m.email}</span>
            {m.id === me.user.id && <span className="label">to ty</span>}
          </div>
        ))}
        {!inviteSent ? (
          <>
            <input
              className="input"
              type="email"
              placeholder="email partnera"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={{ marginTop: 12 }}
            />
            <button
              className="btn-primary"
              onClick={invite}
              disabled={busy || !inviteEmail.includes("@")}
              style={{ marginTop: 12 }}
            >
              Zaproś
            </button>
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>Zaproszenie wysłane na {inviteEmail}.</p>
        )}
      </div>
    </>
  );
}

function formatTime(unixMs: number): string {
  const d = new Date(unixMs);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

function computeStreak(doses: { date: string; taken_at: number | null }[]): number {
  const sorted = [...doses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const today = new Date().toISOString().slice(0, 10);
  let cursor = today;
  let streak = 0;
  for (const d of sorted) {
    if (d.date !== cursor) {
      // Gap or future entry — stop.
      if (d.date > cursor) continue;
      break;
    }
    if (d.taken_at !== null) {
      streak++;
      const prev = new Date(cursor);
      prev.setDate(prev.getDate() - 1);
      cursor = prev.toISOString().slice(0, 10);
    } else {
      break;
    }
  }
  return streak;
}
