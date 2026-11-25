import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, FilePlus2, Paperclip, Pill, Plus, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DataTable, Modal, PageHead, SearchBox, StatusBadge, Tabs, openPdf, send, useAction, useGet, useList, useToast, type Column } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { api, errorMessage } from "@/services/api";
import type { Appointment, InvoiceRow, MedicalRecord, Patient, Prescription, RxItem, UploadedFile } from "@/types/api";
import { formatINR } from "@/utils/format";
import { fmtDate, fmtDateTime, todayLocal } from "@/utils/time";
import { RegisterPatientModal } from "./Appointments";

export function PatientsListPage({ base }: { base: string }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [reg, setReg] = useState(false);
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList<Patient>("/patients", { q, page });
  const cols: Column<Patient>[] = [
    { key: "name", label: "Patient", render: (p) => <><p className="font-medium">{p.fullName}</p><p className="text-xs text-muted">{p.patientCode}</p></> },
    { key: "phone", label: "Contact", render: (p) => <><p>{p.phone}</p><p className="text-xs text-muted">{p.email}</p></> },
    { key: "dob", label: "DOB / Gender", render: (p) => <span className="text-muted">{p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "—"} {p.gender ? `· ${p.gender.toLowerCase()}` : ""}</span> },
    { key: "visits", label: "Visits", render: (p) => p._count?.appointments ?? 0 },
    { key: "since", label: "Registered", render: (p) => fmtDate(p.createdAt) },
  ];
  return (
    <>
      <PageHead title="Patients" actions={can("patients:write") && <Button onClick={() => setReg(true)}><UserPlus />Register patient</Button>} />
      <div className="mb-4"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, phone, email or patient ID" /></div>
      <DataTable columns={cols} query={list} page={page} onPage={setPage} onRowClick={(p) => nav(`${base}/${p.id}`)} empty="No patients found." />
      <RegisterPatientModal open={reg} onOpenChange={setReg} onCreated={(p) => nav(`${base}/${p.id}`)} />
    </>
  );
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function ProfileTab({ p }: { p: Patient }) {
  const { can } = useAuth();
  const editable = can("patients:write") || can("clinical:write");
  const [form, setForm] = useState({ allergies: p.allergies.join(", "), conditions: p.conditions.join(", "), medicalHistory: p.medicalHistory ?? "", bloodGroup: p.bloodGroup ?? "", address: p.address ?? "", emergencyContact: p.emergencyContact ?? "" });
  const save = useAction(() => send(`/patients/${p.id}`, "PATCH")({
    allergies: list(form.allergies), conditions: list(form.conditions), medicalHistory: form.medicalHistory, bloodGroup: form.bloodGroup,
    ...(can("patients:write") ? { address: form.address, emergencyContact: form.emergencyContact } : {}),
  }), { success: "Patient updated", invalidate: [[`/patients/${p.id}`]] });
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }), disabled: !editable });
  return (
    <Card className="grid gap-5 p-6 sm:grid-cols-2">
      <Field label="Allergies" hint="Comma separated">{(a) => <Input {...a} {...f("allergies")} />}</Field>
      <Field label="Existing conditions" hint="Comma separated">{(a) => <Input {...a} {...f("conditions")} />}</Field>
      <Field label="Blood group">{(a) => <Input {...a} {...f("bloodGroup")} maxLength={5} />}</Field>
      <Field label="Emergency contact">{(a) => <Input {...a} {...f("emergencyContact")} disabled={!can("patients:write")} />}</Field>
      <Field label="Address" className="sm:col-span-2">{(a) => <Input {...a} {...f("address")} disabled={!can("patients:write")} />}</Field>
      <Field label="Medical history" className="sm:col-span-2">{(a) => <Textarea {...a} {...f("medicalHistory")} />}</Field>
      {editable && <div className="sm:col-span-2"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button></div>}
    </Card>
  );
}

const CONDITIONS = ["caries", "filled", "missing", "crown", "rct", "implant", "fractured", "mobile", "impacted", "watch"];
const FDI = [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]];

