# Terminal Security and Stability Fixes - Technical Implementation Plan

**Document Created:** 2026-03-06  
**Priority:** P0 (Critical Security)  
**Status:** In Progress

---

## Executive Summary

This document outlines comprehensive security and stability fixes for the terminal subsystem, MCP integration, and sandbox service bridge. The fixes address 12+ critical/high severity issues including authentication bypasses, resource leaks, race conditions, and missing security validations.

### Key Security Risks Addressed

1. **WebSocket Token Exposure** - Tokens passed via URL query parameters (logged in server logs)
2. **MCP CLI Server No Auth** - HTTP server on port 8888 accessible without authentication
3. **Sandbox Ownership Not Verified** - Any authenticated user can access any sandbox
4. **Command Buffer Security Bypass** - Multi-chunk dangerous commands not properly validated
5. **XSS via localStorage Token** - Token stored in localStorage vulnerable to XSS attacks

---

## Architecture Overview

### Current Terminal Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (TerminalPanel.tsx)                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Token: localStorage.getItem('token')  ⚠️ XSS VULNERABILITY      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                            │                                             │
│                            │ WebSocket: ws://localhost:8080?token=xxx   │
│                            │ ⚠️ TOKEN IN URL - LOGGED                    │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────────┐
│                    Custom Server (server.ts)                             │
│                            │                                             │
│              ┌─────────────▼──────────────┐                             │
│              │  WebSocket Upgrade Handler │                             │
│              │  - Token from query param  │                             │
│              │  - ⚠️ NO sandbox ownership check │                        │
│              └─────────────┬──────────────┘                             │
│                            │                                             │
│              ┌─────────────▼──────────────┐                             │
│              │   Terminal Manager          │                             │
│              │   - PTY connections         │                             │
│              │   - ⚠️ Connection leaks      │                             │
│              │   - ⚠️ No timeout            │                             │
│              └─────────────┬──────────────┘                             │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────────┐
│                    API Routes (Next.js)                                  │
│                            │                                             │
│    ┌───────────────────────┼───────────────────────┐                    │
│    │                       │                       │                    │
│ ┌──▼──────────┐    ┌──────▼────────┐    ┌────────▼────────┐           │
│ │ /terminal   │    │ /terminal/input│    │ /terminal/ws    │           │
│ │ POST/DELETE │    │ POST          │    │ GET (info only) │           │
│ │ ⚠️ Auth gap  │    │ ⚠️ Buffer race│    │ ⚠️ Token in URL │           │
│ └─────────────┘    └───────────────┘    └─────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Proposed Secure Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (TerminalPanel.tsx)                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Token: httpOnly Cookie (set by auth middleware) ✅             │   │
│  │  Alternative: Authorization: Bearer <token> header ✅           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                            │                                             │
│                            │ WebSocket: Authorization header / Cookie   │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────────┐
│                    Custom Server (server.ts)                             │
│                            │                                             │
│              ┌─────────────▼──────────────┐                             │
│              │  WebSocket Upgrade Handler │                             │
│              │  ✅ Token from cookie/header          │
│              │  ✅ JWT verification + sandbox ownership check │          │
│              │  ✅ Rate limiting per user  │                             │
│              └─────────────┬──────────────┘                             │
│                            │                                             │
│              ┌─────────────▼──────────────┐                             │
│              │   Terminal Manager          │                             │
│              │   ✅ Connection timeout (30s)│                            │
│              │   ✅ Atomic check-and-register │                          │
│              │   ✅ Proper cleanup on error │                             │
│              └─────────────┬──────────────┘                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Week 1: Critical Security Fixes

### 1.1 Remove Token from URL - Use Cookies/Headers

**Files Modified:**
- `hooks/use-websocket-terminal.ts`
- `server.ts`
- `app/api/sandbox/terminal/ws/route.ts`
- `lib/backend/websocket-terminal.ts`
- `components/terminal/TerminalPanel.tsx`

**Implementation:**

#### 1.1.1 Frontend - Use Authorization Header Instead of localStorage

```typescript
// hooks/use-websocket-terminal.ts

// BEFORE (VULNERABLE):
const getAuthToken = useCallback(() => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('token'); // ⚠️ XSS VULNERABILITY
  } catch {
    return null;
  }
}, []);

const buildWebSocketUrl = useCallback(() => {
  const token = getAuthToken();
  const url = new URL(`${WS_URL}/sandboxes/${sandboxId}/terminal`);
  if (token) {
    url.searchParams.set('token', token); // ⚠️ TOKEN IN URL - LOGGED
  }
  return url.toString();
}, [sandboxId, getAuthToken]);

// AFTER (SECURE):
const getAuthToken = useCallback(() => {
  if (typeof window === 'undefined') return null;
  try {
    // Primary: Try to get from httpOnly cookie (set by auth middleware)
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('auth_token='))
      ?.split('=')[1];
    
    if (cookieValue) {
      return decodeURIComponent(cookieValue);
    }
    
    // Fallback: Authorization header from session storage (more secure than localStorage)
    return sessionStorage.getItem('auth_token');
  } catch {
    return null;
  }
}, []);

const buildWebSocketUrl = useCallback(() => {
  // Token NOT passed in URL - will use Authorization header or cookie
  const url = new URL(`${WS_URL}/sandboxes/${sandboxId}/terminal`);
  return url.toString();
}, [sandboxId]);

const connect = useCallback(() => {
  // ... existing connection logic ...
  
  wsRef.current = new WebSocket(url, ['Bearer', getAuthToken() || '']);
  
  // Alternative: Set header via WebSocket subprotocol
  // wsRef.current = new WebSocket(url, [`Bearer ${getAuthToken()}`]);
}, [buildWebSocketUrl, getAuthToken]);
```

#### 1.1.2 Server - Extract Token from Cookie/Header

```typescript
// server.ts

wss.on('connection', (ws: WebSocket, req: IncomingMessage, context: any) => {
  const { sessionId, sandboxId, userId } = context;
  const sessionKey = `${sessionId}-${userId}`;

  // ✅ EXTRACT TOKEN FROM COOKIE OR HEADER (not URL)
  let token: string | null = null;
  
  // Try cookie first
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    token = cookies['auth_token'];
  }
  
  // Try Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  
  // Try WebSocket subprotocol
  if (!token && req.protocol && req.protocol.startsWith('Bearer ')) {
    token = req.protocol.substring(7);
  }

  if (!token) {
    ws.close(4001, 'Authentication required');
    return;
  }

  // ✅ VERIFY JWT TOKEN
  try {
    const payload = verifyToken(token);
    const tokenUserId = payload.userId || payload.sub;
    
    // ✅ VERIFY SANDBOX OWNERSHIP
    const userSession = sandboxBridge.getSessionByUserId(tokenUserId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      ws.close(4005, 'Unauthorized: sandbox not owned by this user');
      return;
    }
    
    // Verify session matches
    if (userSession.sessionId !== sessionId) {
      ws.close(4006, 'Unauthorized: invalid session');
      return;
    }
  } catch (error: any) {
    ws.close(4003, `Authentication failed: ${error.message}`);
    return;
  }

  // ... rest of connection logic ...
});
```

