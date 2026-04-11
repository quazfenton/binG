# Powers System

User-installable, WASM-sandboxed skill capabilities — the "client-facing cousin" to native capabilities.

## Architecture

```
SKILL.md (frontmatter + system prompt + action definitions)
  → PowersRegistry (parse, validate, cache)
  ├── jsonSchemaToZod (action params → zod → Vercel AI tools)
  ├── CapabilityRouter ('powers.execute' capability)
  │   └── WASM Runner (sandboxed execution)
  │       ├── host_read  — VFS sync read
  │       ├── host_write — VFS sync write
  │       ├── host_fetch — async HTTP (allowlist-gated)
  │       ├── host_poll  — async fetch polling
  │       ├── host_log   — structured logging
  │       └── host_getrandom — crypto random
  └── System Prompt Injection (system-prompts.ts)
```

## What Powers Are

- **Less formal than capabilities**: No native provider registration needed
- **User-installable**: From marketplace or direct SKILL.md upload
- **Sandboxed**: WASM execution with restricted permissions (host allowlists, VFS path prefixes, memory caps, timeouts)
- **Exposed as tools**: Each action becomes a typed Vercel AI tool via `jsonSchemaToZod`
- **Prompt-injected**: Active powers appear in the system prompt via `generatePowersBlock()` in `system-prompts.ts`

## File Layout

```
web/lib/powers/
├── index.ts            ← PowersRegistry, executePower, buildPowerTools, buildPowersSystemPrompt
├── market.ts           ← Marketplace index, installFromMarketplace, searchMarketplace
├── invoke.ts           ← invokeSkill orchestration (policy → WASM → artifacts)
├── powers-cli.ts       ← CLI: list, show, install, uninstall, search, add
├── use-power.ts        ← React hook for marketplace UI
└── wasm/
    ├── runner.ts       ← Wasmtime WASI runner with host imports
    ├── fetchQueue.ts   ← Async fetch queue (host_fetch → host_poll bridge)
    ├── simpleVfs.ts    ← Sync VFS wrapper for WASM host calls
    ├── lib.rs          ← Rust skill handler example
    ├── Cargo.toml      ← Rust crate config
    └── demo-run.sh     ← End-to-end demo script
```

## Integration Points

### 1. With System Prompts (`packages/shared/agent/system-prompts.ts`)
```ts
import { composePromptWithPowers } from '@bing/shared/agent/system-prompts';
const prompt = composePromptWithPowers('coder', {
  activePowers: [{ id, name, description, version, actions, triggers }],
  matchByTask: true,
  currentTask: userMessage,
});
```

### 2. With Vercel AI Tools (`web/lib/chat/vercel-ai-tools.ts`)
```ts
import { buildPowerTools } from '@/lib/powers';
const tools = {
  ...getAllTools(context),
  ...buildPowerTools(context),  // ← each power action becomes a tool
};
```

### 3. With Capability Router
Powers are exposed via the `powers.execute` capability, routed through the same
infrastructure as native capabilities — benefiting from provider selection,
fallback chains, and permissions.

## Security Model

- **WASM sandbox**: Skill handlers run in Wasmtime WASI with limited memory (8 MB)
- **Timeouts**: Per-action timeout (default 30s, configurable)
- **Host allowlist**: HTTP only to declared `allowedHosts`
- **VFS path prefix**: Skills scoped to their own directory + conversation artifacts
- **No raw filesystem**: All I/O goes through host_read/host_write (VFS only)
- **Signature verification**: Marketplace packages can be cryptographically signed

## CLI

```bash
npx powers list [--json]       # List installed + marketplace
npx powers show <id>           # Show power details
npx powers install <id>        # Install from marketplace
npx powers uninstall <id>      # Remove a power
npx powers search <query>      # Search marketplace
npx powers add <SKILL.md>      # Add a local power
```

## React Hook

```tsx
import { usePowers } from '@/lib/powers/use-power';

function ChatPanel() {
  const { powers, active, install, toggle, systemPrompt } = usePowers();
  // ... render marketplace UI
}
```