function ToothChart({ value, onChange }: { value: Record<string, { condition: string }>; onChange?: (v: Record<string, { condition: string }>) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2" role="group" aria-label="Tooth chart (FDI)">
        {FDI.map((row, i) => (
          <div key={i} className="flex justify-center gap-1">
            {row.map((n) => {
              const c = value[String(n)]?.condition;
              return (
                <button key={n} type="button" disabled={!onChange} onClick={() => setSel(String(n))} title={c ? `${n}: ${c}` : String(n)}
                  className={`size-8 rounded-lg border text-[11px] font-semibold ${c ? "border-red-300 bg-red-50 text-red-700" : "border-line bg-white text-muted"} ${sel === String(n) ? "ring-2 ring-brand-500" : ""}`}>{n}</button>
              );
            })}
          </div>
        ))}
      </div>
      {onChange && sel && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span>Tooth {sel}:</span>
          <Select className="h-9 w-40" value={value[sel]?.condition ?? ""} onChange={(e) => { const v = { ...value }; if (e.target.value) v[sel] = { condition: e.target.value }; else delete v[sel]; onChange(v); }} aria-label={`Condition of tooth ${sel}`}>
            <option value="">Healthy</option>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      )}
    </div>
  );
}

function RecordModal({ patientId, open, onOpenChange, record }: { patientId: string; open: boolean; onOpenChange: (o: boolean) => void; record?: MedicalRecord }) {
  const [f, setF] = useState({ chiefComplaint: record?.chiefComplaint ?? "", diagnosis: record?.diagnosis ?? "", clinicalNotes: record?.clinicalNotes ?? "", treatmentDone: record?.treatmentDone ?? "", followUpDate: record?.followUpDate?.slice(0, 10) ?? "", gums: record?.examination?.gums ?? "", oralHygiene: record?.examination?.oralHygiene ?? "" });
  const [teeth, setTeeth] = useState<Record<string, { condition: string }>>(record?.examination?.teeth ?? {});
  const body = { patientId, ...f, examination: { teeth, gums: f.gums, oralHygiene: f.oralHygiene } };
  const save = useAction(() => (record ? send(`/medical-records/${record.id}`, "PATCH")(body) : send("/medical-records")(body)), { success: "Record saved", invalidate: [[`/patients/${patientId}/summary`]], onSuccess: () => onOpenChange(false) });
  const t = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={record ? "Edit clinical record" : "New clinical record"} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Chief complaint" className="sm:col-span-2">{(a) => <Input {...a} {...t("chiefComplaint")} />}</Field>
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium">Dental examination — click a tooth</p><ToothChart value={teeth} onChange={setTeeth} /></div>
        <Field label="Gums">{(a) => <Input {...a} {...t("gums")} />}</Field>
        <Field label="Oral hygiene">{(a) => <Input {...a} {...t("oralHygiene")} />}</Field>
        <Field label="Diagnosis" className="sm:col-span-2">{(a) => <Textarea {...a} {...t("diagnosis")} className="min-h-20" />}</Field>
        <Field label="Clinical notes" className="sm:col-span-2">{(a) => <Textarea {...a} {...t("clinicalNotes")} />}</Field>
        <Field label="Treatment done">{(a) => <Input {...a} {...t("treatmentDone")} />}</Field>
        <Field label="Follow-up date">{(a) => <Input {...a} type="date" min={todayLocal()} {...t("followUpDate")} />}</Field>
      </div>
      <div className="mt-6 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save record</Button></div>
    </Modal>
  );
}

const emptyItem: RxItem = { medicine: "", dosage: "", frequency: "", duration: "", instructions: "" };