#### 1.1.3 Auth Middleware - Set httpOnly Cookie

```typescript
// lib/auth/request-auth.ts (NEW HELPER)

import { NextRequest } from 'next/server';
import { verifyToken } from './jwt-auth';

export interface AuthResult {
  success: boolean;
  userId?: string;
  source: 'jwt' | 'anonymous' | 'none';
  error?: string;
}

export interface AuthOptions {
  allowAnonymous?: boolean;
  requireCookie?: boolean;
}

export async function resolveRequestAuth(
  req: NextRequest,
  options: AuthOptions = {}
): Promise<AuthResult> {
  const { allowAnonymous = false, requireCookie = false } = options;

  // Try Authorization header first
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const payload = verifyToken(token);
      return {
        success: true,
        userId: payload.userId || payload.sub,
        source: 'jwt',
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Invalid token: ${error.message}`,
        source: 'none',
      };
    }
  }

  // Try cookie
  const cookie = req.cookies.get('auth_token');
  if (cookie?.value) {
    try {
      const payload = verifyToken(cookie.value);
      return {
        success: true,
        userId: payload.userId || payload.sub,
        source: 'jwt',
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Invalid cookie: ${error.message}`,
        source: 'none',
      };
    }
  }

  // Try anonymous session
  if (allowAnonymous) {
    const anonymousSessionId = req.headers.get('x-anonymous-session-id');
    if (anonymousSessionId) {
      return {
        success: true,
        userId: `anon:${anonymousSessionId}`,
        source: 'anonymous',
      };
    }
  }

  return {
    success: false,
    error: 'Authentication required',
    source: 'none',
  };
}

/**
 * Set auth token as httpOnly cookie in response
 */
export function setAuthCookie(response: Response, token: string): void {
  response.headers.set('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
}
```

---

### 1.2 Add Authentication to MCP CLI Server

**Files Modified:**
- `lib/mcp/mcp-cli-server.ts`

**Implementation:**

```typescript
// lib/mcp/mcp-cli-server.ts

import { createServer, Server } from 'http';
import { mcpToolRegistry } from './tool-registry';
import { createLogger } from '../utils/logger';
import { verifyToken } from '../security/jwt-auth';

const logger = createLogger('MCP:CLI-Server');

let httpServer: Server | null = null;

// ✅ SECURITY CONFIGURATION
const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
const ALLOWED_ORIGINS = process.env.MCP_ALLOWED_ORIGINS || 'http://localhost:3000';
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN; // Shared secret for CLI auth

/**
 * Verify authentication token
 */
function verifyAuthToken(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  
  // Support Bearer token
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      verifyToken(token); // Verify JWT
      return true;
    } catch {
      return false;
    }
  }
  
  // Support shared secret for CLI
  if (MCP_AUTH_TOKEN && authHeader === `Bearer ${MCP_AUTH_TOKEN}`) {
    return true;
  }
  
  return false;
}

/**
 * Create HTTP server for CLI agent to call MCP tools
 * ✅ ENHANCED WITH AUTHENTICATION AND SECURITY
 */
export async function createMCPServerForCLI(port: number = 8888): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const server = createServer(async (req, res) => {
        // ✅ SECURITY: Restrict CORS
        const origin = req.headers.origin || '';
        const allowedOrigins = ALLOWED_ORIGINS.split(',');
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin || '*');
        } else {
          res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Route handling
        const url = new URL(req.url || '', `http://localhost:${port}`);

        try {
          switch (url.pathname) {
            case '/health':
              handleHealth(res);
              break;

            case '/tools':
              await handleListTools(req, res);
              break;

            case '/call':
              await handleCallTool(req, res);
              break;

            case '/discover':
              await handleDiscover(res);
              break;

            default:
              res.writeHead(404);
              res.end(JSON.stringify({ error: 'Not found' }));
          }
        } catch (error: any) {
          logger.error('Request handling error', error);
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      server.listen(port, () => {
        logger.info(`MCP CLI server listening on port ${port}`);
        httpServer = server;
        resolve();
      });

      server.on('error', (error) => {
        logger.error('MCP CLI server error', error);
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * List available tools
 * ✅ REQUIRES AUTHENTICATION
 */
async function handleListTools(req: any, res: any): Promise<void> {
  // ✅ AUTH CHECK
  if (!verifyAuthToken(req.headers['authorization'])) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized: valid JWT or MCP auth token required' }));
    return;
  }

  const tools = mcpToolRegistry.getAllTools();

  res.writeHead(200);
  res.end(JSON.stringify({
    tools: tools.map(wrapper => ({
      name: wrapper.tool.name,
      description: wrapper.tool.description,
      inputSchema: wrapper.tool.inputSchema,
      serverId: wrapper.serverId,
    })),
  }));
}

/**
 * Call a tool
 * ✅ REQUIRES AUTHENTICATION + BODY SIZE LIMIT
 */
async function handleCallTool(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ✅ AUTH CHECK
  if (!verifyAuthToken(req.headers['authorization'])) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized: valid JWT or MCP auth token required' }));
    return;
  }

  // ✅ BODY SIZE LIMIT
  let body = '';
  let bodySize = 0;
  
  req.on('data', chunk => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      res.writeHead(413);
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.destroy();
      return;
    }
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { toolName, args } = JSON.parse(body);

      if (!toolName) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'toolName is required' }));
        return;
      }

      logger.info(`CLI calling tool: ${toolName}`, { args });

      const result = await mcpToolRegistry.callTool(toolName, args || {});

      res.writeHead(result.success ? 200 : 400);
      res.end(JSON.stringify({
        success: result.success,
        content: result.content,
        duration: result.duration,
      }));
    } catch (error: any) {
      logger.error('Tool call error', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

// ... rest of handlers with auth checks ...

/**
 * Shutdown the HTTP server
 * ✅ CALLED ON PROCESS EXIT
 */
export async function shutdownMCPServer(): Promise<void> {
  return new Promise((resolve) => {
    if (httpServer) {
      httpServer.close(() => {
        logger.info('MCP CLI server shut down');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ✅ REGISTER SHUTDOWN HANDLER
process.on('SIGTERM', async () => {
  await shutdownMCPServer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownMCPServer();
  process.exit(0);
});
```

---

### 1.3 Verify Sandbox Ownership in WebSocket Server

**Files Modified:**
- `lib/backend/websocket-terminal.ts`
- `server.ts`

**Implementation:**

```typescript
// lib/backend/websocket-terminal.ts

// After JWT verification, add sandbox ownership check:

private handleConnection(ws: WebSocket, req: any): void {
  // ... existing token extraction ...

  // Verify JWT token
  try {
    const payload = verifyToken(token);

    // ✅ VERIFY SANDBOX OWNERSHIP
    const userId = payload.userId || payload.sub;
    if (!userId) {
      ws.close(4002, 'Invalid token: missing user ID');
      return;
    }

    // Check if user owns this sandbox
    const userSession = sandboxBridge.getSessionByUserId(userId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      logger.warn(`Unauthorized WebSocket access: user ${userId} tried to access sandbox ${sandboxId}`);
      ws.close(4005, 'Unauthorized: sandbox not owned by this user');
      return;
    }

    logger.info(`WebSocket authenticated for user ${userId}, sandbox ${sandboxId}`);

  } catch (error: any) {
    logger.warn(`WebSocket authentication failed: ${error.message}`);
    ws.close(4003, `Authentication failed: ${error.message}`);
    return;
  }

  // ... rest of connection logic ...
}
```

---

### 1.4 Fix Command Buffer Security Validation Order

**Files Modified:**
- `app/api/sandbox/terminal/input/route.ts`

**Implementation:**

```typescript
// app/api/sandbox/terminal/input/route.ts

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { sessionId, data } = body;

    if (!sessionId || typeof data !== 'string') {
      return NextResponse.json(
        { error: 'sessionId and data are required' },
        { status: 400 }
      );
    }

    // ✅ INPUT SIZE LIMIT (max 10KB per input)
    if (data.length > 10240) {
      return NextResponse.json(
        { error: 'Input too large (max 10KB)' },
        { status: 400 }
      );
    }

    // ✅ VALIDATE SESSION BEFORE BUFFERING
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sessionId !== sessionId) {
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    // Check rate limit (after auth and session validation)
    const rateLimitResult = checkRateLimit(authResult.userId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: rateLimitResult.retryAfter,
        },
        { status: 429 }
      );
    }

    // SECURITY: Buffer ALL input for security validation
    const bufferEntry = commandBuffers.get(sessionId) || { buffer: '', lastActivity: Date.now() };
    bufferEntry.buffer += data;
    bufferEntry.lastActivity = Date.now();
    
    // ✅ BUFFER SIZE LIMIT
    if (bufferEntry.buffer.length > 10240) {
      commandBuffers.delete(sessionId);
      return NextResponse.json(
        { error: 'Command buffer overflow (max 10KB)' },
        { status: 400 }
      );
    }
    
    commandBuffers.set(sessionId, bufferEntry);

    // Check if we have a complete command
    if (bufferEntry.buffer.includes('\n') || bufferEntry.buffer.includes('\r')) {
      const fullCommand = bufferEntry.buffer.trim();
      const securityResult = checkCommandSecurity(fullCommand);

      if (!securityResult.allowed) {
        // ✅ TRUNCATE LOGGED COMMANDS
        const truncatedCommand = fullCommand.length > 100
          ? fullCommand.substring(0, 100) + '...'
          : fullCommand;
        
        logger.warn('Blocked dangerous command', {
          command: truncatedCommand,
          reason: securityResult.reason,
          severity: securityResult.severity,
          userId: authResult.userId,
          sessionId,
        });

        commandBuffers.delete(sessionId);

        return NextResponse.json(
          {
            error: 'Command blocked for security reasons',
            reason: securityResult.reason,
            severity: securityResult.severity,
          },
          { status: 403 }
        );
      }

      // ✅ SECURITY CHECK PASSES - NOW FORWARD TO TERMINAL
      await terminalManager.sendInput(sessionId, data);

      // Clear buffer after successful validation and forwarding
      commandBuffers.delete(sessionId);

      return NextResponse.json({ success: true });
    }

    // Partial command (buffered, waiting for newline)
    return NextResponse.json({ success: true, buffered: true });
  } catch (error) {
    const err = error as Error;
    logger.error('Terminal input error', { message: err.message });
    return NextResponse.json({ error: 'Failed to send input' }, { status: 500 });
  }
}
```

---

### 1.5 Add Input Size Limits Everywhere

**Files Modified:**
- `app/api/sandbox/terminal/route.ts`
- `app/api/sandbox/terminal/input/route.ts`
- `lib/backend/websocket-terminal.ts`
- `lib/sandbox/terminal-manager.ts`

**Implementation:**

```typescript
// Constants file (NEW or existing)
// lib/terminal/terminal-constants.ts

export const TERMINAL_LIMITS = {
  MAX_INPUT_SIZE: 10240, // 10KB per input
  MAX_BUFFER_SIZE: 10240, // 10KB command buffer
  MAX_COMMANDS_PER_SECOND: 5, // Reduced from 10
  MAX_WEBSOCKET_MESSAGE_SIZE: 10240, // 10KB
  CONNECTION_TIMEOUT_MS: 30000, // 30 seconds
  IDLE_TIMEOUT_MS: 1800000, // 30 minutes
  CLEANUP_INTERVAL_MS: 60000, // 1 minute
  MAX_SESSIONS_PER_USER: 3,
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_BASE_DELAY_MS: 1000,
};
```

---

## Week 2: Stability Fixes

### 2.1 Fix Connection Leaks in Terminal Manager

**Files Modified:**
- `lib/sandbox/terminal-manager.ts`

**Implementation:**

```typescript
// lib/sandbox/terminal-manager.ts

export class TerminalManager {
  // ... existing code ...

  async createTerminalSession(
    sessionId: string,
    sandboxId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
    options?: { cols?: number; rows?: number },
    userId?: string,
  ): Promise<string> {
    const { handle, providerType } = await this.resolveHandleForSandbox(sandboxId);
    const provider = await getSandboxProvider(providerType);
    const ptyId = `pty-${sessionId}-${Date.now()}`;

    // ✅ CLEAN UP EXISTING CONNECTION FIRST
    await this.disconnectTerminal(sessionId);

    // ... existing event emission ...

    if (!handle.createPty) {
      // Command mode setup
      commandModeConnections.set(sessionId, {
        // ... existing config ...
      });
      return 'command-mode';
    }

    // ✅ ADD CONNECTION TIMEOUT
    const CONNECTION_TIMEOUT_MS = TERMINAL_LIMITS.CONNECTION_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        activePtyConnections.delete(sessionId);
        reject(new Error(`PTY connection timeout after ${CONNECTION_TIMEOUT_MS}ms`));
      }, CONNECTION_TIMEOUT_MS)
    );

    const ptyHandle = await handle.createPty({
      // ... existing config ...
    });

    // ✅ RACE CONDITION FIX: Atomic connection with timeout
    try {
      await Promise.race([
        ptyHandle.waitForConnection(),
        timeoutPromise,
      ]);
    } catch (error: any) {
      // ✅ CLEAN UP ON ERROR
      activePtyConnections.delete(sessionId);
      throw error;
    }

    activePtyConnections.set(sessionId, {
      ptyHandle,
      sandboxId,
      sessionId,
      lastActive: Date.now(),
      detectedPorts: new Set(),
    });

    // ... rest of setup ...
    return ptyId;
  }

  /**
   * ✅ VERIFY PTY EXISTS BEFORE REGISTERING WEBSOCKET
   */
  registerWebSocketConnection(ws: any, sessionId: string, sandboxId: string): void {
    if (!this.hasPtyConnection(sessionId)) {
      throw new Error('Cannot register WebSocket without PTY connection');
    }
    
    websocketConnections.set(sessionId, {
      ws,
      sandboxId,
      sessionId,
      lastActive: Date.now(),
      detectedPorts: new Set(),
    });
  }

  /**
   * ✅ ADD CONNECTION TIMEOUT FOR WEBSOCKET
   */
  private setupWebSocketTimeout(ws: any, sessionId: string): void {
    const timeout = setTimeout(() => {
      if (ws.readyState === 1) { // OPEN
        ws.close(4008, 'Connection timeout');
      }
      this.unregisterWebSocketConnection(sessionId);
    }, TERMINAL_LIMITS.CONNECTION_TIMEOUT_MS);

    ws.on('close', () => clearTimeout(timeout));
    ws.on('error', () => clearTimeout(timeout));
  }
}
```

---

### 2.2 Add Rate Limiting to All Endpoints

**Files Modified:**
- `app/api/sandbox/terminal/route.ts`
- `app/api/sandbox/terminal/input/route.ts`
- `app/api/sandbox/terminal/ws/route.ts`

**Implementation:**

```typescript
// lib/utils/rate-limiter.ts (NEW or enhanced)

interface RateLimitEntry {
  count: number;
  resetAt: number;
  blockedUntil?: number;
}

class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  
  constructor(
    private maxRequests: number,
    private windowMs: number,
    private blockDurationMs: number = 60000
  ) {}

  check(userId: string): { allowed: boolean; retryAfter?: number; blockedUntil?: number } {
    const now = Date.now();
    const entry = this.limits.get(userId) || { count: 0, resetAt: now + this.windowMs };

    // Check if user is blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        blockedUntil: entry.blockedUntil,
      };
    }

    // Reset if window expired
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + this.windowMs;
      entry.blockedUntil = undefined;
    }

    // Check limit
    if (entry.count >= this.maxRequests) {
      // Block user if they exceed limit too many times
      if (entry.count >= this.maxRequests * 2) {
        entry.blockedUntil = now + this.blockDurationMs;
      }
      
      this.limits.set(userId, entry);
      return {
        allowed: false,
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      };
    }

    entry.count++;
    this.limits.set(userId, entry);
    return { allowed: true };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [userId, entry] of this.limits.entries()) {
      if (now > entry.resetAt + this.blockDurationMs) {
        this.limits.delete(userId);
      }
    }
  }
}

