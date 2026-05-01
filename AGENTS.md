# binG Agent Guidelines

This file is the working contract for agents editing `binG`. Prefer what the repository actually does over older docs.
  

## Working Rules
- Assume the worktree is dirty. Do not revert unrelated user changes. DO NOT ever use 'git restore' or 'git checkout' to revert a file (to avoid carelessly wiping all unsaved progress beyond your edits) just to fix a small error. This may only be used if NECESSARY and sparingly when a file has been completely corrupted/truncated from a latest bad edit, and even then, only CAREFULLY after you have used 'git diff' to review file history and ensure that you reapply any uncommitted progress that will be lost.
- Prioritize the use of numbered steps/tasks/planning to complete to avoid skipping or overlook of full completion of the tasks with review, careful tracing of logic & related or preexisting files, and ensure best architectural optimizations or any necessary abstractions/modularity for adaptability, thorough handling, and robustness of implementations.   
- Adapt to user's OS environment if there are command failures; Prefer `rg` / `rg --files` for search (edit: user currently doesn't have ripgrep but it can be install), or Retry any failures with different a command if user's environment cause an improper command to fail (will likely be Windows Powershell, or you may also use wsl Linux commands. Dont keep reusing the same failing command & skipping when it is fails; you can adapt your methodology when indications show you are clearly assuming the wrong system/format or if you need to install an additional tool that would be optimal and enabling for the use case).
- Use `pnpm` for project commands.
- Use `@/` imports for repo-root paths.
- Default exports are mainly for React components; prefer named exports elsewhere.
- Match the local file’s style before introducing a new pattern.

## Current Repo Reality
- Framework: Next.js app router on Next `16.1.6`, React `19.2.4`, TypeScript with `strict: false`.
- Package manager: `pnpm` with a committed `pnpm-lock.yaml`. `package-lock.json` also exists, but project scripts are defined for `pnpm`.
- Tests: Vitest is the main runner. Many tests are true integration tests and may hit external services, ports, subprocesses, or local binaries.
- Build: `pnpm build` runs Next build and TypeScript validation. Do not reintroduce `typescript.ignoreBuildErrors` unless the user explicitly accepts that tradeoff.
- Lint: `pnpm lint` now starts correctly. Expect many warnings in legacy code; treat lint errors as actionable.
- Next convention: this repo now uses [`proxy.ts`](./proxy.ts) instead of deprecated `middleware.ts`.

## Commands

### Core
```bash
pnpm dev
pnpm dev:ws
pnpm dev:standard
pnpm dev:opencode
pnpm build
pnpm start
pnpm start:ws
pnpm migrate
pnpm backup
pnpm export-telemetry
```

### Lint and Tests
```bash
pnpm lint
pnpm test
pnpm test:watch
pnpm test:ui
pnpm test:coverage
pnpm test:stateful-agent
pnpm test:e2e
pnpm test:sandbox
pnpm test:webcontainer
npx vitest run path/to/file.test.ts
```

### Important Validation Notes
- Prefer targeted validation around changed code before reaching for full-suite commands.
- `pnpm test` is broad and noisy. It includes suites that rely on external binaries, networked providers, Redis, open ports, or real credentials.
- Sandbox provider tests are opt-in now. [`__tests__/sandbox/sandbox-providers-integration.test.ts`](./__tests__/sandbox/sandbox-providers-integration.test.ts) only runs live provider checks when `ENABLE_LIVE_SANDBOX_TESTS=true` and at least one real provider key is present.
- `pnpm build` is a useful integration check for routing, bundling, and type regressions.
- `pnpm exec tsc --noEmit` is the direct typecheck command when you want compiler output without a full Next build.

## Code Style
- TypeScript target: ES2020.
- Module resolution: `bundler`.
- JSX: `react-jsx`.
- Indentation: 2 spaces.
- Strings: single quotes.
- Semicolons: required.
- Keep new code ASCII unless the file already uses Unicode intentionally.

## Imports
- Order imports as:
  1. External packages
  2. Internal `@/` imports
  3. Relative imports
  4. Type-only imports
- Avoid deep relative traversals when an `@/` path is clearer.
- Avoid barrel imports when an explicit module path exists.

## Project Layout
- [`app`](./app): Next app router pages and API routes.
- [`components`](./components): React UI.
- [`contexts`](./contexts): React context providers.
- [`hooks`](./hooks): custom hooks.
- [`lib`](./lib): core services, auth, sandbox, agent, VFS, utilities.
- [`services`](./services): background and service entrypoints.
- [`scripts`](./scripts): maintenance and setup scripts.
- [`test`](./test), [`__tests__`](./__tests__), [`tests`](./tests): mixed unit, integration, and E2E coverage.
- [`docs`](./docs): design notes, SDK references, implementation docs.
- [`cli`](./cli): separate CLI package/workspace.

## Testing Guidance
- Test file patterns are primarily `*.test.ts` and `*.test.tsx`.
- Global setup lives in [`test/setup.ts`](./test/setup.ts).
- The shared test setup mocks `fetch`, storage APIs, timers, `ResizeObserver`, `IntersectionObserver`, and exports common fixtures/utilities.
- Some tests are environment-sensitive even when they live under `__tests__`. Read the file before assuming it is hermetic.
- If a suite opens ports, spawns subprocesses, or depends on live providers, call that out explicitly in your final note.

## Error Handling
- Do not swallow errors silently.
- Include enough context in logs to debug the failure, but never log secrets or raw credentials.
- Prefer structured failures from route handlers and service boundaries.
- In new async code, use `try/catch` when failure needs custom logging, cleanup, or a typed fallback.

## React and UI
- Use function components.
- Follow existing patterns in the touched area before introducing new abstractions.
- Use Tailwind as the primary styling mechanism.
- Prefer semantic HTML and preserve accessible labels, alt text, and keyboard support.
- This repo has many existing shadcn-style UI primitives under [`components/ui`](./components/ui); reuse them when appropriate.

## Agent Review Checklist
- Did you avoid overwriting unrelated work in a dirty tree?
- Did you validate with the narrowest useful command instead of assuming `pnpm test` is safe?
- Did you run either `pnpm build` or `pnpm exec tsc --noEmit` after changing typed code?
- Did you distinguish lint errors from existing warnings?
- Did you update or add tests when changing logic that already has coverage nearby?
- Did you preserve `@/` import conventions and local file style?
- Did you avoid introducing new secrets or logging existing ones?

## Known Issues Worth Remembering
- The lint baseline still includes many warnings in legacy files, especially `any` usage and unused locals.

When in doubt, inspect adjacent code and the exact test or route you are touching instead of relying on older documentation.
