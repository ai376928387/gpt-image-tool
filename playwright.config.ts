import "dotenv/config";
import { defineConfig } from "@playwright/test";

const clientPort = Number(process.env.CLIENT_PORT || 5173);
const gatewayPort = Number(process.env.GATEWAY_PORT || 3001);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: {
    timeout: 120_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:gateway",
      port: gatewayPort,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "npm run dev:client",
      port: clientPort,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
