import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { patientDetailsSchema, type AppointmentStatus, type AvailabilityResponse, type PatientDetails } from "@sdc/shared";
import { ConfirmAction, DataTable, Modal, PageHead, SearchBox, StatusBadge, Tabs, send, useAction, useList, useLive, type Column } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { SlotGrid } from "@/pages/public/Book";
import { api, errorMessage } from "@/services/api";
import type { Appointment, Doctor, Patient, Treatment } from "@/types/api";
import { fmtDate, fmtTime, localDay, todayLocal } from "@/utils/time";

type Mode = "staff" | "doctor" | "patient";
const KEY = ["/appointments"];

export function RescheduleModal({ appt, open, onOpenChange, staff }: { appt: Appointment; open: boolean; onOpenChange: (o: boolean) => void; staff: boolean }) {
  const [date, setDate] = useState(todayLocal());
  const [slot, setSlot] = useState("");
  const slots = useQuery({
    queryKey: ["availability", appt.doctorId, appt.treatmentId, date, appt.id],
    queryFn: () => api<{ data: AvailabilityResponse }>("/availability", { query: { doctorId: appt.doctorId, treatmentId: appt.treatmentId, date, excludeAppointmentId: appt.id } }).then((r) => r.data),
    enabled: open,
  });
  const act = useAction(() => api(`/appointments/${appt.id}/reschedule`, { method: "POST", body: { startAt: slot } }), { success: "Appointment rescheduled", invalidate: [KEY], onSuccess: () => onOpenChange(false) });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Reschedule ${appt.reference}`} description={`${appt.treatment.name} with ${appt.doctor.user.fullName}`} wide>
      <label className="block max-w-xs text-sm font-medium">New date
        <Input type="date" className="mt-1.5" value={date} min={todayLocal()} onChange={(e) => { setDate(e.target.value); setSlot(""); }} />
      </label>
      <div className="mt-5">
        {slots.isLoading ? <Skeleton className="h-32" /> : slots.data?.slots.length ? <SlotGrid slots={slots.data.slots} tz={slots.data.timezone} value={slot} onChange={setSlot} /> : <EmptyState>{slots.data?.reason ?? "No slots"}</EmptyState>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        {!staff && <p className="mr-auto self-center text-xs text-muted">Online changes allowed up to the cancellation window.</p>}
        <Button variant="outline" onClick={() => onOpenChange(false)}>Back</Button>
        <Button disabled={!slot} loading={act.isPending} onClick={() => act.mutate()}>Confirm new time</Button>
      </div>
    </Modal>
  );
}

function RowActions({ a, mode }: { a: Appointment; mode: Mode }) {
  const [resch, setResch] = useState(false);
  const { can } = useAuth();
  const status = useAction((s: { status: AppointmentStatus; note?: string }) => send(`/appointments/${a.id}/status`, "PATCH")(s), { success: "Status updated", invalidate: [KEY, ["/queue"]] });
  const cancel = useAction((reason: string) => send(`/appointments/${a.id}/cancel`)({ reason }), { success: "Appointment cancelled", invalidate: [KEY] });
  const checkIn = useAction((emergency: boolean) => send("/queue/check-in")({ appointmentId: a.id, emergency }), { success: "Checked in — token issued", invalidate: [KEY, ["/queue"]] });
  const active = ["PENDING", "CONFIRMED"].includes(a.status);
  const isToday = localDay(a.startAt) === todayLocal();
  return (
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
      {mode === "staff" && a.status === "PENDING" && <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: "CONFIRMED" })}>Confirm</Button>}
      {mode === "staff" && can("queue:manage") && active && isToday && !a.queueToken && <Button size="sm" loading={checkIn.isPending} onClick={() => checkIn.mutate(false)}>Check in</Button>}
      {mode === "staff" && a.status === "CONFIRMED" && new Date(a.endAt) < new Date() && <Button size="sm" variant="outline" onClick={() => status.mutate({ status: "NO_SHOW" })}>No-show</Button>}
      {mode === "doctor" && a.status === "CHECKED_IN" && <Button size="sm" onClick={() => status.mutate({ status: "IN_PROGRESS" })}>Start</Button>}
      {mode === "doctor" && a.status === "IN_PROGRESS" && <Button size="sm" onClick={() => status.mutate({ status: "COMPLETED" })}>Complete</Button>}
      {mode === "doctor" && <Button size="sm" variant="outline" asChild><Link to={`/doctor/patients/${a.patientId}`}>Chart</Link></Button>}
      {mode !== "doctor" && active && <Button size="sm" variant="outline" onClick={() => setResch(true)}>Reschedule</Button>}
      {mode !== "doctor" && active && (
        <ConfirmAction label="Cancel" title={`Cancel ${a.reference}?`} description={`${fmtDate(a.startAt)} at ${fmtTime(a.startAt)} — the patient will be notified.`} withReason="Reason" confirmLabel="Cancel appointment" danger onConfirm={(r) => cancel.mutateAsync(r)} />
      )}
      {mode === "patient" && a.status === "COMPLETED" && <ReviewButton a={a} />}
      {resch && <RescheduleModal appt={a} open={resch} onOpenChange={setResch} staff={mode === "staff"} />}
    </div>
  );
}

function ReviewButton({ a }: { a: Appointment }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const act = useAction(() => send("/reviews")({ appointmentId: a.id, rating, comment }), { success: "Thanks! Your review will appear after moderation.", onSuccess: () => setOpen(false) });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Review</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Review your visit with ${a.doctor.user.fullName}`}>
        <div className="space-y-4">
          <Field label="Rating">{(x) => <Select {...x} value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}</Select>}</Field>
          <Field label="Your experience" hint="At least 10 characters">{(x) => <Input {...x} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />}</Field>
          <div className="flex justify-end"><Button loading={act.isPending} disabled={comment.trim().length < 10} onClick={() => act.mutate()}>Submit review</Button></div>
        </div>
      </Modal>
    </>
  );
}

