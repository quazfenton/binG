/**
 * validated-agent-loop.ts — Agent loop with plugin-based validation and automatic rollback
 *
 * Wraps runAgentLoop with pre/post-validation using the plugin system.
 * On validation failure, automatically rolls back to the last known-good state.
 *
 * Plugin chain:
 *   Pre-edit:  lint check (ESLint), type check (tsc)
 *   Post-edit: lint check, type check, git diff review
 *   On failure: rollback to original content
 *
 * This ensures edits don't break the build before they're committed.
 */

import {
  runAgentLoop,
  defaultValidate,
  type AgentLoopOptions,
  type AgentResult,
  type PatchResult,
} from "../agent/agentLoop";
import {
  PluginRegistry,
  createLintPlugin,
  createTscPlugin,
  createLspTsPlugin,
  type PluginContext,
} from "../agent/plugins";
import { trace, increment } from "../agent/metrics";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("ValidatedAgentLoop");

export interface ValidatedAgentLoopOptions extends Omit<AgentLoopOptions, "validate"> {
  /** Enable lint validation (default: true if exec available) */
  enableLint?: boolean;
  /** Enable TypeScript type-check validation (default: true if exec available) */
  enableTsc?: boolean;
  /** Enable LSP-based TypeScript validation (faster per-file checks, falls back to tsc). Default: true */
  enableLspTs?: boolean;
  /** Enable git diff review before committing (default: true) */
  enableGitDiff?: boolean;
  /** File path for git operations */
  gitFilePath?: string;
  /** Plugin context — provides exec, readFile, writeFile, emit */
  pluginContext: PluginContext;
}

export interface ValidatedAgentResult extends AgentResult {
  /** Whether validation plugins passed */
  pluginsPassed: boolean;
  /** Which plugins ran */
  pluginsRan: string[];
  /** Whether rollback was performed */
  rolledBack: boolean;
  /** Rollback reason (if rolled back) */
  rollbackReason?: string;
}

/**
 * Run agent loop with plugin-based validation and automatic rollback.
 *
 * Flow:
 *   1. Snapshot current state
 *   2. Run agent loop (generates diff → applies → basic validate)
 *   3. If agent loop succeeds → run plugin validation (lint, tsc, git)
 *   4. If plugin validation fails → rollback to snapshot
 *   5. Return result with plugin/rollback metadata
 */
