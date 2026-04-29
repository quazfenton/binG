/**
 * agenticProjectLoop.ts
 *
 * A drop-in "Deep Project Mode" for your existing TypeScript LLM loop.
 * Enables multi-iteration, file-aware, self-stopping project builds.
 *
 * USAGE:
 *   const result = await runAgenticProjectLoop({
 *     userPrompt: "Build a full REST API with auth, CRUD, and tests",
 *     projectRoot: "./my-project",
 *     llmCall: yourExistingLLMFunction,
 *     config: { maxIterations: 20, insertDiffs: true }
 *   });
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Your existing LLM call signature. Swap in Anthropic SDK, OpenAI, etc.
 */
export type LLMCallFn = (messages: LLMMessage[]) => Promise<string>;

export interface AgenticLoopConfig {
  /** Maximum iterations before force-stopping (safety net). Default: 25 */
  maxIterations?: number;
  /**
   * "diff"  — inject last-iteration git-style diffs as context (precise, token-efficient)
   * "read"  — tell the LLM which files to read (it reads them via tool calls / inline)
   * "tree"  — project tree only (lightest, best for massive repos)
   * Default: "diff"
   */
  contextMode?: "diff" | "read" | "tree";
  /** File extensions to include in tree/diff scanning. Default: common code exts */
  includeExtensions?: string[];
  /** Paths/globs to exclude. Default: node_modules, .git, dist, build */
  excludePaths?: string[];
  /** Max file size (bytes) to inline as diff/content. Default: 50_000 */
  maxInlineFileSize?: number;
  /** Print iteration progress to stdout. Default: true */
  verbose?: boolean;
  /** The exact token/string the LLM must emit to signal completion */
  completionToken?: string;
}

export interface AgenticLoopResult {
  completed: boolean;
  iterations: number;
  finalResponse: string;
  allResponses: string[];
  projectTree: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_COMPLETION_TOKEN = "<<PROJECT_COMPLETE>>";

const DEFAULT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cs", ".cpp", ".c", ".h",
  ".json", ".yaml", ".yml", ".toml", ".env.example",
  ".md", ".sql", ".sh", ".bash", ".zsh",
  ".html", ".css", ".scss", ".sass",
  "Dockerfile", "Makefile", ".gitignore",
];

const DEFAULT_EXCLUDE = [
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", "__pycache__", ".pytest_cache", "target", "vendor",
  ".turbo", ".vercel", ".output", "*.min.js", "*.min.css",
];

// ─── File System Utilities ────────────────────────────────────────────────────

function shouldExclude(filePath: string, excludePaths: string[]): boolean {
  const parts = filePath.split(path.sep);
  return excludePaths.some((ex) =>
    parts.some((p) => p === ex || p.startsWith(ex))
  );
}

function shouldInclude(filePath: string, extensions: string[]): boolean {
  const base = path.basename(filePath);
  return extensions.some((ext) =>
    ext.startsWith(".") ? filePath.endsWith(ext) : base === ext
  );
}

/**
 * Builds a tree-style string of the project structure.
 */
export function buildProjectTree(
  dir: string,
  excludePaths: string[] = DEFAULT_EXCLUDE,
  extensions: string[] = DEFAULT_EXTENSIONS,
  prefix = "",
  depth = 0,
  maxDepth = 8
): string {
  if (depth > maxDepth) return "";
  if (!fs.existsSync(dir)) return "(project root does not exist yet)";

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(process.cwd(), fullPath);

    if (shouldExclude(relPath, excludePaths)) continue;

    if (entry.isDirectory()) {
      lines.push(`${prefix}📁 ${entry.name}/`);
      lines.push(
        buildProjectTree(fullPath, excludePaths, extensions, prefix + "  ", depth + 1, maxDepth)
      );
    } else if (shouldInclude(entry.name, extensions)) {
      const size = fs.statSync(fullPath).size;
      lines.push(`${prefix}📄 ${entry.name} (${formatBytes(size)})`);
    }
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Returns a list of all tracked file paths in the project.
 */
function collectFiles(
  dir: string,
  excludePaths: string[],
  extensions: string[]
): string[] {
  if (!fs.existsExists(dir)) return [];
  const results: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (shouldExclude(rel, excludePaths)) continue;
      if (entry.isDirectory()) walk(full);
      else if (shouldInclude(entry.name, extensions)) results.push(full);
    }
  }

  walk(dir);
  return results;
}

