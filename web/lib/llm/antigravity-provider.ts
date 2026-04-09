/**
 * Antigravity Provider — Google OAuth-based LLM access
 *
 * Provides access to Gemini 3 and Claude 4.6 via Google's Antigravity platform.
 * Supports both per-user OAuth accounts and a master server-level account.
 *
 * Based on the opencode-antigravity-auth plugin implementation.
 *
 * OAuth Flow:
 * 1. User visits /api/antigravity/login
 * 2. Redirected to Google OAuth (with PKCE)
 * 3. Callback at /api/antigravity/callback exchanges code for tokens
 * 4. Refresh token stored in antigravity_accounts table
 *
 * Master Account (Server-level):
 * - Configured via ANTIGRAVITY_REFRESH_TOKEN env var
 * - Available to all users as a fallback/shared quota
 * - Per-user accounts are preferred when available
 */

import crypto from 'crypto';
import { chatLogger } from '@/lib/chat/chat-logger';

// ============================================================
// Constants (from opencode-antigravity-auth)
// ============================================================

const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

const ANTIGRAVITY_ENDPOINT_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_ENDPOINT_AUTOPUSH = 'https://autopush-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_ENDPOINT_PROD = 'https://cloudcode-pa.googleapis.com';
const ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY;
const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

const ANTIGRAVITY_VERSION = '1.18.3';

// ============================================================
// Model Configuration (from opencode-antigravity-auth)
// ============================================================

export const ANTIGRAVITY_MODELS: Record<string, {
  name: string;
  contextLimit: number;
  outputLimit: number;
  supportsThinking: boolean;
  thinkingLevels?: string[];
  thinkingBudget?: { low: number; max: number };
}> = {
  'antigravity-gemini-3-pro': {
    name: 'Gemini 3 Pro (Antigravity)',
    contextLimit: 1048576,
    outputLimit: 65535,
    supportsThinking: true,
    thinkingLevels: ['low', 'high'],
  },
  'antigravity-gemini-3.1-pro': {
    name: 'Gemini 3.1 Pro (Antigravity)',
    contextLimit: 1048576,
    outputLimit: 65535,
    supportsThinking: true,
    thinkingLevels: ['low', 'high'],
  },
  'antigravity-gemini-3-flash': {
    name: 'Gemini 3 Flash (Antigravity)',
    contextLimit: 1048576,
    outputLimit: 65536,
    supportsThinking: true,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
  },
  'antigravity-claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6 (Antigravity)',
    contextLimit: 200000,
    outputLimit: 64000,
    supportsThinking: false,
  },
  'antigravity-claude-opus-4-6-thinking': {
    name: 'Claude Opus 4.6 Thinking (Antigravity)',
    contextLimit: 200000,
    outputLimit: 64000,
    supportsThinking: true,
    thinkingBudget: { low: 8192, max: 32768 },
  },
};

// ============================================================
// PKCE Helpers
// ============================================================

/**
 * Generate PKCE code verifier and challenge
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(verifier).digest();
  const challenge = hash.toString('base64url');
  return { verifier, challenge };
}

// ============================================================
// OAuth Functions
// ============================================================

function getOAuthConfig(): {
  redirectUri: string;
  defaultProjectId: string;
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/antigravity/callback`;
  const defaultProjectId = process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || ANTIGRAVITY_DEFAULT_PROJECT_ID;

  return { redirectUri, defaultProjectId };
}

/**
 * Encode state for OAuth flow
 */
function encodeState(verifier: string, projectId: string): string {
  return Buffer.from(JSON.stringify({ verifier, projectId }), 'utf8').toString('base64url');
}

/**
 * Decode state from OAuth callback
 */
function decodeState(state: string): { verifier: string; projectId: string } {
  const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  if (typeof parsed.verifier !== 'string') {
    throw new Error('Missing PKCE verifier in state');
  }
  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === 'string' ? parsed.projectId : '',
  };
}

/**
 * Generate Google OAuth authorization URL with PKCE
 * @param projectId - Optional Google Cloud project ID to associate with the account
 * @returns OAuth authorization URL for user redirection
 */
export async function getAntigravityOAuthUrl(projectId?: string): Promise<string> {
  const { redirectUri, defaultProjectId } = getOAuthConfig();
  const pkce = await generatePKCE();

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '));
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set(
    'state',
    encodeState(pkce.verifier, projectId || defaultProjectId)
  );
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');

  return url.toString();
}

/**
 * Exchange authorization code for access/refresh tokens
 * @param code - Authorization code from OAuth callback
 * @param state - OAuth state parameter (contains PKCE verifier)
 * @returns Object containing tokens and user email
 */
