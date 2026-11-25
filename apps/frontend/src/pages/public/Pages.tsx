import { ArrowLeft, CalendarCheck, CheckCircle2, Clock, GraduationCap, IndianRupee, Languages, Star } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Avatar, DoctorCard, FaqList, ReviewCard } from "@/components/site/cards";
import { Reveal, SectionHeading } from "@/components/site/reveal";
import { Seo } from "@/components/site/seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { ApiRequestError } from "@/services/api";
import { useDoctor, useFaqs, useSite, useTreatment } from "@/services/public";
import { formatDuration, formatINR } from "@/utils/format";
import { ContactForm } from "./Forms";
import { ContactBlock, DoctorsGrid, TreatmentsGrid, WhyChooseUs } from "./Home";

export function PageHeader({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <section className="bg-gradient-to-b from-brand-50/80 to-white">
      <div className="container-page py-14 sm:py-20">
        <Reveal className="max-w-3xl">
          {eyebrow && <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p>}
          <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-5 text-lg leading-relaxed text-muted">{subtitle}</p>}
          {children}
        </Reveal>
      </div>
    </section>
  );
}

const DetailSkeleton = () => (
  <div className="container-page grid gap-10 py-16 lg:grid-cols-[1fr_2fr]"><Skeleton className="h-96" /><div className="space-y-4"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-40" /></div></div>
);

function NotFoundOr({ error, retry, what }: { error: unknown; retry: () => void; what: string }) {
  if (error instanceof ApiRequestError && error.status === 404) return <NotFound what={what} />;
  return <div className="container-page py-20"><ErrorState message={`We couldn't load this ${what}.`} onRetry={retry} /></div>;
}

