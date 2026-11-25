import { createHmac } from "node:crypto";
import { localDate } from "../src/utils/time.js";
import { bearer, fixtures, guest, http, login, prisma } from "./helpers.js";

describe("phase 3: catalog administration", () => {
  it("admin creates, edits, disables and soft-deletes a treatment", async () => {
    const t = await login("manager@smiledental.example");
    const c = await http().post("/api/treatments").set(bearer(t)).send({ name: "Gum Contouring", summary: "Reshape the gum line for a balanced smile.", description: "Laser-assisted gum contouring procedure.", pricePaise: 900000, durationMinutes: 40 });
    expect(c.status).toBe(201);
    expect(c.body.data.slug).toBe("gum-contouring");
    const e = await http().patch(`/api/treatments/${c.body.data.id}`).set(bearer(t)).send({ pricePaise: 950000, isActive: false });
    expect(e.body.data.pricePaise).toBe(950000);
    expect((await http().get("/api/public/treatments")).body.data.some((x: { id: string }) => x.id === c.body.data.id)).toBe(false);
    expect((await http().delete(`/api/treatments/${c.body.data.id}`).set(bearer(t))).status).toBe(204);
  });

  it("receptionist cannot manage treatments or settings", async () => {
    const t = await login("reception@smiledental.example");
    expect((await http().post("/api/treatments").set(bearer(t)).send({})).status).toBe(403);
    expect((await http().patch("/api/settings").set(bearer(t)).send({ name: "X" })).status).toBe(403);
    expect((await http().get("/api/audit-logs").set(bearer(t))).status).toBe(403);
  });

  it("admin creates a doctor with schedule; doctor can log in and edit own availability", async () => {
    const t = await login("manager@smiledental.example");
    const f = await fixtures();
    const d = await http().post("/api/doctors").set(bearer(t)).send({ fullName: "Dr. Test Person", email: "dr.test@smiledental.example", password: "Doctor@123", qualification: "BDS", specialization: "General Dentist", experienceYears: 3, consultationFeePaise: 30000, treatmentIds: [f.general.id] });
    expect(d.status).toBe(201);
    const s = await http().put(`/api/doctors/${d.body.data.id}/schedule`).set(bearer(t)).send({ shifts: [{ weekday: 1, startMinute: 600, endMinute: 720 }], breaks: [] });
    expect(s.status).toBe(200);
    const overlapping = await http().put(`/api/doctors/${d.body.data.id}/schedule`).set(bearer(t)).send({ shifts: [{ weekday: 1, startMinute: 600, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }] });
    expect(overlapping.status).toBe(409);

    const dt = await login("dr.test@smiledental.example", "Doctor@123");
    expect((await http().post("/api/doctors/me/leaves").set(bearer(dt)).send({ startDate: "2030-01-01", endDate: "2030-01-02", reason: "Personal" })).status).toBe(201);
    // …but not someone else's.
    expect((await http().post(`/api/doctors/${f.doctor.id}/leaves`).set(bearer(dt)).send({ startDate: "2030-01-01", endDate: "2030-01-02" })).status).toBe(403);
  });
});

