# Visual Editor CLI Installer - Fixes & Implementation Summary

## Overview
This document summarizes all fixes applied to integrate the CLI Component Installer feature into the Visual Editor.

---

## ✅ Completed Fixes

### 1. API Route Location (CRITICAL - FIXED)
**Issue:** `cli-install_route.ts` was in wrong location (`components/plugins/`)

**Fix:** Created proper Next.js App Router API route at:
```
✅ app/api/cli-install/route.ts
```

**Features:**
- POST endpoint accepting `{ baseCmd, subCmd, args[], projectPath }`
- Command allowlist security (`ALLOWED_CMDS` set)
- Path validation (`isSafePath()` function)
- SSE streaming via `ReadableStream`
- Timeout watchdog (configurable via `CLI_TIMEOUT_MS`)
- Optional auth via `VISUAL_EDITOR_SECRET` header

---

### 2. SSE Client-Side Streaming (CRITICAL - VERIFIED)
**Issue:** Initial review suggested `EventSource` (GET-only) was used

**Status:** ✅ Already correctly implemented
- Uses `fetch()` + `ReadableStream` (POST-compatible)
- Properly parses SSE format: `data: {...}\n\n`
- Handles streaming stdout/stderr from child process

---

### 3. Visual Editor Replacement (FIXED)
**Issue:** `visual_editorR.tsx` needed to replace `visual_editor.tsx`

**Fix:** 
```
✅ components/visual_editor.tsx (replaced with full CLI installer version)
📁 components/visual_editor.tsx.bak (backup of original)
```

**New Features Added:**
- ComponentInstaller modal with 6 UI library adapters
- Library tabs (HeroUI, shadcn/ui, Magic UI, Aceternity UI, DaisyUI, Radix UI)
- Search + tag filter chips
- Variant-aware component selection
- Install queue panel
- Live terminal with color-coded output
- Progress bar and abort capability

---

### 4. Environment Variables (FIXED)
**Issue:** Missing env var documentation

**Fix:** Added to `env.example`:
```bash
# ===========================================
# VISUAL EDITOR - CLI INSTALLER
# ===========================================
VISUAL_EDITOR_SECRET=          # Auth token (empty = no auth)
PROJECT_ROOT=                   # Allowed path prefix
CLI_TIMEOUT_MS=120000           # Process timeout (2 min default)
```

---

### 5. CLI_ADAPTERS Completeness (VERIFIED)
**Issue:** File appeared truncated in initial read

**Status:** ✅ Complete with all 6 adapters:
- **HeroUI:** 20 components (button, card, input, modal, navbar, table, etc.)
- **shadcn/ui:** 29 components (button, card, dialog, sheet, dropdown-menu, etc.)
- **Magic UI:** 27 components (animated-beam, bento-grid, confetti, etc.)
- **Aceternity UI:** 30 components (3d-card, aurora-background, spotlight, etc.)
- **DaisyUI:** 15 components (btn, card, modal, navbar, drawer, etc.)
- **Radix UI:** 27 components (accordion, dialog, dropdown-menu, etc.)

---

### 6. Error Boundary (FIXED)
**Issue:** No error boundary for ComponentInstaller

**Fix:** Added `ComponentInstallerErrorBoundary` class component:
```tsx
class ComponentInstallerErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean; error?: Error }
>
```

**Wrapper:**
```tsx
function ComponentInstaller(props) {
  return (
    <ComponentInstallerErrorBoundary onError={props.onClose}>
      <ComponentInstallerInner {...props} />
    </ComponentInstallerErrorBoundary>
  );
}
```

---

### 7. Terminal Scroll Layout (FIXED)
**Issue:** Terminal may not scroll properly due to flex layout

**Fix:** Added `min-h-0` to terminal container:
```tsx
<div className="flex-1 flex flex-col overflow-hidden min-h-0">
```

This ensures the flex child doesn't overflow its parent in browsers with strict flexbox implementation.

---

### 8. Old Plugin Files Cleanup (FIXED)
**Issue:** Source files left in `components/plugins/`

**Status:** ✅ Cleaned up
- `visual_editorR.tsx` - removed
- `cli-install_route.ts` - removed

---

### 9. Documentation (FIXED)
**Issue:** Known limitations not documented

**Fix:** Added comprehensive JSDoc comment at top of `visual_editor.tsx`:

```tsx
/**
 * CLI COMPONENT INSTALLER (NEW):
 * - Install real UI components from HeroUI, shadcn/ui, Magic UI, etc.
 * - Variant-aware component selection
 * - Live terminal with streaming output
 * 
 * KNOWN LIMITATIONS:
 * - Craft.js Resolver Gap: CLI-installed components are NOT in drag-and-drop palette
 * - JSX Parser: Only handles basic inline styles
 * - Component Mapping: Custom/third-party components render as generic containers
 */
```

