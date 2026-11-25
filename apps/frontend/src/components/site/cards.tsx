import * as Accordion from "@radix-ui/react-accordion";
import { ArrowRight, Award, ChevronDown, Clock, HeartHandshake, IndianRupee, Microscope, Quote, ShieldCheck, Sparkles, Star, Stethoscope, Users } from "lucide-react";
import { Link } from "react-router";
import type { Faq, PublicDoctor, PublicReview, PublicTreatment } from "@sdc/shared";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { formatDuration, formatINR, initials } from "@/utils/format";

export const ICONS = { shield: ShieldCheck, sparkles: Sparkles, microscope: Microscope, heart: HeartHandshake, award: Award, clock: Clock, users: Users, rupee: IndianRupee, stethoscope: Stethoscope } as const;
export const iconFor = (name: string) => ICONS[name as keyof typeof ICONS] ?? Sparkles;

export function TreatmentCard({ t }: { t: PublicTreatment }) {
  return (
    <Card className="group relative flex h-full flex-col overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lift">
      <div className="aspect-[16/10] overflow-hidden bg-brand-50">
        {t.imageUrl ? (
          <img src={t.imageUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="grid size-full place-items-center"><Sparkles className="size-10 text-brand-300" /></div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-lg font-semibold">{t.name}</h3>
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-muted">{t.summary}</p>
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-sm">
          <span className="text-muted"><Clock className="mr-1 inline size-4 align-[-3px]" />{formatDuration(t.durationMinutes)}</span>
          <span className="font-semibold text-ink">from {formatINR(t.pricePaise)}</span>
        </div>
        <Link to={`/treatments/${t.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 after:absolute after:inset-0">
          Learn more <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </Card>
  );
}

export function Avatar({ name, src, className = "size-full" }: { name: string; src: string | null; className?: string }) {
  return src ? (
    <img src={src} alt={name} loading="lazy" className={`${className} object-cover`} />
  ) : (
    <div className={`${className} grid place-items-center bg-gradient-to-br from-brand-100 to-brand-50 font-display text-3xl font-bold text-brand-600`} role="img" aria-label={name}>
      {initials(name)}
    </div>
  );
}

export function DoctorCard({ d }: { d: PublicDoctor }) {
  return (
    <Card className="group relative flex h-full flex-col overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lift">
      <div className="aspect-[4/4] overflow-hidden bg-brand-50"><Avatar name={d.fullName} src={d.photoUrl} /></div>
      <div className="flex flex-1 flex-col p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{d.specialization}</p>
        <h3 className="mt-1.5 text-lg font-semibold">
          <Link to={`/doctors/${d.slug}`} className="after:absolute after:inset-0">{d.fullName}</Link>
        </h3>
        <p className="mt-1 text-sm text-muted">{d.qualification}</p>
        <div className="mt-auto flex items-center justify-between pt-5 text-sm">
          <span className="text-muted">{d.experienceYears}+ yrs experience</span>
          {d.rating !== null && (
            <span className="inline-flex items-center gap-1 font-semibold"><Star className="size-4 fill-amber-400 text-amber-400" />{d.rating.toFixed(1)}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ReviewCard({ r }: { r: PublicReview }) {
  return (
    <Card className="flex h-full flex-col p-7">
      <Quote className="size-8 text-brand-200" aria-hidden />
      <div className="mt-4 flex gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
        {Array.from({ length: 5 }, (_, i) => <Star key={i} className={`size-4 ${i < r.rating ? "fill-amber-400 text-amber-400" : "text-line"}`} aria-hidden />)}
      </div>
      <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-ink/85">{r.comment}</blockquote>
      <figcaption className="mt-6 text-sm">
        <span className="font-semibold">{r.authorName}</span>
        {r.doctorName && <span className="text-muted"> · treated by {r.doctorName}</span>}
      </figcaption>
    </Card>
  );
}

export function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <Accordion.Root type="single" collapsible className="divide-y divide-line rounded-2xl border border-line bg-white">
      {faqs.map((f) => (
        <Accordion.Item key={f.id} value={f.id}>
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-medium hover:text-brand-700">
              {f.question}
              <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden px-6 pb-5 text-sm leading-relaxed text-muted">{f.answer}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}

export const CardGridSkeleton = ({ n = 3, tall }: { n?: number; tall?: boolean }) => (
  <>{Array.from({ length: n }, (_, i) => <Skeleton key={i} className={tall ? "h-96" : "h-80"} />)}</>
);
