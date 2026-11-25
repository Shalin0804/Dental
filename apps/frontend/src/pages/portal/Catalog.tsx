import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmAction, DataTable, Modal, PageHead, SearchBox, StatusBadge, Tabs, send, useAction, useGet, useList, type Column } from "@/components/dash/kit";
import { Avatar } from "@/components/site/cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import type { Doctor, Range, Treatment } from "@/types/api";
import { formatDuration, formatINR } from "@/utils/format";
import { todayLocal } from "@/utils/time";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHM = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const paise = (r: string) => Math.round(Number(r || 0) * 100);

/* ================================ Treatments ================================ */

function TreatmentModal({ t, open, onOpenChange }: { t?: Treatment; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState({ name: t?.name ?? "", summary: t?.summary ?? "", description: t?.description ?? "", imageUrl: t?.imageUrl ?? "", price: t ? String(t.pricePaise / 100) : "", durationMinutes: t?.durationMinutes ?? 30, preparation: t?.preparation ?? "", aftercare: t?.aftercare ?? "", isActive: t?.isActive ?? true, sortOrder: t?.sortOrder ?? 0 });
  const body = { ...f, pricePaise: paise(f.price), price: undefined };
  const save = useAction(() => (t ? send(`/treatments/${t.id}`, "PATCH")(body) : send("/treatments")(body)), { success: "Treatment saved", invalidate: [["/treatments"], ["public"]], onSuccess: () => onOpenChange(false) });
  const v = (k: keyof typeof f) => ({ value: f[k] as string | number, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }) });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t ? `Edit ${t.name}` : "Add treatment"} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} {...v("name")} />}</Field>
        <Field label="Image URL" hint="Cloudinary/S3 or any https image">{(a) => <Input {...a} type="url" {...v("imageUrl")} />}</Field>
        <Field label="Price from (₹)">{(a) => <Input {...a} type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
        <Field label="Default duration (minutes)">{(a) => <Input {...a} type="number" min={5} max={480} step={5} {...v("durationMinutes")} />}</Field>
        <Field label="Summary (cards)" className="sm:col-span-2">{(a) => <Input {...a} {...v("summary")} maxLength={300} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} {...v("description")} />}</Field>
        <Field label="Preparation instructions">{(a) => <Textarea {...a} {...v("preparation")} className="min-h-20" />}</Field>
        <Field label="Post-treatment instructions">{(a) => <Textarea {...a} {...v("aftercare")} className="min-h-20" />}</Field>
        <Field label="Sort order">{(a) => <Input {...a} type="number" {...v("sortOrder")} />}</Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Active (bookable & shown on website)</label>
      </div>
      <div className="mt-6 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}

export function TreatmentsAdminPage() {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ open: boolean; t?: Treatment }>({ open: false });
  const list = useList<Treatment>("/treatments", { q, pageSize: 100 });
  const del = useAction((id: string) => send(`/treatments/${id}`, "DELETE")(), { success: "Treatment deleted", invalidate: [["/treatments"], ["public"]] });
  const toggle = useAction((t: Treatment) => send(`/treatments/${t.id}`, "PATCH")({ isActive: !t.isActive }), { success: "Updated", invalidate: [["/treatments"], ["public"]] });
  const cols: Column<Treatment>[] = [
    { key: "n", label: "Treatment", render: (t) => <><p className="font-medium">{t.name}</p><p className="text-xs text-muted">{t._count?.doctors ?? 0} doctors · {t._count?.appointments ?? 0} bookings</p></> },
    { key: "p", label: "Price", render: (t) => formatINR(t.pricePaise) },
    { key: "d", label: "Duration", render: (t) => formatDuration(t.durationMinutes) },
    { key: "s", label: "Status", render: (t) => <StatusBadge status={t.isActive ? "ACTIVE" : "INACTIVE"} /> },
    { key: "a", label: "", render: (t) => (
      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" onClick={() => setEdit({ open: true, t })}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => toggle.mutate(t)}>{t.isActive ? "Disable" : "Enable"}</Button>
        <ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" title={`Delete ${t.name}?`} description="Past appointments and invoices keep their history. Treatments with upcoming bookings can't be deleted." danger confirmLabel="Delete" onConfirm={() => del.mutateAsync(t.id)} />
      </div>
    ) },
  ];
  return (
    <>
      <PageHead title="Treatments" subtitle="Prices and durations shown on the website and used by the booking engine." actions={<Button onClick={() => setEdit({ open: true })}><Plus />Add treatment</Button>} />
      <div className="mb-4"><SearchBox value={q} onChange={setQ} /></div>
      <DataTable columns={cols} query={list} />
      {edit.open && <TreatmentModal t={edit.t} open={edit.open} onOpenChange={(o) => setEdit({ open: o })} />}
    </>
  );
}

