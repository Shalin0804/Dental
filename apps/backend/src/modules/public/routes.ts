import { Router } from "express";
import rateLimit from "express-rate-limit";
import { contactSchema, type PublicDoctor, type PublicReview, type PublicTreatment, type SiteContent } from "@sdc/shared";
import { prisma, type Prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { enqueue } from "../../services/notify.js";
import { notFound, parse } from "../../utils/http.js";

export const publicRouter = Router();

const treatmentSelect = { id: true, slug: true, name: true, summary: true, description: true, imageUrl: true, pricePaise: true, durationMinutes: true, preparation: true, aftercare: true } satisfies Prisma.TreatmentSelect;
const liveTreatment = { isActive: true, deletedAt: null } satisfies Prisma.TreatmentWhereInput;
const liveDoctor = { isActive: true, isPublic: true, deletedAt: null, user: { isActive: true } } satisfies Prisma.DoctorWhereInput;

const doctorInclude = {
  user: { select: { fullName: true } },
  treatments: { where: { treatment: liveTreatment }, select: { treatment: { select: { id: true, slug: true, name: true } } } },
} satisfies Prisma.DoctorInclude;
type DoctorRow = Prisma.DoctorGetPayload<{ include: typeof doctorInclude }>;

async function ratings(doctorIds: string[]) {
  const rows = await prisma.review.groupBy({ by: ["doctorId"], where: { doctorId: { in: doctorIds }, status: "APPROVED", deletedAt: null }, _avg: { rating: true }, _count: true });
  return new Map(rows.map((r) => [r.doctorId, { rating: r._avg.rating, count: r._count }]));
}

const toDoctor = (d: DoctorRow, r?: { rating: number | null; count: number }): PublicDoctor => ({
  id: d.id, slug: d.slug, fullName: d.user.fullName, photoUrl: d.photoUrl, qualification: d.qualification, specialization: d.specialization,
  experienceYears: d.experienceYears, bio: d.bio, consultationFeePaise: d.consultationFeePaise, languages: d.languages,
  treatments: d.treatments.map((t) => t.treatment), rating: r?.rating ?? null, reviewCount: r?.count ?? 0,
});

const reviewInclude = { doctor: { select: { user: { select: { fullName: true } } } } } satisfies Prisma.ReviewInclude;
const toReview = (r: Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>): PublicReview => ({
  id: r.id, authorName: r.authorName, rating: r.rating, comment: r.comment, doctorName: r.doctor?.user.fullName ?? null, createdAt: r.createdAt.toISOString(),
});

async function listDoctors(where: Prisma.DoctorWhereInput = {}) {
  const rows = await prisma.doctor.findMany({ where: { ...liveDoctor, ...where }, include: doctorInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const r = await ratings(rows.map((d) => d.id));
  return rows.map((d) => toDoctor(d, r.get(d.id)));
}

publicRouter.get("/site", async (_req, res) => {
  const [s, blocks] = await Promise.all([prisma.hospitalSettings.findUnique({ where: { id: "default" } }), prisma.cmsBlock.findMany()]);
  if (!s) throw notFound("Hospital settings");
  const b = Object.fromEntries(blocks.map((x) => [x.key, x.value])) as Record<string, unknown>;
  const data: SiteContent = {
    hospital: { name: s.name, tagline: s.tagline, phone: s.phone, whatsapp: s.whatsapp, email: s.email, address: s.address, city: s.city, mapEmbedUrl: s.mapEmbedUrl, openingHours: s.openingHours as SiteContent["hospital"]["openingHours"], timezone: s.timezone },
    hero: b.hero as SiteContent["hero"],
    about: b.about as SiteContent["about"],
    stats: (b.stats ?? []) as SiteContent["stats"],
    whyChooseUs: (b.whyChooseUs ?? []) as SiteContent["whyChooseUs"],
    process: (b.process ?? []) as SiteContent["process"],
    legal: (b.legal ?? { privacy: "", terms: "" }) as SiteContent["legal"],
  };
  res.set("Cache-Control", "public, max-age=60").json({ data });
});

publicRouter.get("/treatments", async (_req, res) => {
  const data: PublicTreatment[] = await prisma.treatment.findMany({ where: liveTreatment, select: treatmentSelect, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  res.json({ data });
});

publicRouter.get("/treatments/:slug", async (req, res) => {
  const t = await prisma.treatment.findFirst({ where: { ...liveTreatment, slug: req.params.slug }, select: treatmentSelect });
  if (!t) throw notFound("Treatment");
  res.json({ data: { ...t, doctors: await listDoctors({ treatments: { some: { treatmentId: t.id } } }) } });
});

publicRouter.get("/doctors", async (_req, res) => {
  res.json({ data: await listDoctors() });
});

publicRouter.get("/doctors/:slug", async (req, res) => {
  const [d] = await listDoctors({ slug: req.params.slug });
  if (!d) throw notFound("Doctor");
  const reviews = await prisma.review.findMany({ where: { doctorId: d.id, status: "APPROVED", deletedAt: null }, include: reviewInclude, orderBy: { createdAt: "desc" }, take: 6 });
  res.json({ data: { ...d, reviews: reviews.map(toReview) } });
});

publicRouter.get("/reviews", async (_req, res) => {
  const rows = await prisma.review.findMany({ where: { status: "APPROVED", deletedAt: null }, include: reviewInclude, orderBy: [{ rating: "desc" }, { createdAt: "desc" }], take: 12 });
  res.json({ data: rows.map(toReview) });
});

publicRouter.get("/faqs", async (_req, res) => {
  res.json({ data: await prisma.faq.findMany({ where: { isActive: true }, select: { id: true, question: true, answer: true }, orderBy: { sortOrder: "asc" } }) });
});

publicRouter.post("/contact", rateLimit({ windowMs: 60 * 60_000, limit: 5, skip: () => env.NODE_ENV === "test" }), async (req, res) => {
  const body = parse(contactSchema, req.body);
  const msg = await prisma.contactMessage.create({ data: { ...body, phone: body.phone || null } });
  const s = await prisma.hospitalSettings.findUnique({ where: { id: "default" } });
  await enqueue({ channel: "EMAIL", template: "contact_received", recipient: s?.email, payload: { name: body.name, email: body.email, phone: body.phone, subject: body.subject } });
  res.status(201).json({ data: { id: msg.id } });
});

/** Dynamic sitemap including every public doctor and treatment page. */
export async function sitemap(_req: import("express").Request, res: import("express").Response) {
  const [treatments, doctors] = await Promise.all([
    prisma.treatment.findMany({ where: liveTreatment, select: { slug: true, updatedAt: true } }),
    prisma.doctor.findMany({ where: liveDoctor, select: { slug: true, updatedAt: true } }),
  ]);
  const base = env.APP_URL.replace(/\/$/, "");
  const urls = [
    ...["", "/about", "/doctors", "/treatments", "/book", "/contact", "/faq", "/privacy", "/terms"].map((p) => ({ loc: base + p })),
    ...treatments.map((t) => ({ loc: `${base}/treatments/${t.slug}`, lastmod: t.updatedAt.toISOString() })),
    ...doctors.map((d) => ({ loc: `${base}/doctors/${d.slug}`, lastmod: d.updatedAt.toISOString() })),
  ];
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u.loc}</loc>${"lastmod" in u ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
      .join("\n")}\n</urlset>`,
  );
}
