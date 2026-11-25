# Smile Dental Care — User Guide

How the system works, panel by panel, and how to do everyday tasks.

Live site: https://smile-dental-care.onrender.com

---

## 1. Overview

One website, five kinds of users. Everyone signs in at **/login**, and the system sends each person to their own panel.

| Who | Panel | What they do |
|---|---|---|
| Super admin | `/admin` | Everything, including roles/permissions and audit logs |
| Admin (manager) | `/admin` | Run the hospital: doctors, treatments, bookings, billing, reports, website content |
| Receptionist | `/reception` | Front desk: walk-ins, phone bookings, check-in, queue, billing |
| Doctor | `/doctor` | Own queue, patient charts, clinical notes, prescriptions, own availability |
| Patient | `/patient` | Own appointments, prescriptions, records, invoices, profile |
| Anyone | `/queue/display` | TV screen for the waiting room (no login) |
| Developers | `/api/docs` | API documentation (Swagger) |

### Logins

| Panel | Email | Password |
|---|---|---|
| Super admin | admin@gmail.com | Admin@123456 |
| Admin | manager@smiledental.example | the `SEED_DEMO_PASSWORD` set on Render |
| Receptionist | reception@smiledental.example | the `SEED_DEMO_PASSWORD` set on Render |
| Doctors | dr.arjun@ / dr.kavya@ / dr.rohan@ / dr.sneha@smiledental.example | the `SEED_DEMO_PASSWORD` set on Render |
| Patient | patient@smiledental.example | the `SEED_DEMO_PASSWORD` set on Render |

> Change these passwords before real use: Admin → Staff (staff), or the Profile page (any user).
> After **5 wrong passwords** an account is locked for **15 minutes**.

---

## 2. The public website

Pages: Home, About, Doctors (+ each doctor), Treatments (+ each treatment), Book, Contact, FAQ, Privacy, Terms, Login, Register.

The site has no hard-coded text. Hospital name, phone, address, opening hours, home-page sections, FAQs, doctors, treatments and prices all come from the database. Edit them in **Admin → Website CMS**, **Admin → Settings**, **Doctors** and **Treatments**.

- **Contact form:** messages show up in **Admin → Website CMS → Messages**.
- **Reviews:** after a completed appointment, the patient gets a **Review** button in their Appointments page. They appear on the site only after an admin approves them in **Admin → Reviews**.

---

## 3. How booking works

### Patient books online (`/book`)
1. Choose a **treatment**.
2. Choose a **doctor**. Only doctors who offer that treatment are shown.
3. Choose a **date**, then a free **time slot**. The system shows only slots that are really free (see below).
4. Enter details (name, phone, email). Guests can book without an account.
5. Choose how to pay:
   - **Pay at hospital:** the booking is created as **Pending**, and reception confirms it.
   - **Pay online (Razorpay):** the patient pays now, and the booking becomes **Confirmed** automatically. If payment isn't finished within **15 minutes**, the slot is released.
6. The patient gets a **reference number** (and email/WhatsApp/SMS once those are switched on).

### How free slots are calculated
A slot is shown only if all of these are true:
- It's inside the doctor's **weekly shift** and not in a **break**.
- The doctor isn't on **leave**, and the hospital isn't on a **holiday**. **Special hours** for a date replace the normal hours.
- There's room for the full **treatment duration** plus the doctor's **buffer time**.
- It's within the **booking window** (default 60 days ahead) and at least the **minimum notice** away (default 60 minutes).
- Nobody else has booked it.

All times are **India time (Asia/Kolkata)**. You can change the timezone in Settings.

### Double booking is impossible
The database itself refuses two overlapping appointments for the same doctor. If two people click the same slot at the same moment, exactly one booking succeeds. The other person is told the slot was just taken and picks another.

### Booking limits
- A patient booking online can hold at most **3 upcoming appointments**. More must be booked by reception.
- Patients can cancel or reschedule online only up to **4 hours before** the appointment (Settings → "Online cancel/reschedule window"). Inside that window they have to call. Staff can always change bookings.

