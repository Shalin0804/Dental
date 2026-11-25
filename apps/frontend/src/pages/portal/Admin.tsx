import { CalendarCheck, CalendarClock, CalendarX, Clock3, Download, IndianRupee, Plus, Stethoscope, Trash2, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConfirmAction, DataTable, Modal, PageHead, SearchBox, Stat, StatusBadge, Tabs, send, useAction, useGet, useList, useToast, type Column } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { errorMessage, getAccessToken } from "@/services/api";
import type { StaffUser } from "@/types/api";
import { formatINR } from "@/utils/format";
import { fmtDateTime, todayLocal } from "@/utils/time";

const BRAND = "#0a5bd3";
const SOFT = "#93b4fd";
const GRID = "#e4eaf3";
const month = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });

interface AdminReport {
  cards: { totalPatients: number; totalDoctors: number; todaysAppointments: number; pendingAppointments: number; completedThisMonth: number; cancelledThisMonth: number; monthlyRevenuePaise: number; outstandingPaise: number };
  weekly: { day: string; total: number; completed: number; cancelled: number }[];
  monthly: { month: string; total: number }[];
  revenue: { month: string; netPaise: number }[];
  treatments: { name: string; total: number }[];
  doctors: { doctor: string; appointments: number; completed: number; noShows: number; revenuePaise: number }[];
  patientGrowth: { month: string; total: number }[];
}

function ChartCard({ title, children, empty }: { title: string; children: React.ReactElement; empty?: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {empty ? <p className="grid h-60 place-items-center text-sm text-muted">No data yet</p> : <div className="h-60"><ResponsiveContainer>{children}</ResponsiveContainer></div>}
    </Card>
  );
}
const axis = { tick: { fontSize: 11, fill: "#5b6b82" }, tickLine: false, axisLine: false } as const;

