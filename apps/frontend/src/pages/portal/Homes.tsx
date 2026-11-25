import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarCheck, CalendarClock, CalendarPlus, Clock3, FileDown, IndianRupee, ListOrdered, Pill, Stethoscope, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { passwordSchema } from "@sdc/shared";
import { DataTable, PageHead, Stat, StatusBadge, Tabs, openPdf, send, useAction, useGet, useList, useLive, type Column } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { api, setAccessToken } from "@/services/api";
import type { Appointment, InvoiceRow, MedicalRecord, Patient, Payment, Prescription } from "@/types/api";
import { formatINR } from "@/utils/format";
import { fmtDate, fmtDateTime, fmtTime } from "@/utils/time";
import { AppointmentsPage } from "./Appointments";
import { InvoiceDetailModal } from "./Billing";
import { PrescriptionCard, RecordCard } from "./Patients";

function TodayList({ base, doctor }: { base: string; doctor?: boolean }) {
  const list = useList<Appointment>("/appointments", { when: "today", pageSize: 50 });
  useLive("appointments:changed", [["/appointments"]]);
  const cols: Column<Appointment>[] = [
    { key: "t", label: "Time", render: (a) => <b>{fmtTime(a.startAt)}</b> },
    { key: "p", label: "Patient", render: (a) => doctor ? <Link className="font-medium text-brand-700 hover:underline" to={`/doctor/patients/${a.patientId}`}>{a.patient.fullName}</Link> : <>{a.patient.fullName}<p className="text-xs text-muted">{a.patient.phone}</p></> },
    ...(!doctor ? [{ key: "d", label: "Doctor", render: (a: Appointment) => a.doctor.user.fullName }] : []),
    { key: "tr", label: "Treatment", render: (a) => a.treatment.name },
    { key: "s", label: "Status", render: (a) => <><StatusBadge status={a.status} />{a.queueToken && <span className="ml-2 text-xs text-muted">#{a.queueToken.tokenNumber}</span>}</> },
  ];
  return (
    <section>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Today's appointments</h2><Link to={`${base}/appointments`} className="text-sm font-medium text-brand-700">Manage →</Link></div>
      <DataTable columns={cols} query={list} empty="No appointments today." />
    </section>
  );
}

export function ReceptionHome() {
  const r = useGet<{ today: number; byStatus: Record<string, number>; waiting: number; collectedTodayPaise: number; unconfirmed: number }>("/reports/reception");
  useLive("queue:changed", [["/reports/reception"]]);
  return (
    <>
      <PageHead title="Front desk" actions={<><Button variant="outline" asChild><Link to="/reception/queue"><ListOrdered />Queue</Link></Button><Button asChild><Link to="/reception/book"><CalendarPlus />New booking</Link></Button></>} />
      {!r.data ? <Skeleton className="h-28" /> : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Appointments today" value={r.data.today} hint={`${r.data.byStatus.CHECKED_IN ?? 0} checked in · ${r.data.byStatus.COMPLETED ?? 0} completed`} icon={CalendarClock} />
          <Stat label="Waiting in queue" value={r.data.waiting} icon={Users} tone="amber" />
          <Stat label="Awaiting confirmation" value={r.data.unconfirmed} icon={Clock3} tone="amber" />
          <Stat label="Collected today" value={formatINR(r.data.collectedTodayPaise)} icon={IndianRupee} tone="green" />
        </div>
      )}
      <TodayList base="/reception" />
    </>
  );
}

export function DoctorHome() {
  const { user } = useAuth();
  const r = useGet<{ today: number; upcoming: number; seenThisMonth: number; prescriptions: number; waiting: number }>("/reports/doctor");
  useLive("queue:changed", [["/reports/doctor"]]);
  const next = useAction(() => send("/queue/call-next")({}), { success: "Next patient called", invalidate: [["/reports/doctor"], ["queue"]] });
  return (
    <>
      <PageHead title={`Good day, ${user?.fullName.split(" ").slice(0, 2).join(" ")}`} actions={<><Button variant="outline" asChild><Link to="/doctor/queue"><ListOrdered />My queue</Link></Button><Button loading={next.isPending} onClick={() => next.mutate()}><BellRing />Call next patient</Button></>} />
      {!r.data ? <Skeleton className="h-28" /> : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Today" value={r.data.today} icon={CalendarClock} />
          <Stat label="Waiting now" value={r.data.waiting} icon={Users} tone="amber" />
          <Stat label="Seen this month" value={r.data.seenThisMonth} icon={Stethoscope} tone="green" />
          <Stat label="Upcoming bookings" value={r.data.upcoming} hint={`${r.data.prescriptions} prescriptions this month`} icon={CalendarCheck} />
        </div>
      )}
      <TodayList base="/doctor" doctor />
    </>
  );
}

