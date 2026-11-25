import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "../../config/db.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { getSettings } from "../../services/availability.js";
import { renderSubject, renderText } from "../../services/notify.js";
import { badRequest, conflict, notFound, pageArgs, pageMeta, pagination, parse } from "../../utils/http.js";
import { addDays, localDate, zonedToUtc } from "../../utils/time.js";

export const reportsRouter = Router();
export const settingsRouter = Router();
export const cmsRouter = Router();
export const reviewsRouter = Router();
export const notificationsRouter = Router();
export const auditRouter = Router();
export const contactRouter = Router();

const num = (v: unknown) => Number(v ?? 0);

/* ================================ Reports & dashboards ================================ */

reportsRouter.use(authenticate);

async function todayRange() {
  const tz = (await getSettings()).timezone;
  const today = localDate(new Date(), tz);
  const monthStart = `${today.slice(0, 8)}01`;
  return { tz, today, start: zonedToUtc(today, 0, tz), end: zonedToUtc(addDays(today, 1), 0, tz), monthStart: zonedToUtc(monthStart, 0, tz) };
}

reportsRouter.get("/admin", authorize("dashboard:admin", "reports:read"), async (_req, res) => {
  const { tz, start, end, monthStart } = await todayRange();
  const [patients, doctors, today, pending, completed, cancelled, revenue, refunds, outstanding] = await Promise.all([
    prisma.patient.count({ where: { deletedAt: null } }),
    prisma.doctor.count({ where: { deletedAt: null, isActive: true } }),
    prisma.appointment.count({ where: { startAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED"] } } }),
    prisma.appointment.count({ where: { status: "PENDING", startAt: { gte: new Date() } } }),
    prisma.appointment.count({ where: { status: "COMPLETED", startAt: { gte: monthStart } } }),
    prisma.appointment.count({ where: { status: "CANCELLED", startAt: { gte: monthStart } } }),
    prisma.payment.aggregate({ where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
    prisma.refund.aggregate({ where: { status: { not: "FAILED" }, createdAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
    prisma.$queryRaw<{ due: bigint }[]>`SELECT COALESCE(SUM("totalPaise" - "paidPaise" + "refundedPaise"), 0) AS due FROM "Invoice" WHERE status IN ('ISSUED','PARTIALLY_PAID')`,
  ]);

  const [weekly, monthly, revenueByMonth, popularity, doctorPerf, growth] = await Promise.all([
    prisma.$queryRaw<{ day: string; total: bigint; completed: bigint; cancelled: bigint }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
             COUNT(a.id) FILTER (WHERE a.id IS NOT NULL) AS total,
             COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED') AS completed,
             COUNT(a.id) FILTER (WHERE a.status = 'CANCELLED') AS cancelled
      FROM generate_series((now() AT TIME ZONE ${tz})::date - 6, (now() AT TIME ZONE ${tz})::date, interval '1 day') d
      LEFT JOIN "Appointment" a ON (a."startAt" AT TIME ZONE ${tz})::date = d::date
      GROUP BY d ORDER BY d`,
    prisma.$queryRaw<{ month: string; total: bigint }[]>`
      SELECT to_char(m, 'YYYY-MM') AS month, COUNT(a.id) AS total
      FROM generate_series(date_trunc('month', now() AT TIME ZONE ${tz}) - interval '11 months', date_trunc('month', now() AT TIME ZONE ${tz}), interval '1 month') m
      LEFT JOIN "Appointment" a ON date_trunc('month', a."startAt" AT TIME ZONE ${tz}) = m AND a.status <> 'CANCELLED'
      GROUP BY m ORDER BY m`,
    prisma.$queryRaw<{ month: string; collected: bigint; refunded: bigint }[]>`
      SELECT to_char(m, 'YYYY-MM') AS month,
        COALESCE((SELECT SUM(p."amountPaise") FROM "Payment" p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND date_trunc('month', p."paidAt" AT TIME ZONE ${tz}) = m), 0) AS collected,
        COALESCE((SELECT SUM(r."amountPaise") FROM "Refund" r WHERE r.status <> 'FAILED' AND date_trunc('month', r."createdAt" AT TIME ZONE ${tz}) = m), 0) AS refunded
      FROM generate_series(date_trunc('month', now() AT TIME ZONE ${tz}) - interval '11 months', date_trunc('month', now() AT TIME ZONE ${tz}), interval '1 month') m
      ORDER BY m`,
    prisma.$queryRaw<{ name: string; total: bigint }[]>`
      SELECT t.name, COUNT(a.id) AS total FROM "Treatment" t JOIN "Appointment" a ON a."treatmentId" = t.id
      WHERE a.status <> 'CANCELLED' AND a."startAt" >= now() - interval '90 days'
      GROUP BY t.name ORDER BY total DESC LIMIT 8`,
    prisma.$queryRaw<{ doctor: string; appointments: bigint; completed: bigint; noShows: bigint; revenue: bigint }[]>`
      SELECT u."fullName" AS doctor,
        COUNT(a.id) FILTER (WHERE a.status <> 'CANCELLED') AS appointments,
        COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED') AS completed,
        COUNT(a.id) FILTER (WHERE a.status = 'NO_SHOW') AS "noShows",
        COALESCE((SELECT SUM(i."paidPaise" - i."refundedPaise") FROM "Invoice" i JOIN "Appointment" a2 ON a2.id = i."appointmentId" WHERE a2."doctorId" = d.id AND i."issuedAt" >= ${monthStart}), 0) AS revenue
      FROM "Doctor" d JOIN "User" u ON u.id = d."userId"
      LEFT JOIN "Appointment" a ON a."doctorId" = d.id AND a."startAt" >= ${monthStart}
      WHERE d."deletedAt" IS NULL GROUP BY d.id, u."fullName" ORDER BY appointments DESC`,
    prisma.$queryRaw<{ month: string; total: bigint }[]>`
      SELECT to_char(m, 'YYYY-MM') AS month, COUNT(p.id) AS total
      FROM generate_series(date_trunc('month', now() AT TIME ZONE ${tz}) - interval '11 months', date_trunc('month', now() AT TIME ZONE ${tz}), interval '1 month') m
      LEFT JOIN "Patient" p ON date_trunc('month', p."createdAt" AT TIME ZONE ${tz}) = m AND p."deletedAt" IS NULL
      GROUP BY m ORDER BY m`,
  ]);

  res.json({
    data: {
      cards: {
        totalPatients: patients, totalDoctors: doctors, todaysAppointments: today, pendingAppointments: pending,
        completedThisMonth: completed, cancelledThisMonth: cancelled,
        monthlyRevenuePaise: num(revenue._sum.amountPaise) - num(refunds._sum.amountPaise),
        outstandingPaise: num(outstanding[0]?.due),
      },
      weekly: weekly.map((r) => ({ day: r.day, total: num(r.total), completed: num(r.completed), cancelled: num(r.cancelled) })),
      monthly: monthly.map((r) => ({ month: r.month, total: num(r.total) })),
      revenue: revenueByMonth.map((r) => ({ month: r.month, netPaise: num(r.collected) - num(r.refunded) })),
      treatments: popularity.map((r) => ({ name: r.name, total: num(r.total) })),
      doctors: doctorPerf.map((r) => ({ doctor: r.doctor, appointments: num(r.appointments), completed: num(r.completed), noShows: num(r.noShows), revenuePaise: num(r.revenue) })),
      patientGrowth: growth.map((r) => ({ month: r.month, total: num(r.total) })),
    },
  });
});

reportsRouter.get("/reception", authorize("dashboard:reception", "dashboard:admin"), async (_req, res) => {
  const { start, end, today } = await todayRange();
  const [byStatus, waiting, collected, unconfirmed] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where: { startAt: { gte: start, lt: end } }, _count: true }),
    prisma.queueToken.count({ where: { date: new Date(`${today}T00:00:00Z`), status: { in: ["WAITING", "CALLED"] } } }),
    prisma.payment.aggregate({ where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] }, paidAt: { gte: start, lt: end } }, _sum: { amountPaise: true } }),
    prisma.appointment.count({ where: { status: "PENDING", startAt: { gte: new Date() } } }),
  ]);
  const s = Object.fromEntries(byStatus.map((b) => [b.status, b._count]));
  res.json({ data: { today: Object.values(s).reduce((a, b) => a + b, 0) - (s.CANCELLED ?? 0), byStatus: s, waiting, collectedTodayPaise: num(collected._sum.amountPaise), unconfirmed } });
});

reportsRouter.get("/doctor", authorize("appointments:own"), async (req, res) => {
  const me = await actor(req);
  if (!me.doctorId) throw notFound("Doctor profile");
  const { start, end, monthStart } = await todayRange();
  const [today, upcoming, seenThisMonth, prescriptions, waiting] = await Promise.all([
    prisma.appointment.count({ where: { doctorId: me.doctorId, startAt: { gte: start, lt: end }, status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { doctorId: me.doctorId, startAt: { gte: end }, status: { in: ["PENDING", "CONFIRMED"] } } }),
    prisma.appointment.count({ where: { doctorId: me.doctorId, startAt: { gte: monthStart }, status: "COMPLETED" } }),
    prisma.prescription.count({ where: { doctorId: me.doctorId, createdAt: { gte: monthStart } } }),
    prisma.queueToken.count({ where: { doctorId: me.doctorId, date: { gte: start }, status: { in: ["WAITING", "CALLED"] } } }),
  ]);
  res.json({ data: { today, upcoming, seenThisMonth, prescriptions, waiting } });
});

/** CSV export of appointments in a date range. */
reportsRouter.get("/appointments.csv", authorize("reports:read"), async (req, res) => {
  const q = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
  const tz = (await getSettings()).timezone;
  const rows = await prisma.appointment.findMany({
    where: { startAt: { gte: zonedToUtc(q.from, 0, tz), lt: zonedToUtc(addDays(q.to, 1), 0, tz) } },
    include: { patient: { select: { fullName: true, patientCode: true } }, doctor: { select: { user: { select: { fullName: true } } } }, treatment: { select: { name: true } } },
    orderBy: { startAt: "asc" }, take: 20_000,
  });
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replaceAll('"', '""')}"` : s; };
  const lines = [["Reference", "Date", "Patient ID", "Patient", "Doctor", "Treatment", "Status", "Source", "Payment"].join(",")];
  for (const a of rows) lines.push([a.reference, new Intl.DateTimeFormat("en-IN", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(a.startAt), a.patient.patientCode, a.patient.fullName, a.doctor.user.fullName, a.treatment.name, a.status, a.source, a.paymentMethod].map(esc).join(","));
  await audit(req, "report.export", "Appointment", null, undefined, q);
  res.type("text/csv").setHeader("Content-Disposition", `attachment; filename="appointments-${q.from}-to-${q.to}.csv"`).send(lines.join("\n"));
});

/* ================================ Settings ================================ */

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(100), tagline: z.string().trim().max(150), phone: z.string().trim().min(5).max(30), whatsapp: z.string().trim().max(30).nullish(),
  email: z.string().trim().email(), address: z.string().trim().min(5).max(300), city: z.string().trim().max(80),
  mapEmbedUrl: z.string().trim().url().startsWith("https://www.google.com/maps").nullish().or(z.literal("")).transform((v) => v || null),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone"),
  openingHours: z.array(z.object({ days: z.string().max(40), hours: z.string().max(60) })).max(7),
  taxRateBp: z.coerce.number().int().min(0).max(5000), gstin: z.string().trim().max(20).nullish(),
  slotStepMinutes: z.coerce.number().int().refine((v) => [5, 10, 15, 20, 30].includes(v), "Use 5, 10, 15, 20 or 30"),
  bookingWindowDays: z.coerce.number().int().min(1).max(365), minNoticeMinutes: z.coerce.number().int().min(0).max(2880),
  cancellationWindowHours: z.coerce.number().int().min(0).max(168), invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{2,8}$/, "2–8 capital letters/digits"),
}).partial();

settingsRouter.get("/", authenticate, async (_req, res) => { res.json({ data: await getSettings() }); });
settingsRouter.patch("/", authenticate, authorize("settings:manage"), async (req, res) => {
  const body = parse(settingsSchema, req.body);
  const before = await getSettings();
  const s = await prisma.hospitalSettings.update({ where: { id: "default" }, data: body });
  await audit(req, "settings.update", "HospitalSettings", "default", before, s);
  res.json({ data: s });
});

/* ================================ CMS: blocks & FAQs ================================ */

const CMS_KEYS = ["hero", "about", "stats", "whyChooseUs", "process", "legal"] as const;
const cmsSchemas: Record<(typeof CMS_KEYS)[number], z.ZodType> = {
  hero: z.object({ eyebrow: z.string().max(80), title: z.string().min(5).max(120), subtitle: z.string().max(300), imageUrl: z.string().url().nullable() }),
  about: z.object({ title: z.string().min(5).max(120), body: z.string().max(3000), imageUrl: z.string().url().nullable(), highlights: z.array(z.string().max(80)).max(8) }),
  stats: z.array(z.object({ label: z.string().max(40), value: z.string().max(20) })).max(6),
  whyChooseUs: z.array(z.object({ title: z.string().max(60), body: z.string().max(200), icon: z.enum(["shield", "sparkles", "microscope", "heart", "award", "clock", "users", "rupee", "stethoscope"]) })).max(8),
  process: z.array(z.object({ title: z.string().max(60), body: z.string().max(200) })).max(6),
  legal: z.object({ privacy: z.string().max(30000), terms: z.string().max(30000) }),
};

cmsRouter.use(authenticate, authorize("cms:manage"));
cmsRouter.get("/blocks", async (_req, res) => {
  const blocks = await prisma.cmsBlock.findMany();
  res.json({ data: Object.fromEntries(blocks.map((b) => [b.key, b.value])) });
});
cmsRouter.put("/blocks/:key", async (req, res) => {
  const key = parse(z.enum(CMS_KEYS), req.params.key);
  const value = parse(cmsSchemas[key], req.body) as Prisma.InputJsonValue;
  const before = await prisma.cmsBlock.findUnique({ where: { key } });
  const b = await prisma.cmsBlock.upsert({ where: { key }, create: { key, value, updatedById: req.user!.id }, update: { value, updatedById: req.user!.id } });
  await audit(req, "cms.update", "CmsBlock", key, before?.value, value);
  res.json({ data: b });
});

const faqSchema = z.object({ question: z.string().trim().min(5).max(200), answer: z.string().trim().min(5).max(2000), sortOrder: z.coerce.number().int().default(0), isActive: z.boolean().default(true) });
cmsRouter.get("/faqs", async (_req, res) => { res.json({ data: await prisma.faq.findMany({ orderBy: { sortOrder: "asc" } }) }); });
cmsRouter.post("/faqs", async (req, res) => {
  const f = await prisma.faq.create({ data: parse(faqSchema, req.body) });
  await audit(req, "faq.create", "Faq", f.id, undefined, f);
  res.status(201).json({ data: f });
});
cmsRouter.patch("/faqs/:id", async (req, res) => {
  const f = await prisma.faq.update({ where: { id: String(req.params.id) }, data: parse(faqSchema.partial(), req.body) });
  await audit(req, "faq.update", "Faq", f.id, undefined, f);
  res.json({ data: f });
});
cmsRouter.delete("/faqs/:id", async (req, res) => {
  await prisma.faq.delete({ where: { id: String(req.params.id) } });
  await audit(req, "faq.delete", "Faq", String(req.params.id));
  res.status(204).end();
});

/* ================================ Contact messages ================================ */

contactRouter.use(authenticate, authorize("cms:manage", "appointments:manage"));
contactRouter.get("/", async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["NEW", "READ", "ARCHIVED"]).optional() }), req.query);
  const where: Prisma.ContactMessageWhereInput = q.status ? { status: q.status } : { status: { not: "ARCHIVED" } };
  const [rows, total] = await Promise.all([prisma.contactMessage.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(q) }), prisma.contactMessage.count({ where })]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});
contactRouter.patch("/:id", async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["NEW", "READ", "ARCHIVED"]) }), req.body);
  res.json({ data: await prisma.contactMessage.update({ where: { id: String(req.params.id) }, data: { status } }) });
});