describe("phase 7: queue, records, prescriptions", () => {
  it("walk-in check-in → call → consult → complete with emergency priority and estimates", async () => {
    const rt = await login("reception@smiledental.example");
    const f = await fixtures();
    const p1 = await http().post("/api/patients").set(bearer(rt)).send(guest("Queue One"));
    const p2 = await http().post("/api/patients").set(bearer(rt)).send(guest("Queue Two"));
    expect(p1.status).toBe(201);
    const t1 = await http().post("/api/queue/check-in").set(bearer(rt)).send({ patientId: p1.body.data.id, doctorId: f.doctor.id });
    const t2 = await http().post("/api/queue/check-in").set(bearer(rt)).send({ patientId: p2.body.data.id, doctorId: f.doctor.id, emergency: true });
    expect(t2.body.data.tokenNumber).toBe(t1.body.data.tokenNumber + 1);

    const next = await http().post("/api/queue/call-next").set(bearer(rt)).send({ doctorId: f.doctor.id });
    expect(next.body.data.id).toBe(t2.body.data.id); // emergency first
    expect((await http().post(`/api/queue/${t2.body.data.id}/start`).set(bearer(rt))).status).toBe(200);
    expect((await http().post(`/api/queue/${t1.body.data.id}/start`).set(bearer(rt))).body.error.code).toBe("DOCTOR_BUSY");

    const board = await http().get("/api/queue").query({ doctorId: f.doctor.id }).set(bearer(rt));
    const waiting = board.body.data.find((x: { id: string }) => x.id === t1.body.data.id);
    expect(waiting.estimatedWaitMinutes).toBeGreaterThan(0);

    const display = await http().get("/api/queue/display");
    expect(JSON.stringify(display.body)).not.toContain("Queue One"); // no PII on public screen
    expect((await http().post(`/api/queue/${t2.body.data.id}/complete`).set(bearer(rt))).body.data.status).toBe("COMPLETED");
  });

  it("doctor writes a record and prescription; amendments keep revisions; patient sees only issued ones", async () => {
    const f = await fixtures();
    const pt = await login("patient@smiledental.example");
    const me = await prisma.patient.findFirstOrThrow({ where: { user: { email: "patient@smiledental.example" } } });
    // Link patient to doctor via an appointment so the doctor may access them.
    await prisma.appointment.create({ data: { reference: "SDC-TEST-RX", patientId: me.id, doctorId: f.doctor.id, treatmentId: f.general.id, startAt: new Date("2031-01-06T04:00:00Z"), endAt: new Date("2031-01-06T04:15:00Z"), status: "COMPLETED" } });
    const dt = await login("dr.arjun@smiledental.example");

    const rec = await http().post("/api/medical-records").set(bearer(dt)).send({ patientId: me.id, chiefComplaint: "Pain lower left", diagnosis: "Deep caries 36", examination: { teeth: { "36": { condition: "caries" } }, gums: "Healthy" } });
    expect(rec.status).toBe(201);

    const draft = await http().post("/api/prescriptions").set(bearer(dt)).send({ patientId: me.id, diagnosis: "Irreversible pulpitis 36", items: [{ medicine: "Amoxicillin 500mg", dosage: "1 cap", frequency: "TDS", duration: "5 days" }] });
    expect(draft.body.data.status).toBe("DRAFT");
    expect((await http().get(`/api/prescriptions/${draft.body.data.id}`).set(bearer(pt))).status).toBe(404);

    const issued = await http().put(`/api/prescriptions/${draft.body.data.id}`).set(bearer(dt)).send({ patientId: me.id, diagnosis: "Irreversible pulpitis 36", items: [{ medicine: "Amoxicillin 500mg", dosage: "1 cap", frequency: "TDS", duration: "5 days" }], finalize: true });
    expect(issued.body.data.status).toBe("FINAL");

    const noReason = await http().put(`/api/prescriptions/${draft.body.data.id}`).set(bearer(dt)).send({ patientId: me.id, diagnosis: "x pulpitis", items: [{ medicine: "Ibuprofen 400mg", dosage: "1 tab", frequency: "BD", duration: "3 days" }] });
    expect(noReason.status).toBe(400);
    const amended = await http().put(`/api/prescriptions/${draft.body.data.id}`).set(bearer(dt)).send({ patientId: me.id, diagnosis: "Irreversible pulpitis 36", reason: "Added analgesic", items: [{ medicine: "Amoxicillin 500mg", dosage: "1 cap", frequency: "TDS", duration: "5 days" }, { medicine: "Ibuprofen 400mg", dosage: "1 tab", frequency: "BD", duration: "3 days" }] });
    expect(amended.body.data.version).toBe(2);
    expect(await prisma.prescriptionRevision.count({ where: { prescriptionId: draft.body.data.id } })).toBe(1);

    const pdf = await http().get(`/api/prescriptions/${draft.body.data.id}/pdf`).set(bearer(pt));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");

    // Another doctor with no relationship to this patient is refused.
    const other = await login("dr.kavya@smiledental.example");
    expect((await http().get(`/api/medical-records`).query({ patientId: me.id }).set(bearer(other))).status).toBe(403);
  });
});

