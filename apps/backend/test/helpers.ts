import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/db.js";
import { mountModules } from "../src/modules/index.js";
import { addDays, localDate } from "../src/utils/time.js";

export const app = createApp(mountModules);
export const http = () => request(app);
export { prisma };

export async function login(email: string, password = email.startsWith("admin@") ? "Admin@12345" : "Demo@12345") {
  const r = await http().post("/api/auth/login").send({ email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.data.accessToken as string;
}
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Next date (local) that falls on the given weekday (1 = Monday), at least `minDaysAhead` away. */
export function nextWeekday(weekday: number, minDaysAhead = 2) {
  let d = addDays(localDate(new Date(), "Asia/Kolkata"), minDaysAhead);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== weekday) d = addDays(d, 1);
  return d;
}

export async function fixtures() {
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { slug: "dr-arjun-mehta" } });
  const other = await prisma.doctor.findUniqueOrThrow({ where: { slug: "dr-rohan-kapoor" } });
  const general = await prisma.treatment.findUniqueOrThrow({ where: { slug: "general-dentistry" } });
  const rootCanal = await prisma.treatment.findUniqueOrThrow({ where: { slug: "root-canal-treatment" } });
  return { doctor, other, general, rootCanal };
}

let phoneSeq = 0;
export const guest = (name = "Test Guest") => ({ fullName: name, phone: `9${String(100000000 + ++phoneSeq * 7919).slice(0, 9)}`, email: "" });