export function AppointmentsPage({ mode }: { mode: Mode }) {
  const [tab, setTab] = useState<"today" | "upcoming" | "past" | "all">(mode === "patient" ? "upcoming" : "today");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const doctors = useList<Doctor>("/doctors", { status: "active", pageSize: 100 }, mode === "staff");
  const list = useList<Appointment>("/appointments", { when: tab === "all" ? undefined : tab, page, q, status: status || undefined, doctorId: doctorId || undefined, pageSize: 20 });
  useLive("appointments:changed", [KEY]);
  const nav = useNavigate();
  const base = mode === "patient" ? "/patient" : mode === "doctor" ? "/doctor" : "";

  const cols: Column<Appointment>[] = [
    { key: "when", label: "When", render: (a) => <><p className="font-medium">{fmtTime(a.startAt)}</p><p className="text-xs text-muted">{fmtDate(a.startAt)}</p></> },
    ...(mode !== "patient" ? [{ key: "patient", label: "Patient", render: (a: Appointment) => <><p className="font-medium">{a.patient.fullName}</p><p className="text-xs text-muted">{a.patient.patientCode} · {a.patient.phone}</p></> }] : []),
    ...(mode !== "doctor" ? [{ key: "doctor", label: "Doctor", render: (a: Appointment) => a.doctor.user.fullName }] : []),
    { key: "treatment", label: "Treatment", render: (a) => <><p>{a.treatment.name}</p><p className="text-xs text-muted">{a.reference}{a.source !== "ONLINE" ? ` · ${a.source.replace("_", "-").toLowerCase()}` : ""}</p></> },
    { key: "status", label: "Status", render: (a) => <div className="space-y-1"><StatusBadge status={a.status} />{a.queueToken && <p className="text-xs text-muted">Token #{a.queueToken.tokenNumber}</p>}{a.payments.some((p) => p.status === "CAPTURED") && <p className="text-xs text-emerald-700">Paid online</p>}</div> },
    { key: "actions", label: "", render: (a) => <RowActions a={a} mode={mode} /> },
  ];

  return (
    <>
      <PageHead title={mode === "patient" ? "My appointments" : "Appointments"} subtitle={mode === "doctor" ? "Your schedule and consultations" : undefined}
        actions={mode === "patient" ? <Button asChild><Link to="/book"><CalendarPlus />Book appointment</Link></Button> : mode === "staff" ? <Button asChild><Link to={`${location.pathname.startsWith("/admin") ? "/admin" : "/reception"}/book`}><CalendarPlus />New booking</Link></Button> : undefined} />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[...(mode !== "patient" ? [{ value: "today" as const, label: "Today" }] : []), { value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "all", label: "All" }]} />
      {mode !== "patient" && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search patient, phone, reference" />
          <Select className="sm:w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>{["PENDING", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
          </Select>
          {mode === "staff" && (
            <Select className="sm:w-56" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }} aria-label="Filter by doctor">
              <option value="">All doctors</option>{doctors.data?.data.map((d) => <option key={d.id} value={d.id}>{d.user.fullName}</option>)}
            </Select>
          )}
        </div>
      )}
      <DataTable columns={cols} query={list} page={page} onPage={setPage} empty={tab === "today" ? "No appointments today." : "No appointments found."}
        onRowClick={mode === "doctor" ? (a) => nav(`${base}/patients/${a.patientId}`) : undefined} />
    </>
  );
}

