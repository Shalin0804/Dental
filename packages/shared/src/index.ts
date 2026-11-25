import { z } from "zod";

export const ROLES = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT"] as const;
export type RoleName = (typeof ROLES)[number];

export const APPOINTMENT_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const QUEUE_STATUSES = ["WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "SKIPPED", "CANCELLED"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** Indian mobile: optional +91, 10 digits starting 6-9. */
export const phoneSchema = z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number");
export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/\d/, "Include a number");

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Password is required") });
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(100),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  dateOfBirth: z.string().date().optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  consent: z.literal(true, { message: "Consent is required to create an account" }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: emailSchema,
  phone: phoneSchema.optional().or(z.literal("")),
  subject: z.string().trim().min(3, "Add a subject").max(150),
  message: z.string().trim().min(10, "Message should be at least 10 characters").max(2000),
});
export type ContactInput = z.infer<typeof contactSchema>;

/* ---------- Public API DTOs ---------- */

export interface PublicTreatment {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  imageUrl: string | null;
  pricePaise: number;
  durationMinutes: number;
  preparation: string | null;
  aftercare: string | null;
}

export interface PublicDoctor {
  id: string;
  slug: string;
  fullName: string;
  photoUrl: string | null;
  qualification: string;
  specialization: string;
  experienceYears: number;
  bio: string | null;
  consultationFeePaise: number;
  languages: string[];
  treatments: { id: string; slug: string; name: string }[];
  rating: number | null;
  reviewCount: number;
}

export interface PublicReview {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  doctorName: string | null;
  createdAt: string;
}

export interface Faq { id: string; question: string; answer: string; }

export interface SiteContent {
  hospital: {
    name: string;
    tagline: string;
    phone: string;
    whatsapp: string | null;
    email: string;
    address: string;
    city: string;
    mapEmbedUrl: string | null;
    openingHours: { days: string; hours: string }[];
    timezone: string;
  };
  hero: { eyebrow: string; title: string; subtitle: string; imageUrl: string | null };
  about: { title: string; body: string; imageUrl: string | null; highlights: string[] };
  stats: { label: string; value: string }[];
  whyChooseUs: { title: string; body: string; icon: string }[];
  process: { title: string; body: string }[];
  legal: { privacy: string; terms: string };
}

export interface ApiError { error: { code: string; message: string; details?: unknown } }

/* ---------- Booking ---------- */

export const patientDetailsSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the patient's full name").max(100),
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal("")),
  dateOfBirth: z.string().date().optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
});
export type PatientDetails = z.infer<typeof patientDetailsSchema>;

export const PAYMENT_CHOICES = ["PAY_AT_HOSPITAL", "RAZORPAY"] as const;

export const bookingSchema = z.object({
  treatmentId: z.string().min(1, "Select a treatment"),
  doctorId: z.string().min(1, "Select a doctor"),
  startAt: z.string().datetime({ message: "Select a time slot" }),
  paymentMethod: z.enum(PAYMENT_CHOICES).default("PAY_AT_HOSPITAL"),
  notes: z.string().trim().max(500).optional(),
  patient: patientDetailsSchema.optional(),
  consent: z.boolean().optional(),
  // Staff-only fields (ignored for patients/guests)
  patientId: z.string().optional(),
  source: z.enum(["ONLINE", "PHONE", "WALK_IN"]).optional(),
  durationOverride: z.coerce.number().int().min(5).max(480).optional(),
});
export type BookingInput = z.infer<typeof bookingSchema>;

export interface Slot { startAt: string }
export interface AvailabilityResponse { duration: number; slots: string[]; reason: string | null; timezone: string }

export interface BookingResult {
  id: string;
  reference: string;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  payment: null | { orderId: string; amountPaise: number; keyId: string; currency: "INR"; name: string; email: string | null; phone: string };
}
