# Security & data protection

| Area | Implementation |
|---|---|
| Passwords | argon2id; min 8 chars with letter + number; 5 failed logins → 15-min lock; timing-equalised unknown-user path |
| Sessions | 15-min HS256 access JWT held in memory (never localStorage); 7-day refresh token in httpOnly cookie scoped to `/api/auth`, stored as SHA-256 hash, rotated on every use; reuse of a rotated token revokes the whole family; password change / deactivation revokes all sessions |
| CSRF | Refresh/logout require `x-sdc-csrf: 1` (forces CORS preflight); all other state-changing calls need a Bearer token, which a cross-site form cannot send |
| Authorization | Permission strings per role (DB-backed, editable by super admin) checked by `authorize()` on every protected route; ownership checks in handlers (patients see only their own data, doctors only patients they have appointments with, only the authoring doctor edits a record/prescription) |
| Validation | Zod on every input (shared schemas), whitelisted sort fields, Prisma parameterised queries; raw SQL uses tagged templates only |
| Headers | Helmet: CSP (self + Razorpay/Google Fonts/Maps), HSTS, frame-ancestors self, nosniff, no-referrer |
| Rate limits | Global 300/min/IP; login/register 20/15 min; guest bookings 15/15 min; contact 5/h; lookup 30/15 min |
| Files | MIME allow-list + magic-byte sniffing, size limit, random storage names, never served statically — streamed after an access check with `nosniff` + `no-store`; soft delete |
| Payments | No card/UPI data stored; Razorpay signatures verified with timing-safe compare; webhook body verified raw; event-id idempotency; amounts always computed server-side |
| Audit | `AuditLog` for logins, patient views, clinical/billing/admin changes, file views, exports (actor, IP, user agent, before/after) |
| Privacy (DPDP Act 2023) | Explicit consent captured at registration/booking (`consentAt`); minimal data in notifications; masked recipients in logs; public queue display shows token numbers only; data export/correction via staff; grievance officer contact to be published in the privacy policy |
| Secrets | Server-side env only; `.env` git-ignored; integrations disabled when keys absent |

Known limits / next steps: uploads on local disk (use S3/Cloudinary + encryption at rest for scale), in-process job runner (move to a queue if you scale out heavily), permission cache 60 s per instance.
