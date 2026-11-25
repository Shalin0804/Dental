# Integrations

All integrations are server-side only; no keys reach the browser except the public Razorpay key id. When credentials are missing, the feature is disabled honestly: online payment returns `PAYMENTS_DISABLED`, and notifications are logged as `SKIPPED` with the reason (Admin → Notifications, with a Retry button once configured).

## Razorpay
- Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- Flow: booking with "Pay online" → backend creates an order for the doctor's consultation fee → Checkout opens → `POST /api/payments/razorpay/verify` checks `HMAC_SHA256(order_id|payment_id, key_secret)` → appointment CONFIRMED + paid invoice. Unpaid holds are cancelled after 15 minutes.
- Webhook: `POST /api/payments/webhook`, events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`. Signature verified on the raw body; event ids are stored in `WebhookEvent` so replays are ignored.
- Patients can also pay outstanding invoices online from the portal; staff issue Razorpay refunds from Billing/Payments.

## Email — Resend
- Env: `RESEND_API_KEY`, `EMAIL_FROM` (address on a domain verified in Resend).
- Templates live in `apps/backend/src/services/notify.ts` (`TEMPLATES`).

## WhatsApp Business Cloud API
- Env: `WHATSAPP_TOKEN` (system-user permanent token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_LANG` (default `en`).
- Create and get approval for these **utility** templates in Meta Business Manager, with the body variables in this order:

| Template name | Variables |
|---|---|
| `appointment_booked` | {{1}} name, {{2}} reference, {{3}} treatment, {{4}} doctor, {{5}} date/time |
| `appointment_confirmed` | same as above |
| `appointment_reminder` | {{1}} name, {{2}} doctor, {{3}} date/time, {{4}} reference |
| `appointment_cancelled` | {{1}} name, {{2}} reference, {{3}} date/time |
| `appointment_rescheduled` | {{1}} name, {{2}} reference, {{3}} new date/time, {{4}} doctor |
| `follow_up_reminder` | {{1}} name, {{2}} date |

## SMS
- Env: `SMS_PROVIDER_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`.
- The sender POSTs JSON `{ to: "+91XXXXXXXXXX", sender, message }` with `Authorization: Bearer <key>`. Most Indian gateways (MSG91, Gupshup, Twilio) need a small adapter in `deliver()` in `notify.ts` and DLT-registered templates (TRAI) — register the texts from `TEMPLATES` with your provider.

## Reminders & jobs (in-process)
`services/jobs.ts` runs inside the API: notification delivery every 15 s (exponential backoff, 5 attempts), unpaid-hold expiry every minute, 24-hour appointment reminders every 5 minutes, follow-up reminders hourly (once per day). Rows are claimed with `FOR UPDATE SKIP LOCKED`, so running several API instances is safe.
