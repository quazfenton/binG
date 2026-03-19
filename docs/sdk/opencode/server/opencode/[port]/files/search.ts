import { defineHandler, getQuery, getRouterParams } from "nitro/h3";
import { getOpencodeClient } from "../../../lib/opencode-client";
import { validatePort } from "../_utils";

export default defineHandler(async (event) => {
  const { port } = getRouterParams(event);
  const { q } = getQuery(event);

  // SECURITY: Validate port to prevent SSRF attacks
  validatePort(Number(port));

  if (!q || typeof q !== "string") {
    return [];
  }

  const client = getOpencodeClient(Number(port));
  const files = await client.find.files({
    query: { query: q },
  });

  return files;
});
