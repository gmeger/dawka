import { useEffect, useMemo, useState } from "react";
import { api, type Dose, type Me, type Medication } from "./api";
import { useI18n, type Lang, type TKey } from "./i18n";
import { getPushState, subscribePush, type PushState } from "./push";

type View = "today" | "history" | "settings";

const ALERT_WINDOW_MS = 3 * 60 * 60 * 1000;

export function App() {
  const [me, setMe] = useState<Me | { user: null } | null>(null);
  const [view, setView] = useState<View>("today");
  const { t, lang, setLang } = useI18n();

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe({ user: null }));
  }, []);

  useEffect(() => {
    if (me && "user" in me && me.user && me.user.lang !== lang) setLang(lang);
  }, [me, lang, setLang]);

  if (!me) return <div className="card">{t("loading")}</div>;
  if (me.user === null) return <Login />;

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

      {view === "today" && <Today me={me} onChange={refresh} />}
      {view === "history" && <History me={me} />}
      {view === "settings" && <Settings me={me} onSaved={refresh} />}
    </>
  );
}

// --- Login -------------------------------------------------------------------

function Login() {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      if (bootstrapMode) await api.bootstrap(email, name || undefined, lang);
      else await api.requestLogin(email, lang);
      setSent(true);
    } catch {
      setError(t("login.error"));
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

// --- Today -------------------------------------------------------------------

function Today({ me, onChange }: { me: Me; onChange: () => void }) {
  const { t } = useI18n();
  const [pushState, setPushState] = useState<PushState | null>(null);

  useEffect(() => {
    getPushState().then(setPushState);
  }, []);

  const enablePush = async () => {
    await subscribePush(me.vapidPublicKey).catch(() => {});
    setPushState(await getPushState());
  };

  const now = Date.now();
  const doses = [...me.today.doses].sort((a, b) => a.scheduled_at - b.scheduled_at);

  return (
    <>
      {pushState?.kind === "default" && (
        <div className="banner">
          <strong>{t("push.enable.title")}</strong>
          <p style={{ margin: "4px 0 8px" }}>{t("push.enable.body")}</p>
          <button className="btn-ghost" onClick={enablePush} style={{ padding: 0 }}>
            {t("push.enable.button")}
          </button>
        </div>
      )}
      {pushState?.kind === "denied" && <div className="banner">{t("push.denied")}</div>}
      {pushState?.kind === "unsupported" && <div className="banner">{t("push.unsupported")}</div>}

      {doses.length === 0 ? (
        <div className="card dose-state">
          <p className="sub">{t("today.empty")}</p>
        </div>
      ) : (
        doses.map((dose) => (
          <DoseCard key={dose.id} me={me} dose={dose} now={now} onChange={onChange} />
        ))
      )}
    </>
  );
}

type DoseStatus = "taken" | "in_window" | "upcoming" | "missed";

function doseStatus(dose: Dose, now: number): DoseStatus {
  if (dose.taken_at !== null) return "taken";
  if (now < dose.scheduled_at) return "upcoming";
  if (now <= dose.scheduled_at + ALERT_WINDOW_MS) return "in_window";
  return "missed";
}

function DoseCard({
  me,
  dose,
  now,
  onChange,
}: {
  me: Me;
  dose: Dose;
  now: number;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = doseStatus(dose, now);
  const slotLabel = formatSlotLabel(dose.scheduled_label, t);
  const scheduledTime = formatTime(dose.scheduled_at);
  const takenBy =
    dose.taken_at !== null
      ? me.members.find((m) => m.id === dose.taken_by_user_id)
      : null;
  const whoLabel = takenBy?.name ?? takenBy?.email ?? t("today.someone");
  const canUntake = dose.taken_at !== null && dose.taken_by_user_id === me.user.id;

  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.takeDose(dose.id);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const untake = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.untakeDose(dose.id);
      onChange();
    } catch {
      setError(t("today.untake.error"));
    } finally {
      setBusy(false);
    }
  };

  let headline: string;
  let sub: string;
  if (status === "taken") {
    headline = t("today.dose.taken.headline");
    sub = t("today.dose.taken.sub", { time: formatTime(dose.taken_at!), who: whoLabel });
  } else if (status === "missed") {
    headline = t("today.dose.pending.headline");
    sub = t("today.dose.missed");
  } else if (status === "upcoming") {
    headline = t("today.dose.pending.headline");
    sub = t("today.dose.upcoming", { time: scheduledTime });
  } else {
    headline = t("today.dose.pending.headline");
    sub = t("today.dose.pending.sub", { time: scheduledTime });
  }

  return (
    <div className="card dose-state">
      <div className="status">{slotLabel} • {scheduledTime}</div>
      <h2 className="headline">{headline}</h2>
      <p className="sub">{sub}</p>
      {(status === "in_window" || status === "missed" || status === "upcoming") && (
        <button
          className="btn-primary"
          onClick={take}
          disabled={busy || status === "upcoming"}
        >
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
      {error && <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 12 }}>{error}</p>}
    </div>
  );
}

