import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: "./output/playwright/results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 0.0.0.0 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 180_000
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    },
    {
      name: "ipad-landscape",
      use: { ...devices["iPad Pro 11 landscape"], browserName: "webkit" }
    },
    {
      name: "android-portrait",
      use: { ...devices["Pixel 7"] }
    },
    {
      name: "android-landscape",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 915, height: 412 }
      }
    }
  ]
});