// ─── Diff / Content Utilities ─────────────────────────────────────────────────

interface FileSnapshot {
  [filePath: string]: string;
}

/**
 * Snapshot all project files (content hash map).
 */
function snapshotFiles(
  dir: string,
  excludePaths: string[],
  extensions: string[],
  maxSize: number
): FileSnapshot {
  const files = collectFiles(dir, excludePaths, extensions);
  const snap: FileSnapshot = {};
  for (const f of files) {
    if (fs.statSync(f).size <= maxSize) {
      snap[f] = fs.readFileSync(f, "utf-8");
    }
  }
  return snap;
}

/**
 * Produces a unified-diff-style string between two snapshots.
 */
function buildDiffContext(before: FileSnapshot, after: FileSnapshot): string {
  const sections: string[] = [];

  // New or modified files
  for (const [fp, content] of Object.entries(after)) {
    if (!(fp in before)) {
      sections.push(`### NEW FILE: ${fp}\n\`\`\`\n${content}\n\`\`\``);
    } else if (before[fp] !== content) {
      const diff = simpleDiff(before[fp], content);
      sections.push(`### MODIFIED: ${fp}\n\`\`\`diff\n${diff}\n\`\`\``);
    }
  }

  // Deleted files
  for (const fp of Object.keys(before)) {
    if (!(fp in after)) {
      sections.push(`### DELETED: ${fp}`);
    }
  }

  return sections.length
    ? sections.join("\n\n")
    : "(no file changes detected in last iteration)";
}

/**
 * Minimal line-level diff (added/removed lines).
 */
function simpleDiff(before: string, after: string): string {
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  const out: string[] = [];

  const maxLen = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = bLines[i];
    const a = aLines[i];
    if (b === undefined) out.push(`+ ${a}`);
    else if (a === undefined) out.push(`- ${b}`);
    else if (b !== a) {
      out.push(`- ${b}`);
      out.push(`+ ${a}`);
    }
  }

  return out.slice(0, 300).join("\n"); // cap at 300 diff lines
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Prompt Construction ──────────────────────────────────────────────────────

function buildSystemPrompt(
  userPrompt: string,
  completionToken: string,
  config: Required<AgenticLoopConfig>
): string {
  return `You are an expert software engineer working on a long-running project build.

## YOUR MISSION
Complete the following project fully and to the highest standard:

<user_request>
${userPrompt}
</user_request>

## HOW THIS LOOP WORKS
- You are called in **iterations**. Each call you will receive the current project state.
- Each response should implement the **next concrete step** toward completing the project.
- Write actual code. Create files. Build incrementally but meaningfully per iteration.
- Do NOT repeat work already done. Do NOT re-explain prior steps. Move forward.

## CONTEXT YOU WILL RECEIVE
Each iteration you will receive:
1. The current **project file tree**
2. ${
    config.contextMode === "diff"
      ? "A **diff of changes** from the last iteration (new/modified files)"
      : config.contextMode === "read"
      ? "A **list of key files** you should review before continuing"
      : "The project tree only (use your judgment on what to build next)"
  }

## COMPLETION SIGNAL — CRITICAL
When you have **fully completed** the entire user request — every feature, file, edge case, test, and piece of documentation requested — you MUST:

1. Confirm completion with a short summary of everything built
2. End your response with this **exact token on its own line**:

${completionToken}

Do NOT emit ${completionToken} until the project is genuinely 100% complete.
Do NOT emit it at the end of every response — only the final one.
If there is still work to do, do NOT emit it — just continue building.`;
}

