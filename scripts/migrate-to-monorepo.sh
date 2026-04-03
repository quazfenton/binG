#!/bin/bash
# Migration Script: Restructure to app/ + desktop/ layout
#
# This script reorganizes the codebase from:
#   /app, /components, /lib, /hooks, /contexts, /tauri/
# To:
#   /app/ (shared Next.js codebase)
#   /desktop/ (Tauri wrapper with src-tauri/)
#
# Usage: bash migrate-to-monorepo.sh
# Run from project root.

set -e  # Exit on error

echo "========================================="
echo "  binG Monorepo Migration Script"
echo "========================================="
echo ""

# Check we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "app" ] || [ ! -d "tauri" ]; then
  echo "❌ Error: Must run from project root (needs package.json, app/, tauri/)"
  exit 1
fi

echo "📋 Current structure detected:"
echo "   ✓ package.json"
echo "   ✓ app/"
echo "   ✓ tauri/"
echo ""

# Create backup
BACKUP_DIR="migration-backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating backup at: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -r app "$BACKUP_DIR/" 2>/dev/null || true
cp -r components "$BACKUP_DIR/" 2>/dev/null || true
cp -r lib "$BACKUP_DIR/" 2>/dev/null || true
cp -r hooks "$BACKUP_DIR/" 2>/dev/null || true
cp -r contexts "$BACKUP_DIR/" 2>/dev/null || true
cp -r tauri "$BACKUP_DIR/" 2>/dev/null || true
cp package.json "$BACKUP_DIR/" 2>/dev/null || true
cp tsconfig.json "$BACKUP_DIR/" 2>/dev/null || true
cp next.config.mjs "$BACKUP_DIR/" 2>/dev/null || true
echo "   ✓ Backup created"
echo ""

# Step 1: Create new app/ structure
echo "📁 Step 1: Creating new app/ structure..."

# Create temporary directory for new app structure
mkdir -p _new_app

# Move shared directories into new app/
for dir in components lib hooks contexts styles public; do
  if [ -d "$dir" ]; then
    echo "   Moving $dir/ → _new_app/$dir/"
    mv "$dir" "_new_app/$dir/"
  fi
done

# Move Next.js app router (currently app/) into new structure
if [ -d "app" ]; then
  echo "   Moving app/ → _new_app/app/"
  mv app "_new_app/app/"
fi

# Move Next.js config files
for file in next.config.mjs next.config.js tsconfig.json postcss.config.mjs tailwind.config.ts components.json; do
  if [ -f "$file" ]; then
    echo "   Moving $file → _new_app/$file"
    mv "$file" "_new_app/$file"
  fi
done

# Move package.json to app/
if [ -f "package.json" ]; then
  echo "   Moving package.json → _new_app/package.json"
  mv package.json "_new_app/package.json"
fi

# Rename _new_app to app
if [ -d "app" ]; then
  echo "   ⚠️  app/ already exists (should have been moved). Cleaning up..."
  rm -rf app
fi
mv _new_app app
echo "   ✓ app/ structure created"
echo ""

# Step 2: Create desktop/ structure
echo "📁 Step 2: Creating desktop/ structure..."

mkdir -p desktop

# Move tauri content to desktop/
if [ -d "tauri" ]; then
  echo "   Moving tauri/ content → desktop/"
  # Move everything except node_modules
  for item in tauri/*; do
    if [ -e "$item" ] && [ "$(basename "$item")" != "node_modules" ]; then
      mv "$item" "desktop/"
    fi
  done
  rmdir tauri 2>/dev/null || true
  echo "   ✓ tauri/ → desktop/"
fi

# Create desktop entry point
cat > desktop/entry.ts << 'EOF'
/**
 * Desktop Entry Point
 *
 * Initializes Tauri-specific features before Next.js hydration.
 * This file is imported by the desktop app wrapper.
 */

import { isTauriRuntime } from '../app/lib/platform/env';

if (isTauriRuntime()) {
  console.log('[Desktop] Running in Tauri shell');

  // Set desktop environment variables
  if (typeof process !== 'undefined' && process.env) {
    process.env.DESKTOP_MODE = 'true';
    process.env.DESKTOP_LOCAL_EXECUTION = 'true';
  }

  // Initialize Tauri-specific features here
  // e.g., register custom commands, setup native integrations
}

// Re-export platform for convenience
export * from '../app/lib/platform';
EOF
echo "   ✓ Created desktop/entry.ts"
echo ""

# Step 3: Create root workspace config
echo "📁 Step 3: Creating workspace configuration..."

cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'app'
  - 'desktop'
EOF
echo "   ✓ Created pnpm-workspace.yaml"