describe("phase 8: billing", () => {
  it("invoice with discount + partial payments + refund keeps totals consistent", async () => {
    const rt = await login("reception@smiledental.example");
    const p = await http().post("/api/patients").set(bearer(rt)).send(guest("Billing Person"));
    const inv = await http().post("/api/invoices").set(bearer(rt)).send({ patientId: p.body.data.id, items: [{ description: "Root canal", quantity: 1, unitPricePaise: 650000 }, { description: "X-ray", quantity: 2, unitPricePaise: 25000 }], discountPaise: 50000 });
    expect(inv.status).toBe(201);
    expect(inv.body.data.totalPaise).toBe(650000);

    expect((await http().post(`/api/invoices/${inv.body.data.id}/payments`).set(bearer(rt)).send({ amountPaise: 700000, method: "CASH" })).status).toBe(400);
    const pay1 = await http().post(`/api/invoices/${inv.body.data.id}/payments`).set(bearer(rt)).send({ amountPaise: 400000, method: "UPI", reference: "UPI123" });
    expect(pay1.status).toBe(201);
    let i = (await http().get(`/api/invoices/${inv.body.data.id}`).set(bearer(rt))).body.data;
    expect(i.status).toBe("PARTIALLY_PAID");
    await http().post(`/api/invoices/${inv.body.data.id}/payments`).set(bearer(rt)).send({ amountPaise: 250000, method: "CASH" });
    i = (await http().get(`/api/invoices/${inv.body.data.id}`).set(bearer(rt))).body.data;
    expect(i.status).toBe("PAID");

    const ref = await http().post(`/api/payments/${pay1.body.data.id}/refunds`).set(bearer(rt)).send({ amountPaise: 100000, reason: "Goodwill adjustment" });
    expect(ref.status).toBe(201);
    i = (await http().get(`/api/invoices/${inv.body.data.id}`).set(bearer(rt))).body.data;
    expect(i.refundedPaise).toBe(100000);
    expect(i.status).toBe("PARTIALLY_PAID");
    expect((await http().get(`/api/invoices/${inv.body.data.id}/pdf`).set(bearer(rt))).headers["content-type"]).toBe("application/pdf");

    // Patients can't see other patients' invoices.
    const pt = await login("patient@smiledental.example");
    expect((await http().get(`/api/invoices/${inv.body.data.id}`).set(bearer(pt))).status).toBe(404);
  });

  it("Razorpay webhook: bad signature rejected, valid event captured once (idempotent)", async () => {
    const f = await fixtures();
    const p = await prisma.patient.findFirstOrThrow();
    const a = await prisma.appointment.create({ data: { reference: "SDC-TEST-RZP", patientId: p.id, doctorId: f.other.id, treatmentId: f.general.id, startAt: new Date("2031-02-03T04:00:00Z"), endAt: new Date("2031-02-03T04:15:00Z"), status: "PENDING", paymentMethod: "RAZORPAY" } });
    await prisma.payment.create({ data: { patientId: p.id, appointmentId: a.id, amountPaise: 70000, method: "RAZORPAY", razorpayOrderId: "order_TEST1" } });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_TEST1", order_id: "order_TEST1" } } } });
    const sig = createHmac("sha256", "whsec_test").update(body).digest("hex");

    const bad = await http().post("/api/payments/webhook").set("content-type", "application/json").set("x-razorpay-signature", "deadbeef").send(body);
    expect(bad.status).toBe(400);
    for (let n = 0; n < 2; n++) {
      const ok = await http().post("/api/payments/webhook").set("content-type", "application/json").set("x-razorpay-signature", sig).set("x-razorpay-event-id", "evt_1").send(body);
      expect(ok.status).toBe(200);
    }
    expect((await prisma.payment.findUniqueOrThrow({ where: { razorpayOrderId: "order_TEST1" } })).status).toBe("CAPTURED");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMED");
    expect(await prisma.invoice.count({ where: { appointmentId: a.id } })).toBe(1);
  });
});

describe("phase 5: dashboards use real data", () => {
  it("admin dashboard numbers match the database", async () => {
    const t = await login("manager@smiledental.example");
    const r = await http().get("/api/reports/admin").set(bearer(t));
    expect(r.status).toBe(200);
    expect(r.body.data.cards.totalPatients).toBe(await prisma.patient.count({ where: { deletedAt: null } }));
    expect(r.body.data.weekly).toHaveLength(7);
    expect(r.body.data.weekly.at(-1).day).toBe(localDate(new Date(), "Asia/Kolkata"));
    expect(r.body.data.monthly).toHaveLength(12);
  });
  it("patients cannot read admin reports", async () => {
    const t = await login("patient@smiledental.example");
    expect((await http().get("/api/reports/admin").set(bearer(t))).status).toBe(403);
  });
});