function buildIterationUserMessage(
  iteration: number,
  projectTree: string,
  lastDiffOrFiles: string,
  contextMode: "diff" | "read" | "tree",
  lastResponse: string | null
): string {
  const parts: string[] = [
    `## Iteration ${iteration}`,
    "",
    "### Current Project Tree",
    "```",
    projectTree || "(empty — project root exists but no files yet)",
    "```",
  ];

  if (lastResponse && contextMode !== "tree") {
    parts.push("", "### Last Iteration Summary (your previous response excerpt)");
    parts.push(lastResponse.slice(-1200)); // last ~1200 chars of prior response
  }

  if (contextMode === "diff" && lastDiffOrFiles) {
    parts.push("", "### Changes from Last Iteration");
    parts.push(lastDiffOrFiles);
  } else if (contextMode === "read" && lastDiffOrFiles) {
    parts.push("", "### Files to Review Before Continuing");
    parts.push(lastDiffOrFiles);
  }

  parts.push("", "---");
  parts.push("Continue building. Implement the next step. Write real code.");

  return parts.join("\n");
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

/**
 * Run the agentic project loop.
 */
export async function runAgenticProjectLoop(options: {
  userPrompt: string;
  projectRoot: string;
  llmCall: LLMCallFn;
  config?: AgenticLoopConfig;
}): Promise<AgenticLoopResult> {
  const { userPrompt, projectRoot, llmCall } = options;

  // Merge config with defaults
  const config: Required<AgenticLoopConfig> = {
    maxIterations: 25,
    contextMode: "diff",
    includeExtensions: DEFAULT_EXTENSIONS,
    excludePaths: DEFAULT_EXCLUDE,
    maxInlineFileSize: 50_000,
    verbose: true,
    completionToken: DEFAULT_COMPLETION_TOKEN,
    ...options.config,
  };

  const log = (...args: unknown[]) => config.verbose && console.log("[AgenticLoop]", ...args);

  // Ensure project root exists
  if (!fs.existsSync(projectRoot)) {
    fs.mkdirSync(projectRoot, { recursive: true });
    log(`Created project root: ${projectRoot}`);
  }

  const completionToken = config.completionToken;
  const allResponses: string[] = [];
  let lastSnapshot: FileSnapshot = {};
  let lastResponse: string | null = null;
  let completed = false;

  const systemPrompt = buildSystemPrompt(userPrompt, completionToken, config);

  // Conversation history (grows each iteration for full context)
  const conversationHistory: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    log(`\n${"─".repeat(60)}`);
    log(`Starting iteration ${iteration}/${config.maxIterations}`);

    // 1. Build project tree
    const projectTree = buildProjectTree(
      projectRoot,
      config.excludePaths,
      config.includeExtensions
    );

    // 2. Build context (diff or file list)
    let contextPayload = "";

    if (config.contextMode === "diff") {
      const currentSnapshot = snapshotFiles(
        projectRoot,
        config.excludePaths,
        config.includeExtensions,
        config.maxInlineFileSize
      );
      contextPayload = buildDiffContext(lastSnapshot, currentSnapshot);
      lastSnapshot = currentSnapshot;
      log(`Diff context: ${contextPayload.length} chars`);
    } else if (config.contextMode === "read") {
      const files = collectFiles(
        projectRoot,
        config.excludePaths,
        config.includeExtensions
      );
      // For "read" mode: inline small files, list large ones
      const sections: string[] = [];
      for (const f of files) {
        const size = fs.statSync(f).size;
        const rel = path.relative(projectRoot, f);
        if (size <= config.maxInlineFileSize) {
          const content = fs.readFileSync(f, "utf-8");
          sections.push(`### ${rel}\n\`\`\`\n${content}\n\`\`\``);
        } else {
          sections.push(`### ${rel} (${formatBytes(size)} — too large to inline, review manually)`);
        }
      }
      contextPayload = sections.join("\n\n") || "(no files yet)";
      log(`Read context: ${files.length} files, ${contextPayload.length} chars`);
    }

    // 3. Build user message for this iteration
    const userMessage = buildIterationUserMessage(
      iteration,
      projectTree,
      contextPayload,
      config.contextMode,
      lastResponse
    );

    conversationHistory.push({ role: "user", content: userMessage });

    log(`Calling LLM (history: ${conversationHistory.length} messages)...`);

    // 4. Call LLM
    const response = await llmCall(conversationHistory);
    allResponses.push(response);
    lastResponse = response;

    log(`Response received (${response.length} chars)`);
    if (config.verbose) {
      console.log("\n" + "─".repeat(40));
      console.log(response.slice(0, 500) + (response.length > 500 ? "\n...(truncated)" : ""));
      console.log("─".repeat(40) + "\n");
    }

    // Add assistant response to history
    conversationHistory.push({ role: "assistant", content: response });

    // 5. Check for completion token
    const trimmedResponse = response.trimEnd();
    if (
      trimmedResponse.endsWith(completionToken) ||
      trimmedResponse.includes(`\n${completionToken}`) ||
      trimmedResponse.includes(`\r\n${completionToken}`)
    ) {
      log(`✅ Completion token detected at iteration ${iteration}!`);
      completed = true;
      break;
    }

    log(`No completion token yet. Continuing to iteration ${iteration + 1}...`);
  }

  if (!completed) {
    log(`⚠️  Max iterations (${config.maxIterations}) reached without completion token.`);
  }

  const finalTree = buildProjectTree(
    projectRoot,
    config.excludePaths,
    config.includeExtensions
  );

  return {
    completed,
    iterations: allResponses.length,
    finalResponse: allResponses[allResponses.length - 1] ?? "",
    allResponses,
    projectTree: finalTree,
  };
}

