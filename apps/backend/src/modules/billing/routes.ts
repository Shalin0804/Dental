import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../../config/db.js";
import { authenticate, authorize, has } from "../../middleware/auth.js";
import { actor } from "../../services/actor.js";
import { audit } from "../../services/audit.js";
import { getSettings } from "../../services/availability.js";
import { computeTotals, createInvoice, lockKey, syncInvoice } from "../../services/billing.js";
import { notifyPatient } from "../../services/notify.js";
import { kv, rupees, sendPdf, table } from "../../services/pdf.js";
import { createOrder, keyId, refundPayment } from "../../services/razorpay.js";
import { badRequest, conflict, notFound, pageArgs, pageMeta, pagination, parse } from "../../utils/http.js";
import { formatLocal } from "../../utils/time.js";

export const invoicesRouter = Router();
export const paymentsRouter = Router();

const lineSchema = z.object({ description: z.string().trim().min(2).max(200), quantity: z.coerce.number().int().min(1).max(100), unitPricePaise: z.coerce.number().int().min(0).max(100_000_000), treatmentId: z.string().nullish() });
const invoiceSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().nullish(),
  items: z.array(lineSchema).min(1, "Add at least one item").max(50),
  discountPaise: z.coerce.number().int().min(0).default(0),
  notes: z.string().trim().max(1000).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

const invInclude = {
  items: true,
  patient: { select: { id: true, fullName: true, patientCode: true, phone: true, email: true, address: true, userId: true } },
  payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } },
  appointment: { select: { reference: true, startAt: true, doctor: { select: { user: { select: { fullName: true } } } } } },
} satisfies Prisma.InvoiceInclude;

async function loadInvoice(req: Request, id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, include: invInclude });
  if (!inv) throw notFound("Invoice");
  if (!has(req, "billing:read") && (await actor(req)).patientId !== inv.patientId) throw notFound("Invoice");
  return inv;
}

invoicesRouter.use(authenticate);

invoicesRouter.get("/", authorize("billing:read", "self:read"), async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID", "OUTSTANDING"]).optional(), patientId: z.string().optional() }), req.query);
  const me = await actor(req);
  const where: Prisma.InvoiceWhereInput = {
    ...(has(req, "billing:read") ? (q.patientId ? { patientId: q.patientId } : {}) : { patientId: me.patientId ?? "__none__" }),
    ...(q.status === "OUTSTANDING" ? { status: { in: ["ISSUED", "PARTIALLY_PAID"] } } : q.status ? { status: q.status } : {}),
    ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }, { patient: { phone: { contains: q.q } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({ where, include: { patient: { select: { fullName: true, patientCode: true } } }, orderBy: { issuedAt: "desc" }, ...pageArgs(q) }),
    prisma.invoice.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

/** Preview totals with the hospital's tax rate before saving. */
invoicesRouter.post("/preview", authorize("billing:manage"), async (req, res) => {
  const body = parse(invoiceSchema.pick({ items: true, discountPaise: true }), req.body);
  res.json({ data: computeTotals(body.items, body.discountPaise, (await getSettings()).taxRateBp) });
});

invoicesRouter.post("/", authorize("billing:manage"), async (req, res) => {
  const body = parse(invoiceSchema, req.body);
  if (!(await prisma.patient.findFirst({ where: { id: body.patientId, deletedAt: null } }))) throw notFound("Patient");
  const inv = await prisma.$transaction((tx) => createInvoice(tx, { ...body, items: body.items, dueDate: body.dueDate ? new Date(`${body.dueDate}T00:00:00Z`) : null, createdById: req.user!.id }));
  await audit(req, "invoice.create", "Invoice", inv.id, undefined, { number: inv.number, totalPaise: inv.totalPaise });
  res.status(201).json({ data: await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: invInclude }) });
});

invoicesRouter.get("/:id", authorize("billing:read", "self:read"), async (req, res) => {
  res.json({ data: await loadInvoice(req, String(req.params.id)) });
});

invoicesRouter.post("/:id/void", authorize("billing:manage"), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const id = (await loadInvoice(req, String(req.params.id))).id;
  const u = await prisma.$transaction(async (tx) => {
    await lockKey(tx, `invoice:${id}`);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.paidPaise - inv.refundedPaise > 0) throw conflict("Refund all payments before voiding this invoice");
    // Abandon any open online orders so they can't be captured onto a void invoice.
    await tx.payment.updateMany({ where: { invoiceId: id, status: "CREATED" }, data: { status: "FAILED", failureReason: "Invoice voided" } });
    return tx.invoice.update({ where: { id }, data: { status: "VOID", notes: [inv.notes, `VOID: ${reason}`].filter(Boolean).join("\n") } });
  });
  await audit(req, "invoice.void", "Invoice", id, undefined, { status: "VOID", reason });
  res.json({ data: u });
});

