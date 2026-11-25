import argon2 from "argon2";
import { Router, type Request } from "express";
import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "@sdc/shared";
import { prisma, type Prisma } from "../../config/db.js";
import { authenticate, authorize, has } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { conflict, forbidden, notFound, pageArgs, pageMeta, pagination, parse } from "../../utils/http.js";
import { dateOnly } from "../../utils/time.js";

export const treatmentsRouter = Router();
export const doctorsRouter = Router();

const slugify = (s: string) => s.toLowerCase().replace(/^dr\.?\s+/, "dr ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const minute = z.coerce.number().int().min(0).max(1440);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const url = z.string().trim().url().max(500).nullish().or(z.literal("")).transform((v) => v || null);

/* ================================ Treatments ================================ */

const treatmentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(100).optional(),
  summary: z.string().trim().min(10).max(300),
  description: z.string().trim().min(10).max(5000),
  imageUrl: url,
  pricePaise: z.coerce.number().int().min(0).max(100_000_000),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  preparation: optText(2000),
  aftercare: optText(2000),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

treatmentsRouter.use(authenticate);

treatmentsRouter.get("/", authorize("treatments:manage", "appointments:manage", "billing:manage", "clinical:write"), async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["active", "inactive", "all"]).default("all"), pageSize: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
  const where: Prisma.TreatmentWhereInput = {
    deletedAt: null,
    ...(q.status === "active" ? { isActive: true } : q.status === "inactive" ? { isActive: false } : {}),
    ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.treatment.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { doctors: true, appointments: true } } }, ...pageArgs(q) }),
    prisma.treatment.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

treatmentsRouter.post("/", authorize("treatments:manage"), async (req, res) => {
  const body = parse(treatmentSchema, req.body);
  const t = await prisma.treatment.create({ data: { ...body, slug: slugify(body.slug || body.name) } });
  await audit(req, "treatment.create", "Treatment", t.id, undefined, t);
  res.status(201).json({ data: t });
});

treatmentsRouter.patch("/:id", authorize("treatments:manage"), async (req, res) => {
  const body = parse(treatmentSchema.partial(), req.body);
  const before = await prisma.treatment.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
  if (!before) throw notFound("Treatment");
  const t = await prisma.treatment.update({ where: { id: before.id }, data: { ...body, ...(body.slug ? { slug: slugify(body.slug) } : {}) } });
  await audit(req, "treatment.update", "Treatment", t.id, before, t);
  res.json({ data: t });
});

/** Soft delete: past appointments and invoices keep referencing it. */
treatmentsRouter.delete("/:id", authorize("treatments:manage"), async (req, res) => {
  const t = await prisma.treatment.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
  if (!t) throw notFound("Treatment");
  const upcoming = await prisma.appointment.count({ where: { treatmentId: t.id, startAt: { gte: new Date() }, status: { in: ["PENDING", "CONFIRMED"] } } });
  if (upcoming) throw conflict(`${upcoming} upcoming appointment(s) use this treatment. Disable it instead, or reschedule them first.`);
  await prisma.treatment.update({ where: { id: t.id }, data: { deletedAt: new Date(), isActive: false, slug: `${t.slug}-deleted-${Date.now()}` } });
  await audit(req, "treatment.delete", "Treatment", t.id, t);
  res.status(204).end();
});

/* ================================ Doctors ================================ */

