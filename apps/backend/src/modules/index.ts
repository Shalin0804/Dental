import type { Router } from "express";
import { appointmentsRouter, availabilityRouter } from "./appointments/routes.js";
import { paymentsWebhookRouter, razorpayRouter } from "./payments/routes.js";

export function mountModules(api: Router) {
  api.use("/availability", availabilityRouter);
  api.use("/appointments", appointmentsRouter);
  api.use("/payments/webhook", paymentsWebhookRouter);
  api.use("/payments/razorpay", razorpayRouter);
}