/** Record a payment received at the desk (cash/card/UPI/bank). Partial payments allowed. */
invoicesRouter.post("/:id/payments", authorize("billing:manage"), async (req, res) => {
  const body = parse(z.object({ amountPaise: z.coerce.number().int().min(1), method: z.enum(["CASH", "CARD", "UPI", "BANK_TRANSFER"]), reference: z.string().trim().max(100).nullish() }), req.body);
  const { id, number, patient } = await loadInvoice(req, String(req.params.id));
  const pay = await prisma.$transaction(async (tx) => {
    await lockKey(tx, `invoice:${id}`); // balance check and insert are atomic per invoice
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status === "VOID") throw conflict("Invoice is void");
    const due = inv.totalPaise - (inv.paidPaise - inv.refundedPaise);
    if (body.amountPaise > due) throw badRequest(`Amount exceeds the balance due (${rupees(due)})`);
    const p = await tx.payment.create({ data: { patientId: inv.patientId, invoiceId: id, amountPaise: body.amountPaise, method: body.method, reference: body.reference ?? null, status: "CAPTURED", paidAt: new Date(), receivedById: req.user!.id } });
    await syncInvoice(tx, id);
    await notifyPatient(patient, "payment_receipt", { name: patient.fullName, amount: rupees(body.amountPaise), invoice: number }, tx);
    return p;
  });
  await audit(req, "payment.record", "Payment", pay.id, undefined, { invoice: number, amountPaise: pay.amountPaise, method: pay.method });
  res.status(201).json({ data: pay });
});

