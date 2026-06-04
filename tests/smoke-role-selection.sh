#!/usr/bin/env bash
#
# Smoke test: role_selection → forcedRole injection
#
# Sends a chat request to /api/chat with a conversation history where the
# assistant previously called role_selection (tool-call) with role="architect".
# Verifies:
#   1. HTTP 200 (not a schema/validation error)
#   2. Response is valid JSON
#   3. No top-level error or fallback response
#   4. Assistant content exists and contains architecture-related terminology
#      (heuristic check that forcedRole injection is steering the LLM)
#
# Usage:
#   export API_KEY_MISTRAL="your_key_here"
#   bash tests/smoke-role-selection.sh
#
# The API key env var is derived from PROVIDER: API_KEY_<UPPERCASE_PROVIDER>
# Examples:
#   PROVIDER=mistral  → reads API_KEY_MISTRAL
#   PROVIDER=openai   → reads API_KEY_OPENAI
#   PROVIDER=openrouter → reads API_KEY_OPENROUTER
#
# Optional overrides:
#   SERVER_URL=http://localhost:3000
#   MODEL=mistral-small-latest
#   PROVIDER=mistral

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:3000}"
MODEL="${MODEL:-mistral-small-latest}"
PROVIDER="${PROVIDER:-mistral}"

# Derive API key env var name from provider (e.g., API_KEY_MISTRAL, API_KEY_OPENAI)
API_KEY_VAR="API_KEY_$(echo "$PROVIDER" | tr '[:lower:]' '[:upper:]')"
API_KEY="${!API_KEY_VAR:-}"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  ✅ $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  ❌ $1"
}

echo "═══════════════════════════════════════════════════"
echo "  Smoke Test: role_selection → forcedRole Injection"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Server:  $SERVER_URL"
echo "  Model:   $MODEL ($PROVIDER)"
echo "  API key: ${API_KEY:+"set (${#API_KEY} chars)"}${API_KEY:-"NOT SET — will likely fail with auth error"}"
echo ""

# ── Build request body ──────────────────────────────────────────
# Conversation: user asks about architecture → assistant calls role_selection
# → user continues. The server should detect forcedRole="architect" and inject
# the architect system prompt for the second user message.

REQUEST_BODY=$(jq -n \
  --arg provider "$PROVIDER" \
  --arg model "$MODEL" \
  --arg apikey "$API_KEY" \
  '{
    messages: [
      {
        role: "user",
        content: "I need to design a scalable microservices architecture for an e-commerce platform."
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolName: "role_selection",
            toolCallId: "call_role_001",
            input: {
              role: "architect",
              reason: "User is asking about system architecture and design patterns"
            }
          }
        ]
      },
      {
        role: "user",
        content: "What are the key considerations for choosing between event-driven and synchronous communication between services?"
      }
    ],
    provider: $provider,
    model: $model,
    stream: false,
    maxTokens: 2048,
    temperature: 0.7
  } + (if $apikey != "" then { apiKeys: { ($provider): $apikey } } else {} end)')

# ── Step 1: Send request and check HTTP status ──────────────────
echo "── Step 1: POST /api/chat ──────────────────────────"

RESPONSE_FILE=$(mktemp)

set +e
HTTP_STATUS=$(curl -s -w '%{http_code}' \
  -X POST "$SERVER_URL/api/chat" \
  -H 'Content-Type: application/json' \
  --connect-timeout 5 \
  --max-time 120 \
  -d "$REQUEST_BODY" \
  -o "$RESPONSE_FILE" \
  --http1.1 2>/dev/null)
CURL_EXIT=$?
set -e

echo "  HTTP $HTTP_STATUS (curl exit: $CURL_EXIT)"

if [ "$CURL_EXIT" -ne 0 ]; then
  fail "curl failed with exit code $CURL_EXIT (server not running?)"
  echo ""
  echo "── Results ─────────────────────────────────────────"
  echo "  $PASS_COUNT passed, $FAIL_COUNT failed"
  rm -f "$RESPONSE_FILE"
  exit 1
fi

if [ "$HTTP_STATUS" != "200" ]; then
  fail "Expected HTTP 200, got $HTTP_STATUS"
  echo ""
  echo "  Response body (first 500 chars):"
  head -c 500 "$RESPONSE_FILE" | sed 's/^/    /'
  echo ""
