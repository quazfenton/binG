import { defineHandler, getRouterParam } from "nitro/h3";
import { getOpencodeClient } from "../../../lib/opencode-client";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { validatePort } from "../_utils";

const execAsync = promisify(exec);

export default defineHandler(async (event) => {
  const port = Number(getRouterParam(event, "port"));

  // SECURITY: Validate port to prevent SSRF attacks
  validatePort(port);

  const client = getOpencodeClient(port);
  const project = await client.project.current();

  if (!project.data?.worktree) {
    throw new Error("No project worktree found");
  }

  const worktree = project.data.worktree;

  try {
    const { stdout } = await execAsync("git diff HEAD", {
      cwd: worktree,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      diff: stdout,
      worktree,
    };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new Error(err.stderr || err.message || "Failed to get git diff");
  }
});
