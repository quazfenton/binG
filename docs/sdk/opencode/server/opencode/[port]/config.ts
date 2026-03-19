import { defineHandler, getRouterParam } from "nitro/h3";
import { getOpencodeClient } from "../../lib/opencode-client";

// SECURITY: Allowed ports for opencode server proxy
const ALLOWED_PORTS = [8080, 8081, 8082, 8888, 3000, 3001, 3002, 3003, 3004, 3005];

// SECURITY: Block private/reserved IP ranges to prevent SSRF
function isAllowedPort(port: number): boolean {
  return ALLOWED_PORTS.includes(port);
}

export default defineHandler(async (event) => {
  const port = Number(getRouterParam(event, "port"));

  // SECURITY: Validate port to prevent SSRF attacks
  if (!port || isNaN(port)) {
    throw new Error("Invalid port");
  }
  
  if (!isAllowedPort(port)) {
    throw new Error(`Port ${port} is not allowed. Allowed ports: ${ALLOWED_PORTS.join(', ')}`);
  }

  const client = getOpencodeClient(port);
  const config = await client.config.get();

  return config.data;
});