/* ================================ Staff booking (phone / walk-in) ================================ */

export function StaffBookingPage() {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [newPatient, setNewPatient] = useState(false);
  const [q, setQ] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [slot, setSlot] = useState("");
  const [duration, setDuration] = useState<number | "">("");
  const [source, setSource] = useState<"PHONE" | "WALK_IN">("WALK_IN");
  const [done, setDone] = useState<{ reference: string } | null>(null);
  const patients = useList<Patient>("/patients", { q, pageSize: 8 }, q.length >= 2);
  const treatments = useList<Treatment>("/treatments", { status: "active", pageSize: 100 });
  const doctors = useList<Doctor>("/doctors", { status: "active", treatmentId: treatmentId || undefined, pageSize: 100 }, !!treatmentId);
  const slots = useQuery({
    queryKey: ["availability", doctorId, treatmentId, date, duration],
    queryFn: () => api<{ data: AvailabilityResponse }>("/availability", { query: { doctorId, treatmentId, date, durationOverride: duration || undefined } }).then((r) => r.data),
    enabled: !!doctorId && !!treatmentId && !!date,
  });
  const book = useAction(() => api<{ data: { reference: string } }>("/appointments", { method: "POST", body: { treatmentId, doctorId, startAt: slot, source, patientId: patient!.id, durationOverride: duration || undefined } }).then((r) => r.data),
    { success: "Appointment booked and confirmed", invalidate: [KEY], onSuccess: (r) => setDone(r) });

  if (done) return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-2xl font-bold">Booked: {done.reference}</h1>
      <p className="mt-2 text-muted">{patient?.fullName} · {fmtDate(slot)} {fmtTime(slot)}. Confirmation sent to the patient.</p>
      <div className="mt-6 flex justify-center gap-2"><Button onClick={() => { setDone(null); setSlot(""); setPatient(null); setQ(""); }}>Book another</Button></div>
    </Card>
  );

  return (
    <>
      <PageHead title="New booking" subtitle="Phone bookings and walk-ins. Staff bookings are confirmed immediately." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-semibold">1. Patient</h2>
          {patient ? (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 p-4">
              <div><p className="font-semibold">{patient.fullName}</p><p className="text-sm text-muted">{patient.patientCode} · {patient.phone}</p></div>
              <Button size="sm" variant="outline" onClick={() => setPatient(null)}>Change</Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <SearchBox value={q} onChange={setQ} placeholder="Search name, phone or patient ID" />
              {q.length >= 2 && (patients.data?.data.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {patients.data.data.map((p) => <li key={p.id}><button className="w-full px-4 py-3 text-left hover:bg-surface" onClick={() => setPatient(p)}><span className="font-medium">{p.fullName}</span><span className="ml-2 text-sm text-muted">{p.patientCode} · {p.phone}</span></button></li>)}
                </ul>
              ) : patients.isFetched && <p className="text-sm text-muted">No match.</p>)}
              <Button variant="secondary" onClick={() => setNewPatient(true)}><UserPlus />Register new patient</Button>
            </div>
          )}
          <RegisterPatientModal open={newPatient} onOpenChange={setNewPatient} onCreated={(p) => { setPatient(p); setNewPatient(false); }} />

          <h2 className="mt-8 font-semibold">2. Treatment & doctor</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Treatment">{(a) => <Select {...a} value={treatmentId} onChange={(e) => { setTreatmentId(e.target.value); setDoctorId(""); setSlot(""); }}><option value="">Select…</option>{treatments.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.durationMinutes} min)</option>)}</Select>}</Field>
            <Field label="Doctor">{(a) => <Select {...a} value={doctorId} disabled={!treatmentId} onChange={(e) => { setDoctorId(e.target.value); setSlot(""); }}><option value="">Select…</option>{doctors.data?.data.map((d) => <option key={d.id} value={d.id}>{d.user.fullName}</option>)}</Select>}</Field>
            <Field label="Source">{(a) => <Select {...a} value={source} onChange={(e) => setSource(e.target.value as "PHONE" | "WALK_IN")}><option value="WALK_IN">Walk-in</option><option value="PHONE">Phone</option></Select>}</Field>
            <Field label="Custom duration (min)" hint="Leave blank for the treatment default">{(a) => <Input {...a} type="number" min={5} max={480} step={5} value={duration} onChange={(e) => { setDuration(e.target.value ? Number(e.target.value) : ""); setSlot(""); }} />}</Field>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold">3. Date & time</h2>
          <Input type="date" className="mt-4 max-w-xs" value={date} min={todayLocal()} onChange={(e) => { setDate(e.target.value); setSlot(""); }} aria-label="Date" />
          <div className="mt-5">
            {!doctorId ? <EmptyState>Select a treatment and doctor to see availability.</EmptyState> : slots.isLoading ? <Skeleton className="h-40" /> : slots.data?.slots.length ? (
              <SlotGrid slots={slots.data.slots} tz={slots.data.timezone} value={slot} onChange={setSlot} />
            ) : <EmptyState>{slots.data?.reason ?? "No slots"}</EmptyState>}
          </div>
          <Button className="mt-6 w-full" size="lg" disabled={!patient || !slot} loading={book.isPending} onClick={() => book.mutate()}>Book {slot ? `${fmtTime(slot)}, ${fmtDate(slot)}` : "appointment"}</Button>
        </Card>
      </div>
    </>
  );
}

