// Pure tz helpers. Cron runs in UTC; local windows are computed via Intl.DateTimeFormat.
// hourCycle:'h23' avoids the '24:00' edge case some engines emit.

export type LocalNow = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  minutes: number; // minutes since 00:00 in local tz
};

type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function partsInTz(date: Date, tz: string): WallParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

export function localNow(now: Date, tz: string): LocalNow {
  const p = partsInTz(now, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    minutes: p.hour * 60 + p.minute,
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

// Convert a wall-clock moment in `tz` (e.g. 2026-04-28 08:00 Europe/Warsaw)
// to unix milliseconds. Iterates up to 3x to settle DST transitions.
export function localDateTimeToUnixMs(
  date: string,
  time: string,
  tz: string,
): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mn] = time.split(":").map(Number);
  if (!y || !mo || !d || h === undefined || mn === undefined) {
    throw new Error(`Invalid date/time: ${date} ${time}`);
  }

  const targetUtc = Date.UTC(y, mo - 1, d, h, mn);
  let utcMs = targetUtc;

  for (let i = 0; i < 3; i++) {
    const view = partsInTz(new Date(utcMs), tz);
    const viewUtc = Date.UTC(
      view.year,
      view.month - 1,
      view.day,
      view.hour,
      view.minute,
    );
    const error = viewUtc - targetUtc;
    if (error === 0) return utcMs;
    utcMs -= error;
  }
  return utcMs;
}

// YYYY-MM-DD addition by N days (positive or negative). Pure string math.
export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (mo ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// HH:MM in `tz` for a unix-ms instant.
export function formatLocalHHMM(unixMs: number, tz: string): string {
  const p = partsInTz(new Date(unixMs), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