### Appointment statuses
```
Pending ──► Confirmed ──► Checked-in ──► In progress ──► Completed
   │            │              │
   └──► Cancelled   Cancelled / No-show   Cancelled / No-show / Completed
```

---

## 4. Receptionist panel (`/reception`)

| Page | Use it to |
|---|---|
| Dashboard | Today's numbers and today's appointment list |
| New booking | Phone or walk-in booking. Search an existing patient or register a new one. Staff bookings are **Confirmed** immediately, and staff can override the duration. |
| Appointments | Search and filter all bookings. **Confirm** pending ones, **Reschedule**, **Cancel** (with a reason; the patient is notified), mark **No-show** |
| Queue | Check patients in, then manage today's queue (see section 6) |
| Patients | Search patients, see contact details and visit history. Receptionists **cannot** see prescriptions, clinical notes or X-rays. |
| Billing | Create invoices, take payments, print PDFs |
| Payments | List of all payments received |

**Typical day:**
1. The patient arrives, and you find the appointment.
2. Check them in. They get a **token number** and join the doctor's queue.
3. The doctor sees them.
4. Create an invoice, take the payment, and print or hand over the PDF.

---

## 5. Doctor panel (`/doctor`)

| Page | Use it to |
|---|---|
| Dashboard | Today's count, patients waiting, **Call next patient** button |
| My queue | Patients waiting for you today: **Call → Start → Complete**, or **Skip** |
| Appointments | Your own bookings |
| My patients | Open a patient chart: history, medical records, dental chart, files, prescriptions |
| Prescriptions | Every prescription you've written |
| Availability & leave | Weekly shifts, breaks, buffer time, leave days |

### Patient chart
- **Medical records:** complaint, diagnosis, treatment done, notes, follow-up date.
- **Dental examination:** a tooth chart using FDI numbering; record findings per tooth.
- **Files:** upload X-rays, reports and photos. Files are checked to be real images or PDFs and are only shown to people allowed to see them.

### Prescriptions
1. Write the medicines (name, dose, frequency, duration, instructions), then **Save draft**.
2. Click **Issue** once it's final. Only issued prescriptions are visible to the patient, who can download them as a PDF.
3. To **amend** an issued prescription you must give a reason. The old version is kept, and the PDF shows "amended v2". Nothing is ever silently overwritten.
4. If you set a **follow-up date**, the patient gets a reminder the day before.

---

## 6. Live queue

- **Check-in** gives each patient a **token number** per doctor per day. You can mark a token as an **Emergency**, which puts it at the top.
- **Actions:**
  - **Call:** shows on the TV screen.
  - **Start:** consultation begins.
  - **Complete:** done.
  - **Skip:** the patient isn't there.
  - **Requeue:** puts a skipped patient back in line.
  - **Cancel:** removes the token.
- **Estimated waiting time** is shown for each patient.
- Every screen updates **live**. When anyone acts, all open screens refresh within a second.
- **TV display:** open `/queue/display` full-screen on the waiting-room TV. It shows who is being called, for which doctor. No login is needed.

---

## 7. Billing & payments

- **Invoice:** pick the patient (and appointment), add items (treatments or custom lines), and set a discount. Tax comes from Settings (default 0%; dental services are usually GST-exempt). Invoice numbers use the prefix from Settings (e.g. `SDC-…`).
- **Payments:** Cash, Card, UPI, Bank transfer, or Razorpay (online). **Partial payments** are allowed, so the status moves Issued → Partially paid → Paid.
- **Refunds:** from a payment, refund all or part. Razorpay payments are refunded through Razorpay.
- **Void:** cancels an invoice that has no payments on it.
- **PDF:** every invoice can be downloaded or printed.
- **Patients** see their invoices under **Billing** and can **pay online** if Razorpay is switched on.

All amounts are stored exactly in paise, so there are no rounding errors.

---

## 8. Admin panel (`/admin`)