export function RegisterPatientModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: Patient) => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PatientDetails>({ resolver: zodResolver(patientDetailsSchema) });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Register patient" description="Creates a patient record. The patient can later sign up online with the same phone to access it.">
      <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(async (d) => {
        setErr(null);
        try { const r = await api<{ data: Patient }>("/patients", { method: "POST", body: d }); reset(); onCreated(r.data); } catch (e) { setErr(errorMessage(e)); }
      })}>
        <Field label="Full name" error={errors.fullName?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("fullName")} />}</Field>
        <Field label="Mobile" error={errors.phone?.message}>{(a) => <Input {...a} type="tel" {...register("phone")} />}</Field>
        <Field label="Email (optional)" error={errors.email?.message}>{(a) => <Input {...a} type="email" {...register("email")} />}</Field>
        <Field label="Date of birth" error={errors.dateOfBirth?.message}>{(a) => <Input {...a} type="date" max={todayLocal()} {...register("dateOfBirth")} />}</Field>
        <Field label="Gender">{(a) => <Select {...a} defaultValue="" {...register("gender", { setValueAs: (v) => v || undefined })}><option value="">—</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select>}</Field>
        {err && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{err}</p>}
        <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={isSubmitting}>Register</Button></div>
      </form>
    </Modal>
  );
}

