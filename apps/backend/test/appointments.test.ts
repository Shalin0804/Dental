import { bearer, fixtures, guest, http, login, nextWeekday, prisma } from "./helpers.js";

describe("availability & booking", () => {
  let f: Awaited<ReturnType<typeof fixtures>>;
  const monday = nextWeekday(1);
  const tuesday = nextWeekday(2);
  beforeAll(async () => { f = await fixtures(); });

  const slots = async (date: string, treatmentId = f.general.id, doctorId = f.doctor.id) =>
    (await http().get("/api/availability").query({ doctorId, treatmentId, date })).body.data as { slots: string[]; duration: number; reason: string | null };

  it("generates slots from morning and evening shifts, skipping the tea break", async () => {
    const r = await slots(monday);
    expect(r.duration).toBe(15);
    expect(r.slots[0]).toBe(`${monday}T04:00:00.000Z`); // 09:30 IST
    expect(r.slots).not.toContain(`${monday}T06:00:00.000Z`); // 11:30 IST break
    expect(r.slots).toContain(`${monday}T11:30:00.000Z`); // 17:00 IST evening shift
  });

  it("returns no slots on Sunday", async () => {
    const r = await slots(nextWeekday(0));
    expect(r.slots).toEqual([]);
    expect(r.reason).toMatch(/not available/i);
  });

  it("prevents double booking under 10 concurrent requests", async () => {
    const startAt = `${monday}T04:30:00.000Z`;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        http().post("/api/appointments").send({ treatmentId: f.general.id, doctorId: f.doctor.id, startAt, consent: true, patient: guest(`Racer ${i}`) }),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(await prisma.appointment.count({ where: { doctorId: f.doctor.id, startAt: new Date(startAt), status: { not: "CANCELLED" } } })).toBe(1);
  });

  it("removes booked + buffered time from availability and rejects overlapping starts", async () => {
    const r = await slots(monday, f.rootCanal.id); // 60 min, doctor buffer 5 min
    // 10:00 IST is booked 10:00–10:15; a 60-min root canal at 09:30 would overlap it.
    expect(r.slots).not.toContain(`${monday}T04:00:00.000Z`);
    const overlap = await http().post("/api/appointments").send({ treatmentId: f.rootCanal.id, doctorId: f.doctor.id, startAt: `${monday}T04:00:00.000Z`, consent: true, patient: guest() });
    expect(overlap.status).toBe(409);
  });

  it("database constraint rejects overlaps even if the app check is bypassed", async () => {
    const a = await prisma.appointment.findFirstOrThrow({ where: { doctorId: f.doctor.id, startAt: new Date(`${monday}T04:30:00.000Z`) } });
    await expect(
      prisma.appointment.create({ data: { reference: "SDC-RAW-1", patientId: a.patientId, doctorId: a.doctorId, treatmentId: a.treatmentId, startAt: new Date(`${monday}T04:35:00.000Z`), endAt: new Date(`${monday}T04:50:00.000Z`) } }),
    ).rejects.toThrow(/appointment_no_overlap|23P01|exclusion/i);
  });

  it("rejects times that are not generated slots (e.g. during break or off-grid)", async () => {
    const r = await http().post("/api/appointments").send({ treatmentId: f.general.id, doctorId: f.doctor.id, startAt: `${monday}T06:05:00.000Z`, consent: true, patient: guest() });
    expect(r.status).toBe(409);
  });

  it("rejects a treatment the doctor does not offer", async () => {
    const implants = await prisma.treatment.findUniqueOrThrow({ where: { slug: "dental-implants" } });
    const r = await http().post("/api/appointments").send({ treatmentId: implants.id, doctorId: f.doctor.id, startAt: `${monday}T05:00:00.000Z`, consent: true, patient: guest() });
    expect(r.status).toBe(400);
  });

  it("blocks slots during doctor leave", async () => {
    await prisma.doctorLeave.create({ data: { doctorId: f.other.id, startDate: new Date(`${tuesday}T00:00:00Z`), endDate: new Date(`${tuesday}T00:00:00Z`), reason: "Conference" } });
    const r = await slots(tuesday, f.general.id, f.other.id);
    expect(r.slots).toEqual([]);
    expect(r.reason).toMatch(/leave/i);
  });

  it("patient books, sees it, reschedules and cancels; slot frees up", async () => {
    const token = await login("patient@smiledental.example");
    const startAt = `${tuesday}T05:00:00.000Z`;
    const b = await http().post("/api/appointments").set(bearer(token)).send({ treatmentId: f.general.id, doctorId: f.doctor.id, startAt });
    expect(b.status).toBe(201);
    expect(b.body.data.reference).toMatch(/^SDC-\d{6}-\d{3}$/);
    expect(b.body.data.status).toBe("PENDING");

    const mine = await http().get("/api/appointments").query({ when: "upcoming" }).set(bearer(token));
    expect(mine.body.data.map((a: { id: string }) => a.id)).toContain(b.body.data.id);

    const newStart = `${tuesday}T05:30:00.000Z`;
    const rs = await http().post(`/api/appointments/${b.body.data.id}/reschedule`).set(bearer(token)).send({ startAt: newStart });
    expect(rs.status).toBe(200);
    expect((await slots(tuesday)).slots).toContain(startAt); // old slot free again

    const c = await http().post(`/api/appointments/${b.body.data.id}/cancel`).set(bearer(token)).send({ reason: "Travelling" });
    expect(c.status).toBe(200);
    expect((await slots(tuesday)).slots).toContain(newStart);
    expect(await prisma.notification.count({ where: { template: "appointment_cancelled", patientId: b.body.data && (await prisma.appointment.findUniqueOrThrow({ where: { id: b.body.data.id } })).patientId } })).toBeGreaterThan(0);
  });

  it("receptionist creates a confirmed walk-in with custom duration and status flows", async () => {
    const token = await login("reception@smiledental.example");
    const startAt = `${tuesday}T12:00:00.000Z`; // 17:30 IST
    const b = await http().post("/api/appointments").set(bearer(token)).send({ treatmentId: f.general.id, doctorId: f.doctor.id, startAt, source: "WALK_IN", durationOverride: 40, patient: guest("Walk In") });
    expect(b.status).toBe(201);
    expect(b.body.data.status).toBe("CONFIRMED");
    expect(new Date(b.body.data.endAt).getTime() - new Date(startAt).getTime()).toBe(40 * 60_000);

    const bad = await http().patch(`/api/appointments/${b.body.data.id}/status`).set(bearer(token)).send({ status: "COMPLETED" });
    expect(bad.status).toBe(409);
    const ok = await http().patch(`/api/appointments/${b.body.data.id}/status`).set(bearer(token)).send({ status: "CHECKED_IN" });
    expect(ok.status).toBe(200);
  });
});

