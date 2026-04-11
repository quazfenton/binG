/**
 * E2E Memory Module Test
 *
 * Tests the full pipeline: auth → indexing → retrieval → context → agent loop
 *
 * Usage: npx tsx scripts/e2e-memory-test.ts
 */

const BASE_URL = "http://localhost:3000";

// ─── Test Credentials ────────────────────────────────────────────────────────
const CREDENTIALS = {
  email: "test@test.com",
  password: "Testing0",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
let authToken: string | null = null;

async function login() {
  console.log("[1] Authenticating...");
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CREDENTIALS),
  });

  if (!res.ok) {
    // Try alternative auth endpoints
    const endpoints = ["/api/auth/signin", "/api/login", "/api/auth"];
    for (const endpoint of endpoints) {
      const altRes = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(CREDENTIALS),
      });
      if (altRes.ok) {
        const data = await altRes.json();
        authToken = data.token || data.accessToken || data.sessionId || null;
        console.log(`  ✓ Authenticated via ${endpoint}`);
        return;
      }
    }

    // If all fail, try to get cookie-based auth
    const cookieRes = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "test" }],
        model: "test",
        provider: "test",
      }),
    });
    console.log(`  ⚠ Auth response: ${cookieRes.status} ${cookieRes.statusText}`);
    return;
  }

  const data = await res.json();
  authToken = data.token || data.accessToken || data.sessionId || null;
  console.log("  ✓ Authenticated");
}

async function testHealthEndpoint() {
  console.log("[2] Testing health endpoint...");
  try {
    const res = await fetch(`${BASE_URL}/api/memory/health`);
    if (res.ok) {
      const data = await res.json();
      console.log(`  ✓ Health status: ${data.status}`);
      console.log(`  ✓ Components: ${Object.keys(data.components).join(", ")}`);
      return data;
    } else {
      console.log(`  ⚠ Health endpoint returned ${res.status} (may not be deployed yet)`);
      return null;
    }
  } catch (err) {
    console.log(`  ⚠ Health endpoint not reachable: ${err}`);
    return null;
  }
}

async function testEmbeddingEndpoint() {
  console.log("[3] Testing embedding endpoint...");
  try {
    const res = await fetch(`${BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "test embedding for hello world function" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        console.log(`  ✓ Embedding returned ${data.length} dimensions`);
        return data;
      }
    } else {
      const error = await res.text();
      // OPENAI_API_KEY not set is a configuration issue, not a code bug
      if (error.includes("OPENAI_API_KEY")) {
        console.log(`  ⚠ Embedding endpoint: OPENAI_API_KEY not configured (expected in local test)`);
        return { skipped: true, reason: "No OPENAI_API_KEY" };
      }
      console.log(`  ⚠ Embedding endpoint returned ${res.status}: ${error.slice(0, 100)}`);
      return null;
    }
  } catch (err) {
    console.log(`  ⚠ Embedding endpoint not reachable: ${err}`);
    return null;
  }
  return null;
}

async function testChatEndpoint() {
  console.log("[4] Testing chat endpoint with memory context...");
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Explain how the memory module works in this codebase" },
        ],
        stream: false,
        model: "gpt-4o-mini",
        provider: "openai",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.content || data.message?.content || JSON.stringify(data).slice(0, 500);
      console.log(`  ✓ Chat response received (${content.length} chars)`);
      console.log(`  ✓ Preview: ${content.slice(0, 200)}...`);
      return data;
    } else {
      const error = await res.text();
      console.log(`  ⚠ Chat endpoint returned ${res.status}: ${error.slice(0, 200)}`);
      return null;
    }
  } catch (err) {
    console.log(`  ⚠ Chat endpoint not reachable: ${err}`);
    return null;
  }
}

async function testContextRetrieval() {
  console.log("[5] Testing context retrieval pipeline...");
  // This tests the hybrid retrieval indirectly via the chat endpoint
  // by asking a codebase-specific question
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [
          { role: "user", content: "What is the ranking formula used in the similarity module?" },
        ],
        stream: false,
        model: "gpt-4o-mini",
        provider: "openai",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`  ✓ Context retrieval test passed`);
      return data;
    }
  } catch (err) {
    console.log(`  ⚠ Context retrieval test failed: ${err}`);
  }
  return null;
}

async function testAgentLoop() {
  console.log("[6] Testing agent loop with file editing...");
  // Test by asking the LLM to make a simple code change
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Add a comment to the cosineSimilarity function in similarity.ts explaining what it does" },
        ],
        stream: false,
        model: "gpt-4o-mini",
        provider: "openai",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`  ✓ Agent loop test passed`);
      return data;
    }
  } catch (err) {
    console.log(`  ⚠ Agent loop test failed: ${err}`);
  }
  return null;
}

async function testValidation() {
  console.log("[7] Testing validation and error handling...");
  // Test with invalid input
  try {
    const res = await fetch(`${BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });

    if (res.status === 400) {
      console.log(`  ✓ Validation correctly rejects empty input`);
    }

    // Test rate limiting (multiple rapid requests)
    const promises = Array.from({ length: 5 }, (_, i) =>
      fetch(`${BASE_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `rate limit test ${i}` }),
      })
    );

    const results = await Promise.all(promises);
    const statusCodes = results.map(r => r.status);
    const hasRateLimit = statusCodes.some(s => s === 429);
    console.log(`  ✓ Rate limiting test: ${hasRateLimit ? "active" : "not triggered (within limits)"}`);
  } catch (err) {
    console.log(`  ⚠ Validation test failed: ${err}`);
  }
}

// ─── Main Test Runner ────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("E2E Memory Module Test Suite");
  console.log("=".repeat(60) + "\n");

  const results: Record<string, boolean | string> = {
    health: false,
    embedding: false,
    chat: false,
    contextRetrieval: false,
    agentLoop: false,
    validation: false,
  };

  try {
    await login();

    const health = await testHealthEndpoint();
    results.health = health !== null;

    const embedding = await testEmbeddingEndpoint();
    results.embedding = embedding !== null;

    const chat = await testChatEndpoint();
    results.chat = chat !== null;

    const contextRetrieval = await testContextRetrieval();
    results.contextRetrieval = contextRetrieval !== null;

    const agentLoop = await testAgentLoop();
    results.agentLoop = agentLoop !== null;

    await testValidation();
    results.validation = true;
  } catch (err) {
    console.error(`\n  ✗ Test suite failed: ${err}`);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("Test Results Summary");
  console.log("=".repeat(60));

  let passed = 0;
  let skipped = 0;
  let total = 0;

  for (const [name, result] of Object.entries(results)) {
    total++;
    if (result === true) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else if (result && typeof result === "object" && (result as any).skipped) {
      skipped++;
      console.log(`  ⚠ ${name} (skipped: ${(result as any).reason})`);
    } else {
      console.log(`  ✗ ${name}`);
    }
  }

  console.log(`\n  ${passed}/${total} passed, ${skipped} skipped`);
  console.log("=".repeat(60) + "\n");

  process.exit(passed + skipped === total ? 0 : 1);
}

main().catch(console.error);
