import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Bell, CalendarClock, CalendarPlus, ClipboardList, CreditCard, FileClock, FileText, Globe, Home, LayoutDashboard, ListOrdered, LogOut, Menu,
  MessageSquareQuote, Pill, Receipt, Settings, ShieldCheck, Stethoscope, UserCog, User, Users, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { RoleName } from "@sdc/shared";
import { ToothMark } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import { cn } from "@/utils/cn";

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string };

const ADMIN: Item[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/appointments", label: "Appointments", icon: CalendarClock },
  { to: "/admin/book", label: "New booking", icon: CalendarPlus },
  { to: "/admin/queue", label: "Queue", icon: ListOrdered },
  { to: "/admin/doctors", label: "Doctors & schedules", icon: Stethoscope },
  { to: "/admin/treatments", label: "Treatments", icon: ClipboardList },
  { to: "/admin/patients", label: "Patients & records", icon: Users },
  { to: "/admin/billing", label: "Billing", icon: Receipt },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/notifications", label: "Notifications", icon: Bell },
  { to: "/admin/reviews", label: "Reviews", icon: MessageSquareQuote },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/cms", label: "Website CMS", icon: Globe },
  { to: "/admin/staff", label: "Staff", icon: UserCog },
  { to: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck, perm: "roles:manage" },
  { to: "/admin/settings", label: "Hospital settings", icon: Settings },
  { to: "/admin/audit", label: "Audit logs", icon: FileClock },
];
const RECEPTION: Item[] = [
  { to: "/reception", label: "Today", icon: LayoutDashboard },
  { to: "/reception/book", label: "New booking", icon: CalendarPlus },
  { to: "/reception/appointments", label: "Appointments", icon: CalendarClock },
  { to: "/reception/queue", label: "Queue", icon: ListOrdered },
  { to: "/reception/patients", label: "Patients", icon: Users },
  { to: "/reception/billing", label: "Billing", icon: Receipt },
  { to: "/reception/payments", label: "Payments", icon: CreditCard },
];
const DOCTOR: Item[] = [
  { to: "/doctor", label: "Dashboard", icon: LayoutDashboard },
  { to: "/doctor/queue", label: "My queue", icon: ListOrdered },
  { to: "/doctor/appointments", label: "Appointments", icon: CalendarClock },
  { to: "/doctor/patients", label: "My patients", icon: Users },
  { to: "/doctor/prescriptions", label: "Prescriptions", icon: Pill },
  { to: "/doctor/availability", label: "Availability & leave", icon: CalendarPlus },
];
const PATIENT: Item[] = [
  { to: "/patient", label: "Overview", icon: Home },
  { to: "/patient/appointments", label: "Appointments", icon: CalendarClock },
  { to: "/patient/prescriptions", label: "Prescriptions", icon: Pill },
  { to: "/patient/records", label: "Treatment history", icon: FileText },
  { to: "/patient/billing", label: "Invoices & payments", icon: Receipt },
  { to: "/patient/profile", label: "Profile", icon: User },
];

export const NAV: Record<RoleName, Item[]> = { SUPER_ADMIN: ADMIN, ADMIN, RECEPTIONIST: RECEPTION, DOCTOR, PATIENT };
const ROLE_LABEL: Record<RoleName, string> = { SUPER_ADMIN: "Super admin", ADMIN: "Admin", DOCTOR: "Doctor", RECEPTIONIST: "Reception", PATIENT: "Patient" };

function Inbox() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inbox"], queryFn: () => api<{ data: { id: string; title: string; body: string; readAt: string | null; createdAt: string }[]; meta: { unread: number } }>("/notifications/mine"), refetchInterval: 60_000 });
  const unread = q.data?.meta.unread ?? 0;
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}
        onClick={async () => { setOpen(!open); if (!open && unread) { await api("/notifications/mine/read", { method: "POST" }); qc.invalidateQueries({ queryKey: ["inbox"] }); } }}>
        <Bell />{unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500" />}
      </Button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-white p-2 shadow-lift">
          <p className="px-3 py-2 text-sm font-semibold">Notifications</p>
          <div className="max-h-96 overflow-y-auto">
            {!q.data?.data.length ? <p className="px-3 py-6 text-center text-sm text-muted">You're all caught up.</p> : q.data.data.map((n) => (
              <div key={n.id} className="rounded-xl px-3 py-2.5 hover:bg-surface">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted/70">{new Date(n.createdAt).toLocaleString("en-IN")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout() {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const nav = useNavigate();
  useEffect(() => setOpen(false), [pathname]);
  if (!user) return null;
  const items = NAV[user.role].filter((i) => !i.perm || can(i.perm));
  const root = items[0].to;

  const sidebar = (
    <nav aria-label="Dashboard" className="flex h-full flex-col">
      <Link to="/" className="flex items-center gap-2.5 px-5 py-5"><ToothMark className="size-8" /><span className="font-display font-bold">Smile Dental Care</span></Link>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === root}
            className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", isActive ? "bg-brand-600 text-white shadow-sm" : "text-ink/75 hover:bg-brand-50 hover:text-brand-700")}>
            <i.icon className="size-4.5 shrink-0" />{i.label}
          </NavLink>
        ))}
      </div>
      <div className="border-t border-line p-4">
        <p className="truncate text-sm font-semibold">{user.fullName}</p>
        <p className="truncate text-xs text-muted">{ROLE_LABEL[user.role]} · {user.email}</p>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={async () => { await logout(); nav("/login"); }}><LogOut />Sign out</Button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-surface">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-lift">
            <button className="absolute right-3 top-4 rounded-full p-2" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="-ml-2 rounded-full p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-6" /></button>
          <p className="hidden text-sm text-muted sm:block">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
          <div className="flex items-center gap-2"><Inbox /></div>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
