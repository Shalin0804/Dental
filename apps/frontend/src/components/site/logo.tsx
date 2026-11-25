import { Link } from "react-router";

export const ToothMark = ({ className = "size-9" }: { className?: string }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden>
    <rect width="32" height="32" rx="9" className="fill-brand-600" />
    <path d="M12 9c-2.2 0-3.5 1.9-3.3 4.3.2 2.6 1.2 4 1.9 6.6.5 2 1 4.1 2.1 4.1 1.3 0 1.4-2.9 2.1-4.6.4-1 .8-1.4 1.2-1.4s.8.4 1.2 1.4c.7 1.7.8 4.6 2.1 4.6 1.1 0 1.6-2.1 2.1-4.1.7-2.6 1.7-4 1.9-6.6C23.5 10.9 22.2 9 20 9c-1.6 0-2.4.9-4 .9S13.6 9 12 9z" fill="#fff" />
  </svg>
);

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Smile Dental Care home">
      <ToothMark />
      <span className="leading-none">
        <span className={`block font-display text-lg font-bold ${light ? "text-white" : "text-ink"}`}>Smile Dental Care</span>
        <span className={`block text-[11px] font-medium ${light ? "text-brand-200" : "text-muted"}`}>Your Smile, Our Priority.</span>
      </span>
    </Link>
  );
}