export function AdminDashboard() {
  const r = useGet<AdminReport>("/reports/admin");
  if (r.isError) return <ErrorState onRetry={() => r.refetch()} />;
  if (!r.data) return <Skeleton className="h-[600px]" />;
  const { cards: c, ...d } = r.data;
  return (
    <>
      <PageHead title="Dashboard" subtitle="Live figures from the hospital database." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total patients" value={c.totalPatients.toLocaleString("en-IN")} icon={Users} />
        <Stat label="Active doctors" value={c.totalDoctors} icon={Stethoscope} />
        <Stat label="Today's appointments" value={c.todaysAppointments} icon={CalendarClock} />
        <Stat label="Pending confirmation" value={c.pendingAppointments} icon={Clock3} tone="amber" />
        <Stat label="Completed this month" value={c.completedThisMonth} icon={CalendarCheck} tone="green" />
        <Stat label="Cancelled this month" value={c.cancelledThisMonth} icon={CalendarX} tone="red" />
        <Stat label="Revenue this month" value={formatINR(c.monthlyRevenuePaise)} hint="Collected minus refunds" icon={IndianRupee} tone="green" />
        <Stat label="Outstanding" value={formatINR(c.outstandingPaise)} hint="Unpaid invoice balances" icon={Wallet} tone="amber" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Appointments — last 7 days">
          <BarChart data={d.weekly.map((w) => ({ ...w, label: day(w.day) }))}><CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} width={30} /><Tooltip /><Bar dataKey="completed" name="Completed" stackId="a" fill={BRAND} radius={[0, 0, 0, 0]} /><Bar dataKey="total" name="All booked" fill={SOFT} radius={[6, 6, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Revenue — last 12 months (₹)">
          <LineChart data={d.revenue.map((x) => ({ label: month(x.month), value: x.netPaise / 100 }))}><CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={60} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={(v) => formatINR(Number(v) * 100)} /><Line type="monotone" dataKey="value" name="Net revenue" stroke={BRAND} strokeWidth={2.5} dot={false} /></LineChart>
        </ChartCard>
        <ChartCard title="Appointments — monthly">
          <BarChart data={d.monthly.map((x) => ({ label: month(x.month), total: x.total }))}><CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} width={30} /><Tooltip /><Bar dataKey="total" name="Appointments" fill={BRAND} radius={[6, 6, 0, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="Treatment popularity — last 90 days" empty={!d.treatments.length}>
          <BarChart layout="vertical" data={d.treatments} margin={{ left: 20 }}><CartesianGrid horizontal={false} stroke={GRID} /><XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="name" width={130} {...axis} /><Tooltip /><Bar dataKey="total" name="Bookings" fill={BRAND} radius={[0, 6, 6, 0]} /></BarChart>
        </ChartCard>
        <ChartCard title="New patients — monthly">
          <LineChart data={d.patientGrowth.map((x) => ({ label: month(x.month), total: x.total }))}><CartesianGrid vertical={false} stroke={GRID} /><XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} width={30} /><Tooltip /><Line type="monotone" dataKey="total" name="New patients" stroke={BRAND} strokeWidth={2.5} dot={false} /></LineChart>
        </ChartCard>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold">Doctor performance — this month</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Doctor</th><th className="pb-2 text-right">Booked</th><th className="pb-2 text-right">Completed</th><th className="pb-2 text-right">No-shows</th><th className="pb-2 text-right">Revenue</th></tr></thead>
              <tbody className="divide-y divide-line">{d.doctors.map((x) => <tr key={x.doctor}><td className="py-2">{x.doctor}</td><td className="text-right">{x.appointments}</td><td className="text-right">{x.completed}</td><td className="text-right">{x.noShows}</td><td className="text-right">{formatINR(x.revenuePaise)}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState(`${todayLocal().slice(0, 8)}01`);
  const [to, setTo] = useState(todayLocal());
  const toast = useToast();
  const download = async () => {
    try {
      const r = await fetch(`${import.meta.env.VITE_API_URL ?? "/api"}/reports/appointments.csv?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${getAccessToken()}` }, credentials: "include" });
      if (!r.ok) throw new Error("Export failed");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = `appointments-${from}-to-${to}.csv`;
      a.click();
    } catch (e) { toast(errorMessage(e), "error"); }
  };
  return (
    <>
      <PageHead title="Reports" />
      <Card className="mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(a) => <Input {...a} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Button onClick={download}><Download />Export appointments CSV</Button>
      </Card>
      <AdminDashboard />
    </>
  );
}

/* ================================ Settings ================================ */

type Settings = Record<string, unknown> & { openingHours: { days: string; hours: string }[] };

export function SettingsPage() {
  const s = useGet<Settings>("/settings");
  if (!s.data) return <Skeleton className="h-96" />;
  return <SettingsForm key={s.dataUpdatedAt} initial={s.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [f, setF] = useState(initial);
  const save = useAction(() => {
    const { id: _id, updatedAt: _u, currency: _c, ...body } = f;
    return send("/settings", "PATCH")(body);
  }, { success: "Settings saved", invalidate: [["/settings"], ["public"]] });
  const v = (k: string, type = "text") => ({ type, value: String(f[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: type === "number" ? Number(e.target.value) : e.target.value }) });
  return (
    <>
      <PageHead title="Hospital settings" actions={<Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="grid gap-4 p-6">
          <h2 className="font-semibold">Hospital</h2>
          {[["name", "Name"], ["tagline", "Tagline"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["address", "Address"], ["city", "City"], ["mapEmbedUrl", "Google Maps embed URL"], ["gstin", "GSTIN"]].map(([k, l]) => (
            <Field key={k} label={l}>{(a) => <Input {...a} {...v(k)} />}</Field>
          ))}
          <div>
            <p className="mb-2 text-sm font-medium">Opening hours</p>
            {f.openingHours.map((o, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input value={o.days} onChange={(e) => setF({ ...f, openingHours: f.openingHours.map((x, n) => (n === i ? { ...x, days: e.target.value } : x)) })} aria-label="Days" />
                <Input value={o.hours} onChange={(e) => setF({ ...f, openingHours: f.openingHours.map((x, n) => (n === i ? { ...x, hours: e.target.value } : x)) })} aria-label="Hours" />
                <Button variant="ghost" size="icon" onClick={() => setF({ ...f, openingHours: f.openingHours.filter((_, n) => n !== i) })} aria-label="Remove"><Trash2 /></Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setF({ ...f, openingHours: [...f.openingHours, { days: "", hours: "" }] })}><Plus />Add row</Button>
          </div>
        </Card>
        <Card className="grid content-start gap-4 p-6">
          <h2 className="font-semibold">Booking & billing</h2>
          <Field label="Timezone" hint="IANA name, e.g. Asia/Kolkata">{(a) => <Input {...a} {...v("timezone")} />}</Field>
          <Field label="Slot interval (minutes)">{(a) => <Select {...a} value={String(f.slotStepMinutes)} onChange={(e) => setF({ ...f, slotStepMinutes: Number(e.target.value) })}>{[5, 10, 15, 20, 30].map((n) => <option key={n}>{n}</option>)}</Select>}</Field>
          <Field label="Booking window (days ahead)">{(a) => <Input {...a} {...v("bookingWindowDays", "number")} />}</Field>
          <Field label="Minimum notice for online booking (minutes)">{(a) => <Input {...a} {...v("minNoticeMinutes", "number")} />}</Field>
          <Field label="Online cancel/reschedule window (hours before)">{(a) => <Input {...a} {...v("cancellationWindowHours", "number")} />}</Field>
          <Field label="Tax rate (basis points)" hint="1800 = 18%. Dental services are usually GST-exempt (0).">{(a) => <Input {...a} {...v("taxRateBp", "number")} />}</Field>
          <Field label="Invoice prefix">{(a) => <Input {...a} {...v("invoicePrefix")} />}</Field>
        </Card>
      </div>
    </>
  );
}

/* ================================ CMS ================================ */

function JsonBlockEditor({ k, value }: { k: string; value: unknown }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const save = useAction(async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); setErr(null); } catch { setErr("Invalid JSON"); throw new Error("Fix the JSON before saving"); }
    return send(`/cms/blocks/${k}`, "PUT")(parsed);
  }, { success: `${k} section saved`, invalidate: [["/cms/blocks"], ["public"]] });
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold capitalize">{k.replace(/([A-Z])/g, " $1")}</h3><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
      <Textarea className="min-h-56 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} aria-label={`${k} content`} spellCheck={false} />
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </Card>
  );
}

function LegalEditor({ value }: { value: { privacy: string; terms: string } }) {
  const [f, setF] = useState(value);
  const save = useAction(() => send("/cms/blocks/legal", "PUT")(f), { success: "Legal pages saved", invalidate: [["public"]] });
  return (
    <Card className="grid gap-4 p-5">
      <Field label="Privacy policy">{(a) => <Textarea {...a} className="min-h-64" value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })} />}</Field>
      <Field label="Terms & conditions">{(a) => <Textarea {...a} className="min-h-64" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />}</Field>
      <div><Button loading={save.isPending} onClick={() => save.mutate()}>Save legal pages</Button></div>
    </Card>
  );
}

