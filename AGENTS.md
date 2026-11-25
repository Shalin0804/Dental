# Smile Dental Care — agent guide

Project root (absolute): `D:\CF\Codes\For demo\Dental`

When calling the claude-code MCP tool, always pass absolute paths under this project root — the tool's working directory is Antigravity's install folder, not this project.

## Stack
- npm workspaces monorepo: `apps/frontend` (React 19, Vite 8, TS, Tailwind 4, shadcn-style components in `src/components/ui`, React Router 8, TanStack Query, RHF + Zod, Framer Motion, Recharts), `apps/backend` (Express 5, TS, Prisma 7 + `@prisma/adapter-pg`, argon2, JWT, Socket.IO), `packages/shared` (Zod schemas + DTO types used by both).
- PostgreSQL 17 via `docker compose up -d` on port **5433**.

## Commands (run from root unless noted)
- `docker compose up -d` — database
- `npm run db:migrate -w @sdc/backend` / `npm run db:seed -w @sdc/backend`
- `npm run dev:api` (port 4000) and `npm run dev:web` (port 5173, proxies `/api`)
- `npm run typecheck`, `npm test -w @sdc/backend`, `npm run e2e -w @sdc/frontend`
- Production: `npm run build` then `npm run start:render -w @sdc/backend` (migrate + seed + serve API and `STATIC_DIR` frontend). Render Blueprint: `render.yaml`. Swagger: `/api/docs`.

## Rules
- Money is integer **paise**. Timestamps are UTC `timestamptz`; schedule times are minutes-from-midnight in `HospitalSettings.timezone` (default Asia/Kolkata).
- Double booking is prevented by the `appointment_no_overlap` EXCLUDE constraint (hand-written in the init migration). Never remove it; map SQLSTATE 23P01 → HTTP 409 `SLOT_TAKEN`.
- Every protected route uses `authenticate` + `authorize(<permission>)`; ownership checks live in the route/service. Permissions are listed in `apps/backend/src/config/permissions.ts`.
- API envelope: `{ data, meta? }` or `{ error: { code, message, details? } }`.
- Validate all input with Zod (`parse()` helper). Shared schemas go in `packages/shared`.
- Integrations (Razorpay, Resend, WhatsApp, SMS) must never pretend to succeed — missing credentials ⇒ notification `SKIPPED`.
- No hardcoded production data in UI: public content comes from `/api/public/*` (CMS + settings tables).
- Write audit logs (`services/audit.ts`) for clinical, billing and admin changes.
- Prisma migrations: create with `--create-only` when raw SQL is needed, then apply.
