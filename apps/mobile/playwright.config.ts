// End-to-end tests (e2e/*.spec.ts): the real web app in a real browser, at phone and desktop size.
// The app is built offline (no account, no sync) and served on its own port by e2e/serve.mjs; each test
// starts with an empty browser, so nothing here can touch anyone's data.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8090);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 5"] } },
    { name: "desktop", use: { viewport: { width: 1400, height: 900 } } },
  ],
  webServer: { command: "node e2e/serve.mjs", url: `http://127.0.0.1:${port}`, timeout: 300_000, reuseExistingServer: !process.env.CI },
});
