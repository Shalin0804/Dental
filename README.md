# Smile Dental Care

Full-stack dental hospital management & appointment booking platform — *Your Smile, Our Priority.*

- **Public website** — home, about, doctors, treatments, FAQ, contact, legal pages; all content from the database (Admin → Website CMS). SEO metadata, JSON-LD, dynamic `sitemap.xml`, `robots.txt`.
- **Booking engine** — treatment → doctor → date → live slots → details → pay at hospital or Razorpay → reference number + notifications. Doctor shifts, breaks, leave, hospital holidays, special hours, buffer time, treatment durations with per-doctor overrides, timezone-correct (Asia/Kolkata, configurable). Double booking is impossible: per-doctor advisory lock + PostgreSQL `EXCLUDE` constraint.
- **Dashboards** — Admin (analytics, every module), Receptionist (walk-ins, phone bookings, check-in, queue, billing), Doctor (queue, patient chart, clinical records, tooth chart, prescriptions, availability), Patient (appointments, cancel/reschedule, prescriptions, records, invoices, online payment, profile).
- **Live queue** — tokens, emergency priority, call/consult/skip/complete, estimated wait, WebSocket updates, TV display at `/queue/display`.
- **Clinical** — medical records, dental examinations (FDI chart), X-ray/report uploads (type-sniffed, served only through access checks), prescriptions with draft/issue, amendment trail and PDF.
- **Billing** — invoices with discounts/tax, partial payments, refunds (desk + Razorpay), PDF invoices, idempotent Razorpay webhooks.
- **Notifications** — WhatsApp templates, email (Resend), SMS; outbox with retries, delivery log, in-app inbox; reminders and follow-ups.
- **Security** — argon2id, 15-min JWT + rotating refresh tokens with reuse detection, account lockout, RBAC with editable permissions, ownership checks, rate limits, CSP/HSTS, CSRF header, audit logs on every sensitive action. API docs at `/api/docs`.

Docs: [`docs/PLAN.md`](docs/PLAN.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) · [`docs/SECURITY.md`](docs/SECURITY.md) · [`AGENTS.md`](AGENTS.md)

## Quick start (local)

```bash
npm install
docker compose up -d                        # Postgres 17 on localhost:5433
cp .env.example apps/backend/.env           # set the two JWT secrets
npm run db:migrate -w @sdc/backend
npm run db:seed -w @sdc/backend             # SEED_DEMO=true adds demo users
npm run dev:api                             # http://localhost:4000  (Swagger: /api/docs)
npm run dev:web                             # http://localhost:5173
```

### Demo accounts (local, SEED_DEMO=true)

| Panel | URL | Email | Password |
|---|---|---|---|
| Super admin | /admin | admin@smiledental.example | Admin@12345 |
| Admin | /admin | manager@smiledental.example | Demo@12345 |
| Receptionist | /reception | reception@smiledental.example | Demo@12345 |
| Doctor | /doctor | dr.arjun@smiledental.example (also dr.kavya, dr.rohan, dr.sneha) | Demo@12345 |
| Patient | /patient | patient@smiledental.example | Demo@12345 |

On a deployed instance the passwords are whatever you set in `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD`.

## Tests

```bash
npm test -w @sdc/backend        # 36 unit + integration tests (uses smile_dental_test DB)
npm run e2e -w @sdc/frontend    # Playwright: public site, booking, every dashboard page per role
```

Covers: slot engine (incl. DST), 10 concurrent bookings for one slot → exactly 1 succeeds, DB constraint, leave, reschedule/cancel, walk-ins, RBAC/ownership, queue priority, prescriptions & amendment trail, billing with partial payments + refunds, Razorpay webhook signature + idempotency, dashboard figures vs database.

## Status

All 10 phases implemented. Integrations are wired but need your credentials (see `docs/INTEGRATIONS.md`).