export async function exchangeCodeForTokens(
  code: string,
  state: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  email: string;
  projectId: string;
}> {
  const { verifier, projectId } = decodeState(state);
  const { redirectUri } = getOAuthConfig();

  const startTime = Date.now();

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
  }

  const tokenData = await tokenResponse.json();

  if (!tokenData.refresh_token) {
    throw new Error('Missing refresh token in response');
  }

  // Fetch user email
  const userInfoResponse = await fetch(
    'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'google-api-nodejs-client/9.15.1',
      },
    }
  );

  const userInfo = userInfoResponse.ok ? await userInfoResponse.json() : {};

  // Try to resolve project ID if not provided
  let effectiveProjectId = projectId;
  if (!effectiveProjectId) {
    effectiveProjectId = await fetchProjectID(tokenData.access_token);
  }

  // Store refresh token in format: refreshToken|projectId
  const storedRefresh = `${tokenData.refresh_token}|${effectiveProjectId || ''}`;

  return {
    accessToken: tokenData.access_token,
    refreshToken: storedRefresh,
    email: userInfo.email || '',
    projectId: effectiveProjectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
  };
}

/**
 * Fetch project ID from Antigravity API
 */
async function fetchProjectID(accessToken: string): Promise<string> {
  const endpoints = [
    ANTIGRAVITY_ENDPOINT_PROD,
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ];

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'Client-Metadata': '{"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}',
  };

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: 'MACOS',
            pluginType: 'GEMINI',
          },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject) {
        return data.cloudaicompanionProject;
      }
      if (data.cloudaicompanionProject?.id) {
        return data.cloudaicompanionProject.id;
      }
    } catch {
      // Try next endpoint
    }
  }

  return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}

// ============================================================
// Token Refresh
// ============================================================

/**
 * Parse stored refresh token (format: refreshToken|projectId|managedProjectId)
 */
function parseRefreshToken(refreshToken: string): {
  refreshToken: string;
  projectId: string;
  managedProjectId?: string;
} {
  const parts = refreshToken.split('|');
  return {
    refreshToken: parts[0] || '',
    projectId: parts[1] || '',
    managedProjectId: parts[2] || undefined,
  };
}

/**
 * Refresh an expired access token using the refresh token
 * @param storedRefreshToken - Stored refresh token (may include projectId)
 * @returns New access token
 */
export async function refreshAccessToken(storedRefreshToken: string): Promise<string> {
  const { refreshToken } = parseRefreshToken(storedRefreshToken);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': '*/*',
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();

    if (errorBody.includes('invalid_grant')) {
      throw new Error('Refresh token expired or revoked. Please re-authenticate.');
    }

    throw new Error(`Token refresh failed: ${tokenResponse.status} ${errorBody}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// ============================================================
// Headers
// ============================================================

function getAntigravityHeaders(): Record<string, string> {
  const platform = process.platform === 'win32' ? 'WINDOWS' : 'MACOS';
  return {
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ANTIGRAVITY_VERSION} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"${platform}","pluginType":"GEMINI"}`,
  };
}

function getGeminiCliHeaders(): Record<string, string> {
  return {
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'gl-node/22.17.0',
    'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
  };
}

// ============================================================
// Account Interface
// ============================================================

export interface AntigravityAccount {
  id: string;
  userId: string;
  email: string;
  refreshToken: string; // Format: refreshToken|projectId|managedProjectId
  projectId: string;
  enabled: boolean;
  lastUsedAt: number;
  quotaUpdatedAt: number;
  cachedQuota?: Record<string, unknown>;
  isMaster?: boolean;
}

// ============================================================
// API Request Functions
// ============================================================

interface AntigravityRequest {
  model: string;
  messages: Array<{ role: string; content: any }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  thinking?: { budget_tokens?: number; level?: string };
}

/**
 * Get authenticated client and project info for an account
 */
export async function getAuthenticatedClient(account: AntigravityAccount): Promise<{
  accessToken: string;
  projectId: string;
  email: string;
}> {
  const accessToken = await refreshAccessToken(account.refreshToken);
  const parsed = parseRefreshToken(account.refreshToken);
  const projectId = parsed.managedProjectId || parsed.projectId || account.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID;

  return { accessToken, projectId, email: account.email };
}

/**
 * Send a chat request to Antigravity API
 * Handles both streaming and non-streaming responses
 */
export async function sendAntigravityChat(
  request: AntigravityRequest,
  account: AntigravityAccount
): Promise<{
  content: string;
  thinking?: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const { accessToken, projectId } = await getAuthenticatedClient(account);
  const modelConfig = ANTIGRAVITY_MODELS[request.model];

  if (!modelConfig) {
    throw new Error(`Unknown model: ${request.model}`);
  }

  chatLogger.info('Antigravity request', {
    model: request.model,
    accountId: account.id,
    email: account.email,
    projectId,
    stream: request.stream,
  });

  if (request.stream) {
    return sendStreamingRequest(accessToken, projectId, request, modelConfig);
  } else {
    return sendNonStreamingRequest(accessToken, projectId, request, modelConfig);
  }
}

/**
 * Build Antigravity API request body
 */
function buildRequestBody(
  request: AntigravityRequest,
  modelConfig: typeof ANTIGRAVITY_MODELS[string]
): any {
  // Convert messages to Antigravity contents format
  const contents = request.messages
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
      parts: typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : msg.content.map((part: any) => ({
            text: part.text || '',
          })),
    }));

  // Extract system message
  const systemMessage = request.messages.find((msg) => msg.role === 'system');

  const body: any = {
    model: request.model,
    request: {
      model: request.model,
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? modelConfig.outputLimit,
        temperature: request.temperature ?? 0.7,
      },
    },
  };

  // Add system instruction
  if (systemMessage) {
    body.request.systemInstruction = {
      parts: [{ text: typeof systemMessage.content === 'string' ? systemMessage.content : '' }],
    };
  }

  // Add thinking config if supported
  if (modelConfig.supportsThinking && request.thinking) {
    if (modelConfig.thinkingLevels && request.thinking.level) {
      body.request.generationConfig.thinkingLevel = request.thinking.level;
    } else if (modelConfig.thinkingBudget) {
      body.request.generationConfig.thinkingBudget =
        request.thinking.budget_tokens ?? modelConfig.thinkingBudget.low;
    }
  }

  return body;
}

