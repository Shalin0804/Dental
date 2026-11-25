import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Router, type CookieOptions, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { loginSchema, passwordSchema, registerSchema, type RoleName } from "@sdc/shared";
import { prisma } from "../../config/db.js";
import { env, isProd } from "../../config/env.js";
import { authenticate, rolePermissions, signAccessToken } from "../../middleware/auth.js";
import { audit } from "../../services/audit.js";
import { enqueue } from "../../services/notify.js";
import { HttpError, badRequest, clientInfo, conflict, parse, unauthorized } from "../../utils/http.js";
import { nextSeq, patientCode } from "../../utils/sequence.js";

export const REFRESH_COOKIE = "sdc_rt";
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const cookieOpts = (): CookieOptions => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax", // frontend and API live on different sites in production
  path: "/api/auth",
  maxAge: env.REFRESH_TOKEN_DAYS * 86_400_000,
});
const clearCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, { ...cookieOpts(), maxAge: undefined });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Blocks cross-site form posts: a custom header forces a CORS preflight, which unknown origins fail. */
function requireCsrfHeader(req: Request) {
  if (req.get("x-sdc-csrf") !== "1") throw new HttpError(403, "CSRF", "Missing CSRF header");
}

async function issueSession(req: Request, res: Response, user: { id: string; role: { name: RoleName } }, familyId: string = randomUUID()) {
  const raw = randomBytes(48).toString("base64url");
  const { ip, userAgent } = clientInfo(req);
  const token = await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(raw), familyId, expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000), ip, userAgent },
  });
  res.cookie(REFRESH_COOKIE, raw, cookieOpts());
  return { accessToken: signAccessToken(user.id, user.role.name), refreshTokenId: token.id };
}

export async function sessionUser(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true, patient: { select: { id: true } }, doctor: { select: { id: true } } } });
  return {
    id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role.name,
    permissions: [...(await rolePermissions(u.role.name))],
    patientId: u.patient?.id ?? null, doctorId: u.doctor?.id ?? null,
  };
}

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, skip: () => env.NODE_ENV === "test" });

export const authRouter = Router();

authRouter.post("/register", authLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict("An account with this email already exists", "EMAIL_TAKEN");
  const hash = await argon2.hash(body.password, { type: argon2.argon2id });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PATIENT" } });

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: body.email, phone: body.phone, fullName: body.fullName, passwordHash: hash, roleId: role.id }, include: { role: true } });
    // Link an existing walk-in record (same phone, no account) instead of duplicating the patient.
    const existing = await tx.patient.findFirst({ where: { phone: body.phone, userId: null, deletedAt: null } });
    const data = { fullName: body.fullName, email: body.email, phone: body.phone, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined, gender: body.gender, consentAt: new Date() };
    if (existing) await tx.patient.update({ where: { id: existing.id }, data: { ...data, userId: u.id } });
    else await tx.patient.create({ data: { ...data, userId: u.id, patientCode: patientCode(await nextSeq(tx, "patient")) } });
    return u;
  });

  await enqueue({ channel: "EMAIL", template: "registration", recipient: user.email, userId: user.id, payload: { name: user.fullName } });
  const { accessToken } = await issueSession(req, res, user);
  res.status(201).json({ data: { accessToken, user: await sessionUser(user.id) } });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const invalid = unauthorized("Incorrect email or password");
  if (!user || user.deletedAt) { await argon2.hash(password); throw invalid; } // equalise timing
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(423, "LOCKED", `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
  if (!(await argon2.verify(user.passwordHash, password))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    throw invalid;
  }
  if (!user.isActive) throw new HttpError(403, "INACTIVE", "This account has been deactivated. Please contact the hospital.");
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { accessToken } = await issueSession(req, res, user);
  req.user = { id: user.id, role: user.role.name, permissions: new Set() };
  await audit(req, "auth.login", "User", user.id);
  res.json({ data: { accessToken, user: await sessionUser(user.id) } });
});

authRouter.post("/refresh", async (req, res) => {
  requireCsrfHeader(req);
  const raw: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!raw) { res.status(204).end(); return; } // no session — not an error
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: { include: { role: true } } } });
  if (!token) { clearCookie(res); throw unauthorized("Session expired"); }

  const revokeFamily = () => prisma.refreshToken.updateMany({ where: { familyId: token.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (token.revokedAt) { await revokeFamily(); clearCookie(res); throw unauthorized("Session expired"); } // reuse ⇒ likely theft
  if (token.expiresAt < new Date() || !token.user.isActive || token.user.deletedAt) { clearCookie(res); throw unauthorized("Session expired"); }

  // Claim the old token first; a concurrent refresh that loses the race is treated as reuse.
  const { count } = await prisma.refreshToken.updateMany({ where: { id: token.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count === 0) { await revokeFamily(); clearCookie(res); throw unauthorized("Session expired"); }
  const { accessToken, refreshTokenId } = await issueSession(req, res, token.user, token.familyId);
  await prisma.refreshToken.update({ where: { id: token.id }, data: { replacedBy: refreshTokenId } });
  res.json({ data: { accessToken } });
});

authRouter.post("/logout", async (req, res) => {
  requireCsrfHeader(req);
  const raw: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const t = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (t) await prisma.refreshToken.updateMany({ where: { familyId: t.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  clearCookie(res);
  res.status(204).end();
});

authRouter.get("/me", authenticate, async (req, res) => {
  res.json({ data: await sessionUser(req.user!.id) });
});

authRouter.post("/change-password", authenticate, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await argon2.verify(user.passwordHash, body.currentPassword))) throw badRequest("Current password is incorrect");
  const hash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, "auth.change_password", "User", user.id);
  res.status(204).end();
});
