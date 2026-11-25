import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { authRouter } from "./auth/routes.js";
import { MODULES } from "./index.js";
import { publicRouter } from "./public/routes.js";

interface RouteLayer { route?: { path: string; methods: Record<string, boolean> } }

/**
 * OpenAPI document generated from the routers actually mounted, so it cannot drift.
 * Request/response shapes are documented by the Zod schemas in packages/shared and each route file.
 */
export function openApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  const mounts: [string, Router][] = [["/auth", authRouter], ["/public", publicRouter], ...MODULES];
  for (const [base, router] of mounts) {
    const tag = base.split("/")[1];
    for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
      if (!layer.route) continue;
      const path = `/api${base}${layer.route.path === "/" ? "" : layer.route.path}`.replace(/:(\w+)/g, "{$1}");
      const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
      for (const method of Object.keys(layer.route.methods)) {
        const isPublic = tag === "public" || (tag === "auth" && !["/me", "/change-password"].includes(layer.route.path)) || path.includes("/payments/webhook") || path.includes("/razorpay/verify") || path.endsWith("/queue/display") || (tag === "availability");
        (paths[path] ??= {})[method] = {
          tags: [tag],
          summary: `${method.toUpperCase()} ${path}`,
          parameters: params,
          ...(isPublic ? { security: [] } : {}),
          responses: { 200: { description: "`{ data, meta? }`" }, 400: { description: "Validation error" }, 401: { description: "Not signed in" }, 403: { description: "Missing permission" }, 404: { description: "Not found" }, 409: { description: "Conflict (e.g. SLOT_TAKEN)" } },
        };
      }
    }
  }
  return {
    openapi: "3.1.0",
    info: { title: "Smile Dental Care API", version: "1.0.0", description: "Errors use `{ error: { code, message, details? } }`. Authenticate with `Authorization: Bearer <accessToken>` from /api/auth/login. Refresh via httpOnly cookie on POST /api/auth/refresh with header `x-sdc-csrf: 1`." },
    servers: [{ url: "/" }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    security: [{ bearer: [] }],
    paths,
  };
}

export const docsRouter = Router();
docsRouter.get("/openapi.json", (_req, res) => { res.json(openApi()); });
docsRouter.use("/", swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: "/api/docs/openapi.json" } }));
