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
    "login.sent.body": "Wysłaliśmy link na {email}. Kliknij w niego, żeby się zalogować. Link wygasa za 30 minut.",
    "login.no_account":
      "Nie znaleziono konta dla tego maila. Jeśli jesteś pierwszym użytkownikiem, użyj „Pierwszy raz tutaj”.",
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
    "today.taken.status": "Dziś — zrobione",
    "today.pending.status": "Dziś — do zrobienia",
    "today.taken.headline": "✓ Lek podany",
    "today.pending.headline": "Lek do podania",
    "today.taken.sub": "O {time} przez {who}",
    "today.pending.sub": "Okno przypomnień: {from}–{until}",
    "today.taken.button": "Podane ✓",
    "today.someone": "kogoś z domu",
    "history.streak.label": "Aktualna seria",
    "history.streak.singular": "dzień",
    "history.streak.plural": "dni",
    "history.last35.label": "Ostatnie 35 dni",
    "history.last35.value": "{taken} z {total}",
    "settings.window.title": "Okno przypomnień",
    "settings.window.from": "Od",
    "settings.window.until": "Do",
    "settings.save": "Zapisz",
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
    "login.sent.body":
      "We sent a sign-in link to {email}. Click it to log in. The link expires in 30 minutes.",
    "login.no_account":
      "No account for this email. If you’re the first user, use “First time here”.",
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
    "today.taken.status": "Today — done",
    "today.pending.status": "Today — pending",
    "today.taken.headline": "✓ Dose given",
    "today.pending.headline": "Dose pending",
    "today.taken.sub": "At {time} by {who}",
    "today.pending.sub": "Reminder window: {from}–{until}",
    "today.taken.button": "Mark as given ✓",
    "today.someone": "someone in the household",
    "history.streak.label": "Current streak",
    "history.streak.singular": "day",
    "history.streak.plural": "days",
    "history.last35.label": "Last 35 days",
    "history.last35.value": "{taken} of {total}",
    "settings.window.title": "Reminder window",
    "settings.window.from": "From",
    "settings.window.until": "Until",
    "settings.save": "Save",
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
    // best-effort backend sync; ignore errors (user might be unauthenticated)
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
