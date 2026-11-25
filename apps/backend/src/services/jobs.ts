import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { addDays, formatLocal, localDate, zonedToUtc } from "../utils/time.js";
import { getSettings } from "./availability.js";
import { expireUnpaidBookings } from "./billing.js";
import { notifyPatient, processDue } from "./notify.js";

/** Sends a reminder ~24h ahead for confirmed appointments (once). */
export async function sendReminders() {
  const s = await getSettings();
  const now = Date.now();
  const due = await prisma.appointment.findMany({
    where: { status: "CONFIRMED", reminderSentAt: null, startAt: { gt: new Date(now), lte: new Date(now + 24 * 3_600_000) } },
    include: { patient: true, doctor: { include: { user: true } } },
    take: 100,
  });
  for (const a of due) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({ where: { id: a.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
      if (count) await notifyPatient(a.patient, "appointment_reminder", { name: a.patient.fullName, doctor: a.doctor.user.fullName, when: formatLocal(a.startAt, s.timezone), reference: a.reference }, tx);
    });
  }
  return due.length;
}

/** Follow-up reminders: one day before a follow-up date recorded on a medical record or prescription. */
export async function sendFollowUps() {
  const s = await getSettings();
  const tomorrow = addDays(localDate(new Date(), s.timezone), 1);
  const key = `followup:${tomorrow}`;
  // Once per day across instances.
  const first = await prisma.counter.findUnique({ where: { key } });
  if (first) return 0;
  await prisma.counter.create({ data: { key, value: 1 } }).catch(() => null);
  const day = new Date(`${tomorrow}T00:00:00Z`);
  const recs = await prisma.prescription.findMany({ where: { followUpDate: day }, include: { patient: true } });
  for (const r of recs) await notifyPatient(r.patient, "follow_up_reminder", { name: r.patient.fullName, when: formatLocal(zonedToUtc(tomorrow, 10 * 60, s.timezone), s.timezone) });
  return recs.length;
}

export function startJobs() {
  const every = (ms: number, name: string, fn: () => Promise<unknown>) =>
    setInterval(() => fn().catch((err) => logger.error({ err }, `${name} job failed`)), ms);
  return [
    every(15_000, "notifications", () => processDue()),
    every(60_000, "expire-unpaid", () => expireUnpaidBookings()),
    every(5 * 60_000, "reminders", sendReminders),
    every(60 * 60_000, "follow-ups", sendFollowUps),
  ];
}
