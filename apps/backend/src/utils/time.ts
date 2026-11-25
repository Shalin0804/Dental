/** Timezone helpers built on Intl — no dependency. Dates as "YYYY-MM-DD" strings are local hospital dates. */

const dtf = new Map<string, Intl.DateTimeFormat>();
function parts(d: Date, tz: string) {
  let f = dtf.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtf.set(tz, f);
  }
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second };
}

/** Offset (ms) of tz from UTC at instant d. */
function offsetMs(d: Date, tz: string) {
  const p = parts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** Local wall-clock time (date + minutes from midnight) in tz → UTC instant. Handles DST by re-checking the offset. */
export function zonedToUtc(date: string, minute: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  let utc = guess - offsetMs(new Date(guess), tz);
  utc = guess - offsetMs(new Date(utc), tz);
  return new Date(utc);
}

export function localDate(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function localMinute(d: Date, tz: string): number {
  const p = parts(d, tz);
  return p.h * 60 + p.min;
}

/** 0 = Sunday. Calendar weekday of a YYYY-MM-DD date (independent of tz). */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** A YYYY-MM-DD string as a Date at UTC midnight — the form Prisma uses for @db.Date columns. */
export const dateOnly = (date: string) => new Date(`${date}T00:00:00Z`);

export const addDays = (date: string, n: number) => {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function formatLocal(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}