| Page | What it does |
|---|---|
| Dashboard | Live figures: patients, doctors, today's appointments, pending, revenue, outstanding, charts, doctor performance |
| Appointments / New booking / Queue | Same as reception |
| Doctors & schedules | Add or edit doctors (photo, bio, qualifications, fee), weekly shifts, breaks, buffer, leave, **special hours**, which treatments they offer and custom durations. **Hospital holidays** are also set here (no bookings on those dates). |
| Treatments | Add or edit treatments: name, description, price, duration, image, on/off. A treatment with upcoming bookings can't be deleted; switch it off instead. |
| Patients & records | All patients and full charts |
| Billing / Payments | Invoices, payments, refunds |
| Notifications | Every email/WhatsApp/SMS sent, with status: **Sent**, **Failed** (can **Retry**) or **Skipped** (that channel isn't set up yet) |
| Reviews | Approve or reject patient reviews |
| Reports | Appointments, revenue, treatments and doctors over any date range; **Export appointments CSV** |
| Website CMS | Home-page sections, About text, FAQs, legal pages, and **Messages** from the contact form |
| Staff | Add receptionists, doctors and admins; deactivate accounts (access stops immediately); reset passwords |
| Roles *(super admin)* | Turn individual permissions on or off per role |
| Settings | Hospital name, contact, address, map, opening hours, timezone, slot interval, booking window, minimum notice, cancel window, tax, GSTIN, invoice prefix |
| Audit log | Who changed what and when, for every clinical, billing and admin change |

---

## 9. Patient panel (`/patient`)

Patients sign up at **/register** to get a login. Patients that reception registers at the desk have a record but no login.

| Page | What they see |
|---|---|
| Dashboard | Next appointment, quick links |
| Appointments | Upcoming and past; **Reschedule** or **Cancel** (up to 4 h before); **Review** after a completed visit |
| Prescriptions | Issued prescriptions, PDF download |
| Records | Their visit notes and files |
| Billing | Invoices, PDF, **Pay online** |
| Profile | Personal details, change password |

Patients can only ever see **their own** data.

---

## 10. Notifications

Sent automatically for: booking received, booking confirmed, rescheduled, cancelled, payment received, reminder **24 hours before**, and follow-up reminder **the day before**.

| Channel | Needs |
|---|---|
| In-app (bell icon) | Works now |
| Email | `RESEND_API_KEY` + verified sender domain |
| WhatsApp | Meta WhatsApp Cloud API token + approved message templates |
| SMS | Provider key + DLT-registered templates |
| Online payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |

Until a key is added, that channel is marked **Skipped**. It never pretends to have sent. Setup details are in [`INTEGRATIONS.md`](INTEGRATIONS.md).

**To add a key on Render:** service → **Environment** → add the variable → **Save**. The service redeploys by itself.

---

## 11. Security, in short

- Passwords are hashed with argon2. Logins expire after 15 minutes and renew silently, and stolen renewal tokens are detected.
- Each role sees only what it's allowed to. Patients see only their own records, and receptionists can't open clinical data.
- A deactivated account or changed password takes effect on the very next click.
- Every sensitive change is written to the **Audit log**.

More detail: [`SECURITY.md`](SECURITY.md).

---

## 12. Hosting (Render free plan)

- **Updates:** every `git push` to `main` redeploys the site automatically.
- **Sleeping:** the site sleeps after 15 minutes with no visitors, so the first visit after that takes about 50 seconds.
- **Database expiry:** the free database **expires after 30 days**. Upgrade it (Render → smile-dental-db → Upgrade) before then to keep the data.
- **Uploaded files** (X-rays etc.) are lost when the site redeploys on the free plan. Add a Render **Disk**, or upgrade, before real use.

Full deployment steps: [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 13. Quick troubleshooting

| Problem | Fix |
|---|---|
| Site very slow to open | It was asleep; wait about 50 s |
| "Too many failed attempts" | Wait 15 minutes, or an admin resets the password in Staff |
| Slot I want is missing | Check the doctor's shifts, leave, special hours, hospital holidays, minimum notice and booking window |
| "Slot just taken" | Someone booked it a moment earlier; pick another |
| Patient can't cancel online | It's within the cancel window; reception can cancel it |
| Email/WhatsApp not arriving | Admin → Notifications: "Skipped" = key not set; "Failed" = check the key, then click Retry |
| Patient has 2 records | Online sign-up always creates a new record. There's no merge tool yet. |
