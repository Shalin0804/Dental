# Deployment

## Option A — Render (single service, recommended for demos)

`render.yaml` creates a PostgreSQL database and one Node web service that serves the API at `/api`, the React app at `/`, Swagger at `/api/docs`, and WebSockets for the live queue.

1. Open **https://render.com/deploy?repo=https://github.com/Shalin0804/Dental** (sign in with GitHub and allow access to the repo).
2. Render reads the Blueprint. Fill in the `sync: false` values:
   - `SEED_ADMIN_PASSWORD` — the super admin password (8+ chars, letter + number).
   - `SEED_DEMO_PASSWORD` — the password for all demo doctor/reception/patient accounts.
   - Leave Razorpay / Resend / WhatsApp / SMS empty unless you have credentials.
3. Click **Apply**. The first build takes ~5 minutes. On every start the service runs `prisma migrate deploy` (including the double-booking EXCLUDE constraint, which needs the `btree_gist` extension — available on Render Postgres), then the idempotent seed, then the server.
4. Your site is at `https://smile-dental-care.onrender.com` (Render may add a suffix if the name is taken — see the service page).

**Free-tier limits:** the web service sleeps after 15 minutes idle (first request takes ~50 s), the free database expires after 30 days, and the free filesystem is ephemeral — uploaded X-rays are lost on redeploy. For real use pick a paid instance, a paid database, and add a Render Disk mounted at `/opt/render/project/src/apps/backend/uploads` (or move uploads to S3/Cloudinary).

For a real hospital set `SEED_DEMO=false` before the first deploy (or delete the demo users afterwards in Admin → Staff/Doctors).

## Option B — Vercel (frontend) + VPS/Node host (API)

- **API:** `npm ci && npm run build -w @sdc/backend`, then `npm run db:deploy -w @sdc/backend && npm run db:seed -w @sdc/backend && npm start -w @sdc/backend` behind HTTPS (nginx/Caddy). Set `APP_URL=https://<frontend-domain>`, `COOKIE_SAMESITE=none` (cross-site cookie), `CORS_ORIGINS` for preview URLs.
- **Frontend (Vercel):** root `apps/frontend`, build `npm run build`, output `dist`, env `VITE_API_URL=https://<api-domain>/api`. Add a rewrite `/(.*) → /index.html` and `/sitemap.xml → https://<api-domain>/sitemap.xml`.

## Production checklist

- [ ] Strong unique `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (Render generates them).
- [ ] Super admin password changed after first login; demo accounts removed for real use.
- [ ] Managed Postgres with daily backups + point-in-time recovery enabled (Render: paid plans; or `pg_dump` cron to encrypted storage).
- [ ] HTTPS only (Render/Vercel do this; HSTS header is sent by the API).
- [ ] Razorpay: live keys, webhook `https://<host>/api/payments/webhook` with events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`.
- [ ] Resend domain verified; WhatsApp templates approved (see INTEGRATIONS.md).
- [ ] Persistent storage for uploads.
- [ ] Privacy policy & terms replaced with legal-approved text (Admin → Website CMS → Legal). Appoint a Grievance Officer per the DPDP Act and list their contact.
- [ ] Hospital settings: address, map embed, GSTIN, tax rate, timezone.
