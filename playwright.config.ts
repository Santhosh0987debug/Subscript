import { defineConfig, devices } from "@playwright/test";

const apiUrl = process.env.E2E_API_URL ?? "http://localhost:4000";
const webUrl = process.env.E2E_WEB_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // Run the compiled server so E2E exercises the production startup path
      // (env validation, request timeouts, memory-store fallback) instead of a
      // file watcher.
      command:
        "npm run build -w @subscript/shared && npm run build -w @subscript/server && npm run start -w @subscript/server",
      url: `${apiUrl}/api/health`,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "test",
        PORT: new URL(apiUrl).port || "4000",
        CORS_ORIGINS: webUrl,
        LOG_REQUESTS: "false",
        BCRYPT_COST: "10",
      },
    },
    {
      command:
        "npm run build -w @subscript/shared && npm run build -w @subscript/web && npm run preview -w @subscript/web -- --host localhost --port 4173 --strictPort",
      url: webUrl,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_URL: apiUrl,
      },
    },
  ],
});
