import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { useI18n, type Lang } from "./i18n";
import { getPushState, subscribePush, type PushState } from "./push";

type View = "today" | "history" | "settings";

export function App() {
  const [me, setMe] = useState<Me | { user: null } | null>(null);
  const [view, setView] = useState<View>("today");
  const { t, lang, setLang } = useI18n();

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe({ user: null }));
  }, []);

  // Sync language to user record once authenticated, if it differs.
  useEffect(() => {
    if (me && "user" in me && me.user && me.user.lang !== lang) {
      setLang(lang);
    }
  }, [me, lang, setLang]);

  if (!me) return <div className="card">{t("loading")}</div>;
  if (me.user === null) return <Login onDone={() => api.me().then(setMe)} />;

  const refresh = () => api.me().then(setMe);

  return (
    <>
      <header>
        <h1>Dawka</h1>
        <button className="btn-ghost" onClick={() => api.logout().then(refresh)}>
          {t("logout")}
        </button>
      </header>

      <nav className="tabs">
        <button aria-selected={view === "today"} onClick={() => setView("today")}>
          {t("tab.today")}
        </button>
        <button aria-selected={view === "history"} onClick={() => setView("history")}>
          {t("tab.history")}
        </button>
        <button aria-selected={view === "settings"} onClick={() => setView("settings")}>
          {t("tab.settings")}
        </button>
      </nav>

      {view === "today" && <Today me={me} onTake={refresh} />}
      {view === "history" && <History />}
      {view === "settings" && <Settings me={me} onSaved={refresh} />}
    </>
  );
}

function Login({ onDone: _onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      if (bootstrapMode) {
        await api.bootstrap(email, name || undefined, lang);
      } else {
        await api.requestLogin(email, lang);
      }
      setSent(true);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes("404") ? t("login.no_account") : t("login.error"));
    }
  };

  if (sent) {
    return (
      <div className="card">
        <h2>{t("login.sent.title")}</h2>
        <p>{t("login.sent.body", { email })}</p>
      </div>
    );
  }

  return (
    <>
      <header>
        <h1>Dawka</h1>
        <LangSwitcher />
      </header>
      <div className="card">
        <h2>{bootstrapMode ? t("login.bootstrap.title") : t("login.title")}</h2>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>{t("login.subtitle")}</p>
        <input
          className="input"
          type="email"
          placeholder={t("login.email.placeholder")}
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
            placeholder={t("login.name.placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        )}
        <button className="btn-primary" onClick={submit} disabled={!email.includes("@")}>
          {t("login.submit")}
        </button>
        {error && <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 12 }}>{error}</p>}
        <button
          className="btn-ghost"
          onClick={() => setBootstrapMode((b) => !b)}
          style={{ marginTop: 16, width: "100%" }}
        >
          {bootstrapMode ? t("login.account.toggle") : t("login.bootstrap.toggle")}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
        {t("login.install_hint")}
      </p>
    </>
  );
}

