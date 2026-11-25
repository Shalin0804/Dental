import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarCheck, CheckCircle2, Clock, Mail, MapPin, Phone, Star } from "lucide-react";
import { Link } from "react-router";
import { CardGridSkeleton, DoctorCard, FaqList, iconFor, ReviewCard, TreatmentCard } from "@/components/site/cards";
import { Reveal, SectionHeading } from "@/components/site/reveal";
import { Seo } from "@/components/site/seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useDoctors, useFaqs, useReviews, useSite, useTreatments } from "@/services/public";

function Hero() {
  const { data: site, isLoading } = useSite();
  const { data: reviews } = useReviews();
  const reduce = useReducedMotion();
  const avg = reviews?.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/70 to-white">
      <div className="container-page grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
        <div>
          {isLoading || !site ? (
            <div className="space-y-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-28 w-full" /><Skeleton className="h-16 w-4/5" /></div>
          ) : (
            <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
              <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-sm">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />{site.hero.eyebrow}
              </p>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-[3.6rem]">{site.hero.title}</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{site.hero.subtitle}</p>
            </motion.div>
          )}
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg"><Link to="/book"><CalendarCheck />Book an appointment</Link></Button>
            <Button asChild size="lg" variant="outline"><Link to="/treatments">Explore treatments<ArrowRight /></Link></Button>
          </div>
          {site && (
            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-8">
              {site.stats.slice(0, 3).map((s) => (
                <div key={s.label}><dt className="text-xs text-muted">{s.label}</dt><dd className="mt-1 font-display text-2xl font-bold text-ink">{s.value}</dd></div>
              ))}
            </dl>
          )}
        </div>

        <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
          <div className="aspect-[4/5] overflow-hidden rounded-3xl bg-brand-100 shadow-lift sm:aspect-square">
            {site?.hero.imageUrl && <img src={site.hero.imageUrl} alt="Dentist consulting a smiling patient" className="size-full object-cover" fetchPriority="high" />}
          </div>
          {avg !== null && reviews && (
            <motion.div initial={reduce ? false : { opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
              className="absolute -left-3 bottom-8 rounded-2xl bg-white p-4 shadow-lift sm:-left-8">
              <div className="flex items-center gap-1">{Array.from({ length: 5 }, (_, i) => <Star key={i} className="size-4 fill-amber-400 text-amber-400" aria-hidden />)}</div>
              <p className="mt-1.5 text-sm font-semibold">{avg.toFixed(1)} average rating</p>
              <p className="text-xs text-muted">from {reviews.length} patient reviews</p>
            </motion.div>
          )}
          {site?.hospital.openingHours[0] && (
            <motion.div initial={reduce ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 }}
              className="absolute -right-3 top-8 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-lift sm:-right-6">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><Clock className="size-5" /></span>
              <span><span className="block text-sm font-semibold">{site.hospital.openingHours[0].hours}</span><span className="block text-xs text-muted">{site.hospital.openingHours[0].days}</span></span>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}

function About() {
  const { data: site } = useSite();
  if (!site) return null;
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page grid items-center gap-14 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1">
          <div className="aspect-[5/4] overflow-hidden rounded-3xl bg-brand-50">
            {site.about.imageUrl && <img src={site.about.imageUrl} alt="Smile Dental Care treatment room" loading="lazy" className="size-full object-cover" />}
          </div>
        </Reveal>
        <div className="order-1 lg:order-2">
          <SectionHeading eyebrow="About Smile Dental Care" title={site.about.title} />
          <Reveal delay={0.1}>
            <p className="mt-5 whitespace-pre-line leading-relaxed text-muted">{site.about.body}</p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {site.about.highlights.map((h) => (
                <li key={h} className="flex gap-2.5 text-sm font-medium"><CheckCircle2 className="size-5 shrink-0 text-brand-600" aria-hidden />{h}</li>
              ))}
            </ul>
            <Button asChild variant="secondary" className="mt-8"><Link to="/about">More about us<ArrowRight /></Link></Button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function TreatmentsGrid({ limit }: { limit?: number }) {
  const { data, isLoading, isError, refetch } = useTreatments();
  if (isError) return <ErrorState message="We couldn't load treatments." onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"><CardGridSkeleton n={limit ?? 6} /></div>;
  if (!data.length) return <EmptyState>No treatments are listed right now.</EmptyState>;
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {data.slice(0, limit).map((t, i) => <Reveal key={t.id} delay={(i % 3) * 0.06}><TreatmentCard t={t} /></Reveal>)}
    </div>
  );
}

export function DoctorsGrid({ limit }: { limit?: number }) {
  const { data, isLoading, isError, refetch } = useDoctors();
  if (isError) return <ErrorState message="We couldn't load our doctors." onRetry={() => refetch()} />;
  if (isLoading || !data) return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"><CardGridSkeleton n={limit ?? 4} tall /></div>;
  if (!data.length) return <EmptyState>Doctor profiles will appear here soon.</EmptyState>;
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {data.slice(0, limit).map((d, i) => <Reveal key={d.id} delay={(i % 4) * 0.06}><DoctorCard d={d} /></Reveal>)}
    </div>
  );
}

export function WhyChooseUs() {
  const { data: site } = useSite();
  if (!site) return null;
  return (
    <section className="bg-surface py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow="Why choose us" title="Care that feels as good as it looks" center />
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {site.whyChooseUs.map((w, i) => {
            const Icon = iconFor(w.icon);
            return (
              <Reveal key={w.title} delay={i * 0.06}>
                <Card className="h-full p-7">
                  <span className="grid size-12 place-items-center rounded-2xl bg-brand-600 text-white"><Icon className="size-6" aria-hidden /></span>
                  <h3 className="mt-5 text-lg font-semibold">{w.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{w.body}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Process() {
  const { data: site } = useSite();
  if (!site) return null;
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow="How it works" title={`Your appointment in ${site.process.length} simple steps`} center />
        <ol className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {site.process.map((p, i) => (
            <li key={p.title}>
              <Reveal delay={i * 0.08}>
                <span className="font-display text-5xl font-extrabold text-brand-100" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 text-lg font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Testimonials() {
  const { data } = useReviews();
  if (!data?.length) return null;
  return (
    <section className="bg-surface py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow="Patient stories" title="Smiles we're proud of" center />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {data.slice(0, 3).map((r, i) => <Reveal key={r.id} delay={i * 0.06}><ReviewCard r={r} /></Reveal>)}
        </div>
      </div>
    </section>
  );
}

function HomeFaq() {
  const { data } = useFaqs();
  if (!data?.length) return null;
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SectionHeading eyebrow="FAQ" title="Questions patients often ask" subtitle="Can't find your answer? Call us and our front desk will help." />
          <Button asChild variant="secondary" className="mt-8"><Link to="/faq">View all FAQs<ArrowRight /></Link></Button>
        </div>
        <Reveal><FaqList faqs={data.slice(0, 5)} /></Reveal>
      </div>
    </section>
  );
}

export function ContactBlock() {
  const { data: site } = useSite();
  if (!site) return null;
  const h = site.hospital;
  return (
    <section className="pb-20 sm:pb-28">
      <div className="container-page">
        <div className="grid overflow-hidden rounded-3xl bg-brand-600 text-white lg:grid-cols-2">
          <div className="p-8 sm:p-12">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Visit {h.name}</h2>
            <p className="mt-3 text-brand-100">Walk in, call, or book online — we'll take it from there.</p>
            <ul className="mt-8 space-y-5 text-sm">
              <li className="flex gap-3"><MapPin className="size-5 shrink-0 text-brand-200" aria-hidden />{h.address}</li>
              <li className="flex gap-3"><Phone className="size-5 shrink-0 text-brand-200" aria-hidden /><a className="hover:underline" href={`tel:${h.phone}`}>{h.phone}</a></li>
              <li className="flex gap-3"><Mail className="size-5 shrink-0 text-brand-200" aria-hidden /><a className="hover:underline" href={`mailto:${h.email}`}>{h.email}</a></li>
              {h.openingHours.map((o) => <li key={o.days} className="flex gap-3"><Clock className="size-5 shrink-0 text-brand-200" aria-hidden /><span><b className="font-semibold">{o.days}:</b> {o.hours}</span></li>)}
            </ul>
            <Button asChild variant="white" size="lg" className="mt-9"><Link to="/book"><CalendarCheck />Book appointment</Link></Button>
          </div>
          <div className="min-h-72 bg-brand-700">
            {h.mapEmbedUrl && <iframe title={`${h.name} location map`} src={h.mapEmbedUrl} className="size-full min-h-72 border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { data: site } = useSite();
  const h = site?.hospital;
  return (
    <>
      <Seo title="Smile Dental Care — Your Smile, Our Priority." path="/"
        description="Multi-doctor dental hospital: implants, root canal, braces, whitening and family dentistry. Book appointments online."
        jsonLd={h && { "@context": "https://schema.org", "@type": "Dentist", name: h.name, slogan: h.tagline, telephone: h.phone, email: h.email, address: h.address, url: window.location.origin }} />
      <Hero />
      <About />
      <section className="bg-surface py-20 sm:py-28">
        <div className="container-page">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <SectionHeading eyebrow="Dental services" title="Complete care under one roof" subtitle="From routine check-ups to full smile makeovers — transparent prices, no surprises." />
            <Button asChild variant="outline" className="self-start sm:self-auto"><Link to="/treatments">All treatments<ArrowRight /></Link></Button>
          </div>
          <div className="mt-12"><TreatmentsGrid limit={6} /></div>
        </div>
      </section>
      <section className="py-20 sm:py-28">
        <div className="container-page">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <SectionHeading eyebrow="Meet our doctors" title="Specialists who listen first" />
            <Button asChild variant="outline" className="self-start sm:self-auto"><Link to="/doctors">All doctors<ArrowRight /></Link></Button>
          </div>
          <div className="mt-12"><DoctorsGrid limit={4} /></div>
        </div>
      </section>
      <WhyChooseUs />
      <Process />
      <Testimonials />
      <HomeFaq />
      <ContactBlock />
    </>
  );
}