export async function runValidatedAgentLoop(
  opts: ValidatedAgentLoopOptions
): Promise<ValidatedAgentResult> {
  const {
    pluginContext,
    enableLint = true,
    enableTsc = true,
    enableLspTs = true,
    enableGitDiff = true,
    gitFilePath,
    ...agentOpts
  } = opts;

  // ── Snapshot: save original content for potential rollback ──────────────────
  const originalContent = agentOpts.originalContent;
  let currentContent = originalContent;
  let appliedContent: string | null = null;

  // ── Set up plugin registry ─────────────────────────────────────────────────
  const pluginsRan: string[] = [];
  const registry = new PluginRegistry(pluginContext);

  if (enableLint && pluginContext.exec) {
    await registry.register(createLintPlugin());
    pluginsRan.push("lint");
  }
  // LSP-based TS validation (faster per-file checks, falls back to tsc)
  if (enableLspTs) {
    try {
      await registry.register(createLspTsPlugin());
      pluginsRan.push("lsp-ts");
    } catch (err) {
      logger.warn('LSP TS plugin registration failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // Only register tsc as a separate plugin if LSP is NOT active (avoid double-checking)
  if (enableTsc && pluginContext.exec && !pluginsRan.includes("lsp-ts")) {
    await registry.register(createTscPlugin());
    pluginsRan.push("tsc");
  }

  // ── Custom validator: basic checks + plugin validation ─────────────────────
  const validatedValidate = async (code: string, filePath: string): Promise<string | null> => {
    // Step 1: Basic validation (braces, merge markers)
    const basicError = await defaultValidate(code, filePath);
    if (basicError) return basicError;

    // Step 2: Plugin validation
    // Lint check
    if (enableLint && registry.listCommands().includes("lint.check")) {
      try {
        const lintFile = gitFilePath ?? filePath;
        const lintResult = await registry.run<{ stdout: string; stderr: string; exitCode: number }>(
          "lint.check",
          { file: lintFile }
        );
        if (lintResult.exitCode !== 0 && lintResult.stderr) {
          increment("validation-failed", 1);
          return `ESLint errors:\n${lintResult.stderr.slice(0, 2000)}`;
        }
      } catch (err) {
        logger.warn("Lint validation failed to run:", err instanceof Error ? err.message : String(err));
        // Don't fail the edit if lint can't run — just warn
      }
    }

    // LSP TypeScript check (preferred — runs first, faster per-file)
    if (enableLspTs && registry.listCommands().includes("lsp-ts.check")) {
      try {
        const lspFile = gitFilePath ?? filePath;
        const lspResult = await registry.run<{ stdout: string; stderr: string; exitCode: number }>(
          "lsp-ts.check",
          { file: lspFile, content: code }
        );
        if (lspResult.exitCode !== 0 && lspResult.stdout) {
          increment("validation-failed", 1);
          return `TypeScript errors (LSP):\n${lspResult.stdout.slice(0, 2000)}`;
        }
      } catch (err) {
        logger.warn("LSP TS validation failed to run:", err instanceof Error ? err.message : String(err));
        // Don't fail — let tsc check run as fallback below
      }
    }

    // TypeScript check (CLI fallback — runs tsc --noEmit for full project)
    if (enableTsc && registry.listCommands().includes("tsc.check")) {
      try {
        const tscResult = await registry.run<{ stdout: string; stderr: string; exitCode: number }>(
          "tsc.check"
        );
        if (tscResult.exitCode !== 0 && tscResult.stdout) {
          increment("validation-failed", 1);
          return `TypeScript errors (tsc):\n${tscResult.stdout.slice(0, 2000)}`;
        }
      } catch (err) {
        logger.warn("TSC validation failed to run:", err instanceof Error ? err.message : String(err));
      }
    }

    return null; // all validations passed
  };

  // ── Run agent loop with enhanced validation ────────────────────────────────
  const agentResult = await trace("validated-agent-loop", async () => {
    return runAgentLoop({
      ...agentOpts,
      validate: validatedValidate,
      writeFile: async (path: string, content: string) => {
        appliedContent = content; // track what was applied
        currentContent = content;

        // Call original writeFile if provided
        if (agentOpts.writeFile) {
          await agentOpts.writeFile(path, content);
        }
      },
    });
  });

  // ── Post-edit: git diff review (if enabled) ────────────────────────────────
  if (agentResult.success && enableGitDiff && pluginContext.exec && gitFilePath) {
    try {
      const diffResult = await registry.run<{ stdout: string; stderr: string; exitCode: number }>(
        "git.diff",
        { file: gitFilePath }
      );
      if (diffResult.stdout && diffResult.stdout.length > 0) {
        logger.debug("Git diff after edit:", { diff: diffResult.stdout.slice(0, 500) });
      }
    } catch {
      // Git diff is informational — don't fail the edit
    }
  }

  // ── Rollback if agent loop failed ──────────────────────────────────────────
  if (!agentResult.success && appliedContent !== null) {
    // Attempt rollback: restore original content
    try {
      if (agentOpts.writeFile) {
        await agentOpts.writeFile(agentOpts.filePath, originalContent);
      }
      increment("agent-rollback", 1);
      logger.info("Rolled back failed edit", { path: agentOpts.filePath });
    } catch (err) {
      logger.error("Rollback also failed!", { error: err instanceof Error ? err.message : String(err) });
    }

    return {
      ...agentResult,
      pluginsPassed: false,
      pluginsRan,
      rolledBack: true,
      rollbackReason: `Edit failed after ${agentResult.iterations} iteration(s): ${agentResult.error}`,
    };
  }

  // ── Success ────────────────────────────────────────────────────────────────
  return {
    ...agentResult,
    pluginsPassed: true,
    pluginsRan,
    rolledBack: false,
  };
}
