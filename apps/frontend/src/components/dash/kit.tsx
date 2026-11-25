import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, getAccessToken } from "@/services/api";
import { cn } from "@/utils/cn";

/* ------------------------------ Data hooks ------------------------------ */

export interface Page<T> { data: T[]; meta: { page: number; pageSize: number; total: number; pages: number } }
type Q = Record<string, string | number | boolean | undefined | null>;

export const useList = <T,>(path: string, query: Q = {}, enabled = true) =>
  useQuery({ queryKey: [path, query], queryFn: () => api<Page<T>>(path, { query }), enabled, placeholderData: (prev) => prev });

export const useGet = <T,>(path: string | null, query: Q = {}) =>
  useQuery({ queryKey: [path, query], queryFn: () => api<{ data: T }>(path!, { query }).then((r) => r.data), enabled: !!path });

/** Mutation that toasts and invalidates the given query prefixes on success. */
export function useAction<TVars = void, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast(opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

export const send = (path: string, method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST") => (body?: unknown) => api(path, { method, body });

/** Refetches queries when the server broadcasts a change (no data travels over the socket). */
export function useLive(event: "queue:changed" | "appointments:changed", keys: QueryKey[]) {
  const qc = useQueryClient();
  useEffect(() => {
    const s = io(import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL).origin : "/", { transports: ["websocket", "polling"] });
    const fn = () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    s.on(event, fn);
    return () => { s.off(event, fn); s.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}

/** Opens an authenticated PDF in a new tab. */
export async function openPdf(path: string) {
  const base = import.meta.env.VITE_API_URL ?? "/api";
  const w = window.open("", "_blank");
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` }, credentials: "include" });
  if (!r.ok) { w?.close(); throw new Error("Could not open the document"); }
  const url = URL.createObjectURL(await r.blob());
  if (w) w.location.href = url; else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ------------------------------ Toasts ------------------------------ */

type Toast = { id: number; msg: string; kind: "ok" | "error" };
const ToastCtx = createContext<(msg: string, kind?: "ok" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("rounded-xl px-4 py-3 text-sm shadow-lift", t.kind === "error" ? "bg-red-600 text-white" : "bg-ink text-white")}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------ Layout bits ------------------------------ */

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = "brand" }: { label: string; value: ReactNode; hint?: string; icon?: React.ComponentType<{ className?: string }>; tone?: "brand" | "green" | "amber" | "red" }) {
  const tones = { brand: "bg-brand-50 text-brand-600", green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600" };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {Icon && <span className={cn("grid size-10 place-items-center rounded-xl", tones[tone])}><Icon className="size-5" /></span>}
      </div>
    </Card>
  );
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700", CONFIRMED: "bg-brand-50 text-brand-700", CHECKED_IN: "bg-violet-50 text-violet-700",
  IN_PROGRESS: "bg-cyan-50 text-cyan-700", IN_CONSULTATION: "bg-cyan-50 text-cyan-700", COMPLETED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-600", NO_SHOW: "bg-red-50 text-red-700", WAITING: "bg-amber-50 text-amber-700", CALLED: "bg-brand-50 text-brand-700",
  SKIPPED: "bg-slate-100 text-slate-600", ISSUED: "bg-amber-50 text-amber-700", PARTIALLY_PAID: "bg-amber-50 text-amber-700", PAID: "bg-emerald-50 text-emerald-700",
  VOID: "bg-slate-100 text-slate-600", CAPTURED: "bg-emerald-50 text-emerald-700", CREATED: "bg-slate-100 text-slate-600", FAILED: "bg-red-50 text-red-700",
  REFUNDED: "bg-violet-50 text-violet-700", PARTIALLY_REFUNDED: "bg-violet-50 text-violet-700", SENT: "bg-emerald-50 text-emerald-700", SKIPPED_N: "bg-slate-100",
  DRAFT: "bg-slate-100 text-slate-600", FINAL: "bg-emerald-50 text-emerald-700", APPROVED: "bg-emerald-50 text-emerald-700", REJECTED: "bg-red-50 text-red-700",
  NEW: "bg-brand-50 text-brand-700", READ: "bg-slate-100 text-slate-600", ARCHIVED: "bg-slate-100 text-slate-500", ACTIVE: "bg-emerald-50 text-emerald-700", INACTIVE: "bg-slate-100 text-slate-600",
};
export const StatusBadge = ({ status }: { status: string }) => (
  <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_TONE[status] ?? "bg-slate-100 text-slate-700")}>
    {status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
  </span>
);

export function SearchBox({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => onChange(v), 300); return () => clearTimeout(t); }, [v, onChange]);
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );
}

export interface Column<T> { key: string; label: string; render: (row: T) => ReactNode; className?: string }

export function DataTable<T extends { id: string }>({ columns, query, page, onPage, empty = "Nothing here yet.", onRowClick }: {
  columns: Column<T>[];
  query: { data?: Page<T>; isLoading: boolean; isError: boolean; refetch: () => void };
  page?: number;
  onPage?: (p: number) => void;
  empty?: string;
  onRowClick?: (row: T) => void;
}) {
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (query.isLoading || !query.data) return <Skeleton className="h-64" />;
  const { data, meta } = query.data;
  if (!data.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={cn("px-4 py-3 font-semibold", c.className)}>{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((row) => (
              <tr key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} className={cn("align-top", onRowClick && "cursor-pointer hover:bg-brand-50/40")}>
                {columns.map((c) => <td key={c.key} className={cn("px-4 py-3", c.className)}>{c.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && meta.pages > 1 && onPage && (
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
          <span>{meta.total} total · page {meta.page} of {meta.pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={(page ?? 1) <= 1} onClick={() => onPage((page ?? 1) - 1)} aria-label="Previous page"><ChevronLeft /></Button>
            <Button size="sm" variant="outline" disabled={(page ?? 1) >= meta.pages} onClick={() => onPage((page ?? 1) + 1)} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Modal({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-lift focus:outline-none", wide ? "max-w-3xl" : "max-w-lg")}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-full p-1.5 hover:bg-surface" aria-label="Close"><X className="size-5" /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A button that asks for confirmation (and optionally a reason) in a modal — never a browser confirm(). */
export function ConfirmAction({ label, title, description, confirmLabel = "Confirm", danger, withReason, onConfirm, size = "sm", variant = "outline" }: {
  label: ReactNode; title: string; description?: string; confirmLabel?: string; danger?: boolean; withReason?: string;
  onConfirm: (reason: string) => Promise<unknown>; size?: "sm" | "md"; variant?: "outline" | "ghost" | "danger" | "secondary" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        {withReason && (
          <label className="mb-5 block text-sm font-medium">{withReason}
            <Input className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Back</Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} disabled={!!withReason && reason.trim().length < 3}
            onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); setOpen(false); setReason(""); } catch { /* toast shown by caller */ } finally { setBusy(false); } }}>
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn("-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition", value === i.value ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink")}>
          {i.label}{i.count !== undefined && <span className="ml-1.5 rounded-full bg-surface px-1.5 text-xs">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}