/**
 * Send streaming request to Antigravity API
 */
async function sendStreamingRequest(
  accessToken: string,
  projectId: string,
  request: AntigravityRequest,
  modelConfig: typeof ANTIGRAVITY_MODELS[string]
): Promise<{
  content: string;
  thinking?: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const url = `${ANTIGRAVITY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`;
  const body = buildRequestBody(request, modelConfig);

  const headers = {
    ...getAntigravityHeaders(),
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  if (projectId) {
    (headers as any)['x-goog-user-project'] = projectId;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 429) {
      throw new Error(`Rate limited. Project: ${projectId}. Try another account.`);
    }
    throw new Error(`Antigravity API error (${response.status}): ${errorBody}`);
  }

  // Parse SSE response
  const text = await response.text();
  const lines = text.split('\n').filter((line) => line.startsWith('data: '));

  let content = '';
  let thinking = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let finishReason = 'stop';

  for (const line of lines) {
    const jsonStr = line.slice(6); // Remove 'data: ' prefix
    try {
      const data = JSON.parse(jsonStr);
      const candidates = data.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.text) content += part.text;
          if (part.thought) thinking += part.thought;
        }
        if (candidate.finishReason) {
          finishReason = candidate.finishReason;
        }
      }
      if (data.usageMetadata) {
        promptTokens = data.usageMetadata.promptTokenCount || promptTokens;
        completionTokens = data.usageMetadata.candidatesTokenCount || completionTokens;
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return {
    content,
    thinking: thinking || undefined,
    finishReason,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Send non-streaming request to Antigravity API
 */
async function sendNonStreamingRequest(
  accessToken: string,
  projectId: string,
  request: AntigravityRequest,
  modelConfig: typeof ANTIGRAVITY_MODELS[string]
): Promise<{
  content: string;
  thinking?: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const url = `${ANTIGRAVITY_ENDPOINT}/v1internal:generateContent`;
  const body = buildRequestBody(request, modelConfig);

  const headers = {
    ...getAntigravityHeaders(),
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  if (projectId) {
    (headers as any)['x-goog-user-project'] = projectId;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 429) {
      throw new Error(`Rate limited. Project: ${projectId}. Try another account.`);
    }
    throw new Error(`Antigravity API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  // Extract content and thinking from response
  const candidates = data.candidates || [];
  const candidate = candidates[0];
  const parts = candidate?.content?.parts || [];

  let content = '';
  let thinking = '';

  for (const part of parts) {
    if (part.text) content += part.text;
    if (part.thought) thinking += part.thought;
  }

  return {
    content,
    thinking: thinking || undefined,
    finishReason: candidate?.finishReason || 'stop',
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

// ============================================================
// Master Account Support
// ============================================================

/**
 * Get the master (server-level) Antigravity account
 * This account is shared by all users when no per-user account is available
 */
export function getMasterAccount(): AntigravityAccount | null {
  const refreshToken = process.env.ANTIGRAVITY_REFRESH_TOKEN;
  if (!refreshToken) {
    return null;
  }

  return {
    id: 'antigravity-master',
    userId: 'master',
    email: process.env.ANTIGRAVITY_MASTER_EMAIL || 'master@antigravity.local',
    refreshToken,
    projectId: process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || ANTIGRAVITY_DEFAULT_PROJECT_ID,
    enabled: true,
    lastUsedAt: Date.now(),
    quotaUpdatedAt: 0,
    isMaster: true,
  };
}

/**
 * Check if master account is configured
 */
export function isMasterAccountConfigured(): boolean {
  return !!process.env.ANTIGRAVITY_REFRESH_TOKEN;
}
