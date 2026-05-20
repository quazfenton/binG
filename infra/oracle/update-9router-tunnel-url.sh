#!/bin/bash
# Update 9Router's OAuth redirect URIs to include the Cloudflare Tunnel URL
# This fixes the "An error occurred. Please try again" login issue on HTTPS tunnel
#
# Usage: ./update-9router-tunnel-url.sh [tunnel-url]
# Example: ./update-9router-tunnel-url.sh https://abc123.trycloudflare.com

set -e

# Get tunnel URL from docker logs if not provided
TUNNEL_URL="${1:-}"
if [ -z "$TUNNEL_URL" ]; then
  echo "Extracting tunnel URL from docker logs..."
  TUNNEL_URL=$(docker logs bing-cloudflared-1 2>&1 | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1)
  
  if [ -z "$TUNNEL_URL" ]; then
    echo "Error: Could not detect tunnel URL from docker logs."
    echo "Usage: $0 <tunnel-url>"
    echo "Example: $0 https://abc123.trycloudflare.com"
    exit 1
  fi
fi

echo "Detected tunnel URL: $TUNNEL_URL"

# Access 9Router's SQLite database inside the container
CONTAINER_NAME="bing-ninerouter-1"
DB_PATH="/root/.9router/9router.db"

echo "Updating 9Router configuration in container: $CONTAINER_NAME"

# Update the base URL configuration
docker exec "$CONTAINER_NAME" sqlite3 "$DB_PATH" <<EOF
-- Update OAuth redirect URIs to include tunnel URL
-- This allows OAuth callbacks to work through the HTTPS tunnel

-- Check current settings
SELECT key, value FROM config WHERE key LIKE '%url%' OR key LIKE '%redirect%' OR key LIKE '%base%';

-- Update or insert the base URL
INSERT OR REPLACE INTO config (key, value) VALUES 
  ('oauth_callback_base_url', '$TUNNEL_URL/api/9router/callback'),
  ('dashboard_base_url', '$TUNNEL_URL'),
  ('allowed_oauth_origins', '$TUNNEL_URL,http://localhost:3000');

-- Verify the update
SELECT key, value FROM config WHERE key LIKE '%url%' OR key LIKE '%redirect%' OR key LIKE '%base%' OR key LIKE '%origin%';
EOF

echo ""
echo "✅ 9Router OAuth configuration updated for tunnel URL: $TUNNEL_URL"
echo ""
echo "Next steps:"
echo "1. Restart 9Router container: docker restart $CONTAINER_NAME"
echo "2. Clear browser cookies for both HTTP IP and tunnel URL"
echo "3. Try logging in via the HTTPS tunnel URL"
echo ""
echo "If login still fails, check 9Router logs:"
echo "  docker logs $CONTAINER_NAME --tail 50"