/** Patient pays an outstanding invoice online. */
invoicesRouter.post("/:id/pay-online", authorize("self:read", "billing:manage"), async (req, res) => {
  const inv = await loadInvoice(req, String(req.params.id));
  const due = inv.totalPaise - (inv.paidPaise - inv.refundedPaise);
  if (inv.status === "VOID" || due <= 0) throw conflict("Nothing is due on this invoice");
  // Reuse the open order for the same amount instead of creating parallel payable orders.
  const open = await prisma.payment.findFirst({ where: { invoiceId: inv.id, status: "CREATED", method: "RAZORPAY", amountPaise: due, createdAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
  let orderId = open?.razorpayOrderId ?? null;
  if (!orderId) {
    const order = await createOrder(due, inv.number, { invoiceId: inv.id });
    orderId = order.id;
    await prisma.$transaction(async (tx) => {
      await lockKey(tx, `invoice:${inv.id}`);
      await tx.payment.updateMany({ where: { invoiceId: inv.id, status: "CREATED" }, data: { status: "FAILED", failureReason: "Superseded by a newer checkout" } });
      await tx.payment.create({ data: { patientId: inv.patientId, invoiceId: inv.id, amountPaise: due, method: "RAZORPAY", status: "CREATED", razorpayOrderId: order.id } });
    });
  }
  res.json({ data: { orderId, amountPaise: due, keyId: keyId(), currency: "INR", name: inv.patient.fullName, email: inv.patient.email, phone: inv.patient.phone } });
});

invoicesRouter.get("/:id/pdf", authorize("billing:read", "self:read"), async (req, res) => {
  const inv = await loadInvoice(req, String(req.params.id));
  const s = await getSettings();
  sendPdf(res, `${inv.number}.pdf`, s, `Invoice ${inv.number}${inv.status === "VOID" ? " (VOID)" : ""}`, (doc) => {
    kv(doc, [
      ["Billed to", inv.patient.fullName], ["Patient ID", inv.patient.patientCode], ["Phone", inv.patient.phone],
      ["Invoice date", formatLocal(inv.issuedAt, s.timezone)], ["Status", inv.status.replace("_", " ")], ["Appointment", inv.appointment?.reference],
    ]);
    table(doc, [{ label: "Description", width: 260 }, { label: "Qty", width: 50, align: "right" }, { label: "Rate", width: 95, align: "right" }, { label: "Amount", width: 95, align: "right" }],
      inv.items.map((i) => [i.description, String(i.quantity), rupees(i.unitPricePaise), rupees(i.amountPaise)]));
    const line = (k: string, v: string, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).text(k, 300, doc.y, { width: 140, continued: false }); doc.moveUp().text(v, 440, doc.y, { width: 107, align: "right" }); };
    line("Subtotal", rupees(inv.subtotalPaise));
    if (inv.discountPaise) line("Discount", `- ${rupees(inv.discountPaise)}`);
    if (inv.taxPaise) line(`Tax (${(s.taxRateBp / 100).toFixed(2)}%)`, rupees(inv.taxPaise));
    line("Total", rupees(inv.totalPaise), true);
    line("Paid", rupees(inv.paidPaise));
    if (inv.refundedPaise) line("Refunded", `- ${rupees(inv.refundedPaise)}`);
    line("Balance due", rupees(Math.max(0, inv.totalPaise - inv.paidPaise + inv.refundedPaise)), true);
    doc.x = 48;
    doc.moveDown(1.2);
    const paid = inv.payments.filter((p) => p.status !== "CREATED" && p.status !== "FAILED");
    if (paid.length) {
      doc.font("Helvetica-Bold").fontSize(10).text("Payments").font("Helvetica").moveDown(0.3);
      table(doc, [{ label: "Date", width: 150 }, { label: "Method", width: 110 }, { label: "Reference", width: 145 }, { label: "Amount", width: 95, align: "right" }],
        paid.map((p) => [p.paidAt ? formatLocal(p.paidAt, s.timezone) : "", p.method.replaceAll("_", " "), p.razorpayPaymentId ?? p.reference ?? "", rupees(p.amountPaise)]));
    }
    if (inv.notes) doc.fontSize(9).fillColor("#5b6b82").text(inv.notes);
  });
});

/* ================================ Payments & refunds ================================ */

paymentsRouter.use(authenticate);

paymentsRouter.get("/", authorize("billing:read", "self:read"), async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(["CREATED", "CAPTURED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]).optional(), method: z.string().optional() }), req.query);
  const me = await actor(req);
  const where: Prisma.PaymentWhereInput = {
    ...(has(req, "billing:read") ? {} : { patientId: me.patientId ?? "__none__", status: { not: "CREATED" } }),
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { OR: [{ razorpayPaymentId: { contains: q.q } }, { razorpayOrderId: { contains: q.q } }, { patient: { fullName: { contains: q.q, mode: "insensitive" } } }, { invoice: { number: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, include: { patient: { select: { fullName: true, patientCode: true } }, invoice: { select: { id: true, number: true } }, appointment: { select: { reference: true } }, refunds: true }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.payment.count({ where }),
  ]);
  res.json({ data: rows, meta: pageMeta(q, total) });
});

paymentsRouter.post("/:id/refunds", authorize("billing:manage"), async (req, res) => {
  const body = parse(z.object({ amountPaise: z.coerce.number().int().min(1), reason: z.string().trim().min(3).max(300) }), req.body);
  const id = String(req.params.id);

  // 1) Reserve the refund under a per-payment lock so concurrent requests can't exceed the paid amount.
  const { refund, p } = await prisma.$transaction(async (tx) => {
    await lockKey(tx, `payment:${id}`);
    const p = await tx.payment.findUnique({ where: { id }, include: { refunds: true } });
    if (!p) throw notFound("Payment");
    if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status)) throw conflict("Only captured payments can be refunded");
    const already = p.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountPaise, 0);
    if (body.amountPaise > p.amountPaise - already) throw badRequest(`Maximum refundable is ${rupees(p.amountPaise - already)}`);
    const refund = await tx.refund.create({ data: { paymentId: p.id, amountPaise: body.amountPaise, reason: body.reason, status: p.method === "RAZORPAY" ? "PENDING" : "PROCESSED", createdById: req.user!.id } });
    await tx.payment.update({ where: { id: p.id }, data: { status: already + body.amountPaise >= p.amountPaise ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    if (p.invoiceId) await syncInvoice(tx, p.invoiceId);
    return { refund, p };
  });

  // 2) Gateway call outside the transaction; on failure release the reservation.
  let final = refund;
  if (p.method === "RAZORPAY") {
    try {
      if (!p.razorpayPaymentId) throw conflict("Payment has no Razorpay id");
      const r = await refundPayment(p.razorpayPaymentId, body.amountPaise, { reason: body.reason.slice(0, 200), refundId: refund.id });
      final = await prisma.refund.update({ where: { id: refund.id }, data: { razorpayRefundId: r.id, status: r.status === "processed" ? "PROCESSED" : "PENDING" } });
    } catch (err) {
      await prisma.$transaction(async (tx) => {
        await lockKey(tx, `payment:${id}`);
        await tx.refund.update({ where: { id: refund.id }, data: { status: "FAILED" } });
        const rest = await tx.refund.aggregate({ where: { paymentId: id, status: { not: "FAILED" } }, _sum: { amountPaise: true } });
        await tx.payment.update({ where: { id }, data: { status: (rest._sum.amountPaise ?? 0) > 0 ? "PARTIALLY_REFUNDED" : "CAPTURED" } });
        if (p.invoiceId) await syncInvoice(tx, p.invoiceId);
      });
      throw err;
    }
  }
  await audit(req, "refund.create", "Refund", final.id, undefined, { paymentId: p.id, amountPaise: body.amountPaise, reason: body.reason, status: final.status });
  res.status(201).json({ data: final });
});
