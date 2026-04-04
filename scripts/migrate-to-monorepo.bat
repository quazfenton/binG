@echo off
REM Migration Script: Restructure to app/ + desktop/ layout (Windows)
REM
REM This script reorganizes the codebase from:
REM   /app, /components, /lib, /hooks, /contexts, /tauri/
REM To:
REM   /app/ (shared Next.js codebase)
REM   /desktop/ (Tauri wrapper with src-tauri/)
REM
REM Usage: migrate-to-monorepo.bat
REM Run from project root in Command Prompt.

echo =========================================
echo   binG Monorepo Migration Script (Windows)
echo =========================================
echo.

REM Check we're in the right directory
if not exist "package.json" (
    echo ERROR: package.json not found. Run from project root.
    pause
    exit /b 1
)
if not exist "app" (
    echo ERROR: app/ directory not found. Run from project root.
    pause
    exit /b 1
)
if not exist "tauri" (
    echo ERROR: tauri/ directory not found. Run from project root.
    pause
    exit /b 1
)

echo Current structure detected:
echo    [OK] package.json
echo    [OK] app/
echo    [OK] tauri/
echo.

REM Create backup
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YY=%dt:~2,2%" & set "YYYY=%dt:~0,4%" & set "MM=%dt:~4,2%" & set "DD=%dt:~6,2%"
set "HH=%dt:~8,2%" & set "Min=%dt:~10,2%" & set "Sec=%dt:~12,2%"
set "BACKUP_DIR=migration-backup-%YYYY%%MM%%DD%-%HH%%Min%%Sec%"

echo Creating backup at: %BACKUP_DIR%
mkdir "%BACKUP_DIR%"
xcopy /E /I /Q app "%BACKUP_DIR%\app" >nul 2>&1
xcopy /E /I /Q components "%BACKUP_DIR%\components" >nul 2>&1
xcopy /E /I /Q lib "%BACKUP_DIR%\lib" >nul 2>&1
xcopy /E /I /Q hooks "%BACKUP_DIR%\hooks" >nul 2>&1
xcopy /E /I /Q contexts "%BACKUP_DIR%\contexts" >nul 2>&1
xcopy /E /I /Q tauri "%BACKUP_DIR%\tauri" >nul 2>&1
copy package.json "%BACKUP_DIR%\" >nul 2>&1
copy tsconfig.json "%BACKUP_DIR%\" >nul 2>&1
copy next.config.mjs "%BACKUP_DIR%\" >nul 2>&1
echo    [OK] Backup created
echo.

REM Step 1: Create new app/ structure
echo Step 1: Creating new app/ structure...

mkdir _new_app
mkdir _new_app\app

REM Move shared Next.js directories into new app/
for %%d in (components lib hooks contexts styles public types __tests__) do (
    if exist "%%d" (
        echo    Moving %%d/ to _new_app/%%d/
        move "%%d" "_new_app\%%d\" >nul
    )
)

REM Move Next.js app router into new structure
if exist "app" (
    echo    Moving app/ to _new_app/app/
    xcopy /E /I /Q app "_new_app\app" >nul
    rmdir /S /Q app
)

REM Move Next.js config files
for %%f in (next.config.mjs next.config.js tsconfig.json postcss.config.mjs tailwind.config.ts tailwind.config.js components.json) do (
    if exist "%%f" (
        echo    Moving %%f to _new_app/
        move "%%f" "_new_app\" >nul
    )
)

REM Move package.json to app/
if exist "package.json" (
    echo    Moving package.json to _new_app/
    move "package.json" "_new_app\" >nul
)

REM Rename _new_app to app
if exist "app" (
    echo    WARNING: app/ already exists. Cleaning up...
    rmdir /S /Q app
)
rename _new_app app
echo    [OK] app/ structure created
echo.

REM Step 1b: Create packages/shared/ for shared packages
echo Step 1b: Creating packages/shared/ structure...

mkdir packages 2>nul
mkdir packages\shared

REM Move shared packages
for %%d in (mcp services worker trigger cli) do (
    if exist "%%d" (
        echo    Moving %%d/ to packages/shared/%%d/
        move "%%d" "packages\shared\%%d\" >nul
    )
)
echo    [OK] packages/shared/ structure created
echo.

REM Step 1c: Create infra/ for infrastructure
echo Step 1c: Organizing infrastructure files...

mkdir infra 2>nul

