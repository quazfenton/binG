#!/bin/bash
# Test 9Router API endpoint through the Cloudflare Tunnel
# Verifies that HTTPS tunnel is working correctly for API requests
#
# Usage: ./test-tunnel-api.sh [tunnel-url] [api-key]
# Example: ./test-tunnel-api.sh https://abc123.trycloudflare.com sk-your-api-key

set -e

TUNNEL_URL="${1:-}"
API_KEY="${2:-}"

# Get tunnel URL from docker logs if not provided
if [ -z "$TUNNEL_URL" ]; then
  echo "Extracting tunnel URL from docker logs..."
  TUNNEL_URL=$(docker logs bing-cloudflared-1 2>&1 | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1)
  
  if [ -z "$TUNNEL_URL" ]; then
    echo "Error: Could not detect tunnel URL from docker logs."
    echo "Usage: $0 <tunnel-url> [api-key]"
    exit 1
  fi
fi

echo "Testing 9Router API through tunnel: $TUNNEL_URL"
echo ""

# Test 1: Health check
echo "1. Testing health endpoint..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$TUNNEL_URL/health")
if [ "$HEALTH_STATUS" = "200" ]; then
  echo "   ✅ Health check passed (HTTP $HEALTH_STATUS)"
else
  echo "   ❌ Health check failed (HTTP $HEALTH_STATUS)"
fi

# Test 2: API models endpoint (requires API key)
if [ -n "$API_KEY" ]; then
  echo ""
  echo "2. Testing /v1/models endpoint with API key..."
  MODELS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 \
    -H "Authorization: Bearer $API_KEY" \
    "$TUNNEL_URL/v1/models")
  
  if [ "$MODELS_STATUS" = "200" ]; then
    echo "   ✅ Models endpoint passed (HTTP $MODELS_STATUS)"
    echo ""
    echo "   Available models (first 5):"
    curl -s --connect-timeout 10 \
      -H "Authorization: Bearer $API_KEY" \
      "$TUNNEL_URL/v1/models" | jq -r '.data[:5] | .[].id' 2>/dev/null | sed 's/^/     - /'
  else
    echo "   ❌ Models endpoint failed (HTTP $MODELS_STATUS)"
    echo ""
    echo "   Response:"
    curl -s --connect-timeout 10 \
      -H "Authorization: Bearer $API_KEY" \
      "$TUNNEL_URL/v1/models" | head -c 500
  fi
  
  # Test 3: Chat completion (quick test)
  echo ""
  echo "3. Testing /v1/chat/completions endpoint..."
  CHAT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 \
    -X POST \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "gemini/gemini-2.5-flash",
      "messages": [{"role": "user", "content": "Say hello in 3 words"}],
      "max_tokens": 10
    }' \
    "$TUNNEL_URL/v1/chat/completions")
  
  if [ "$CHAT_STATUS" = "200" ]; then
    echo "   ✅ Chat endpoint passed (HTTP $CHAT_STATUS)"
  else
    echo "   ❌ Chat endpoint failed (HTTP $CHAT_STATUS)"
  fi
else
  echo ""
  echo "2. Skipping API tests (no API key provided)"
  echo "   Usage: $0 <tunnel-url> <api-key>"
fi

echo ""
echo "✅ Tunnel API test complete"
