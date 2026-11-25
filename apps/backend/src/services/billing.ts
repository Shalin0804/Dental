import { prisma, type InvoiceStatus, type Tx } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { nextSeq } from "../utils/sequence.js";
import { localDate } from "../utils/time.js";
import { assertSlotAvailable, getSettings } from "./availability.js";

export const HOLD_EXPIRED = "Online payment not completed in time";
import { notifyPatient } from "./notify.js";

export interface LineInput { description: string; quantity: number; unitPricePaise: number; treatmentId?: string | null }

/** Totals in paise. Tax applies after discount; rounding to the nearest paisa. */
export function computeTotals(items: LineInput[], discountPaise: number, taxRateBp: number) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPricePaise, 0);
  const discount = Math.min(Math.max(0, discountPaise), subtotal);
  const tax = Math.round(((subtotal - discount) * taxRateBp) / 10_000);
  return { subtotalPaise: subtotal, discountPaise: discount, taxPaise: tax, totalPaise: subtotal - discount + tax };
}

export const invoiceStatus = (total: number, paid: number, refunded = 0): InvoiceStatus => {
  const net = paid - refunded;
  return net >= total && total > 0 ? "PAID" : net > 0 ? "PARTIALLY_PAID" : "ISSUED";
};

export async function invoiceNumber(tx: Tx) {
  const s = await getSettings(tx);
  const yy = String(new Date().getFullYear()).slice(2);
  return `${s.invoicePrefix}-INV-${yy}${String(await nextSeq(tx, `invoice:${yy}`)).padStart(5, "0")}`;
}

export async function createInvoice(tx: Tx, input: { patientId: string; appointmentId?: string | null; items: LineInput[]; discountPaise?: number; notes?: string | null; dueDate?: Date | null; createdById?: string | null }) {
  const s = await getSettings(tx);
  const totals = computeTotals(input.items, input.discountPaise ?? 0, s.taxRateBp);
  return tx.invoice.create({
    data: {
      number: await invoiceNumber(tx), patientId: input.patientId, appointmentId: input.appointmentId ?? null, notes: input.notes ?? null,
      dueDate: input.dueDate ?? null, createdById: input.createdById ?? null, ...totals, status: "ISSUED",
      items: { create: input.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: i.unitPricePaise, amountPaise: i.quantity * i.unitPricePaise, treatmentId: i.treatmentId ?? null })) },
    },
  });
}

/** Serialises all money movements on one invoice / payment for the transaction's duration. */
export const lockKey = (tx: Tx, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

/** Re-derives paid/refunded totals and status from payment rows. */
export async function syncInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { include: { refunds: true } } } });
  if (inv.status === "VOID") return inv;
  const captured = inv.payments.filter((p) => ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status));
  const paid = captured.reduce((s, p) => s + p.amountPaise, 0);
  const refunded = captured.flatMap((p) => p.refunds).filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountPaise, 0);
  return tx.invoice.update({ where: { id: invoiceId }, data: { paidPaise: paid, refundedPaise: refunded, status: invoiceStatus(inv.totalPaise, paid, refunded) } });
}

/**
 * Idempotently marks a Razorpay order as captured: payment → CAPTURED, appointment → CONFIRMED,
 * and a paid consultation invoice. Called from both the checkout verify endpoint and the webhook.
 */