REM Move Docker files to infra/
for %%f in (docker-compose.yml docker-compose.dev.yml docker-compose.prod.yml docker-compose.modes.yml docker-compose.v2.yml) do (
    if exist "%%f" (
        echo    Moving %%f to infra/
        move "%%f" "infra\" >nul
    )
)
for %%f in (Dockerfile Dockerfile.agent Dockerfile.dev Dockerfile.gateway Dockerfile.mcp Dockerfile.preview Dockerfile.sandbox Dockerfile.worker) do (
    if exist "%%f" (
        echo    Moving %%f to infra/
        move "%%f" "infra\" >nul
    )
)
echo    [OK] Infrastructure files organized
echo.

REM Step 1d: Move documentation to docs/
echo Step 1d: Organizing documentation...

mkdir docs 2>nul

REM Move markdown files to docs/
for %%f in (*.md) do (
    if not "%%f"=="MIGRATION_SCRIPTS.md" (
        echo    Moving %%f to docs/
        move "%%f" "docs\" >nul
    )
)
echo    [OK] Documentation organized
echo.

REM Step 1e: Organize test files
echo Step 1e: Organizing test files...

if exist "tests" (
    echo    Moving tests/ to test/tests/
    mkdir test\tests 2>nul
    xcopy /E /I /Q tests test\tests >nul
    rmdir /S /Q tests
)
echo    [OK] Test files organized
echo.

REM Step 1f: Organize data and scripts
echo Step 1f: Organizing data and scripts...

mkdir data 2>nul
mkdir scripts 2>nul

REM Move migration scripts
for %%f in (migrate-to-monorepo.bat migrate-to-monorepo.sh desktop-entry.ts package.root.json) do (
    if exist "%%f" (
        echo    Moving %%f to scripts/
        move "%%f" "scripts\" >nul
    )
)
echo    [OK] Data and scripts organized
echo.

REM Step 2: Create desktop/ structure
echo Step 2: Creating desktop/ structure...

mkdir desktop

REM Move tauri content to desktop/
if exist "tauri" (
    echo    Moving tauri/ content to desktop/
    for /d %%d in (tauri\*) do (
        if not "%%~nxd"=="node_modules" (
            move "%%d" "desktop\" >nul
        )
    )
    for %%f in (tauri\*) do (
        move "%%f" "desktop\" >nul
    )
    rmdir tauri 2>nul
    echo    [OK] tauri/ moved to desktop/
)

REM Create desktop entry point
(
echo /**
echo  * Desktop Entry Point
echo  *
echo  * Initializes Tauri-specific features before Next.js hydration.
echo  */
echo.
echo import { isTauriRuntime } from '../app/lib/platform/env';
echo.
echo if ^(isTauriRuntime^()^) {
echo   console.log^('[Desktop] Running in Tauri shell'^);
echo.
echo   if ^(typeof process !== 'undefined' ^&^& process.env^) {
echo     process.env.DESKTOP_MODE = 'true';
echo     process.env.DESKTOP_LOCAL_EXECUTION = 'true';
echo   }
echo }
echo.
echo export * from '../app/lib/platform';
) > desktop\entry.ts
echo    [OK] Created desktop/entry.ts
echo.

REM Step 3: Create root workspace config
echo Step 3: Creating workspace configuration...

(
echo packages:
echo   - 'app'
echo   - 'desktop'
) > pnpm-workspace.yaml
echo    [OK] Created pnpm-workspace.yaml

(
echo {
echo   "name": "bing-monorepo",
echo   "private": true,
echo   "scripts": {
echo     "dev:web": "pnpm --filter app dev",
echo     "dev:desktop": "pnpm --filter desktop tauri dev",
echo     "build:web": "pnpm --filter app build",
echo     "build:desktop": "pnpm --filter desktop tauri build",
echo     "start:web": "pnpm --filter app start",
echo     "type-check": "pnpm --filter app type-check",
echo     "lint": "pnpm --filter app lint",
echo     "test": "pnpm --filter app test"
echo   },
echo   "devDependencies": {
echo     "turbo": "^2.0.0"
echo   }
echo }
) > package.json
echo    [OK] Created root package.json

(
echo {
echo   "$schema": "https://turbo.build/schema.json",
echo   "pipeline": {
echo     "build": {
echo       "dependsOn": ["^build"],
echo       "outputs": [".next/**", "!.next/cache/**"]
echo     },
echo     "dev": {
echo       "cache": false,
echo       "persistent": true
echo     }
echo   }
echo }
) > turbo.json
echo    [OK] Created turbo.json
echo.

