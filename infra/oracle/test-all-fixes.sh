#!/bin/bash
# Comprehensive test script for all fixes:
# 1. HTTPS tunnel login (cookie domain fix)
# 2. API endpoint access through tunnel
# 3. Sandbox authentication
#
# Usage: ./test-all-fixes.sh [tunnel-url] [api-key]

set -e

TUNNEL_URL="${1:-}"
API_KEY="${2:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  binG Infrastructure Fix Verification"
echo "========================================="
echo ""

# Get tunnel URL if not provided
if [ -z "$TUNNEL_URL" ]; then
  echo -e "${YELLOW}Extracting tunnel URL from docker logs...${NC}"
  TUNNEL_URL=$(docker logs bing-cloudflared-1 2>&1 | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | tail -1)
  
  if [ -z "$TUNNEL_URL" ]; then
    echo -e "${RED}Error: Could not detect tunnel URL.${NC}"
    echo "Usage: $0 <tunnel-url> [api-key]"
    exit 1
  fi
fi

echo "Tunnel URL: $TUNNEL_URL"
echo ""

# Test 1: HTTPS Tunnel Connectivity
echo "1. Testing HTTPS tunnel connectivity..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$TUNNEL_URL/")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  echo -e "   ${GREEN}✅ Tunnel is responding (HTTP $HTTP_CODE)${NC}"
else
  echo -e "   ${RED}❌ Tunnel not responding (HTTP $HTTP_CODE)${NC}"
fi

# Test 2: Cookie Domain Fix (Login Page)
echo ""
echo "2. Testing cookie domain fix (login page)..."
COOKIE_HEADER=$(curl -s -D - --connect-timeout 10 "$TUNNEL_URL/login" 2>&1 | grep -i "set-cookie" || true)
if [ -n "$COOKIE_HEADER" ]; then
  if echo "$COOKIE_HEADER" | grep -q "Domain="; then
    echo -e "   ${YELLOW}⚠️  Cookies still have Domain attribute (may cause issues)${NC}"
    echo "   Cookie header: $COOKIE_HEADER"
  else
    echo -e "   ${GREEN}✅ Cookies are domain-less (will work on tunnel)${NC}"
  fi
else
  echo -e "   ${YELLOW}⚠️  No Set-Cookie header found (login may use different mechanism)${NC}"
fi

# Test 3: API Health Endpoint
echo ""
echo "3. Testing API health endpoint..."
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$TUNNEL_URL/health")
if [ "$HEALTH_CODE" = "200" ]; then
  echo -e "   ${GREEN}✅ Health endpoint working (HTTP $HEALTH_CODE)${NC}"
else
  echo -e "   ${RED}❌ Health endpoint failed (HTTP $HEALTH_CODE)${NC}"
fi

# Test 4: 9Router API with API Key
if [ -n "$API_KEY" ]; then
  echo ""
  echo "4. Testing 9Router API with API key..."
  MODELS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 \
    -H "Authorization: Bearer $API_KEY" \
    "$TUNNEL_URL/v1/models")
  
  if [ "$MODELS_CODE" = "200" ]; then
    echo -e "   ${GREEN}✅ 9Router API working (HTTP $MODELS_CODE)${NC}"
    
    # Show available model prefixes
    echo ""
    echo "   Available model prefixes:"
    curl -s --connect-timeout 10 \
      -H "Authorization: Bearer $API_KEY" \
      "$TUNNEL_URL/v1/models" 2>/dev/null | \
      jq -r '.data[].id' 2>/dev/null | \
      sed 's|/.*||' | \
      sort -u | \
      head -10 | \
      sed 's/^/     - /'
  else
    echo -e "   ${RED}❌ 9Router API failed (HTTP $MODELS_CODE)${NC}"
  fi
  
  # Test 5: Chat Endpoint
  echo ""
  echo "5. Testing chat completion endpoint..."
  CHAT_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 15 \
    -X POST \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "gemini/gemini-2.5-flash",
      "messages": [{"role": "user", "content": "Hello"}],
      "max_tokens": 10
    }' \
    "$TUNNEL_URL/v1/chat/completions")
  
  if [ "$CHAT_CODE" = "200" ]; then
    echo -e "   ${GREEN}✅ Chat endpoint working (HTTP $CHAT_CODE)${NC}"
  else
    echo -e "   ${RED}❌ Chat endpoint failed (HTTP $CHAT_CODE)${NC}"
  fi
else
  echo ""
  echo "4. Skipping API tests (no API key provided)"
  echo "   Usage: $0 <tunnel-url> <api-key>"
fi

# Test 6: Sandbox Authentication
echo ""
echo "6. Testing sandbox authentication..."
# This should return 401 without auth
SANDBOX_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 \
  "$TUNNEL_URL/api/sandbox/session")

if [ "$SANDBOX_CODE" = "401" ]; then
  echo -e "   ${GREEN}✅ Sandbox requires authentication (HTTP $SANDBOX_CODE)${NC}"
elif [ "$SANDBOX_CODE" = "200" ]; then
  echo -e "   ${YELLOW}⚠️  Sandbox returned 200 without auth (check auth configuration)${NC}"
else
  echo -e "   ${YELLOW}⚠️  Sandbox returned HTTP $SANDBOX_CODE (may be expected)${NC}"
fi

# Test 7: CORS Configuration
echo ""
echo "7. Testing CORS configuration..."
CORS_HEADER=$(curl -s -D - --connect-timeout 10 \
  -H "Origin: https://test.trycloudflare.com" \
  "$TUNNEL_URL/health" 2>&1 | grep -i "access-control-allow-origin" || true)

if [ -n "$CORS_HEADER" ]; then
  echo -e "   ${GREEN}✅ CORS headers present${NC}"
  echo "   $CORS_HEADER"
else
  echo -e "   ${YELLOW}⚠️  No CORS headers (may be expected for health endpoint)${NC}"
fi

echo ""
echo "========================================="
echo "  Test Summary"
echo "========================================="
echo ""
echo "If all tests passed:"
echo "  ✅ HTTPS tunnel is working"
echo "  ✅ Cookie domain fix is applied"
echo "  ✅ API endpoints are accessible"
echo "  ✅ Sandbox authentication is enforced"
echo ""
echo "If login still fails on HTTPS:"
echo "  1. Clear browser cookies for both HTTP and HTTPS domains"
echo "  2. Run: ./update-9router-tunnel-url.sh $TUNNEL_URL"
echo "  3. Restart 9Router: docker restart bing-ninerouter-1"
echo ""
echo "If API requests fail:"
echo "  1. Verify API key is correct"
echo "  2. Check 9Router logs: docker logs bing-ninerouter-1 --tail 50"
echo "  3. Test HTTP directly: curl http://129.213.35.8:3000/v1/models"
echo ""
