 review the existing code to find:
     - Direct localStorage usage (should use storage)
     - Direct navigator.clipboard usage (should use clipboard)
     - Direct fetch calls (should use apiFetch)
     - Direct window API usage that differs between platforms
     - Direct fs operations
     - Direct notification usage
     - Direct window control usage


 Platform Abstraction Migration Plan

    Based on the comprehensive audit, here's the prioritized plan:

    Phase 1: Critical Security & Auth (High Impact, Low Effort)


    ┌───────┬───────────────────────────────────────────────────────────────────────┬─────────────────────────────────
    ┐
    │ Ta... │ Files                                                                 │ Change
    │
    ├───────┼───────────────────────────────────────────────────────────────────────┼─────────────────────────────────
    ┤
    │ **Au... │ conversation-interface.tsx, TerminalPanel.tsx, ToolAuthPrompt.tsx,... │ Replace
    `localStorage.getIte... │
    │ **AP... │ settings.tsx (UserAPIKeysPanel)                                       │ Replace localStorage →
    `secr... │
    │ **wi... │ app/api/auth/oauth/success/route.ts, `app/api/auth/oauth/error/rou... │ Replace window.close() →
    `wi... │
    │ **do... │ lib/tambo/tambo-hooks.ts                                              │ Replace document.title →
    `wi... │
    └───────┴───────────────────────────────────────────────────────────────────────┴─────────────────────────────────
    ┘


    Phase 2: Clipboard (Medium Impact, Medium Effort)


    ┌─────────────┬────────────────────────────────────────────────┬────────────────────────────────────────────────┐
    │ Target      │ Files                                          │ Change                                         │
    ├─────────────┼────────────────────────────────────────────────┼────────────────────────────────────────────────┤
    │ **Clipboar... │ 49 files across components/                    │ Replace navigator.clipboard.writeText() → `...
    │
    │ **Clipboar... │ visual_editor.tsx, TerminalPanel.tsx, `json... │ Replace navigator.clipboard.readText() → `c...
    │
    └─────────────┴────────────────────────────────────────────────┴────────────────────────────────────────────────┘


    Phase 3: Storage (High Impact, High Effort)


    ┌──────────┬───────────────────────────────────────────────────────────────┬─────────────────────────────────────┐
    │ Target   │ Files                                                         │ Change                              │
    ├──────────┼───────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
    │ UI state │ news-panel.tsx, workspace-panel.tsx, interaction-panel.tsx... │ Replace `localStorage.getItem/se... │
    │ **Embed... │ 15+ plugin files (wikipedia, duckduckgo, stackblitz, codes... │ Replace localStorage → `storage....
     │
    │ **Sessi... │ conversation-interface.tsx (chat_provider, current_conversat... │ Replace localStorage →
    `storage.... │
    │ **PWA p... │ pwa-install-prompt.tsx                                        │ Replace localStorage → `storage....
     │
    └──────────┴───────────────────────────────────────────────────────────────┴─────────────────────────────────────┘


    Phase 4: Window & Navigation (Medium Impact, Low Effort)


    ┌────────┬────────────────────────────────────────────────────────┬───────────────────────────────────────────────
    ┐
    │ Target │ Files                                                  │ Change
    │
    ├────────┼────────────────────────────────────────────────────────┼───────────────────────────────────────────────
    ┤
    │ **win... │ 58 files                                               │ Add openUrl() to lib/platform/window.ts,
    t... │
    │ **OAu... │ zine-oauth-integration.tsx, ToolAuthPrompt.tsx, `no... │ Special handling for OAuth popup flow
      │
    └────────┴────────────────────────────────────────────────────────┴───────────────────────────────────────────────
    ┘


    Phase 5: API Client (Highest Impact, Highest Effort)


    ┌─────────┬─────────────────────────────────────────────────────────────────┬────────────────────────────────────┐
    │ Target  │ Files                                                           │ Change                             │
    ├─────────┼─────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
    │ **Inte... │ hooks/ (use-chat-history-sync, use-enhanced-chat, use-file-e... │ Replace fetch('/api/...') → `ap...
     │
    │ **Auth... │ contexts/auth-context.tsx                                       │ Replace fetch('/api/auth/...') ...
     │
    │ **Exte... │ lib/integrations/, lib/mcp/, lib/figma/, lib/github/            │ Replace fetch('https://api...')...
     │
    └─────────┴─────────────────────────────────────────────────────────────────┴────────────────────────────────────┘


    Phase 6: File System (Server-Side Only)


    ┌─────────┬──────────────────────────────────────────────────┬────────────────────────────────────────────────────
    ┐
    │ Target  │ Files                                            │ Change
    │
    ├─────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────
    ┤
    │ **lib/... │ lib/virtual-filesystem/, lib/skills/, `lib/st... │ These are server-side only - keep Node.js fs
    fo... │
    └─────────┴──────────────────────────────────────────────────┴────────────────────────────────────────────────────
    ┘


    Monorepo Path Mapping

    When you restructure to monorepo, the paths will become:

      1 Current                    →  Monorepo
      2 ─────────────────────────────────────────────────
      3 lib/platform/              →  packages/platform/
      4 lib/platform/storage/      →  packages/platform/storage/
      5 lib/platform/fs/           →  packages/platform/fs/
      6 lib/platform/secrets/      →  packages/platform/secrets/
      7 lib/platform/window.ts     →  packages/platform/window.ts
      8 lib/platform/clipboard.ts  →  packages/platform/clipboard.ts
      9 lib/platform/notifications.ts → packages/platform/notifications.ts
     10 lib/platform/apiClient.ts  →  packages/platform/apiClient.ts
     11 lib/platform/jobs.ts       →  packages/platform/jobs.ts
     12 lib/platform/env.ts        →  packages/platform/env.ts
     13
     14 tauri/                     →  apps/desktop/
     15 tauri/lib/                 →  apps/desktop/lib/
     16 tauri/components/          →  apps/desktop/components/
     17 tauri/app/                 →  apps/desktop/app/
     18 tauri/src-tauri/           →  apps/desktop/src-tauri/
     19
     20 lib/ (remaining)           →  packages/shared/
     21 components/                →  packages/ui/
     22 hooks/                     →  packages/shared/hooks/
     23 contexts/                  →  packages/shared/contexts/
     24 app/                       →  apps/web/app/

    Import Path Migration Strategy

    When monorepo is ready, update imports:

     1 // Before
     2 import { storage } from '@/lib/platform/storage';
     3 import { isDesktopMode } from '@/lib/platform/env';
     4
     5 // After (monorepo)
     6 import { storage } from '@bing/platform/storage';
     7 import { isDesktopMode } from '@bing/platform/env';

    Priority Order for Implementation

     1. Phase 1 (1-2 days) - Auth tokens, secrets, window control
     2. Phase 2 (2-3 days) - Clipboard across all components
     3. Phase 3 (3-5 days) - Storage migration (start with embed plugins)
     4. Phase 4 (1-2 days) - window.open abstraction
     5. Phase 5 (5-10 days) - API client migration (largest effort)
     6. Phase 6 (ongoing) - Server-side fs (low priority, server-only)

    Files to Create/Modify


    ┌────────┬─────────────────────────────────────────────────┐
    │ Action │ File                                            │
    ├────────┼─────────────────────────────────────────────────┤
    │ Modify │ lib/platform/window.ts - Add openUrl() function │
    │ Modify │ 6 auth-related component files                  │
    │ Modify │ 49 clipboard-using component files              │
    │ Modify │ 15+ embed plugin files                          │
    │ Modify │ 10+ UI state storage files                      │
    │ Modify │ 10+ hook files for API client                   │
    │ Modify │ contexts/auth-context.tsx                       │
    └────────┴─────────────────────────────────────────────────┘