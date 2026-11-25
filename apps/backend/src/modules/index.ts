import type { Router } from "express";
import { appointmentsRouter, availabilityRouter } from "./appointments/routes.js";

export function mountModules(api: Router) {
  api.use("/availability", availabilityRouter);
  api.use("/appointments", appointmentsRouter);
}