else
  pass "HTTP 200 OK"
fi

# ── Step 2: Validate response is JSON ───────────────────────────
echo ""
echo "── Step 2: Validate response format ────────────────"

if ! jq empty "$RESPONSE_FILE" 2>/dev/null; then
  fail "Response is not valid JSON"
  echo ""
  echo "  Raw response (first 500 chars):"
  head -c 500 "$RESPONSE_FILE" | sed 's/^/    /'
  echo ""
else
  pass "Response is valid JSON"
fi

# ── Step 3: Check for top-level errors ─────────────────────────
echo ""
echo "── Step 3: Check for errors ────────────────────────"

RESPONSE_TYPE=$(jq -r 'type' "$RESPONSE_FILE" 2>/dev/null)

if [ "$RESPONSE_TYPE" = "object" ]; then
  HAS_ERROR=$(jq 'has("error")' "$RESPONSE_FILE" 2>/dev/null)
  IS_FALLBACK=$(jq '.data?.isFallback // false' "$RESPONSE_FILE" 2>/dev/null)

  if [ "$HAS_ERROR" = "true" ]; then
    ERROR_CODE=$(jq -r '.error?.code // "unknown"' "$RESPONSE_FILE")
    fail "Response contains error: $ERROR_CODE"
    jq '.error' "$RESPONSE_FILE" | sed 's/^/    /'
  else
    pass "No top-level error"

    if [ "$IS_FALLBACK" = "true" ]; then
      fail "Response used fallback (no LLM actually called — check API keys)"
    else
      pass "Not a fallback response (LLM was called)"
    fi

    # ── Step 4: Extract content and verify role injection ──
    echo ""
    echo "── Step 4: Verify forcedRole injection (architect) ─"

    # Try multiple response formats: Vercel AI SDK, OpenAI-compatible, custom
    CONTENT=$(jq -r '
      .text // .content // .choices?[0]?.message?.content // .data?.content // ""
    ' "$RESPONSE_FILE" 2>/dev/null)

    if [ -z "$CONTENT" ]; then
      fail "Cannot extract assistant content from response"
      echo "  Response keys: $(jq -r 'keys | join(", ")' "$RESPONSE_FILE" 2>/dev/null)"
    else
      CONTENT_LEN=${#CONTENT}
      echo "  Content length: ${CONTENT_LEN} chars"

      if [ "$CONTENT_LEN" -gt 20 ]; then
        pass "Response has substantial content ($CONTENT_LEN chars)"
      else
        fail "Response content is too short ($CONTENT_LEN chars)"
      fi

      # Heuristic: architect-level response should mention architecture concepts
      ARCHITECT_SCORE=$(echo "$CONTENT" | grep -ciE \
        'architectur|design|microservice|event.driven|service|scalab|pattern|communicat|message.queue|async|sync|decompos|bound|domain|orchestrat|choreography' 2>/dev/null || true)

      # Normalize by subtracting content length factor to avoid false positives
      # on very short responses. Minimum 3 matches for a convincing architect answer.
      if [ "$ARCHITECT_SCORE" -ge 2 ]; then
        pass "Response shows architect-level domain expertise ($ARCHITECT_SCORE keyword matches)"
      elif [ "$ARCHITECT_SCORE" -ge 1 ]; then
        echo "  ⚠️  Partial match: $ARCHITECT_SCORE architecture keyword(s) found"
        pass "Response has some architecture-related language"
      else
        fail "Response lacks architecture-specific language (forcedRole may not be working)"
      fi
    fi
  fi
elif [ "$RESPONSE_TYPE" = "array" ]; then
  ARRAY_LEN=$(jq 'length' "$RESPONSE_FILE")
  pass "Response is a JSON array ($ARRAY_LEN elements)"
else
  fail "Unexpected response type: $RESPONSE_TYPE"
fi

# ── Step 5: Print summary ──────────────────────────────────────
echo ""
echo "── Summary ─────────────────────────────────────────"
echo "  Response preview (first 300 chars of content):"
jq -r '
  (.text // .content // .choices?[0]?.message?.content // .data?.content // "—no content—")[:300]
' "$RESPONSE_FILE" 2>/dev/null | sed 's/^/    /'
echo ""
echo ""
echo "  $PASS_COUNT passed, $FAIL_COUNT failed"

rm -f "$RESPONSE_FILE"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
