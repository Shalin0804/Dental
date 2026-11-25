import { useQuery } from "@tanstack/react-query";
import { FileDown, Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmAction, DataTable, Modal, PageHead, SearchBox, StatusBadge, Tabs, openPdf, send, useAction, useGet, useList, type Column } from "@/components/dash/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import { payWithRazorpay } from "@/services/razorpay";
import type { Invoice, InvoiceRow, Patient, Payment, Treatment } from "@/types/api";
import { formatINR } from "@/utils/format";
import { fmtDate, fmtDateTime } from "@/utils/time";

const KEYS = [["/invoices"], ["/payments"]];
const rupeesToPaise = (s: string) => Math.round(Number(s || 0) * 100);

function CreateInvoiceModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState([{ description: "", quantity: 1, unit: "", treatmentId: "" }]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const patients = useList<Patient>("/patients", { q, pageSize: 6 }, q.length >= 2);
  const treatments = useList<Treatment>("/treatments", { status: "active", pageSize: 100 });
  const body = { items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: rupeesToPaise(i.unit), treatmentId: i.treatmentId || null })), discountPaise: rupeesToPaise(discount) };
  const preview = useQuery({ queryKey: ["invoice-preview", body], queryFn: () => api<{ data: { subtotalPaise: number; discountPaise: number; taxPaise: number; totalPaise: number } }>("/invoices/preview", { method: "POST", body }).then((r) => r.data), enabled: open && items.every((i) => i.description && i.unit) });
  const create = useAction(() => api<{ data: Invoice }>("/invoices", { method: "POST", body: { ...body, patientId: patient!.id, notes } }).then((r) => r.data), { success: "Invoice created", invalidate: KEYS, onSuccess: (inv) => { onOpenChange(false); onCreated(inv.id); } });
  const set = (i: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create invoice" wide>
      <div className="space-y-5">
        {patient ? <p className="rounded-xl bg-brand-50 p-3 text-sm"><b>{patient.fullName}</b> · {patient.patientCode} <button className="ml-2 text-brand-700 underline" onClick={() => setPatient(null)}>change</button></p> : (
          <div><SearchBox value={q} onChange={setQ} placeholder="Find patient" />
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line empty:hidden">{patients.data?.data.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-surface" onClick={() => setPatient(p)}>{p.fullName} · {p.patientCode} · {p.phone}</button></li>)}</ul>
          </div>
        )}
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1.2fr_2fr_70px_110px_auto]">
              <Select value={it.treatmentId} aria-label="Treatment" onChange={(e) => { const t = treatments.data?.data.find((x) => x.id === e.target.value); set(i, { treatmentId: e.target.value, ...(t ? { description: t.name, unit: String(t.pricePaise / 100) } : {}) }); }}>
                <option value="">Custom item</option>{treatments.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Input placeholder="Description" value={it.description} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" />
              <Input type="number" min={1} value={it.quantity} onChange={(e) => set(i, { quantity: Math.max(1, Number(e.target.value)) })} aria-label="Quantity" />
              <Input type="number" min={0} step="0.01" placeholder="Rate ₹" value={it.unit} onChange={(e) => set(i, { unit: e.target.value })} aria-label="Rate in rupees" />
              <Button variant="ghost" size="icon" disabled={items.length === 1} onClick={() => setItems(items.filter((_, n) => n !== i))} aria-label="Remove line"><Trash2 /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setItems([...items, { description: "", quantity: 1, unit: "", treatmentId: "" }])}><Plus />Add line</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Discount (₹)">{(a) => <Input {...a} type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />}</Field>
          <Field label="Notes">{(a) => <Input {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        {preview.data && (
          <dl className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatINR(preview.data.subtotalPaise)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>- {formatINR(preview.data.discountPaise)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd>{formatINR(preview.data.taxPaise)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd>{formatINR(preview.data.totalPaise)}</dd></div>
          </dl>
        )}
      </div>
      <div className="mt-6 flex justify-end"><Button disabled={!patient || !items.every((i) => i.description && i.unit)} loading={create.isPending} onClick={() => create.mutate()}>Create invoice</Button></div>
    </Modal>
  );
}

export function InvoiceDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, user } = useAuth();
  const inv = useGet<Invoice>(`/invoices/${id}`);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [ref, setRef] = useState("");
  const inval = [...KEYS, [`/invoices/${id}`]];
  const pay = useAction(() => send(`/invoices/${id}/payments`)({ amountPaise: rupeesToPaise(amount), method, reference: ref || null }), { success: "Payment recorded", invalidate: inval, onSuccess: () => { setAmount(""); setRef(""); } });
  const voidInv = useAction((reason: string) => send(`/invoices/${id}/void`)({ reason }), { success: "Invoice voided", invalidate: inval });
  const refund = useAction(({ paymentId, reason, amountPaise }: { paymentId: string; reason: string; amountPaise: number }) => send(`/payments/${paymentId}/refunds`)({ amountPaise, reason }), { success: "Refund recorded", invalidate: inval });
  const payOnline = useAction(async () => {
    const r = await api<{ data: NonNullable<Parameters<typeof payWithRazorpay>[0]> }>(`/invoices/${id}/pay-online`, { method: "POST" });
    return payWithRazorpay(r.data, `Invoice ${inv.data?.number}`);
  }, { invalidate: inval });
  const i = inv.data;
  const due = i ? i.totalPaise - i.paidPaise + i.refundedPaise : 0;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={i ? `Invoice ${i.number}` : "Invoice"} description={i ? `${i.patient.fullName} · ${fmtDate(i.issuedAt)}` : undefined} wide>
      {!i ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={i.status} /><span className="text-sm text-muted">Balance due <b className="text-ink">{formatINR(Math.max(0, due))}</b></span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openPdf(`/invoices/${i.id}/pdf`)}><FileDown />PDF</Button>
              <Button size="sm" variant="outline" onClick={() => openPdf(`/invoices/${i.id}/pdf`)}><Printer />Print</Button>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">{i.items.map((it) => <tr key={it.id}><td className="py-2">{it.description}</td><td className="text-right">{it.quantity}</td><td className="text-right">{formatINR(it.unitPricePaise)}</td><td className="text-right">{formatINR(it.amountPaise)}</td></tr>)}</tbody>
            <tfoot className="text-right">
              <tr><td colSpan={3} className="pt-2 text-muted">Subtotal</td><td className="pt-2">{formatINR(i.subtotalPaise)}</td></tr>
              {i.discountPaise > 0 && <tr><td colSpan={3} className="text-muted">Discount</td><td>- {formatINR(i.discountPaise)}</td></tr>}
              {i.taxPaise > 0 && <tr><td colSpan={3} className="text-muted">Tax</td><td>{formatINR(i.taxPaise)}</td></tr>}
              <tr className="font-semibold"><td colSpan={3}>Total</td><td>{formatINR(i.totalPaise)}</td></tr>
            </tfoot>
          </table>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Payments</h3>
            {!i.payments.filter((p) => p.status !== "CREATED").length ? <p className="text-sm text-muted">No payments yet.</p> : (
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {i.payments.filter((p) => p.status !== "CREATED").map((p) => {
                  const refunded = p.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountPaise, 0);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <span>{p.paidAt ? fmtDateTime(p.paidAt) : fmtDateTime(p.createdAt)} · {p.method.replaceAll("_", " ")} · <b>{formatINR(p.amountPaise)}</b>{refunded > 0 && <span className="text-violet-700"> (refunded {formatINR(refunded)})</span>}</span>
                      <span className="flex items-center gap-2"><StatusBadge status={p.status} />
                        {can("billing:manage") && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status) && (
                          <ConfirmAction label="Refund" title={`Refund up to ${formatINR(p.amountPaise - refunded)}`} description="Enter the reason. Full remaining amount is refunded; for partial refunds use the Payments page." withReason="Reason" danger confirmLabel="Refund"
                            onConfirm={(reason) => refund.mutateAsync({ paymentId: p.id, reason, amountPaise: p.amountPaise - refunded })} />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {can("billing:manage") && i.status !== "VOID" && due > 0 && (
            <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <Field label="Amount (₹)">{(a) => <Input {...a} type="number" min={0} step="0.01" max={due / 100} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(due / 100).toFixed(2)} />}</Field>
              <Field label="Method">{(a) => <Select {...a} value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option></Select>}</Field>
              <Field label="Reference">{(a) => <Input {...a} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UPI / card ref" />}</Field>
              <Button loading={pay.isPending} disabled={!amount} onClick={() => pay.mutate()}>Record</Button>
            </Card>
          )}
          {user?.role === "PATIENT" && i.status !== "VOID" && due > 0 && <Button loading={payOnline.isPending} onClick={() => payOnline.mutate()}>Pay {formatINR(due)} online</Button>}
          {can("billing:manage") && i.status !== "VOID" && i.paidPaise - i.refundedPaise === 0 && (
            <ConfirmAction label="Void invoice" variant="ghost" title="Void this invoice?" description="Voided invoices stay on record but no longer count as due." withReason="Reason" danger onConfirm={(r) => voidInv.mutateAsync(r)} />
          )}
        </div>
      )}
    </Modal>
  );
}

export function InvoicesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<"" | "OUTSTANDING" | "PAID" | "VOID">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useList<InvoiceRow>("/invoices", { status: status || undefined, q, page });
  const cols: Column<InvoiceRow>[] = [
    { key: "n", label: "Invoice", render: (i) => <><p className="font-medium">{i.number}</p><p className="text-xs text-muted">{fmtDate(i.issuedAt)}</p></> },
    { key: "p", label: "Patient", render: (i) => <>{i.patient.fullName}<p className="text-xs text-muted">{i.patient.patientCode}</p></> },
    { key: "t", label: "Total", render: (i) => formatINR(i.totalPaise) },
    { key: "d", label: "Due", render: (i) => (i.status === "VOID" ? "—" : formatINR(Math.max(0, i.totalPaise - i.paidPaise + i.refundedPaise))) },
    { key: "s", label: "Status", render: (i) => <StatusBadge status={i.status} /> },
  ];
  return (
    <>
      <PageHead title="Billing" actions={can("billing:manage") && <Button onClick={() => setCreate(true)}><Plus />New invoice</Button>} />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ value: "", label: "All" }, { value: "OUTSTANDING", label: "Outstanding" }, { value: "PAID", label: "Paid" }, { value: "VOID", label: "Void" }]} />
      <div className="mb-4"><SearchBox value={q} onChange={setQ} placeholder="Invoice no., patient or phone" /></div>
      <DataTable columns={cols} query={list} page={page} onPage={setPage} onRowClick={(i) => setOpen(i.id)} empty="No invoices." />
      {create && <CreateInvoiceModal open={create} onOpenChange={setCreate} onCreated={setOpen} />}
      {open && <InvoiceDetailModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function PaymentsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const list = useList<Payment>("/payments", { q, page, status: status || undefined });
  const refund = useAction(({ id, amountPaise, reason }: { id: string; amountPaise: number; reason: string }) => send(`/payments/${id}/refunds`)({ amountPaise, reason }), { success: "Refund recorded", invalidate: KEYS });
  const cols: Column<Payment>[] = [
    { key: "d", label: "Date", render: (p) => fmtDateTime(p.paidAt ?? p.createdAt) },
    { key: "p", label: "Patient", render: (p) => p.patient?.fullName },
    { key: "r", label: "For", render: (p) => <span className="text-muted">{p.invoice?.number ?? p.appointment?.reference ?? "—"}</span> },
    { key: "m", label: "Method", render: (p) => <>{p.method.replaceAll("_", " ")}<p className="text-xs text-muted">{p.razorpayPaymentId ?? p.reference}</p></> },
    { key: "a", label: "Amount", render: (p) => <>{formatINR(p.amountPaise)}{p.refunds?.length ? <p className="text-xs text-violet-700">refunded {formatINR(p.refunds.reduce((s, r) => s + r.amountPaise, 0))}</p> : null}</> },
    { key: "s", label: "Status", render: (p) => <StatusBadge status={p.status} /> },
    ...(can("billing:manage") ? [{ key: "x", label: "", render: (p: Payment) => ["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status) ? <PartialRefund p={p} onRefund={(amountPaise, reason) => refund.mutateAsync({ id: p.id, amountPaise, reason })} /> : null }] : []),
  ];
  return (
    <>
      <PageHead title="Payments" subtitle="Online (Razorpay) and desk payments, with refunds." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchBox value={q} onChange={setQ} placeholder="Patient, invoice or Razorpay id" />
        <Select className="sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{["CAPTURED", "CREATED", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}</Select>
      </div>
      <DataTable columns={cols} query={list} page={page} onPage={setPage} empty="No payments." />
    </>
  );
}

function PartialRefund({ p, onRefund }: { p: Payment; onRefund: (amountPaise: number, reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const left = p.amountPaise - (p.refunds ?? []).filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountPaise, 0);
  const [amt, setAmt] = useState(String(left / 100));
  const [reason, setReason] = useState("");
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Refund</Button>
      <Modal open={open} onOpenChange={setOpen} title="Refund payment" description={p.method === "RAZORPAY" ? "Refund is issued through Razorpay to the original payment method." : "Record a refund handed back at the desk."}>
        <div className="space-y-4">
          <Field label={`Amount (max ${formatINR(left)})`}>{(a) => <Input {...a} type="number" min={1} max={left / 100} step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} />}</Field>
          <Field label="Reason">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end"><Button variant="danger" disabled={reason.trim().length < 3 || !amt} onClick={async () => { await onRefund(rupeesToPaise(amt), reason); setOpen(false); }}>Refund</Button></div>
        </div>
      </Modal>
    </>
  );
}