// --- History -----------------------------------------------------------------

type DayBucket = {
  date: string;
  doses: Dose[];
  status: "all_taken" | "partial" | "missed" | "in_progress" | "empty";
};

function bucketByDay(doses: Dose[], tz: string): Map<string, Dose[]> {
  const m = new Map<string, Dose[]>();
  for (const d of doses) {
    const date = formatLocalDate(d.scheduled_at, tz);
    const bucket = m.get(date) ?? [];
    bucket.push(d);
    m.set(date, bucket);
  }
  return m;
}

function bucketStatus(doses: Dose[], now: number): DayBucket["status"] {
  if (doses.length === 0) return "empty";
  let takenCount = 0;
  let missedCount = 0;
  let pendingOrFutureCount = 0;
  for (const d of doses) {
    const s = doseStatus(d, now);
    if (s === "taken") takenCount++;
    else if (s === "missed") missedCount++;
    else pendingOrFutureCount++;
  }
  if (takenCount === doses.length) return "all_taken";
  if (missedCount === doses.length) return "missed";
  if (pendingOrFutureCount > 0 && missedCount === 0 && takenCount === 0) return "in_progress";
  return "partial";
}

function History({ me }: { me: Me }) {
  const { t } = useI18n();
  const [doses, setDoses] = useState<Dose[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    api.history(35).then((r) => setDoses(r.doses));
  }, []);

  if (!doses) return <div className="card">{t("loading")}</div>;

  const now = Date.now();
  const byDay = bucketByDay(doses, me.household.tz);

  // Build 5x7 grid ending today.
  const today = me.today.date;
  const cells: DayBucket[] = [];
  for (let i = 34; i >= 0; i--) {
    const date = addDaysIso(today, -i);
    const dayDoses = byDay.get(date) ?? [];
    cells.push({ date, doses: dayDoses, status: bucketStatus(dayDoses, now) });
  }

  const streak = computeStreak(cells);
  const streakUnit = streak === 1 ? t("history.streak.singular") : t("history.streak.plural");

  const takenDays = cells.filter((c) => c.status === "all_taken").length;

  return (
    <>
      <div className="card">
        <div className="row">
          <span className="label">{t("history.streak.label")}</span>
          <strong>{streak} {streakUnit}</strong>
        </div>
        <div className="row">
          <span className="label">{t("history.last35.label")}</span>
          <strong>{t("history.last35.value", { taken: takenDays, total: cells.length })}</strong>
        </div>
      </div>
      <div className="card">
        <div className="history-grid">
          {cells.map((c) => (
            <button
              key={c.date}
              className={`history-cell history-cell-${c.status}`}
              title={c.date}
              onClick={() => setSelectedDate(c.date)}
            >
              {Number(c.date.slice(8))}
            </button>
          ))}
        </div>
      </div>

      {selectedDate && (
        <DayDetailModal
          date={selectedDate}
          me={me}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </>
  );
}

function DayDetailModal({
  date,
  me,
  onClose,
}: {
  date: string;
  me: Me;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [doses, setDoses] = useState<Dose[] | null>(null);

  useEffect(() => {
    api.day(date).then((r) => setDoses(r.doses));
  }, [date]);

  const now = Date.now();
  const sorted = doses ? [...doses].sort((a, b) => a.scheduled_at - b.scheduled_at) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t("day.title")} — {date}</h3>
          <button className="btn-ghost" onClick={onClose}>{t("day.close")}</button>
        </div>
        {!sorted ? (
          <p>{t("loading")}</p>
        ) : sorted.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>{t("day.empty")}</p>
        ) : (
          <ul className="day-list">
            {sorted.map((d) => (
              <li key={d.id}>
                <DayDoseLine me={me} dose={d} now={now} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DayDoseLine({ me, dose, now }: { me: Me; dose: Dose; now: number }) {
  const { t } = useI18n();
  const status = doseStatus(dose, now);
  const slotLabel = formatSlotLabel(dose.scheduled_label, t);
  const scheduledTime = formatTime(dose.scheduled_at);
  const takenBy =
    dose.taken_at !== null
      ? me.members.find((m) => m.id === dose.taken_by_user_id)
      : null;
  const whoLabel = takenBy?.name ?? takenBy?.email ?? t("today.someone");

  let line: string;
  if (status === "taken") {
    line = t("day.dose.taken", { time: formatTime(dose.taken_at!), who: whoLabel });
  } else if (status === "missed") {
    line = t("day.dose.missed", { time: scheduledTime });
  } else {
    line = t("day.dose.future", { time: scheduledTime });
  }

  return (
    <div className={`day-dose status-${status}`}>
      <div className="day-dose-head">
        {slotLabel} <span className="label">• {scheduledTime}</span>
      </div>
      <div className="day-dose-line">{line}</div>
    </div>
  );
}

// --- Settings ----------------------------------------------------------------

function Settings({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const { t } = useI18n();

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("settings.lang.title")}</h3>
        <LangSwitcher />
      </div>

      <MedicationForm med={me.medication} onSaved={onSaved} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("settings.members.title")}</h3>
        {me.members.map((m) => (
          <div key={m.id} className="row">
            <span>{m.name ?? m.email}</span>
            {m.id === me.user.id && <span className="label">{t("settings.members.you")}</span>}
          </div>
        ))}
        <Invite />
      </div>
    </>
  );
}

function MedicationForm({ med, onSaved }: { med: Medication; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(med.name);
  const [dose, setDose] = useState(med.dose);
  const [scheduleType, setScheduleType] = useState(med.schedule_type);
  const [pattern, setPattern] = useState(med.schedule_pattern);
  const [morningAt, setMorningAt] = useState(med.morning_at);
  const [noonAt, setNoonAt] = useState(med.noon_at);
  const [eveningAt, setEveningAt] = useState(med.evening_at);
  const [hoursAnchor, setHoursAnchor] = useState(
    med.hours_anchor ? unixMsToDatetimeLocal(med.hours_anchor) : "",
  );
  const [hoursUntil, setHoursUntil] = useState(
    med.hours_until ? unixMsToDatetimeLocal(med.hours_until) : "",
  );
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  // When user toggles slots/hours, set a sensible default pattern.
  const switchType = (t: typeof scheduleType) => {
    setScheduleType(t);
    if (t === "slots" && !/^[01]-[01]-[01]$/.test(pattern)) setPattern("1-0-0");
    if (t === "hours" && !/^\d+$/.test(pattern)) setPattern("8");
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.updateMedication({
        name,
        dose,
        schedule_type: scheduleType,
        schedule_pattern: pattern,
        morning_at: morningAt,
        noon_at: noonAt,
        evening_at: eveningAt,
        hours_anchor:
          scheduleType === "hours" && hoursAnchor ? new Date(hoursAnchor).getTime() : null,
        hours_until:
          scheduleType === "hours" && hoursUntil ? new Date(hoursUntil).getTime() : null,
      });
      setSavedTick(true);
      onSaved();
      setTimeout(() => setSavedTick(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("settings.med.title")}</h3>

      <div className="row">
        <span className="label">{t("settings.med.name")}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      <div className="row">
        <span className="label">{t("settings.med.dose")}</span>
        <input className="input" value={dose} onChange={(e) => setDose(e.target.value)} style={{ maxWidth: 220 }} />
      </div>

      <div className="row">
        <span className="label">{t("settings.med.schedule_type")}</span>
        <div className="tabs" style={{ maxWidth: 240 }}>
          <button aria-selected={scheduleType === "slots"} onClick={() => switchType("slots")}>
            {t("settings.med.slots")}
          </button>
          <button aria-selected={scheduleType === "hours"} onClick={() => switchType("hours")}>
            {t("settings.med.hours")}
          </button>
        </div>
      </div>

      {scheduleType === "slots" ? (
        <>
          <div className="row">
            <span className="label">
              {t("settings.med.pattern_slots")}
              <br />
              <small style={{ color: "var(--muted)" }}>{t("settings.med.pattern_slots.help")}</small>
            </span>
            <input
              className="input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              style={{ maxWidth: 100, fontFamily: "monospace" }}
              placeholder="1-0-0"
            />
          </div>
          <div className="row">
            <span className="label">{t("settings.med.morning_at")}</span>
            <input className="input" type="time" value={morningAt} onChange={(e) => setMorningAt(e.target.value)} style={{ maxWidth: 120 }} />
          </div>
          <div className="row">
            <span className="label">{t("settings.med.noon_at")}</span>
            <input className="input" type="time" value={noonAt} onChange={(e) => setNoonAt(e.target.value)} style={{ maxWidth: 120 }} />
          </div>
          <div className="row">
            <span className="label">{t("settings.med.evening_at")}</span>
            <input className="input" type="time" value={eveningAt} onChange={(e) => setEveningAt(e.target.value)} style={{ maxWidth: 120 }} />
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <span className="label">{t("settings.med.hours_interval")}</span>
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              style={{ maxWidth: 100 }}
            />
          </div>
          <div className="row">
            <span className="label">{t("settings.med.hours_anchor")}</span>
            <input
              className="input"
              type="datetime-local"
              value={hoursAnchor}
              onChange={(e) => setHoursAnchor(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          </div>
          <div className="row">
            <span className="label">{t("settings.med.hours_until")}</span>
            <input
              className="input"
              type="datetime-local"
              value={hoursUntil}
              onChange={(e) => setHoursUntil(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          </div>
        </>
      )}

      <button className="btn-primary" onClick={save} disabled={busy} style={{ marginTop: 12 }}>
        {t("settings.save")}
      </button>
      {savedTick && <p style={{ color: "var(--accent)", fontSize: 14, marginTop: 8 }}>{t("settings.saved")}</p>}
    </div>
  );
}

function Invite() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (sent) {
    return <p style={{ color: "var(--muted)" }}>{t("settings.invite.sent", { email })}</p>;
  }

  return (
    <>
      <input
        className="input"
        type="email"
        placeholder={t("settings.invite.placeholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ marginTop: 12 }}
      />
      <button
        className="btn-primary"
        onClick={async () => {
          setBusy(true);
          await api.invite(email);
          setSent(true);
          setBusy(false);
        }}
        disabled={busy || !email.includes("@")}
        style={{ marginTop: 12 }}
      >
        {t("settings.invite.submit")}
      </button>
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
        <button key={l.code} aria-selected={lang === l.code} onClick={() => setLang(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

// --- Helpers -----------------------------------------------------------------

function formatTime(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalDate(unixMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(unixMs);
}

function formatSlotLabel(label: string, t: (k: TKey) => string): string {
  if (label === "morning") return t("slot.morning");
  if (label === "noon") return t("slot.noon");
  if (label === "evening") return t("slot.evening");
  return label; // already HH:MM
}

function unixMsToDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDaysIso(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (mo ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function computeStreak(cells: DayBucket[]): number {
  // cells are oldest → newest, today is last
  let streak = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i]!.status === "all_taken") streak++;
    else break;
  }
  return streak;
}
