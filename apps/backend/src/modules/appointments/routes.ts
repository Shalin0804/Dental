import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { APPOINTMENT_STATUSES, bookingSchema, patientDetailsSchema, type AppointmentStatus, type BookingResult } from "@sdc/shared";
import { prisma, type Prisma, type Tx } from "../../config/db.js";
import { env } from "../../config/env.js";
import { authenticate, authorize, has, optionalAuth } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { assertSlotAvailable, availableSlots, getSettings, lockDoctor } from "../../services/availability.js";
import { notifyPatient } from "../../services/notify.js";
import { createOrder, keyId } from "../../services/razorpay.js";
import { emit } from "../../services/realtime.js";
import { HttpError, badRequest, forbidden, notFound, pageArgs, pageMeta, pagination, parse, sortBy } from "../../utils/http.js";
import { nextSeq, patientCode } from "../../utils/sequence.js";
import { formatLocal, localDate, zonedToUtc, addDays } from "../../utils/time.js";

export const availabilityRouter = Router();
export const appointmentsRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/* ------------------------------ Availability (public) ------------------------------ */

availabilityRouter.get("/", optionalAuth, async (req, res) => {
  const q = parse(z.object({ doctorId: z.string().min(1), treatmentId: z.string().min(1), date: isoDate, excludeAppointmentId: z.string().optional(), durationOverride: z.coerce.number().int().min(5).max(480).optional() }), req.query);
  const staff = has(req, "appointments:manage");
  const r = await availableSlots({ ...q, staff, durationOverride: staff ? q.durationOverride : undefined });
  res.json({ data: { ...r, timezone: (await getSettings()).timezone } });
});

/** Next dates with at least one free slot — lets the booking UI jump to availability. */
availabilityRouter.get("/days", async (req, res) => {
  const q = parse(z.object({ doctorId: z.string().min(1), treatmentId: z.string().min(1), from: isoDate, days: z.coerce.number().int().min(1).max(31).default(14) }), req.query);
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < q.days; i++) {
    const date = addDays(q.from, i);
    const r = await availableSlots({ doctorId: q.doctorId, treatmentId: q.treatmentId, date });
    out.push({ date, count: r.slots.length });
  }
  res.json({ data: out });
});

/* ------------------------------ Helpers ------------------------------ */

const apptInclude = {
  patient: { select: { id: true, fullName: true, phone: true, email: true, patientCode: true, userId: true } },
  doctor: { select: { id: true, slug: true, photoUrl: true, specialization: true, user: { select: { fullName: true } } } },
  treatment: { select: { id: true, name: true, slug: true, durationMinutes: true } },
  queueToken: { select: { id: true, tokenNumber: true, status: true } },
  payments: { select: { id: true, amountPaise: true, method: true, status: true, paidAt: true } },
} satisfies Prisma.AppointmentInclude;

/** Restricts a query to what the caller may see. */
async function scope(req: Request): Promise<Prisma.AppointmentWhereInput> {
  if (has(req, "appointments:read")) return {};
  const a = await actor(req);
  if (a.doctorId) return { doctorId: a.doctorId };
  if (a.patientId) return { patientId: a.patientId };
  throw forbidden();
}

async function loadScoped(req: Request, id: string) {
  const appt = await prisma.appointment.findFirst({ where: { id, ...(await scope(req)) }, include: apptInclude });
  if (!appt) throw notFound("Appointment");
  return appt;
}

async function referenceFor(tx: Tx, startAt: Date, tz: string) {
  const ymd = localDate(startAt, tz).replaceAll("-", "").slice(2);
  return `SDC-${ymd}-${String(await nextSeq(tx, `appt:${ymd}`)).padStart(3, "0")}`;
}

async function notifyAppt(apptId: string, template: "appointment_booked" | "appointment_confirmed" | "appointment_cancelled" | "appointment_rescheduled", extra: Record<string, string> = {}, tx: Tx = prisma) {
  const a = await tx.appointment.findUniqueOrThrow({ where: { id: apptId }, include: { patient: true, doctor: { include: { user: true } }, treatment: true } });
  const tz = (await getSettings(tx)).timezone;
  await notifyPatient(a.patient, template, { name: a.patient.fullName, reference: a.reference, treatment: a.treatment.name, doctor: a.doctor.user.fullName, when: formatLocal(a.startAt, tz), ...extra }, tx);
}
export { notifyAppt };

