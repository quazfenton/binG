/**
 * CodeSandbox DevBox API Endpoint
 * 
 * Creates a cloud development environment using the CodeSandbox SDK.
 * 
 * SDK Pattern:
 * - import { createSandbox } from '@codesandbox/sdk'
 * - sandbox.fs.writeFile() for files
 * - sandbox.run() for commands
 * - sandbox.getPreviewUrl(port) for preview URLs
 * - sandbox.exposePort(port) for dev servers
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('DevBoxAPI');

export const runtime = 'nodejs';

// Rate limiting: track sandbox creations per user (simple in-memory, use Redis for production)
const userSandboxCreations = new Map<string, { count: number; resetAt: number }>();
const MAX_SANDBOXES_PER_USER = parseInt(process.env.MAX_SANDBOXES_PER_USER || '5', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.SANDBOX_RATE_LIMIT_WINDOW_MS || '3600000', 10); // 1 hour default

/**
 * Check rate limit for sandbox creation
 */
function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const userRecord = userSandboxCreations.get(userId);

  if (!userRecord || now > userRecord.resetAt) {
    userSandboxCreations.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: MAX_SANDBOXES_PER_USER - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (userRecord.count >= MAX_SANDBOXES_PER_USER) {
    return { allowed: false, remaining: 0, resetAt: userRecord.resetAt };
  }

  userRecord.count++;
  return { allowed: true, remaining: MAX_SANDBOXES_PER_USER - userRecord.count, resetAt: userRecord.resetAt };
}