# Create root package.json
cat > package.json << 'EOF'
{
  "name": "bing-monorepo",
  "private": true,
  "scripts": {
    "dev:web": "pnpm --filter app dev",
    "dev:desktop": "pnpm --filter desktop tauri dev",
    "build:web": "pnpm --filter app build",
    "build:desktop": "pnpm --filter desktop tauri build",
    "start:web": "pnpm --filter app start",
    "type-check": "pnpm --filter app type-check",
    "lint": "pnpm --filter app lint",
    "test": "pnpm --filter app test"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
EOF
echo "   ✓ Created root package.json"

# Create turbo.json (optional, for future build optimization)
cat > turbo.json << 'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
EOF
echo "   ✓ Created turbo.json"
echo ""

# Step 4: Update app/package.json
echo "📝 Step 4: Updating app/package.json..."

if [ -f "app/package.json" ]; then
  # Add workspace name and scripts
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('app/package.json', 'utf8'));
    pkg.name = '@bing/web';
    pkg.scripts = pkg.scripts || {};
    pkg.scripts['type-check'] = 'tsc --noEmit';
    fs.writeFileSync('app/package.json', JSON.stringify(pkg, null, 2));
  "
  echo "   ✓ Updated app/package.json"
fi
echo ""

# Step 5: Update desktop/package.json
echo "📝 Step 5: Updating desktop/package.json..."

if [ -f "desktop/package.json" ]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8'));
    pkg.name = '@bing/desktop';
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies['@tauri-apps/api'] = '^2.0.0';
    pkg.dependencies['@tauri-apps/plugin-fs'] = '^2.0.0';
    pkg.dependencies['@tauri-apps/plugin-dialog'] = '^2.0.0';
    pkg.dependencies['@tauri-apps/plugin-clipboard-manager'] = '^2.0.0';
    pkg.dependencies['@tauri-apps/plugin-notification'] = '^2.0.0';
    pkg.dependencies['@tauri-apps/plugin-secure-store'] = '^2.0.0';
    fs.writeFileSync('desktop/package.json', JSON.stringify(pkg, null, 2));
  "
  echo "   ✓ Updated desktop/package.json"
fi
echo ""

# Step 6: Update tsconfig.json paths
echo "📝 Step 6: Updating TypeScript paths..."

if [ -f "app/tsconfig.json" ]; then
  node -e "
    const fs = require('fs');
    const tsconfig = JSON.parse(fs.readFileSync('app/tsconfig.json', 'utf8'));
    tsconfig.compilerOptions = tsconfig.compilerOptions || {};
    tsconfig.compilerOptions.baseUrl = '.';
    tsconfig.compilerOptions.paths = tsconfig.compilerOptions.paths || {};
    tsconfig.compilerOptions.paths['@/*'] = ['./*'];
    tsconfig.compilerOptions.paths['@bing/platform'] = ['./lib/platform/index.ts'];
    tsconfig.compilerOptions.paths['@bing/platform/*'] = ['./lib/platform/*'];
    fs.writeFileSync('app/tsconfig.json', JSON.stringify(tsconfig, null, 2));
  "
  echo "   ✓ Updated app/tsconfig.json"
fi
echo ""

# Step 7: Update Tauri config to point to new app/ location
echo "📝 Step 7: Updating Tauri config..."

if [ -f "desktop/tauri.conf.json" ]; then
  node -e "
    const fs = require('fs');
    const tauri = JSON.parse(fs.readFileSync('desktop/tauri.conf.json', 'utf8'));
    tauri.build = tauri.build || {};
    tauri.build.devUrl = 'http://localhost:3000';
    tauri.build.frontendDist = '../app/.next';
    fs.writeFileSync('desktop/tauri.conf.json', JSON.stringify(tauri, null, 2));
  "
  echo "   ✓ Updated desktop/tauri.conf.json"
fi
echo ""

# Step 8: Create .gitignore entries
echo "📝 Step 8: Updating .gitignore..."

if [ -f ".gitignore" ]; then
  # Add migration backup to gitignore
  echo "" >> .gitignore
  echo "# Migration backups" >> .gitignore
  echo "migration-backup-*/" >> .gitignore
  echo "   ✓ Updated .gitignore"
fi
echo ""

# Step 9: Install dependencies
echo "📦 Step 9: Installing dependencies..."
echo "   Running pnpm install..."
pnpm install
echo "   ✓ Dependencies installed"
echo ""

# Step 10: Verify structure
echo "========================================="
echo "  Migration Complete!"
echo "========================================="
echo ""
echo "New structure:"
echo "  /app/              ← Shared Next.js codebase"
echo "  /desktop/          ← Tauri desktop wrapper"
echo "  /package.json      ← Root workspace"
echo "  /pnpm-workspace.yaml"
echo ""
echo "Commands:"
echo "  pnpm dev:web       ← Start Next.js web app"
echo "  pnpm dev:desktop   ← Start Tauri desktop app"
echo "  pnpm build:web     ← Build web app"
echo "  pnpm build:desktop ← Build desktop app"
echo ""
echo "⚠️  Backup saved at: $BACKUP_DIR"
echo ""
echo "Next steps:"
echo "  1. Test web app: pnpm dev:web"
echo "  2. Test desktop app: pnpm dev:desktop"
echo "  3. Update any hardcoded paths in your code"
echo "  4. Remove backup when confident: rm -rf $BACKUP_DIR"
echo ""