/* ================================ Doctors ================================ */

function DoctorProfileForm({ d, onSaved }: { d?: Doctor; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    fullName: d?.user.fullName ?? "", email: d?.user.email ?? "", password: "", phone: d?.user.phone ?? "", photoUrl: d?.photoUrl ?? "", qualification: d?.qualification ?? "", specialization: d?.specialization ?? "",
    experienceYears: d?.experienceYears ?? 0, registrationNumber: d?.registrationNumber ?? "", registrationCouncil: d?.registrationCouncil ?? "", bio: d?.bio ?? "", languages: d?.languages.join(", ") ?? "",
    fee: d ? String(d.consultationFeePaise / 100) : "", bufferMinutes: d?.bufferMinutes ?? 0, isPublic: d?.isPublic ?? true, sortOrder: d?.sortOrder ?? 0,
  });
  const body = { ...f, languages: f.languages.split(",").map((s) => s.trim()).filter(Boolean), consultationFeePaise: paise(f.fee), fee: undefined, ...(d ? { email: undefined, password: undefined } : {}) };
  const save = useAction(() => (d ? send(`/doctors/${d.id}`, "PATCH")(body) : send("/doctors")(body)) as Promise<{ data: Doctor }>, { success: "Doctor saved", invalidate: [["/doctors"], ["public"]], onSuccess: (r) => onSaved(r.data.id) });
  const v = (k: keyof typeof f) => ({ value: f[k] as string | number, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }) });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name">{(a) => <Input {...a} {...v("fullName")} placeholder="Dr. …" />}</Field>
      <Field label="Phone">{(a) => <Input {...a} type="tel" {...v("phone")} />}</Field>
      {!d && <Field label="Login email">{(a) => <Input {...a} type="email" {...v("email")} />}</Field>}
      {!d && <Field label="Initial password" hint="8+ chars, letter and number. Share securely.">{(a) => <Input {...a} type="password" autoComplete="new-password" {...v("password")} />}</Field>}
      <Field label="Qualification">{(a) => <Input {...a} {...v("qualification")} />}</Field>
      <Field label="Specialization">{(a) => <Input {...a} {...v("specialization")} />}</Field>
      <Field label="Experience (years)">{(a) => <Input {...a} type="number" min={0} {...v("experienceYears")} />}</Field>
      <Field label="Consultation fee (₹)">{(a) => <Input {...a} type="number" min={0} value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />}</Field>
      <Field label="Registration number">{(a) => <Input {...a} {...v("registrationNumber")} />}</Field>
      <Field label="Registration council">{(a) => <Input {...a} {...v("registrationCouncil")} />}</Field>
      <Field label="Photo URL">{(a) => <Input {...a} type="url" {...v("photoUrl")} />}</Field>
      <Field label="Languages" hint="Comma separated">{(a) => <Input {...a} {...v("languages")} />}</Field>
      <Field label="Buffer between appointments (min)">{(a) => <Input {...a} type="number" min={0} max={60} {...v("bufferMinutes")} />}</Field>
      <Field label="Sort order">{(a) => <Input {...a} type="number" {...v("sortOrder")} />}</Field>
      <Field label="Bio" className="sm:col-span-2">{(a) => <Textarea {...a} {...v("bio")} />}</Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} />Show on website</label>
      <div className="flex justify-end sm:col-span-2"><Button loading={save.isPending} onClick={() => save.mutate()}>{d ? "Save profile" : "Create doctor"}</Button></div>
    </div>
  );
}

