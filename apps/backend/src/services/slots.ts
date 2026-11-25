/** Pure slot generation — all values are minutes from local midnight. */
export interface Range { start: number; end: number }

export interface SlotInput {
  windows: Range[]; // working shifts (or special hours) for the day
  breaks: Range[];
  busy: Range[]; // existing appointments that day
  duration: number;
  buffer: number; // minimum gap between appointments
  step: number; // slot granularity
  earliest: number; // first allowed start (min-notice for today, 0 otherwise)
}

const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;

export function generateSlots({ windows, breaks, busy, duration, buffer, step, earliest }: SlotInput): number[] {
  const out = new Set<number>();
  for (const w of windows) {
    // Step grid is anchored at the shift start, so a 09:30 shift yields 09:30, 09:45, …
    const first = earliest <= w.start ? w.start : w.start + Math.ceil((earliest - w.start) / step) * step;
    for (let s = first; s + duration <= w.end; s += step) {
      const appt = { start: s, end: s + duration };
      if (breaks.some((b) => overlaps(appt, b))) continue;
      // Gap of `buffer` both before and after: extend both intervals by buffer at the end.
      if (busy.some((b) => overlaps({ start: s, end: appt.end + buffer }, { start: b.start, end: b.end + buffer }))) continue;
      out.add(s);
    }
  }
  return [...out].sort((a, b) => a - b);
}
