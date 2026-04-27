import type { Env } from "../env";

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

export function magicLinkEmail(url: string, isInvite: boolean): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = isInvite
    ? "Zaproszenie do wspólnego śledzenia dawek na Dawka"
    : "Twój link do logowania w Dawka";

  const intro = isInvite
    ? "Ktoś zaprasza Cię do wspólnego pilnowania codziennej dawki dla dziecka. Kliknij poniżej, żeby dołączyć:"
    : "Kliknij poniżej, żeby zalogować się w Dawka:";

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin:0 0 16px">Dawka</h2>
<p>${intro}</p>
<p><a href="${url}" style="display:inline-block;background:#0a7;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Otwórz Dawka</a></p>
<p style="color:#666;font-size:13px">Albo skopiuj ten link: ${url}</p>
<p style="color:#666;font-size:13px">Link wygasa za 30 minut.</p>
</body></html>`;

  const text = `${intro}\n\n${url}\n\nLink wygasa za 30 minut.`;
  return { subject, html, text };
}

export function reminderEmail(): { subject: string; html: string; text: string } {
  const subject = "Przypomnienie: lek nie został odhaczony";
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
<h2 style="margin:0 0 16px">Dawka — przypomnienie</h2>
<p>Mija godzina od pierwszego powiadomienia, a dzisiejsza dawka wciąż nie została odhaczona w aplikacji.</p>
<p><a href="https://dawka.org" style="display:inline-block;background:#0a7;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Otwórz Dawka</a></p>
</body></html>`;
  const text = "Mija godzina od pierwszego powiadomienia, a dzisiejsza dawka wciąż nie została odhaczona. https://dawka.org";
  return { subject, html, text };
}
