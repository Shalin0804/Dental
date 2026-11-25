import type { Router } from "express";
import { auditRouter, cmsRouter, contactRouter, notificationsRouter, reportsRouter, reviewsRouter, settingsRouter } from "./admin/routes.js";
import { appointmentsRouter, availabilityRouter } from "./appointments/routes.js";
import { invoicesRouter, paymentsRouter } from "./billing/routes.js";
import { doctorsRouter, holidaysRouter, treatmentsRouter } from "./catalog/routes.js";
import { filesRouter, prescriptionsRouter, recordsRouter } from "./clinical/routes.js";
import { paymentsWebhookRouter, razorpayRouter } from "./payments/routes.js";
import { patientsRouter, rolesRouter, staffRouter } from "./people/routes.js";
import { queueRouter } from "./queue/routes.js";

export function mountModules(api: Router) {
  api.use("/availability", availabilityRouter);
  api.use("/appointments", appointmentsRouter);
  api.use("/payments/webhook", paymentsWebhookRouter);
  api.use("/payments/razorpay", razorpayRouter);
  api.use("/payments", paymentsRouter);
  api.use("/invoices", invoicesRouter);
  api.use("/treatments", treatmentsRouter);
  api.use("/doctors", doctorsRouter);
  api.use("/holidays", holidaysRouter);
  api.use("/patients", patientsRouter);
  api.use("/staff", staffRouter);
  api.use("/roles", rolesRouter);
  api.use("/queue", queueRouter);
  api.use("/medical-records", recordsRouter);
  api.use("/prescriptions", prescriptionsRouter);
  api.use("/files", filesRouter);
  api.use("/reports", reportsRouter);
  api.use("/settings", settingsRouter);
  api.use("/cms", cmsRouter);
  api.use("/contact-messages", contactRouter);
  api.use("/reviews", reviewsRouter);
  api.use("/notifications", notificationsRouter);
  api.use("/audit-logs", auditRouter);
}
