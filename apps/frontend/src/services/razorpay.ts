import type { BookingResult } from "@sdc/shared";
import { api } from "./api";

type RazorpayCtor = new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
declare global { interface Window { Razorpay?: RazorpayCtor } }

function loadCheckout(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Razorpay failed to load")));
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

/**
 * Opens Razorpay Checkout and resolves once the backend has verified the signature.
 * The browser's success callback alone is never trusted.
 */
export async function payWithRazorpay(p: NonNullable<BookingResult["payment"]>, description: string): Promise<"paid" | "dismissed"> {
  const Razorpay = await loadCheckout();
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: p.keyId,
      order_id: p.orderId,
      amount: p.amountPaise,
      currency: p.currency,
      name: "Smile Dental Care",
      description,
      prefill: { name: p.name, email: p.email ?? undefined, contact: p.phone },
      theme: { color: "#0a5bd3" },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        api("/payments/razorpay/verify", { method: "POST", body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } })
          .then(() => resolve("paid"))
          .catch(reject);
      },
      modal: { ondismiss: () => resolve("dismissed") },
    });
    rzp.on("payment.failed", () => { /* Razorpay shows its own retry UI; webhook records the failure. */ });
    rzp.open();
  });
}
