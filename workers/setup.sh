#!/usr/bin/env bash
# ============================================================
#  binG Cloudflare Edge Gateway — Full Setup & Deploy
# ============================================================
# Prerequisites:
#   - wrangler CLI installed (included via devDependencies)
#   - Cloudflare account with Workers paid plan (for KV + R2 + D1)
#   - Vercel frontend already deployed (get its URL)
#   - OCI backend already deployed (or planned — get its URL)
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================="
echo " binG Edge Gateway — Cloudflare Setup  "
echo "========================================="

# ─── Step 1: Check/Login to Cloudflare ─────────────────────
echo ""
echo "📌 Step 1: Cloudflare Authentication"
echo "-------------------------------------"
if npx wrangler whoami 2>/dev/null; then
  echo "✅ Already logged in to Cloudflare."
else
  echo "🔑 Please login to Cloudflare..."
  npx wrangler login
  echo "✅ Login complete."
fi

# ─── Step 2: Create KV Namespace ───────────────────────────
echo ""
echo "📌 Step 2: Create KV Namespace (Rate Limiting + Cache)"
echo "-------------------------------------------------------"
KV_ID=$(npx wrangler kv namespace create bing-kv 2>&1 | grep -oP 'id = "\K[^"]+' || true)
if [ -z "$KV_ID" ]; then
  # Maybe it already exists
  KV_ID=$(npx wrangler kv namespace list 2>&1 | grep -oP '"bing-kv".*?"id":"\K[^"]+' || true)
fi

if [ -n "$KV_ID" ]; then
  echo "✅ KV Namespace ID: $KV_ID"
  # Update wrangler.toml with the KV ID
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^id = \"\"/id = \"$KV_ID\"/" wrangler.toml
    sed -i '' "s/^preview_id = \"\"/preview_id = \"$KV_ID\"/" wrangler.toml
  else
    sed -i "s/^id = \"\"/id = \"$KV_ID\"/" wrangler.toml
    sed -i "s/^preview_id = \"\"/preview_id = \"$KV_ID\"/" wrangler.toml
  fi
else
  echo "⚠️  Could not create/find KV namespace. Check wrangler auth."
  exit 1
fi

# ─── Step 3: Create R2 Bucket ──────────────────────────────
echo ""
echo "📌 Step 3: Create R2 Bucket (File Storage)"
echo "-------------------------------------------"
if npx wrangler r2 bucket list 2>&1 | grep -q 'bing-storage'; then
  echo "✅ R2 bucket 'bing-storage' already exists."
else
  npx wrangler r2 bucket create bing-storage
  echo "✅ R2 bucket 'bing-storage' created."
fi

# ─── Step 4: Create D1 Database ────────────────────────────
echo ""
echo "📌 Step 4: Create D1 Database (SQL Storage)"
echo "---------------------------------------------"
D1_ID=$(npx wrangler d1 create bing-db 2>&1 | grep -oP 'database_id = "\K[^"]+' || true)
if [ -z "$D1_ID" ]; then
  D1_ID=$(npx wrangler d1 list 2>&1 | grep -oP '"bing-db".*?"uuid":"\K[^"]+' || true)
fi

if [ -n "$D1_ID" ]; then
  echo "✅ D1 Database ID: $D1_ID"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/database_id = \"\"/database_id = \"$D1_ID\"/" wrangler.toml
  else
    sed -i "s/database_id = \"\"/database_id = \"$D1_ID\"/" wrangler.toml
  fi
else
  echo "⚠️  Could not create/find D1 database. Check wrangler auth."
  exit 1
fi

# ─── Step 5: Set Environment Secrets ───────────────────────
echo ""
echo "📌 Step 5: Set Environment Variables"
echo "-------------------------------------"

# Frontend URL (Vercel)
read -rp "Vercel Frontend URL (e.g., https://bing.vercel.app): " FRONTEND_URL
echo "$FRONTEND_URL" | npx wrangler secret put FRONTEND_URL
echo "✅ FRONTEND_URL set"

# Backend URL (OCI)
read -rp "OCI Backend URL (e.g., https://api.bing.dev, or leave blank): " BACKEND_URL
if [ -n "$BACKEND_URL" ]; then
  echo "$BACKEND_URL" | npx wrangler secret put BACKEND_URL
  echo "✅ BACKEND_URL set"
else
  echo "⚠️  BACKEND_URL not set — API routes will fallback to Vercel frontend."
fi

# JWT Secret
read -rsp "JWT Secret (press Enter to generate one): " JWT_SECRET
echo
if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(openssl rand -base64 48)
  echo "   ✅ Generated a new JWT Secret (saved to .jwt-secret for reference)"
  echo "$JWT_SECRET" > .jwt-secret
  chmod 600 .jwt-secret
fi
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
echo "✅ JWT_SECRET set"

# Allowed Origins
read -rp "Allowed CORS origins (comma-separated, e.g., https://bing.vercel.app): " ALLOWED_ORIGINS
if [ -n "$ALLOWED_ORIGINS" ]; then
  echo "$ALLOWED_ORIGINS" | npx wrangler secret put ALLOWED_ORIGINS
  echo "✅ ALLOWED_ORIGINS set"
fi

# ─── Step 6: Generate Wrangler Types ───────────────────────
echo ""
echo "📌 Step 6: Generate TypeScript Types"
echo "-------------------------------------"
npx wrangler types
echo "✅ worker-configuration.d.ts generated"

# ─── Step 7: Deploy ────────────────────────────────────────
echo ""
echo "📌 Step 7: Deploy to Cloudflare Workers"
echo "----------------------------------------"
read -rp "Deploy now? (Y/n): " DEPLOY_NOW
if [[ "$DEPLOY_NOW" =~ ^[Yy]?$ ]]; then
  npx wrangler deploy
  echo ""
  echo "========================================="
  echo " ✅ Deployment complete!"
  echo "========================================="
  echo ""
  echo "Next steps:"
  echo "  1. Set up custom domain in Cloudflare Dashboard"
  echo "  2. Point DNS: api.bing.dev CNAME → your-worker.your-subdomain.workers.dev"
  echo "  3. Update Vercel FRONTEND_URL env var to use the worker URL"
  echo "  4. Update OCI BACKEND_URL to accept forwarded requests"
else
  echo "Skipping deploy. Run later with: cd workers/edge-gateway && npx wrangler deploy"
fi

echo ""
echo "Done! 🎉"