async function recordStatus(tx: Tx, appointmentId: string, from: AppointmentStatus | null, to: AppointmentStatus, changedById: string | null, note?: string | null) {
  await tx.appointmentStatusHistory.create({ data: { appointmentId, fromStatus: from, toStatus: to, changedById, note: note ?? null } });
}

/** Find a patient record for guest / staff bookings. Guests only ever match records without a login (never someone's account). */
async function resolvePatient(tx: Tx, details: z.infer<typeof patientDetailsSchema>, allowAccountMatch: boolean) {
  const existing = await tx.patient.findFirst({
    where: { phone: details.phone, deletedAt: null, fullName: { equals: details.fullName, mode: "insensitive" }, ...(allowAccountMatch ? {} : { userId: null }) },
  });
  if (existing) return existing;
  return tx.patient.create({
    data: {
      patientCode: patientCode(await nextSeq(tx, "patient")), fullName: details.fullName, phone: details.phone, email: details.email || null,
      dateOfBirth: details.dateOfBirth ? new Date(details.dateOfBirth) : null, gender: details.gender ?? null, consentAt: new Date(),
    },
  });
}

/* ------------------------------ Booking ------------------------------ */

const bookingLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, skip: (req) => env.NODE_ENV === "test" || !!req.user });

appointmentsRouter.post("/", optionalAuth, bookingLimiter, async (req, res) => {
  const body = parse(bookingSchema, req.body);
  const staff = has(req, "appointments:manage");
  const me = await actor(req);
  if (!staff && !me.patientId && !body.patient) throw badRequest("Patient details are required", { patient: ["Required"] });
  if (!staff && !me.patientId && body.consent !== true) throw badRequest("Consent is required to book", { consent: ["Required"] });
  if (!staff && body.paymentMethod === "RAZORPAY" && !env.RAZORPAY_KEY_ID) throw new HttpError(503, "PAYMENTS_DISABLED", "Online payments are not configured. Please choose Pay at Hospital.");

  const startAt = new Date(body.startAt);
  const settings = await getSettings();
  const source = staff ? (body.source ?? "PHONE") : "ONLINE";
  const online = !staff && body.paymentMethod === "RAZORPAY";

  const appt = await prisma.$transaction(async (tx) => {
    await lockDoctor(tx, body.doctorId);
    const { endAt } = await assertSlotAvailable({ doctorId: body.doctorId, treatmentId: body.treatmentId, date: localDate(startAt, settings.timezone), startAt, staff, durationOverride: staff ? body.durationOverride : undefined }, tx);

    let patientId: string;
    if (staff && body.patientId) patientId = (await tx.patient.findFirstOrThrow({ where: { id: body.patientId, deletedAt: null } })).id;
    else if (!staff && me.patientId) patientId = me.patientId;
    else if (body.patient) patientId = (await resolvePatient(tx, body.patient, staff)).id;
    else throw badRequest("Select or register a patient");

    const status: AppointmentStatus = staff ? "CONFIRMED" : "PENDING";
    const a = await tx.appointment.create({
      data: {
        reference: await referenceFor(tx, startAt, settings.timezone), patientId, doctorId: body.doctorId, treatmentId: body.treatmentId,
        startAt, endAt, status, source, paymentMethod: online ? "RAZORPAY" : "PAY_AT_HOSPITAL", notes: body.notes || null, createdById: req.user?.id ?? null,
      },
      include: { patient: true, doctor: true },
    });
    await recordStatus(tx, a.id, null, status, req.user?.id ?? null, `Booked via ${source.toLowerCase()}`);
    if (!online) await notifyAppt(a.id, staff ? "appointment_confirmed" : "appointment_booked", {}, tx);
    return a;
  });

  let payment: BookingResult["payment"] = null;
  if (online) {
    // Booking amount = doctor's consultation fee; the treatment itself is invoiced at the hospital.
    const amount = appt.doctor.consultationFeePaise;
    try {
      const order = await createOrder(amount, appt.reference, { appointmentId: appt.id, reference: appt.reference });
      await prisma.payment.create({ data: { patientId: appt.patientId, appointmentId: appt.id, amountPaise: amount, method: "RAZORPAY", status: "CREATED", razorpayOrderId: order.id } });
      payment = { orderId: order.id, amountPaise: amount, keyId: keyId(), currency: "INR", name: appt.patient.fullName, email: appt.patient.email, phone: appt.patient.phone };
    } catch (err) {
      // Release the slot if the order can't be created.
      await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED", cancelReason: "Payment order could not be created" } });
      throw err;
    }
  }

  if (req.user) await audit(req, "appointment.create", "Appointment", appt.id, undefined, { reference: appt.reference, startAt, source });
  emit("appointments:changed", { doctorId: appt.doctorId });
  const result: BookingResult = { id: appt.id, reference: appt.reference, status: appt.status, startAt: appt.startAt.toISOString(), endAt: appt.endAt.toISOString(), payment };
  res.status(201).json({ data: result });
});