/* ================================ Reviews ================================ */

reviewsRouter.use(authenticate);

/** Patients review a completed appointment; reviews go live after moderation. */
reviewsRouter.post("/", authorize("self:read"), async (req, res) => {
  const body = parse(z.object({ appointmentId: z.string(), rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().min(10).max(1000) }), req.body);
  const me = await actor(req);
  const a = await prisma.appointment.findFirst({ where: { id: body.appointmentId, patientId: me.patientId ?? "__none__", status: "COMPLETED" }, include: { patient: true } });
  if (!a) throw badRequest("You can review only your completed appointments");
  if (await prisma.review.findFirst({ where: { patientId: a.patientId, doctorId: a.doctorId, createdAt: { gte: a.startAt } } })) throw conflict("You have already reviewed this visit");
  const first = a.patient.fullName.split(" ")[0];
  const r = await prisma.review.create({ data: { patientId: a.patientId, doctorId: a.doctorId, authorName: `${first} ${a.patient.fullName.split(" ").slice(1).map((s) => s[0] + ".").join(" ")}`.trim(), rating: body.rating, comment: body.comment } });
  res.status(201).json({ data: r });
});

reviewsRouter.get("/", authorize("reviews:manage"), async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() }), req.query);
  const where: Prisma.ReviewWhereInput = { deletedAt: null, ...(q.status ? { status: q.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({ where, include: { doctor: { select: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.review.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

reviewsRouter.patch("/:id", authorize("reviews:manage"), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]) }), req.body);
  const r = await prisma.review.update({ where: { id: String(req.params.id) }, data: { status } });
  await audit(req, `review.${status.toLowerCase()}`, "Review", r.id);
  res.json({ data: r });
});

reviewsRouter.delete("/:id", authorize("reviews:manage"), async (req, res) => {
  await prisma.review.update({ where: { id: String(req.params.id) }, data: { deletedAt: new Date() } });
  await audit(req, "review.delete", "Review", String(req.params.id));
  res.status(204).end();
});

/* ================================ Notifications ================================ */

notificationsRouter.use(authenticate);

/** In-app inbox for the signed-in user. */
notificationsRouter.get("/mine", async (req, res) => {
  const rows = await prisma.notification.findMany({ where: { userId: req.user!.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ data: rows.map((n) => ({ id: n.id, title: renderSubject(n.template), body: renderText(n.template, n.payload), readAt: n.readAt, createdAt: n.createdAt })), meta: { unread: rows.filter((n) => !n.readAt).length } });
});

notificationsRouter.post("/mine/read", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
});

notificationsRouter.get("/", authorize("notifications:manage"), async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["PENDING", "SENT", "FAILED", "SKIPPED"]).optional(), channel: z.enum(["EMAIL", "SMS", "WHATSAPP", "IN_APP"]).optional() }), req.query);
  const where: Prisma.NotificationWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.channel ? { channel: q.channel } : {}), ...(q.q ? { OR: [{ recipient: { contains: q.q } }, { template: { contains: q.q } }] } : {}) };
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({ where, include: { logs: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.notification.count({ where }),
  ]);
  // Recipients are contact details — mask for the log view.
  const mask = (s: string) => (s.includes("@") ? s.replace(/^(.).*(@.*)$/, "$1***$2") : s.length > 4 ? `${"*".repeat(s.length - 4)}${s.slice(-4)}` : s);
  res.json({ data: rows.map((n) => ({ ...n, recipient: n.channel === "IN_APP" ? "in-app" : mask(n.recipient) })), meta: pageMeta(q, total) });
});

notificationsRouter.post("/:id/retry", authorize("notifications:manage"), async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: String(req.params.id) } });
  if (!n) throw notFound("Notification");
  if (!["FAILED", "SKIPPED"].includes(n.status)) throw conflict("Only failed or skipped notifications can be retried");
  const u = await prisma.notification.update({ where: { id: n.id }, data: { status: "PENDING", nextAttemptAt: new Date(), attempts: 0 } });
  await audit(req, "notification.retry", "Notification", n.id);
  res.json({ data: u });
});

/* ================================ Audit logs ================================ */

auditRouter.use(authenticate, authorize("audit:read"));
auditRouter.get("/", async (req, res) => {
  const q = parse(pagination.extend({ entity: z.string().max(40).optional(), actorId: z.string().optional(), action: z.string().max(60).optional() }), req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.entity ? { entity: q.entity } : {}), ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.q ? { entityId: q.q } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { fullName: true, email: true, role: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

