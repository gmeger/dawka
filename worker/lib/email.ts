import type { Env } from "../env";
import type { Lang } from "./db";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(env: Env, args: SendArgs): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

const COPY = {
  pl: {
    magicSubjectLogin: "Twój link do logowania w Dawka",
    magicSubjectInvite: "Zaproszenie do wspólnego śledzenia dawek na Dawka",
    magicIntroLogin: "Kliknij poniżej, żeby zalogować się w Dawka:",
    magicIntroInvite:
      "Ktoś zaprasza Cię do wspólnego pilnowania codziennej dawki dla dziecka. Kliknij poniżej, żeby dołączyć:",
    magicCta: "Otwórz Dawka",
    magicAlt: "Albo skopiuj ten link:",
    magicExpires: "Link wygasa za 30 minut.",
    reminderSubject: "Przypomnienie: lek nie został odhaczony",
    reminderHeading: "Dawka — przypomnienie",
    reminderBody:
      "Mija godzina od pierwszego powiadomienia, a dzisiejsza dawka wciąż nie została odhaczona w aplikacji.",
    reminderCta: "Otwórz Dawka",
  },
  en: {
    magicSubjectLogin: "Your sign-in link for Dawka",
    magicSubjectInvite: "Invitation to share dose tracking on Dawka",
    magicIntroLogin: "Click below to sign in to Dawka:",
    magicIntroInvite:
      "Someone is inviting you to co-track a daily medication dose. Click below to join:",
    magicCta: "Open Dawka",
    magicAlt: "Or copy this link:",
    magicExpires: "The link expires in 30 minutes.",
    reminderSubject: "Reminder: dose not yet marked as given",
    reminderHeading: "Dawka — reminder",
    reminderBody:
      "It’s been an hour since the first notification and today’s dose has not been marked as given in the app.",
    reminderCta: "Open Dawka",
  },
} as const satisfies Record<Lang, Record<string, string>>;

function magicHtml(intro: string, ctaLabel: string, altLabel: string, expires: string, url: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin:0 0 16px">Dawka</h2>
<p>${intro}</p>
<p><a href="${url}" style="display:inline-block;background:#0a7;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${ctaLabel}</a></p>
<p style="color:#666;font-size:13px">${altLabel} ${url}</p>
<p style="color:#666;font-size:13px">${expires}</p>
</body></html>`;
}

export function magicLinkEmail(
  url: string,
  isInvite: boolean,
  lang: Lang,
): { subject: string; html: string; text: string } {
  const c = COPY[lang];
  const subject = isInvite ? c.magicSubjectInvite : c.magicSubjectLogin;
  const intro = isInvite ? c.magicIntroInvite : c.magicIntroLogin;
  const html = magicHtml(intro, c.magicCta, c.magicAlt, c.magicExpires, url);
  const text = `${intro}\n\n${url}\n\n${c.magicExpires}`;
  return { subject, html, text };
}

export function reminderEmail(lang: Lang): {
  subject: string;
  html: string;
  text: string;
} {
  const c = COPY[lang];
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin:0 0 16px">${c.reminderHeading}</h2>
<p>${c.reminderBody}</p>
<p><a href="https://dawka.org" style="display:inline-block;background:#0a7;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${c.reminderCta}</a></p>
</body></html>`;
  const text = `${c.reminderBody} https://dawka.org`;
  return { subject: c.reminderSubject, html, text };
}
