import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma, type Prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { authenticate, authorize, has } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { getSettings } from "../../services/availability.js";
import { notifyPatient } from "../../services/notify.js";
import { kv, sendPdf, table } from "../../services/pdf.js";
import { HttpError, badRequest, forbidden, notFound, pageArgs, pageMeta, pagination, parse } from "../../utils/http.js";
import { nextSeq } from "../../utils/sequence.js";
import { formatLocal } from "../../utils/time.js";
import { assertPatientAccess } from "../people/routes.js";

export const recordsRouter = Router();
export const prescriptionsRouter = Router();
export const filesRouter = Router();

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null));

/** Linked appointment / medical record must belong to the same (live) patient. */
async function assertLinks(patientId: string, links: { appointmentId?: string | null; medicalRecordId?: string | null }) {
  if (!(await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { id: true } }))) throw notFound("Patient");
  if (links.appointmentId && !(await prisma.appointment.findFirst({ where: { id: links.appointmentId, patientId }, select: { id: true } }))) throw badRequest("Appointment does not belong to this patient");
  if (links.medicalRecordId && !(await prisma.medicalRecord.findFirst({ where: { id: links.medicalRecordId, patientId }, select: { id: true } }))) throw badRequest("Medical record does not belong to this patient");
}

async function myDoctorId(req: Request) {
  const me = await actor(req);
  if (!me.doctorId) throw forbidden("Only doctors can write clinical records");
  return me.doctorId;
}

/** Clinical read: the patient themself, or staff with clinical:read (doctors limited to own patients by assertPatientAccess). */
async function assertClinicalRead(req: Request, patientId: string) {
  const me = await actor(req);
  if (me.patientId === patientId) return;
  if (!has(req, "clinical:read")) throw forbidden();
  await assertPatientAccess(req, patientId);
}

/* ================================ Medical records ================================ */

const examSchema = z.object({
  teeth: z.record(z.string().regex(/^[1-8][1-8]$/), z.object({ condition: z.string().max(40), note: z.string().max(200).optional() })).default({}),
  oralHygiene: optText(100), gums: optText(200), occlusion: optText(200), notes: optText(2000),
});

const recordSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().nullish(),
  chiefComplaint: optText(1000),
  diagnosis: optText(2000),
  clinicalNotes: optText(10000),
  treatmentDone: optText(2000),
  followUpDate: optDate,
  examination: examSchema.nullish(),
});

