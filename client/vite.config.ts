import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_CLIENT_PORT = 5173;
const DEFAULT_GATEWAY_PORT = 3001;

function parsePort(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return port;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, PROJECT_ROOT, "");
  const clientPort = parsePort(env.CLIENT_PORT, DEFAULT_CLIENT_PORT, "CLIENT_PORT");
  const gatewayPort = parsePort(env.GATEWAY_PORT, DEFAULT_GATEWAY_PORT, "GATEWAY_PORT");

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_GATEWAY_PORT": JSON.stringify(String(gatewayPort)),
    },
    server: {
      host: "127.0.0.1",
      port: clientPort,
    },
  };
});