REM Step 4: Update app/package.json
echo Step 4: Updating app/package.json...

if exist "app\package.json" (
    node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('app/package.json','utf8')); p.name='@bing/web'; p.scripts=p.scripts||{}; p.scripts['type-check']='tsc --noEmit'; fs.writeFileSync('app/package.json',JSON.stringify(p,null,2));"
    echo    [OK] Updated app/package.json
)
echo.

REM Step 5: Update desktop/package.json
echo Step 5: Updating desktop/package.json...

if exist "desktop\package.json" (
    node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('desktop/package.json','utf8')); p.name='@bing/desktop'; p.dependencies=p.dependencies||{}; p.dependencies['@tauri-apps/api']='^2.0.0'; p.dependencies['@tauri-apps/plugin-fs']='^2.0.0'; p.dependencies['@tauri-apps/plugin-dialog']='^2.0.0'; p.dependencies['@tauri-apps/plugin-clipboard-manager']='^2.0.0'; p.dependencies['@tauri-apps/plugin-notification']='^2.0.0'; p.dependencies['@tauri-apps/plugin-secure-store']='^2.0.0'; fs.writeFileSync('desktop/package.json',JSON.stringify(p,null,2));"
    echo    [OK] Updated desktop/package.json
)
echo.

REM Step 6: Update tsconfig.json paths
echo Step 6: Updating TypeScript paths...

if exist "app\tsconfig.json" (
    node -e "const fs=require('fs'); const t=JSON.parse(fs.readFileSync('app/tsconfig.json','utf8')); t.compilerOptions=t.compilerOptions||{}; t.compilerOptions.baseUrl='.'; t.compilerOptions.paths=t.compilerOptions.paths||{}; t.compilerOptions.paths['@/*']=['./*']; t.compilerOptions.paths['@bing/platform']=['./lib/platform/index.ts']; t.compilerOptions.paths['@bing/platform/*']=['./lib/platform/*']; fs.writeFileSync('app/tsconfig.json',JSON.stringify(t,null,2));"
    echo    [OK] Updated app/tsconfig.json
)
echo.

REM Step 7: Update Tauri config
echo Step 7: Updating Tauri config...

if exist "desktop\tauri.conf.json" (
    node -e "const fs=require('fs'); const t=JSON.parse(fs.readFileSync('desktop/tauri.conf.json','utf8')); t.build=t.build||{}; t.build.devUrl='http://localhost:3000'; t.build.frontendDist='../app/.next'; fs.writeFileSync('desktop/tauri.conf.json',JSON.stringify(t,null,2));"
    echo    [OK] Updated desktop/tauri.conf.json
)
echo.

REM Step 8: Update .gitignore
echo Step 8: Updating .gitignore...

if exist ".gitignore" (
    echo. >> .gitignore
    echo # Migration backups >> .gitignore
    echo migration-backup-*/ >> .gitignore
    echo    [OK] Updated .gitignore
)
echo.

REM Step 9: Verify structure (NO dependency install - run manually)
echo =========================================
echo   Migration Complete!
echo =========================================
echo.
echo New structure:
echo   /app/              - Shared Next.js codebase
echo   /desktop/          - Tauri desktop wrapper
echo   /packages/shared/  - Shared packages (mcp, services, etc.)
echo   /infra/            - Docker/infrastructure files
echo   /docs/             - Documentation
echo   /scripts/          - Migration scripts
echo   /data/             - Data files
echo   /package.json      - Root workspace
echo   /pnpm-workspace.yaml
echo.
echo IMPORTANT: Run dependency install manually:
echo   pnpm install
echo.
echo Commands (after install):
echo   pnpm dev:web       - Start Next.js web app
echo   pnpm dev:desktop   - Start Tauri desktop app
echo   pnpm build:web     - Build web app
echo   pnpm build:desktop - Build desktop app
echo.
echo WARNING: Backup saved at: %BACKUP_DIR%
echo.
echo Next steps:
echo   1. Review new structure: dir /b
echo   2. Install dependencies: pnpm install
echo   3. Test web app: pnpm dev:web
echo   4. Test desktop app: pnpm dev:desktop
echo   5. Update any hardcoded paths in your code
echo   6. Remove backup when confident: rmdir /S /Q %BACKUP_DIR%
echo.
pause