describe("security review regressions", () => {
  it("deactivated staff lose API access immediately, not at token expiry", async () => {
    const admin = await login("manager@smiledental.example");
    const c = await http().post("/api/staff").set(bearer(admin)).send({ fullName: "Temp Desk", email: "temp.desk@smiledental.example", password: "Desk@12345", role: "RECEPTIONIST", designation: "Front desk" });
    const t = await login("temp.desk@smiledental.example", "Desk@12345");
    expect((await http().get("/api/patients").set(bearer(t))).status).toBe(200);
    await http().patch(`/api/staff/${c.body.data.id}`).set(bearer(admin)).send({ isActive: false });
    expect((await http().get("/api/patients").set(bearer(t))).status).toBe(401);
  });

  it("registering with a walk-in's phone does not grant access to their record", async () => {
    const rt = await login("reception@smiledental.example");
    const walkIn = await http().post("/api/patients").set(bearer(rt)).send({ fullName: "Private Walkin", phone: "9123400001" });
    const reg = await http().post("/api/auth/register").send({ fullName: "Attacker", email: "attacker@example.com", phone: "9123400001", password: "Attack123", consent: true });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.patientId).not.toBe(walkIn.body.data.id);
    expect((await http().get(`/api/patients/${walkIn.body.data.id}`).set(bearer(reg.body.data.accessToken))).status).toBe(403);
  });

  it("front desk cannot read prescriptions or clinical files", async () => {
    const rt = await login("reception@smiledental.example");
    const me = await prisma.patient.findFirstOrThrow({ where: { user: { email: "patient@smiledental.example" } } });
    const s = await http().get(`/api/patients/${me.id}/summary`).set(bearer(rt));
    expect(s.body.data.prescriptions).toEqual([]);
    expect(s.body.data.records).toEqual([]);
    const f = await prisma.uploadedFile.create({ data: { uploadedById: (await prisma.user.findFirstOrThrow()).id, patientId: me.id, kind: "XRAY", storageKey: "nonexistent.png", originalName: "x.png", mimeType: "image/png", sizeBytes: 1 } });
    expect((await http().get(`/api/files/${f.id}/content`).set(bearer(rt))).status).toBe(403);
  });

  it("concurrent desk payments cannot overpay an invoice", async () => {
    const rt = await login("reception@smiledental.example");
    const p = await http().post("/api/patients").set(bearer(rt)).send(guest("Race Payer"));
    const inv = await http().post("/api/invoices").set(bearer(rt)).send({ patientId: p.body.data.id, items: [{ description: "Cleaning", quantity: 1, unitPricePaise: 100000 }] });
    const results = await Promise.all(Array.from({ length: 5 }, () => http().post(`/api/invoices/${inv.body.data.id}/payments`).set(bearer(rt)).send({ amountPaise: 100000, method: "CASH" })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.body.data.id } })).paidPaise).toBe(100000);
  });

  it("patients cannot hold more than 3 upcoming bookings", async () => {
    const f = await fixtures();
    const reg = await http().post("/api/auth/register").send({ fullName: "Slot Hoarder", email: "hoarder@example.com", phone: "9123400002", password: "Hoard1234", consent: true });
    const t = reg.body.data.accessToken;
    const day = "2031-03-03"; // a Monday; widen the booking window to reach it
    await prisma.hospitalSettings.update({ where: { id: "default" }, data: { bookingWindowDays: 3650 } });
    const slots = (await http().get("/api/availability").query({ doctorId: f.other.id, treatmentId: f.general.id, date: day })).body.data.slots as string[];
    const codes: number[] = [];
    for (const s of [slots[0], slots[4], slots[8], slots[12]]) // 1h apart: clear of the doctor's buffer
      codes.push((await http().post("/api/appointments").set(bearer(t)).send({ treatmentId: f.general.id, doctorId: f.other.id, startAt: s })).status);
    expect(codes).toEqual([201, 201, 201, 409]);
    await prisma.hospitalSettings.update({ where: { id: "default" }, data: { bookingWindowDays: 60 } });
  });
});