// Export pre-configured limiters
export const terminalCommandRateLimiter = new RateLimiter(5, 1000); // 5 commands/second
export const sandboxCreationRateLimiter = new RateLimiter(3, 60000); // 3 sandboxes/minute
export const websocketConnectionRateLimiter = new RateLimiter(10, 60000); // 10 connections/minute

// Cleanup old entries every minute
setInterval(() => {
  terminalCommandRateLimiter.cleanup();
  sandboxCreationRateLimiter.cleanup();
  websocketConnectionRateLimiter.cleanup();
}, 60000);
```

---

### 2.3 Fix Race Conditions in Session Creation

**Files Modified:**
- `app/api/sandbox/terminal/route.ts`
- `lib/sandbox/sandbox-service-bridge.ts`

**Implementation:**

```typescript
// app/api/sandbox/terminal/route.ts

import { sandboxCreationRateLimiter } from '@/lib/utils/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    // ✅ REQUIRE AUTH (no anonymous for sandbox creation)
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // ✅ SANDBOX REQUIRES AUTHENTICATED USER
    if (authResult.source === 'anonymous') {
      return NextResponse.json({
        error: 'Sandbox terminal requires authentication',
        requiresAuth: true,
      }, { status: 401 });
    }

    // ✅ RATE LIMIT SANDBOX CREATION
    const rateLimit = sandboxCreationRateLimiter.check(authResult.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many sandbox creation requests',
          retryAfter: rateLimit.retryAfter,
          blockedUntil: rateLimit.blockedUntil,
        },
        { status: 429 }
      );
    }

    // Get existing sandbox session
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);

    // If session exists, verify the sandbox is still valid
    if (userSession) {
      try {
        const provider = sandboxBridge.inferProviderFromSandboxId(userSession.sandboxId)
          || (process.env.SANDBOX_PROVIDER as any) || 'daytona';
        const sandboxProvider = await sandboxBridge.getProvider(provider);
        await sandboxProvider.getSandbox(userSession.sandboxId);

        return NextResponse.json({
          sessionId: userSession.sessionId,
          sandboxId: userSession.sandboxId,
        });
      } catch (error: any) {
        // ✅ BETTER ERROR CLASSIFICATION
        const isNotFound = error?.status === 404 || 
                          error?.code === 'NOT_FOUND' ||
                          error?.message?.includes('not found');

        const isProviderError = error?.message?.includes('API key') || 
                               error?.message?.includes('authentication') ||
                               error?.message?.includes('Invalid');

        if (isProviderUnavailable) {
          console.log('[Terminal] Provider unavailable, keeping session for fallback:', userSession.sandboxId);
        } else if (isNotFound) {
          console.log('[Terminal] Stale session detected, cleaning up:', userSession.sandboxId);
          sandboxBridge.deleteSession(userSession.sessionId);
        } else {
          console.log('[Terminal] Sandbox verification error:', error?.message);
        }
      }
    }

    // Create new sandbox session
    const session = await sandboxBridge.getOrCreateSession(authResult.userId, {
      language: 'typescript',
    });
    
    return NextResponse.json({
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
    }, { status: 201 });
  } catch (error) {
    console.error('[Terminal] Create error:', error);
    return NextResponse.json({ error: 'Failed to create terminal session' }, { status: 500 });
  }
}
```

---

### 2.4 Add Proper Cleanup on Error Paths

**Files Modified:**
- `lib/sandbox/terminal-manager.ts`
- `lib/sandbox/terminal-session-store.ts`
- `lib/backend/websocket-terminal.ts`

**Implementation:**

```typescript
// lib/sandbox/terminal-manager.ts

