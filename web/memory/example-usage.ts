/**
 * example-usage.ts — End-to-end wiring example
 *
 * Shows how to set up the Orchestrator in a real Next.js app.
 * Drop this into a React component, a server action, or an API route.
 */

import {
  Orchestrator,
  isDesktop,
  readDirectory,
  watchDirectory,
  trace,
  getMetricsSummary,
  createGitPlugin,
  createLintPlugin,
  PluginRegistry,
  type AgentResult,
  type PatchResult,
} from "./index";

// ─── 1. Wire up the Orchestrator ──────────────────────────────────────────────

async function createOrchestrator(projectPath: string): Promise<Orchestrator> {
  const orch = await Orchestrator.fromPath(projectPath, {
    projectName: "my-app",

    // LLM: swap this for your actual provider
    // Works with Anthropic, OpenAI, Vercel AI SDK, etc.
    llm: async (userPrompt, systemPrompt) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt, systemPrompt }),
      });
      const data = await res.json();
      return data.content;
    },

    // Streaming LLM (optional — for real-time UI)
    streamLLM: async function* (userPrompt, systemPrompt) {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt, systemPrompt }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value);
      }
    },

    // Diff applier — integrate with your existing diff engine
    applyDiff: async (original, diff): Promise<PatchResult> => {
      // Call your diff engine here (e.g. /api/apply-diff)
      // This is a placeholder — swap with real implementation
      const res = await fetch("/api/apply-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original, diff }),
      });
      return res.json();
    },

    // Write file — platform-aware
    writeFile: async (path, content) => {
      if (isDesktop) {
        const { writeTextFile } = await import("@tauri-apps/api/fs");
        await writeTextFile(path, content);
      } else {
        // Web: POST to your file API or trigger download
        await fetch("/api/files", {
          method: "PUT",
          body: JSON.stringify({ path, content }),
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });

  return orch;
}

// ─── 2. Index a project ───────────────────────────────────────────────────────

async function indexProject(orch: Orchestrator, projectPath: string) {
  let files: Array<{ path: string; content: string }>;

  if (isDesktop) {
    // Desktop: read real filesystem
    const entries = await readDirectory(projectPath, ["ts", "tsx", "js", "jsx"]);
    files = entries.map((e) => ({ path: e.path, content: e.content }));
  } else {
    // Web: use files from upload or in-memory workspace
    files = []; // populate from your file store
  }

  const results = await trace("index-project", () =>
    orch.indexFiles(files, {
      onProgress: (done, total, current) => {
        console.log(`Indexing: ${done}/${total} — ${current}`);
      },
      recomputePageRank: true,
    })
  );

  const indexed = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`✅ Indexed ${indexed} files, skipped ${skipped} unchanged`);
}

// ─── 3. Watch for changes (desktop only) ─────────────────────────────────────

async function startWatcher(orch: Orchestrator, projectPath: string) {
  const stopWatching = await watchDirectory(projectPath, async (event) => {
    if (event.type === "deleted") return;

    console.log(`File changed: ${event.path}`);

    if (isDesktop) {
      const { readTextFile } = await import("@tauri-apps/api/fs");
      const content = await readTextFile(event.path);
      await orch.indexFile(event.path, content);
    }
  });

  return stopWatching;
}

// ─── 4. Q&A example ──────────────────────────────────────────────────────────

async function askQuestion(orch: Orchestrator, question: string): Promise<string> {
  return trace("ask", () => orch.ask(question));
}

// ─── 5. Edit a file with self-correcting agent ────────────────────────────────

async function editFileExample(
  orch: Orchestrator,
  filePath: string,
  fileContent: string
): Promise<AgentResult> {
  return trace("edit-file", () =>
    orch.editFile({
      path: filePath,
      content: fileContent,
      task: "Add input validation to all function parameters. Use Zod schemas.",
      maxIterations: 5,
      onIteration: (info) => {
        console.log(`  Iteration ${info.iteration}: ${info.status}`, info.error ?? "");
      },
    })
  );
}

// ─── 6. Multi-tab setup ───────────────────────────────────────────────────────

function setupTabs(orch: Orchestrator) {
  // Switch context when user switches tabs
  orch.setActiveTab("tab-auth");
  orch.setOpenFiles(["src/hooks/useAuth.ts", "src/pages/login.tsx"]);

  // Later, switch to payment tab
  orch.setActiveTab("tab-payments");
  orch.setOpenFiles(["src/hooks/usePayment.ts", "src/pages/checkout.tsx"]);
}

// ─── 7. Plugin setup ─────────────────────────────────────────────────────────

async function setupPlugins(projectId: string, projectPath: string) {
  const registry = new PluginRegistry({
    projectId,
    projectPath,
    exec: isDesktop
      ? async (cmd) => {
          const { Command } = await import("@tauri-apps/api/shell");
          const output = await Command.create("sh", ["-c", cmd]).execute();
          return {
            stdout: output.stdout,
            stderr: output.stderr,
            exitCode: output.code ?? 0,
          };
        }
      : undefined,
    emit: (event, payload) => {
      console.log(`[plugin event] ${event}`, payload);
    },
  });

  await registry.register(createGitPlugin());
  await registry.register(createLintPlugin());

  // Use plugin commands
  const status = await registry.run<{ stdout: string }>("git.status");
  console.log("Git status:", status.stdout);

  return registry;
}

// ─── 8. Metrics ───────────────────────────────────────────────────────────────

function printMetrics() {
  const summary = getMetricsSummary();
  console.table(summary.traces);
  console.log("Counters:", summary.counters);
}

// ─── Main: wire it all up ─────────────────────────────────────────────────────

export async function runExample() {
  const projectPath = "/Users/you/code/my-app";

  // 1. Create orchestrator
  const orch = await createOrchestrator(projectPath);

  // 2. Index project
  await indexProject(orch, projectPath);

  // 3. Start file watcher (desktop only)
  const stopWatching = await startWatcher(orch, projectPath);

  // 4. Set up tabs
  setupTabs(orch);

  // 5. Ask a question
  const answer = await askQuestion(orch, "How does authentication work in this codebase?");
  console.log("Answer:", answer);

  // 6. Edit a file
  const fileContent = `export function createUser(name, email) {
  return db.insert({ name, email });
}`;

  const result = await editFileExample(orch, "src/users.ts", fileContent);
  if (result.success) {
    console.log(`✅ Edit succeeded in ${result.iterations} iteration(s)`);
    console.log(result.content);
  } else {
    console.log(`❌ Edit failed: ${result.error}`);
  }

  // 7. Print metrics
  printMetrics();

  // 8. Cleanup
  stopWatching();
}
