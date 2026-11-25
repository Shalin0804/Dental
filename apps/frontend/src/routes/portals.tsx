import type { RouteObject } from "react-router";
import type { RoleName } from "@sdc/shared";
import { ToastProvider } from "@/components/dash/kit";
import DashboardLayout from "@/layouts/DashboardLayout";
import { AdminDashboard, AuditPage, CmsPage, NotificationsAdminPage, ReportsPage, ReviewsAdminPage, RolesPage, SettingsPage, StaffPage } from "@/pages/portal/Admin";
import { AppointmentsPage, StaffBookingPage } from "@/pages/portal/Appointments";
import { InvoicesPage, PaymentsPage } from "@/pages/portal/Billing";
import { DoctorsAdminPage, MyAvailabilityPage, TreatmentsAdminPage } from "@/pages/portal/Catalog";
import { DoctorHome, PatientAppointments, PatientBilling, PatientHome, PatientPrescriptions, PatientProfile, PatientRecords, ReceptionHome } from "@/pages/portal/Homes";
import { DoctorPrescriptionsPage, PatientChartPage, PatientsListPage } from "@/pages/portal/Patients";
import { QueueDisplay, QueuePage } from "@/pages/portal/Queue";
import { NotFound } from "@/pages/public/Pages";
import { RequireRole } from "./guards";

const shell = (path: string, roles: RoleName[], children: RouteObject[]): RouteObject => ({
  path,
  element: <RequireRole roles={roles}><ToastProvider><DashboardLayout /></ToastProvider></RequireRole>,
  children: [...children, { path: "*", element: <NotFound /> }],
});

export const portalRoutes: RouteObject[] = [
  shell("/admin", ["SUPER_ADMIN", "ADMIN"], [
    { index: true, element: <AdminDashboard /> },
    { path: "appointments", element: <AppointmentsPage mode="staff" /> },
    { path: "book", element: <StaffBookingPage /> },
    { path: "queue", element: <QueuePage staff /> },
    { path: "doctors", element: <DoctorsAdminPage /> },
    { path: "treatments", element: <TreatmentsAdminPage /> },
    { path: "patients", element: <PatientsListPage base="/admin/patients" /> },
    { path: "patients/:id", element: <PatientChartPage base="/admin/patients" /> },
    { path: "billing", element: <InvoicesPage /> },
    { path: "payments", element: <PaymentsPage /> },
    { path: "notifications", element: <NotificationsAdminPage /> },
    { path: "reviews", element: <ReviewsAdminPage /> },
    { path: "reports", element: <ReportsPage /> },
    { path: "cms", element: <CmsPage /> },
    { path: "staff", element: <StaffPage /> },
    { path: "roles", element: <RolesPage /> },
    { path: "settings", element: <SettingsPage /> },
    { path: "audit", element: <AuditPage /> },
  ]),
  shell("/reception", ["RECEPTIONIST"], [
    { index: true, element: <ReceptionHome /> },
    { path: "book", element: <StaffBookingPage /> },
    { path: "appointments", element: <AppointmentsPage mode="staff" /> },
    { path: "queue", element: <QueuePage staff /> },
    { path: "patients", element: <PatientsListPage base="/reception/patients" /> },
    { path: "patients/:id", element: <PatientChartPage base="/reception/patients" /> },
    { path: "billing", element: <InvoicesPage /> },
    { path: "payments", element: <PaymentsPage /> },
  ]),
  shell("/doctor", ["DOCTOR"], [
    { index: true, element: <DoctorHome /> },
    { path: "queue", element: <QueuePage staff={false} /> },
    { path: "appointments", element: <AppointmentsPage mode="doctor" /> },
    { path: "patients", element: <PatientsListPage base="/doctor/patients" /> },
    { path: "patients/:id", element: <PatientChartPage base="/doctor/patients" /> },
    { path: "prescriptions", element: <DoctorPrescriptionsPage /> },
    { path: "availability", element: <MyAvailabilityPage /> },
  ]),
  shell("/patient", ["PATIENT"], [
    { index: true, element: <PatientHome /> },
    { path: "appointments", element: <PatientAppointments /> },
    { path: "prescriptions", element: <PatientPrescriptions /> },
    { path: "records", element: <PatientRecords /> },
    { path: "billing", element: <PatientBilling /> },
    { path: "profile", element: <PatientProfile /> },
  ]),
  { path: "/queue/display", element: <QueueDisplay /> },
];
