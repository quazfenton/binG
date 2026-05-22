import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PROVIDERS } from '@/lib/providers/llm-providers';
import { errorHandler } from '@/lib/utils/error-handler';
import { responseRouter } from "@/lib/api/response-router";
import { resolveRequestAuth } from "@/lib/auth/request-auth";
import { resolveFilesystemOwner } from "@/lib/virtual-filesystem/resolve-filesystem-owner";
import { detectRequestType } from "@/lib/utils/request-type-detector";
import { generateSecureId } from '@/lib/utils/server-id';
import { chatRequestLogger } from "@/lib/chat/chat-request-logger";
import { chatLogger } from "@/lib/chat/chat-logger";
import { setMetricsLogger } from '@/lib/observability/metrics';
import { virtualFilesystem } from "@/lib/virtual-filesystem/virtual-filesystem-service";
import { filesystemEditSessionService } from "@/lib/virtual-filesystem/filesystem-edit-session-service";
import { 
  sanitizeScopePath, 
  normalizeSessionId 
} from "@/lib/virtual-filesystem/scope-utils";
import { createNDJSONParser } from "@/lib/utils/ndjson-parser";
import type { LLMMessage, StreamingResponse } from '@/lib/providers/llm-providers';
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { 
  createTaskClassifier as createTaskClassifierShared,
} from "@bing/shared/agent";
import { processUnifiedAgentRequest, type UnifiedAgentConfig } from "@/lib/orchestra/unified-agent-service";
import { callMCPToolFromAI_SDK, getMCPToolsForAI_SDK } from "@/lib/mcp";
import { isMem0Configured, mem0Search, buildMem0SystemPrompt, prewarmMem0Cache } from "@/lib/powers/mem0-power";
import { 
  extractAndSanitize, 
  createIncrementalParser, 
  extractIncrementalFileEdits,
  isValidFilePath 
} from "@/lib/chat/file-edit-parser";
import { generateSessionName, sessionNameExists } from '@/lib/session/session-naming';
import {
  chatRequestSchema,
} from "@/app/api/chat/chat-helpers";
import { 
  applyPromptModifiers, 
  getPreset, 
  PROMPT_PRESETS, 
  type PromptParameters 
} from "@bing/shared/agent/prompt-parameters";

const chatRoute = new Hono();

// --- CONSTANTS ---
const CHAT_RATE_LIMIT_WINDOW_MS = 60000;
const CHAT_RATE_LIMIT_MAX_AUTHENTICATED = 60;
const CHAT_RATE_LIMIT_MAX_ANONYMOUS = 10;
const VALIDATION_CACHE_TTL_MS = 30000;

