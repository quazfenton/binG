import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem';
import { contextPackService, type ContextPackFormat } from '@/lib/virtual-filesystem/context-pack-service';
import { absolutePathSchema, contextPackOptionsSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

/**
 * GET /api/filesystem/context-pack?path=/src&format=markdown&includeContents=true
 * 
 * Generates a dense, LLM-friendly bundle of the VFS directory structure and file contents.
 * Similar to Repomix or Gitingest, but integrated with the virtual filesystem.
 */

const contextPackQuerySchema = contextPackOptionsSchema.extend({
  path: absolutePathSchema.optional().default('/'),
  excludePatterns: z.string()
    .optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
  includePatterns: z.string()
    .optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams);
    
    // Validate query parameters with Zod
    const parseResult = contextPackQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return NextResponse.json(
        { 
          success: false, 
          error: firstError.message,
          details: parseResult.error.flatten(),
        },
        { status: 400 },
      );
    }
    
    const { path, ...options } = parseResult.data;
    
    // Validate path is absolute
    if (!path.startsWith('/')) {
      return NextResponse.json(
        { success: false, error: 'Path must be an absolute path starting with /' },
        { status: 400 },
      );
    }

    // Prevent path traversal attacks
    if (path.includes('..')) {
      return NextResponse.json(
        { success: false, error: 'Path traversal is not allowed.' },
        { status: 400 },
      );
    }

    // Validate format
    const validFormats: ContextPackFormat[] = ['markdown', 'xml', 'json', 'plain'];
    if (options.format && !validFormats.includes(options.format)) {
      return NextResponse.json(
        { success: false, error: `Invalid format. Must be one of: ${validFormats.join(', ')}` },
        { status: 400 },
      );
    }

    // Resolve filesystem owner
    const authResolution = await resolveFilesystemOwner(req);
    const ownerId = authResolution.ownerId;
    
    // Generate context pack
    const result = await contextPackService.generateContextPack(ownerId, path, options);
    
    // Return response based on format
    const contentType = {
      markdown: 'text/markdown',
      xml: 'application/xml',
      json: 'application/json',
      plain: 'text/plain',
    }[options.format || 'markdown'];
    
    return new NextResponse(result.bundle, {
      status: 200,
      headers: {
        'Content-Type': contentType!,
        'X-Context-Pack-Files': result.fileCount.toString(),
        'X-Context-Pack-Size': result.totalSize.toString(),
        'X-Context-Pack-Tokens': result.estimatedTokens.toString(),
        'X-Context-Pack-Truncated': result.hasTruncation.toString(),
      },
    });
  } catch (error: unknown) {
    console.error('[Context Pack] Error:', error);
    // Return generic error to client, log details server-side
    return NextResponse.json(
      { success: false, error: 'Failed to generate context pack.' },
      { status: 400 },
    );
  }
}

/**
 * POST /api/filesystem/context-pack
 * 
 * Generate context pack with advanced options in request body
 */
const contextPackBodySchema = contextPackOptionsSchema;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body with Zod
    const parseResult = contextPackBodySchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return NextResponse.json(
        {
          success: false,
          error: firstError.message,
          details: parseResult.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { path = '/', ...options } = parseResult.data;

    // Validate path for path traversal
    if (path.includes('..')) {
      return NextResponse.json(
        { success: false, error: 'Path traversal is not allowed.' },
        { status: 400 },
      );
    }

    // Resolve filesystem owner
    const authResolution = await resolveFilesystemOwner(req);
    const ownerId = authResolution.ownerId;

    // Generate context pack
    const result = await contextPackService.generateContextPack(ownerId, path, options);

    // Return response
    const contentType = {
      markdown: 'text/markdown',
      xml: 'application/xml',
      json: 'application/json',
      plain: 'text/plain',
    }[options.format || 'markdown'];

    return new NextResponse(result.bundle, {
      status: 200,
      headers: {
        'Content-Type': contentType!,
        'X-Context-Pack-Files': result.fileCount.toString(),
        'X-Context-Pack-Size': result.totalSize.toString(),
        'X-Context-Pack-Tokens': result.estimatedTokens.toString(),
        'X-Context-Pack-Truncated': result.hasTruncation.toString(),
      },
    });
  } catch (error: unknown) {
    console.error('[Context Pack] Error:', error);
    // Return generic error to client, log details server-side
    return NextResponse.json(
      { success: false, error: 'Failed to generate context pack.' },
      { status: 400 },
    );
  }
}
