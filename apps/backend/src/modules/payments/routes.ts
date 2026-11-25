import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { captureRazorpay, syncInvoice } from "../../services/billing.js";
import { verifyPaymentSignature, verifyWebhookSignature } from "../../services/razorpay.js";
import { emit } from "../../services/realtime.js";
import { HttpError, badRequest, parse } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";

export const paymentsWebhookRouter = Router();
export const razorpayRouter = Router();

/** Checkout success callback. Trusts nothing from the browser except what the HMAC proves. */
razorpayRouter.post("/verify", rateLimit({ windowMs: 60_000, limit: 20, skip: () => env.NODE_ENV === "test" }), async (req, res) => {
  const body = parse(z.object({ orderId: z.string().min(1).max(64), paymentId: z.string().min(1).max(64), signature: z.string().min(1).max(256) }), req.body);
  if (!verifyPaymentSignature(body.orderId, body.paymentId, body.signature)) throw new HttpError(400, "BAD_SIGNATURE", "Payment could not be verified");
  const r = await captureRazorpay(body.orderId, body.paymentId);
  if (r.status === "unknown") throw badRequest("Unknown order");
  if (r.payment?.appointmentId) emit("appointments:changed", {});
  res.json({ data: { status: "CAPTURED" } });
});

interface RazorpayEvent {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string; error_description?: string } };
    refund?: { entity: { id: string; payment_id: string; status: string } };
  };
}

/** Razorpay webhook. Mounted with express.raw() so the signature covers the exact bytes received. */
paymentsWebhookRouter.post("/", async (req, res) => {
  const raw = req.body as Buffer;
  const sig = req.get("x-razorpay-signature") ?? "";
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, sig)) throw new HttpError(400, "BAD_SIGNATURE", "Invalid webhook signature");

  const evt = JSON.parse(raw.toString("utf8")) as RazorpayEvent;
  const eventId = req.get("x-razorpay-event-id") ?? `${evt.event}:${evt.payload.payment?.entity.id ?? evt.payload.refund?.entity.id}`;
  // Idempotency: the primary key rejects a replayed event id.
  const fresh = await prisma.webhookEvent.createMany({ data: [{ id: eventId, provider: "razorpay", type: evt.event, payload: JSON.parse(raw.toString("utf8")) }], skipDuplicates: true });
  if (fresh.count === 0) { res.json({ data: { duplicate: true } }); return; }

  try {
    const pay = evt.payload.payment?.entity;
    if (evt.event === "payment.captured" && pay) await captureRazorpay(pay.order_id, pay.id);
    if (evt.event === "payment.failed" && pay) {
      await prisma.payment.updateMany({ where: { razorpayOrderId: pay.order_id, status: "CREATED" }, data: { status: "FAILED", razorpayPaymentId: pay.id, failureReason: pay.error_description?.slice(0, 300) ?? "Payment failed" } });
    }
    const ref = evt.payload.refund?.entity;
    if (evt.event.startsWith("refund.") && ref) {
      const status = evt.event === "refund.processed" ? "PROCESSED" : evt.event === "refund.failed" ? "FAILED" : null;
      if (status) {
        const refund = await prisma.refund.findUnique({ where: { razorpayRefundId: ref.id }, include: { payment: true } });
        if (refund) {
          await prisma.refund.update({ where: { id: refund.id }, data: { status } });
          if (refund.payment.invoiceId) await prisma.$transaction((tx) => syncInvoice(tx, refund.payment.invoiceId!));
        }
      }
    }
  } catch (err) {
    // Let Razorpay retry: remove the dedupe marker so the next delivery is processed.
    await prisma.webhookEvent.delete({ where: { id: eventId } }).catch(() => undefined);
    logger.error({ err, eventId }, "webhook processing failed");
    throw err;
  }
  res.json({ data: { ok: true } });
});
