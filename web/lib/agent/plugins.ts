/**
 * plugins.ts — Plugin system
 *
 * Lets you add: Git, linters, test runners, language servers, custom commands.
 *
 * Usage:
 *   const registry = new PluginRegistry(ctx);
 *   registry.register(gitPlugin);
 *   await registry.run("git.status");
 */

import { formatDiagnosticsForFeedback, type LspGateway } from '@/lib/lsp';

// ─── Plugin Interface ─────────────────────────────────────────────────────────

export interface PluginContext {
  projectId: string;
  projectPath?: string;
  /** Run a shell command (desktop only) */
  exec?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Read a file */
  readFile?: (path: string) => Promise<string>;
  /** Write a file */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Emit a UI event (for status updates, notifications) */
  emit: (event: string, payload?: unknown) => void;
}

export interface Plugin {
  /** Unique name, e.g. "git", "eslint" */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Commands this plugin registers, e.g. "git.commit", "eslint.lint" */
  commands: Record<string, (args?: Record<string, unknown>) => Promise<unknown>>;
  /** Called once when the plugin is registered */
  setup?: (ctx: PluginContext) => void | Promise<void>;
  /** Called when the plugin is removed */
  teardown?: () => void | Promise<void>;
}

// ─── Plugin Registry ──────────────────────────────────────────────────────────

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private commandIndex = new Map<string, (args?: Record<string, unknown>) => Promise<unknown>>();
  private ctx: PluginContext;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin "${plugin.name}" already registered — skipping`);
      return;
    }

    await plugin.setup?.(this.ctx);
    this.plugins.set(plugin.name, plugin);

    for (const [cmdName, handler] of Object.entries(plugin.commands)) {
      const fullName = `${plugin.name}.${cmdName}`;
      this.commandIndex.set(fullName, handler);
    }
  }

  async remove(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    await plugin.teardown?.();
    this.plugins.delete(name);

    for (const key of this.commandIndex.keys()) {
      if (key.startsWith(`${name}.`)) {
        this.commandIndex.delete(key);
      }
    }
  }

  async run<T = unknown>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<T> {
    const handler = this.commandIndex.get(command);
    if (!handler) {
      throw new Error(`Unknown command: "${command}". Available: ${[...this.commandIndex.keys()].join(", ")}`);
    }
    return handler(args) as Promise<T>;
  }

  listCommands(): string[] {
    return [...this.commandIndex.keys()];
  }

  listPlugins(): string[] {
    return [...this.plugins.keys()];
  }
}

// ─── Built-in Plugins ─────────────────────────────────────────────────────────

/** Git plugin — requires desktop (exec capability) */
export function createGitPlugin(): Plugin {
  let _ctx: PluginContext;

  return {
    name: "git",
    description: "Git operations: status, diff, commit",
    commands: {
      async status() {
        if (!_ctx.exec) throw new Error("exec not available");
        return _ctx.exec("git status --short");
      },
      async diff(args) {
        if (!_ctx.exec) throw new Error("exec not available");
        const file = (args?.file as string) ?? "";
        // Validate: only allow alphanumeric, slashes, dots, hyphens, underscores
        if (!/^[a-zA-Z0-9_\-./]+$/.test(file)) {
          throw new Error("Invalid file path for git diff");
        }
        return _ctx.exec(`git diff ${file}`);
      },
      async commit(args) {
        if (!_ctx.exec) throw new Error("exec not available");
        const msg = args?.message as string;
        if (!msg || typeof msg !== "string") throw new Error("commit requires a message");
        // Truncate and sanitize to prevent shell injection — escape both single and double quotes
        const safeMsg = msg
          .slice(0, 500)
          .replace(/[;|&$`\\(){}!#]/g, "")
          .replace(/'/g, "'\\''");
        return _ctx.exec(`git add -A && git commit -m '${safeMsg}'`);
      },
      async log(args) {
        if (!_ctx.exec) throw new Error("exec not available");
        const n = Math.min(Math.max((args?.n as number) ?? 10, 1), 100); // clamp 1-100
        return _ctx.exec(`git log --oneline -${n}`);
      },
    },
    setup(ctx) {
      _ctx = ctx;
    },
  };
}