// --- REGEX ---
const STRONG_CODE_PATTERN = /\b(refactor|bug\s*fix|stack\s*trace|typescript|javascript|python|react|next\.js|vue\.js|angular|node\.?js|endpoint|database|schema|compile|lint|migrations?|docker|kubernetes|k8s|redis|mongodb|postgresql|mysql|sqlite|express|fastapi|flask|django|spring|rails|laravel|symfony|golang|rust|java|c\+\+|cpp|c#|dotnet|swift|kotlin|flutter|react\s*native|electron|code|build|implement|create\s+app|create\s+workspace|scaffold|generate\s+app)\b/i;
const WEAK_CODE_KEYWORDS = ["app", "workspace", "component", "file", "api", "function", "class", "module", "package", "implement", "build", "develop"] as const;
const WEAK_CODE_PATTERNS = WEAK_CODE_KEYWORDS.map(kw => new RegExp(`\\b${kw}\\b`, "i"));

// --- HELPER LOGIC ---
let _taskClassifierCache: any = null;

function getTaskClassifier() {
  if (process.env.ENABLE_TASK_CLASSIFIER !== "true") return null;
  if (!_taskClassifierCache) {
    _taskClassifierCache = createTaskClassifierShared({
      simpleThreshold: 0.3,
      complexThreshold: 0.7,
      keywordWeight: 0.4,
      semanticWeight: 0.3,
      contextWeight: 0.2,
      historicalWeight: 0.1,
      enableSemanticAnalysis: true,
      enableHistoricalLearning: true,
      enableContextAwareness: true,
    });
  }
  return _taskClassifierCache;
}

async function classifyRequest(messages: LLMMessage[], attachedFiles: any[]) {
  if (attachedFiles.length > 0) return { isCodeRequest: true, complexity: "moderate", recommendedMode: "v2-native" };
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  const content = typeof lastUser?.content === "string" ? lastUser.content : "";
  if (!content) return { isCodeRequest: false, complexity: "simple", recommendedMode: "v1-api" };

  try {
    const classifier = getTaskClassifier();
    if (!classifier) throw new Error("Disabled");
    const result = await classifier.classify(content, { projectSize: process.env.PROJECT_SIZE as any });
    return { isCodeRequest: result.complexity !== "simple", complexity: result.complexity, recommendedMode: result.recommendedMode };
  } catch {
    const isCode = STRONG_CODE_PATTERN.test(content);
    return { isCodeRequest: isCode, complexity: isCode ? "moderate" : "simple", recommendedMode: "v1-api" };
  }
}

// --- MAIN HANDLER ---
chatRoute.post("/", async (c) => {
  const requestStartTime = Date.now();
  const requestId = generateSecureId("chat");
  const raw = c.req.raw;

  // Add cookies property to request for Next.js auth compatibility
  const parseCookies = (): Map<string, string> => {
    const cookieHeader = raw.headers.get("cookie") || "";
    const cookies = new Map<string, string>();
    for (const pair of cookieHeader.split(";")) {
      const trimmed = pair.trim();
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        cookies.set(trimmed.slice(0, eq).trim(), decodeURIComponent(trimmed.slice(eq + 1)));
      }
    }
    return cookies;
  };
  const cookies = parseCookies();
  const request = new Proxy(raw, {
    get(target, prop) {
      if (prop === "cookies") {
        return {
          get: (name: string) => {
            const value = cookies.get(name);
            return value ? { name, value } : undefined;
          },
          getAll: () =>
            Array.from(cookies.entries()).map(([name, value]) => ({ name, value })),
          has: (name: string) => cookies.has(name),
        };
      }
      return Reflect.get(target, prop);
    },
  }) as Request & { cookies: { get: (n: string) => { name: string; value: string } | undefined; getAll: () => { name: string; value: string }[]; has: (n: string) => boolean } };

  // 1. Auth and Rate Limit
  const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
  const userId = authResult.userId || "anonymous";
  const isAuthenticated = authResult.success && userId && !userId.startsWith("anon:");
  
  const rateLimitIdentifier = isAuthenticated ? `user:${userId}` : `ip:${c.req.header("x-forwarded-for")?.split(",")[0] || "unknown"}`;
  const rateLimitResult = checkRateLimit(rateLimitIdentifier, { 
    windowMs: CHAT_RATE_LIMIT_WINDOW_MS, 
    maxRequests: isAuthenticated ? CHAT_RATE_LIMIT_MAX_AUTHENTICATED : CHAT_RATE_LIMIT_MAX_ANONYMOUS, 
    message: "Rate limit" 
  }, { name: "free", multiplier: 1, description: "" });

  if (!rateLimitResult.allowed) return c.json({ success: false, error: "Rate limit exceeded" }, 429);

  // 2. Parse Body
  const body = await c.req.json();
  const parseResult = chatRequestSchema.safeParse(body);
  if (!parseResult.success) return c.json({ error: parseResult.error.errors[0].message }, 400);

  const { messages, provider, model, stream, temperature, maxTokens, conversationId, filesystemContext } = parseResult.data as any;

  // 3. Logic Initialization
  const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
  const ownerResolution = await resolveFilesystemOwner(request);
  const filesystemOwnerId = ownerResolution.ownerId;
  const resolvedConversationId = conversationId || await generateSessionName();
  const requestedScopePath = sanitizeScopePath(filesystemContext?.scopePath || `workspace/sessions/${normalizeSessionId(resolvedConversationId)}`);

  // 4. Config Building
  const classification = await classifyRequest(messages, []);
  
  const config: UnifiedAgentConfig = {
    userMessage: messages[messages.length - 1]?.content || "",
    userId: filesystemOwnerId,
    conversationId: resolvedConversationId,
    conversationHistory: messages,
    systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT || "Expert coding assistant",
    provider,
    model,
    mode: "auto",
  };

  // 5. Tool Setup
  const tools = await getMCPToolsForAI_SDK(userId, config.userMessage);
  config.tools = tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
  config.executeTool = async (name: string, args: Record<string, any>) => {
    const result = await callMCPToolFromAI_SDK(name, args, userId, requestedScopePath);
    return { success: result.success, output: result.output, exitCode: result.success ? 0 : 1 };
  };

  // 6. Execution & Streaming
  if (stream && selectedProvider?.supportsStreaming) {
    return streamSSE(c, async (sse) => {
      const emit = async (event: string, data: any) => {
        await sse.writeSSE({ event, data: JSON.stringify(data) });
      };

      config.onStreamChunk = (chunk: string) => emit("token", { content: chunk, timestamp: Date.now() });
      config.onToolExecution = (name: string, args: any, result: any) => emit("tool_invocation", { toolName: name, args, result, state: "result" });

      try {
        await emit("init", { requestId, streamId: requestId, timestamp: Date.now() });
        const result = await processUnifiedAgentRequest(config);
        await emit("done", { success: result.success, content: result.response, data: result });
      } catch (err: any) {
        await emit("error", { message: err.message });
      }
    });
  }

  // 7. Non-streaming
  const result = await processUnifiedAgentRequest(config);
  return c.json({ success: result.success, content: result.response, data: result });
});

export default chatRoute;
