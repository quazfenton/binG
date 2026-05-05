import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { z } from 'zod';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';
import { relativePathSchema } from '@/lib/validation/schemas';

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const DEBUG = process.env.DEBUG_SANDBOX === 'true' || process.env.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log(`${COLORS.bright}${COLORS.blue}[SANDBOX FILES]${COLORS.reset}`, ...args);
const logWarn = (...args: any[]) => console.warn(`${COLORS.bright}${COLORS.yellow}[SANDBOX FILES WARN]${COLORS.reset}`, ...args);
const logError = (...args: any[]) => console.error(`${COLORS.bright}${COLORS.red}[SANDBOX FILES ERROR]${COLORS.reset}`, ...args);

const sandboxFilesQuerySchema = z.object({
  path: relativePathSchema.optional().default('.'),
});

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} GET ${COLORS.green}/api/sandbox/files${COLORS.reset}`);

    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Unauthorized:${COLORS.reset} No valid authentication token`);
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Rate limiting: 30 file operations per minute per user
    const rateLimitResult = checkUserRateLimit(authResult.userId, 'generic');
    if (!rateLimitResult.allowed) {
      logWarn(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.yellow}Rate limit exceeded${COLORS.reset} for user ${COLORS.magenta}${authResult.userId}${COLORS.reset}`);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many file operations.', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers }
      );
    }

    const session = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!session) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}No active session${COLORS.reset} for user ${COLORS.magenta}${authResult.userId}${COLORS.reset}`);
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Session found: ${COLORS.cyan}${session.sessionId}${COLORS.reset} (sandbox: ${COLORS.cyan}${session.sandboxId}${COLORS.reset})`);

    // Get and validate query parameters with Zod
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams);
    
    const parseResult = sandboxFilesQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Validation failed:${COLORS.reset} ${firstError.message}`);
      return NextResponse.json(
        { error: firstError.message, details: parseResult.error.flatten() },
        { status: 400 }
      );
    }
    
    const { path: dirPath } = parseResult.data;

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Listing directory: ${COLORS.blue}"${dirPath}"${COLORS.reset}`);

    const result = await sandboxBridge.listDirectory(session.sandboxId, dirPath);
    const duration = Date.now() - startTime;

    // Check if the operation failed
    if (!result.success) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Failed after ${duration}ms:${COLORS.reset} ${result.error || 'Unknown error'}`);
      return NextResponse.json(
        { error: result.error || 'Failed to list directory', files: [] },
        { status: 500 }
      );
    }

    const fileList = result.files || result;
    const fileCount = Array.isArray(fileList) ? fileList.length : 0;
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.green}Success${COLORS.reset}: Listed ${COLORS.magenta}${fileCount}${COLORS.reset} files in ${COLORS.cyan}${duration}ms${COLORS.reset}`);

    if (duration > 100) {
      logWarn(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.yellow}SLOW OPERATION:${COLORS.reset} listDirectory took ${COLORS.cyan}${duration}ms${COLORS.reset}`);
    }

    return NextResponse.json({ files: fileList });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} after ${COLORS.cyan}${duration}ms${COLORS.reset}:`, error.message);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}