export function PrescriptionModal({ patientId, open, onOpenChange, rx }: { patientId: string; open: boolean; onOpenChange: (o: boolean) => void; rx?: Prescription }) {
  const [diagnosis, setDiagnosis] = useState(rx?.diagnosis ?? "");
  const [notes, setNotes] = useState(rx?.notes ?? "");
  const [followUpDate, setFollowUp] = useState(rx?.followUpDate?.slice(0, 10) ?? "");
  const [items, setItems] = useState<RxItem[]>(rx?.items.map(({ medicine, dosage, frequency, duration, instructions }) => ({ medicine, dosage, frequency, duration, instructions })) ?? [{ ...emptyItem }]);
  const [reason, setReason] = useState("");
  const amend = rx?.status === "FINAL";
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const submit = async (finalize: boolean) => {
    setBusy(true);
    try {
      const body = { patientId, diagnosis, notes, followUpDate, items, finalize, reason: amend ? reason : undefined };
      await api(rx ? `/prescriptions/${rx.id}` : "/prescriptions", { method: rx ? "PUT" : "POST", body });
      toast(finalize || amend ? "Prescription issued — patient notified" : "Draft saved");
      qc.invalidateQueries({ queryKey: [`/patients/${patientId}/summary`] });
      qc.invalidateQueries({ queryKey: ["/prescriptions"] });
      onOpenChange(false);
    } catch (e) { toast(errorMessage(e), "error"); } finally { setBusy(false); }
  };
  const set = (i: number, k: keyof RxItem, v: string) => setItems(items.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={rx ? (amend ? `Amend ${rx.number}` : `Edit draft ${rx.number}`) : "New prescription"} description={amend ? "Issued prescriptions keep an immutable copy of every previous version." : undefined} wide>
      <div className="space-y-4">
        <Field label="Diagnosis">{(a) => <Input {...a} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />}</Field>
        <div className="space-y-3">
          <p className="text-sm font-medium">Medicines</p>
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <Input placeholder="Medicine & strength" value={it.medicine} onChange={(e) => set(i, "medicine", e.target.value)} aria-label="Medicine" />
              <Input placeholder="Dosage" value={it.dosage} onChange={(e) => set(i, "dosage", e.target.value)} aria-label="Dosage" />
              <Input placeholder="Frequency" value={it.frequency} onChange={(e) => set(i, "frequency", e.target.value)} aria-label="Frequency" />
              <Input placeholder="Duration" value={it.duration} onChange={(e) => set(i, "duration", e.target.value)} aria-label="Duration" />
              <Button variant="ghost" size="icon" onClick={() => setItems(items.filter((_, n) => n !== i))} disabled={items.length === 1} aria-label="Remove medicine"><Trash2 /></Button>
              <Input className="sm:col-span-5" placeholder="Instructions (e.g. after food)" value={it.instructions ?? ""} onChange={(e) => set(i, "instructions", e.target.value)} aria-label="Instructions" />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setItems([...items, { ...emptyItem }])}><Plus />Add medicine</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Advice / notes">{(a) => <Input {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <Field label="Follow-up date">{(a) => <Input {...a} type="date" min={todayLocal()} value={followUpDate} onChange={(e) => setFollowUp(e.target.value)} />}</Field>
        </div>
        {amend && <Field label="Reason for amendment (required)">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        {!amend && <Button variant="outline" loading={busy} onClick={() => submit(false)}>Save draft</Button>}
        <Button loading={busy} disabled={amend && reason.trim().length < 5} onClick={() => submit(true)}>{amend ? "Save amendment" : "Issue prescription"}</Button>
      </div>
    </Modal>
  );
}

