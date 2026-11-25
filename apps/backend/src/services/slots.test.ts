import { generateSlots } from "./slots.js";
import { localDate, zonedToUtc } from "../utils/time.js";

const base = { breaks: [], busy: [], buffer: 0, step: 15, earliest: 0 };
const hm = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

describe("generateSlots", () => {
  it("fills a shift on the step grid, last slot must end by shift end", () => {
    const s = generateSlots({ ...base, windows: [{ start: 570, end: 660 }], duration: 30 }).map(hm);
    expect(s).toEqual(["09:30", "09:45", "10:00", "10:15", "10:30"]);
  });

  it("supports multiple shifts and skips breaks", () => {
    const s = generateSlots({ ...base, windows: [{ start: 540, end: 600 }, { start: 1020, end: 1050 }], breaks: [{ start: 555, end: 570 }], duration: 15 }).map(hm);
    expect(s).toEqual(["09:00", "09:30", "09:45", "17:00", "17:15"]);
  });

  it("excludes overlaps with booked appointments and enforces buffer on both sides", () => {
    const s = generateSlots({ ...base, windows: [{ start: 540, end: 720 }], busy: [{ start: 600, end: 630 }], buffer: 10, duration: 30 }).map(hm);
    // 09:30 ends 10:00, +10 buffer collides with 10:00 booking; 10:30 is within 10 min after booking end.
    expect(s).not.toContain("09:30");
    expect(s).toContain("09:15");
    expect(s).not.toContain("10:30");
    expect(s).toContain("10:45");
  });

  it("respects earliest start (minimum notice) on the step grid", () => {
    const s = generateSlots({ ...base, windows: [{ start: 540, end: 660 }], duration: 30, earliest: 601 }).map(hm);
    expect(s[0]).toBe("10:15");
  });

  it("returns nothing when the treatment is longer than every window", () => {
    expect(generateSlots({ ...base, windows: [{ start: 540, end: 600 }], duration: 90 })).toEqual([]);
  });
});

describe("timezone helpers", () => {
  it("converts Asia/Kolkata wall time to UTC", () => {
    expect(zonedToUtc("2026-11-25", 9 * 60 + 30, "Asia/Kolkata").toISOString()).toBe("2026-11-25T04:00:00.000Z");
  });
  it("handles DST zones", () => {
    // New York is UTC-4 in July, UTC-5 in December.
    expect(zonedToUtc("2026-07-01", 600, "America/New_York").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(zonedToUtc("2026-12-01", 600, "America/New_York").toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });
  it("finds the local date of a UTC instant", () => {
    expect(localDate(new Date("2026-11-25T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-26");
  });
});
