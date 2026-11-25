import type { RoleName } from "@sdc/shared";

export const homePathFor = (role: RoleName) =>
  ({ SUPER_ADMIN: "/admin", ADMIN: "/admin", DOCTOR: "/doctor", RECEPTIONIST: "/reception", PATIENT: "/patient" })[role];
