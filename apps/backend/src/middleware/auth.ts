import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { RoleName } from "@sdc/shared";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import type { Permission } from "../config/permissions.js";
import { forbidden, unauthorized } from "../utils/http.js";

export interface AuthUser { id: string; role: RoleName; permissions: Set<string> }

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

// ponytail: in-process cache, 60s TTL; switch to pub/sub invalidation if running multiple API instances.
let cache: { at: number; map: Map<RoleName, Set<string>> } | null = null;
export async function rolePermissions(role: RoleName) {
  if (!cache || Date.now() - cache.at > 60_000) {
    const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
    cache = { at: Date.now(), map: new Map(roles.map((r) => [r.name, new Set(r.permissions.map((p) => p.permission.key))])) };
  }
  return cache.map.get(role) ?? new Set<string>();
}
export const invalidatePermissionCache = () => { cache = null; };

export const signAccessToken = (userId: string, role: RoleName) =>
  jwt.sign({ role }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"], algorithm: "HS256" });

async function resolve(header: string | undefined): Promise<AuthUser | null> {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const p = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (!p.sub || !p.iat) return null;
    // DB check so deactivation, deletion, role changes and password changes apply immediately, not at token expiry.
    const u = await prisma.user.findUnique({ where: { id: p.sub }, select: { isActive: true, deletedAt: true, passwordChangedAt: true, role: { select: { name: true } } } });
    if (!u || !u.isActive || u.deletedAt) return null;
    if (u.passwordChangedAt && p.iat * 1000 < u.passwordChangedAt.getTime() - 1000) return null;
    return { id: p.sub, role: u.role.name, permissions: await rolePermissions(u.role.name) };
  } catch {
    return null;
  }
}

/** Requires a valid access token. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const user = await resolve(req.headers.authorization);
  if (!user) return next(unauthorized());
  req.user = user;
  next();
};

/** Attaches req.user when a valid token is present; never rejects. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  req.user = (await resolve(req.headers.authorization)) ?? undefined;
  next();
};

/** Requires ANY of the listed permissions. */
export const authorize = (...perms: Permission[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!perms.some((p) => req.user!.permissions.has(p))) return next(forbidden());
  next();
};

export const has = (req: { user?: AuthUser }, p: Permission) => !!req.user?.permissions.has(p);
