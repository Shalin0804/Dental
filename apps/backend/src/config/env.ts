import { z } from "zod";

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  // Render provides RENDER_EXTERNAL_URL automatically for web services.
  APP_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173"),
  CORS_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(7),
  UPLOAD_DIR: z.string().default("uploads"),
  // When set, the API also serves the built frontend (single-service deploy, e.g. Render).
  STATIC_DIR: optional,
  // "lax" when frontend and API share an origin; "none" when they live on different sites (e.g. Vercel + VPS).
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  // Integrations — each is disabled (and logged as SKIPPED) when unset.
  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  WHATSAPP_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_TEMPLATE_LANG: z.string().default("en"),
  SMS_PROVIDER_URL: optional,
  SMS_API_KEY: optional,
  SMS_SENDER_ID: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