function HeroEditor({ value }: { value: { eyebrow: string; title: string; subtitle: string; imageUrl: string | null } }) {
  const [f, setF] = useState(value);
  const save = useAction(() => send("/cms/blocks/hero", "PUT")({ ...f, imageUrl: f.imageUrl || null }), { success: "Hero saved", invalidate: [["public"]] });
  return (
    <Card className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="Eyebrow">{(a) => <Input {...a} value={f.eyebrow} onChange={(e) => setF({ ...f, eyebrow: e.target.value })} />}</Field>
      <Field label="Image URL">{(a) => <Input {...a} value={f.imageUrl ?? ""} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />}</Field>
      <Field label="Headline" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <Field label="Subtitle" className="sm:col-span-2">{(a) => <Textarea {...a} className="min-h-20" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />}</Field>
      <div><Button loading={save.isPending} onClick={() => save.mutate()}>Save hero</Button></div>
    </Card>
  );
}

function FaqsEditor() {
  const faqs = useGet<{ id: string; question: string; answer: string; sortOrder: number; isActive: boolean }[]>("/cms/faqs");
  const [n, setN] = useState({ question: "", answer: "" });
  const inv = [["/cms/faqs"], ["public"]];
  const add = useAction(() => send("/cms/faqs")({ ...n, sortOrder: (faqs.data?.length ?? 0) + 1 }), { success: "FAQ added", invalidate: inv, onSuccess: () => setN({ question: "", answer: "" }) });
  const upd = useAction(({ id, ...b }: { id: string; question?: string; answer?: string; isActive?: boolean }) => send(`/cms/faqs/${id}`, "PATCH")(b), { success: "FAQ saved", invalidate: inv });
  const del = useAction((id: string) => send(`/cms/faqs/${id}`, "DELETE")(), { success: "FAQ deleted", invalidate: inv });
  return (
    <div className="space-y-3">
      {faqs.data?.map((f) => <FaqRow key={f.id} f={f} onSave={(b) => upd.mutate({ id: f.id, ...b })} onDelete={() => del.mutateAsync(f.id)} />)}
      <Card className="grid gap-3 p-5">
        <h3 className="font-semibold">Add FAQ</h3>
        <Input placeholder="Question" value={n.question} onChange={(e) => setN({ ...n, question: e.target.value })} aria-label="Question" />
        <Textarea placeholder="Answer" className="min-h-20" value={n.answer} onChange={(e) => setN({ ...n, answer: e.target.value })} aria-label="Answer" />
        <div><Button disabled={n.question.length < 5 || n.answer.length < 5} loading={add.isPending} onClick={() => add.mutate()}><Plus />Add</Button></div>
      </Card>
    </div>
  );
}
function FaqRow({ f, onSave, onDelete }: { f: { question: string; answer: string; isActive: boolean }; onSave: (b: { question: string; answer: string; isActive: boolean }) => void; onDelete: () => Promise<unknown> }) {
  const [v, setV] = useState(f);
  return (
    <Card className="grid gap-2 p-4">
      <Input value={v.question} onChange={(e) => setV({ ...v, question: e.target.value })} aria-label="Question" />
      <Textarea className="min-h-16" value={v.answer} onChange={(e) => setV({ ...v, answer: e.target.value })} aria-label="Answer" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />Visible</label>
        <Button size="sm" onClick={() => onSave(v)}>Save</Button>
        <ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" title="Delete this FAQ?" danger confirmLabel="Delete" onConfirm={onDelete} />
      </div>
    </Card>
  );
}

