/**
 * app/api/cli-install/route.ts
 *
 * POST /api/cli-install
 *
 * Executes an `npx <baseCmd> <subCmd> [...args]` command in the user's project
 * directory and streams stdout/stderr back as Server-Sent Events (SSE).
 *
 * Request body:
 *   {
 *     baseCmd:     string,   // e.g. "@heroui/cli"
 *     subCmd:      string,   // e.g. "add"
 *     args:        string[], // e.g. ["button", "--variant", "outline", "--yes"]
 *     projectPath: string,   // absolute path on the server, e.g. "/srv/myapp"
 *   }
 *
 * SSE events:
 *   data: { "line": "..." }              — stdout/stderr text line
 *   data: { "done": true, "code": 0 }    — process exited
 *
 * Security:
 *   - ALLOWED_CMDS allowlist: only whitelisted base commands may run.
 *   - ALLOWED_PATHS prefix check: only paths under PROJECT_ROOT may be targeted.
 *   - All args are passed as an array to spawn() — no shell interpolation.
 *   - Requires VISUAL_EDITOR_SECRET header to match env var (set to "" to disable).
 *
 * To enable in production set these env vars:
 *   VISUAL_EDITOR_SECRET=<secret>   (bearer token the client must send)
 *   PROJECT_ROOT=/srv               (only paths under this prefix are allowed)
 *   CLI_TIMEOUT_MS=120000           (kill process after N ms, default 2 min)
 */

import { spawn } from "child_process";
import path from "path";
import { NextRequest } from "next/server";

// ── Config ────────────────────────────────────────────────────────────────────

const SECRET = process.env.VISUAL_EDITOR_SECRET ?? "";
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const CLI_TIMEOUT = Number(process.env.CLI_TIMEOUT_MS ?? 120_000);

/** Only these npx package names may be executed. Add more as needed. */
const ALLOWED_CMDS = new Set([
  "@heroui/cli",
  "shadcn@latest",
  "shadcn",
  "magicui-cli",
  "@mantine/cli",
  "@chakra-ui/cli",
  "chakra-cli",
  "storybook@latest",
  "@storybook/cli",
  "tailwindcss",
  "daisyui",
  "@mui/cli",
  "plop",
  "hygen",
  "svelte-add@latest",
  "astro",
  "@heroui/cli@latest",
  "shadcn-ui@latest",
]);

/** Validate an absolute path is under PROJECT_ROOT. */
function isSafePath(p: string): boolean {
  const resolved = path.resolve(p);
  const root = path.resolve(PROJECT_ROOT);
  return resolved.startsWith(root + path.sep) || resolved === root;
}

/** Send a single SSE event string. */
function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (SECRET) {
    const auth = req.headers.get("x-visual-editor-secret") ?? "";
    if (auth !== SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { baseCmd?: string; subCmd?: string; args?: string[]; projectPath?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { baseCmd, subCmd, args = [], projectPath = PROJECT_ROOT } = body;

  if (!baseCmd || !subCmd) {
    return new Response("Missing baseCmd or subCmd", { status: 400 });
  }

  // ── Allowlist check ───────────────────────────────────────────────────────
  if (!ALLOWED_CMDS.has(baseCmd)) {
    return new Response(`Command not allowed: ${baseCmd}`, { status: 403 });
  }

  // ── Path safety ───────────────────────────────────────────────────────────
  if (!isSafePath(projectPath)) {
    return new Response(`Path not allowed: ${projectPath}`, { status: 403 });
  }

  // ── Sanitize args (no shell metacharacters) ───────────────────────────────
  const sanitizedArgs = args.map(String).filter((a) => !/[;&|`$]/.test(a));

  // ── Stream via SSE ────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(data)));
        } catch {
          // Controller may already be closed
        }
      };

      // Spawn: npx <baseCmd> <subCmd> [...args]
      const child = spawn("npx", [baseCmd, subCmd, ...sanitizedArgs], {
        cwd: path.resolve(projectPath),
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
      });

      // Timeout watchdog
      const watchdog = setTimeout(() => {
        enqueue({ line: "⚠ Timeout — killing process" });
        child.kill("SIGTERM");
      }, CLI_TIMEOUT);

      const flush = (chunk: Buffer, source: "stdout" | "stderr") => {
        const text = chunk.toString("utf8");
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (line) enqueue({ line });
        }
      };

      child.stdout.on("data", (d) => flush(d, "stdout"));
      child.stderr.on("data", (d) => flush(d, "stderr"));

      child.on("error", (err) => {
        enqueue({ line: `✗ Spawn error: ${err.message}` });
        enqueue({ done: true, code: 1 });
        clearTimeout(watchdog);
        controller.close();
      });

      child.on("close", (code) => {
        enqueue({ done: true, code: code ?? 1 });
        clearTimeout(watchdog);
        controller.close();
      });

      // Clean up if client disconnects
      req.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        clearTimeout(watchdog);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx buffering
    },
  });
}
