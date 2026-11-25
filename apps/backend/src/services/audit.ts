import type { Request } from "express";
import { prisma, type Tx } from "../config/db.js";
import { clientInfo } from "../utils/http.js";

const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function audit(req: Request, action: string, entity: string, entityId?: string | null, before?: unknown, after?: unknown, tx: Tx = prisma) {
  const { ip, userAgent } = clientInfo(req);
  return tx.auditLog.create({ data: { actorId: req.user?.id ?? null, action, entity, entityId: entityId ?? null, before: json(before), after: json(after), ip, userAgent } });
}
