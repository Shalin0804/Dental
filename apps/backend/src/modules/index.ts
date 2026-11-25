import type { Router } from "express";
import { auditRouter, cmsRouter, contactRouter, notificationsRouter, reportsRouter, reviewsRouter, settingsRouter } from "./admin/routes.js";
import { appointmentsRouter, availabilityRouter } from "./appointments/routes.js";
import { invoicesRouter, paymentsRouter } from "./billing/routes.js";
import { doctorsRouter, holidaysRouter, treatmentsRouter } from "./catalog/routes.js";
import { filesRouter, prescriptionsRouter, recordsRouter } from "./clinical/routes.js";
import { paymentsWebhookRouter, razorpayRouter } from "./payments/routes.js";
import { patientsRouter, rolesRouter, staffRouter } from "./people/routes.js";
import { queueRouter } from "./queue/routes.js";

export const MODULES: [string, Router][] = [
  ["/availability", availabilityRouter],
  ["/appointments", appointmentsRouter],
  ["/payments/webhook", paymentsWebhookRouter],
  ["/payments/razorpay", razorpayRouter],
  ["/payments", paymentsRouter],
  ["/invoices", invoicesRouter],
  ["/treatments", treatmentsRouter],
  ["/doctors", doctorsRouter],
  ["/holidays", holidaysRouter],
  ["/patients", patientsRouter],
  ["/staff", staffRouter],
  ["/roles", rolesRouter],
  ["/queue", queueRouter],
  ["/medical-records", recordsRouter],
  ["/prescriptions", prescriptionsRouter],
  ["/files", filesRouter],
  ["/reports", reportsRouter],
  ["/settings", settingsRouter],
  ["/cms", cmsRouter],
  ["/contact-messages", contactRouter],
  ["/reviews", reviewsRouter],
  ["/notifications", notificationsRouter],
  ["/audit-logs", auditRouter],
];

export function mountModules(api: Router) {
  for (const [path, router] of MODULES) api.use(path, router);
}
