import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter } from "./modules/auth/routes.js";
import { publicRouter, sitemap } from "./modules/public/routes.js";
import { logger } from "./utils/logger.js";

export const allowedOrigins = [env.APP_URL, ...(env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])];

/** Extra module routers registered by later phases (see modules/index.ts). */
export function createApp(mount: (api: Router) => void = () => {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://checkout.razorpay.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "wss:", "https://api.razorpay.com", "https://lumberjack.razorpay.com"],
        frameSrc: ["https://api.razorpay.com", "https://checkout.razorpay.com", "https://www.google.com", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null, // HTTPS is enforced by the host + HSTS
      },
    },
  }));
  app.use(cors({ origin: allowedOrigins, credentials: true, allowedHeaders: ["Content-Type", "Authorization", "x-sdc-csrf"] }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  // Razorpay webhook needs the raw body for signature verification — mounted before express.json by the payments module.
  app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, skip: () => env.NODE_ENV === "test" }));
  api.get("/health", (_req, res) => { res.json({ data: { ok: true } }); });
  api.use("/auth", authRouter);
  api.use("/public", publicRouter);
  mount(api);

  app.get("/sitemap.xml", sitemap);
  app.use("/api", api);

  if (env.STATIC_DIR) {
    const dir = path.resolve(env.STATIC_DIR);
    app.use(express.static(dir, { index: false, maxAge: "1y", immutable: true, setHeaders: (res, file) => { if (!file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "no-cache"); } }));
    // SPA fallback for client-side routes.
    app.use((req, res, next) => {
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api") || !req.accepts("html")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(dir, "index.html"));
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
