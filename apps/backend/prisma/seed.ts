/**
 * Seeds reference data (roles, permissions, settings, CMS, default treatments, FAQs) and a
 * super admin. Everything seeded here is editable from the admin dashboard.
 * Demo doctors/staff/patients/reviews are only created when SEED_DEMO=true (never in production).
 *
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  — required in production
 *   SEED_DEMO=true                          — adds demo users (password: SEED_DEMO_PASSWORD or "Demo@12345" in dev)
 *   ALLOW_DEMO_SEED=true                    — permits the demo seed when NODE_ENV=production (demo deployments only)
 */
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type RoleName } from "../src/generated/prisma/client.js";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/config/permissions.js";

try { process.loadEnvFile(); } catch { /* env provided by the shell */ }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const isProd = process.env.NODE_ENV === "production";
const img = (id: string, w = 1200) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

const TREATMENTS = [
  { slug: "general-dentistry", name: "General Dentistry", durationMinutes: 15, pricePaise: 50000, image: "1606265752439-1f18756aa5fc",
    summary: "Comprehensive check-ups, digital X-rays and fillings to keep your teeth healthy year-round.",
    description: "A general dental visit includes a full oral examination, screening for decay, gum disease and oral cancer, and a personalised care plan. Small cavities are treated the same day with tooth-coloured composite fillings.",
    preparation: "Bring any previous dental X-rays and a list of current medications.", aftercare: "Avoid chewing on the treated side for 2 hours after a filling." },
  { slug: "root-canal-treatment", name: "Root Canal Treatment", durationMinutes: 60, pricePaise: 650000, image: "1588776814546-1ffcf47267a5",
    summary: "Pain-free rotary endodontics to save infected teeth and relieve toothache.",
    description: "Root canal treatment removes infected pulp from inside the tooth, disinfects the canals and seals them. We use rotary instruments and apex locators for precise, comfortable treatment, usually completed in one or two visits.",
    preparation: "Eat a light meal before your appointment. Continue any antibiotics prescribed by your doctor.", aftercare: "Mild tenderness for 2–3 days is normal. Avoid hard foods on the tooth until the crown is placed." },
  { slug: "dental-implants", name: "Dental Implants", durationMinutes: 90, pricePaise: 3500000, image: "1593022356769-11f762e25ed9",
    summary: "Permanent, natural-looking replacements for missing teeth using titanium implants.",
    description: "A dental implant is a titanium post placed in the jawbone that fuses with bone to support a crown, bridge or denture. Treatment begins with a CBCT scan and planning consultation.",
    preparation: "A CBCT scan and blood tests may be required. Avoid smoking for at least a week before surgery.", aftercare: "Use cold compresses for the first 24 hours, eat soft foods, and do not smoke. Attend your suture-removal visit." },
  { slug: "teeth-whitening", name: "Teeth Whitening", durationMinutes: 45, pricePaise: 1200000, image: "1588776813677-77aaf5595b83",
    summary: "Professional in-clinic whitening for a visibly brighter smile in one visit.",
    description: "In-office whitening uses a professional-strength gel activated under controlled conditions, lightening teeth by several shades while protecting your gums.",
    preparation: "A cleaning is recommended before whitening for even results.", aftercare: "Avoid tea, coffee, red wine and smoking for 48 hours." },
  { slug: "braces-orthodontics", name: "Braces & Orthodontics", durationMinutes: 30, pricePaise: 100000, image: "1609840114035-3c981b782dfe",
    summary: "Metal, ceramic braces and clear aligners to straighten teeth at any age.",
    description: "Our orthodontists assess your bite and recommend metal braces, ceramic braces or clear aligners. The consultation includes photographs, impressions and a treatment timeline.",
    preparation: "Brush and floss before your consultation.", aftercare: "Follow the cleaning routine shown by your orthodontist and attend adjustment visits as scheduled." },
  { slug: "cosmetic-dentistry", name: "Cosmetic Dentistry", durationMinutes: 60, pricePaise: 800000, image: "1600170311833-c2cf5280ce49",
    summary: "Veneers, bonding and smile design tailored to your face.",
    description: "Cosmetic dentistry combines veneers, composite bonding, gum contouring and whitening to design a smile that suits you. Digital smile design lets you preview results before treatment.",
    preparation: "Bring photos of smiles you like to your consultation.", aftercare: "Avoid biting hard objects with veneers; wear a night guard if you grind your teeth." },
  { slug: "tooth-extraction", name: "Tooth Extraction", durationMinutes: 45, pricePaise: 150000, image: "1588776814546-daab30f310ce",
    summary: "Gentle simple and surgical extractions, including wisdom teeth.",
    description: "When a tooth cannot be saved, we remove it gently under local anaesthesia. Surgical extractions of impacted wisdom teeth are performed by our oral surgeon.",
    preparation: "Eat before the procedure and inform the doctor about blood thinners or diabetes.", aftercare: "Bite on the gauze for 30 minutes. No spitting, straws or smoking for 24 hours. Eat soft, cool foods." },
  { slug: "pediatric-dentistry", name: "Pediatric Dentistry", durationMinutes: 30, pricePaise: 60000, image: "1598256989800-fe5f95da9787",
    summary: "Friendly, gentle dental care for infants, children and teens.",
    description: "Our pediatric dentist focuses on prevention — fluoride application, pit-and-fissure sealants and habit counselling — in a calm, child-friendly setting.",
    preparation: "Tell your child the visit is a 'tooth count'. Avoid words like 'pain' or 'injection'.", aftercare: "Avoid eating for 30 minutes after fluoride application." },
  { slug: "dental-cleaning", name: "Dental Cleaning", durationMinutes: 30, pricePaise: 120000, image: "1606811971618-4486d14f3f99",
    summary: "Ultrasonic scaling and polishing to remove tartar and stains.",
    description: "Professional cleaning removes plaque and tartar that brushing can't, helping prevent gum disease and bad breath. Recommended every six months.",
    preparation: "No special preparation needed.", aftercare: "Mild sensitivity may occur for a day; use a desensitising toothpaste if needed." },
  { slug: "crowns-bridges", name: "Crowns & Bridges", durationMinutes: 60, pricePaise: 700000, image: "1468493858157-0da44aaf1d13",
    summary: "Zirconia and porcelain crowns and bridges to restore strength and appearance.",
    description: "Crowns cap damaged teeth; bridges replace missing teeth by anchoring to neighbouring teeth. We offer metal-free zirconia and E.max options matched to your natural shade.",
    preparation: "Tooth preparation and impressions take one visit; the final crown is fitted in the next.", aftercare: "Avoid sticky foods on a temporary crown. Floss carefully around bridges." },
];

