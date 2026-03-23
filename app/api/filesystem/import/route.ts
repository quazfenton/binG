/**
 * File Import API Endpoint
 *
 * Handles multipart file uploads for importing files from user's device
 * into the virtual filesystem with automatic commit tracking.
 *
 * POST /api/filesystem/import
 * Content-Type: multipart/form-data
 *
 * Form Fields:
 * - files: File[] - Files to import (supports multiple)
 * - sessionId: string - Session ID for commit tracking
 * - importFolderName: string (optional) - Custom folder name
 * - preserveStructure: boolean (optional, default: true)
 * - autoCommit: boolean (optional, default: true)
 *
 * Response:
 * {
 *   success: boolean,
 *   importedFiles: number,
 *   importedFolders: number,
 *   destinationPath: string,
 *   files: Array<{ path, size, language }>,
 *   commitId?: string,
 *   errors: string[],
 *   warnings: string[]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem';
import { FileImportService } from '@/lib/virtual-filesystem/import-service';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

export const runtime = 'nodejs';

// Request schema for validation
const importOptionsSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required').max(200),
  importFolderName: z.string().max(100).optional(),
  preserveStructure: z.boolean().default(true),
  autoCommit: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  let filesystemOwnerResolution: FilesystemOwnerResolution | undefined;
  let authResult: Awaited<ReturnType<typeof resolveRequestAuth>> | undefined;
  let ownerId: string | undefined;

  try {
    // Resolve authentication
    authResult = await resolveRequestAuth(req, { allowAnonymous: true });

    if (!authResult.success || !authResult.userId) {
      // Fallback to anonymous session
      filesystemOwnerResolution = await resolveFilesystemOwnerWithFallback(req, {
        route: 'import',
        requestId: Math.random().toString(36).slice(2, 8),
      });
      
      if (!filesystemOwnerResolution.ownerId) {
        const errorResponse = NextResponse.json(
          { error: 'Authentication required for file import' },
          { status: 401 }
        );
        return withAnonSessionCookie(errorResponse, filesystemOwnerResolution);
      }
      ownerId = filesystemOwnerResolution.ownerId;
    } else {
      ownerId = authResult.userId;
    }

    // Parse multipart form data
    const formData = await req.formData();

    // Extract and validate options
    const optionsData = {
      sessionId: formData.get('sessionId') as string | undefined,
      importFolderName: formData.get('importFolderName') as string | undefined,
      preserveStructure: formData.get('preserveStructure') === 'true',
      autoCommit: formData.get('autoCommit') === 'true',
    };

    // Validate options (sessionId required)
    const optionsValidation = importOptionsSchema.safeParse(optionsData);
    if (!optionsValidation.success) {
      const errorResponse = NextResponse.json(
        {
          error: 'Invalid import options',
          details: optionsValidation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
      return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
        ownerId,
        source: (authResult?.source as any) || 'anonymous',
        isAuthenticated: !!authResult?.success,
      });
    }

    const options = optionsValidation.data;

    // Extract files from form data
    const files: Array<{ name: string; content: string; path?: string }> = [];
    const fileEntries = formData.getAll('files');

    for (const entry of fileEntries) {
      if (entry instanceof File) {
        try {
          const content = await entry.text();
          files.push({
            name: entry.name,
            content,
            path: entry.webkitRelativePath || undefined,  // Preserves folder structure
          });
        } catch (error) {
          console.error('[File Import] Failed to read file:', entry.name, error);
        }
      }
    }

    if (files.length === 0) {
      const errorResponse = NextResponse.json(
        { error: 'No files provided. Please select at least one file to import.' },
        { status: 400 },
      );
      return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
        ownerId,
        source: (authResult?.source as any) || 'anonymous',
        isAuthenticated: !!authResult?.success,
      });
    }

    // Import files
    const importService = new FileImportService(virtualFilesystem);
    const result = await importService.importFiles(files, {
      ownerId,
      ...options,
    });

    // Build response
    const response = NextResponse.json(result);

    // Set anonymous session cookie if this is a new anonymous session
    return withAnonSessionCookie(response, filesystemOwnerResolution || {
      ownerId,
      source: (authResult?.source as any) || 'anonymous',
      isAuthenticated: !!authResult?.success,
    });
  } catch (error) {
    console.error('[File Import] Critical error:', error);
    
    const errorResponse = NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to import files',
        success: false,
      },
      { status: error instanceof Error && error.message.includes('limit') ? 400 : 500 },
    );

    return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
      ownerId,
      source: (authResult?.source as any) || 'anonymous',
      isAuthenticated: !!authResult?.success,
    });
  }
}

/**
 * GET endpoint for import configuration info
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const ownerId = authResult.userId || 'anonymous';

    const importService = new FileImportService(virtualFilesystem);
    
    // Get import limits and suggestions
    return NextResponse.json({
      limits: {
        maxFiles: 100,
        maxFileSize: '10MB',
        maxTotalSize: '50MB',
      },
      supportedFormats: [
        'JavaScript/TypeScript (.js, .jsx, .ts, .tsx)',
        'Python (.py)',
        'Java (.java)',
        'C/C++ (.c, .cpp, .h, .hpp)',
        'Web (.html, .css, .scss)',
        'Config (.json, .yaml, .yml, .xml)',
        'Markdown (.md)',
        'Shell (.sh, .bash)',
        'And many more...',
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get import info' },
      { status: 500 }
    );
  }
}
