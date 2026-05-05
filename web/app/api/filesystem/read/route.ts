import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { pathSchema } from '@/lib/validation/schemas';
import { resolveFilesystemOwnerWithFallback } from '../utils';

export const runtime = 'edge';

function looksLikeCssValueSegment(segment: string): boolean {
  return /^(?:\d*\.\d+|\d+[a-z%]+)$/i.test(segment);
}

// Ban list for paths that returned 400 errors (prevent retry loops)
const INVALID_PATH_BAN = new Map<string, number>();
const BAN_DURATION_MS = 60000; // 1 minute ban for invalid paths

// Cleanup expired bans every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [path, timestamp] of INVALID_PATH_BAN.entries()) {
    if (now - timestamp > BAN_DURATION_MS) {
      INVALID_PATH_BAN.delete(path);
    }
  }
}, 5 * 60 * 1000);

/**
 * Schema for filesystem read requests
 * Validates path and prevents path traversal attacks
 */
const readRequestSchema = z.object({
  path: pathSchema.refine(
    (path) => {
      if (!path.startsWith('/')) return true;
      return path.startsWith('/home/') || path.startsWith('/workspace/') || path.startsWith('/tmp/') || path.startsWith('/project/');
    },
    'Invalid path format'
  ),
});

/**
 * Validate path to reject clearly invalid paths (CSS values, code snippets, etc.)
 * Returns null if path is invalid, otherwise returns the valid path
 */
function validateReadPath(rawPath: string): string | null {
  const path = rawPath.trim();

  // Reject empty or too short paths
  if (!path || path.length < 2) return null;
  
  // CRITICAL: Check the last segment of the path (the actual filename)
  // This catches "project/sessions/002/0.3s" where "0.3s" is the invalid part
  const pathSegments = path.split('/');
  const lastSegment = pathSegments[pathSegments.length - 1] || path;

  // Reject paths that are clearly not file paths
  // CSS values, operators, single characters, etc.
  if (looksLikeCssValueSegment(lastSegment)) return null;  // e.g., "0.3s", "10px"
  if (/^[,;:!?()\[\]{}\/]+$/.test(lastSegment)) return null;  // e.g., ",", "/", "("
  if (/^[+\-*/%&|^~<>]+$/.test(lastSegment)) return null;  // e.g., "=", "+", "-"
  if (/^[@#$.]$/.test(lastSegment)) return null;  // Single special chars

  // Reject paths starting with special chars (except . for relative paths)
  if (/^[^a-zA-Z0-9_.]/.test(lastSegment) && !path.startsWith('../')) return null;

  // Reject SCSS/SASS variables (start with $)
  if (/^\$/.test(lastSegment)) return null;  // e.g., "$transition-fast"

  // Reject paths ending with special chars
  if (/[,\s]$/.test(lastSegment)) return null;

  // Reject paths that look like CSS selectors or Vue directives
  if (/^[@.#:]/.test(lastSegment)) return null;  // CSS selectors
  if (/^v-/.test(lastSegment)) return null;  // Vue directives

  return path;
}

export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8);

  // Resolve auth upfront so it's available in catch block
  const authResolution = await resolveFilesystemOwnerWithFallback(req, {
    route: 'read',
    requestId,
  });
  const ownerId = authResolution.ownerId;

  try {
    const body = await req.json();

    // Validate request body
    const validation = readRequestSchema.safeParse(body);
    if (!validation.success) {
      const errorResponse = NextResponse.json(
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
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    const { path: filePath } = validation.data;

    // CRITICAL FIX: Check ban list for previously rejected invalid paths
    // This prevents infinite polling loops from retrying known-bad paths
    if (INVALID_PATH_BAN.has(filePath)) {
      const banAge = Date.now() - INVALID_PATH_BAN.get(filePath)!;
      if (banAge < BAN_DURATION_MS) {
        console.debug('[VFS Read] Blocked banned path:', filePath);
        return NextResponse.json(
          {
            success: false,
            error: 'Path temporarily blocked due to previous invalid format',
            retryAfter: Math.ceil((BAN_DURATION_MS - banAge) / 1000),
          },
          { status: 429, headers: { 'Retry-After': Math.ceil((BAN_DURATION_MS - banAge) / 1000).toString() } },
        );
      } else {
        INVALID_PATH_BAN.delete(filePath);
      }
    }

    // DEBUG: Log what path is being requested
    console.log('[VFS Read] Request received:', { filePath, lastSegment: filePath.split('/').pop() });

    // CRITICAL FIX: Check for invalid path patterns BEFORE full validation
    // This catches CSS values, SCSS variables, etc. that shouldn't be read
    const pathSegments = filePath.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1] || filePath;

    // Reject obvious non-file paths immediately and add to ban list
    if (looksLikeCssValueSegment(lastSegment)) {  // CSS values like "0.3s"
      console.warn('[VFS Read] Rejected CSS value path:', filePath);
      INVALID_PATH_BAN.set(filePath, Date.now());
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid path format',
          details: `Path "${filePath}" appears to be a CSS value, not a valid file path`,
        },
        { status: 400 },
      );
    }

    if (/^\$/.test(lastSegment)) {  // SCSS variables
      console.warn('[VFS Read] Rejected SCSS variable path:', filePath);
      INVALID_PATH_BAN.set(filePath, Date.now());
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid path format',
          details: `Path "${filePath}" appears to be a SCSS variable, not a valid file path`,
        },
        { status: 400 },
      );
    }

    // CRITICAL FIX: Validate path to reject clearly invalid paths
    // This prevents infinite polling loops from invalid paths like "0.3s", ",", "/"
    const validatedPath = validateReadPath(filePath);
    if (!validatedPath) {
      console.warn('[VFS Read] Rejected invalid path:', filePath.substring(0, 100));
      // Add to ban list to prevent retries
      INVALID_PATH_BAN.set(filePath, Date.now());
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: 'Invalid path format',
          details: `Path "${filePath.substring(0, 50)}" appears to be a CSS value, operator, or code snippet, not a valid file path`,
        },
        { status: 400 },
      );
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    // SECURITY: Always derive ownerId from authenticated request context
    // Never trust user-supplied ownerId for read operations
    const file = await virtualFilesystem.readFile(ownerId, validatedPath);
    const response = NextResponse.json({
      success: true,
      data: {
        path: file.path,
        content: file.content,
        version: file.version,
        language: file.language,
        size: file.size,
        lastModified: file.lastModified,
      },
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to read file';
    const status = message.toLowerCase().includes('not found') ? 404 : 400;
    // SECURITY: Don't expose raw internal error messages
    const safeMessage = message.toLowerCase().includes('not found')
      ? 'File not found'
      : 'Failed to read file';
    const errorResponse = NextResponse.json({ success: false, error: safeMessage }, { status });
    return withAnonSessionCookie(errorResponse, authResolution);
  }
}