function MessagesList() {
  const [page, setPage] = useState(1);
  const list = useList<{ id: string; name: string; email: string; phone: string | null; subject: string; message: string; status: string; createdAt: string }>("/contact-messages", { page });
  const upd = useAction(({ id, status }: { id: string; status: string }) => send(`/contact-messages/${id}`, "PATCH")({ status }), { invalidate: [["/contact-messages"]] });
  return <DataTable query={list} page={page} onPage={setPage} empty="No enquiries." columns={[
    { key: "f", label: "From", render: (m) => <><p className="font-medium">{m.name}</p><p className="text-xs text-muted">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p><p className="text-xs text-muted">{fmtDateTime(m.createdAt)}</p></> },
    { key: "m", label: "Message", render: (m) => <><p className="font-medium">{m.subject}</p><p className="whitespace-pre-line text-muted">{m.message}</p></> },
    { key: "s", label: "", render: (m) => <div className="flex flex-col items-end gap-1.5"><StatusBadge status={m.status} />{m.status === "NEW" && <Button size="sm" variant="outline" onClick={() => upd.mutate({ id: m.id, status: "READ" })}>Mark read</Button>}{m.status !== "ARCHIVED" && <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: m.id, status: "ARCHIVED" })}>Archive</Button>}</div> },
  ]} />;
}

