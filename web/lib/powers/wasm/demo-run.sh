#!/usr/bin/env bash
# examples/demo-run.sh — build everything and run the end-to-end demo
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "════════════════════════════════════════"
echo " Skill WASM Runner — Full Demo"
echo "════════════════════════════════════════"

# 1. Build Rust skill → wasm
echo ""
echo "Step 1: Building Rust skill to wasm32-wasi..."
cd "$ROOT/rust-skill"
chmod +x build.sh
./build.sh

# 2. Install Node dependencies
echo ""
echo "Step 2: Installing Node dependencies..."
cd "$ROOT/server"
npm install --silent

# 3. Compile TypeScript
echo ""
echo "Step 3: Compiling TypeScript..."
npm run build

# 4. Run the demo
echo ""
echo "Step 4: Running end-to-end demo..."
node ./dist/index.js