// ─── Config Toggle Helper ─────────────────────────────────────────────────────

/**
 * Preset configs for common use cases. Mix into your AgenticLoopConfig.
 */
export const AgenticPresets = {
  /** Large codebases — minimal token usage, tree + diffs only */
  large: {
    contextMode: "diff" as const,
    maxIterations: 30,
    maxInlineFileSize: 20_000,
  },
  /** Small/medium projects — full file reading for max accuracy */
  thorough: {
    contextMode: "read" as const,
    maxIterations: 15,
    maxInlineFileSize: 80_000,
  },
  /** Ultra-light — just the tree, LLM infers what to build */
  fast: {
    contextMode: "tree" as const,
    maxIterations: 10,
  },
};

// ─── Example Integration ──────────────────────────────────────────────────────

/*
ORIGINAL EXAMPLE (above) — see IMPLEMENTED VERSION below for actual codebase usage.

The implemented version is at: /root/bing/web/lib/chat/progressive-build-engine.ts

// ─── IMPLEMENTED USAGE EXAMPLES ──────────────────────────────────────────────

import { runProgressiveBuild, BuildPresets, detectBuildComplete } from '@/lib/chat/progressive-build-engine';

// Example 1: Thorough build with reflection (medium project)
const result = await runProgressiveBuild({
  userId: 'user-123',
  userPrompt: 'Build a REST API with auth, CRUD, and tests',
  llmCall: myExistingLLMFunction,
  config: { ...BuildPresets.thorough, verbose: true },
  emit: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  abortSignal: req.signal,
});

// Example 2: Fast mode — tree only, no reflection
const fastResult = await runProgressiveBuild({
  userId: 'user-123',
  userPrompt: 'Create a simple todo app',
  llmCall: myLLMFunction,
  config: BuildPresets.fast,
});

// Example 3: Custom reflection with cheap model
const customResult = await runProgressiveBuild({
  userId: 'user-123',
  userPrompt: 'Build a CLI tool...',
  llmCall: expensiveLLM,
  config: { ...BuildPresets.balanced, enableReflection: true },
  reflectionFn: async (llmCall, prompt, tree, response) => {
    const cheap = await cheapLLM([{ role: 'user', content: `Gaps in: ${prompt}\nTree: ${tree}\nOutput: ${response.slice(-1000)}` }]);
    return { summary: cheap, gapsIdentified: ['parse from response'], score: 60 };
  },
});

// Manual completion check:
const { complete, reason } = detectBuildComplete(responseText);
*/