export function CmsPage() {
  const blocks = useGet<Record<string, unknown>>("/cms/blocks");
  const [tab, setTab] = useState<"hero" | "sections" | "faqs" | "legal" | "messages">("hero");
  return (
    <>
      <PageHead title="Website CMS" subtitle="Changes appear on the public website immediately." actions={<Button variant="outline" asChild><a href="/" target="_blank" rel="noreferrer">View website</a></Button>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: "hero", label: "Hero" }, { value: "sections", label: "About & sections" }, { value: "faqs", label: "FAQs" }, { value: "legal", label: "Legal pages" }, { value: "messages", label: "Enquiries" }]} />
      {!blocks.data ? <Skeleton className="h-64" /> : (
        <>
          {tab === "hero" && <HeroEditor value={blocks.data.hero as never} />}
          {tab === "sections" && <div className="grid gap-4 lg:grid-cols-2">{["about", "stats", "whyChooseUs", "process"].map((k) => <JsonBlockEditor key={k} k={k} value={blocks.data![k]} />)}</div>}
          {tab === "faqs" && <FaqsEditor />}
          {tab === "legal" && <LegalEditor value={blocks.data.legal as never} />}
          {tab === "messages" && <MessagesList />}
        </>
      )}
      <p className="mt-6 text-xs text-muted">Treatments and doctors shown on the website are managed in their own sections. Section icons: shield, sparkles, microscope, heart, award, clock, users, rupee, stethoscope.</p>
    </>
  );
}

/* ================================ Reviews ================================ */

export function ReviewsAdminPage() {
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [page, setPage] = useState(1);
  const list = useList<{ id: string; authorName: string; rating: number; comment: string; status: string; createdAt: string; doctor: { user: { fullName: string } } | null }>("/reviews", { status, page });
  const upd = useAction(({ id, s }: { id: string; s: string }) => send(`/reviews/${id}`, "PATCH")({ status: s }), { success: "Review updated", invalidate: [["/reviews"], ["public"]] });
  const del = useAction((id: string) => send(`/reviews/${id}`, "DELETE")(), { success: "Review deleted", invalidate: [["/reviews"], ["public"]] });
  return (
    <>
      <PageHead title="Reviews" subtitle="Only approved reviews appear on the website." />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }]} />
      <DataTable query={list} page={page} onPage={setPage} empty="No reviews." columns={[
        { key: "a", label: "Patient", render: (r) => <><p className="font-medium">{r.authorName}</p><p className="text-xs text-muted">{fmtDateTime(r.createdAt)}</p></> },
        { key: "d", label: "Doctor", render: (r) => r.doctor?.user.fullName ?? "—" },
        { key: "r", label: "Review", render: (r) => <><p className="text-amber-500">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></p><p>{r.comment}</p></> },
        { key: "x", label: "", render: (r) => <div className="flex gap-1.5">{r.status !== "APPROVED" && <Button size="sm" onClick={() => upd.mutate({ id: r.id, s: "APPROVED" })}>Approve</Button>}{r.status !== "REJECTED" && <Button size="sm" variant="outline" onClick={() => upd.mutate({ id: r.id, s: "REJECTED" })}>Reject</Button>}<ConfirmAction label={<Trash2 className="size-4" />} variant="ghost" title="Delete review?" danger onConfirm={() => del.mutateAsync(r.id)} /></div> },
      ]} />
    </>
  );
}

/* ================================ Notifications log ================================ */

export function NotificationsAdminPage() {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [page, setPage] = useState(1);
  const list = useList<{ id: string; channel: string; template: string; recipient: string; status: string; attempts: number; lastError: string | null; createdAt: string; sentAt: string | null }>("/notifications", { status: status || undefined, channel: channel || undefined, page });
  const retry = useAction((id: string) => send(`/notifications/${id}/retry`)(), { success: "Queued for retry", invalidate: [["/notifications"]] });
  return (
    <>
      <PageHead title="Notifications" subtitle="Delivery log for WhatsApp, SMS and email. SKIPPED means that channel's API credentials are not configured." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Select className="sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{["PENDING", "SENT", "FAILED", "SKIPPED"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select className="sm:w-44" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"><option value="">All channels</option>{["EMAIL", "SMS", "WHATSAPP", "IN_APP"].map((s) => <option key={s}>{s}</option>)}</Select>
      </div>
      <DataTable query={list} page={page} onPage={setPage} empty="No notifications." columns={[
        { key: "w", label: "When", render: (n) => fmtDateTime(n.createdAt) },
        { key: "c", label: "Channel", render: (n) => n.channel },
        { key: "t", label: "Template", render: (n) => <>{n.template.replaceAll("_", " ")}<p className="text-xs text-muted">{n.recipient}</p></> },
        { key: "s", label: "Status", render: (n) => <><StatusBadge status={n.status} /><p className="mt-1 max-w-64 text-xs text-muted">{n.lastError}</p></> },
        { key: "a", label: "Attempts", render: (n) => n.attempts },
        { key: "x", label: "", render: (n) => ["FAILED", "SKIPPED"].includes(n.status) ? <Button size="sm" variant="outline" onClick={() => retry.mutate(n.id)}>Retry</Button> : null },
      ]} />
    </>
  );
}