/** Lint plugin — runs ESLint on a file */
export function createLintPlugin(): Plugin {
  let _ctx: PluginContext;

  return {
    name: "lint",
    description: "ESLint integration",
    commands: {
      async check(args) {
        if (!_ctx.exec) throw new Error("exec not available");
        const raw = args?.file as string ?? ".";
        // Strip shell metacharacters to prevent injection
        const file = raw.replace(/[;|&$`\\'"(){}!#<>*?[\]~]/g, "");
        return _ctx.exec(`npx eslint '${file}' --format json`);
      },
      async fix(args) {
        if (!_ctx.exec) throw new Error("exec not available");
        const raw = args?.file as string ?? ".";
        // Strip shell metacharacters to prevent injection
        const file = raw.replace(/[;|&$`\\'"(){}!#<>*?[\]~]/g, "");
        return _ctx.exec(`npx eslint '${file}' --fix`);
      },
    },
    setup(ctx) {
      _ctx = ctx;
    },
  };
}

/** TypeScript type-check plugin */
export function createTscPlugin(): Plugin {
  let _ctx: PluginContext;

  return {
    name: "tsc",
    description: "TypeScript compiler checks",
    commands: {
      async check() {
        if (!_ctx.exec) throw new Error("exec not available");
        return _ctx.exec("npx tsc --noEmit --pretty false 2>&1 | head -50");
      },
    },
    setup(ctx) {
      _ctx = ctx;
    },
  };
}

/**
 * LSP TypeScript plugin — uses the LspGateway for fast, per-file
 * diagnostics instead of a full-project `tsc --noEmit`.
 *
 * The gateway auto-detects tsconfig.json and spawns the appropriate
 * language server(s). Falls back to the tsc CLI plugin when LSP is
 * unavailable (e.g. web-only deployments where child_process can't spawn).
 */
export function createLspTsPlugin(): Plugin {
  let _ctx: PluginContext;
  let _gateway: LspGateway | null = null;
  let _started = false;
  let _fallbackTsc: Plugin | null = null;

  return {
    name: 'lsp-ts',
    description: 'TypeScript LSP diagnostics (fast per-file checks via gateway)',
    commands: {
      /**
       * Run LSP diagnostics on a file. Returns human-readable error output
       * or an empty string if no issues found.
       */
      async check(args) {
        const filePath = (args?.file as string) || '';
        if (!filePath) {
          // No specific file — run a broad tsc check as fallback
          if (_fallbackTsc?.commands.check) {
            return _fallbackTsc.commands.check(args);
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }

        // Try LSP gateway path first
        if (_gateway?.isReady) {
          try {
            // Use passed content if available (from agent loop's code param),
            // otherwise read from disk/VFS as fallback
            let content = (args?.content as string) || '';
            if (!content && _ctx.readFile) {
              content = await _ctx.readFile(filePath);
            }

            // Sync file to the gateway — it routes to the correct adapter
            await _gateway.syncFile(filePath, content);
            const diags = await _gateway.waitForDiagnostics(filePath, 2500);

            if (diags.length === 0) {
              return { stdout: '', stderr: '', exitCode: 0 };
            }

            // Format diagnostics as tsc-like output for compatibility
            const formatted = formatDiagnosticsForFeedback(
              diags.map((d) => ({
                file: d.file,
                message: d.message,
                severity: d.severity,
                line: d.line,
                column: d.column,
                code: d.code,
              }))
            );

            return {
              stdout: formatted,
              stderr: '',
              exitCode: diags.some((d) => d.severity === 'error') ? 1 : 0,
            };
          } catch (err) {
            console.warn('[lsp-ts] Gateway check failed, falling back to tsc:',
              err instanceof Error ? err.message : String(err));
            // Fall through to tsc fallback
          }
        }

        // Fallback: use tsc CLI plugin
        if (_fallbackTsc?.commands.check) {
          return _fallbackTsc.commands.check(args);
        }

        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
    async setup(ctx) {
      _ctx = ctx;
      _fallbackTsc = createTscPlugin();
      await _fallbackTsc.setup?.(ctx);

      // Try to start the LSP gateway (server-side only)
      if (ctx.exec) {
        try {
          const { getGateway } = await import('@/lib/lsp');
          _gateway = getGateway({
            projectRoot: ctx.projectPath || process.cwd(),
            autoDetect: true,
          });
          await _gateway.start();
          _started = true;
          if (_gateway.isReady) {
            console.log('[lsp-ts] LSP gateway enabled with adapters:',
              _gateway.getAdapters().map(a => a.name).join(', '));
            ctx.emit('plugin:lsp-ts:ready', {
              available: true,
              adapters: _gateway.getAdapters().map(a => a.name),
            });
          }
        } catch (err) {
          console.warn('[lsp-ts] LSP gateway unavailable, using tsc fallback:',
            err instanceof Error ? err.message : String(err));
        }
      }
    },
    async teardown() {
      if (_gateway && _started) {
        await _gateway.shutdown();
        _gateway = null;
        _started = false;
      }
    },
  };
}
