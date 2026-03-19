import { defineHandler, getRouterParam } from "nitro/h3";
import { getOpencodeClient } from "../../lib/opencode-client";
import { validatePort } from "./_utils";

export default defineHandler(async (event) => {
  const port = Number(getRouterParam(event, "port"));

  // SECURITY: Validate port to prevent SSRF attacks
  validatePort(port);

  const client = getOpencodeClient(port);
  const agents = await client.app.agents();

  return agents.data;
});
