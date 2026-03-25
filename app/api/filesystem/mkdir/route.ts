import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { absolutePathSchema } from '@/lib/validation/schemas';

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

const DEBUG = process.env.DEBUG_VFS === 'true' || process.env.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log(`${COLORS.bright}${COLORS.cyan}[VFS MKDIR]${COLORS.reset}`, ...args);
const logWarn = (...args: any[]) => console.warn(`${COLORS.bright}${COLORS.yellow}[VFS MKDIR WARN]${COLORS.reset}`, ...args);
const logError = (...args: any[]) => console.error(`${COLORS.bright}${COLORS.red}[VFS MKDIR ERROR]${COLORS.reset}`, ...args);

export const runtime = 'nodejs';

/**
 * Schema for filesystem mkdir requests
 * Validates directory path and prevents path traversal attacks
 */
const mkdirRequestSchema = z.object({
  path: absolutePathSchema.refine(
    (path) => path.startsWith('/home/') || path.startsWith('/workspace/'),
    'Absolute paths must start with /home/ or /workspace/'
  ),
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} POST ${COLORS.green}/api/filesystem/mkdir${COLORS.reset}`);

    // SECURITY: Require authentication for directory creation
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Unauthorized:${COLORS.reset} Authentication required`);
      return NextResponse.json(
        { error: 'Authentication required for directory creation' },
        { status: 401 }
      );
    }

    const body = await req.json();

    // Validate request body
    const validation = mkdirRequestSchema.safeParse(body);
    if (!validation.success) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Validation failed:${COLORS.reset}`, validation.error.errors);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }

    const { path: dirPath } = validation.data;

    // SECURITY: Always derive ownerId from authenticated request context
    const authResolution = await resolveFilesystemOwner(req);
    const authenticatedOwnerId = authResolution.ownerId;

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Creating directory: ${COLORS.blue}"${dirPath}"${COLORS.reset} for owner=${COLORS.magenta}"${authenticatedOwnerId}"${COLORS.reset}`);

    const result = await virtualFilesystem.createDirectory(authenticatedOwnerId, dirPath);
    const duration = Date.now() - startTime;

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.green}Success${COLORS.reset}: Created directory ${COLORS.blue}"${result.path}"${COLORS.reset} in ${COLORS.cyan}${duration}ms${COLORS.reset}`);

    // Emit filesystem updated event for UI panels
    emitFilesystemUpdated({
      path: result.path,
      type: 'create',
      workspaceVersion: result.version,
      applied: [{
        path: result.path,
        operation: 'write',
        timestamp: Date.now(),
      }],
      source: 'api-mkdir',
    });

    return NextResponse.json({
      success: true,
      data: {
        path: result.path,
        createdAt: result.createdAt,
      },
    });
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Failed to create directory';
    logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} after ${COLORS.cyan}${duration}ms${COLORS.reset}:`, message);

    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}
