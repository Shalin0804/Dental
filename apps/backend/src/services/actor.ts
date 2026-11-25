import type { Request } from "express";
import { prisma } from "../config/db.js";

/** The patient/doctor profile linked to the signed-in user, if any. Cached on the request. */
export async function actor(req: Request): Promise<{ patientId: string | null; doctorId: string | null }> {
  const cached = (req as Request & { _actor?: { patientId: string | null; doctorId: string | null } })._actor;
  if (cached) return cached;
  const u = req.user
    ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { patient: { select: { id: true } }, doctor: { select: { id: true } } } })
    : null;
  const a = { patientId: u?.patient?.id ?? null, doctorId: u?.doctor?.id ?? null };
  (req as Request & { _actor?: typeof a })._actor = a;
  return a;
}
