import { defineConfig, devices } from "@playwright/test";

// Explicit opt-in: this suite always targets the real production origin.
export default defineConfig({
  testDir: "./e2e/deployed",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Pixel 7"], browserName: "chromium", channel: "chrome",
    baseURL: "https://treino-local.vercel.app/",
    trace: "off", screenshot: "off", video: "off",
  },
});
