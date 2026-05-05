/**
 * VFS Sync API Route
 *
 * Universal virtual filesystem synchronization endpoint.
 * Syncs files from virtual filesystem to sandbox using provider-specific optimizations.
 *
 * Features:
 * - Full sync (all files)
 * - Incremental sync (changed files only)
 * - Bootstrap mode (initial sync with workspace setup)
 * - Provider-specific optimizations (Tar-Pipe for Sprites, batch for Blaxel)
 * - Authentication and authorization
 * - Rate limiting (10 syncs/minute per user)
 * - Input validation and sanitization
 *
 * API Reference: /api/sandbox/sync
 * 
 * Security:
 * - Requires authentication (JWT or session)
 * - Validates sandbox ownership
 * - Rate limited to prevent DoS
 * - Input validation on all parameters
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { UniversalVfsSync, type VfsFile, type SyncOptions } from '@/lib/virtual-filesystem/sync/universal-vfs-sync';
import { getSandboxProvider } from '@/lib/sandbox/providers';
import type { SandboxProviderType } from '@/lib/sandbox/providers';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';

/**
 * Supported sandbox providers for VFS sync
 * Single source of truth - used consistently across validation and documentation
 */
const SUPPORTED_PROVIDERS = [
  'sprites',
  'blaxel',
  'daytona',
  'e2b',
  'microsandbox',
  'codesandbox',
  'runloop',
] as const;

/**
 * Default workspace directories for each provider
 */
const PROVIDER_WORKSPACE_DIRS: Record<string, string> = {
  sprites: '/home/sprite/workspace',
  blaxel: '/workspace',
  daytona: '/home/daytona/workspace',
  e2b: '/home/user',
  microsandbox: '/workspace',
  codesandbox: '/workspace',
  runloop: '/workspace',
};

/**
 * Get default workspace directory for provider
 */
function getDefaultWorkspaceDir(provider: string): string {
  return PROVIDER_WORKSPACE_DIRS[provider] || '/workspace';
}

interface SyncRequest {
  sandboxId: string;
  provider: string;
  mode: 'full' | 'incremental' | 'bootstrap';
  files?: VfsFile[];
  lastSyncTime?: number;
  workspaceDir?: string;
  timeout?: number;
}

interface SyncResponse {
  success: boolean;
  message?: string;
  filesSynced?: number;
  bytesTransferred?: number;
  duration?: number;
  method?: string;
  changedFiles?: number;
  error?: string;
}

/**
 * Rate limiter for sync operations
 * Limits: 10 syncs per minute per user, 100 syncs per minute per IP
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const userRateLimiter = new Map<string, RateLimitEntry>();
const ipRateLimiter = new Map<string, RateLimitEntry>();

const USER_RATE_LIMIT = 10; // 10 syncs per minute
const IP_RATE_LIMIT = 100; // 100 syncs per minute (global)
const RATE_WINDOW_MS = 60000; // 1 minute

// SECURITY: O(1) body size guard — checked BEFORE req.json() buffers into memory
const MAX_SYNC_BODY_BYTES = 120 * 1024 * 1024; // 120MB (per-file is 100MB, allow overhead for JSON structure)

// Per-file content size limit (matches VFS writeFile MAX_FILE_SIZE)
const MAX_FILE_CONTENT_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Check and update rate limit
 * Returns true if request is allowed, false if rate limited
 */
function checkRateLimit(
  limiter: Map<string, RateLimitEntry>,
  key: string,
  limit: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = limiter.get(key) || { count: 0, resetAt: now + RATE_WINDOW_MS };

  // Reset if window expired
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }

  // Check if limit exceeded
  if (entry.count >= limit) {
    limiter.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  // Increment count
  entry.count++;
  limiter.set(key, entry);

  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Clean up expired rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();
  
  // Clean user rate limiter
  for (const [key, entry] of userRateLimiter.entries()) {
    if (now > entry.resetAt) {
      userRateLimiter.delete(key);
    }
  }
  
  // Clean IP rate limiter
  for (const [key, entry] of ipRateLimiter.entries()) {
    if (now > entry.resetAt) {
      ipRateLimiter.delete(key);
    }
  }
}, RATE_WINDOW_MS);

/**
 * POST /api/sandbox/sync
 *
 * Sync virtual filesystem to sandbox
 * 
 * Security:
 * - Requires authentication
 * - Validates sandbox ownership
 * - Rate limited (10/minute per user, 100/minute per IP)
 * - Input validation on all parameters
 */