describe("authorization", () => {
  it("requires auth to list appointments", async () => {
    expect((await http().get("/api/appointments")).status).toBe(401);
  });

  it("patients only see their own appointments", async () => {
    const others = await prisma.appointment.findFirstOrThrow({ where: { patient: { userId: null } } });
    const token = await login("patient@smiledental.example");
    expect((await http().get(`/api/appointments/${others.id}`).set(bearer(token))).status).toBe(404);
    const list = await http().get("/api/appointments").set(bearer(token));
    const me = await prisma.patient.findFirstOrThrow({ where: { user: { email: "patient@smiledental.example" } } });
    expect(list.body.data.every((a: { patientId: string }) => a.patientId === me.id)).toBe(true);
  });

  it("patients cannot confirm their own appointment", async () => {
    const token = await login("patient@smiledental.example");
    const mine = await prisma.appointment.findFirst({ where: { patient: { user: { email: "patient@smiledental.example" } } } });
    if (mine) expect((await http().patch(`/api/appointments/${mine.id}/status`).set(bearer(token)).send({ status: "CONFIRMED" })).status).toBe(403);
  });

  it("guests cannot pay online when Razorpay is not configured", async () => {
    const f = await fixtures();
    const r = await http().post("/api/appointments").send({ treatmentId: f.general.id, doctorId: f.doctor.id, startAt: `${nextWeekday(3)}T05:00:00.000Z`, consent: true, paymentMethod: "RAZORPAY", patient: guest() });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("PAYMENTS_DISABLED");
  });
});
