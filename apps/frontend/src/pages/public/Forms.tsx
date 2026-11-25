import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { contactSchema, loginSchema, registerSchema, type ContactInput, type LoginInput, type RegisterInput } from "@sdc/shared";
import { Logo } from "@/components/site/logo";
import { Seo } from "@/components/site/seo";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAuth } from "@/context/auth";
import { api, errorMessage } from "@/services/api";
import { homePathFor } from "@/routes/paths";

const FormError = ({ msg }: { msg: string | null }) =>
  msg ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</p> : null;

export function ContactForm() {
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ContactInput>({ resolver: zodResolver(contactSchema) });

  const onSubmit = handleSubmit(async (body) => {
    setErr(null);
    try {
      await api("/public/contact", { method: "POST", body });
      setSent(true);
      reset();
    } catch (e) { setErr(errorMessage(e)); }
  });

  if (sent) return (
    <div className="flex flex-col items-center py-8 text-center">
      <CheckCircle2 className="size-12 text-emerald-500" aria-hidden />
      <h2 className="mt-4 text-xl font-bold">Message received</h2>
      <p className="mt-2 text-muted">Thank you — our team will get back to you shortly.</p>
      <Button variant="outline" className="mt-6" onClick={() => setSent(false)}>Send another message</Button>
    </div>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
      <Field label="Full name" error={errors.name?.message}>{(a) => <Input {...a} autoComplete="name" {...register("name")} />}</Field>
      <Field label="Email" error={errors.email?.message}>{(a) => <Input {...a} type="email" autoComplete="email" {...register("email")} />}</Field>
      <Field label="Phone (optional)" error={errors.phone?.message}>{(a) => <Input {...a} type="tel" autoComplete="tel" {...register("phone")} />}</Field>
      <Field label="Subject" error={errors.subject?.message}>{(a) => <Input {...a} {...register("subject")} />}</Field>
      <Field label="Message" error={errors.message?.message} className="sm:col-span-2">{(a) => <Textarea {...a} rows={5} {...register("message")} />}</Field>
      <div className="sm:col-span-2"><FormError msg={err} /></div>
      <Button type="submit" size="lg" loading={isSubmitting} className="sm:col-span-2 sm:justify-self-start">Send message</Button>
    </form>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-4.5rem)] lg:grid-cols-2">
      <div className="hidden bg-brand-600 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo light />
        <div>
          <h2 className="text-4xl font-bold leading-tight text-white">Your dental care,<br />all in one place.</h2>
          <ul className="mt-8 space-y-3 text-brand-100">
            {["Book and reschedule appointments", "Download prescriptions and invoices", "See your treatment history"].map((t) => (
              <li key={t} className="flex gap-2.5"><CheckCircle2 className="size-5 text-brand-200" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-brand-200">Your records are encrypted and only visible to you and your care team.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const onSubmit = handleSubmit(async (body) => {
    setErr(null);
    try {
      const u = await login(body);
      nav(from ?? homePathFor(u.role), { replace: true });
    } catch (e) { setErr(errorMessage(e)); }
  });

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your appointments.">
      <Seo title="Login" path="/login" />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <Field label="Email" error={errors.email?.message}>{(a) => <Input {...a} type="email" autoComplete="email" {...register("email")} />}</Field>
        <Field label="Password" error={errors.password?.message}>{(a) => <Input {...a} type="password" autoComplete="current-password" {...register("password")} />}</Field>
        <FormError msg={err} />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">New patient? <Link to="/register" className="font-semibold text-brand-700 hover:underline">Create an account</Link></p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register: signUp, user } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const onSubmit = handleSubmit(async (body) => {
    setErr(null);
    try {
      await signUp(body);
      nav("/patient", { replace: true });
    } catch (e) { setErr(errorMessage(e)); }
  });

  return (
    <AuthShell title="Create your account" subtitle="Register once to book faster and access your records.">
      <Seo title="Register" path="/register" />
      <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName?.message} className="sm:col-span-2">{(a) => <Input {...a} autoComplete="name" {...register("fullName")} />}</Field>
        <Field label="Email" error={errors.email?.message}>{(a) => <Input {...a} type="email" autoComplete="email" {...register("email")} />}</Field>
        <Field label="Mobile number" error={errors.phone?.message}>{(a) => <Input {...a} type="tel" autoComplete="tel" placeholder="98765 43210" {...register("phone")} />}</Field>
        <Field label="Date of birth" error={errors.dateOfBirth?.message}>{(a) => <Input {...a} type="date" max={new Date().toISOString().slice(0, 10)} {...register("dateOfBirth")} />}</Field>
        <Field label="Gender" error={errors.gender?.message}>
          {(a) => (
            <Select {...a} defaultValue="" {...register("gender", { setValueAs: (v) => v || undefined })}>
              <option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
            </Select>
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} hint="At least 8 characters with a letter and a number" className="sm:col-span-2">
          {(a) => <Input {...a} type="password" autoComplete="new-password" {...register("password")} />}
        </Field>
        <div className="sm:col-span-2">
          <label className="flex gap-3 text-sm text-muted">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" {...register("consent")} />
            <span>I consent to Smile Dental Care processing my personal and health data to provide care, as described in the <Link to="/privacy" className="text-brand-700 underline">privacy policy</Link>.</span>
          </label>
          {errors.consent && <p role="alert" className="mt-1.5 text-xs text-red-600">{errors.consent.message}</p>}
        </div>
        <div className="sm:col-span-2"><FormError msg={err} /></div>
        <Button type="submit" size="lg" className="w-full sm:col-span-2" loading={isSubmitting}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Already registered? <Link to="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link></p>
    </AuthShell>
  );
}