/* ================================ Patient portal ================================ */

export function PatientHome() {
  const { user } = useAuth();
  const upcoming = useList<Appointment>("/appointments", { when: "upcoming", pageSize: 3 });
  const token = useQuery({ queryKey: ["queue", "mine"], queryFn: () => api<{ data: { id: string; tokenNumber: number; status: string; doctor: string; estimatedWaitMinutes: number | null }[] | null }>("/queue/mine").then((r) => r.data), refetchInterval: 30_000 });
  useLive("queue:changed", [["queue", "mine"]]);
  const rx = useList<Prescription>("/prescriptions", { pageSize: 3 });
  return (
    <>
      <PageHead title={`Hello, ${user?.fullName.split(" ")[0]}`} subtitle="Your dental care at a glance." actions={<Button asChild><Link to="/book"><CalendarPlus />Book appointment</Link></Button>} />
      {token.data?.map((t) => (
        <Card key={t.id} className="mb-6 flex flex-wrap items-center gap-5 border-brand-200 bg-brand-50 p-5">
          <span className="grid size-16 place-items-center rounded-2xl bg-brand-600 font-display text-2xl font-bold text-white">{t.tokenNumber}</span>
          <div><p className="font-semibold">Your queue token with {t.doctor}</p><p className="text-sm text-muted">{t.status === "CALLED" ? "You're being called — please proceed to the consultation room." : t.status === "IN_CONSULTATION" ? "In consultation." : `Estimated wait about ${t.estimatedWaitMinutes ?? "—"} minutes.`}</p></div>
          <StatusBadge status={t.status} />
        </Card>
      ))}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Upcoming appointments</h2><Link className="text-sm font-medium text-brand-700" to="/patient/appointments">All →</Link></div>
          {!upcoming.data ? <Skeleton className="h-32" /> : !upcoming.data.data.length ? <EmptyState>No upcoming appointments. <Link to="/book" className="text-brand-700 underline">Book one</Link></EmptyState> : (
            <ul className="divide-y divide-line">{upcoming.data.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{fmtDateTime(a.startAt)}</p><p className="text-sm text-muted">{a.treatment.name} · {a.doctor.user.fullName} · {a.reference}</p></div><StatusBadge status={a.status} /></li>
            ))}</ul>
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent prescriptions</h2><Link className="text-sm font-medium text-brand-700" to="/patient/prescriptions">All →</Link></div>
          {!rx.data ? <Skeleton className="h-32" /> : !rx.data.data.length ? <EmptyState>No prescriptions yet.</EmptyState> : (
            <ul className="divide-y divide-line">{rx.data.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium"><Pill className="mr-1 inline size-4 text-brand-500" />{r.number}</p><p className="text-sm text-muted">{fmtDate(r.finalizedAt ?? r.createdAt)} · {r.doctor.user.fullName}</p></div><Button size="sm" variant="outline" onClick={() => openPdf(`/prescriptions/${r.id}/pdf`)}><FileDown />PDF</Button></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}

export const PatientAppointments = () => <AppointmentsPage mode="patient" />;

export function PatientPrescriptions() {
  const list = useList<Prescription>("/prescriptions", { pageSize: 50 });
  return (
    <>
      <PageHead title="Prescriptions" />
      {!list.data ? <Skeleton className="h-64" /> : !list.data.data.length ? <EmptyState>No prescriptions yet.</EmptyState> : <div className="space-y-4">{list.data.data.map((r) => <PrescriptionCard key={r.id} rx={r} />)}</div>}
    </>
  );
}

export function PatientRecords() {
  const list = useList<MedicalRecord>("/medical-records", { pageSize: 50 });
  return (
    <>
      <PageHead title="Treatment history" subtitle="Clinical notes and examinations from your visits." />
      {!list.data ? <Skeleton className="h-64" /> : !list.data.data.length ? <EmptyState>No records yet.</EmptyState> : <div className="space-y-4">{list.data.data.map((r) => <RecordCard key={r.id} r={r} />)}</div>}
    </>
  );
}

export function PatientBilling() {
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const inv = useList<InvoiceRow>("/invoices", { pageSize: 50 });
  const pay = useList<Payment>("/payments", { pageSize: 50 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHead title="Invoices & payments" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "invoices", label: "Invoices" }, { value: "payments", label: "Payment history" }]} />
      {tab === "invoices" ? (
        <DataTable query={inv} onRowClick={(i) => setOpen(i.id)} empty="No invoices yet." columns={[
          { key: "n", label: "Invoice", render: (i) => <><p className="font-medium">{i.number}</p><p className="text-xs text-muted">{fmtDate(i.issuedAt)}</p></> },
          { key: "t", label: "Total", render: (i) => formatINR(i.totalPaise) },
          { key: "d", label: "Due", render: (i) => formatINR(Math.max(0, i.totalPaise - i.paidPaise + i.refundedPaise)) },
          { key: "s", label: "Status", render: (i) => <StatusBadge status={i.status} /> },
          { key: "x", label: "", render: (i) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openPdf(`/invoices/${i.id}/pdf`); }}><FileDown />PDF</Button> },
        ]} />
      ) : (
        <DataTable query={pay} empty="No payments yet." columns={[
          { key: "d", label: "Date", render: (p) => fmtDateTime(p.paidAt ?? p.createdAt) },
          { key: "f", label: "For", render: (p) => p.invoice?.number ?? p.appointment?.reference ?? "—" },
          { key: "m", label: "Method", render: (p) => p.method.replaceAll("_", " ") },
          { key: "a", label: "Amount", render: (p) => formatINR(p.amountPaise) },
          { key: "s", label: "Status", render: (p) => <StatusBadge status={p.status} /> },
        ]} />
      )}
      {open && <InvoiceDetailModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function PatientProfile() {
  const p = useGet<Patient>("/patients/me");
  if (!p.data) return <Skeleton className="h-96" />;
  return <ProfileForm key={p.dataUpdatedAt} p={p.data} />;
}

function ProfileForm({ p }: { p: Patient }) {
  const [f, setF] = useState({ fullName: p.fullName, dateOfBirth: p.dateOfBirth?.slice(0, 10) ?? "", gender: p.gender ?? "", address: p.address ?? "", bloodGroup: p.bloodGroup ?? "", emergencyContact: p.emergencyContact ?? "", allergies: p.allergies.join(", "), conditions: p.conditions.join(", "), medicalHistory: p.medicalHistory ?? "" });
  const save = useAction(() => send("/patients/me", "PATCH")({ ...f, gender: f.gender || null, allergies: f.allergies.split(",").map((s) => s.trim()).filter(Boolean), conditions: f.conditions.split(",").map((s) => s.trim()).filter(Boolean) }), { success: "Profile updated", invalidate: [["/patients/me"]] });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const pwOk = passwordSchema.safeParse(pw.newPassword).success;
  const changePw = useAction(() => (send("/auth/change-password")(pw) as Promise<{ data: { accessToken: string } }>).then((r) => setAccessToken(r.data.accessToken)), { success: "Password changed. Other devices were signed out.", onSuccess: () => setPw({ currentPassword: "", newPassword: "" }) });
  const v = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <>
      <PageHead title="My profile" subtitle={`Patient ID ${p.patientCode} · ${p.phone}${p.email ? ` · ${p.email}` : ""}`} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label="Full name">{(a) => <Input {...a} {...v("fullName")} />}</Field>
          <Field label="Date of birth">{(a) => <Input {...a} type="date" {...v("dateOfBirth")} />}</Field>
          <Field label="Gender">{(a) => <Select {...a} {...v("gender")}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select>}</Field>
          <Field label="Blood group">{(a) => <Input {...a} {...v("bloodGroup")} maxLength={5} />}</Field>
          <Field label="Address" className="sm:col-span-2">{(a) => <Input {...a} {...v("address")} />}</Field>
          <Field label="Emergency contact" className="sm:col-span-2">{(a) => <Input {...a} {...v("emergencyContact")} />}</Field>
          <Field label="Allergies" hint="Comma separated — shown to your doctor">{(a) => <Input {...a} {...v("allergies")} />}</Field>
          <Field label="Existing conditions" hint="e.g. diabetes, hypertension">{(a) => <Input {...a} {...v("conditions")} />}</Field>
          <Field label="Medical history" className="sm:col-span-2">{(a) => <Textarea {...a} {...v("medicalHistory")} />}</Field>
          <div className="sm:col-span-2"><Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button></div>
          <p className="text-xs text-muted sm:col-span-2">To change your phone number or email, please contact the front desk.</p>
        </Card>
        <Card className="h-fit space-y-4 p-6">
          <h2 className="font-semibold">Change password</h2>
          <Field label="Current password">{(a) => <Input {...a} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
          <Field label="New password" hint="8+ characters, a letter and a number">{(a) => <Input {...a} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
          <Button disabled={!pw.currentPassword || !pwOk} loading={changePw.isPending} onClick={() => changePw.mutate()}>Update password</Button>
        </Card>
      </div>
    </>
  );
}