/* ================================ Staff, roles, audit ================================ */

function StaffModal({ u, open, onOpenChange }: { u?: StaffUser; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const [f, setF] = useState({ fullName: u?.fullName ?? "", email: u?.email ?? "", phone: u?.phone ?? "", password: "", role: (u?.role.name ?? "RECEPTIONIST") as string, designation: u?.staff?.designation ?? "Front Desk Executive" });
  const save = useAction(() => (u ? send(`/staff/${u.id}`, "PATCH")({ fullName: f.fullName, phone: f.phone, designation: f.designation, ...(f.password ? { password: f.password } : {}) }) : send("/staff")(f)), { success: "Staff saved", invalidate: [["/staff"]], onSuccess: () => onOpenChange(false) });
  const v = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={u ? `Edit ${u.fullName}` : "Add staff member"} description="Doctors are added under Doctors & schedules.">
      <div className="grid gap-4">
        <Field label="Full name">{(a) => <Input {...a} {...v("fullName")} />}</Field>
        {!u && <Field label="Email">{(a) => <Input {...a} type="email" {...v("email")} />}</Field>}
        <Field label="Phone">{(a) => <Input {...a} type="tel" {...v("phone")} />}</Field>
        {!u && <Field label="Role">{(a) => <Select {...a} {...v("role")}><option value="RECEPTIONIST">Receptionist</option>{can("roles:manage") && <><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super admin</option></>}</Select>}</Field>}
        <Field label="Designation">{(a) => <Input {...a} {...v("designation")} />}</Field>
        <Field label={u ? "Reset password (optional)" : "Initial password"} hint="8+ characters with a letter and a number">{(a) => <Input {...a} type="password" autoComplete="new-password" {...v("password")} />}</Field>
      </div>
      <div className="mt-6 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}

export function StaffPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ open: boolean; u?: StaffUser }>({ open: false });
  const list = useList<StaffUser>("/staff", { q, page });
  const toggle = useAction((u: StaffUser) => send(`/staff/${u.id}`, "PATCH")({ isActive: !u.isActive }), { success: "Updated", invalidate: [["/staff"]] });
  const cols: Column<StaffUser>[] = [
    { key: "n", label: "Name", render: (u) => <><p className="font-medium">{u.fullName}</p><p className="text-xs text-muted">{u.email}</p></> },
    { key: "r", label: "Role", render: (u) => <>{u.role.name.replace("_", " ").toLowerCase()}<p className="text-xs text-muted">{u.staff?.designation}</p></> },
    { key: "l", label: "Last login", render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never") },
    { key: "s", label: "Status", render: (u) => <StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} /> },
    { key: "a", label: "", render: (u) => u.doctor ? <span className="text-xs text-muted">Manage under Doctors</span> : (
      <div className="flex gap-1.5"><Button size="sm" variant="outline" onClick={() => setEdit({ open: true, u })}>Edit</Button>
        <ConfirmAction label={u.isActive ? "Deactivate" : "Activate"} variant="ghost" title={`${u.isActive ? "Deactivate" : "Activate"} ${u.fullName}?`} description={u.isActive ? "They will be signed out immediately." : undefined} danger={u.isActive} onConfirm={() => toggle.mutateAsync(u)} /></div>
    ) },
  ];
  return (
    <>
      <PageHead title="Staff" actions={<Button onClick={() => setEdit({ open: true })}><Plus />Add staff</Button>} />
      <div className="mb-4"><SearchBox value={q} onChange={setQ} /></div>
      <DataTable columns={cols} query={list} page={page} onPage={setPage} />
      {edit.open && <StaffModal u={edit.u} open={edit.open} onOpenChange={(o) => setEdit({ open: o })} />}
    </>
  );
}

