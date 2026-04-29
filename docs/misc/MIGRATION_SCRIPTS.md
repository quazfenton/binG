# Migration Scripts Created

## Files Created

| File | Purpose |
|------|---------|
| `migrate-to-monorepo.sh` | Bash script (Linux/macOS/Git Bash) |
| `migrate-to-monorepo.bat` | Windows batch script |
| `pnpm-workspace.yaml` | pnpm workspace definition |
| `package.root.json` | Root package.json template |
| `desktop-entry.ts` | Desktop entry point template |

## How to Run

### Windows (Recommended)
```cmd
migrate-to-monorepo.bat
```

### Linux/macOS/Git Bash
```bash
chmod +x migrate-to-monorepo.sh
bash migrate-to-monorepo.sh
```

## What the Script Does

1. **Creates backup** → `migration-backup-YYYYMMDD-HHMMSS/`
2. **Moves shared code** → `components/`, `lib/`, `hooks/`, `contexts/`, `styles/`, `public/` → `app/`
3. **Moves Next.js app** → `app/` → `app/app/`
4. **Moves config files** → `next.config.mjs`, `tsconfig.json`, etc. → `app/`
5. **Creates desktop/** → Moves `tauri/` content → `desktop/`
6. **Creates workspace config** → `pnpm-workspace.yaml`, root `package.json`, `turbo.json`
7. **Updates package.json files** → Adds `@bing/web` and `@bing/desktop` names
8. **Updates TypeScript paths** → Adds `@bing/platform/*` aliases
9. **Updates Tauri config** → Points `frontendDist` to `../app/.next`
10. **Installs dependencies** → `pnpm install`

## After Migration

```
/
├── app/                    # Shared Next.js codebase
│   ├── app/                # Next.js app router
│   ├── components/
│   ├── lib/
│   │   └── platform/       # Platform abstractions
│   ├── hooks/
│   ├── contexts/
│   ├── next.config.mjs
│   ├── tsconfig.json
│   └── package.json        # @bing/web
│
├── desktop/                # Tauri desktop wrapper
│   ├── src-tauri/          # Rust backend
│   ├── entry.ts            # Desktop entry point
│   ├── tauri.conf.json
│   └── package.json        # @bing/desktop
│
├── package.json            # Root workspace
├── pnpm-workspace.yaml
└── turbo.json
```

## Commands After Migration

```bash
pnpm dev:web        # Start Next.js web app
pnpm dev:desktop    # Start Tauri desktop app
pnpm build:web      # Build web app
pnpm build:desktop  # Build desktop app
```

## Rollback

If something goes wrong, the script creates a backup:
```bash
# Delete current structure
rm -rf app desktop

# Restore from backup
mv migration-backup-YYYYMMDD-HHMMSS/* .
rmdir migration-backup-YYYYMMDD-HHMMSS
```

## Safety Features

- ✅ Automatic backup before any changes
- ✅ Checks for required directories before starting
- ✅ Preserves all files (no deletions)
- ✅ Verifies structure after migration
- ✅ Clear success/failure messages
