Sessions
Sessions are stored as JSONL files with a tree structure. Each entry has an id and parentId, enabling in-place branching without creating new files. See docs/session.md for file format.

Management
Sessions auto-save to ~/.pi/agent/sessions/ organized by working directory.

pi -c                  # Continue most recent session
pi -r                  # Browse and select from past sessions
pi --no-session        # Ephemeral mode (don't save)
pi --session <path>    # Use specific session file or ID
pi --fork <path>       # Fork specific session file or ID into a new session
Branching
/tree - Navigate the session tree in-place. Select any previous point, continue from there, and switch between branches. All history preserved in a single file.

Tree View

Search by typing, fold/unfold and jump between branches with Ctrl+←/Ctrl+→ or Alt+←/Alt+→, page with ←/→
Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
Press Shift+L to label entries as bookmarks and Shift+T to toggle label timestamps
/fork - Create a new session file from the current branch. Opens a selector, copies history up to the selected point, and places that message in the editor for modification.

--fork <path|id> - Fork an existing session file or partial session UUID directly from the CLI. This copies the full source session into a new session file in the current project.

Compaction
Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

Manual: /compact or /compact <custom instructions>

Automatic: Enabled by default. Triggers on context overflow (recovers and retries) or when approaching the limit (proactive). Configure via /settings or settings.json.

Compaction is lossy. The full history remains in the JSONL file; use /tree to revisit. Customize compaction behavior via extensions. See docs/compaction.md for internals.

Settings
Use /settings to modify common options, or edit JSON files directly:

Location	Scope
~/.pi/agent/settings.json	Global (all projects)
.pi/settings.json	Project (overrides global)
See docs/settings.md for all options.

To opt out of anonymous install/update telemetry tied to changelog detection, set enableInstallTelemetry to false in settings.json, or set PI_TELEMETRY=0.

Context Files
Pi loads AGENTS.md (or CLAUDE.md) at startup from:

~/.pi/agent/AGENTS.md (global)
Parent directories (walking up from cwd)
Current directory
Use for project instructions, conventions, common commands. All matching files are concatenated.

Disable context file loading with --no-context-files (or -nc).

System Prompt
Replace the default system prompt with .pi/SYSTEM.md (project) or ~/.pi/agent/SYSTEM.md (global). Append without replacing via APPEND_SYSTEM.md.

Customization
Prompt Templates
Reusable prompts as Markdown files. Type /name to expand.

<!-- ~/.pi/agent/prompts/review.md -->
Review this code for bugs, security issues, and performance problems.
Focus on: {{focus}}
Place in ~/.pi/agent/prompts/, .pi/prompts/, or a pi package to share with others. See docs/prompt-templates.md.

Skills
On-demand capability packages following the Agent Skills standard. Invoke via /skill:name or let the agent load them automatically.

<!-- ~/.pi/agent/skills/my-skill/SKILL.md -->
# My Skill
Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
Place in ~/.pi/agent/skills/, ~/.agents/skills/, .pi/skills/, or .agents/skills/ (from cwd up through parent directories) or a pi package to share with others. See docs/skills.md.

Extensions
Doom Extension

TypeScript modules that extend pi with custom tools, commands, keyboard shortcuts, event handlers, and UI components.

export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "deploy", ... });
  pi.registerCommand("stats", { ... });
  pi.on("tool_call", async (event, ctx) => { ... });
}
What's possible:

Custom tools (or replace built-in tools entirely)
Sub-agents and plan mode
Custom compaction and summarization
Permission gates and path protection
Custom editors and UI components
Status lines, headers, footers
Git checkpointing and auto-commit
SSH and sandbox execution
MCP server integration
Make pi look like Claude Code
Games while waiting (yes, Doom runs)
...anything you can dream up
Place in ~/.pi/agent/extensions/, .pi/extensions/, or a pi package to share with others. See docs/extensions.md and examples/extensions/.

Themes
Built-in: dark, light. Themes hot-reload: modify the active theme file and pi immediately applies changes.

Place in ~/.pi/agent/themes/, .pi/themes/, or a pi package to share with others. See docs/themes.md.

Pi Packages
Bundle and share extensions, skills, prompts, and themes via npm or git. Find packages on npmjs.com or Discord.

Security: Pi packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

pi install npm:@foo/pi-tools
pi install npm:@foo/pi-tools@1.2.3      # pinned version
pi install git:github.com/user/repo
pi install git:github.com/user/repo@v1  # tag or commit
pi install git:git@github.com:user/repo
pi install git:git@github.com:user/repo@v1  # tag or commit
pi install https://github.com/user/repo
pi install https://github.com/user/repo@v1      # tag or commit
pi install ssh://git@github.com/user/repo
pi install ssh://git@github.com/user/repo@v1    # tag or commit
pi remove npm:@foo/pi-tools
pi uninstall npm:@foo/pi-tools          # alias for remove
pi list
pi update                               # skips pinned packages
pi config                               # enable/disable extensions, skills, prompts, themes
Packages install to ~/.pi/agent/git/ (git) or global npm. Use -l for project-local installs (.pi/git/, .pi/npm/). Git packages install dependencies with npm install --omit=dev, so runtime deps must be listed under dependencies. If you use a Node version manager and want package installs to reuse a stable npm context, set npmCommand in settings.json, for example ["mise", "exec", "node@20", "--", "npm"].

Create a package by adding a pi key to package.json:

{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
Without a pi manifest, pi auto-discovers from conventional directories (extensions/, skills/, prompts/, themes/).

See docs/packages.md.

Programmatic Usage
SDK
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

await session.prompt("What files are in the current directory?");
For advanced multi-session runtime replacement, use createAgentSessionRuntime() and AgentSessionRuntime.

See docs/sdk.md and examples/sdk/.

RPC Mode
For non-Node.js integrations, use RPC mode over stdin/stdout:

pi --mode rpc
RPC mode uses strict LF-delimited JSONL framing. Clients must split records on \n only. Do not use generic line readers like Node readline, which also split on Unicode separators inside JSON payloads.

See docs/rpc.md for the protocol.