function DoctorTreatments({ d }: { d: Doctor }) {
  const all = useList<Treatment>("/treatments", { status: "active", pageSize: 100 });
  const [sel, setSel] = useState(() => new Map(d.treatments.map((t) => [t.treatmentId, { durationOverride: t.durationOverride ?? "", price: t.priceOverridePaise != null ? String(t.priceOverridePaise / 100) : "" }])));
  const save = useAction(() => send(`/doctors/${d.id}/treatments`, "PUT")({ treatments: [...sel].map(([treatmentId, v]) => ({ treatmentId, durationOverride: v.durationOverride === "" ? null : Number(v.durationOverride), priceOverridePaise: v.price === "" ? null : paise(v.price) })) }), { success: "Treatments assigned", invalidate: [["/doctors"], [`/doctors/${d.id}`], ["public"]] });
  if (!all.data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-2">
      {all.data.data.map((t) => {
        const on = sel.get(t.id);
        return (
          <div key={t.id} className="grid items-center gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_140px_140px]">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-brand-600" checked={!!on} onChange={(e) => { const m = new Map(sel); if (e.target.checked) m.set(t.id, { durationOverride: "", price: "" }); else m.delete(t.id); setSel(m); }} />{t.name}<span className="font-normal text-muted">({t.durationMinutes} min)</span></label>
            {on && <Input type="number" min={5} placeholder={`${t.durationMinutes} min`} value={on.durationOverride} onChange={(e) => setSel(new Map(sel).set(t.id, { ...on, durationOverride: e.target.value }))} aria-label={`Duration override for ${t.name}`} />}
            {on && <Input type="number" min={0} placeholder={`₹${t.pricePaise / 100}`} value={on.price} onChange={(e) => setSel(new Map(sel).set(t.id, { ...on, price: e.target.value }))} aria-label={`Price override for ${t.name}`} />}
          </div>
        );
      })}
      <p className="text-xs text-muted">Leave duration/price blank to use the treatment defaults.</p>
      <Button loading={save.isPending} onClick={() => save.mutate()}>Save treatments</Button>
    </div>
  );
}

export function ScheduleEditor({ d, doctorPath }: { d: Doctor; doctorPath: string }) {
  const [shifts, setShifts] = useState<Range[]>(d.schedules ?? []);
  const [breaks, setBreaks] = useState<Range[]>(d.breaks ?? []);
  const strip = (r: Range[]) => r.map(({ weekday, startMinute, endMinute, label }) => ({ weekday, startMinute, endMinute, label }));
  const save = useAction(() => send(`/doctors/${doctorPath}/schedule`, "PUT")({ shifts: strip(shifts), breaks: strip(breaks) }), { success: "Weekly schedule saved", invalidate: [[`/doctors/${doctorPath}`]] });
  const rows = (list: Range[], set: (r: Range[]) => void, kind: string) => (
    <div className="space-y-2">
      {list.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_1fr_auto] items-center gap-2">
          <Select value={r.weekday} onChange={(e) => set(list.map((x, n) => (n === i ? { ...x, weekday: Number(e.target.value) } : x)))} aria-label="Day">{DAYS.map((dname, n) => <option key={n} value={n}>{dname}</option>)}</Select>
          <Input type="time" step={300} value={toHM(r.startMinute)} onChange={(e) => set(list.map((x, n) => (n === i ? { ...x, startMinute: fromHM(e.target.value) } : x)))} aria-label="Start" />
          <Input type="time" step={300} value={toHM(r.endMinute)} onChange={(e) => set(list.map((x, n) => (n === i ? { ...x, endMinute: fromHM(e.target.value) } : x)))} aria-label="End" />
          <Input placeholder="Label" value={r.label ?? ""} onChange={(e) => set(list.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)))} aria-label="Label" />
          <Button variant="ghost" size="icon" onClick={() => set(list.filter((_, n) => n !== i))} aria-label={`Remove ${kind}`}><Trash2 /></Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => set([...list, { weekday: 1, startMinute: kind === "break" ? 690 : 570, endMinute: kind === "break" ? 705 : 780, label: "" }])}><Plus />Add {kind}</Button>
    </div>
  );
  return (
    <div className="space-y-8">
      <section><h3 className="mb-3 font-semibold">Working shifts</h3><p className="mb-3 text-sm text-muted">Add several shifts per day for morning/evening sessions.</p>{rows([...shifts].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute), setShifts, "shift")}</section>
      <section><h3 className="mb-3 font-semibold">Breaks</h3>{rows(breaks, setBreaks, "break")}</section>
      <Button loading={save.isPending} onClick={() => save.mutate()}>Save weekly schedule</Button>
      <p className="text-xs text-muted">Existing bookings are not moved when the schedule changes.</p>
    </div>
  );
}

