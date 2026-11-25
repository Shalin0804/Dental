import type { RoleName } from "@sdc/shared";

/** Every permission the API checks. Seeded into Permission/RolePermission tables. */
export const PERMISSIONS = {
  "dashboard:admin": "View admin analytics",
  "dashboard:reception": "View reception dashboard",
  "roles:manage": "Manage roles, permissions and admin accounts",
  "staff:manage": "Create/edit staff accounts",
  "settings:manage": "Edit hospital settings",
  "cms:manage": "Edit website content",
  "audit:read": "Read audit logs",
  "doctors:manage": "Create/edit doctors, schedules and leave",
  "doctors:self": "Manage own availability and leave",
  "treatments:manage": "Create/edit treatments",
  "patients:read": "Read any patient profile",
  "patients:write": "Register/edit patients",
  "appointments:read": "Read all appointments",
  "appointments:manage": "Book/confirm/cancel/reschedule any appointment",
  "appointments:own": "Read/act on own appointments (doctor or patient)",
  "queue:manage": "Check-in and run the queue",
  "queue:consult": "Call and consult patients from own queue",
  "clinical:read": "Read medical records & prescriptions of assigned patients",
  "clinical:write": "Write medical records & prescriptions",
  "billing:manage": "Create invoices, record payments and refunds",
  "billing:read": "Read invoices and payments",
  "notifications:manage": "View notification logs, retry failed",
  "reviews:manage": "Moderate reviews",
  "reports:read": "Read reports",
  "self:read": "Read own profile/records",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const all = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SUPER_ADMIN: all,
  ADMIN: all.filter((p) => p !== "roles:manage"),
  DOCTOR: ["doctors:self", "appointments:own", "queue:consult", "clinical:read", "clinical:write", "patients:read", "self:read"],
  RECEPTIONIST: ["dashboard:reception", "patients:read", "patients:write", "appointments:read", "appointments:manage", "queue:manage", "billing:manage", "billing:read", "self:read"],
  PATIENT: ["appointments:own", "self:read"],
};
