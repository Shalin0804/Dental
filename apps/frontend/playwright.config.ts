import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the dev servers (API on :4000 with SEED_DEMO data, web on :5173).
 * `npm run e2e` starts both if they are not already running.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : [
    { command: "npm run dev -w @sdc/backend", cwd: "../..", url: "http://localhost:4000/api/health", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true, timeout: 120_000 },
  ],
});
