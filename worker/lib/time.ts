// Pure tz helpers. Cron runs in UTC, but household windows are expressed in local time.
// Using Intl.DateTimeFormat with hourCycle:'h23' to avoid the '24:00' edge case some engines emit.

export type LocalNow = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  minutes: number; // minutes since 00:00 in local tz
};

export function localNow(now: Date, tz: string): LocalNow {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const time = `${parts.hour}:${parts.minute}`;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isWithinWindow(
  nowMinutes: number,
  fromHHMM: string,
  untilHHMM: string,
): boolean {
  const from = hhmmToMinutes(fromHHMM);
  const until = hhmmToMinutes(untilHHMM);
  return nowMinutes >= from && nowMinutes <= until;
}
