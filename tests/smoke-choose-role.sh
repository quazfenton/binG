#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:3000}"
MODEL="${MODEL:-mistral-small-latest}"
PROVIDER="${PROVIDER:-mistral}"

API_KEY_VAR="API_KEY_$(echo "$PROVIDER" | tr '[:lower:]' '[:upper:]')"
API_KEY="${!API_KEY_VAR:-}"

PASS=0
FAIL=0
RESPONSE_FILE=$(mktemp)

cleanup() { rm -f "$RESPONSE_FILE"; }
trap cleanup EXIT
pass() { PASS=$((PASS + 1)); echo "  OK: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

REQUEST_BODY=$(jq -n \
  --arg model "$MODEL" \
  --arg provider "$PROVIDER" \
  --arg apikey "$API_KEY" \
  '{
    model: $model,
    provider: $provider,
    stream: false,
    maxTokens: 500,
    messages: [
      { role: "user", content: "Help me design a microservices architecture for an e-commerce platform" },
      { role: "assistant", content: [{ type: "tool-call", toolName: "choose_role", input: { role: "architect", reason: "Architecture question" } }] },
      { role: "user", content: "What are the key considerations for service boundaries? Should I use event-driven or synchronous communication?" }
    ]
  }
  + (if $apikey != "" then { apiKeys: { ($provider): $apikey } } else {} end)'
)

echo "Smoke Test: choose_role alias - architect"
echo "Server: $SERVER_URL  Model: $MODEL"
echo ""

echo "Step 1: POST /api/chat ..."
HTTP_CODE=$(curl -s -o "$RESPONSE_FILE" -w "%{http_code}" \
  --connect-timeout 5 --max-time 120 \
  -X POST "$SERVER_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then fail "Connection failed"; exit 1; fi
if [ "$HTTP_CODE" != "200" ]; then fail "HTTP $HTTP_CODE"; exit 1; fi
pass "HTTP 200"

echo "Step 2: Validate JSON ..."
jq empty "$RESPONSE_FILE" 2>/dev/null && pass "Valid JSON" || { fail "Invalid JSON"; exit 1; }

echo "Step 3: Check errors ..."
if jq -e '.error' "$RESPONSE_FILE" > /dev/null 2>&1; then
  fail "Error: $(jq -r '.error' "$RESPONSE_FILE")"
else
  pass "No error"
fi

echo "Step 4: Extract content ..."
# Try multiple response format fields: .text, .content, .choices[0].message.content, .response, .data.content
CONTENT=$(jq -r '
  .text //
  .content //
  .choices[0].message.content //
  .response //
  .data.content //
  .data.text //
  .choices[0].text //
  .message.content //
  .data.response //
  .result //
  ""
' "$RESPONSE_FILE" 2>/dev/null || true)
if [ -z "$CONTENT" ] || [ "$CONTENT" = "null" ]; then
  # Last resort: extract the longest string field from the top-level response
  CONTENT=$(jq -r 'to_entries | map(select(.value | type == "string")) | max_by(.value | length) | .value // ""' "$RESPONSE_FILE" 2>/dev/null || true)
fi
if [ -z "$CONTENT" ] || [ "$CONTENT" = "null" ]; then
  fail "No content"
else
  CLEN=${#CONTENT}
  pass "Content: ${CLEN} chars"
fi

echo "Step 5: Heuristic check ..."
ARCH_WORDS="boundar domain service decompos coupling cohesion event orchestration scalable resilient microservice architect"
MATCHES=0
for kw in $ARCH_WORDS; do
  if echo "$CONTENT" | grep -qi "$kw" 2>/dev/null; then
    MATCHES=$((MATCHES + 1))
  fi
done
if [ "$MATCHES" -ge 2 ]; then
  pass "Architecture keywords: $MATCHES"
else
  fail "Architecture keywords: $MATCHES"
fi

echo ""
echo "Result: $FAIL failed | $PASS passed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
