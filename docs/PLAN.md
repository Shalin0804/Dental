# Smile Dental Care — Architecture & Roadmap

## 1. Architecture

```
apps/frontend   React 19 + Vite + TS + Tailwind v4 + shadcn-style UI, React Router, TanStack Query, RHF + Zod, Framer Motion, Recharts
apps/backend    Express + TS, Prisma (PostgreSQL), JWT access + rotating refresh (httpOnly cookie), argon2, Socket.IO (queue), Swagger
packages/shared Zod schemas + enums shared by both apps (single source of validation truth)
```

- One REST API under `/api/*`, consistent envelope `{ data, meta? }` / `{ error: { code, message, details? } }`.
- Auth: short-lived access JWT (15 min) in memory on the client; refresh token (7 days) in httpOnly, SameSite=Strict cookie, stored hashed in DB, rotated on every use, reuse → revoke family.
- RBAC: roles map to permission strings (`appointments:read:any`, `appointments:read:own`, …); `authorize(perm)` middleware on every protected route; ownership checks in services.
- Time: all timestamps stored as `timestamptz` (UTC). Slot math done in the hospital timezone from `HospitalSettings.timezone` (default `Asia/Kolkata`).
- Double booking: `appointments` has a PostgreSQL `EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status NOT IN ('CANCELLED','NO_SHOW'))` constraint (raw SQL migration), plus booking inside a transaction. Conflict → HTTP 409.
- Payments: Razorpay order created server-side; signature verified server-side; webhook (`payment.captured`, `payment.failed`, `refund.processed`) is idempotent via unique `razorpayPaymentId` / event id.
- Notifications: outbox table (`Notification`) + worker loop with retries → providers (WhatsApp Cloud API, Resend, SMS). Provider disabled when its env vars are missing (logged as `SKIPPED`, never faked as sent).

## 2. Roadmap

| Phase | Scope |
|---|---|
| 1 | Monorepo, design system, public website, responsive layouts |
| 2 | Postgres + Prisma schema + migrations + seed, auth (register/login/refresh/logout), RBAC |
| 3 | Doctors, treatments, schedules/leave/breaks CRUD |
| 4 | Availability engine, booking, reschedule/cancel, conflict prevention |
| 5 | Admin + receptionist dashboards (real aggregates) |
| 6 | Doctor + patient portals |
| 7 | Live queue (Socket.IO), medical records, prescriptions (+ PDF, audit) |
| 8 | Invoices, payments, Razorpay, refunds, PDF invoices |
| 9 | WhatsApp / email / SMS notification engine + logs + retries |
| 10 | Tests (Vitest, Supertest, Playwright), security audit, deploy docs |

## 3. Database (Prisma) — entities

User, Role, Permission, RolePermission, RefreshToken, Patient, Doctor, Staff, Branch, Treatment, DoctorTreatment,
DoctorSchedule (weekday + shift start/end + slot buffer), DoctorBreak, DoctorLeave, SpecialHours,
Appointment (+ EXCLUDE constraint), AppointmentStatusHistory, QueueToken,
MedicalRecord, DentalExamination, Prescription, PrescriptionItem, PrescriptionRevision,
Invoice, InvoiceItem, Payment, Refund, Notification, NotificationLog,
Review, HospitalSettings, CmsContent (key/value JSON blocks for website copy), AuditLog, UploadedFile.

All tables: cuid PK, `createdAt`, `updatedAt`; `deletedAt` on Patient, Doctor, Staff, Treatment, Review, UploadedFile.

## 4. Frontend pages

Public: `/`, `/about`, `/doctors`, `/doctors/:slug`, `/treatments`, `/treatments/:slug`, `/book`, `/contact`, `/faq`, `/login`, `/register`, `/privacy`, `/terms`
Portals (role-gated layouts): `/admin/*`, `/reception/*`, `/doctor/*`, `/patient/*`, `/queue/display` (TV screen).

## 5. Backend modules

`src/modules/<name>/{routes,service,schema}.ts` for: auth, users, patients, doctors, treatments, schedules, availability,
appointments, queue, medical-records, prescriptions, invoices, payments, notifications, reports, settings, reviews, cms, audit, uploads.

## 6. Environment variables

See `.env.example`.

## 7. Phase 1 notes

The public site renders treatments/doctors/FAQ/testimonials/CMS copy from the API (`/api/public/*`).
Until the backend runs, those sections show their loading/error states — no hardcoded production data in the UI.