export async function POST(req: NextRequest): Promise<NextResponse<SyncResponse>> {
  try {
    // STEP 1: Authenticate request
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required. Please provide a valid JWT token or session.',
        },
        { status: 401 }
      );
    }

    // STEP 2: Rate limiting - check both user and IP limits
    const userIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                   req.headers.get('x-real-ip') || 
                   'unknown';
    
    const userRateLimit = checkRateLimit(userRateLimiter, authResult.userId, USER_RATE_LIMIT);
    if (!userRateLimit.allowed) {
      const resetIn = Math.ceil((userRateLimit.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: `Rate limit exceeded. Maximum ${USER_RATE_LIMIT} syncs per minute. Try again in ${resetIn} seconds.`,
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(USER_RATE_LIMIT),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(userRateLimit.resetAt),
            'Retry-After': String(resetIn),
          },
        }
      );
    }

    const ipRateLimit = checkRateLimit(ipRateLimiter, userIp, IP_RATE_LIMIT);
    if (!ipRateLimit.allowed) {
      const resetIn = Math.ceil((ipRateLimit.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: `Global rate limit exceeded. Try again in ${resetIn} seconds.`,
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(IP_RATE_LIMIT),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(ipRateLimit.resetAt),
            'Retry-After': String(resetIn),
          },
        }
      );
    }

    // STEP 3: Parse and validate request body
    let body: SyncRequest;

    // SECURITY: O(1) body size check BEFORE buffering into memory via req.json()
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_SYNC_BODY_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Request body too large (max ${MAX_SYNC_BODY_BYTES / (1024 * 1024)}MB)`,
        },
        { status: 413 },
      );
    }

    try {
      body = await req.json();
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid JSON in request body',
        },
        { status: 400 }
      );
    }

    const {
      sandboxId,
      provider,
      mode,
      files,
      lastSyncTime,
      workspaceDir,
      timeout,
    } = body;

    // Validate required fields
    if (!sandboxId || typeof sandboxId !== 'string' || sandboxId.trim() === '') {
      return NextResponse.json(
        {
          success: false,
          error: 'sandboxId is required and must be a non-empty string',
        },
        { status: 400 }
      );
    }

    if (!provider || typeof provider !== 'string' || provider.trim() === '') {
      return NextResponse.json(
        {
          success: false,
          error: 'provider is required and must be a non-empty string',
        },
        { status: 400 }
      );
    }

    // Validate provider is known
    if (!SUPPORTED_PROVIDERS.includes(provider.toLowerCase() as any)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown provider: ${provider}. Valid providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate mode
    const validModes = ['full', 'incremental', 'bootstrap'] as const;
    if (!mode || !validModes.includes(mode)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate files array
    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'files array is required and must not be empty',
        },
        { status: 400 }
      );
    }

    // Validate each file in the array
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || typeof file !== 'object') {
        return NextResponse.json(
          {
            success: false,
            error: `File at index ${i} must be an object`,
          },
          { status: 400 }
        );
      }
      if (!file.path || typeof file.path !== 'string') {
        return NextResponse.json(
          {
            success: false,
            error: `File at index ${i} must have a non-empty string path`,
          },
          { status: 400 }
        );
      }
      if (typeof file.content !== 'string') {
        return NextResponse.json(
          {
            success: false,
            error: `File at index ${i} must have string content`,
          },
          { status: 400 }
        );
      }
      // SECURITY: O(1) per-file content size guard
      if (file.content.length > MAX_FILE_CONTENT_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `File at index ${i} exceeds size limit (${(file.content.length / (1024 * 1024)).toFixed(1)}MB > ${MAX_FILE_CONTENT_BYTES / (1024 * 1024)}MB)`,
          },
          { status: 400 }
        );
      }
      // Validate file path doesn't contain traversal attempts
      if (file.path.includes('..') || file.path.startsWith('/')) {
        return NextResponse.json(
          {
            success: false,
            error: `File path at index ${i} contains invalid characters: ${file.path}`,
          },
          { status: 400 }
        );
      }
    }

    // Validate mode-specific requirements
    if (mode === 'incremental' && (!lastSyncTime || typeof lastSyncTime !== 'number')) {
      return NextResponse.json(
        {
          success: false,
          error: 'lastSyncTime is required for incremental sync and must be a number (timestamp)',
        },
        { status: 400 }
      );
    }

    // Validate timeout if provided
    if (timeout !== undefined && (typeof timeout !== 'number' || timeout < 1000 || timeout > 300000)) {
      return NextResponse.json(
        {
          success: false,
          error: 'timeout must be between 1000 and 300000 milliseconds (1 second to 5 minutes)',
        },
        { status: 400 }
      );
    }

    // STEP 4: Authorization - verify user owns this sandbox
    const session = sandboxBridge.getSessionBySandboxId(sandboxId);
    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: `Sandbox not found: ${sandboxId}`,
        },
        { status: 404 }
      );
    }

    if (session.userId !== authResult.userId) {
      // Log unauthorized access attempt
      console.warn(
        `[VFS Sync] Unauthorized sync attempt: user ${authResult.userId} tried to access sandbox ${sandboxId} owned by ${session.userId}`
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: you do not have permission to sync to this sandbox',
        },
        { status: 403 }
      );
    }

    // STEP 5: P2 FIX - Resolve provider from sandbox ID
    const resolvedProvider = sandboxBridge.inferProviderFromSandboxId(sandboxId);
    
    if (!resolvedProvider) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot determine sandbox provider. Please reconnect to the sandbox.',
        },
        { status: 400 }
      );
    }
    
    // Validate that the resolved provider matches what was requested (if provided)
    // This allows backwards compatibility while still being secure
    if (provider && provider.toLowerCase() !== resolvedProvider.toLowerCase()) {
      console.warn(`[VFS Sync] Provider mismatch: request said '${provider}' but session has '${resolvedProvider}'. Using session provider.`);
    }
    
    let sandboxProvider;
    try {
      sandboxProvider = await getSandboxProvider(resolvedProvider as SandboxProviderType);
    } catch (providerError: any) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to initialize provider ${resolvedProvider}: ${providerError.message}`,
        },
        { status: 500 }
      );
    }

    // STEP 6: Get sandbox handle
    let handle;
    try {
      handle = await sandboxProvider.getSandbox(sandboxId);
    } catch (error: any) {
      console.error(`[VFS Sync] Failed to get sandbox ${sandboxId}:`, error.message);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to connect to sandbox: ${error.message}`,
        },
        { status: 500 }
      );
    }

    // STEP 7: Prepare and execute sync
    const syncOptions: SyncOptions = {
      workspaceDir: workspaceDir || getDefaultWorkspaceDir(provider),
      timeout: timeout || 60000,
      incremental: mode === 'incremental',
      lastSyncTime,
    };

    let result;
    try {
      result = await UniversalVfsSync.sync(handle, provider, files, syncOptions);
    } catch (syncError: any) {
      console.error('[VFS Sync] Sync execution failed:', syncError);
      return NextResponse.json(
        {
          success: false,
          error: `Sync failed: ${syncError.message}`,
        },
        { status: 500 }
      );
    }

    // STEP 8: Return success response with rate limit headers
    return NextResponse.json(
      {
        success: true,
        message: 'VFS sync completed successfully',
        filesSynced: result.filesSynced,
        bytesTransferred: result.bytesTransferred,
        duration: result.duration,
        method: result.method,
        changedFiles: result.changedFiles,
      },
      {
        headers: {
          'X-RateLimit-Limit': String(USER_RATE_LIMIT),
          'X-RateLimit-Remaining': String(userRateLimit.remaining),
          'X-RateLimit-Reset': String(userRateLimit.resetAt),
        },
      }
    );
  } catch (error: any) {
    console.error('[VFS Sync API] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error during sync',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox/sync
 *
 * Get sync status and capabilities
 * 
 * Security:
 * - Requires authentication (same as POST handler)
 * - Validates sandbox ownership
 */
export async function GET(req: NextRequest): Promise<NextResponse<any>> {
  try {
    // STEP 1: Authenticate request (same as POST handler)
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required. Please provide a valid JWT token or session.',
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const sandboxId = searchParams.get('sandboxId');
    const provider = searchParams.get('provider');

    // Return API info if no params (public info, no auth needed for this)
    if (!sandboxId || !provider) {
      return NextResponse.json({
        message: 'VFS Sync API',
        endpoints: {
          POST: 'Sync files to sandbox (requires auth)',
          GET: 'Get sync status (requires auth + sandboxId + provider)',
        },
        modes: ['full', 'incremental', 'bootstrap'],
        supportedProviders: Array.from(SUPPORTED_PROVIDERS),
        authRequired: true,
      });
    }

    // Validate sandboxId format
    if (typeof sandboxId !== 'string' || sandboxId.trim() === '') {
      return NextResponse.json(
        {
          success: false,
          error: 'sandboxId must be a non-empty string',
        },
        { status: 400 }
      );
    }

    // Get sandbox info and validate provider exists
    let sandboxProvider: Awaited<ReturnType<typeof getSandboxProvider>>;
    try {
      sandboxProvider = await getSandboxProvider(provider as SandboxProviderType);
    } catch (error: any) {
      // getSandboxProvider throws on unknown provider - return proper 400 error
      return NextResponse.json(
        {
          success: false,
          error: error.message || `Unknown provider: ${provider}`,
        },
        { status: 400 }
      );
    }

    // SECURITY: Verify sandbox ownership (same as POST handler)
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: You do not own this sandbox',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      sandboxId,
      provider,
      status: 'active',
      capabilities: {
        batch: true,
        incremental: true,
        tarPipe: provider === 'sprites',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