const DEMO_DOCTORS = [
  { email: "dr.arjun@smiledental.example", fullName: "Dr. Arjun Mehta", slug: "dr-arjun-mehta", photo: "1622253692010-333f2da6031d", qualification: "BDS, MDS (Endodontics)", specialization: "Endodontist", experienceYears: 12, fee: 50000, languages: ["English", "Hindi", "Marathi"], treatments: ["general-dentistry", "root-canal-treatment", "crowns-bridges", "dental-cleaning"], bio: "Dr. Arjun Mehta specialises in microscope-assisted root canal treatment and has performed thousands of single-visit endodontic procedures." },
  { email: "dr.kavya@smiledental.example", fullName: "Dr. Kavya Nair", slug: "dr-kavya-nair", photo: "1559839734-2b71ea197ec2", qualification: "BDS, MDS (Orthodontics)", specialization: "Orthodontist", experienceYears: 9, fee: 60000, languages: ["English", "Hindi", "Malayalam"], treatments: ["braces-orthodontics", "cosmetic-dentistry", "teeth-whitening"], bio: "Dr. Kavya Nair is a certified clear-aligner provider who designs braces and aligner plans for teens and adults." },
  { email: "dr.rohan@smiledental.example", fullName: "Dr. Rohan Kapoor", slug: "dr-rohan-kapoor", photo: "1612349317150-e413f6a5b16d", qualification: "BDS, MDS (Oral & Maxillofacial Surgery)", specialization: "Implantologist & Oral Surgeon", experienceYears: 15, fee: 70000, languages: ["English", "Hindi", "Punjabi"], treatments: ["dental-implants", "tooth-extraction", "crowns-bridges", "general-dentistry"], bio: "Dr. Rohan Kapoor leads our implant centre, using guided surgery and CBCT planning for predictable results." },
  { email: "dr.sneha@smiledental.example", fullName: "Dr. Sneha Iyer", slug: "dr-sneha-iyer", photo: "1594824476967-48c8b964273f", qualification: "BDS, MDS (Pedodontics)", specialization: "Pediatric Dentist", experienceYears: 7, fee: 45000, languages: ["English", "Hindi", "Tamil"], treatments: ["pediatric-dentistry", "dental-cleaning", "general-dentistry", "teeth-whitening"], bio: "Dr. Sneha Iyer makes dental visits fun for children, with a focus on prevention and gentle care." },
];

