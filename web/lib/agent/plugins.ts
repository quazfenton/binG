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
        // Truncate to prevent excessive command length
        const safeMsg = msg.slice(0, 500).replace(/[;|&$`\\]/g, ""); // strip shell metacharacters
        return _ctx.exec(`git add -A && git commit -m "${safeMsg}"`);
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
        const file = args?.file as string ?? ".";
        return _ctx.exec(`npx eslint ${file} --format json`);
      },
      async fix(args) {
        if (!_ctx.exec) throw new Error("exec not available");
        const file = args?.file as string ?? ".";
        return _ctx.exec(`npx eslint ${file} --fix`);
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
