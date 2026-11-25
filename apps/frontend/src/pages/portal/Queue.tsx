import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BellRing, Monitor, Play, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Modal, PageHead, SearchBox, StatusBadge, send, useAction, useList, useLive } from "@/components/dash/kit";
import { ToothMark } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import type { Doctor, Patient, QueueToken } from "@/types/api";
import { cn } from "@/utils/cn";
import { fmtTime } from "@/utils/time";

const KEY = ["queue"];

function TokenCard({ t, staff }: { t: QueueToken; staff: boolean }) {
  const inv = [KEY, ["/appointments"]];
  const act = useAction((a: string) => send(`/queue/${t.id}/${a}`)(), { invalidate: inv });
  const prio = useAction(() => send(`/queue/${t.id}/priority`)({ emergency: t.priority === 0 }), { invalidate: inv });
  const btn = (a: string, label: string, variant: "primary" | "outline" | "secondary" = "outline") => (
    <Button size="sm" variant={variant} loading={act.isPending && act.variables === a} onClick={() => act.mutate(a)}>{label}</Button>
  );
  return (
    <Card className={cn("p-4", t.priority > 0 && "border-red-200 bg-red-50/40", t.status === "IN_CONSULTATION" && "border-brand-300 ring-4 ring-brand-100")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-600 font-display text-lg font-bold text-white">{t.tokenNumber}</span>
          <div>
            <p className="font-semibold">{t.patient.fullName}</p>
            <p className="text-xs text-muted">{t.patient.patientCode} · {t.appointment ? `${t.appointment.treatment.name} · ${fmtTime(t.appointment.startAt)}` : "Walk-in"}</p>
            <p className="text-xs text-muted">Checked in {fmtTime(t.checkedInAt)}{t.estimatedWaitMinutes !== null && ` · ~${t.estimatedWaitMinutes} min wait`}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1"><StatusBadge status={t.status} />{t.priority > 0 && <span className="flex items-center gap-1 text-xs font-semibold text-red-600"><AlertTriangle className="size-3" />Emergency</span>}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["WAITING", "SKIPPED"].includes(t.status) && btn("call", "Call", "secondary")}
        {["WAITING", "CALLED"].includes(t.status) && btn("start", "Start consultation", "primary")}
        {t.status === "IN_CONSULTATION" && btn("complete", "Complete", "primary")}
        {["WAITING", "CALLED"].includes(t.status) && btn("skip", "Skip")}
        {t.status === "SKIPPED" && btn("requeue", "Re-queue")}
        {staff && ["WAITING", "CALLED", "SKIPPED"].includes(t.status) && btn("cancel", "Remove")}
        {staff && ["WAITING", "CALLED"].includes(t.status) && <Button size="sm" variant="ghost" onClick={() => prio.mutate()}>{t.priority ? "Normal priority" : "Mark emergency"}</Button>}
        {!staff && <Button size="sm" variant="ghost" asChild><Link to={`/doctor/patients/${t.patientId}`}>Open chart</Link></Button>}
      </div>
    </Card>
  );
}

function WalkInModal({ open, onOpenChange, doctors }: { open: boolean; onOpenChange: (o: boolean) => void; doctors: Doctor[] }) {
  const [q, setQ] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [emergency, setEmergency] = useState(false);
  const patients = useList<Patient>("/patients", { q, pageSize: 6 }, q.length >= 2);
  const act = useAction(() => send("/queue/check-in")({ patientId: patient!.id, doctorId, emergency }), { success: "Token issued", invalidate: [KEY], onSuccess: () => { onOpenChange(false); setPatient(null); setQ(""); } });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Walk-in check-in" description="Issue a queue token without an appointment. New patients: register them under New booking first.">
      <div className="space-y-4">
        {patient ? <p className="rounded-xl bg-brand-50 p-3 text-sm"><b>{patient.fullName}</b> · {patient.patientCode} <button className="ml-2 text-brand-700 underline" onClick={() => setPatient(null)}>change</button></p> : (
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Search patient" />
            <ul className="divide-y divide-line rounded-xl border border-line empty:hidden">{patients.data?.data.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-surface" onClick={() => setPatient(p)}>{p.fullName} · {p.phone}</button></li>)}</ul>
          </>
        )}
        <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor"><option value="">Select doctor…</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.user.fullName}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-red-600" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />Emergency (moves to front of queue)</label>
        <div className="flex justify-end"><Button disabled={!patient || !doctorId} loading={act.isPending} onClick={() => act.mutate()}>Issue token</Button></div>
      </div>
    </Modal>
  );
}

export function QueuePage({ staff }: { staff: boolean }) {
  const { user } = useAuth();
  const [doctorId, setDoctorId] = useState("");
  const [walkIn, setWalkIn] = useState(false);
  const doctors = useList<Doctor>("/doctors", { status: "active", pageSize: 100 }, staff);
  const board = useQuery({ queryKey: [...KEY, doctorId], queryFn: () => api<{ data: QueueToken[] }>("/queue", { query: { doctorId: doctorId || undefined } }).then((r) => r.data), refetchInterval: 30_000 });
  useLive("queue:changed", [KEY]);
  const callNext = useAction(() => send("/queue/call-next")({ doctorId: staff ? doctorId : undefined }), { success: "Next patient called", invalidate: [KEY] });

  const groups = board.data ? {
    now: board.data.filter((t) => t.status === "IN_CONSULTATION" || t.status === "CALLED"),
    waiting: board.data.filter((t) => t.status === "WAITING"),
    skipped: board.data.filter((t) => t.status === "SKIPPED"),
    done: board.data.filter((t) => t.status === "COMPLETED" || t.status === "CANCELLED"),
  } : null;

  return (
    <>
      <PageHead title={staff ? "Live queue" : "My queue"} subtitle="Updates in real time across all screens."
        actions={<>
          <Button variant="outline" asChild><a href="/queue/display" target="_blank" rel="noreferrer"><Monitor />TV display</a></Button>
          {staff && <Button variant="secondary" onClick={() => setWalkIn(true)}><UserPlus />Walk-in</Button>}
          <Button disabled={staff && !doctorId} loading={callNext.isPending} onClick={() => callNext.mutate()}><BellRing />Call next</Button>
        </>} />
      {staff && (
        <Select className="mb-5 sm:w-64" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>{doctors.data?.data.map((d) => <option key={d.id} value={d.id}>{d.user.fullName}</option>)}
        </Select>
      )}
      {staff && <WalkInModal open={walkIn} onOpenChange={setWalkIn} doctors={doctors.data?.data ?? []} />}
      {board.isError ? <ErrorState onRetry={() => board.refetch()} /> : !groups ? <Skeleton className="h-64" /> : !board.data!.length ? (
        <EmptyState>No one has checked in yet today.{!staff && user && " Patients appear here once reception checks them in."}</EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          {([["Now serving", groups.now, Play], ["Waiting", groups.waiting, null], ["Skipped", groups.skipped, null]] as const).map(([title, items]) => (
            <section key={title} aria-label={title}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title} <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs">{items.length}</span></h2>
              <div className="space-y-3">{items.length ? items.map((t) => <TokenCard key={t.id} t={t} staff={staff} />) : <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">—</p>}</div>
            </section>
          ))}
          {groups.done.length > 0 && <p className="text-sm text-muted xl:col-span-3">Completed today: {groups.done.filter((t) => t.status === "COMPLETED").length}</p>}
        </div>
      )}
    </>
  );
}

/** Full-screen waiting-room display. Shows token numbers only. */
export function QueueDisplay() {
  const q = useQuery({ queryKey: ["queue-display"], queryFn: () => api<{ data: { doctor: string; serving: number | null; called: number[]; waiting: number[] }[] }>("/queue/display").then((r) => r.data), refetchInterval: 20_000 });
  useLive("queue:changed", [["queue-display"]]);
  return (
    <div className="min-h-dvh bg-brand-950 p-6 text-white sm:p-10">
      <title>Queue | Smile Dental Care</title>
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3"><ToothMark className="size-12" /><span className="font-display text-3xl font-bold">Smile Dental Care</span></div>
        <Clock />
      </header>
      {!q.data?.length ? <p className="mt-20 text-center text-2xl text-brand-200">No patients in the queue right now.</p> : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((d) => (
            <div key={d.doctor} className="rounded-3xl bg-white/5 p-8 ring-1 ring-white/10">
              <p className="text-xl text-brand-200">{d.doctor}</p>
              <p className="mt-6 text-sm uppercase tracking-widest text-brand-300">Now serving</p>
              <p className="font-display text-8xl font-extrabold">{d.serving ?? "—"}</p>
              {d.called.length > 0 && <p className="mt-4 animate-pulse text-2xl font-semibold text-amber-300">Please proceed: {d.called.join(", ")}</p>}
              <p className="mt-6 text-sm uppercase tracking-widest text-brand-300">Next</p>
              <p className="mt-1 text-3xl font-semibold">{d.waiting.slice(0, 6).join("  ·  ") || "—"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return <span className="font-display text-3xl">{fmtTime(now)}</span>;
}
