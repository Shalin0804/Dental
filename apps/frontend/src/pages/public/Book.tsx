import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, CalendarCheck, Check, CheckCircle2, Clock, CreditCard, Stethoscope, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";
import { patientDetailsSchema, type AvailabilityResponse, type BookingResult, type PatientDetails, type PublicDoctor } from "@sdc/shared";
import { Avatar } from "@/components/site/cards";
import { Seo } from "@/components/site/seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/context/auth";
import { api, errorMessage } from "@/services/api";
import { useDoctors, useTreatments } from "@/services/public";
import { payWithRazorpay } from "@/services/razorpay";
import { cn } from "@/utils/cn";
import { formatDuration, formatINR } from "@/utils/format";
import { dayParts, fmtDateTime, fmtTime, todayLocal } from "@/utils/time";

const STEPS = [
  { key: "treatment", label: "Treatment", icon: Stethoscope },
  { key: "doctor", label: "Doctor", icon: User },
  { key: "time", label: "Date & time", icon: CalendarCheck },
  { key: "details", label: "Your details", icon: User },
  { key: "confirm", label: "Confirm", icon: CreditCard },
] as const;

type Day = { date: string; count: number };

export default function BookPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const treatments = useTreatments();
  const doctors = useDoctors();

  const [step, setStep] = useState(0);
  const [treatmentId, setTreatmentId] = useState(params.get("treatment") ?? "");
  const [doctorId, setDoctorId] = useState(params.get("doctor") ?? "");
  const [date, setDate] = useState("");
  const [startAt, setStartAt] = useState("");
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<"PAY_AT_HOSPITAL" | "RAZORPAY">("PAY_AT_HOSPITAL");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<(BookingResult & { paid?: boolean }) | null>(null);

  const treatment = treatments.data?.find((t) => t.id === treatmentId);
  const doctor = doctors.data?.find((d) => d.id === doctorId);
  const eligibleDoctors = useMemo(() => (doctors.data ?? []).filter((d) => d.treatments.some((t) => t.id === treatmentId)), [doctors.data, treatmentId]);

  // Deep links: ?treatment=… skips to doctor; ?doctor=… pre-selects.
  useEffect(() => {
    if (!treatments.data || !doctors.data) return;
    if (treatmentId && doctorId && eligibleDoctors.some((d) => d.id === doctorId)) setStep(2);
    else if (treatmentId) setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatments.data, doctors.data]);

  const days = useQuery({
    queryKey: ["availability-days", doctorId, treatmentId],
    queryFn: () => api<{ data: Day[] }>("/availability/days", { query: { doctorId, treatmentId, from: todayLocal(), days: 14 } }).then((r) => r.data),
    enabled: step >= 2 && !!doctorId && !!treatmentId,
  });
  useEffect(() => { if (!date && days.data) setDate(days.data.find((d) => d.count > 0)?.date ?? days.data[0]?.date ?? ""); }, [days.data, date]);

  const slots = useQuery({
    queryKey: ["availability", doctorId, treatmentId, date],
    queryFn: () => api<{ data: AvailabilityResponse }>("/availability", { query: { doctorId, treatmentId, date } }).then((r) => r.data),
    enabled: step >= 2 && !!date,
    refetchInterval: 60_000,
  });

  const book = useMutation({
    mutationFn: async () => {
      const r = await api<{ data: BookingResult }>("/appointments", {
        method: "POST",
        body: { treatmentId, doctorId, startAt, paymentMethod: payment, notes: notes || undefined, patient: user ? undefined : details, consent: user ? undefined : consent },
      });
      if (r.data.payment) {
        const outcome = await payWithRazorpay(r.data.payment, `${treatment?.name} — ${r.data.reference}`);
        return { ...r.data, paid: outcome === "paid" };
      }
      return r.data;
    },
    onSuccess: setResult,
    onError: () => { slots.refetch(); },
  });

  const pick = (fn: () => void, next: number) => { fn(); setStep(next); };

  if (result) return <BookingDone result={result} doctor={doctor} treatmentName={treatment?.name ?? ""} />;

  return (
    <>
      <Seo title="Book an appointment" path="/book" description="Book a dental appointment online at Smile Dental Care — choose your treatment, doctor and a time that suits you." />
      <section className="bg-gradient-to-b from-brand-50/80 to-white">
        <div className="container-page pb-6 pt-12 sm:pt-16">
          <h1 className="text-3xl font-extrabold sm:text-4xl">Book an appointment</h1>
          <p className="mt-3 text-muted">Real-time availability. Takes under a minute.</p>
          <ol className="mt-8 flex gap-2 overflow-x-auto pb-2" aria-label="Booking progress">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex shrink-0 items-center gap-2">
                <button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                  className={cn("flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition",
                    i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-100 text-brand-800 hover:bg-brand-200" : "bg-white text-muted ring-1 ring-line")}>
                  <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-bold", i === step ? "bg-white/20" : i < step ? "bg-brand-600 text-white" : "bg-surface")}>
                    {i < step ? <Check className="size-3" /> : i + 1}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <span className="h-px w-4 bg-line" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="container-page grid gap-8 pb-24 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {step === 0 && (
                <StepShell title="What do you need help with?">
                  {treatments.isError ? <ErrorState onRetry={() => treatments.refetch()} /> : !treatments.data ? <Skeleton className="h-64" /> : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {treatments.data.map((t) => (
                        <Choice key={t.id} selected={t.id === treatmentId} onClick={() => pick(() => { setTreatmentId(t.id); if (!doctors.data?.find((d) => d.id === doctorId)?.treatments.some((x) => x.id === t.id)) setDoctorId(""); setDate(""); setStartAt(""); }, 1)}>
                          <span className="font-semibold">{t.name}</span>
                          <span className="mt-1 flex gap-3 text-sm text-muted"><span><Clock className="mr-1 inline size-3.5 align-[-2px]" />{formatDuration(t.durationMinutes)}</span><span>from {formatINR(t.pricePaise)}</span></span>
                        </Choice>
                      ))}
                    </div>
                  )}
                </StepShell>
              )}

              {step === 1 && (
                <StepShell title="Choose your doctor" back={() => setStep(0)}>
                  {doctors.isError ? <ErrorState onRetry={() => doctors.refetch()} /> : !doctors.data ? <Skeleton className="h-64" /> : !eligibleDoctors.length ? (
                    <EmptyState>No doctor currently offers this treatment online. Please call us to book.</EmptyState>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {eligibleDoctors.map((d) => (
                        <Choice key={d.id} selected={d.id === doctorId} onClick={() => pick(() => { setDoctorId(d.id); setDate(""); setStartAt(""); }, 2)}>
                          <span className="flex items-center gap-4">
                            <span className="size-14 shrink-0 overflow-hidden rounded-2xl"><Avatar name={d.fullName} src={d.photoUrl} /></span>
                            <span>
                              <span className="block font-semibold">{d.fullName}</span>
                              <span className="block text-sm text-muted">{d.specialization} · {d.experienceYears}+ yrs</span>
                              <span className="block text-sm text-muted">Consultation {formatINR(d.consultationFeePaise)}</span>
                            </span>
                          </span>
                        </Choice>
                      ))}
                    </div>
                  )}
                </StepShell>
              )}

              {step === 2 && (
                <StepShell title="Pick a date and time" back={() => setStep(1)}>
                  {days.isError ? <ErrorState onRetry={() => days.refetch()} /> : !days.data ? <Skeleton className="h-24" /> : (
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Available dates">
                      {days.data.map((d) => {
                        const p = dayParts(d.date);
                        const sel = d.date === date;
                        return (
                          <button key={d.date} type="button" role="option" aria-selected={sel} disabled={d.count === 0} onClick={() => { setDate(d.date); setStartAt(""); }}
                            className={cn("flex w-18 shrink-0 flex-col items-center rounded-2xl border px-2 py-3 transition disabled:cursor-not-allowed disabled:opacity-40",
                              sel ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:border-brand-300")}>
                            <span className={cn("text-xs", sel ? "text-brand-100" : "text-muted")}>{p.weekday}</span>
                            <span className="font-display text-xl font-bold">{p.day}</span>
                            <span className={cn("text-[11px]", sel ? "text-brand-100" : "text-muted")}>{d.count ? `${d.count} slots` : "Full"}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-6">
                    {slots.isError ? <ErrorState onRetry={() => slots.refetch()} /> : slots.isLoading || !slots.data ? (date ? <Skeleton className="h-40" /> : null) : !slots.data.slots.length ? (
                      <EmptyState>{slots.data.reason ?? "No free slots on this day."} Try another date.</EmptyState>
                    ) : (
                      <SlotGrid slots={slots.data.slots} tz={slots.data.timezone} value={startAt} onChange={setStartAt} />
                    )}
                  </div>
                  <div className="mt-8 flex justify-end">
                    <Button size="lg" disabled={!startAt} onClick={() => setStep(3)}>Continue<ArrowRight /></Button>
                  </div>
                </StepShell>
              )}

              {step === 3 && (
                <StepShell title={user ? "Anything we should know?" : "Patient details"} back={() => setStep(2)}>
                  {user ? (
                    <div className="space-y-5">
                      <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">Booking as <b>{user.fullName}</b> ({user.email}).</p>
                      <Field label="Notes for the doctor (optional)">{(a) => <Textarea {...a} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. pain in lower left tooth since 3 days" />}</Field>
                      <div className="flex justify-end"><Button size="lg" onClick={() => setStep(4)}>Continue<ArrowRight /></Button></div>
                    </div>
                  ) : (
                    <DetailsForm initial={details} notes={notes} onNotes={setNotes} onSubmit={(d) => { setDetails(d); setStep(4); }} />
                  )}
                </StepShell>
              )}

              {step === 4 && treatment && doctor && (
                <StepShell title="Review and confirm" back={() => setStep(3)}>
                  <fieldset>
                    <legend className="mb-3 text-sm font-semibold">Payment</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Choice selected={payment === "PAY_AT_HOSPITAL"} onClick={() => setPayment("PAY_AT_HOSPITAL")}>
                        <span className="flex items-center gap-2 font-semibold"><Building2 className="size-4 text-brand-600" />Pay at hospital</span>
                        <span className="mt-1 text-sm text-muted">Cash, card or UPI at the front desk.</span>
                      </Choice>
                      <Choice selected={payment === "RAZORPAY"} onClick={() => setPayment("RAZORPAY")}>
                        <span className="flex items-center gap-2 font-semibold"><CreditCard className="size-4 text-brand-600" />Pay online now</span>
                        <span className="mt-1 text-sm text-muted">Consultation fee {formatINR(doctor.consultationFeePaise)} via Razorpay. Instant confirmation.</span>
                      </Choice>
                    </div>
                  </fieldset>
                  {!user && (
                    <label className="mt-6 flex gap-3 text-sm text-muted">
                      <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      <span>I consent to Smile Dental Care using these details to manage my appointment and contact me by SMS, WhatsApp and email, as described in the <Link to="/privacy" className="text-brand-700 underline">privacy policy</Link>.</span>
                    </label>
                  )}
                  {book.isError && <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage(book.error)}{/slot/i.test(errorMessage(book.error)) && <> <button className="font-semibold underline" onClick={() => { setStartAt(""); setStep(2); }}>Pick another time</button></>}</p>}
                  <div className="mt-8 flex justify-end">
                    <Button size="lg" loading={book.isPending} disabled={!user && !consent} onClick={() => book.mutate()}>
                      <CalendarCheck />{payment === "RAZORPAY" ? "Confirm & pay" : "Confirm booking"}
                    </Button>
                  </div>
                </StepShell>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <h2 className="text-base font-semibold">Your appointment</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <Summary label="Treatment" value={treatment ? `${treatment.name} · ${formatDuration(slots.data?.duration ?? treatment.durationMinutes)}` : null} />
              <Summary label="Doctor" value={doctor?.fullName} />
              <Summary label="When" value={startAt ? fmtDateTime(startAt, slots.data?.timezone) : null} />
              <Summary label="Patient" value={user?.fullName ?? details?.fullName} />
              {treatment && <Summary label="Estimated treatment cost" value={`from ${formatINR(treatment.pricePaise)}`} />}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

function StepShell({ title, back, children }: { title: string; back?: () => void; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-6 flex items-center gap-3">
        {back && <Button variant="ghost" size="icon" onClick={back} aria-label="Back"><ArrowLeft /></Button>}
        <h2 className="text-xl font-bold sm:text-2xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn("relative flex flex-col items-start rounded-2xl border bg-white p-5 text-left transition hover:border-brand-300 hover:shadow-card",
        selected ? "border-brand-600 ring-4 ring-brand-100" : "border-line")}>
      {selected && <CheckCircle2 className="absolute right-4 top-4 size-5 text-brand-600" aria-hidden />}
      {children}
    </button>
  );
}

const Summary = ({ label, value }: { label: string; value?: string | null }) => (
  <div><dt className="text-muted">{label}</dt><dd className={cn("mt-0.5 font-medium", !value && "text-muted/60")}>{value ?? "—"}</dd></div>
);

export function SlotGrid({ slots, tz, value, onChange }: { slots: string[]; tz: string; value: string; onChange: (s: string) => void }) {
  const hour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  const groups = [
    { label: "Morning", items: slots.filter((s) => hour(s) < 12) },
    { label: "Afternoon", items: slots.filter((s) => hour(s) >= 12 && hour(s) < 17) },
    { label: "Evening", items: slots.filter((s) => hour(s) >= 17) },
  ].filter((g) => g.items.length);
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className="mb-3 text-sm font-semibold text-muted">{g.label}</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6" role="radiogroup" aria-label={`${g.label} slots`}>
            {g.items.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={s === value} onClick={() => onChange(s)}
                className={cn("rounded-xl border px-2 py-2.5 text-sm font-medium transition", s === value ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:border-brand-400 hover:text-brand-700")}>
                {fmtTime(s, tz)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailsForm({ initial, notes, onNotes, onSubmit }: { initial: PatientDetails | null; notes: string; onNotes: (s: string) => void; onSubmit: (d: PatientDetails) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<PatientDetails>({ resolver: zodResolver(patientDetailsSchema), defaultValues: initial ?? undefined });
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-5 sm:grid-cols-2">
      <p className="text-sm text-muted sm:col-span-2">Have an account? <Link to="/login" state={{ from: "/book" }} className="font-semibold text-brand-700 hover:underline">Sign in</Link> to book faster.</p>
      <Field label="Full name" error={errors.fullName?.message} className="sm:col-span-2">{(a) => <Input {...a} autoComplete="name" {...register("fullName")} />}</Field>
      <Field label="Mobile number" error={errors.phone?.message}>{(a) => <Input {...a} type="tel" autoComplete="tel" placeholder="98765 43210" {...register("phone")} />}</Field>
      <Field label="Email (optional)" error={errors.email?.message}>{(a) => <Input {...a} type="email" autoComplete="email" {...register("email")} />}</Field>
      <Field label="Date of birth (optional)" error={errors.dateOfBirth?.message}>{(a) => <Input {...a} type="date" max={todayLocal()} {...register("dateOfBirth")} />}</Field>
      <Field label="Gender (optional)" error={errors.gender?.message}>
        {(a) => <Select {...a} defaultValue="" {...register("gender", { setValueAs: (v) => v || undefined })}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select>}
      </Field>
      <Field label="Notes for the doctor (optional)" className="sm:col-span-2">{(a) => <Textarea {...a} value={notes} onChange={(e) => onNotes(e.target.value)} maxLength={500} />}</Field>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" size="lg">Continue<ArrowRight /></Button></div>
    </form>
  );
}

function BookingDone({ result, doctor, treatmentName }: { result: BookingResult & { paid?: boolean }; doctor?: PublicDoctor; treatmentName: string }) {
  const { user } = useAuth();
  const unpaid = result.payment && !result.paid;
  return (
    <div className="container-page flex justify-center py-16 sm:py-24">
      <Seo title="Booking received" />
      <Card className="w-full max-w-xl p-8 text-center sm:p-12">
        <span className={cn("mx-auto grid size-16 place-items-center rounded-full", unpaid ? "bg-amber-50 text-amber-500" : "bg-emerald-50 text-emerald-500")}><CheckCircle2 className="size-9" /></span>
        <h1 className="mt-6 text-2xl font-bold sm:text-3xl">{unpaid ? "Slot reserved — payment pending" : result.paid ? "Appointment confirmed" : "Booking received"}</h1>
        <p className="mt-3 text-muted">
          {unpaid ? "Your payment was not completed. The slot is held for 15 minutes; you can also pay at the hospital — just call us." :
            result.paid ? "Payment verified. We've sent the details to your phone and email." :
            "We've sent the details to your phone. Our front desk will confirm your appointment shortly."}
        </p>
        <dl className="mt-8 grid gap-4 rounded-2xl bg-surface p-6 text-left text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Reference</dt><dd className="mt-0.5 font-display text-lg font-bold tracking-wide text-brand-700">{result.reference}</dd></div>
          <div><dt className="text-muted">When</dt><dd className="mt-0.5 font-medium">{fmtDateTime(result.startAt)}</dd></div>
          <div><dt className="text-muted">Doctor</dt><dd className="mt-0.5 font-medium">{doctor?.fullName}</dd></div>
          <div><dt className="text-muted">Treatment</dt><dd className="mt-0.5 font-medium">{treatmentName}</dd></div>
        </dl>
        <p className="mt-6 text-xs text-muted">Please arrive 10 minutes early and bring any previous dental records.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {user ? <Button asChild><Link to="/patient/appointments">View my appointments</Link></Button> : <Button asChild><Link to="/register">Create an account</Link></Button>}
          <Button asChild variant="outline"><Link to="/">Back to home</Link></Button>
        </div>
      </Card>
    </div>
  );
}
