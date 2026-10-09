import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_NOW, E2E_PORT } from "./tests/e2e/env";

/**
 * E2E do Clarity: sobe um next dev próprio (porta 3300, .next-e2e) com o relógio fixo em 08/10/2026
 * e o banco clarity_e2e, que o globalSetup cria, migra e popula. Login pelo cookie de teste.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    navigationTimeout: 60_000,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" },
  },
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    // Arquivo estático: não depende do banco, que o globalSetup prepara depois de o servidor subir.
    url: `http://localhost:${E2E_PORT}/favicon.ico`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      CLARITY_NOW: E2E_NOW,
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_MODE: "dev",
      ODOO_MODE: "fake",
      NOTIFY_MODE: "dry-run",
      CRON_SECRET: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
