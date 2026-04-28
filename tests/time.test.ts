import { describe, expect, it } from "vitest";
import {
  addDays,
  formatLocalHHMM,
  hhmmToMinutes,
  isWithinWindow,
  localDateTimeToUnixMs,
  localNow,
} from "../worker/lib/time";

describe("hhmmToMinutes", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("08:30")).toBe(510);
    expect(hhmmToMinutes("23:59")).toBe(23 * 60 + 59);
  });
});

describe("isWithinWindow", () => {
  it("inclusive at both edges", () => {
    expect(isWithinWindow(hhmmToMinutes("08:00"), "08:00", "10:00")).toBe(true);
    expect(isWithinWindow(hhmmToMinutes("10:00"), "08:00", "10:00")).toBe(true);
    expect(isWithinWindow(hhmmToMinutes("09:15"), "08:00", "10:00")).toBe(true);
  });

  it("rejects outside window", () => {
    expect(isWithinWindow(hhmmToMinutes("07:59"), "08:00", "10:00")).toBe(false);
    expect(isWithinWindow(hhmmToMinutes("10:01"), "08:00", "10:00")).toBe(false);
    expect(isWithinWindow(hhmmToMinutes("00:00"), "08:00", "10:00")).toBe(false);
  });
});

describe("localNow", () => {
  it("converts UTC to Europe/Warsaw in winter (CET, +1)", () => {
    // 2026-01-15 07:30 UTC = 08:30 Warsaw
    const utc = new Date(Date.UTC(2026, 0, 15, 7, 30));
    const r = localNow(utc, "Europe/Warsaw");
    expect(r.date).toBe("2026-01-15");
    expect(r.time).toBe("08:30");
    expect(r.minutes).toBe(8 * 60 + 30);
  });

  it("converts UTC to Europe/Warsaw in summer (CEST, +2)", () => {
    // 2026-07-15 06:30 UTC = 08:30 Warsaw
    const utc = new Date(Date.UTC(2026, 6, 15, 6, 30));
    const r = localNow(utc, "Europe/Warsaw");
    expect(r.date).toBe("2026-07-15");
    expect(r.time).toBe("08:30");
  });

  it("rolls date correctly across midnight", () => {
    // 2026-03-14 23:30 UTC = 2026-03-15 00:30 Warsaw (winter, +1)
    const utc = new Date(Date.UTC(2026, 2, 14, 23, 30));
    const r = localNow(utc, "Europe/Warsaw");
    expect(r.date).toBe("2026-03-15");
    expect(r.time).toBe("00:30");
    expect(r.minutes).toBe(30);
  });

  it("handles midnight as 00:00 not 24:00", () => {
    // 2026-01-14 23:00 UTC = 2026-01-15 00:00 Warsaw
    const utc = new Date(Date.UTC(2026, 0, 14, 23, 0));
    const r = localNow(utc, "Europe/Warsaw");
    expect(r.time).toBe("00:00");
    expect(r.minutes).toBe(0);
  });
});

describe("localDateTimeToUnixMs", () => {
  it("inverts localNow in winter (CET, +1)", () => {
    // 08:00 Warsaw on 2026-01-15 = 07:00 UTC
    const ms = localDateTimeToUnixMs("2026-01-15", "08:00", "Europe/Warsaw");
    expect(ms).toBe(Date.UTC(2026, 0, 15, 7, 0));
  });

  it("inverts localNow in summer (CEST, +2)", () => {
    // 08:00 Warsaw on 2026-07-15 = 06:00 UTC
    const ms = localDateTimeToUnixMs("2026-07-15", "08:00", "Europe/Warsaw");
    expect(ms).toBe(Date.UTC(2026, 6, 15, 6, 0));
  });

  it("round-trips via localNow", () => {
    const ms = localDateTimeToUnixMs("2026-04-28", "14:30", "Europe/Warsaw");
    const back = localNow(new Date(ms), "Europe/Warsaw");
    expect(back.date).toBe("2026-04-28");
    expect(back.time).toBe("14:30");
  });

  it("handles UTC tz directly", () => {
    const ms = localDateTimeToUnixMs("2026-04-28", "08:00", "UTC");
    expect(ms).toBe(Date.UTC(2026, 3, 28, 8, 0));
  });
});

describe("addDays", () => {
  it("adds positive and negative days, including month/year crossings", () => {
    expect(addDays("2026-04-28", 1)).toBe("2026-04-29");
    expect(addDays("2026-04-28", -1)).toBe("2026-04-27");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("formatLocalHHMM", () => {
  it("formats UTC ms as HH:MM in target tz", () => {
    const ms = Date.UTC(2026, 3, 28, 6, 0); // 08:00 CEST
    expect(formatLocalHHMM(ms, "Europe/Warsaw")).toBe("08:00");
  });
});
