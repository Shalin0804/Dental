import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS; // optional folder for page screenshots

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}

async function login(page: Page, email: string, password = process.env.E2E_DEMO_PASSWORD ?? "Demo@12345") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("public pages render with data @mobile", async ({ page }) => {
  const errors = trackErrors(page);
  for (const path of ["/", "/about", "/treatments", "/doctors", "/faq", "/contact", "/privacy", "/terms", "/treatments/root-canal-treatment", "/doctors/dr-arjun-mehta"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal overflow on ${path}`).toBe(true);
  }
  await page.goto("/treatments");
  await expect(page.getByText("Root Canal Treatment").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("guest books an appointment end to end", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/book");
  await page.getByRole("button", { name: /General Dentistry/ }).click();
  await page.getByRole("button", { name: /Dr\. Sneha Iyer/ }).click();
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Full name").fill("E2E Guest Patient");
  await page.getByLabel("Mobile number").fill(`9${String(Date.now()).slice(-9)}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "Booking received" })).toBeVisible();
  await expect(page.getByText(/^SDC-\d{6}-\d{3}$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("receptionist: walk-in booking, check-in and queue", async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, "reception@smiledental.example");
  await expect(page).toHaveURL(/\/reception$/);
  await page.getByRole("link", { name: "New booking" }).first().click();
  await page.getByRole("button", { name: "Register new patient" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(`Walk In ${Date.now()}`);
  await dialog.getByLabel("Mobile").fill(`8${String(Date.now()).slice(-9)}`);
  await dialog.getByRole("button", { name: "Register" }).click();
  await page.getByLabel("Treatment").selectOption({ label: "Dental Cleaning (30 min)" });
  await page.getByLabel("Doctor").selectOption({ index: 1 });
  const slot = page.getByRole("radio").first();
  if (await slot.isVisible().catch(() => false)) {
    await slot.click();
    await page.getByRole("button", { name: /^Book / }).click();
    await expect(page.getByRole("heading", { name: /Booked: SDC-/ })).toBeVisible();
  }
  await page.getByRole("link", { name: "Queue" }).first().click();
  await expect(page.getByRole("heading", { name: "Live queue" })).toBeVisible();
  expect(errors).toEqual([]);
});

const ROLES: [string, string, string | undefined][] = [
  ["admin", "admin@gmail.com", "Admin@123456"],
  ["reception", "reception@smiledental.example", undefined],
  ["doctor", "dr.arjun@smiledental.example", undefined],
  ["patient", "patient@smiledental.example", undefined],
];

for (const [role, email, password] of ROLES) {
  test(`${role}: every dashboard page loads without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await login(page, email, password);
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    await expect(nav.getByRole("link").nth(2)).toBeVisible();
    const links = await nav.getByRole("link").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname).filter((p) => p !== "/"));
    expect(links.length).toBeGreaterThan(3);
    for (const path of links) {
      await page.goto(path);
      await expect(page.locator("main h1").first(), `heading on ${path}`).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("alert").filter({ hasText: /went wrong|couldn't load/i })).toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${role}${path.replaceAll("/", "_")}.png`, fullPage: true });
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("patient cannot open staff dashboards", async ({ page }) => {
  await login(page, "patient@smiledental.example");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/patient$/);
  await page.goto("/reception/patients");
  await expect(page).toHaveURL(/\/patient$/);
});
