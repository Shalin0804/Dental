import type { Request } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required") => new HttpError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have permission to do this") => new HttpError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (msg: string, code = "CONFLICT") => new HttpError(409, code, msg);

/** Parse with zod; throws a 400 with field errors on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "VALIDATION_ERROR", "Please check the highlighted fields", z.flattenError(r.error).fieldErrors);
  return r.data;
}

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export const pageArgs = (p: { page: number; pageSize: number }) => ({ skip: (p.page - 1) * p.pageSize, take: p.pageSize });
export const pageMeta = (p: { page: number; pageSize: number }, total: number) => ({ page: p.page, pageSize: p.pageSize, total, pages: Math.ceil(total / p.pageSize) });

/** Whitelisted sort: returns a Prisma orderBy for allowed fields only. */
export const sortBy = <F extends string>(allowed: readonly F[], fallback: F, p: { sort?: string; order: "asc" | "desc" }) =>
  ({ [allowed.includes(p.sort as F) ? (p.sort as F) : fallback]: p.order }) as Record<F, "asc" | "desc">;

export const clientInfo = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 300) ?? null });