export function LeaveEditor({ d, doctorPath }: { d: Doctor; doctorPath: string }) {
  const [lv, setLv] = useState({ startDate: todayLocal(), endDate: todayLocal(), reason: "" });
  const [sh, setSh] = useState({ date: todayLocal(), start: "10:00", end: "14:00", note: "" });
  const inv = [[`/doctors/${doctorPath}`]];
  const addLeave = useAction(() => send(`/doctors/${doctorPath}/leaves`)(lv) as Promise<{ meta: { affectedAppointments: number } }>, { invalidate: inv, success: "Leave added" });
  const delLeave = useAction((id: string) => send(`/doctors/${doctorPath}/leaves/${id}`, "DELETE")(), { success: "Leave removed", invalidate: inv });
  const addSh = useAction(() => send(`/doctors/${doctorPath}/special-hours`)({ date: sh.date, startMinute: fromHM(sh.start), endMinute: fromHM(sh.end), note: sh.note }), { success: "Special hours added", invalidate: inv });
  const delSh = useAction((id: string) => send(`/doctors/${doctorPath}/special-hours/${id}`, "DELETE")(), { success: "Removed", invalidate: inv });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-semibold">Leave</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Input type="date" value={lv.startDate} min={todayLocal()} onChange={(e) => setLv({ ...lv, startDate: e.target.value })} aria-label="From" />
          <Input type="date" value={lv.endDate} min={lv.startDate} onChange={(e) => setLv({ ...lv, endDate: e.target.value })} aria-label="To" />
          <Input className="sm:col-span-2" placeholder="Reason" value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} aria-label="Reason" />
        </div>
        <Button className="mt-3" size="sm" loading={addLeave.isPending} onClick={() => addLeave.mutate()}>Add leave</Button>
        {addLeave.data && addLeave.data.meta.affectedAppointments > 0 && <p className="mt-2 text-sm text-amber-700">{addLeave.data.meta.affectedAppointments} existing appointment(s) fall in this period — reception should reschedule them.</p>}
        <ul className="mt-4 space-y-2 text-sm">{d.leaves?.length ? d.leaves.map((l) => <li key={l.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"><span>{l.startDate.slice(0, 10)} → {l.endDate.slice(0, 10)} {l.reason && <span className="text-muted">· {l.reason}</span>}</span><Button size="sm" variant="ghost" onClick={() => delLeave.mutate(l.id)} aria-label="Remove leave"><Trash2 /></Button></li>) : <li className="text-muted">No upcoming leave.</li>}</ul>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold">Special working hours</h3>
        <p className="mt-1 text-xs text-muted">Replaces the weekly schedule for that date.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Input type="date" className="col-span-3" value={sh.date} min={todayLocal()} onChange={(e) => setSh({ ...sh, date: e.target.value })} aria-label="Date" />
          <Input type="time" value={sh.start} onChange={(e) => setSh({ ...sh, start: e.target.value })} aria-label="Start" />
          <Input type="time" value={sh.end} onChange={(e) => setSh({ ...sh, end: e.target.value })} aria-label="End" />
          <Input placeholder="Note" value={sh.note} onChange={(e) => setSh({ ...sh, note: e.target.value })} aria-label="Note" />
        </div>
        <Button className="mt-3" size="sm" loading={addSh.isPending} onClick={() => addSh.mutate()}>Add hours</Button>
        <ul className="mt-4 space-y-2 text-sm">{d.specialHours?.length ? d.specialHours.map((s) => <li key={s.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"><span>{s.date.slice(0, 10)} · {toHM(s.startMinute)}–{toHM(s.endMinute)} {s.note && <span className="text-muted">· {s.note}</span>}</span><Button size="sm" variant="ghost" onClick={() => delSh.mutate(s.id)} aria-label="Remove"><Trash2 /></Button></li>) : <li className="text-muted">None scheduled.</li>}</ul>
      </Card>
    </div>
  );
}

function DoctorEditorModal({ id, onClose }: { id: string | "new"; onClose: () => void }) {
  const [current, setCurrent] = useState(id);
  const d = useGet<Doctor>(current === "new" ? null : `/doctors/${current}`);
  const [tab, setTab] = useState<"profile" | "treatments" | "schedule" | "leave">("profile");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={current === "new" ? "Add doctor" : d.data?.user.fullName ?? "Doctor"} wide>
      {current !== "new" && <Tabs value={tab} onChange={setTab} items={[{ value: "profile", label: "Profile" }, { value: "treatments", label: "Treatments" }, { value: "schedule", label: "Weekly schedule" }, { value: "leave", label: "Leave & special hours" }]} />}
      {current === "new" ? <DoctorProfileForm onSaved={(nid) => { setCurrent(nid); setTab("treatments"); }} /> : !d.data ? <Skeleton className="h-64" /> : (
        <>
          {tab === "profile" && <DoctorProfileForm key={d.data.id} d={d.data} onSaved={() => undefined} />}
          {tab === "treatments" && <DoctorTreatments d={d.data} />}
          {tab === "schedule" && <ScheduleEditor key={d.dataUpdatedAt} d={d.data} doctorPath={d.data.id} />}
          {tab === "leave" && <LeaveEditor d={d.data} doctorPath={d.data.id} />}
        </>
      )}
    </Modal>
  );
}

export function DoctorsAdminPage() {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const list = useList<Doctor>("/doctors", { q, pageSize: 100 });
  const toggle = useAction((d: Doctor) => send(`/doctors/${d.id}`, "PATCH")({ isActive: !d.isActive }), { success: "Doctor updated", invalidate: [["/doctors"], ["public"]] });
  const cols: Column<Doctor>[] = [
    { key: "n", label: "Doctor", render: (d) => <div className="flex items-center gap-3"><span className="size-10 shrink-0 overflow-hidden rounded-xl"><Avatar name={d.user.fullName} src={d.photoUrl} /></span><div><p className="font-medium">{d.user.fullName}</p><p className="text-xs text-muted">{d.user.email}</p></div></div> },
    { key: "s", label: "Specialization", render: (d) => <>{d.specialization}<p className="text-xs text-muted">{d.qualification}</p></> },
    { key: "t", label: "Treatments", render: (d) => d.treatments.length },
    { key: "f", label: "Fee", render: (d) => formatINR(d.consultationFeePaise) },
    { key: "st", label: "Status", render: (d) => <StatusBadge status={d.isActive ? "ACTIVE" : "INACTIVE"} /> },
    { key: "a", label: "", render: (d) => (
      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" onClick={() => setEdit(d.id)}>Manage</Button>
        <ConfirmAction label={d.isActive ? "Deactivate" : "Activate"} variant="ghost" title={`${d.isActive ? "Deactivate" : "Activate"} ${d.user.fullName}?`} description={d.isActive ? "They will be hidden from booking and signed out. Existing appointments stay." : undefined} danger={d.isActive} onConfirm={() => toggle.mutateAsync(d)} />
      </div>
    ) },
  ];
  return (
    <>
      <PageHead title="Doctors & schedules" actions={<Button onClick={() => setEdit("new")}><Plus />Add doctor</Button>} />
      <div className="mb-4"><SearchBox value={q} onChange={setQ} placeholder="Name or specialization" /></div>
      <DataTable columns={cols} query={list} onRowClick={(d) => setEdit(d.id)} />
      <HolidaysCard />
      {edit && <DoctorEditorModal id={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function HolidaysCard() {
  const list = useGet<{ id: string; startDate: string; endDate: string; reason: string }[]>("/holidays");
  const [f, setF] = useState({ startDate: todayLocal(), endDate: todayLocal(), reason: "" });
  const add = useAction(() => send("/holidays")(f), { success: "Holiday added — no bookings on these dates", invalidate: [["/holidays"]] });
  const del = useAction((id: string) => send(`/holidays/${id}`, "DELETE")(), { success: "Holiday removed", invalidate: [["/holidays"]] });
  return (
    <Card className="mt-8 p-5">
      <h2 className="font-semibold">Hospital holidays</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
        <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} aria-label="From" />
        <Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} aria-label="To" />
        <Input placeholder="e.g. Diwali" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Holiday name" />
        <Button disabled={f.reason.length < 2} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
      </div>
      <ul className="mt-4 space-y-2 text-sm">{list.data?.length ? list.data.map((h) => <li key={h.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"><span>{h.startDate.slice(0, 10)}{h.endDate !== h.startDate ? ` → ${h.endDate.slice(0, 10)}` : ""} · {h.reason}</span><Button size="sm" variant="ghost" onClick={() => del.mutate(h.id)} aria-label="Remove holiday"><Trash2 /></Button></li>) : <li className="text-muted">No holidays configured.</li>}</ul>
    </Card>
  );
}

/** Doctor's own availability page. */
export function MyAvailabilityPage() {
  const d = useGet<Doctor>("/doctors/me");
  const [tab, setTab] = useState<"schedule" | "leave">("schedule");
  if (!d.data) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHead title="Availability & leave" subtitle="Changes apply to online booking immediately." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "schedule", label: "Weekly schedule" }, { value: "leave", label: "Leave & special hours" }]} />
      <Card className="p-6">{tab === "schedule" ? <ScheduleEditor key={d.dataUpdatedAt} d={d.data} doctorPath="me" /> : <LeaveEditor d={d.data} doctorPath="me" />}</Card>
    </>
  );
}