const doctorProfile = z.object({
  fullName: z.string().trim().min(3).max(100),
  phone: phoneSchema.nullish().or(z.literal("")).transform((v) => v || null),
  photoUrl: url,
  qualification: z.string().trim().min(2).max(200),
  specialization: z.string().trim().min(2).max(100),
  experienceYears: z.coerce.number().int().min(0).max(70),
  registrationNumber: optText(60),
  registrationCouncil: optText(120),
  bio: optText(3000),
  languages: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  consultationFeePaise: z.coerce.number().int().min(0).max(10_000_000),
  bufferMinutes: z.coerce.number().int().min(0).max(60).default(0),
  isPublic: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

const doctorInclude = {
  user: { select: { id: true, email: true, fullName: true, phone: true, isActive: true } },
  treatments: { include: { treatment: { select: { id: true, name: true, durationMinutes: true, pricePaise: true } } } },
} satisfies Prisma.DoctorInclude;

/** Doctors may manage their own availability; admins any doctor. */
async function canManageDoctor(req: Request, doctorId: string) {
  if (has(req, "doctors:manage")) return;
  const me = await actor(req);
  if (!(has(req, "doctors:self") && me.doctorId === doctorId)) throw forbidden();
}

/** "me" → caller's doctor id. */
async function resolveDoctorId(req: Request) {
  const id = String(req.params.id);
  if (id !== "me") return id;
  const me = await actor(req);
  if (!me.doctorId) throw notFound("Doctor profile");
  return me.doctorId;
}

doctorsRouter.use(authenticate);

doctorsRouter.get("/", authorize("doctors:manage", "appointments:manage", "patients:read", "reports:read"), async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["active", "inactive", "all"]).default("all"), treatmentId: z.string().optional() }), req.query);
  const where: Prisma.DoctorWhereInput = {
    deletedAt: null,
    ...(q.status === "active" ? { isActive: true } : q.status === "inactive" ? { isActive: false } : {}),
    ...(q.treatmentId ? { treatments: { some: { treatmentId: q.treatmentId } } } : {}),
    ...(q.q ? { OR: [{ user: { fullName: { contains: q.q, mode: "insensitive" } } }, { specialization: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.doctor.findMany({ where, include: doctorInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], ...pageArgs(q) }),
    prisma.doctor.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

doctorsRouter.post("/", authorize("doctors:manage"), async (req, res) => {
  const body = parse(doctorProfile.extend({ email: emailSchema, password: passwordSchema, treatmentIds: z.array(z.string()).default([]) }), req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict("A user with this email already exists", "EMAIL_TAKEN");
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "DOCTOR" } });
  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
  const { fullName, phone, email, password: _pw, treatmentIds, ...profile } = body;
  let slug = slugify(fullName);
  if (await prisma.doctor.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const d = await prisma.doctor.create({
    data: {
      ...profile, slug,
      user: { create: { email, fullName, phone, passwordHash, roleId: role.id } },
      treatments: { create: treatmentIds.map((treatmentId) => ({ treatmentId })) },
    },
    include: doctorInclude,
  });
  await audit(req, "doctor.create", "Doctor", d.id, undefined, { email, fullName });
  res.status(201).json({ data: d });
});

doctorsRouter.get("/:id", authorize("doctors:manage", "doctors:self", "appointments:manage"), async (req, res) => {
  const id = await resolveDoctorId(req);
  if (!has(req, "doctors:manage") && !has(req, "appointments:manage")) await canManageDoctor(req, id);
  const d = await prisma.doctor.findFirst({
    where: { id, deletedAt: null },
    include: { ...doctorInclude, schedules: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }, breaks: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }, leaves: { where: { endDate: { gte: dateOnly(new Date().toISOString().slice(0, 10)) } }, orderBy: { startDate: "asc" } }, specialHours: { where: { date: { gte: dateOnly(new Date().toISOString().slice(0, 10)) } }, orderBy: { date: "asc" } } },
  });
  if (!d) throw notFound("Doctor");
  res.json({ data: d });
});

doctorsRouter.patch("/:id", authorize("doctors:manage", "doctors:self"), async (req, res) => {
  const id = await resolveDoctorId(req);
  await canManageDoctor(req, id);
  // Doctors editing themselves can change bio/photo/languages only; fees, buffer and visibility are admin decisions.
  const schema = has(req, "doctors:manage") ? doctorProfile.partial().extend({ isActive: z.boolean().optional() }) : doctorProfile.pick({ bio: true, photoUrl: true, languages: true, phone: true }).partial();
  const body = parse(schema, req.body) as Partial<z.infer<typeof doctorProfile>> & { isActive?: boolean };
  const before = await prisma.doctor.findFirstOrThrow({ where: { id, deletedAt: null }, include: { user: true } });
  const { fullName, phone, isActive, ...profile } = body;
  const d = await prisma.doctor.update({
    where: { id },
    data: { ...profile, ...(isActive !== undefined ? { isActive } : {}), user: { update: { ...(fullName ? { fullName } : {}), ...(phone !== undefined ? { phone } : {}), ...(isActive !== undefined ? { isActive } : {}) } } },
    include: doctorInclude,
  });
  if (isActive === false) await prisma.refreshToken.updateMany({ where: { userId: before.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, isActive === false ? "doctor.deactivate" : "doctor.update", "Doctor", id, before, d);
  res.json({ data: d });
});

doctorsRouter.put("/:id/treatments", authorize("doctors:manage"), async (req, res) => {
  const body = parse(z.object({ treatments: z.array(z.object({ treatmentId: z.string(), durationOverride: z.coerce.number().int().min(5).max(480).nullish(), priceOverridePaise: z.coerce.number().int().min(0).nullish() })).max(100) }), req.body);
  const id = String(req.params.id);
  await prisma.$transaction([
    prisma.doctorTreatment.deleteMany({ where: { doctorId: id } }),
    prisma.doctorTreatment.createMany({ data: body.treatments.map((t) => ({ doctorId: id, treatmentId: t.treatmentId, durationOverride: t.durationOverride ?? null, priceOverridePaise: t.priceOverridePaise ?? null })) }),
  ]);
  await audit(req, "doctor.treatments", "Doctor", id, undefined, body);
  res.json({ data: await prisma.doctor.findUniqueOrThrow({ where: { id }, include: doctorInclude }) });
});

/** Replaces the weekly schedule (shifts + breaks) atomically. Existing bookings are not moved. */
doctorsRouter.put("/:id/schedule", authorize("doctors:manage", "doctors:self"), async (req, res) => {
  const id = await resolveDoctorId(req);
  await canManageDoctor(req, id);
  const range = z.object({ weekday: z.coerce.number().int().min(0).max(6), startMinute: minute, endMinute: minute, label: optText(40) }).refine((r) => r.endMinute > r.startMinute, "End must be after start");
  const body = parse(z.object({ shifts: z.array(range).max(50), breaks: z.array(range).max(50).default([]) }), req.body);
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const s = body.shifts.filter((x) => x.weekday === day).sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < s.length; i++) if (s[i].startMinute < s[i - 1].endMinute) throw conflict("Shifts on the same day must not overlap");
  }
  const before = await prisma.doctorSchedule.findMany({ where: { doctorId: id } });
  await prisma.$transaction([
    prisma.doctorSchedule.deleteMany({ where: { doctorId: id } }),
    prisma.doctorBreak.deleteMany({ where: { doctorId: id } }),
    prisma.doctorSchedule.createMany({ data: body.shifts.map((s) => ({ ...s, doctorId: id })) }),
    prisma.doctorBreak.createMany({ data: body.breaks.map((b) => ({ ...b, doctorId: id })) }),
  ]);
  await audit(req, "doctor.schedule", "Doctor", id, before, body);
  res.json({ data: body });
});

doctorsRouter.post("/:id/leaves", authorize("doctors:manage", "doctors:self"), async (req, res) => {
  const id = await resolveDoctorId(req);
  await canManageDoctor(req, id);
  const body = parse(z.object({ startDate: isoDate, endDate: isoDate, reason: optText(200) }).refine((b) => b.endDate >= b.startDate, "End date must be on or after start date"), req.body);
  const leave = await prisma.doctorLeave.create({ data: { doctorId: id, startDate: dateOnly(body.startDate), endDate: dateOnly(body.endDate), reason: body.reason } });
  // Existing bookings during the leave are flagged for reception to reschedule.
  const affected = await prisma.appointment.count({ where: { doctorId: id, status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gte: dateOnly(body.startDate), lt: new Date(dateOnly(body.endDate).getTime() + 86_400_000) } } });
  await audit(req, "doctor.leave.create", "DoctorLeave", leave.id, undefined, leave);
  res.status(201).json({ data: leave, meta: { affectedAppointments: affected } });
});