---

## 📋 Architecture Summary

### Data Flow
```
User selects component → ComponentInstaller modal
                       ↓
                 Queue builds install commands
                       ↓
                 POST /api/cli-install
                       ↓
                 spawn("npx", [cmd, ...args])
                       ↓
                 SSE stream back to client
                       ↓
                 Terminal displays output
                       ↓
                 Components installed in project
```

### File Structure
```
binG/
├── app/
│   ├── api/
│   │   └── cli-install/
│   │       └── route.ts              # NEW: API endpoint
│   └── visual-editor/
│       └── page.tsx                   # Entry point
├── components/
│   ├── visual_editor.tsx              # UPDATED: With CLI installer
│   └── visual_editor.tsx.bak          # BACKUP: Original
└── env.example                        # UPDATED: With new vars
```

---

## 🔒 Security Features

1. **Command Allowlist:** Only whitelisted CLI packages can execute
   ```ts
   const ALLOWED_CMDS = new Set([
     "@heroui/cli",
     "shadcn@latest",
     "magicui-cli",
     // ... etc
   ]);
   ```

2. **Path Validation:** Only paths under `PROJECT_ROOT` are allowed
   ```ts
   function isSafePath(p: string): boolean {
     const resolved = path.resolve(p);
     const root = path.resolve(PROJECT_ROOT);
     return resolved.startsWith(root + path.sep) || resolved === root;
   }
   ```

3. **No Shell Interpolation:** Args passed as array to `spawn()`
   ```ts
   spawn("npx", [baseCmd, subCmd, ...sanitizedArgs], { shell: false })
   ```

4. **Shell Metacharacter Filtering:** Args filtered for `;&|`$`
   ```ts
   const sanitizedArgs = args.filter((a) => !/[;&|`$]/.test(a));
   ```

5. **Optional Auth:** Bearer token via header
   ```ts
   if (SECRET) {
     const auth = req.headers.get("x-visual-editor-secret");
     if (auth !== SECRET) return new Response("Unauthorized", { status: 401 });
   }
   ```

---

## ⚠️ Known Limitations (By Design)

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Craft.js Resolver Gap** | CLI-installed components not in drag-and-drop palette | Use Craft components for prototyping, CLI for real dependencies |
| **JSX Parser** | Only inline styles parsed | Tailwind/CSS modules not editable in visual editor |
| **Component Mapping** | Custom components render as containers | Export code and edit manually |

---

## 🧪 Testing Checklist

- [ ] API route responds to POST requests
- [ ] SSE streaming works (terminal updates in real-time)
- [ ] Command allowlist blocks unauthorized commands
- [ ] Path validation rejects paths outside `PROJECT_ROOT`
- [ ] Timeout kills long-running processes
- [ ] Error boundary catches React errors
- [ ] Terminal scrolls to bottom on new output
- [ ] Abort button cancels in-progress installs
- [ ] Progress bar updates correctly
- [ ] All 6 UI library adapters load components
- [ ] Variant selection works (e.g., button variants)
- [ ] Install queue shows selected commands
- [ ] VFS save bridge syncs changes back to CodePreviewPanel

---

## 📦 Dependencies Required

Ensure these are installed:
```json
{
  "@craftjs/core": "^0.x",
  "@craftjs/layers": "^0.x",
  "lucide-react": "^0.x",
  "next": "^14.x",
  "react": "^18.x",
  "react-dom": "^18.x"
}
```

---

## 🚀 Usage

1. **Open Visual Editor** from Code Preview Panel
2. **Click "Install"** button in Component Library
3. **Select UI Library** (HeroUI, shadcn, Magic UI, etc.)
4. **Search & Select Components** (expand for variants)
5. **Review Queue** (shows npx commands)
6. **Click Install** (streams output to terminal)
7. **Wait for Completion** (or Abort to cancel)
8. **Components installed** in project directory

---

## 📝 Changelog

**v2.0.0 - CLI Installer Integration**
- ✅ Added `/api/cli-install` route
- ✅ Added ComponentInstaller modal
- ✅ Added 6 UI library adapters (148 components total)
- ✅ Added error boundary
- ✅ Added environment variables
- ✅ Fixed terminal scroll layout
- ✅ Added comprehensive documentation
- ✅ Cleaned up old source files

---

**Status:** ✅ All identified issues resolved
**Date:** March 5, 2026