export async function captureRazorpay(orderId: string, paymentId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
    const p = await tx.payment.findUnique({ where: { razorpayOrderId: orderId }, include: { appointment: { include: { doctor: { include: { user: true } }, treatment: true } }, patient: true } });
    if (!p) return { status: "unknown" as const };
    if (p.status === "CAPTURED" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") return { status: "already" as const, payment: p };

    let needsRefund = false;
    if (p.invoiceId) {
      // Invoice payment: refuse to over-collect (a second order paid, or invoice voided meanwhile).
      await lockKey(tx, `invoice:${p.invoiceId}`);
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
      if (inv.status === "VOID" || inv.totalPaise - inv.paidPaise + inv.refundedPaise < p.amountPaise) needsRefund = true;
    }
    await tx.payment.update({ where: { id: p.id }, data: { status: "CAPTURED", razorpayPaymentId: paymentId, paidAt: new Date(), failureReason: needsRefund ? "Captured on an invoice that was already settled or void — refund required" : null } });
    const a = p.appointment;
    let invoiceId = p.invoiceId;
    if (a && !invoiceId) {
      const inv = await createInvoice(tx, { patientId: p.patientId, appointmentId: a.id, items: [{ description: `Consultation — ${a.doctor.user.fullName} (${a.treatment.name})`, quantity: 1, unitPricePaise: p.amountPaise }] });
      invoiceId = inv.id;
      await tx.payment.update({ where: { id: p.id }, data: { invoiceId } });
    }
    const invoice = invoiceId ? await syncInvoice(tx, invoiceId) : null;

    if (a && a.status === "PENDING") {
      await tx.appointment.update({ where: { id: a.id }, data: { status: "CONFIRMED" } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId: a.id, fromStatus: "PENDING", toStatus: "CONFIRMED", note: "Online payment verified" } });
    } else if (a && a.status === "CANCELLED") {
      // Only a payment-hold expiry may be reversed, only for a future slot, and only if it is still bookable.
      let revived = false;
      if (a.cancelReason === HOLD_EXPIRED && a.startAt > new Date()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.doctorId}))`;
        const s = await getSettings(tx);
        try {
          await assertSlotAvailable({ doctorId: a.doctorId, treatmentId: a.treatmentId, date: localDate(a.startAt, s.timezone), startAt: a.startAt, excludeAppointmentId: a.id, staff: true, durationOverride: Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60_000) }, tx);
          await tx.appointment.update({ where: { id: a.id }, data: { status: "CONFIRMED", cancelReason: null } });
          await tx.appointmentStatusHistory.create({ data: { appointmentId: a.id, fromStatus: "CANCELLED", toStatus: "CONFIRMED", note: "Late payment received; slot still free" } });
          revived = true;
        } catch { /* slot gone */ }
      }
      if (!revived) needsRefund = true;
    }
    await tx.auditLog.create({ data: { action: needsRefund ? "payment.captured_needs_refund" : "payment.captured", entity: "Payment", entityId: p.id, after: { orderId, paymentId, amountPaise: p.amountPaise } } });

    if (a && !needsRefund) {
      const s = await getSettings(tx);
      const when = new Intl.DateTimeFormat("en-IN", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" }).format(a.startAt);
      await notifyPatient(p.patient, "appointment_confirmed", { name: p.patient.fullName, reference: a.reference, treatment: a.treatment.name, doctor: a.doctor.user.fullName, when }, tx);
      await notifyPatient(p.patient, "payment_receipt", { name: p.patient.fullName, amount: `₹${(p.amountPaise / 100).toFixed(2)}`, invoice: invoice?.number ?? a.reference }, tx);
    }
    return { status: "captured" as const, payment: p, needsRefund };
  });
  if (result.status === "captured" && result.needsRefund) logger.warn({ orderId }, "Payment captured for an expired booking whose slot was re-booked — refund required");
  return result;
}

/** Cancels online bookings whose payment wasn't completed within `holdMinutes`. */
export async function expireUnpaidBookings(holdMinutes = 15) {
  const cutoff = new Date(Date.now() - holdMinutes * 60_000);
  const stale = await prisma.appointment.findMany({
    where: { status: "PENDING", paymentMethod: "RAZORPAY", createdAt: { lt: cutoff }, payments: { none: { status: "CAPTURED" } } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await prisma.$transaction([
      prisma.appointment.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", cancelReason: HOLD_EXPIRED } }),
      prisma.appointmentStatusHistory.create({ data: { appointmentId: id, fromStatus: "PENDING", toStatus: "CANCELLED", note: "Payment hold expired" } }),
      prisma.payment.updateMany({ where: { appointmentId: id, status: "CREATED" }, data: { status: "FAILED", failureReason: "Checkout not completed" } }),
    ]);
  }
  return stale.length;
}
