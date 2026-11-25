import argon2 from "argon2";
import { Router, type Request } from "express";
import { z } from "zod";
import { ROLES, emailSchema, passwordSchema, patientDetailsSchema, phoneSchema } from "@sdc/shared";
import { prisma, type Prisma } from "../../config/db.js";
import { authenticate, authorize, has, invalidatePermissionCache } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { conflict, forbidden, notFound, pageArgs, pageMeta, pagination, parse, sortBy } from "../../utils/http.js";
import { nextSeq, patientCode } from "../../utils/sequence.js";

export const patientsRouter = Router();
export const staffRouter = Router();
export const rolesRouter = Router();

const list = (max = 30) => z.array(z.string().trim().min(1).max(100)).max(max).default([]);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const patientUpdate = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: phoneSchema,
  email: emailSchema.nullish().or(z.literal("")).transform((v) => v || null),
  dateOfBirth: z.string().date().nullish().or(z.literal("")).transform((v) => (v ? new Date(v) : null)),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullish(),
  address: optText(300),
  bloodGroup: optText(5),
  allergies: list(),
  conditions: list(),
  medicalHistory: optText(5000),
  emergencyContact: optText(150),
}).partial();

/**
 * Who may read a patient: staff with patients:read (reception/admin/doctors), or the patient themself.
 * Doctors are further limited to patients they have an appointment with.
 */
export async function assertPatientAccess(req: Request, patientId: string) {
  const me = await actor(req);
  if (me.patientId === patientId) return;
  if (!has(req, "patients:read")) throw forbidden();
  if (me.doctorId && !has(req, "appointments:read")) {
    const linked = await prisma.appointment.count({ where: { patientId, doctorId: me.doctorId } });
    if (!linked) throw forbidden("This patient is not assigned to you");
  }
}

patientsRouter.use(authenticate);

/** Own profile shortcut for patients. */
patientsRouter.get("/me", authorize("self:read"), async (req, res) => {
  const me = await actor(req);
  if (!me.patientId) throw notFound("Patient profile");
  res.json({ data: await prisma.patient.findUniqueOrThrow({ where: { id: me.patientId } }) });
});

patientsRouter.patch("/me", authorize("self:read"), async (req, res) => {
  const me = await actor(req);
  if (!me.patientId) throw notFound("Patient profile");
  // Patients cannot change their phone/email here (used for identity and notifications); front desk can.
  const body = parse(patientUpdate.omit({ phone: true, email: true }), req.body);
  const before = await prisma.patient.findUniqueOrThrow({ where: { id: me.patientId } });
  const p = await prisma.patient.update({ where: { id: me.patientId }, data: body });
  if (body.fullName) await prisma.user.update({ where: { id: req.user!.id }, data: { fullName: body.fullName } });
  await audit(req, "patient.self_update", "Patient", p.id, before, p);
  res.json({ data: p });
});

patientsRouter.get("/", authorize("patients:read"), async (req, res) => {
  const q = parse(pagination, req.query);
  const me = await actor(req);
  const where: Prisma.PatientWhereInput = {
    deletedAt: null,
    // Doctors without hospital-wide read only see their own patients.
    ...(me.doctorId && !has(req, "appointments:read") ? { appointments: { some: { doctorId: me.doctorId } } } : {}),
    ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q.replace(/\s/g, "") } }, { patientCode: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.patient.findMany({ where, orderBy: sortBy(["createdAt", "fullName"] as const, "createdAt", q), ...pageArgs(q), include: { _count: { select: { appointments: true } } } }),
    prisma.patient.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

patientsRouter.post("/", authorize("patients:write"), async (req, res) => {
  const body = parse(patientDetailsSchema.extend({ address: optText(300), allergies: list(), conditions: list(), medicalHistory: optText(5000), emergencyContact: optText(150), bloodGroup: optText(5) }), req.body);
  const dup = await prisma.patient.findFirst({ where: { phone: body.phone, fullName: { equals: body.fullName, mode: "insensitive" }, deletedAt: null } });
  if (dup) throw conflict(`Patient already registered as ${dup.patientCode}`, "DUPLICATE_PATIENT");
  const p = await prisma.$transaction(async (tx) => tx.patient.create({
    data: { ...body, email: body.email || null, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null, patientCode: patientCode(await nextSeq(tx, "patient")), consentAt: new Date() },
  }));
  await audit(req, "patient.create", "Patient", p.id, undefined, { patientCode: p.patientCode });
  res.status(201).json({ data: p });
});

patientsRouter.get("/:id", authorize("patients:read", "self:read"), async (req, res) => {
  await assertPatientAccess(req, String(req.params.id));
  const p = await prisma.patient.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
  if (!p) throw notFound("Patient");
  await audit(req, "patient.view", "Patient", p.id);
  res.json({ data: p });
});

patientsRouter.patch("/:id", authorize("patients:write", "clinical:write"), async (req, res) => {
  await assertPatientAccess(req, String(req.params.id));
  // Doctors may update clinical fields only.
  const schema = has(req, "patients:write") ? patientUpdate : patientUpdate.pick({ allergies: true, conditions: true, medicalHistory: true, bloodGroup: true });
  const body = parse(schema, req.body);
  const before = await prisma.patient.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
  if (!before) throw notFound("Patient");
  const p = await prisma.patient.update({ where: { id: before.id }, data: body });
  await audit(req, "patient.update", "Patient", p.id, before, p);
  res.json({ data: p });
});

/** Everything for the patient chart in one call. */
patientsRouter.get("/:id/summary", authorize("patients:read", "self:read"), async (req, res) => {
  const id = String(req.params.id);
  await assertPatientAccess(req, id);
  const [appointments, invoices, prescriptions, records] = await Promise.all([
    prisma.appointment.findMany({ where: { patientId: id }, orderBy: { startAt: "desc" }, take: 50, include: { doctor: { select: { user: { select: { fullName: true } } } }, treatment: { select: { name: true } } } }),
    has(req, "billing:read") || (await actor(req)).patientId === id ? prisma.invoice.findMany({ where: { patientId: id }, orderBy: { issuedAt: "desc" }, take: 50 }) : Promise.resolve([]),
    prisma.prescription.findMany({ where: { patientId: id, ...((await actor(req)).patientId === id ? { status: "FINAL" as const } : {}) }, orderBy: { createdAt: "desc" }, take: 50, include: { doctor: { select: { user: { select: { fullName: true } } } }, items: true } }),
    has(req, "clinical:read") || (await actor(req)).patientId === id ? prisma.medicalRecord.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { doctor: { select: { user: { select: { fullName: true } } } }, examination: true, files: { where: { deletedAt: null } } } }) : Promise.resolve([]),
  ]);
  res.json({ data: { appointments, invoices, prescriptions, records } });
});

