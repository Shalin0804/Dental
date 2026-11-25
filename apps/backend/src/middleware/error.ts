import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "../config/db.js";
import { isProd } from "../config/env.js";
import { HttpError } from "../utils/http.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

function pgCode(err: unknown): string | undefined {
  // Driver-adapter errors surface the Postgres SQLSTATE in different places depending on the path.
  const e = err as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } }; cause?: { code?: string } };
  return e.meta?.driverAdapterError?.cause?.originalCode ?? e.meta?.driverAdapterError?.cause?.code ?? e.cause?.code ?? (String(err).includes("23P01") ? "23P01" : undefined);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (pgCode(err) === "23P01" || String((err as Error)?.message).includes("appointment_no_overlap")) {
    res.status(409).json({ error: { code: "SLOT_TAKEN", message: "That time slot was just booked. Please choose another slot." } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") { res.status(409).json({ error: { code: "DUPLICATE", message: "A record with these details already exists", details: err.meta?.target } }); return; }
    if (err.code === "P2025") { res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } }); return; }
    if (err.code === "P2003") { res.status(409).json({ error: { code: "IN_USE", message: "This record is referenced by other data" } }); return; }
  }
  if ((err as { type?: string })?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_JSON", message: "Malformed JSON body" } });
    return;
  }
  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: isProd ? "Something went wrong" : String((err as Error)?.message ?? err) } });
};