async disconnectTerminal(sessionId: string): Promise<void> {
  const conn = activePtyConnections.get(sessionId);
  if (conn) {
    try {
      await conn.ptyHandle.disconnect();
      emitEvent(conn.sandboxId, 'disconnected', {
        sessionId,
        reason: 'user_requested',
      });
    } catch (error: any) {
      logger.error('Disconnect error', { sessionId, error: error.message });
    } finally {
      // ✅ ALWAYS CLEAN UP MAP ENTRY
      activePtyConnections.delete(sessionId);
    }

    deleteTerminalSession(sessionId);
  }

  // ... similar for commandModeConnections ...
}

async killTerminal(sessionId: string): Promise<void> {
  const conn = activePtyConnections.get(sessionId);
  if (conn) {
    try {
      await conn.ptyHandle.kill();
      emitEvent(conn.sandboxId, 'disconnected', {
        sessionId,
        reason: 'killed',
      });
    } catch (error: any) {
      logger.error('Kill error', { sessionId, error: error.message });
    } finally {
      activePtyConnections.delete(sessionId);
    }

    deleteTerminalSession(sessionId);
  }

  // ... similar for commandModeConnections ...
}
```

---

### 2.5 Add Connection Timeouts

**Files Modified:**
- `lib/backend/websocket-terminal.ts`
- `server.ts`
- `hooks/use-websocket-terminal.ts`

**Implementation:**

```typescript
// lib/backend/websocket-terminal.ts