function Today({ me, onTake }: { me: Me; onTake: () => void }) {
  const { t } = useI18n();
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setPushState);
  }, []);

  const taken = me.today.dose.taken_at !== null;
  const takenBy = taken
    ? me.members.find((m) => m.id === me.today.dose.taken_by_user_id)
    : null;
  const whoLabel = takenBy?.name ?? takenBy?.email ?? t("today.someone");
  const canUntake = taken && me.today.dose.taken_by_user_id === me.user.id;

  const enablePush = async () => {
    setBusy(true);
    await subscribePush(me.vapidPublicKey).catch(() => {});
    setPushState(await getPushState());
    setBusy(false);
  };

  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.takeDose();
      onTake();
    } finally {
      setBusy(false);
    }
  };

  const untake = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.untakeDose();
      onTake();
    } catch {
      setError(t("today.untake.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {pushState?.kind === "default" && (
        <div className="banner">
          <strong>{t("push.enable.title")}</strong>
          <p style={{ margin: "4px 0 8px" }}>{t("push.enable.body")}</p>
          <button className="btn-ghost" onClick={enablePush} disabled={busy} style={{ padding: 0 }}>
            {t("push.enable.button")}
          </button>
        </div>
      )}
      {pushState?.kind === "denied" && <div className="banner">{t("push.denied")}</div>}
      {pushState?.kind === "unsupported" && (
        <div className="banner">{t("push.unsupported")}</div>
      )}

      <div className="card dose-state">
        <div className="status">
          {taken ? t("today.taken.status") : t("today.pending.status")}
        </div>
        <h2 className="headline">
          {taken ? t("today.taken.headline") : t("today.pending.headline")}
        </h2>
        <p className="sub">
          {taken
            ? t("today.taken.sub", {
                time: formatTime(me.today.dose.taken_at!),
                who: whoLabel,
              })
            : t("today.pending.sub", {
                from: me.household.remind_from,
                until: me.household.remind_until,
              })}
        </p>
        {!taken && (
          <button className="btn-primary" onClick={take} disabled={busy}>
            {t("today.taken.button")}
          </button>
        )}
        {canUntake && (
          <button
            className="btn-ghost"
            onClick={untake}
            disabled={busy}
            style={{ marginTop: 8 }}
          >
            {t("today.untake.button")}
          </button>
        )}
        {error && (
          <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 12 }}>{error}</p>
        )}
      </div>
    </>
  );
}

function History() {
  const { t } = useI18n();
  const [doses, setDoses] = useState<{ date: string; taken_at: number | null }[] | null>(null);

  useEffect(() => {
    api.history(35).then((r) => setDoses(r.doses));
  }, []);

  if (!doses) return <div className="card">{t("loading")}</div>;

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
  const streakUnit =
    streak === 1 ? t("history.streak.singular") : t("history.streak.plural");

  return (
    <>
      <div className="card">
        <div className="row">
          <span className="label">{t("history.streak.label")}</span>
          <strong>{streak} {streakUnit}</strong>
        </div>
        <div className="row">
          <span className="label">{t("history.last35.label")}</span>
          <strong>
            {t("history.last35.value", {
              taken: cells.filter((c) => c.state === "taken").length,
              total: cells.length,
            })}
          </strong>
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
  const { t } = useI18n();
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
        <h3 style={{ marginTop: 0 }}>{t("settings.lang.title")}</h3>
        <LangSwitcher />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("settings.window.title")}</h3>
        <div className="row">
          <span className="label">{t("settings.window.from")}</span>
          <input
            className="input"
            type="time"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ maxWidth: 120 }}
          />
        </div>
        <div className="row">
          <span className="label">{t("settings.window.until")}</span>
          <input
            className="input"
            type="time"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            style={{ maxWidth: 120 }}
          />
        </div>
        <button className="btn-primary" onClick={save} disabled={busy} style={{ marginTop: 12 }}>
          {t("settings.save")}
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("settings.members.title")}</h3>
        {me.members.map((m) => (
          <div key={m.id} className="row">
            <span>{m.name ?? m.email}</span>
            {m.id === me.user.id && <span className="label">{t("settings.members.you")}</span>}
          </div>
        ))}
        {!inviteSent ? (
          <>
            <input
              className="input"
              type="email"
              placeholder={t("settings.invite.placeholder")}
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
              {t("settings.invite.submit")}
            </button>
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>
            {t("settings.invite.sent", { email: inviteEmail })}
          </p>
        )}
      </div>
    </>
  );
}

function LangSwitcher() {
  const { lang, setLang } = useI18n();
  const langs: { code: Lang; label: string }[] = [
    { code: "pl", label: "Polski" },
    { code: "en", label: "English" },
  ];
  return (
    <div className="tabs" style={{ maxWidth: 240 }}>
      {langs.map((l) => (
        <button
          key={l.code}
          aria-selected={lang === l.code}
          onClick={() => setLang(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function formatTime(unixMs: number): string {
  const d = new Date(unixMs);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function computeStreak(doses: { date: string; taken_at: number | null }[]): number {
  const sorted = [...doses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const today = new Date().toISOString().slice(0, 10);
  let cursor = today;
  let streak = 0;
  for (const d of sorted) {
    if (d.date !== cursor) {
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
