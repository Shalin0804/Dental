import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck, Mail, MapPin, Menu, Phone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { Logo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { useSite, useTreatments } from "@/services/public";
import { useAuth } from "@/context/auth";
import { homePathFor } from "@/routes/paths";
import { cn } from "@/utils/cn";

const NAV = [
  { to: "/about", label: "About" },
  { to: "/treatments", label: "Treatments" },
  { to: "/doctors", label: "Doctors" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const { user } = useAuth();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => { document.body.style.overflow = open ? "hidden" : ""; }, [open]);

  const account = user ? { to: homePathFor(user.role), label: "My dashboard" } : { to: "/login", label: "Patient login" };

  return (
    <header className={cn("sticky top-0 z-40 bg-white/95 backdrop-blur transition-shadow", scrolled && "shadow-[0_1px_0_var(--color-line)]")}>
      <div className="container-page flex h-18 items-center justify-between gap-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) => cn("rounded-full px-4 py-2 text-sm font-medium transition-colors hover:text-brand-700", isActive ? "text-brand-700" : "text-ink/80")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild variant="ghost" size="sm"><Link to={account.to}>{account.label}</Link></Button>
          <Button asChild size="sm"><Link to="/book"><CalendarCheck />Book appointment</Link></Button>
        </div>
        <button className="-mr-2 rounded-full p-2 lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav id="mobile-nav" aria-label="Mobile"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}
            className="absolute inset-x-0 top-18 h-[calc(100dvh-4.5rem)] overflow-y-auto border-t border-line bg-white px-4 pb-8 pt-4 lg:hidden">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("block rounded-xl px-4 py-3.5 text-base font-medium", isActive ? "bg-brand-50 text-brand-700" : "text-ink")}>
                {n.label}
              </NavLink>
            ))}
            <div className="mt-6 grid gap-3">
              <Button asChild size="lg"><Link to="/book"><CalendarCheck />Book appointment</Link></Button>
              <Button asChild size="lg" variant="outline"><Link to={account.to}>{account.label}</Link></Button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function Footer() {
  const { data: site } = useSite();
  const { data: treatments } = useTreatments();
  const h = site?.hospital;
  return (
    <footer className="bg-brand-950 text-brand-100">
      <div className="container-page grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Logo light />
          <p className="max-w-xs text-sm leading-relaxed text-brand-200/80">
            Multi-specialty dental care with experienced doctors, modern equipment and transparent pricing.
          </p>
        </div>
        <div>
          <h3 className="mb-4 text-sm font-semibold text-white">Treatments</h3>
          <ul className="space-y-2.5 text-sm">
            {treatments?.slice(0, 6).map((t) => (
              <li key={t.id}><Link className="hover:text-white" to={`/treatments/${t.slug}`}>{t.name}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-4 text-sm font-semibold text-white">Hospital</h3>
          <ul className="space-y-2.5 text-sm">
            {[["/about", "About us"], ["/doctors", "Our doctors"], ["/book", "Book appointment"], ["/faq", "FAQ"], ["/privacy", "Privacy policy"], ["/terms", "Terms & conditions"]].map(([to, l]) => (
              <li key={to}><Link className="hover:text-white" to={to}>{l}</Link></li>
            ))}
          </ul>
        </div>
        {h && (
          <address className="space-y-3 text-sm not-italic">
            <h3 className="mb-4 text-sm font-semibold text-white">Visit us</h3>
            <p className="flex gap-2.5"><MapPin className="mt-0.5 size-4 shrink-0 text-brand-300" />{h.address}</p>
            <p className="flex gap-2.5"><Phone className="mt-0.5 size-4 shrink-0 text-brand-300" /><a href={`tel:${h.phone}`} className="hover:text-white">{h.phone}</a></p>
            <p className="flex gap-2.5"><Mail className="mt-0.5 size-4 shrink-0 text-brand-300" /><a href={`mailto:${h.email}`} className="hover:text-white">{h.email}</a></p>
          </address>
        )}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-6 text-xs text-brand-200/70 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} {h?.name ?? "Smile Dental Care"}. All rights reserved.</p>
          <p>{h?.tagline}</p>
        </div>
      </div>
    </footer>
  );
}

export default function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-lg bg-brand-600 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <Header />
      <main id="main" className="flex-1"><Outlet /></main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