private handleConnection(ws: WebSocket, req: any): void {
  // ... authentication ...

  // ✅ PING/PONG WITH TIMEOUT
  const PING_INTERVAL_MS = 30000;
  const PONG_TIMEOUT_MS = 60000;
  let pongTimeout: NodeJS.Timeout | null = null;

  ws.on('pong', () => {
    if (pongTimeout) {
      clearTimeout(pongTimeout);
      pongTimeout = null;
    }
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      
      // Set pong timeout
      pongTimeout = setTimeout(() => {
        logger.warn('WebSocket pong timeout, closing connection');
        ws.close(4008, 'Pong timeout');
      }, PONG_TIMEOUT_MS);
    }
  }, PING_INTERVAL_MS);

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (pongTimeout) clearTimeout(pongTimeout);
  });

  ws.on('error', () => {
    clearInterval(pingInterval);
    if (pongTimeout) clearTimeout(pongTimeout);
  });

  // ... rest of setup ...
}
```

---

## Week 3: Hardening

### 3.1 Improve Obfuscation Detection

**Files Modified:**
- `lib/terminal/terminal-security.ts`

**Implementation:**

```typescript
// lib/terminal/terminal-security.ts

// ✅ ADD MORE PYTHON ESCAPE PATTERNS
const PYTHON_DANGEROUS_PATTERNS: DangerPattern[] = [
  // ... existing patterns ...
  
  // ✅ NEW: OS command execution
  { pattern: /os\.popen|os\.system|subprocess\./, reason: 'OS command execution', severity: 'critical' },
  
  // ✅ NEW: Native code execution
  { pattern: /ctypes\./, reason: 'Native code execution', severity: 'critical' },
  
  // ✅ NEW: Arbitrary code deserialization
  { pattern: /pickle\.loads?/, reason: 'Arbitrary code deserialization', severity: 'critical' },
  
  // ✅ NEW: Import hook manipulation
  { pattern: /__import__|importlib\./, reason: 'Dynamic import', severity: 'high' },
  
  // ✅ NEW: Built-in bypass attempts
  { pattern: /builtins\.|__builtins__/, reason: 'Built-in access', severity: 'high' },
];

// ✅ CONTEXT-AWARE SECURITY
export function checkCommandSecurityWithContext(
  command: string,
  cwd: string = '/workspace'
): SecurityCheckResult {
  const isSafeDirectory = cwd.startsWith('/workspace') || cwd.startsWith('/home');
  
  // Relax certain restrictions in safe directories
  if (isSafeDirectory) {
    // Allow rm -rf * in /workspace but not in /
    const result = checkCommandSecurity(command);
    if (result.reason?.includes('Recursive delete') && isSafeDirectory) {
      return { allowed: true, severity: 'low' };
    }
    return result;
  }
  
  // Stricter checks outside safe directories
  return checkCommandSecurity(command);
}