export async function POST(req: NextRequest) {
  // Initialize variables that need to be accessed in catch block
  let authResult: Awaited<ReturnType<typeof resolveRequestAuth>> | null = null;
  let template: string = 'node';
  let validTemplates: string[] = [];
  let detail = '';

  try {
    // SECURITY: Require authentication - no anonymous sandbox creation allowed
    authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = authResult.userId;

    // SECURITY: Rate limiting to prevent resource abuse/DoS
    const rateLimit = checkRateLimit(userId);
    if (!rateLimit.allowed) {
      const resetMinutes = Math.ceil((rateLimit.resetAt - Date.now()) / 60000);
      logger.warn('Sandbox creation rate limit exceeded', { userId });
      return NextResponse.json(
        { error: `Rate limit exceeded. Maximum ${MAX_SANDBOXES_PER_USER} sandboxes per ${RATE_LIMIT_WINDOW_MS / 60000} minutes. Try again in ${resetMinutes} minutes.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { files, template: requestedTemplate = 'node' } = body;
    
    // Assign to outer-scoped template variable (don't shadow)
    template = requestedTemplate;

    if (!files || typeof files !== 'object') {
      return NextResponse.json(
        { error: 'Files are required' },
        { status: 400 }
      );
    }

    logger.info('Creating DevBox', { userId, template, fileCount: Object.keys(files).length, rateLimitRemaining: rateLimit.remaining });

    // Pre-flight: require CSB_API_KEY before attempting provider initialisation so
    // the 500 carries a meaningful message rather than an opaque SDK error.
    if (!process.env.CSB_API_KEY) {
      logger.error('CSB_API_KEY is not set in the server environment');
      return NextResponse.json(
        { error: 'CodeSandbox is not configured. Set the CSB_API_KEY environment variable.' },
        { status: 503 }
      );
    }

    // Validate template
    validTemplates = ['node', 'typescript', 'javascript', 'python', 'docker', 'react', 'nextjs', 'vue', 'svelte'];
    if (!validTemplates.includes(template)) {
      return NextResponse.json(
        { error: `Invalid template '${template}'. Valid templates: ${validTemplates.join(', ')}` },
        { status: 400 }
      );
    }

    // Get CodeSandbox provider directly - DevBox is specifically for CodeSandbox
    const provider = await sandboxBridge.getProvider('codesandbox');

    // Create a new CodeSandbox sandbox with proper config
    const sandboxHandle = await provider.createSandbox({
      language: template,
      labels: { userId: authResult.userId },  // Add user label for tracking
    });

    const sandboxId = (sandboxHandle as any).sandboxId || sandboxHandle.id;

    logger.info('CodeSandbox created', {
      sandboxId,
      template,
      userId: authResult.userId,
    });

    // Get the sandbox instance for file operations
    const sandbox = await provider.getSandbox(sandboxId);

    // Write all files to sandbox workspace using SDK's fs API
    logger.info('Writing files to sandbox...');
    for (const [filePath, content] of Object.entries(files)) {
      try {
        await sandbox.writeFile(filePath, content as string);
        logger.debug(`Written: ${filePath}`);
      } catch (err: any) {
        logger.warn(`Failed to write file ${filePath}:`, err.message);
      }
    }

    // Get preview URL using SDK's getPreviewUrl or hosts.getUrl
    // Format: https://{sandboxId}.csb.app
    const previewUrl = `https://${sandboxId}.csb.app`;

    logger.info('DevBox created successfully', {
      sandboxId,
      url: previewUrl,
    });

    return NextResponse.json({
      success: true,
      sandboxId,
      url: previewUrl,
      template,
      provider: 'codesandbox',
    });
  } catch (error: any) {
    logger.error('Failed to create DevBox:', error);

    // Surface the underlying SDK / provider error so the client can display a
    // meaningful message rather than the generic "Failed to create..." string.
    const detail = error?.message || String(error);
    
    // Map common error patterns to user-friendly messages
    const errorMessages: Record<string, { message: string; status: number; code: string }> = {
      'unauthorized': { 
        message: 'CodeSandbox authentication failed. Check that CSB_API_KEY is correct.', 
        status: 401, 
        code: 'AUTH_FAILED' 
      },
      'forbidden': { 
        message: 'API key lacks permissions. Check CSB_API_KEY scopes.', 
        status: 403, 
        code: 'PERMISSION_DENIED' 
      },
      'api key': { 
        message: 'Invalid API key format. CSB_API_KEY should be a valid CodeSandbox API key.', 
        status: 401, 
        code: 'INVALID_API_KEY' 
      },
      'quota': { 
        message: 'CodeSandbox quota exceeded. Try again later.', 
        status: 429, 
        code: 'QUOTA_EXCEEDED' 
      },
      'template': { 
        message: `Invalid template '${template}'. Use: ${validTemplates.join(', ')}.`, 
        status: 400, 
        code: 'INVALID_TEMPLATE' 
      },
      'rate limit': { 
        message: 'Too many requests. Please wait before creating another sandbox.', 
        status: 429, 
        code: 'RATE_LIMITED' 
      },
      'timeout': { 
        message: 'Sandbox creation timed out. Please try again.', 
        status: 504, 
        code: 'TIMEOUT' 
      },
    };

    // Find matching error pattern
    const detailLower = detail.toLowerCase();
    const matchedKey = Object.keys(errorMessages).find(k => detailLower.includes(k));
    
    if (matchedKey) {
      const errorConfig = errorMessages[matchedKey];
      logger.error(`DevBox error: ${errorConfig.code}`, { detail, userId: authResult?.userId || 'unknown' });

      return NextResponse.json(
        {
          error: errorConfig.message,
          code: errorConfig.code,
          details: process.env.NODE_ENV === 'development' ? detail : undefined,
        },
        { status: errorConfig.status }
      );
    }

    // Generic error with detail for debugging
    logger.error('DevBox creation failed', { detail, userId: authResult?.userId || 'unknown' });
    
    return NextResponse.json(
      {
        error: `Failed to create cloud development environment: ${detail}`,
        code: 'SANDBOX_CREATE_FAILED',
        details: process.env.NODE_ENV === 'development' ? detail : undefined,
      },
      { status: 500 }
    );
  }
}
