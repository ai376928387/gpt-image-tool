import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: {
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:gateway",
      port: 3001,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "npm run dev:client",
      port: 5173,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