function FilesTab({ patientId, files, canUpload }: { patientId: string; files: UploadedFile[]; canUpload: boolean }) {
  const [kind, setKind] = useState("XRAY");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("patientId", patientId);
      fd.append("kind", kind);
      fd.append("file", file);
      await api("/files", { method: "POST", body: fd });
      toast("File uploaded");
      qc.invalidateQueries({ queryKey: [`/patients/${patientId}/summary`] });
      qc.invalidateQueries({ queryKey: ["/files"] });
    } catch (e) { toast(errorMessage(e), "error"); } finally { setBusy(false); }
  };
  const del = useAction((id: string) => send(`/files/${id}`, "DELETE")(), { success: "File removed", invalidate: [["/files"]] });
  return (
    <div className="space-y-4">
      {canUpload && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Select className="sm:w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="File type"><option value="XRAY">X-ray</option><option value="REPORT">Report</option><option value="PHOTO">Photo</option><option value="DOCUMENT">Document</option></Select>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-700">
            <Paperclip className="size-4" />{busy ? "Uploading…" : "Choose file (JPG, PNG, WebP, PDF, DICOM · max 10 MB)"}
            <input type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.pdf,.dcm" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          </label>
        </Card>
      )}
      {!files.length ? <EmptyState>No files uploaded.</EmptyState> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span><Badge className="mr-2">{f.kind}</Badge>{f.originalName} <span className="text-muted">· {(f.sizeBytes / 1024).toFixed(0)} KB · {fmtDate(f.createdAt)}</span></span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => openPdf(`/files/${f.id}/content`)}>View</Button>
                {canUpload && <Button size="sm" variant="ghost" onClick={() => del.mutate(f.id)} aria-label="Delete file"><Trash2 /></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PrescriptionCard({ rx, onEdit }: { rx: Prescription; onEdit?: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{rx.number} <StatusBadge status={rx.status} />{rx.version > 1 && <span className="ml-2 text-xs text-muted">v{rx.version} (amended)</span>}</p>
          <p className="text-sm text-muted">{fmtDate(rx.finalizedAt ?? rx.createdAt)} · {rx.doctor.user.fullName}</p>
          <p className="mt-2 text-sm"><b>Diagnosis:</b> {rx.diagnosis}</p>
        </div>
        <div className="flex gap-1.5">
          {onEdit && <Button size="sm" variant="outline" onClick={onEdit}>{rx.status === "FINAL" ? "Amend" : "Edit"}</Button>}
          <Button size="sm" variant="secondary" onClick={() => openPdf(`/prescriptions/${rx.id}/pdf`)}><FileDown />PDF</Button>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-sm">{rx.items.map((i, n) => <li key={n}><Pill className="mr-1.5 inline size-3.5 text-brand-500" />{i.medicine} — {i.dosage}, {i.frequency}, {i.duration}{i.instructions ? ` (${i.instructions})` : ""}</li>)}</ul>
      {rx.followUpDate && <p className="mt-2 text-sm text-muted">Follow-up: {rx.followUpDate.slice(0, 10)}</p>}
    </Card>
  );
}

export function RecordCard({ r, onEdit }: { r: MedicalRecord; onEdit?: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{fmtDateTime(r.createdAt)}</p>
          <p className="text-sm text-muted">{r.doctor.user.fullName}{r.appointment ? ` · ${r.appointment.treatment.name} (${r.appointment.reference})` : ""}</p>
        </div>
        {onEdit && <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>}
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {r.chiefComplaint && <div><dt className="text-muted">Complaint</dt><dd>{r.chiefComplaint}</dd></div>}
        {r.diagnosis && <div><dt className="text-muted">Diagnosis</dt><dd>{r.diagnosis}</dd></div>}
        {r.treatmentDone && <div><dt className="text-muted">Treatment done</dt><dd>{r.treatmentDone}</dd></div>}
        {r.followUpDate && <div><dt className="text-muted">Follow-up</dt><dd>{r.followUpDate.slice(0, 10)}</dd></div>}
        {r.clinicalNotes && <div className="sm:col-span-2"><dt className="text-muted">Notes</dt><dd className="whitespace-pre-line">{r.clinicalNotes}</dd></div>}
      </dl>
      {r.examination && Object.keys(r.examination.teeth).length > 0 && <div className="mt-4"><ToothChart value={r.examination.teeth} /></div>}
    </Card>
  );
}

type Summary = { appointments: (Appointment & { doctor: { user: { fullName: string } } })[]; invoices: InvoiceRow[]; prescriptions: Prescription[]; records: MedicalRecord[] };

export function PatientChartPage({ base }: { base: string }) {
  const { id = "" } = useParams();
  const { user, can } = useAuth();
  const p = useGet<Patient>(`/patients/${id}`);
  const s = useGet<Summary>(`/patients/${id}/summary`);
  const files = useGet<UploadedFile[]>(can("clinical:read") ? "/files" : null, { patientId: id });
  const [tab, setTab] = useState<"overview" | "records" | "prescriptions" | "files" | "appointments" | "billing">("overview");
  const [rec, setRec] = useState<{ open: boolean; r?: MedicalRecord }>({ open: false });
  const [rx, setRx] = useState<{ open: boolean; rx?: Prescription }>({ open: false });
  const isDoctor = user?.role === "DOCTOR";

  if (p.isError) return <ErrorState message={errorMessage(p.error)} onRetry={() => p.refetch()} />;
  if (!p.data) return <Skeleton className="h-96" />;
  const pt = p.data;
  return (
    <>
      <Link to={base} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand-700"><ArrowLeft className="size-4" />Patients</Link>
      <PageHead title={pt.fullName} subtitle={`${pt.patientCode} · ${pt.phone}${pt.email ? ` · ${pt.email}` : ""}`}
        actions={isDoctor && <><Button variant="secondary" onClick={() => setRec({ open: true })}><FilePlus2 />Clinical record</Button><Button onClick={() => setRx({ open: true })}><Pill />Prescription</Button></>} />
      {pt.allergies.length > 0 && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700"><b>Allergies:</b> {pt.allergies.join(", ")}</p>}
      <Tabs value={tab} onChange={setTab} items={[
        { value: "overview", label: "Profile" },
        ...(can("clinical:read") ? [{ value: "records" as const, label: "Clinical records", count: s.data?.records.length }] : []),
        { value: "prescriptions", label: "Prescriptions", count: s.data?.prescriptions.length },
        ...(files.data ? [{ value: "files" as const, label: "X-rays & reports", count: files.data.length }] : []),
        { value: "appointments", label: "Appointments", count: s.data?.appointments.length },
        ...(can("billing:read") ? [{ value: "billing" as const, label: "Invoices", count: s.data?.invoices.length }] : []),
      ]} />
      {tab === "overview" && <ProfileTab p={pt} />}
      {tab === "records" && <div className="space-y-4">{s.data?.records.length ? s.data.records.map((r) => <RecordCard key={r.id} r={r} onEdit={isDoctor && r.doctor.id === user?.doctorId ? () => setRec({ open: true, r }) : undefined} />) : <EmptyState>No clinical records yet.</EmptyState>}</div>}
      {tab === "prescriptions" && <div className="space-y-4">{s.data?.prescriptions.length ? s.data.prescriptions.map((r) => <PrescriptionCard key={r.id} rx={r} onEdit={isDoctor && r.doctorId === user?.doctorId ? () => setRx({ open: true, rx: r }) : undefined} />) : <EmptyState>No prescriptions yet.</EmptyState>}</div>}
      {tab === "files" && <FilesTab patientId={id} files={files.data ?? []} canUpload={can("clinical:write")} />}
      {tab === "appointments" && (
        <Card className="divide-y divide-line">{s.data?.appointments.length ? s.data.appointments.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><span><b>{fmtDateTime(a.startAt)}</b> · {a.treatment.name} · {a.doctor.user.fullName}</span><StatusBadge status={a.status} /></div>
        )) : <p className="p-6 text-center text-sm text-muted">No appointments.</p>}</Card>
      )}
      {tab === "billing" && (
        <Card className="divide-y divide-line">{s.data?.invoices.length ? s.data.invoices.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><span><b>{i.number}</b> · {fmtDate(i.issuedAt)} · {formatINR(i.totalPaise)}</span><span className="flex items-center gap-2"><StatusBadge status={i.status} /><Button size="sm" variant="outline" onClick={() => openPdf(`/invoices/${i.id}/pdf`)}>PDF</Button></span></div>
        )) : <p className="p-6 text-center text-sm text-muted">No invoices.</p>}</Card>
      )}
      {rec.open && <RecordModal patientId={id} open={rec.open} onOpenChange={(o) => setRec({ open: o })} record={rec.r} />}
      {rx.open && <PrescriptionModal patientId={id} open={rx.open} onOpenChange={(o) => setRx({ open: o })} rx={rx.rx} />}
    </>
  );
}

export function DoctorPrescriptionsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const list = useList<Prescription>("/prescriptions", { page, q });
  const cols: Column<Prescription>[] = [
    { key: "n", label: "Number", render: (r) => <><p className="font-medium">{r.number}</p><p className="text-xs text-muted">{fmtDate(r.createdAt)}</p></> },
    { key: "p", label: "Patient", render: (r) => <Link className="text-brand-700 hover:underline" to={`/doctor/patients/${r.patientId}`}>{r.patient.fullName}</Link> },
    { key: "d", label: "Diagnosis", render: (r) => <span className="line-clamp-2">{r.diagnosis}</span> },
    { key: "s", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "a", label: "", render: (r) => <Button size="sm" variant="outline" onClick={() => openPdf(`/prescriptions/${r.id}/pdf`)}><FileDown />PDF</Button> },
  ];
  return (
    <>
      <PageHead title="Prescriptions" subtitle="Prescriptions you have written. Open a patient's chart to write a new one." />
      <div className="mb-4"><SearchBox value={q} onChange={setQ} placeholder="Patient or RX number" /></div>
      <DataTable columns={cols} query={list} page={page} onPage={setPage} />
    </>
  );
}

