#!/usr/bin/env bash
# ── binG Modal Deployment Script ────────────────────────────────────
# Run: bash workers/modal/setup.sh
# 
# Prerequisites:
#   1. pip install modal
#   2. modal token new  (or already authenticated)
#   3. Fill in workers/modal/.env with your API keys
#
# This script:
#   1. Checks Modal CLI is installed and authenticated
#   2. Creates the bing-modal-secrets secret from .env
#   3. Creates model cache and workspace volumes
#   4. Deploys the Modal app
#   5. Shows the deployment URL and health check
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "┌──────────────────────────────────────────────────────────┐"
echo "│       binG Modal — Deployment Script                    │"
echo "└──────────────────────────────────────────────────────────┘"

# ── Step 1: Check Modal CLI ──────────────────────────────────────
echo ""
echo "📦 Step 1: Checking Modal CLI..."

if ! command -v modal &>/dev/null; then
    echo "   ❌ 'modal' CLI not found. Installing..."
    pip install modal
fi

echo "   ✅ modal CLI available"

# Check authentication
if ! modal profile current &>/dev/null; then
    echo "   ❌ Not authenticated. Run: modal token new"
    echo "      Or set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET env vars."
    exit 1
fi

ACCOUNT_NAME=$(modal profile current 2>/dev/null | head -1 | awk '{print $NF}')
echo "   ✅ Authenticated as: $ACCOUNT_NAME"

# ── Step 2: Load Environment ─────────────────────────────────────
echo ""
echo "🔑 Step 2: Loading environment variables..."

if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "   ✅ Loaded .env"
else
    echo "   ⚠️  No .env found. Using existing secrets or defaults."
fi

# ── Step 3: Create Modal Secrets ─────────────────────────────────
echo ""
echo "🔒 Step 3: Creating Modal secrets..."

SECRET_NAME="bing-modal-secrets"

# Gather all env vars to store as secrets
SECRET_VARS=(
    "BACKEND_URL"
    "OPENAI_API_KEY"
    "ANTHROPIC_API_KEY"
    "MISTRAL_API_KEY"
    "TOGETHER_API_KEY"
    "R2_ACCESS_KEY_ID"
    "R2_SECRET_ACCESS_KEY"
    "R2_ENDPOINT"
    "R2_BUCKET"
)

# Build the secret create command
SECRET_CMD="modal secret create $SECRET_NAME"
HAS_SECRETS=false
for VAR in "${SECRET_VARS[@]}"; do
    if [ -n "${!VAR:-}" ]; then
        SECRET_CMD+=" $VAR=${!VAR}"
        HAS_SECRETS=true
        echo "   ✅ Adding $VAR"
    fi
done

if [ "$HAS_SECRETS" = true ]; then
    # Delete existing secret if it exists (ignore error)
    modal secret delete "$SECRET_NAME" 2>/dev/null || true
    eval "$SECRET_CMD"
    echo "   ✅ Secret '$SECRET_NAME' created/updated"
else
    echo "   ⚠️  No secrets to add. Create them manually:"
    echo "      modal secret create $SECRET_NAME OPENAI_API_KEY=... ANTHROPIC_API_KEY=..."
    echo "      Then re-run this script."
fi

# ── Step 4: Create Modal Volumes ─────────────────────────────────
echo ""
echo "💾 Step 4: Creating Modal volumes..."

for VOL in "bing-model-cache" "bing-workspace"; do
    if modal volume ls 2>/dev/null | grep -q "$VOL"; then
        echo "   ✅ Volume '$VOL' already exists"
    else
        modal volume create "$VOL"
        echo "   ✅ Created volume '$VOL'"
    fi
done

# ── Step 5: Deploy ───────────────────────────────────────────────
echo ""
echo "🚀 Step 5: Deploying Modal app..."

DEPLOY_OUTPUT=$(modal deploy app.py 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract the deployment URL (use -oE for macOS/GNU grep compatibility)
DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^[:space:]]+' | head -1 || true)

if [ -n "$DEPLOY_URL" ]; then
    echo ""
    echo "┌──────────────────────────────────────────────────────────┐"
    echo "│  ✅ Deployment Complete!                                │"
    echo "│                                                         │"
    echo "│  📍 URL: $DEPLOY_URL"
    echo "│  🏥 Health: ${DEPLOY_URL}health"
    echo "│                                                         │"
    echo "│  To test:                                               │"
    echo "│    curl ${DEPLOY_URL}health                    │"
    echo "│    curl -X POST ${DEPLOY_URL}api/sandbox/run \\"
    echo "│      -H 'Content-Type: application/json' \\"
    echo "│      -d '{\"code\":\"print(42)\",\"language\":\"python\"}'"
    echo "└──────────────────────────────────────────────────────────┘"
else
    echo ""
    echo "⚠️  Could not extract deployment URL. Check the output above."
fi

echo ""
echo "✨ binG Modal deployed successfully!"
