import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/utils/cn";

const control =
  "w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink placeholder:text-muted/70 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-surface aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(control, "h-11", className)} {...p} />
);
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(control, "min-h-28 py-3", className)} {...p} />
);
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn(control, "h-11 pr-8", className)} {...p} />
);

/** Label + control + error message, wired with ids for a11y. Pass a render fn to get the id. */
export function Field({ label, error, hint, children, className }: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error || hint ? msgId : undefined })}
      {error ? <p id={msgId} role="alert" className="text-xs text-red-600">{error}</p>
        : hint ? <p id={msgId} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
