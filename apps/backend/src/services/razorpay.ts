import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";

export const razorpayEnabled = () => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

function creds() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new HttpError(503, "PAYMENTS_DISABLED", "Online payments are not configured. Please choose Pay at Hospital.");
  return { id: env.RAZORPAY_KEY_ID, auth: "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64") };
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`https://api.razorpay.com/v1${path}`, { method: "POST", headers: { Authorization: creds().auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, "RAZORPAY_ERROR", json?.error?.description ?? `Razorpay request failed (${r.status})`);
  return json as T;
}

export const keyId = () => creds().id;

export const createOrder = (amountPaise: number, receipt: string, notes: Record<string, string>) =>
  call<{ id: string; amount: number; currency: string; status: string }>("/orders", { amount: amountPaise, currency: "INR", receipt: receipt.slice(0, 40), notes });

export const refundPayment = (paymentId: string, amountPaise: number, notes: Record<string, string>) =>
  call<{ id: string; status: string; amount: number }>(`/payments/${paymentId}/refund`, { amount: amountPaise, notes });

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret = env.RAZORPAY_KEY_SECRET) {
  if (!secret) return false;
  return safeEqualHex(createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex"), signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret = env.RAZORPAY_WEBHOOK_SECRET) {
  if (!secret) return false;
  return safeEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}
