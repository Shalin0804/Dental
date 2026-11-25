import type { AppointmentStatus, QueueStatus } from "@sdc/shared";

export interface Appointment {
  id: string; reference: string; startAt: string; endAt: string; status: AppointmentStatus; source: string; paymentMethod: string; notes: string | null; cancelReason: string | null;
  patientId: string; doctorId: string; treatmentId: string;
  patient: { id: string; fullName: string; phone: string; email: string | null; patientCode: string };
  doctor: { id: string; slug: string; photoUrl: string | null; specialization: string; user: { fullName: string } };
  treatment: { id: string; name: string; slug: string; durationMinutes: number };
  queueToken: { id: string; tokenNumber: number; status: QueueStatus } | null;
  payments: { id: string; amountPaise: number; method: string; status: string }[];
}

export interface Patient {
  id: string; patientCode: string; fullName: string; phone: string; email: string | null; dateOfBirth: string | null; gender: string | null; address: string | null;
  bloodGroup: string | null; allergies: string[]; conditions: string[]; medicalHistory: string | null; emergencyContact: string | null; createdAt: string; _count?: { appointments: number };
}

export interface Treatment {
  id: string; slug: string; name: string; summary: string; description: string; imageUrl: string | null; pricePaise: number; durationMinutes: number;
  preparation: string | null; aftercare: string | null; isActive: boolean; sortOrder: number; _count?: { doctors: number; appointments: number };
}

export interface Range { id?: string; weekday: number; startMinute: number; endMinute: number; label?: string | null }
export interface Doctor {
  id: string; slug: string; photoUrl: string | null; qualification: string; specialization: string; experienceYears: number; registrationNumber: string | null; registrationCouncil: string | null;
  bio: string | null; languages: string[]; consultationFeePaise: number; bufferMinutes: number; isActive: boolean; isPublic: boolean; sortOrder: number;
  user: { id: string; email: string; fullName: string; phone: string | null; isActive: boolean };
  treatments: { treatmentId: string; durationOverride: number | null; priceOverridePaise: number | null; treatment: { id: string; name: string; durationMinutes: number; pricePaise: number } }[];
  schedules?: Range[]; breaks?: Range[];
  leaves?: { id: string; startDate: string; endDate: string; reason: string | null }[];
  specialHours?: { id: string; date: string; startMinute: number; endMinute: number; note: string | null }[];
}

export interface QueueToken {
  id: string; tokenNumber: number; status: QueueStatus; priority: number; checkedInAt: string; doctorId: string; patientId: string; estimatedWaitMinutes: number | null;
  patient: { id: string; fullName: string; patientCode: string; phone: string };
  doctor: { id: string; user: { fullName: string } };
  appointment: { id: string; reference: string; startAt: string; treatment: { name: string } } | null;
}

export interface RxItem { medicine: string; dosage: string; frequency: string; duration: string; instructions?: string | null }
export interface Prescription {
  id: string; number: string; status: "DRAFT" | "FINAL"; version: number; diagnosis: string; notes: string | null; followUpDate: string | null; createdAt: string; finalizedAt: string | null;
  patientId: string; doctorId: string; items: RxItem[];
  patient: { id: string; fullName: string; patientCode: string; allergies: string[] };
  doctor: { id: string; user: { fullName: string } };
  revisions: { version: number; reason: string; createdAt: string }[];
}

export interface MedicalRecord {
  id: string; patientId: string; chiefComplaint: string | null; diagnosis: string | null; clinicalNotes: string | null; treatmentDone: string | null; followUpDate: string | null; createdAt: string;
  doctor: { id: string; user: { fullName: string } };
  examination: { teeth: Record<string, { condition: string; note?: string }>; oralHygiene: string | null; gums: string | null; occlusion: string | null; notes: string | null } | null;
  files: UploadedFile[];
  appointment: { reference: string; treatment: { name: string } } | null;
}
export interface UploadedFile { id: string; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }

export interface InvoiceRow { id: string; number: string; status: string; totalPaise: number; paidPaise: number; refundedPaise: number; issuedAt: string; patient: { fullName: string; patientCode: string } }
export interface Invoice extends Omit<InvoiceRow, "patient"> {
  subtotalPaise: number; discountPaise: number; taxPaise: number; notes: string | null; patientId: string;
  patient: { id: string; fullName: string; patientCode: string; phone: string };
  items: { id: string; description: string; quantity: number; unitPricePaise: number; amountPaise: number }[];
  payments: (Payment & { refunds: { id: string; amountPaise: number; status: string; reason: string }[] })[];
  appointment: { reference: string } | null;
}
export interface Payment {
  id: string; amountPaise: number; method: string; status: string; paidAt: string | null; createdAt: string; reference: string | null; razorpayPaymentId: string | null;
  patient?: { fullName: string; patientCode: string }; invoice?: { id: string; number: string } | null; appointment?: { reference: string } | null;
  refunds?: { id: string; amountPaise: number; status: string }[];
}

export interface StaffUser { id: string; email: string; fullName: string; phone: string | null; isActive: boolean; lastLoginAt: string | null; role: { name: string }; staff: { designation: string } | null; doctor: { id: string } | null }
