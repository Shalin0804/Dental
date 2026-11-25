# Smile Dental Care

Full-stack dental hospital management & appointment booking platform. *Your Smile, Our Priority.*

See `docs/PLAN.md` for architecture and roadmap, `AGENTS.md` for conventions.

## Quick start

```bash
npm install
docker compose up -d                       # Postgres on localhost:5433
cp .env.example apps/backend/.env          # fill JWT secrets
npm run db:migrate -w @sdc/backend
npm run db:seed -w @sdc/backend            # SEED_DEMO=true adds demo users
npm run dev:api                            # http://localhost:4000
npm run dev:web                            # http://localhost:5173
```

### Demo accounts (SEED_DEMO=true, development only)

| Role | Email | Password |
|---|---|---|
| Super admin | admin@smiledental.example | Admin@12345 |
| Admin | manager@smiledental.example | Demo@12345 |
| Receptionist | reception@smiledental.example | Demo@12345 |
| Doctor | dr.arjun@smiledental.example (also kavya, rohan, sneha) | Demo@12345 |
| Patient | patient@smiledental.example | Demo@12345 |

## Status

| Phase | State |
|---|---|
| 1 Setup, design system, public website | ✅ |
| 2 Schema, migrations, auth, RBAC | ✅ |
| 3–10 | in progress — see docs/PLAN.md |