const recordInclude = {
  doctor: { select: { id: true, user: { select: { fullName: true } } } },
  examination: true,
  files: { where: { deletedAt: null }, select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
  appointment: { select: { reference: true, treatment: { select: { name: true } } } },
} satisfies Prisma.MedicalRecordInclude;

recordsRouter.use(authenticate);

recordsRouter.get("/", authorize("clinical:read", "self:read"), async (req, res) => {
  const q = parse(pagination.extend({ patientId: z.string().optional() }), req.query);
  const me = await actor(req);
  const patientId = me.patientId && !has(req, "clinical:read") ? me.patientId : q.patientId;
  if (patientId) await assertClinicalRead(req, patientId);
  else if (!me.doctorId) throw badRequest("patientId is required");
  const where: Prisma.MedicalRecordWhereInput = patientId ? { patientId } : { doctorId: me.doctorId! };
  const [rows, total] = await Promise.all([
    prisma.medicalRecord.findMany({ where, include: { ...recordInclude, patient: { select: { fullName: true, patientCode: true } } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.medicalRecord.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

recordsRouter.post("/", authorize("clinical:write"), async (req, res) => {
  const doctorId = await myDoctorId(req);
  const { examination, ...body } = parse(recordSchema, req.body);
  await assertPatientAccess(req, body.patientId);
  await assertLinks(body.patientId, body);
  const r = await prisma.medicalRecord.create({
    data: { ...body, appointmentId: body.appointmentId ?? null, doctorId, ...(examination ? { examination: { create: examination } } : {}) },
    include: recordInclude,
  });
  await audit(req, "medical_record.create", "MedicalRecord", r.id, undefined, { patientId: r.patientId });
  res.status(201).json({ data: r });
});

recordsRouter.patch("/:id", authorize("clinical:write"), async (req, res) => {
  const doctorId = await myDoctorId(req);
  const before = await prisma.medicalRecord.findUnique({ where: { id: String(req.params.id) }, include: { examination: true } });
  if (!before) throw notFound("Medical record");
  if (before.doctorId !== doctorId) throw forbidden("Only the treating doctor can edit this record");
  const { examination, patientId: _p, ...body } = parse(recordSchema.partial(), req.body);
  await assertLinks(before.patientId, body);
  const r = await prisma.medicalRecord.update({
    where: { id: before.id },
    data: { ...body, ...(examination ? { examination: { upsert: { create: examination, update: examination } } } : {}) },
    include: recordInclude,
  });
  await audit(req, "medical_record.update", "MedicalRecord", r.id, before, r);
  res.json({ data: r });
});

/* ================================ Files (X-rays, reports) ================================ */

const uploadDir = path.resolve(env.UPLOAD_DIR);
mkdirSync(uploadDir, { recursive: true });
const ALLOWED = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["application/pdf", ".pdf"], ["application/dicom", ".dcm"]]);
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDir, filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED.get(file.mimetype) ?? ""}`) }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new HttpError(415, "UNSUPPORTED_FILE", "Only JPG, PNG, WebP, PDF or DICOM files are allowed"))),
});

/** Check magic bytes so a renamed executable can't pass as an image. */
async function sniff(file: string, mime: string) {
  const { open } = await import("node:fs/promises");
  const fh = await open(file, "r");
  const buf = Buffer.alloc(132);
  await fh.read(buf, 0, 132, 0);
  await fh.close();
  const hex = buf.subarray(0, 4).toString("hex");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/png") return hex === "89504e47";
  if (mime === "application/pdf") return buf.subarray(0, 4).toString() === "%PDF";
  if (mime === "image/webp") return buf.subarray(8, 12).toString() === "WEBP";
  if (mime === "application/dicom") return buf.subarray(128, 132).toString() === "DICM";
  return false;
}

filesRouter.use(authenticate);

filesRouter.post("/", authorize("clinical:write", "patients:write"), upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("Attach a file");
  try {
    const body = parse(z.object({ patientId: z.string().min(1), medicalRecordId: z.string().optional(), kind: z.enum(["XRAY", "REPORT", "PHOTO", "DOCUMENT"]) }), req.body);
    await assertPatientAccess(req, body.patientId);
    await assertLinks(body.patientId, body);
    if (!(await sniff(file.path, file.mimetype))) throw new HttpError(415, "UNSUPPORTED_FILE", "File content does not match its type");
    const f = await prisma.uploadedFile.create({
      data: { uploadedById: req.user!.id, patientId: body.patientId, medicalRecordId: body.medicalRecordId ?? null, kind: body.kind, storageKey: file.filename, originalName: file.originalname.slice(0, 200), mimeType: file.mimetype, sizeBytes: file.size },
    });
    await audit(req, "file.upload", "UploadedFile", f.id, undefined, { patientId: body.patientId, kind: body.kind });
    res.status(201).json({ data: f });
  } catch (err) {
    await unlink(file.path).catch(() => undefined);
    throw err;
  }
});

filesRouter.get("/", authorize("clinical:read", "self:read"), async (req, res) => {
  const { patientId } = parse(z.object({ patientId: z.string().min(1) }), req.query);
  await assertClinicalRead(req, patientId);
  res.json({ data: await prisma.uploadedFile.findMany({ where: { patientId, deletedAt: null }, orderBy: { createdAt: "desc" } }) });
});

/** Streams a file after an access check — uploads are never served statically. */
filesRouter.get("/:id/content", authorize("clinical:read", "self:read"), async (req, res) => {
  const f = await prisma.uploadedFile.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
  if (!f || !f.patientId) throw notFound("File");
  await assertClinicalRead(req, f.patientId);
  await audit(req, "file.view", "UploadedFile", f.id);
  res.setHeader("Content-Type", f.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${f.originalName.replace(/[^\w.-]/g, "_")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  createReadStream(path.join(uploadDir, path.basename(f.storageKey))).on("error", () => res.status(404).end()).pipe(res);
});

filesRouter.delete("/:id", authorize("clinical:write", "patients:write"), async (req, res) => {
  const f = await prisma.uploadedFile.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
  if (!f) throw notFound("File");
  if (f.patientId) await assertPatientAccess(req, f.patientId);
  await prisma.uploadedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } }); // soft delete keeps the medical record intact
  await audit(req, "file.delete", "UploadedFile", f.id);
  res.status(204).end();
});

/* ================================ Prescriptions ================================ */

const itemSchema = z.object({
  medicine: z.string().trim().min(2).max(120),
  dosage: z.string().trim().min(1).max(60),
  frequency: z.string().trim().min(1).max(60),
  duration: z.string().trim().min(1).max(60),
  instructions: optText(300),
});
const rxSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().nullish(),
  medicalRecordId: z.string().nullish(),
  diagnosis: z.string().trim().min(2).max(1000),
  notes: optText(2000),
  followUpDate: optDate,
  items: z.array(itemSchema).min(1, "Add at least one medicine").max(30),
  finalize: z.boolean().default(false),
});

const rxInclude = {
  items: { orderBy: { sortOrder: "asc" } },
  patient: { select: { id: true, fullName: true, patientCode: true, phone: true, dateOfBirth: true, gender: true, allergies: true, email: true, userId: true } },
  doctor: { select: { id: true, qualification: true, registrationNumber: true, registrationCouncil: true, specialization: true, user: { select: { fullName: true } } } },
  revisions: { select: { version: true, reason: true, editedById: true, createdAt: true }, orderBy: { version: "desc" } },
} satisfies Prisma.PrescriptionInclude;

prescriptionsRouter.use(authenticate);

async function loadRx(req: Request, id: string) {
  const rx = await prisma.prescription.findUnique({ where: { id }, include: rxInclude });
  if (!rx) throw notFound("Prescription");
  await assertClinicalRead(req, rx.patientId);
  const me = await actor(req);
  if (me.patientId === rx.patientId && rx.status !== "FINAL") throw notFound("Prescription"); // patients only see issued prescriptions
  return rx;
}

prescriptionsRouter.get("/", authorize("clinical:read", "self:read"), async (req, res) => {
  const q = parse(pagination.extend({ patientId: z.string().optional() }), req.query);
  const me = await actor(req);
  let where: Prisma.PrescriptionWhereInput;
  if (me.patientId && !has(req, "clinical:read")) where = { patientId: me.patientId, status: "FINAL" };
  else if (q.patientId) { await assertClinicalRead(req, q.patientId); where = { patientId: q.patientId }; }
  else if (me.doctorId) where = { doctorId: me.doctorId };
  else throw badRequest("patientId is required");
  if (q.q) where = { ...where, OR: [{ number: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }] };
  const [rows, total] = await Promise.all([
    prisma.prescription.findMany({ where, include: rxInclude, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.prescription.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

prescriptionsRouter.get("/:id", authorize("clinical:read", "self:read"), async (req, res) => {
  res.json({ data: await loadRx(req, String(req.params.id)) });
});

prescriptionsRouter.post("/", authorize("clinical:write"), async (req, res) => {
  const doctorId = await myDoctorId(req);
  const { items, finalize, ...body } = parse(rxSchema, req.body);
  await assertPatientAccess(req, body.patientId);
  await assertLinks(body.patientId, body);
  const rx = await prisma.$transaction(async (tx) => {
    const yy = String(new Date().getFullYear()).slice(2);
    const r = await tx.prescription.create({
      data: {
        ...body, appointmentId: body.appointmentId ?? null, medicalRecordId: body.medicalRecordId ?? null, doctorId,
        number: `RX-${yy}${String(await nextSeq(tx, `rx:${yy}`)).padStart(5, "0")}`,
        status: finalize ? "FINAL" : "DRAFT", finalizedAt: finalize ? new Date() : null,
        items: { create: items.map((i, n) => ({ ...i, sortOrder: n })) },
      },
      include: rxInclude,
    });
    if (finalize) await notifyRx(r, tx);
    return r;
  });
  await audit(req, finalize ? "prescription.issue" : "prescription.draft", "Prescription", rx.id, undefined, { number: rx.number });
  res.status(201).json({ data: rx });
});

async function notifyRx(rx: Prisma.PrescriptionGetPayload<{ include: typeof rxInclude }>, tx: Prisma.TransactionClient) {
  await notifyPatient({ id: rx.patient.id, email: rx.patient.email, phone: rx.patient.phone, userId: rx.patient.userId }, "prescription_ready", { name: rx.patient.fullName, doctor: rx.doctor.user.fullName, number: rx.number }, tx);
}

/**
 * Edit. Drafts are edited freely by their author. Issued prescriptions require a reason;
 * the previous version is snapshotted to PrescriptionRevision (immutable audit trail) and the version bumps.
 */
prescriptionsRouter.put("/:id", authorize("clinical:write"), async (req, res) => {
  const doctorId = await myDoctorId(req);
  const { items, finalize, patientId: _p, ...body } = parse(rxSchema.extend({ reason: z.string().trim().max(300).optional() }), req.body);
  const reason = (req.body as { reason?: string }).reason?.trim();
  const before = await prisma.prescription.findUnique({ where: { id: String(req.params.id) }, include: rxInclude });
  if (!before) throw notFound("Prescription");
  if (before.doctorId !== doctorId) throw forbidden("Only the prescribing doctor can edit this prescription");
  if (before.status === "FINAL" && (!reason || reason.length < 5)) throw badRequest("A reason is required to amend an issued prescription", { reason: ["Required"] });

  const rx = await prisma.$transaction(async (tx) => {
    if (before.status === "FINAL") {
      await tx.prescriptionRevision.create({ data: { prescriptionId: before.id, version: before.version, snapshot: JSON.parse(JSON.stringify(before)), reason: reason!, editedById: req.user!.id } });
    }
    await tx.prescriptionItem.deleteMany({ where: { prescriptionId: before.id } });
    const nowFinal = before.status === "FINAL" || finalize;
    const r = await tx.prescription.update({
      where: { id: before.id },
      data: {
        diagnosis: body.diagnosis, notes: body.notes, followUpDate: body.followUpDate,
        version: before.status === "FINAL" ? before.version + 1 : before.version,
        status: nowFinal ? "FINAL" : "DRAFT", finalizedAt: before.finalizedAt ?? (nowFinal ? new Date() : null),
        items: { create: items.map((i, n) => ({ ...i, sortOrder: n })) },
      },
      include: rxInclude,
    });
    if (nowFinal) await notifyRx(r, tx);
    return r;
  });
  await audit(req, before.status === "FINAL" ? "prescription.amend" : "prescription.update", "Prescription", rx.id, { version: before.version, items: before.items }, { version: rx.version, items: rx.items, reason });
  res.json({ data: rx });
});

prescriptionsRouter.get("/:id/pdf", authorize("clinical:read", "self:read"), async (req, res) => {
  const rx = await loadRx(req, String(req.params.id));
  const s = await getSettings();
  const age = rx.patient.dateOfBirth ? `${Math.floor((Date.now() - rx.patient.dateOfBirth.getTime()) / 31_557_600_000)} yrs` : null;
  await audit(req, "prescription.pdf", "Prescription", rx.id);
  sendPdf(res, `${rx.number}.pdf`, s, `Prescription ${rx.number}${rx.status === "DRAFT" ? " (DRAFT)" : rx.version > 1 ? ` (amended v${rx.version})` : ""}`, (doc) => {
    kv(doc, [
      ["Patient", rx.patient.fullName], ["Patient ID", rx.patient.patientCode], ["Age / Sex", [age, rx.patient.gender?.toLowerCase()].filter(Boolean).join(" / ")],
      ["Date", formatLocal(rx.finalizedAt ?? rx.createdAt, s.timezone)], ["Doctor", rx.doctor.user.fullName], ["Reg. no.", rx.doctor.registrationNumber],
    ]);
    if (rx.patient.allergies.length) doc.fillColor("#b42318").fontSize(9.5).text(`Allergies: ${rx.patient.allergies.join(", ")}`).moveDown(0.4);
    doc.fillColor("#0b1b33").font("Helvetica-Bold").fontSize(10.5).text("Diagnosis").font("Helvetica").fontSize(10).text(rx.diagnosis).moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0a5bd3").text("Rx").font("Helvetica").moveDown(0.2);
    table(doc, [{ label: "#", width: 24 }, { label: "Medicine", width: 150 }, { label: "Dosage", width: 70 }, { label: "Frequency", width: 85 }, { label: "Duration", width: 70 }, { label: "Instructions", width: 100 }],
      rx.items.map((i, n) => [String(n + 1), i.medicine, i.dosage, i.frequency, i.duration, i.instructions ?? ""]));
    if (rx.notes) doc.font("Helvetica-Bold").fontSize(10).text("Advice").font("Helvetica").text(rx.notes).moveDown(0.6);
    if (rx.followUpDate) doc.font("Helvetica-Bold").text(`Follow-up: ${rx.followUpDate.toISOString().slice(0, 10)}`).font("Helvetica");
    doc.moveDown(3);
    doc.fontSize(10).text(rx.doctor.user.fullName, { align: "right" }).fontSize(8.5).fillColor("#5b6b82").text(`${rx.doctor.qualification}${rx.doctor.registrationCouncil ? ` · ${rx.doctor.registrationCouncil}` : ""}`, { align: "right" });
    doc.text("Digitally issued via Smile Dental Care — no signature required.", { align: "right" });
  });
});
