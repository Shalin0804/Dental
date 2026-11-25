import { prisma, type Tx } from "../config/db.js";
import { HttpError, badRequest, notFound } from "../utils/http.js";
import { addDays, dateOnly, localDate, localMinute, weekdayOf, zonedToUtc } from "../utils/time.js";
import { generateSlots } from "./slots.js";

export const getSettings = async (tx: Tx = prisma) => {
  const s = await tx.hospitalSettings.findUnique({ where: { id: "default" } });
  if (!s) throw notFound("Hospital settings");
  return s;
};

/** Duration and price a doctor charges for a treatment (doctor overrides fall back to treatment defaults). */
export async function doctorTreatment(doctorId: string, treatmentId: string, tx: Tx = prisma) {
  const dt = await tx.doctorTreatment.findUnique({ where: { doctorId_treatmentId: { doctorId, treatmentId } }, include: { treatment: true, doctor: { include: { user: true } } } });
  if (!dt || !dt.treatment.isActive || dt.treatment.deletedAt) throw badRequest("This doctor does not offer the selected treatment");
  if (!dt.doctor.isActive || dt.doctor.deletedAt || !dt.doctor.user.isActive) throw badRequest("This doctor is not currently accepting appointments");
  return { ...dt, duration: dt.durationOverride ?? dt.treatment.durationMinutes, pricePaise: dt.priceOverridePaise ?? dt.treatment.pricePaise };
}

interface SlotQuery { doctorId: string; treatmentId: string; date: string; excludeAppointmentId?: string; durationOverride?: number; staff?: boolean }

/** Available start times (UTC ISO) for a doctor/treatment on a local date. */
export async function availableSlots(q: SlotQuery, tx: Tx = prisma) {
  const s = await getSettings(tx);
  const tz = s.timezone;
  const dt = await doctorTreatment(q.doctorId, q.treatmentId, tx);
  const duration = q.durationOverride ?? dt.duration;
  const today = localDate(new Date(), tz);

  if (q.date < today) return { duration, slots: [] as string[], reason: "Date is in the past" };
  if (!q.staff && q.date > addDays(today, s.bookingWindowDays)) return { duration, slots: [], reason: `Bookings open ${s.bookingWindowDays} days in advance` };

  const day = dateOnly(q.date);
  const weekday = weekdayOf(q.date);
  // Sequential on purpose: inside a transaction these share one connection.
  const leave = await tx.doctorLeave.findFirst({ where: { OR: [{ doctorId: q.doctorId }, { doctorId: null }], startDate: { lte: day }, endDate: { gte: day } } });
  const special = await tx.specialHours.findMany({ where: { doctorId: q.doctorId, date: day } });
  const schedules = await tx.doctorSchedule.findMany({ where: { doctorId: q.doctorId, weekday, isActive: true } });
  const breaks = await tx.doctorBreak.findMany({ where: { doctorId: q.doctorId, weekday } });
  if (leave) return { duration, slots: [], reason: leave.doctorId ? "Doctor is on leave" : `Hospital closed${leave.reason ? `: ${leave.reason}` : ""}` };

  const windows = (special.length ? special : schedules).map((w) => ({ start: w.startMinute, end: w.endMinute }));
  if (!windows.length) return { duration, slots: [], reason: "Doctor is not available on this day" };

  const dayStart = zonedToUtc(q.date, 0, tz);
  const dayEnd = zonedToUtc(addDays(q.date, 1), 0, tz);
  const appts = await tx.appointment.findMany({
    where: { doctorId: q.doctorId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart }, ...(q.excludeAppointmentId ? { id: { not: q.excludeAppointmentId } } : {}) },
    select: { startAt: true, endAt: true },
  });
  const toMin = (d: Date) => Math.round((d.getTime() - dayStart.getTime()) / 60_000);
  const busy = appts.map((a) => ({ start: toMin(a.startAt), end: toMin(a.endAt) }));

  const earliest = q.date === today ? localMinute(new Date(), tz) + (q.staff ? 0 : s.minNoticeMinutes) : 0;
  const minutes = generateSlots({ windows, breaks: special.length ? [] : breaks.map((b) => ({ start: b.startMinute, end: b.endMinute })), busy, duration, buffer: dt.doctor.bufferMinutes, step: s.slotStepMinutes, earliest });
  return { duration, slots: minutes.map((m) => zonedToUtc(q.date, m, tz).toISOString()), reason: minutes.length ? null : "No free slots on this day" };
}

/** Throws unless startAt is one of the generated slots — the server is the source of truth for availability. */
export async function assertSlotAvailable(q: SlotQuery & { startAt: Date }, tx: Tx) {
  const { slots, duration } = await availableSlots(q, tx);
  if (!slots.includes(q.startAt.toISOString())) throw new HttpError(409, "SLOT_UNAVAILABLE", "This time slot is no longer available. Please pick another.");
  return { endAt: new Date(q.startAt.getTime() + duration * 60_000), duration };
}

/** Serialises bookings per doctor for the duration of the transaction (buffer rules aren't expressible in the EXCLUDE constraint). */
export const lockDoctor = (tx: Tx, doctorId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`;