/** Guest confirmation page lookup: needs both the reference and the phone number used. */
appointmentsRouter.get("/lookup", rateLimit({ windowMs: 15 * 60_000, limit: 30, skip: () => env.NODE_ENV === "test" }), async (req, res) => {
  const q = parse(z.object({ reference: z.string().min(5).max(30), phone: z.string().min(10).max(16) }), req.query);
  const a = await prisma.appointment.findUnique({ where: { reference: q.reference.toUpperCase() }, include: apptInclude });
  const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
  if (!a || digits(a.patient.phone) !== digits(q.phone)) throw notFound("Appointment");
  res.json({ data: { reference: a.reference, status: a.status, startAt: a.startAt, endAt: a.endAt, doctor: a.doctor.user.fullName, treatment: a.treatment.name, paymentMethod: a.paymentMethod, payments: a.payments.map((p) => ({ status: p.status, amountPaise: p.amountPaise })) } });
});

/* ------------------------------ Listing ------------------------------ */

appointmentsRouter.use(authenticate);

appointmentsRouter.get("/", authorize("appointments:read", "appointments:own"), async (req, res) => {
  const q = parse(pagination.extend({
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    statuses: z.string().optional(),
    doctorId: z.string().optional(),
    patientId: z.string().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    when: z.enum(["upcoming", "past", "today"]).optional(),
  }), req.query);
  const tz = (await getSettings()).timezone;
  const where: Prisma.AppointmentWhereInput = { AND: [await scope(req)] };
  const and = where.AND as Prisma.AppointmentWhereInput[];
  if (q.status) and.push({ status: q.status });
  if (q.statuses) and.push({ status: { in: q.statuses.split(",").filter((s): s is AppointmentStatus => (APPOINTMENT_STATUSES as readonly string[]).includes(s)) } });
  if (q.doctorId) and.push({ doctorId: q.doctorId });
  if (q.patientId) and.push({ patientId: q.patientId });
  if (q.from) and.push({ startAt: { gte: zonedToUtc(q.from, 0, tz) } });
  if (q.to) and.push({ startAt: { lt: zonedToUtc(addDays(q.to, 1), 0, tz) } });
  if (q.when === "upcoming") and.push({ startAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] } });
  if (q.when === "past") and.push({ OR: [{ startAt: { lt: new Date() } }, { status: { in: ["CANCELLED", "COMPLETED", "NO_SHOW"] } }] });
  if (q.when === "today") {
    const today = localDate(new Date(), tz);
    and.push({ startAt: { gte: zonedToUtc(today, 0, tz), lt: zonedToUtc(addDays(today, 1), 0, tz) } });
  }
  if (q.q) and.push({ OR: [{ reference: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }, { patient: { phone: { contains: q.q } } }] });

  const order = q.when === "upcoming" || q.when === "today" ? "asc" : q.order;
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({ where, include: apptInclude, orderBy: sortBy(["startAt", "createdAt", "status"] as const, "startAt", { sort: q.sort, order }), ...pageArgs(q) }),
    prisma.appointment.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

appointmentsRouter.get("/:id", authorize("appointments:read", "appointments:own"), async (req, res) => {
  const a = await loadScoped(req, String(req.params.id));
  const history = await prisma.appointmentStatusHistory.findMany({ where: { appointmentId: a.id }, orderBy: { createdAt: "asc" } });
  res.json({ data: { ...a, history } });
});

/* ------------------------------ State changes ------------------------------ */

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_PROGRESS", "CANCELLED", "NO_SHOW", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export async function transition(req: Request, id: string, to: AppointmentStatus, note?: string | null, tx: Tx = prisma) {
  const a = await tx.appointment.findUniqueOrThrow({ where: { id } });
  if (!TRANSITIONS[a.status].includes(to)) throw new HttpError(409, "INVALID_TRANSITION", `Cannot change an appointment from ${a.status.toLowerCase().replace("_", " ")} to ${to.toLowerCase().replace("_", " ")}`);
  const updated = await tx.appointment.update({ where: { id }, data: { status: to, ...(to === "CANCELLED" ? { cancelReason: note ?? null } : {}) } });
  await recordStatus(tx, id, a.status, to, req.user?.id ?? null, note);
  await audit(req, `appointment.${to.toLowerCase()}`, "Appointment", id, { status: a.status }, { status: to, note }, tx);
  return updated;
}