// ✅ IMPROVED OBFUSCATION DETECTION
function decodeAndCheckCommand(command: string): { decoded: string; wasObfuscated: boolean } {
  let decoded = command;
  let wasObfuscated = false;

  // ✅ NEW: Python chr() array detection
  const chrArrayPattern = /chr\s*\(\s*\d+\s*\)\s*\+?\s*/g;
  if (chrArrayPattern.test(command)) {
    try {
      const chrMatches = command.matchAll(/chr\s*\(\s*(\d+)\s*\)/g);
      const decodedChr = Array.from(chrMatches)
        .map(m => String.fromCharCode(parseInt(m[1], 10)))
        .join('');
      if (decodedChr.length > 0) {
        decoded = decoded.replace(chrArrayPattern, decodedChr);
        wasObfuscated = true;
      }
    } catch {
      // Continue with original
    }
  }

  // ✅ NEW: Base64 in Python
  const pythonBase64Pattern = /base64\.b64decode\s*\(\s*['"]([^'"]+)['"]/g;
  const pythonBase64Match = command.match(pythonBase64Pattern);
  if (pythonBase64Match) {
    try {
      for (const match of pythonBase64Match) {
        const base64Str = match.match(/['"]([^'"]+)['"]/)?.[1];
        if (base64Str) {
          const decodedBase64 = Buffer.from(base64Str, 'base64').toString('utf-8');
          decoded = decoded.replace(match, decodedBase64);
          wasObfuscated = true;
        }
      }
    } catch {
      // Continue with original
    }
  }

  // ... existing patterns ...

  return { decoded, wasObfuscated };
}
```

---

### 3.2 Add Circuit Breakers to All Providers

**Files Modified:**
- `lib/sandbox/providers/index.ts`
- `lib/mcp/mcporter-integration.ts`

**Implementation:**

```typescript
// lib/mcp/mcporter-integration.ts

private async getRuntime(): Promise<Runtime> {
  if (this.runtime) return this.runtime;

  if (this.runtimeInitPromise) {
    return this.runtimeInitPromise;
  }

  // ✅ ADD RETRY LOGIC WITH BACKOFF
  let lastError: Error;
  const MAX_RETRIES = 3;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      this.runtimeInitPromise = createRuntime({
        servers: this.toServerDefinitions(),
        rootDir: process.cwd(),
      });
      
      this.runtime = await this.runtimeInitPromise;
      return this.runtime;
    } catch (error: any) {
      lastError = error;
      logger.warn(`Runtime init failed (attempt ${attempt}/${MAX_RETRIES}):`, error.message);
      
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 100; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  this.runtimeInitPromise = null;
  throw lastError;
}

// ✅ ADD TIMEOUT TO TOOL CALLS
async callTool(
  qualifiedName: string,
  args: Record<string, any>,
  timeoutMs: number = TERMINAL_LIMITS.CONNECTION_TIMEOUT_MS
): Promise<{ success: boolean; output: string; isError?: boolean; serverId: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const runtime = await this.getRuntime();
    const result = await runtime.callTool(
      qualifiedName.split(':')[0],
      qualifiedName.split(':')[1],
      {
        args,
        signal: controller.signal,
      }
    );

    const output = this.normalizeCallOutput(result);
    const isError = !!(result as any)?.isError;

    return {
      success: !isError,
      output,
      isError,
      serverId: qualifiedName.split(':')[0],
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        output: `Tool call timed out after ${timeoutMs}ms`,
        isError: true,
        serverId: qualifiedName.split(':')[0],
      };
    }
    
    return {
      success: false,
      output: error?.message || 'mcporter tool call failed',
      isError: true,
      serverId: qualifiedName.split(':')[0],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

### 3.3 Fix Streaming Error Handling

**Files Modified:**
- `lib/streaming.ts`

**Implementation:**

```typescript
// lib/streaming.ts

export async function* normalizeStream(
  iterator: AsyncIterable<any> | Promise<AsyncIterable<any>>
): AsyncIterable<StreamPart> {
  let it: AsyncIterable<any>;
  
  try {
    it = await iterator;
  } catch (error: any) {
    yield { 
      text: `\n[Stream initialization error: ${error.message}]\n`,
      error: error.message,
    };
    return;
  }

  try {
    for await (const chunk of it) {
      if (!chunk) continue;
      
      if (typeof chunk === 'string') {
        yield { text: chunk };
        continue;
      }
      
      if (chunk.message && chunk.message.content) {
        yield { text: chunk.message.content };
        continue;
      }
      
      if (chunk.delta && chunk.delta.content) {
        yield { text: chunk.delta.content };
        continue;
      }
      
      if (chunk.text) {
        yield { text: chunk.text, ...chunk };
        continue;
      }
      
      try {
        yield { text: JSON.stringify(chunk) };
      } catch {
        yield { text: String(chunk) };
      }
    }
  } catch (error: any) {
    // ✅ CATCH ITERATOR ERRORS
    yield { 
      text: `\n[Stream error: ${error.message}]\n`,
      error: error.message,
    };
  }
}
```

---

### 3.4 Add Comprehensive Logging with Context

**Files Modified:**
- All terminal-related files

**Implementation:**

```typescript
// lib/utils/logger.ts (ENHANCED)

import { createLogger as baseCreateLogger } from 'next-logger';

export interface LogContext {
  userId?: string;
  sessionId?: string;
  sandboxId?: string;
  provider?: string;
  action?: string;
  [key: string]: any;
}

export function createLogger(namespace: string) {
  const baseLogger = baseCreateLogger(namespace);

  return {
    info: (message: string, context?: LogContext) => {
      baseLogger.info({ message, ...context });
    },
    warn: (message: string, context?: LogContext) => {
      baseLogger.warn({ message, ...context });
    },
    error: (message: string, context?: LogContext & { error?: Error }) => {
      baseLogger.error({ 
        message, 
        error: context?.error ? {
          name: context.error.name,
          message: context.error.message,
          stack: context.error.stack,
        } : undefined,
        ...context 
      });
    },
    debug: (message: string, context?: LogContext) => {
      baseLogger.debug({ message, ...context });
    },
  };
}
```

---

## Testing Strategy

### Test Suites to Add

```typescript
// tests/terminal/terminal-security.test.ts

import { checkCommandSecurity, detectObfuscation } from '@/lib/terminal/terminal-security';

describe('Terminal Security', () => {
  describe('Multi-chunk command detection', () => {
    it('should block dangerous commands split across chunks', async () => {
      // Simulate sending "rm -rf" then " /" in separate requests
      const chunk1 = 'rm -rf';
      const chunk2 = ' /';
      
      // Buffer should detect the combined command
      const combined = chunk1 + chunk2;
      const result = checkCommandSecurity(combined);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('delete');
    });
  });

  describe('Obfuscation detection', () => {
    it('should detect base64 encoded commands', () => {
      const encoded = 'echo "cm0gLXJmIC8=" | base64 -d | bash';
      const result = checkCommandSecurity(encoded);
      
      expect(result.wasObfuscated).toBe(true);
      expect(result.allowed).toBe(false);
    });

    it('should detect chr() array obfuscation', () => {
      const obfuscated = 'python -c "print(chr(114)+chr(109))"';
      const result = detectObfuscation(obfuscated);
      
      expect(result.detected).toBe(true);
      expect(result.patterns).toContain('Character code obfuscation');
    });

    it('should detect hex encoding', () => {
      const hexCommand = 'echo "\\x72\\x6d \\x2d\\x72\\x66 \\x2f"';
      const result = checkCommandSecurity(hexCommand);
      
      expect(result.wasObfuscated).toBe(true);
    });

    it('should detect Python chr() bypass attempts', () => {
      const pythonObfuscated = 'python -c "exec(chr(111)+chr(115)+chr(46)+chr(115)+chr(121)+chr(115)+chr(116)+chr(101)+chr(109)+chr(40)+chr(39)+chr(114)+chr(109)+chr(32)+chr(45)+chr(114)+chr(102)+chr(32)+chr(47)+chr(39)+chr(41))"';
      const result = checkCommandSecurity(pythonObfuscated);
      
      expect(result.allowed).toBe(false);
    });
  });

  describe('Context-aware security', () => {
    it('should allow rm -rf * in /workspace', () => {
      const result = checkCommandSecurityWithContext('rm -rf *', '/workspace');
      expect(result.allowed).toBe(true);
    });

    it('should block rm -rf * in root directory', () => {
      const result = checkCommandSecurityWithContext('rm -rf *', '/');
      expect(result.allowed).toBe(false);
    });
  });
});

// tests/terminal/websocket-security.test.ts

describe('WebSocket Terminal', () => {
  it('should reject connections without valid token', async () => {
    const ws = new WebSocket('ws://localhost:8080/sandboxes/test-sandbox/terminal');
    
    await new Promise((resolve) => {
      ws.onclose = (event) => {
        expect(event.code).toBe(4001);
        expect(event.reason).toContain('Authentication required');
        resolve(true);
      };
    });
  });

  it('should verify sandbox ownership', async () => {
    // Create sandbox for user A
    const sandboxA = await createSandbox('user-a');
    
    // Try to connect with user B's token
    const tokenB = generateToken('user-b');
    const ws = new WebSocket(
      `ws://localhost:8080/sandboxes/${sandboxA.id}/terminal`,
      [`Bearer ${tokenB}`]
    );
    
    await new Promise((resolve) => {
      ws.onclose = (event) => {
        expect(event.code).toBe(4005);
        expect(event.reason).toContain('sandbox not owned');
        resolve(true);
      };
    });
  });

  it('should timeout idle connections', async () => {
    const ws = await createAuthenticatedWebSocket();
    
    // Don't send any messages
    await new Promise((resolve) => {
      ws.onclose = (event) => {
        expect(event.code).toBe(4008);
        expect(event.reason).toContain('timeout');
        resolve(true);
      };
    }, 70000); // Wait for pong timeout
  });
});