export function NotFound({ what = "page" }: { what?: string }) {
  return (
    <div className="container-page flex flex-col items-center py-28 text-center">
      <Seo title="Not found" />
      <p className="font-display text-7xl font-extrabold text-brand-100">404</p>
      <h1 className="mt-4 text-2xl font-bold">We couldn't find that {what}</h1>
      <p className="mt-2 text-muted">It may have moved or no longer exists.</p>
      <Button asChild className="mt-8"><Link to="/">Back to home</Link></Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function AboutPage() {
  const { data: site, isError, refetch } = useSite();
  return (
    <>
      <Seo title="About us" path="/about" description="Learn about Smile Dental Care — our story, our doctors and our approach to comfortable, evidence-based dentistry." />
      <PageHeader eyebrow="About us" title={site?.about.title ?? "About Smile Dental Care"} subtitle={site?.hospital.tagline} />
      {isError && <div className="container-page"><ErrorState onRetry={() => refetch()} /></div>}
      {site && (
        <section className="py-16 sm:py-20">
          <div className="container-page grid items-start gap-14 lg:grid-cols-2">
            <Reveal>
              <p className="whitespace-pre-line text-lg leading-relaxed text-ink/80">{site.about.body}</p>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {site.about.highlights.map((h) => <li key={h} className="flex gap-2.5 text-sm font-medium"><CheckCircle2 className="size-5 shrink-0 text-brand-600" aria-hidden />{h}</li>)}
              </ul>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="aspect-[5/4] overflow-hidden rounded-3xl bg-brand-50">
                {site.about.imageUrl && <img src={site.about.imageUrl} alt="Inside Smile Dental Care" className="size-full object-cover" />}
              </div>
              <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {site.stats.map((s) => <Card key={s.label} className="p-4"><dt className="text-xs text-muted">{s.label}</dt><dd className="mt-1 font-display text-xl font-bold">{s.value}</dd></Card>)}
              </dl>
            </Reveal>
          </div>
        </section>
      )}
      <WhyChooseUs />
      <section className="py-20">
        <div className="container-page">
          <SectionHeading eyebrow="Our team" title="Meet the doctors" />
          <div className="mt-12"><DoctorsGrid /></div>
        </div>
      </section>
    </>
  );
}

export function DoctorsPage() {
  return (
    <>
      <Seo title="Our doctors" path="/doctors" description="Meet the dentists and specialists at Smile Dental Care — implantologists, endodontists, orthodontists and more." />
      <PageHeader eyebrow="Our doctors" title="Experienced specialists, gentle hands" subtitle="Every doctor at Smile Dental Care is registered with the Dental Council and focuses on a specialty so you get expert care." />
      <section className="container-page pb-24"><DoctorsGrid /></section>
    </>
  );
}

export function DoctorDetailPage() {
  const { slug = "" } = useParams();
  const { data: d, isLoading, error, refetch } = useDoctor(slug);
  if (isLoading) return <DetailSkeleton />;
  if (error || !d) return <NotFoundOr error={error} retry={() => refetch()} what="doctor" />;
  return (
    <>
      <Seo title={`${d.fullName} — ${d.specialization}`} path={`/doctors/${d.slug}`} description={d.bio ?? `${d.fullName}, ${d.qualification}, ${d.specialization} at Smile Dental Care.`}
        jsonLd={{ "@context": "https://schema.org", "@type": "Physician", name: d.fullName, medicalSpecialty: d.specialization, image: d.photoUrl ?? undefined }} />
      <div className="container-page py-10 sm:py-14">
        <Link to="/doctors" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700"><ArrowLeft className="size-4" />All doctors</Link>
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Reveal>
            <div className="aspect-square overflow-hidden rounded-3xl bg-brand-50"><Avatar name={d.fullName} src={d.photoUrl} /></div>
            <Card className="mt-6 space-y-4 p-6 text-sm">
              <p className="flex items-center gap-3"><GraduationCap className="size-5 text-brand-600" aria-hidden />{d.qualification}</p>
              <p className="flex items-center gap-3"><Clock className="size-5 text-brand-600" aria-hidden />{d.experienceYears}+ years of experience</p>
              <p className="flex items-center gap-3"><IndianRupee className="size-5 text-brand-600" aria-hidden />Consultation {formatINR(d.consultationFeePaise)}</p>
              {d.languages.length > 0 && <p className="flex items-center gap-3"><Languages className="size-5 text-brand-600" aria-hidden />{d.languages.join(", ")}</p>}
              <Button asChild className="w-full" size="lg"><Link to={`/book?doctor=${d.id}`}><CalendarCheck />Book with {d.fullName.split(" ").slice(0, 2).join(" ")}</Link></Button>
            </Card>
          </Reveal>
          <div>
            <Badge>{d.specialization}</Badge>
            <h1 className="mt-4 text-4xl font-extrabold">{d.fullName}</h1>
            {d.rating !== null && (
              <p className="mt-3 flex items-center gap-1.5 text-sm"><Star className="size-4 fill-amber-400 text-amber-400" aria-hidden /><b>{d.rating.toFixed(1)}</b><span className="text-muted">({d.reviewCount} reviews)</span></p>
            )}
            {d.bio && <p className="mt-6 whitespace-pre-line text-lg leading-relaxed text-ink/80">{d.bio}</p>}
            {d.treatments.length > 0 && (
              <>
                <h2 className="mt-10 text-xl font-bold">Treatments offered</h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {d.treatments.map((t) => <li key={t.id}><Link to={`/treatments/${t.slug}`} className="inline-block rounded-full border border-line px-4 py-2 text-sm hover:border-brand-300 hover:text-brand-700">{t.name}</Link></li>)}
                </ul>
              </>
            )}
            {d.reviews.length > 0 && (
              <>
                <h2 className="mt-12 text-xl font-bold">What patients say</h2>
                <div className="mt-5 grid gap-5 md:grid-cols-2">{d.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function TreatmentsPage() {
  return (
    <>
      <Seo title="Dental treatments" path="/treatments" description="Root canal, implants, braces, whitening, cleaning, crowns and more — see prices and durations for every treatment at Smile Dental Care." />
      <PageHeader eyebrow="Treatments" title="Dental treatments & pricing" subtitle="Transparent starting prices and typical durations. Your doctor confirms the final plan after examination." />
      <section className="container-page pb-24"><TreatmentsGrid /></section>
    </>
  );
}

export function TreatmentDetailPage() {
  const { slug = "" } = useParams();
  const { data: t, isLoading, error, refetch } = useTreatment(slug);
  if (isLoading) return <DetailSkeleton />;
  if (error || !t) return <NotFoundOr error={error} retry={() => refetch()} what="treatment" />;
  return (
    <>
      <Seo title={t.name} path={`/treatments/${t.slug}`} description={t.summary}
        jsonLd={{ "@context": "https://schema.org", "@type": "MedicalProcedure", name: t.name, description: t.summary }} />
      <PageHeader eyebrow="Treatment" title={t.name} subtitle={t.summary}>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Badge className="bg-white py-2 text-sm shadow-sm"><Clock className="size-4" />{formatDuration(t.durationMinutes)}</Badge>
          <Badge className="bg-white py-2 text-sm shadow-sm"><IndianRupee className="size-4" />from {formatINR(t.pricePaise)}</Badge>
          <Button asChild><Link to={`/book?treatment=${t.id}`}><CalendarCheck />Book this treatment</Link></Button>
        </div>
      </PageHeader>
      <div className="container-page grid gap-12 pb-24 lg:grid-cols-[1.6fr_1fr]">
        <div>
          {t.imageUrl && <img src={t.imageUrl} alt="" className="mb-10 aspect-[16/9] w-full rounded-3xl object-cover" />}
          <h2 className="text-2xl font-bold">About this treatment</h2>
          <p className="mt-4 whitespace-pre-line leading-relaxed text-ink/80">{t.description}</p>
          {t.doctors.length > 0 && (
            <>
              <h2 className="mt-14 text-2xl font-bold">Doctors who perform this treatment</h2>
              <div className="mt-6 grid gap-6 sm:grid-cols-2">{t.doctors.map((d) => <DoctorCard key={d.id} d={d} />)}</div>
            </>
          )}
        </div>
        <aside className="space-y-6">
          {t.preparation && <Card className="p-6"><h3 className="font-semibold">Before your visit</h3><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{t.preparation}</p></Card>}
          {t.aftercare && <Card className="p-6"><h3 className="font-semibold">Aftercare</h3><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{t.aftercare}</p></Card>}
        </aside>
      </div>
    </>
  );
}

export function FaqPage() {
  const { data, isLoading, isError, refetch } = useFaqs();
  return (
    <>
      <Seo title="Frequently asked questions" path="/faq" description="Answers to common questions about appointments, payments, treatments and care at Smile Dental Care."
        jsonLd={data && { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: data.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }} />
      <PageHeader eyebrow="FAQ" title="Frequently asked questions" />
      <section className="container-page max-w-3xl pb-24">
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading || !data ? <Skeleton className="h-96" /> : data.length ? <FaqList faqs={data} /> : <EmptyState>No FAQs yet.</EmptyState>}
      </section>
    </>
  );
}

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { data: site, isError, refetch } = useSite();
  const title = kind === "privacy" ? "Privacy policy" : "Terms & conditions";
  return (
    <>
      <Seo title={title} path={`/${kind}`} />
      <PageHeader title={title} />
      <article className="container-page max-w-3xl pb-24">
        {isError ? <ErrorState onRetry={() => refetch()} /> : !site ? <Skeleton className="h-96" /> : (
          <div className="whitespace-pre-line leading-relaxed text-ink/80">{site.legal[kind]}</div>
        )}
      </article>
    </>
  );
}

export function ContactPage() {
  return (
    <>
      <Seo title="Contact us" path="/contact" description="Call, email or visit Smile Dental Care. Send us a message and our team will get back to you." />
      <PageHeader eyebrow="Contact" title="We're here to help" subtitle="Questions about a treatment, costs or your appointment? Send a message and our front desk will respond within one working day." />
      <section className="container-page pb-16"><Card className="mx-auto max-w-3xl p-6 sm:p-10"><ContactForm /></Card></section>
      <ContactBlock />
    </>
  );
}