async function main() {
  // Roles & permissions
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  const roles = {} as Record<RoleName, string>;
  for (const [name, list] of Object.entries(ROLE_PERMISSIONS) as [RoleName, string[]][]) {
    const role = await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    roles[name] = role.id;
    // Only seed role permissions the first time; afterwards they're managed in the admin UI.
    if ((await prisma.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      await prisma.rolePermission.createMany({ data: list.map((k) => ({ roleId: role.id, permissionId: perms.get(k)! })) });
    }
  }

  await prisma.hospitalSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      name: "Smile Dental Care", tagline: "Your Smile, Our Priority.",
      phone: "+91 98765 43210", whatsapp: "+91 98765 43210", email: "care@smiledental.example",
      address: "2nd Floor, Lotus Plaza, FC Road, Shivajinagar, Pune, Maharashtra 411004", city: "Pune",
      mapEmbedUrl: "https://www.google.com/maps?q=FC+Road+Shivajinagar+Pune&output=embed",
      timezone: "Asia/Kolkata", taxRateBp: 0,
      openingHours: [{ days: "Mon – Sat", hours: "9:30 AM – 8:30 PM" }, { days: "Sunday", hours: "Emergencies only" }],
    },
  });

  const cms: Record<string, unknown> = {
    hero: {
      eyebrow: "Accepting new patients this week",
      title: "Modern dental care for a confident, healthy smile",
      subtitle: "Experienced specialists, pain-free techniques and transparent pricing — from routine check-ups to implants and braces, all under one roof.",
      imageUrl: img("1667133295315-820bb6481730", 1400),
    },
    about: {
      title: "A dental hospital built around your comfort",
      body: "Smile Dental Care brings together specialists in endodontics, orthodontics, implantology and pediatric dentistry so your whole family can be treated in one place.\n\nWe invest in digital X-rays, rotary endodontics and strict sterilisation protocols, and we explain every treatment option and cost before we begin.",
      imageUrl: img("1629909613654-28e377c37b09"),
      highlights: ["Specialist doctors for every treatment", "Digital X-rays & intra-oral cameras", "Class-B autoclave sterilisation", "Clear estimates before treatment"],
    },
    stats: [{ label: "Years of care", value: "10+" }, { label: "Specialist doctors", value: "4" }, { label: "Treatments offered", value: "10" }, { label: "Days open weekly", value: "6" }],
    whyChooseUs: [
      { title: "Specialist-led care", body: "Every procedure is performed by a dentist trained in that specialty.", icon: "award" },
      { title: "Pain-free techniques", body: "Modern anaesthesia, rotary instruments and gentle hands.", icon: "heart" },
      { title: "Strict sterilisation", body: "Hospital-grade protocols with sealed, single-use instrument kits.", icon: "shield" },
      { title: "Transparent pricing", body: "Written estimates before treatment — no hidden charges.", icon: "rupee" },
    ],
    process: [
      { title: "Choose a treatment", body: "Pick the care you need, or a general check-up if you're unsure." },
      { title: "Pick your doctor & time", body: "See real-time availability and choose a slot that suits you." },
      { title: "Confirm your booking", body: "Pay online or at the hospital and get an instant reference number." },
      { title: "Visit & get treated", body: "Check in at reception and track your queue token live." },
    ],
    legal: {
      privacy: "Smile Dental Care (\"we\") processes your personal and health data to provide dental care, manage appointments and billing, and meet legal obligations, in line with the Digital Personal Data Protection Act, 2023.\n\nWhat we collect: identity and contact details, appointment history, clinical records, prescriptions, X-rays and payment records. We do not store card or UPI credentials — online payments are processed by Razorpay.\n\nWho can see it: only the doctors and staff involved in your care, with role-based access and audit logging.\n\nYour rights: you may request access, correction or erasure of your data (subject to medical-record retention laws) and withdraw consent by contacting our Grievance Officer at the email listed on the Contact page.\n\nRetention: clinical records are retained as required by applicable medical regulations, then securely deleted.\n\n[Hospital administrators: review and replace this text with your legal-approved policy in Admin → Website CMS.]",
      terms: "By booking an appointment you agree to provide accurate information and to arrive 10 minutes before your scheduled time.\n\nCancellations: please cancel or reschedule at least 4 hours before your appointment. Repeated no-shows may require prepayment for future bookings.\n\nPayments: treatment estimates are indicative; your doctor confirms the final plan after examination. Online payments are refunded to the original payment method as per our refund policy.\n\nMedical advice: content on this website is general information and not a substitute for an in-person examination.\n\n[Hospital administrators: review and replace this text with your legal-approved terms in Admin → Website CMS.]",
    },
  };
  for (const [key, value] of Object.entries(cms)) {
    await prisma.cmsBlock.upsert({ where: { key }, create: { key, value: value as object }, update: {} });
  }

  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({
      data: [
        { question: "How do I book an appointment?", answer: "Use the Book Appointment page to choose a treatment, doctor and time slot. You can also call us or walk in — our front desk will book you in." },
        { question: "Can I reschedule or cancel my appointment?", answer: "Yes. Log in to your patient dashboard to reschedule or cancel up to 4 hours before your appointment, or call the front desk." },
        { question: "What payment methods do you accept?", answer: "You can pay online by card, UPI or net banking through Razorpay, or pay at the hospital by cash, card or UPI." },
        { question: "Is root canal treatment painful?", answer: "With modern local anaesthesia and rotary instruments, root canal treatment feels similar to getting a filling. Most patients return to work the same day." },
        { question: "Do you treat children?", answer: "Yes. Our pediatric dentist sees children from their first tooth onward in a friendly, calm environment." },
        { question: "How long do dental implants last?", answer: "With good oral hygiene and regular check-ups, implants can last for decades. The crown on top may need replacement after 10–15 years." },
        { question: "Do you handle dental emergencies?", answer: "Yes. Call us immediately for severe pain, swelling or trauma. Emergency patients are prioritised in the queue." },
      ].map((f, i) => ({ ...f, sortOrder: i })),
    });
  }

  for (const [i, t] of TREATMENTS.entries()) {
    const { image, ...data } = t;
    await prisma.treatment.upsert({ where: { slug: t.slug }, create: { ...data, imageUrl: img(image), sortOrder: i }, update: {} });
  }

  // Super admin
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? (isProd ? undefined : "admin@gmail.com");
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? undefined : "Admin@123456");
  if (!adminEmail || !adminPassword) throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required in production");
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, fullName: "Super Admin", passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }), roleId: roles.SUPER_ADMIN },
  });

  // Demo accounts: always allowed in development; in production only with an explicit opt-in and a supplied password.
  if (process.env.SEED_DEMO === "true" && (!isProd || process.env.ALLOW_DEMO_SEED === "true")) {
    if (isProd && !process.env.SEED_DEMO_PASSWORD) throw new Error("SEED_DEMO_PASSWORD is required for a production demo seed");
    await seedDemo(roles);
  }
  console.log("Seed complete.");
}

