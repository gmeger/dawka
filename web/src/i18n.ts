import { createContext, createElement, useContext, useState, type ReactNode } from "react";

export type Lang = "pl" | "en";

const translations = {
  pl: {
    loading: "Ładowanie…",
    logout: "Wyloguj",
    "tab.today": "Dziś",
    "tab.history": "Historia",
    "tab.settings": "Ustawienia",
    "login.title": "Zaloguj się",
    "login.bootstrap.title": "Załóż konto",
    "login.subtitle": "Wpisz email — wyślemy link bez hasła.",
    "login.email.placeholder": "ty@example.com",
    "login.name.placeholder": "Imię (opcjonalnie)",
    "login.submit": "Wyślij link",
    "login.bootstrap.toggle": "Pierwszy raz tutaj",
    "login.account.toggle": "Mam już konto",
    "login.sent.title": "Sprawdź mail",
    "login.sent.body": "Jeśli to konto istnieje, wysłaliśmy link na {email}. Kliknij w niego, żeby się zalogować. Link wygasa za 30 minut.",
    "login.error": "Coś poszło nie tak. Spróbuj jeszcze raz.",
    "login.install_hint":
      "Po zalogowaniu — dodaj tę stronę do ekranu początkowego, żeby otrzymywać powiadomienia push.",
    "push.enable.title": "Włącz powiadomienia",
    "push.enable.body":
      "Bez tego nic nie przyleci. Na iPhonie najpierw dodaj stronę do ekranu początkowego.",
    "push.enable.button": "Włącz",
    "push.denied":
      "Powiadomienia zablokowane. Włącz je w ustawieniach systemowych telefonu.",
    "push.unsupported":
      "Ta przeglądarka nie wspiera powiadomień push. Email fallback wciąż działa.",
    "today.empty": "Na dziś brak zaplanowanych dawek.",
    "today.dose.taken.headline": "✓ Podane",
    "today.dose.pending.headline": "Do podania",
    "today.dose.taken.sub": "{time} • podał(a) {who}",
    "today.dose.pending.sub": "Zaplanowane na {time}",
    "today.dose.upcoming": "Otworzy się o {time}",
    "today.dose.missed": "Pominięte (okno minęło)",
    "today.taken.button": "Podane ✓",
    "today.untake.button": "Cofnij",
    "today.untake.error": "Cofnięcie może zrobić tylko osoba, która oznaczyła podanie.",
    "today.someone": "ktoś z domu",
    "slot.morning": "Rano",
    "slot.noon": "Południe",
    "slot.evening": "Wieczór",
    "history.streak.label": "Aktualna seria",
    "history.streak.singular": "dzień",
    "history.streak.plural": "dni",
    "history.last35.label": "Ostatnie 35 dni",
    "history.last35.value": "{taken} z {total}",
    "weekday.short": "Pn,Wt,Śr,Cz,Pt,Sb,Nd",
    "day.title": "Szczegóły dnia",
    "day.empty": "Brak zaplanowanych dawek.",
    "day.dose.taken": "Podane o {time} przez {who}",
    "day.dose.missed": "Pominięte (zaplanowane na {time})",
    "day.dose.future": "Zaplanowane na {time}",
    "day.close": "Zamknij",
    "settings.med.title": "Lek",
    "settings.med.name": "Nazwa",
    "settings.med.dose": "Dawka (np. „1 tabletka”)",
    "settings.med.schedule_type": "Tryb",
    "settings.med.slots": "Sloty (rano/południe/wieczór)",
    "settings.med.hours": "Co X godzin (antybiotyk)",
    "settings.med.pattern_slots": "Schemat",
    "settings.med.pattern_slots.help": "Format „1-0-0” — 1 = bierzemy, 0 = pomijamy.",
    "settings.med.morning_at": "Rano o",
    "settings.med.noon_at": "Południe o",
    "settings.med.evening_at": "Wieczór o",
    "settings.med.hours_interval": "Co ile godzin",
    "settings.med.hours_anchor": "Pierwsza dawka",
    "settings.med.hours_until": "Koniec kuracji (opcjonalnie)",
    "settings.save": "Zapisz",
    "settings.saved": "Zapisane.",
    "settings.members.title": "Domownicy",
    "settings.members.you": "to ty",
    "settings.invite.placeholder": "email partnera",
    "settings.invite.submit": "Zaproś",
    "settings.invite.sent": "Zaproszenie wysłane na {email}.",
    "settings.lang.title": "Język",
  },
  en: {
    loading: "Loading…",
    logout: "Sign out",
    "tab.today": "Today",
    "tab.history": "History",
    "tab.settings": "Settings",
    "login.title": "Sign in",
    "login.bootstrap.title": "Create account",
    "login.subtitle": "Enter your email — we’ll send a passwordless link.",
    "login.email.placeholder": "you@example.com",
    "login.name.placeholder": "Name (optional)",
    "login.submit": "Send link",
    "login.bootstrap.toggle": "First time here",
    "login.account.toggle": "I already have an account",
    "login.sent.title": "Check your email",
    "login.sent.body": "If the account exists we sent a sign-in link to {email}. Click it to log in. The link expires in 30 minutes.",
    "login.error": "Something went wrong. Try again.",
    "login.install_hint":
      "After signing in, add this page to your home screen to receive push notifications.",
    "push.enable.title": "Enable notifications",
    "push.enable.body":
      "Without this nothing will arrive. On iPhone, add the page to your home screen first.",
    "push.enable.button": "Enable",
    "push.denied":
      "Notifications are blocked. Enable them in your phone’s system settings.",
    "push.unsupported":
      "This browser doesn’t support push notifications. Email fallback still works.",
    "today.empty": "No doses scheduled for today.",
    "today.dose.taken.headline": "✓ Given",
    "today.dose.pending.headline": "Pending",
    "today.dose.taken.sub": "{time} • given by {who}",
    "today.dose.pending.sub": "Scheduled for {time}",
    "today.dose.upcoming": "Opens at {time}",
    "today.dose.missed": "Missed (window closed)",
    "today.taken.button": "Mark as given ✓",
    "today.untake.button": "Undo",
    "today.untake.error": "Only the person who marked the dose can undo it.",
    "today.someone": "someone in the household",
    "slot.morning": "Morning",
    "slot.noon": "Noon",
    "slot.evening": "Evening",
    "history.streak.label": "Current streak",
    "history.streak.singular": "day",
    "history.streak.plural": "days",
    "history.last35.label": "Last 35 days",
    "history.last35.value": "{taken} of {total}",
    "weekday.short": "Mo,Tu,We,Th,Fr,Sa,Su",
    "day.title": "Day detail",
    "day.empty": "No scheduled doses.",
    "day.dose.taken": "Given at {time} by {who}",
    "day.dose.missed": "Missed (scheduled for {time})",
    "day.dose.future": "Scheduled for {time}",
    "day.close": "Close",
    "settings.med.title": "Medication",
    "settings.med.name": "Name",
    "settings.med.dose": "Dose (e.g. “1 tablet”)",
    "settings.med.schedule_type": "Schedule type",
    "settings.med.slots": "Slots (morning/noon/evening)",
    "settings.med.hours": "Every X hours (antibiotic)",
    "settings.med.pattern_slots": "Pattern",
    "settings.med.pattern_slots.help": "Format “1-0-0” — 1 = take, 0 = skip.",
    "settings.med.morning_at": "Morning at",
    "settings.med.noon_at": "Noon at",
    "settings.med.evening_at": "Evening at",
    "settings.med.hours_interval": "Every N hours",
    "settings.med.hours_anchor": "First dose",
    "settings.med.hours_until": "Course end (optional)",
    "settings.save": "Save",
    "settings.saved": "Saved.",
    "settings.members.title": "Household",
    "settings.members.you": "you",
    "settings.invite.placeholder": "partner’s email",
    "settings.invite.submit": "Invite",
    "settings.invite.sent": "Invite sent to {email}.",
    "settings.lang.title": "Language",
  },
} satisfies Record<Lang, Record<string, string>>;

export type TKey = keyof (typeof translations)["pl"];

function detectInitialLang(): Lang {
  const stored = localStorage.getItem("dawka.lang");
  if (stored === "pl" || stored === "en") return stored;
  return navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en";
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] === undefined ? `{${k}}` : String(vars[k]),
  );
}

type I18nValue = {
  lang: Lang;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("dawka.lang", l);
    document.documentElement.lang = l;
    fetch("/api/me/lang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ lang: l }),
    }).catch(() => {});
  };

  const t: I18nValue["t"] = (key, vars) =>
    interpolate(translations[lang][key] ?? translations.en[key] ?? key, vars);

  return createElement(
    I18nContext.Provider,
    { value: { lang, t, setLang } },
    children,
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside provider");
  return ctx;
}