export function RolesPage() {
  const r = useGet<{ roles: { id: string; name: string; users: number; permissions: string[] }[]; permissions: { key: string; description: string | null }[] }>("/roles");
  const [sel, setSel] = useState<Record<string, Set<string>>>({});
  const save = useAction((role: string) => send(`/roles/${role}`, "PUT")({ permissions: [...(sel[role] ?? [])] }), { success: "Permissions saved", invalidate: [["/roles"]] });
  if (!r.data) return <Skeleton className="h-96" />;
  const get = (role: string, fallback: string[]) => sel[role] ?? new Set(fallback);
  const editable = r.data.roles.filter((x) => x.name !== "SUPER_ADMIN");
  return (
    <>
      <PageHead title="Roles & permissions" subtitle="Super admin always has every permission. Changes take effect within a minute." />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-line bg-surface text-xs text-muted"><tr><th className="px-4 py-3 text-left">Permission</th>{editable.map((x) => <th key={x.name} className="px-3 py-3">{x.name.replace("_", " ")}<br /><span className="font-normal">{x.users} users</span></th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {r.data.permissions.map((p) => (
              <tr key={p.key}>
                <td className="px-4 py-2.5"><p className="font-mono text-xs">{p.key}</p><p className="text-xs text-muted">{p.description}</p></td>
                {editable.map((x) => {
                  const s = get(x.name, x.permissions);
                  return <td key={x.name} className="text-center"><input type="checkbox" className="size-4 accent-brand-600" aria-label={`${x.name} ${p.key}`} checked={s.has(p.key)} onChange={(e) => { const n = new Set(s); if (e.target.checked) n.add(p.key); else n.delete(p.key); setSel({ ...sel, [x.name]: n }); }} /></td>;
                })}
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td />{editable.map((x) => <td key={x.name} className="p-3 text-center"><Button size="sm" disabled={!sel[x.name]} onClick={() => save.mutate(x.name)}>Save</Button></td>)}</tr></tfoot>
        </table>
      </Card>
    </>
  );
}

export function AuditPage() {
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const list = useList<{ id: string; action: string; entity: string; entityId: string | null; ip: string | null; createdAt: string; actor: { fullName: string; email: string; role: { name: string } } | null; after: unknown }>("/audit-logs", { entity: entity || undefined, page, pageSize: 30 });
  const [show, setShow] = useState<unknown>(null);
  return (
    <>
      <PageHead title="Audit logs" subtitle="Every clinical, billing and administrative change, with who made it." />
      <Select className="mb-4 sm:w-56" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity">
        <option value="">All entities</option>{["Appointment", "Patient", "Prescription", "MedicalRecord", "Invoice", "Payment", "Refund", "Doctor", "Treatment", "User", "Role", "HospitalSettings", "CmsBlock", "UploadedFile", "QueueToken"].map((x) => <option key={x}>{x}</option>)}
      </Select>
      <DataTable query={list} page={page} onPage={setPage} columns={[
        { key: "w", label: "When", render: (a) => fmtDateTime(a.createdAt) },
        { key: "u", label: "Who", render: (a) => a.actor ? <>{a.actor.fullName}<p className="text-xs text-muted">{a.actor.role.name.toLowerCase()}</p></> : <span className="text-muted">System</span> },
        { key: "a", label: "Action", render: (a) => <span className="font-mono text-xs">{a.action}</span> },
        { key: "e", label: "Record", render: (a) => <>{a.entity}<p className="font-mono text-[11px] text-muted">{a.entityId}</p></> },
        { key: "i", label: "IP", render: (a) => <span className="text-xs text-muted">{a.ip}</span> },
        { key: "x", label: "", render: (a) => a.after ? <Button size="sm" variant="ghost" onClick={() => setShow(a.after)}>Details</Button> : null },
      ]} />
      <Modal open={show !== null} onOpenChange={(o) => !o && setShow(null)} title="Change details" wide><pre className="max-h-[60vh] overflow-auto rounded-xl bg-surface p-4 text-xs">{JSON.stringify(show, null, 2)}</pre></Modal>
    </>
  );
}

