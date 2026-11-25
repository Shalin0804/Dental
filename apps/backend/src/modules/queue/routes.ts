import { Router, type Request } from "express";
import { z } from "zod";
import type { QueueStatus } from "@sdc/shared";
import { prisma, type Tx } from "../../config/db.js";
import { authenticate, authorize, has } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { getSettings } from "../../services/availability.js";
import { emit } from "../../services/realtime.js";
import { HttpError, badRequest, forbidden, notFound, parse } from "../../utils/http.js";
import { dateOnly, localDate } from "../../utils/time.js";
import { transition } from "../appointments/routes.js";

export const queueRouter = Router();

const today = async () => localDate(new Date(), (await getSettings()).timezone);
const ACTIVE: QueueStatus[] = ["WAITING", "CALLED", "IN_CONSULTATION"];

/** Average consultation minutes for a doctor today (falls back to 15). */
async function avgConsultMinutes(doctorId: string, date: Date) {
  const done = await prisma.queueToken.findMany({ where: { doctorId, date, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } }, select: { startedAt: true, completedAt: true }, take: 50 });
  if (!done.length) return 15;
  return Math.max(5, Math.round(done.reduce((s, t) => s + (t.completedAt!.getTime() - t.startedAt!.getTime()), 0) / done.length / 60_000));
}

/** Waiting order: emergencies first, then token number. */
const orderBy = [{ priority: "desc" as const }, { tokenNumber: "asc" as const }];

async function board(date: string, doctorId?: string) {
  const day = dateOnly(date);
  const tokens = await prisma.queueToken.findMany({
    where: { date: day, ...(doctorId ? { doctorId } : {}) },
    orderBy,
    include: {
      patient: { select: { id: true, fullName: true, patientCode: true, phone: true } },
      doctor: { select: { id: true, user: { select: { fullName: true } } } },
      appointment: { select: { id: true, reference: true, startAt: true, treatment: { select: { name: true } } } },
    },
  });
  const doctorIds = [...new Set(tokens.map((t) => t.doctorId))];
  const avg = new Map(await Promise.all(doctorIds.map(async (id) => [id, await avgConsultMinutes(id, day)] as const)));
  // Estimated wait = (people ahead of you + 1 if someone is in the chair) × average consult time.
  const position = new Map<string, number>();
  for (const id of doctorIds) {
    const busy = tokens.some((t) => t.doctorId === id && t.status === "IN_CONSULTATION") ? 1 : 0;
    tokens.filter((t) => t.doctorId === id && (t.status === "WAITING" || t.status === "CALLED")).forEach((t, i) => position.set(t.id, i + busy));
  }
  return tokens.map((t) => ({ ...t, estimatedWaitMinutes: position.has(t.id) ? position.get(t.id)! * avg.get(t.doctorId)! : null }));
}