appointmentsRouter.patch("/:id/status", authorize("appointments:manage", "appointments:own"), async (req, res) => {
  const body = parse(z.object({ status: z.enum(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]), note: z.string().max(300).optional() }), req.body);
  const a = await loadScoped(req, String(req.params.id));
  const me = await actor(req);
  // Doctors may only move their own appointments through consultation; patients can't use this endpoint.
  if (!has(req, "appointments:manage") && !(me.doctorId === a.doctorId && ["IN_PROGRESS", "COMPLETED", "NO_SHOW"].includes(body.status))) throw forbidden();
  const updated = await prisma.$transaction(async (tx) => {
    const u = await transition(req, a.id, body.status, body.note, tx);
    if (body.status === "CONFIRMED") await notifyAppt(a.id, "appointment_confirmed", {}, tx);
    return u;
  });
  emit("appointments:changed", { doctorId: a.doctorId });
  res.json({ data: updated });
});

appointmentsRouter.post("/:id/cancel", authorize("appointments:manage", "appointments:own"), async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3, "Please give a reason").max(300) }), req.body);
  const a = await loadScoped(req, String(req.params.id));
  const staff = has(req, "appointments:manage");
  const me = await actor(req);
  if (!staff) {
    if (me.patientId !== a.patientId) throw forbidden();
    const s = await getSettings();
    if (a.startAt.getTime() - Date.now() < s.cancellationWindowHours * 3_600_000) throw new HttpError(409, "TOO_LATE", `Appointments can be cancelled online up to ${s.cancellationWindowHours} hours before. Please call the hospital.`);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await transition(req, a.id, "CANCELLED", body.reason, tx);
    await tx.queueToken.updateMany({ where: { appointmentId: a.id, status: { in: ["WAITING", "CALLED"] } }, data: { status: "CANCELLED" } });
    await notifyAppt(a.id, "appointment_cancelled", { reason: body.reason }, tx);
    return u;
  });
  emit("appointments:changed", { doctorId: a.doctorId });
  emit("queue:changed", { doctorId: a.doctorId });
  res.json({ data: updated });
});

appointmentsRouter.post("/:id/reschedule", authorize("appointments:manage", "appointments:own"), async (req, res) => {
  const body = parse(z.object({ startAt: z.string().datetime(), doctorId: z.string().optional(), reason: z.string().max(300).optional() }), req.body);
  const a = await loadScoped(req, String(req.params.id));
  const staff = has(req, "appointments:manage");
  const me = await actor(req);
  if (!staff && me.patientId !== a.patientId) throw forbidden();
  if (!["PENDING", "CONFIRMED"].includes(a.status)) throw new HttpError(409, "INVALID_TRANSITION", "Only pending or confirmed appointments can be rescheduled");
  const s = await getSettings();
  if (!staff && a.startAt.getTime() - Date.now() < s.cancellationWindowHours * 3_600_000) throw new HttpError(409, "TOO_LATE", `Appointments can be rescheduled online up to ${s.cancellationWindowHours} hours before. Please call the hospital.`);

  const doctorId = staff && body.doctorId ? body.doctorId : a.doctorId;
  const startAt = new Date(body.startAt);
  const updated = await prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const keepDuration = staff ? Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60_000) : undefined;
    const { endAt } = await assertSlotAvailable({ doctorId, treatmentId: a.treatmentId, date: localDate(startAt, s.timezone), startAt, excludeAppointmentId: a.id, staff, durationOverride: keepDuration }, tx);
    const u = await tx.appointment.update({ where: { id: a.id }, data: { startAt, endAt, doctorId } });
    await recordStatus(tx, a.id, a.status, a.status, req.user!.id, `Rescheduled from ${formatLocal(a.startAt, s.timezone)}${body.reason ? ` — ${body.reason}` : ""}`);
    await audit(req, "appointment.reschedule", "Appointment", a.id, { startAt: a.startAt, doctorId: a.doctorId }, { startAt, doctorId }, tx);
    await notifyAppt(a.id, "appointment_rescheduled", {}, tx);
    return u;
  });
  emit("appointments:changed", { doctorId });
  res.json({ data: updated });
});