// tests/terminal/rate-limiting.test.ts

describe('Rate Limiting', () => {
  it('should block requests exceeding limit', async () => {
    const token = generateToken('test-user');
    
    // Send 6 commands in 1 second (limit is 5)
    const promises = Array(6).fill(null).map(() =>
      fetch('/api/sandbox/terminal/input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId: 'test', data: 'ls\n' }),
      })
    );
    
    const responses = await Promise.all(promises);
    const statusCodes = responses.map(r => r.status);
    
    expect(statusCodes).toContain(429);
  });

  it('should reset counter after window', async () => {
    const token = generateToken('test-user');
    
    // Send 5 commands
    for (let i = 0; i < 5; i++) {
      await sendCommand(token, 'ls\n');
    }
    
    // Wait for window to reset
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Should be allowed again
    const response = await sendCommand(token, 'ls\n');
    expect(response.status).toBe(200);
  });
});

// tests/terminal/integration.test.ts

describe('Terminal Flow Integration', () => {
  it('should handle full terminal lifecycle', async () => {
    const token = generateToken('test-user');
    
    // 1. Create sandbox
    const createRes = await fetch('/api/sandbox/terminal', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(createRes.status).toBe(201);
    const { sessionId, sandboxId } = await createRes.json();
    
    // 2. Send commands
    const inputRes = await fetch('/api/sandbox/terminal/input', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, data: 'ls\n' }),
    });
    expect(inputRes.status).toBe(200);
    
    // 3. Delete sandbox
    const deleteRes = await fetch('/api/sandbox/terminal', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    expect(deleteRes.status).toBe(200);
  });

  it('should recover from provider failures', async () => {
    // Mock provider failure
    mockProvider('daytona').mockImplementation(() => {
      throw new Error('Provider unavailable');
    });
    
    // Should fallback to next provider
    const response = await createSandbox('test-user');
    expect(response).toBeDefined();
  });

  it('should clean up resources on disconnect', async () => {
    const token = generateToken('test-user');
    const { sessionId } = await createSandbox(token);
    
    // Connect WebSocket
    const ws = await createAuthenticatedWebSocket(sessionId);
    
    // Disconnect
    ws.close(1000, 'Test complete');
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify resources cleaned up
    const connections = getActiveConnections();
    expect(connections.get(sessionId)).toBeUndefined();
  });
});
```

---

## Configuration Changes

### env.example Updates

```bash
# .env.example

# ... existing config ...

# ===========================================
# TERMINAL SECURITY CONFIGURATION
# ===========================================

# WebSocket configuration
WEBSOCKET_PORT=8080
WEBSOCKET_PROTOCOL=ws
WEBSOCKET_HOST=localhost:8080

# Terminal security limits
TERMINAL_MAX_INPUT_SIZE=10240  # 10KB
TERMINAL_MAX_BUFFER_SIZE=10240  # 10KB
TERMINAL_MAX_COMMANDS_PER_SECOND=5
TERMINAL_CONNECTION_TIMEOUT_MS=30000  # 30 seconds
TERMINAL_IDLE_TIMEOUT_MS=1800000  # 30 minutes

# Rate limiting
SANDBOX_CREATION_RATE_LIMIT=3  # per minute
WEBSOCKET_CONNECTION_RATE_LIMIT=10  # per minute

# ===========================================
# MCP SECURITY CONFIGURATION
# ===========================================

# MCP CLI server
MCP_CLI_PORT=8888
MCP_AUTH_TOKEN=your-shared-secret-token  # For CLI authentication
MCP_ALLOWED_ORIGINS=http://localhost:3000  # Comma-separated

# MCPorter
MCPORTER_ENABLED=true
MCPORTER_REFRESH_MS=30000
MCPORTER_CALL_TIMEOUT_MS=30000
MCPORTER_LIST_TIMEOUT_MS=30000

# ===========================================
# SANDBOX SECURITY CONFIGURATION
# ===========================================

# Provider fallback
SANDBOX_ENABLE_FALLBACK=true
SANDBOX_FALLBACK_PROVIDER=microsandbox

# Sprites optimization
SPRITES_TAR_PIPE_THRESHOLD=10