async function nextToken(tx: Tx, doctorId: string, day: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"queue:" + doctorId}))`;
  const last = await tx.queueToken.aggregate({ where: { doctorId, date: day }, _max: { tokenNumber: true } });
  return (last._max.tokenNumber ?? 0) + 1;
}

/** Public TV display — token numbers and doctor names only, no patient data. */
queueRouter.get("/display", async (_req, res) => {
  const tokens = await board(await today());
  const byDoctor = new Map<string, { doctor: string; serving: number | null; called: number[]; waiting: number[] }>();
  for (const t of tokens) {
    const d = byDoctor.get(t.doctorId) ?? { doctor: t.doctor.user.fullName, serving: null, called: [], waiting: [] };
    if (t.status === "IN_CONSULTATION") d.serving = t.tokenNumber;
    if (t.status === "CALLED") d.called.push(t.tokenNumber);
    if (t.status === "WAITING") d.waiting.push(t.tokenNumber);
    byDoctor.set(t.doctorId, d);
  }
  res.json({ data: [...byDoctor.values()] });
});

queueRouter.use(authenticate);

queueRouter.get("/", authorize("queue:manage", "queue:consult"), async (req, res) => {
  const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), doctorId: z.string().optional() }), req.query);
  const me = await actor(req);
  const doctorId = has(req, "queue:manage") ? q.doctorId : me.doctorId ?? undefined;
  if (!has(req, "queue:manage") && !doctorId) throw forbidden();
  res.json({ data: await board(q.date ?? (await today()), doctorId) });
});

/** My own token (patient portal). */
queueRouter.get("/mine", authorize("self:read"), async (req, res) => {
  const me = await actor(req);
  if (!me.patientId) { res.json({ data: null }); return; }
  const all = await board(await today());
  res.json({ data: all.filter((t) => t.patientId === me.patientId && ACTIVE.includes(t.status)).map((t) => ({ id: t.id, tokenNumber: t.tokenNumber, status: t.status, doctor: t.doctor.user.fullName, estimatedWaitMinutes: t.estimatedWaitMinutes })) });
});

queueRouter.post("/check-in", authorize("queue:manage"), async (req, res) => {
  const body = parse(z.object({ appointmentId: z.string().optional(), patientId: z.string().optional(), doctorId: z.string().optional(), emergency: z.boolean().default(false) }), req.body);
  const day = dateOnly(await today());
  const token = await prisma.$transaction(async (tx) => {
    if (body.appointmentId) {
      const a = await tx.appointment.findUnique({ where: { id: body.appointmentId } });
      if (!a) throw notFound("Appointment");
      if (localDate(a.startAt, (await getSettings(tx)).timezone) !== (await today())) throw badRequest("Only today's appointments can be checked in");
      const existing = await tx.queueToken.findUnique({ where: { appointmentId: a.id } });
      if (existing) throw new HttpError(409, "ALREADY_CHECKED_IN", `Already checked in as token ${existing.tokenNumber}`);
      if (a.status === "PENDING") await transition(req, a.id, "CONFIRMED", "Confirmed at check-in", tx);
      await transition(req, a.id, "CHECKED_IN", null, tx);
      return tx.queueToken.create({ data: { appointmentId: a.id, patientId: a.patientId, doctorId: a.doctorId, date: day, tokenNumber: await nextToken(tx, a.doctorId, day), priority: body.emergency ? 1 : 0 } });
    }
    if (!body.patientId || !body.doctorId) throw badRequest("Choose an appointment, or a patient and doctor for a walk-in");
    return tx.queueToken.create({ data: { patientId: body.patientId, doctorId: body.doctorId, date: day, tokenNumber: await nextToken(tx, body.doctorId, day), priority: body.emergency ? 1 : 0 } });
  });
  await audit(req, "queue.check_in", "QueueToken", token.id, undefined, { tokenNumber: token.tokenNumber, emergency: body.emergency });
  emit("queue:changed", { doctorId: token.doctorId });
  res.status(201).json({ data: token });
});

const ACTIONS = {
  call: { from: ["WAITING", "CALLED", "SKIPPED"], to: "CALLED" },
  start: { from: ["WAITING", "CALLED"], to: "IN_CONSULTATION" },
  complete: { from: ["IN_CONSULTATION"], to: "COMPLETED" },
  skip: { from: ["WAITING", "CALLED"], to: "SKIPPED" },
  requeue: { from: ["SKIPPED"], to: "WAITING" },
  cancel: { from: ["WAITING", "CALLED", "SKIPPED"], to: "CANCELLED" },
} as const satisfies Record<string, { from: QueueStatus[]; to: QueueStatus }>;

async function act(req: Request, id: string, action: keyof typeof ACTIONS) {
  const t = await prisma.queueToken.findUnique({ where: { id } });
  if (!t) throw notFound("Queue token");
  const me = await actor(req);
  if (!has(req, "queue:manage") && me.doctorId !== t.doctorId) throw forbidden();
  const rule = ACTIONS[action];
  if (!(rule.from as readonly QueueStatus[]).includes(t.status)) throw new HttpError(409, "INVALID_TRANSITION", `Token ${t.tokenNumber} is ${t.status.toLowerCase().replace("_", " ")}`);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    if (rule.to === "IN_CONSULTATION") {
      const busy = await tx.queueToken.findFirst({ where: { doctorId: t.doctorId, date: t.date, status: "IN_CONSULTATION", id: { not: t.id } } });
      if (busy) throw new HttpError(409, "DOCTOR_BUSY", `Token ${busy.tokenNumber} is still in consultation. Complete it first.`);
    }
    const u = await tx.queueToken.update({
      where: { id },
      data: { status: rule.to, ...(rule.to === "CALLED" ? { calledAt: now } : rule.to === "IN_CONSULTATION" ? { startedAt: now, calledAt: t.calledAt ?? now } : rule.to === "COMPLETED" ? { completedAt: now } : {}) },
    });
    if (t.appointmentId) {
      const a = await tx.appointment.findUniqueOrThrow({ where: { id: t.appointmentId } });
      if (rule.to === "IN_CONSULTATION" && a.status === "CHECKED_IN") await transition(req, a.id, "IN_PROGRESS", null, tx);
      if (rule.to === "COMPLETED" && a.status === "IN_PROGRESS") await transition(req, a.id, "COMPLETED", null, tx);
    }
    return u;
  });
  emit("queue:changed", { doctorId: t.doctorId });
  return updated;
}

queueRouter.post("/:id/:action", authorize("queue:manage", "queue:consult"), async (req, res) => {
  const action = parse(z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS]), req.params.action);
  res.json({ data: await act(req, String(req.params.id), action) });
});

queueRouter.post("/:id/priority", authorize("queue:manage"), async (req, res) => {
  const { emergency } = parse(z.object({ emergency: z.boolean() }), req.body);
  const t = await prisma.queueToken.update({ where: { id: String(req.params.id) }, data: { priority: emergency ? 1 : 0 } });
  await audit(req, "queue.priority", "QueueToken", t.id, undefined, { emergency });
  emit("queue:changed", { doctorId: t.doctorId });
  res.json({ data: t });
});

/** Calls the next waiting token for a doctor (emergencies first). */
queueRouter.post("/call-next", authorize("queue:manage", "queue:consult"), async (req, res) => {
  const body = parse(z.object({ doctorId: z.string().optional() }), req.body);
  const me = await actor(req);
  const doctorId = has(req, "queue:manage") ? body.doctorId : me.doctorId;
  if (!doctorId) throw badRequest("Select a doctor");
  const next = await prisma.queueToken.findFirst({ where: { doctorId, date: dateOnly(await today()), status: "WAITING" }, orderBy });
  if (!next) throw new HttpError(404, "QUEUE_EMPTY", "No one is waiting");
  res.json({ data: await act(req, next.id, "call") });
});
