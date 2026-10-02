import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 2,
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "Pixel 7 Chrome", use: { ...devices["Pixel 7"], browserName: "chromium", channel: "chrome" } },
    { name: "iPhone 13 emulated Chrome", use: { ...devices["iPhone 13"], browserName: "chromium", channel: "chrome" } },
  ],
});