doctorsRouter.delete("/:id/leaves/:leaveId", authorize("doctors:manage", "doctors:self"), async (req, res) => {
  const id = await resolveDoctorId(req);
  await canManageDoctor(req, id);
  const l = await prisma.doctorLeave.findFirst({ where: { id: String(req.params.leaveId), doctorId: id } });
  if (!l) throw notFound("Leave");
  await prisma.doctorLeave.delete({ where: { id: l.id } });
  await audit(req, "doctor.leave.delete", "DoctorLeave", l.id, l);
  res.status(204).end();
});

doctorsRouter.post("/:id/special-hours", authorize("doctors:manage", "doctors:self"), async (req, res) => {
  const id = await resolveDoctorId(req);
  await canManageDoctor(req, id);
  const body = parse(z.object({ date: isoDate, startMinute: minute, endMinute: minute, note: optText(200) }).refine((b) => b.endMinute > b.startMinute, "End must be after start"), req.body);
  const sh = await prisma.specialHours.create({ data: { doctorId: id, date: dateOnly(body.date), startMinute: body.startMinute, endMinute: body.endMinute, note: body.note } });
  await audit(req, "doctor.special_hours.create", "SpecialHours", sh.id, undefined, sh);
  res.status(201).json({ data: sh });
});

doctorsRouter.delete("/:id/special-hours/:shId", authorize("doctors:manage", "doctors:self"), async (req, res) => {
  const id = await resolveDoctorId(req);
  await canManageDoctor(req, id);
  const { count } = await prisma.specialHours.deleteMany({ where: { id: String(req.params.shId), doctorId: id } });
  if (!count) throw notFound("Special hours");
  res.status(204).end();
});

/** Hospital-wide holidays (doctorId = null). */
export const holidaysRouter = Router();
holidaysRouter.use(authenticate);
holidaysRouter.get("/", authorize("doctors:manage", "appointments:manage"), async (_req, res) => {
  res.json({ data: await prisma.doctorLeave.findMany({ where: { doctorId: null }, orderBy: { startDate: "desc" }, take: 100 }) });
});
holidaysRouter.post("/", authorize("doctors:manage"), async (req, res) => {
  const body = parse(z.object({ startDate: isoDate, endDate: isoDate, reason: z.string().trim().min(2).max(200) }).refine((b) => b.endDate >= b.startDate, "End date must be on or after start date"), req.body);
  const h = await prisma.doctorLeave.create({ data: { doctorId: null, type: "HOLIDAY", startDate: dateOnly(body.startDate), endDate: dateOnly(body.endDate), reason: body.reason } });
  await audit(req, "holiday.create", "DoctorLeave", h.id, undefined, h);
  res.status(201).json({ data: h });
});
holidaysRouter.delete("/:id", authorize("doctors:manage"), async (req, res) => {
  const { count } = await prisma.doctorLeave.deleteMany({ where: { id: String(req.params.id), doctorId: null } });
  if (!count) throw notFound("Holiday");
  await audit(req, "holiday.delete", "DoctorLeave", String(req.params.id));
  res.status(204).end();
});