async function seedDemo(roles: Record<RoleName, string>) {
  const passwordHash = await argon2.hash(process.env.SEED_DEMO_PASSWORD ?? "Demo@12345", { type: argon2.argon2id });
  const treatments = new Map((await prisma.treatment.findMany()).map((t) => [t.slug, t.id]));

  await prisma.user.upsert({ where: { email: "manager@smiledental.example" }, update: {}, create: { email: "manager@smiledental.example", fullName: "Priya Sharma", passwordHash, roleId: roles.ADMIN } });
  const rec = await prisma.user.upsert({ where: { email: "reception@smiledental.example" }, update: {}, create: { email: "reception@smiledental.example", fullName: "Neha Joshi", phone: "9876500001", passwordHash, roleId: roles.RECEPTIONIST } });
  await prisma.staff.upsert({ where: { userId: rec.id }, update: {}, create: { userId: rec.id, designation: "Front Desk Executive" } });

  for (const [i, d] of DEMO_DOCTORS.entries()) {
    const user = await prisma.user.upsert({ where: { email: d.email }, update: {}, create: { email: d.email, fullName: d.fullName, passwordHash, roleId: roles.DOCTOR } });
    const exists = await prisma.doctor.findUnique({ where: { userId: user.id } });
    if (exists) continue;
    await prisma.doctor.create({
      data: {
        userId: user.id, slug: d.slug, photoUrl: img(d.photo, 800), qualification: d.qualification, specialization: d.specialization,
        experienceYears: d.experienceYears, consultationFeePaise: d.fee, languages: d.languages, bio: d.bio, sortOrder: i, bufferMinutes: 5,
        registrationNumber: `MDC-A-${10234 + i}`, registrationCouncil: "Maharashtra State Dental Council",
        treatments: { create: d.treatments.map((slug) => ({ treatmentId: treatments.get(slug)! })) },
        // Mon–Sat: morning + evening shifts with a short tea break.
        schedules: { create: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
          { weekday, startMinute: hm("09:30"), endMinute: hm("13:30"), label: "Morning" },
          { weekday, startMinute: hm("17:00"), endMinute: hm("20:30"), label: "Evening" },
        ]) },
        breaks: { create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: hm("11:30"), endMinute: hm("11:45"), label: "Tea break" })) },
      },
    });
  }

  const patientUser = await prisma.user.upsert({ where: { email: "patient@smiledental.example" }, update: {}, create: { email: "patient@smiledental.example", fullName: "Rahul Verma", phone: "9876512345", passwordHash, roleId: roles.PATIENT } });
  if (!(await prisma.patient.findUnique({ where: { userId: patientUser.id } }))) {
    const c = await prisma.counter.upsert({ where: { key: "patient" }, create: { key: "patient", value: 1 }, update: { value: { increment: 1 } } });
    await prisma.patient.create({ data: { userId: patientUser.id, patientCode: `SDC-P${String(c.value).padStart(6, "0")}`, fullName: "Rahul Verma", phone: "9876512345", email: patientUser.email, gender: "MALE", consentAt: new Date() } });
  }

  if ((await prisma.review.count()) === 0) {
    const docs = await prisma.doctor.findMany({ select: { id: true, slug: true } });
    const doc = (slug: string) => docs.find((x) => x.slug === slug)?.id;
    await prisma.review.createMany({
      data: [
        { authorName: "Demo patient A", rating: 5, doctorId: doc("dr-arjun-mehta"), comment: "[Demo review] Root canal was completely painless and finished in one sitting. The doctor explained every step." },
        { authorName: "Demo patient B", rating: 5, doctorId: doc("dr-sneha-iyer"), comment: "[Demo review] My daughter was nervous, but the team made her feel at ease. She actually wants to come back!" },
        { authorName: "Demo patient C", rating: 4, doctorId: doc("dr-rohan-kapoor"), comment: "[Demo review] Implant procedure was well planned with a 3D scan, and the clinic kept me informed throughout." },
      ].map((r) => ({ ...r, status: "APPROVED" as const })),
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