# Session TTL
TERMINAL_SESSION_TTL_MS=14400000  # 4 hours
```

---

## Rollout Plan

### Phase 1: Critical Security (Week 1)

**Day 1-2:**
- [ ] Remove token from URL (use cookies/headers)
- [ ] Add authentication to MCP CLI server
- [ ] Verify sandbox ownership in WebSocket server

**Day 3-4:**
- [ ] Fix command buffer security validation order
- [ ] Add input size limits everywhere

**Day 5:**
- [ ] Security audit and penetration testing
- [ ] Deploy to staging environment

### Phase 2: Stability (Week 2)

**Day 1-2:**
- [ ] Fix connection leaks in terminal manager
- [ ] Add rate limiting to all endpoints

**Day 3-4:**
- [ ] Fix race conditions in session creation
- [ ] Add proper cleanup on error paths
- [ ] Add connection timeouts

**Day 5:**
- [ ] Load testing and performance validation
- [ ] Deploy to production

### Phase 3: Hardening (Week 3)

**Day 1-2:**
- [ ] Improve obfuscation detection
- [ ] Add circuit breakers to all providers

**Day 3-4:**
- [ ] Fix streaming error handling
- [ ] Add comprehensive logging with context

**Day 5:**
- [ ] Final security audit
- [ ] Documentation updates
- [ ] Team training on new security features

---

## Monitoring and Alerting

### Metrics to Track

```typescript
// lib/metrics/terminal-metrics.ts

import { Counter, Histogram, Gauge } from 'prom-client';

// Connection metrics
export const terminalConnectionsTotal = new Counter({
  name: 'terminal_connections_total',
  help: 'Total number of terminal connections',
  labelNames: ['status', 'provider'],
});

export const terminalConnectionDuration = new Histogram({
  name: 'terminal_connection_duration_seconds',
  help: 'Duration of terminal connections',
  labelNames: ['provider'],
  buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
});

// Security metrics
export const terminalSecurityBlocksTotal = new Counter({
  name: 'terminal_security_blocks_total',
  help: 'Total number of blocked terminal commands',
  labelNames: ['reason', 'severity'],
});

export const terminalAuthFailuresTotal = new Counter({
  name: 'terminal_auth_failures_total',
  help: 'Total authentication failures',
  labelNames: ['reason'],
});

// Rate limiting metrics
export const terminalRateLimitsTotal = new Counter({
  name: 'terminal_rate_limits_total',
  help: 'Total rate limit hits',
  labelNames: ['endpoint', 'userId'],
});

// Resource metrics
export const terminalActiveConnections = new Gauge({
  name: 'terminal_active_connections',
  help: 'Number of active terminal connections',
  labelNames: ['type'], // pty, command-mode, websocket
});

export const terminalMemoryUsage = new Gauge({
  name: 'terminal_memory_usage_bytes',
  help: 'Memory usage by terminal buffers',
});
```

### Alerts to Configure

```yaml
# prometheus/alerts/terminal-alerts.yml

groups:
  - name: terminal-security
    rules:
      - alert: HighAuthFailureRate
        expr: rate(terminal_auth_failures_total[5m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High terminal authentication failure rate"
          description: "Authentication failures exceed 10 per minute"

      - alert: SecurityBlockSpike
        expr: rate(terminal_security_blocks_total[5m]) > 20
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Spike in blocked terminal commands"
          description: "Security blocks exceed 20 per minute"

      - alert: WebSocketConnectionLeak
        expr: terminal_active_connections{type="websocket"} > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Potential WebSocket connection leak"
          description: "Active WebSocket connections exceed 100"

      - alert: RateLimitAbuse
        expr: rate(terminal_rate_limits_total[5m]) > 50
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High rate limit hit rate"
          description: "Rate limits exceeded 50 times per minute"
```

---

## Success Criteria

### Security Metrics

- [ ] Zero token exposure in server logs
- [ ] 100% of WebSocket connections authenticated and authorized
- [ ] 100% of sandbox access verified against ownership
- [ ] Zero successful multi-chunk command bypasses
- [ ] All inputs size-limited to 10KB

### Stability Metrics

- [ ] Zero connection leaks (active connections < 100 under normal load)
- [ ] All connections timeout after 30 seconds of inactivity
- [ ] Zero race conditions in session creation (verified by stress testing)
- [ ] 99.9% successful cleanup on error paths
- [ ] Memory usage stable under sustained load

### Performance Metrics

- [ ] Terminal connection time < 2 seconds (p95)
- [ ] Command execution latency < 100ms (p95)
- [ ] Rate limiting overhead < 10ms
- [ ] Security check overhead < 5ms per command

---

## Rollback Plan

If critical issues are discovered after deployment:

### Immediate Rollback (< 5 minutes)

```bash
# 1. Revert to previous deployment
git revert HEAD~5..HEAD  # Revert last 5 commits (Week 1 changes)
git push origin main

# 2. Restart services
pm2 restart all

# 3. Verify rollback
curl http://localhost:3000/api/health
```

### Partial Rollback

If only specific features need rollback:

```bash
# Disable specific features via feature flags
export TERMINAL_SECURITY_V2_ENABLED=false
export WEBSOCKET_AUTH_V2_ENABLED=false

# Restart services
pm2 restart terminal-server
```

### Data Recovery

If session data is corrupted:

```typescript
// Run migration script to clean up stale sessions
npx ts-node scripts/cleanup-terminal-sessions.ts

// Verify session integrity
npx ts-node scripts/verify-sessions.ts
```

---

## Appendix: Reference Documentation

### SDK Documentation Referenced

- **E2B SDK**: `docs/sdk/e2b-llms-full.txt`
  - Command execution with streaming
  - PTY session management
  - Security best practices

- **Daytona SDK**: `docs/sdk/daytona-llms-full.txt`
  - Sandbox lifecycle management
  - Audit logging
  - Computer use integration

- **Blaxel SDK**: `docs/sdk/blaxel-llms-full.txt`
  - Async triggers and callbacks
  - Webhook signature verification
  - Agent deployment

- **Sprites SDK**: `docs/sdk/sprites-llms-full.txt`
  - Persistent environments
  - Command execution
  - HTTP access

- **MCPorter**: `docs/sdk/mcporter-llms.txt`
  - MCP server integration
  - Tool calling with timeouts
  - OAuth handling

### Related Internal Documentation

- `lib/backend/websocket-terminal.ts` - WebSocket server implementation
- `lib/sandbox/terminal-manager.ts` - Terminal session management
- `lib/terminal/terminal-security.ts` - Command security checks
- `hooks/use-websocket-terminal.ts` - Frontend WebSocket hook
- `components/terminal/TerminalPanel.tsx` - Terminal UI component

---

## Sign-off

**Technical Lead:** [Name]  
**Security Review:** [Name]  
**QA Lead:** [Name]  
**Deployment Date:** [Date]

**Approved by:**
- [ ] Engineering Manager
- [ ] Security Team
- [ ] DevOps Team
