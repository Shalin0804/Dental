import { prisma, type NotificationChannel, type Tx } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Notification outbox. `enqueue` writes a row (inside the caller's transaction if given);
 * the worker delivers due rows with exponential backoff. A channel whose credentials are
 * missing is marked SKIPPED with the reason — never reported as sent.
 */

type Payload = Record<string, string | number | null | undefined>;
export interface EnqueueInput { channel: NotificationChannel; template: TemplateKey; recipient: string | null | undefined; payload: Payload; userId?: string | null; patientId?: string | null }

const TEMPLATES = {
  registration: { subject: "Welcome to Smile Dental Care", text: (p: Payload) => `Hi ${p.name}, your Smile Dental Care account is ready. You can now book appointments and view your records online.` },
  appointment_confirmed: { subject: "Appointment confirmed", text: (p: Payload) => `Hi ${p.name}, your appointment (${p.reference}) for ${p.treatment} with ${p.doctor} is confirmed for ${p.when}.` },
  appointment_booked: { subject: "Appointment request received", text: (p: Payload) => `Hi ${p.name}, we received your booking ${p.reference} for ${p.treatment} with ${p.doctor} on ${p.when}. We'll confirm shortly.` },
  appointment_reminder: { subject: "Appointment reminder", text: (p: Payload) => `Reminder: ${p.name}, you have an appointment with ${p.doctor} on ${p.when} (ref ${p.reference}).` },
  appointment_cancelled: { subject: "Appointment cancelled", text: (p: Payload) => `Hi ${p.name}, your appointment ${p.reference} on ${p.when} has been cancelled.${p.reason ? ` Reason: ${p.reason}` : ""}` },
  appointment_rescheduled: { subject: "Appointment rescheduled", text: (p: Payload) => `Hi ${p.name}, your appointment ${p.reference} has been moved to ${p.when} with ${p.doctor}.` },
  payment_receipt: { subject: "Payment receipt", text: (p: Payload) => `Hi ${p.name}, we received ${p.amount} towards invoice ${p.invoice}. Thank you.` },
  prescription_ready: { subject: "Your prescription is ready", text: (p: Payload) => `Hi ${p.name}, ${p.doctor} has issued prescription ${p.number}. You can download it from your patient portal.` },
  follow_up_reminder: { subject: "Follow-up reminder", text: (p: Payload) => `Hi ${p.name}, your follow-up visit is due on ${p.when}. Book at ${env.APP_URL}/book` },
  contact_received: { subject: "New website enquiry", text: (p: Payload) => `New enquiry from ${p.name} (${p.email}, ${p.phone ?? "no phone"}): ${p.subject}` },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

/** WhatsApp approved-template names and positional params. Must match templates approved in Meta Business Manager. */
const WHATSAPP_PARAMS: Partial<Record<TemplateKey, (keyof Payload & string)[]>> = {
  appointment_confirmed: ["name", "reference", "treatment", "doctor", "when"],
  appointment_booked: ["name", "reference", "treatment", "doctor", "when"],
  appointment_reminder: ["name", "doctor", "when", "reference"],
  appointment_cancelled: ["name", "reference", "when"],
  appointment_rescheduled: ["name", "reference", "when", "doctor"],
  follow_up_reminder: ["name", "when"],
};

export async function enqueue(n: EnqueueInput, tx: Tx = prisma) {
  if (!n.recipient) return null;
  return tx.notification.create({ data: { channel: n.channel, template: n.template, recipient: n.recipient, payload: n.payload, userId: n.userId ?? null, patientId: n.patientId ?? null, status: n.channel === "IN_APP" ? "SENT" : "PENDING", sentAt: n.channel === "IN_APP" ? new Date() : null } });
}

/** Fan out to the patient's channels (email + SMS + WhatsApp) plus an in-app entry for their account. */
export async function notifyPatient(patient: { id: string; email: string | null; phone: string; userId: string | null }, template: TemplateKey, payload: Payload, tx: Tx = prisma) {
  const base = { template, payload, patientId: patient.id, userId: patient.userId };
  await enqueue({ ...base, channel: "EMAIL", recipient: patient.email }, tx);
  await enqueue({ ...base, channel: "SMS", recipient: patient.phone }, tx);
  if (WHATSAPP_PARAMS[template]) await enqueue({ ...base, channel: "WHATSAPP", recipient: patient.phone }, tx);
  if (patient.userId) await enqueue({ ...base, channel: "IN_APP", recipient: patient.userId }, tx);
}

class Skip extends Error {}
const e164 = (phone: string) => { const d = phone.replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d; };

async function deliver(channel: NotificationChannel, template: TemplateKey, to: string, p: Payload): Promise<string> {
  const t = TEMPLATES[template];
  if (channel === "EMAIL") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Skip("RESEND_API_KEY / EMAIL_FROM not configured");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: t.subject, text: t.text(p) }),
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`Resend ${r.status}: ${body.slice(0, 300)}`);
    return body.slice(0, 500);
  }
  if (channel === "WHATSAPP") {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Skip("WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured");
    const params = WHATSAPP_PARAMS[template];
    if (!params) throw new Skip(`No approved WhatsApp template mapped for ${template}`);
    const r = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: e164(to), type: "template",
        template: { name: template, language: { code: env.WHATSAPP_TEMPLATE_LANG }, components: [{ type: "body", parameters: params.map((k) => ({ type: "text", text: String(p[k] ?? "") })) }] },
      }),
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${body.slice(0, 300)}`);
    return body.slice(0, 500);
  }
  if (channel === "SMS") {
    if (!env.SMS_PROVIDER_URL || !env.SMS_API_KEY) throw new Skip("SMS_PROVIDER_URL / SMS_API_KEY not configured");
    // Generic JSON SMS gateway (MSG91 / Twilio-compatible proxies). Adjust body shape to your provider; see docs/INTEGRATIONS.md.
    const r = await fetch(env.SMS_PROVIDER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SMS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: `+${e164(to)}`, sender: env.SMS_SENDER_ID, message: t.text(p) }),
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`SMS ${r.status}: ${body.slice(0, 300)}`);
    return body.slice(0, 500);
  }
  return "in-app";
}

export const renderText = (template: string, payload: unknown) => TEMPLATES[template as TemplateKey]?.text(payload as Payload) ?? template;
export const renderSubject = (template: string) => TEMPLATES[template as TemplateKey]?.subject ?? template;

const MAX_ATTEMPTS = 5;

/** Delivers up to `limit` due notifications. Rows are claimed with SKIP LOCKED so multiple workers are safe. */
export async function processDue(limit = 20) {
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Notification" SET "nextAttemptAt" = now() + interval '5 minutes'
    WHERE id IN (SELECT id FROM "Notification" WHERE status = 'PENDING' AND "nextAttemptAt" <= now()
                 ORDER BY "nextAttemptAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  for (const { id } of claimed) {
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    const attempt = n.attempts + 1;
    try {
      const response = await deliver(n.channel, n.template as TemplateKey, n.recipient, n.payload as Payload);
      await prisma.$transaction([
        prisma.notification.update({ where: { id }, data: { status: "SENT", attempts: attempt, sentAt: new Date(), lastError: null } }),
        prisma.notificationLog.create({ data: { notificationId: id, attempt, status: "SENT", response } }),
      ]);
    } catch (err) {
      const skipped = err instanceof Skip;
      const final = skipped || attempt >= MAX_ATTEMPTS;
      const msg = (err as Error).message.slice(0, 500);
      await prisma.$transaction([
        prisma.notification.update({
          where: { id },
          data: { status: skipped ? "SKIPPED" : final ? "FAILED" : "PENDING", attempts: attempt, lastError: msg, nextAttemptAt: new Date(Date.now() + 2 ** attempt * 60_000) },
        }),
        prisma.notificationLog.create({ data: { notificationId: id, attempt, status: skipped ? "SKIPPED" : "FAILED", error: msg } }),
      ]);
      if (!skipped) logger.warn({ id, attempt, err: msg }, "notification delivery failed");
    }
  }
  return claimed.length;
}

export function startNotificationWorker(intervalMs = 15_000) {
  const tick = () => processDue().catch((err) => logger.error({ err }, "notification worker tick failed"));
  return setInterval(tick, intervalMs);
}
