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
  try {
    // SECURITY: Require authentication - no anonymous sandbox creation allowed
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
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
    const { files, template = 'node' } = body;

    if (!files || typeof files !== 'object') {
      return NextResponse.json(
        { error: 'Files are required' },
        { status: 400 }
      );
    }

    logger.info('Creating DevBox', { userId, template, fileCount: Object.keys(files).length, rateLimitRemaining: rateLimit.remaining });

    // Get CodeSandbox provider directly - DevBox is specifically for CodeSandbox
    const provider = await sandboxBridge.getProvider('codesandbox');
    
    // Create a new CodeSandbox sandbox (not using the generic session store)
    const sandboxHandle = await provider.createSandbox({
      language: template === 'docker' ? 'docker' : 'typescript',
      template: template === 'docker' ? 'docker' : 'node',
    });

    const sandboxId = sandboxHandle.sandboxId;

    logger.info('CodeSandbox created', {
      sandboxId,
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

    return NextResponse.json(
      {
        error: 'Failed to create cloud development environment',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