/* ================================ Staff & users ================================ */

const staffCreate = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: emailSchema,
  phone: phoneSchema.nullish().or(z.literal("")).transform((v) => v || null),
  password: passwordSchema,
  role: z.enum(["ADMIN", "RECEPTIONIST", "SUPER_ADMIN"]),
  designation: z.string().trim().min(2).max(80),
});

staffRouter.use(authenticate, authorize("staff:manage", "roles:manage"));

staffRouter.get("/", async (req, res) => {
  const q = parse(pagination.extend({ role: z.enum(ROLES).optional() }), req.query);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    role: { name: q.role ? q.role : { not: "PATIENT" } },
    ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, select: { id: true, email: true, fullName: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true, role: { select: { name: true } }, staff: { select: { designation: true } }, doctor: { select: { id: true, specialization: true } } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.user.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

staffRouter.post("/", async (req, res) => {
  const body = parse(staffCreate, req.body);
  // Only super admins can create admins.
  if (body.role !== "RECEPTIONIST" && !has(req, "roles:manage")) throw forbidden("Only a super admin can create admin accounts");
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict("A user with this email already exists", "EMAIL_TAKEN");
  const role = await prisma.role.findUniqueOrThrow({ where: { name: body.role } });
  const u = await prisma.user.create({
    data: { email: body.email, fullName: body.fullName, phone: body.phone, passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }), roleId: role.id, staff: { create: { designation: body.designation } } },
    select: { id: true, email: true, fullName: true },
  });
  await audit(req, "staff.create", "User", u.id, undefined, { email: u.email, role: body.role });
  res.status(201).json({ data: u });
});

staffRouter.patch("/:id", async (req, res) => {
  const body = parse(z.object({ fullName: z.string().trim().min(2).max(100), phone: phoneSchema.nullish().or(z.literal("")).transform((v) => v || null), isActive: z.boolean(), designation: z.string().trim().min(2).max(80), password: passwordSchema }).partial(), req.body);
  const target = await prisma.user.findFirst({ where: { id: String(req.params.id), deletedAt: null }, include: { role: true } });
  if (!target || target.role.name === "PATIENT") throw notFound("Staff member");
  if (["ADMIN", "SUPER_ADMIN"].includes(target.role.name) && !has(req, "roles:manage")) throw forbidden("Only a super admin can edit admin accounts");
  if (target.id === req.user!.id && body.isActive === false) throw conflict("You cannot deactivate your own account");
  const { designation, password, ...rest } = body;
  const u = await prisma.user.update({
    where: { id: target.id },
    data: { ...rest, ...(password ? { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } : {}), ...(designation ? { staff: { upsert: { create: { designation }, update: { designation } } } } : {}) },
    select: { id: true, email: true, fullName: true, isActive: true },
  });
  if (body.isActive === false || password) await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, body.isActive === false ? "staff.deactivate" : "staff.update", "User", u.id, { isActive: target.isActive }, { ...rest, designation, passwordChanged: !!password });
  res.json({ data: u });
});

/* ================================ Roles & permissions ================================ */

rolesRouter.use(authenticate, authorize("roles:manage", "staff:manage"));

rolesRouter.get("/", async (_req, res) => {
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({ include: { permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { users: true } } }, orderBy: { name: "asc" } }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
  ]);
  res.json({ data: { roles: roles.map((r) => ({ id: r.id, name: r.name, users: r._count.users, permissions: r.permissions.map((p) => p.permission.key) })), permissions } });
});

rolesRouter.put("/:name", authorize("roles:manage"), async (req, res) => {
  const name = parse(z.enum(ROLES), String(req.params.name));
  if (name === "SUPER_ADMIN") throw conflict("Super admin always has every permission");
  const body = parse(z.object({ permissions: z.array(z.string()).max(100) }), req.body);
  const role = await prisma.role.findUniqueOrThrow({ where: { name }, include: { permissions: { include: { permission: true } } } });
  const perms = await prisma.permission.findMany({ where: { key: { in: body.permissions } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) }),
  ]);
  invalidatePermissionCache();
  await audit(req, "role.permissions", "Role", role.id, role.permissions.map((p) => p.permission.key), perms.map((p) => p.key));
  res.json({ data: { name, permissions: perms.map((p) => p.key) } });
});
