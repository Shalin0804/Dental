/** Display helpers that always render in the hospital timezone, not the browser's. */
export const HOSPITAL_TZ = "Asia/Kolkata";

const fmt = (opts: Intl.DateTimeFormatOptions, tz = HOSPITAL_TZ) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...opts });

export const fmtTime = (iso: string | Date, tz?: string) => fmt({ hour: "numeric", minute: "2-digit" }, tz).format(new Date(iso));
export const fmtDate = (iso: string | Date, tz?: string) => fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" }, tz).format(new Date(iso));
export const fmtDateTime = (iso: string | Date, tz?: string) => `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}`;

/** YYYY-MM-DD for "today" in the hospital timezone. */
export const todayLocal = (tz = HOSPITAL_TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

/** Day label for a YYYY-MM-DD date (no timezone shift). */
export const dayParts = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    day: d.getUTCDate(),
    month: d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
  };
};
