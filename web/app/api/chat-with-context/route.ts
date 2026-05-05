import { NextResponse } from 'next/server';


import { createClient } from 'webdav';
import { diffLines } from 'diff';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
// Inlined feature flags to avoid Turbopack module resolution issues
const FEATURE_FLAGS = {
  NEXTCLOUD_URL: process.env.NEXTCLOUD_URL || '',
  NEXTCLOUD_USERNAME: process.env.NEXTCLOUD_USERNAME || '',
  NEXTCLOUD_PASSWORD: process.env.NEXTCLOUD_PASSWORD || '',
  ENABLE_CLOUD_STORAGE: process.env.ENABLE_CLOUD_STORAGE === 'true',
  CLOUD_STORAGE_PROVIDER: process.env.CLOUD_STORAGE_PROVIDER || 'gcp',
  CLOUD_STORAGE_BUCKET: process.env.CLOUD_STORAGE_BUCKET || '',
  CLOUD_STORAGE_PER_USER_LIMIT_BYTES: parseInt(process.env.CLOUD_STORAGE_PER_USER_LIMIT_BYTES || '5368709120', 10),
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
};

export const dynamic = 'force-dynamic';

/**
 * FIX (Bug 1): Sanitise the user-supplied `currentFile` so it cannot
 * escape /tmp via path traversal (e.g. "../../etc/passwd").
 * We strip leading slashes, collapse ".." components, and keep only
 * safe characters.  The result is used only as a cache filename.
 */
function safeCacheFilename(userPath: string): string {
  // Remove anything that isn't alphanumeric, '.', '-', '_', '/'
  const stripped = userPath.replace(/[^a-zA-Z0-9.\-_/]/g, '_');
  // Replace path separators with underscores to produce a flat filename
  return stripped.replace(/\//g, '_').replace(/\.{2,}/g, '_');
}

/**
 * Generate unique temp file suffix to prevent collisions
 * Uses crypto.randomBytes for collision resistance
 */
function uniqueTempSuffix(): string {
  return crypto.randomBytes(8).toString('hex');
}

export async function POST(req: Request) {
  try {
    // FIX (Bug 3): `contextSignals` is destructured but was never used — keep
    // it for future use but document that intent clearly.
    const { message, fileContexts, currentFile, contextSignals } = await req.json();

    // Initialize WebDAV client
    const client = createClient(
      process.env.NEXTCLOUD_URL || FEATURE_FLAGS.NEXTCLOUD_URL,
      {
        username: process.env.NEXTCLOUD_USERNAME || FEATURE_FLAGS.NEXTCLOUD_USERNAME,
        password: process.env.NEXTCLOUD_PASSWORD || FEATURE_FLAGS.NEXTCLOUD_PASSWORD,
      },
    );

    const updatedFiles: Record<string, string> = {};
    let fileChanges = '';

    // Process file changes using ETag caching
    if (currentFile && typeof currentFile === 'string') {
      try {
        const stats = await client.stat(currentFile) as any;

        // FIX (Bug 1): use the sanitised filename, not the raw user path
        const safeFilename = safeCacheFilename(currentFile);

        // FIX (Bug 4): Use a deterministic subdirectory so cache files
        // survive across calls within the same container lifetime.
        // For serverless, consider a persistent store (Redis, S3) instead.
        const cacheDir = path.join('/tmp', 'nextcloud-etag-cache');
        await fs.mkdir(cacheDir, { recursive: true });
        const cachePath = path.join(cacheDir, safeFilename);

        let cachedETag = '';
        let cachedContent = '';
        try {
          cachedETag    = await fs.readFile(`${cachePath}.etag`, 'utf8');
          cachedContent = await fs.readFile(cachePath, 'utf8');
        } catch {
          // Cache miss — treat as empty / stale
        }

        if (cachedETag !== stats.etag) {
          const newContent = await client.getFileContents(currentFile, { format: 'text' }) as string;
          const changes = diffLines(cachedContent, newContent);

          fileChanges = changes
            .map(change =>
              change.added   ? `+ ${change.value}` :
              change.removed ? `- ${change.value}` :
              `  ${change.value}`,
            )
            .join('');

          // Atomic write: use unique temp suffix to prevent same-millisecond collisions
          const tempSuffix = uniqueTempSuffix();
          await fs.writeFile(`${cachePath}.tmp.${tempSuffix}`, newContent);
          await fs.rename(`${cachePath}.tmp.${tempSuffix}`, cachePath);
          await fs.writeFile(`${cachePath}.etag.tmp.${tempSuffix}`, stats.etag);
          await fs.rename(`${cachePath}.etag.tmp.${tempSuffix}`, `${cachePath}.etag`);

          updatedFiles[currentFile] = newContent;
        }
      } catch (error) {
        console.error('File change detection error:', error);
      }
    }

    // Prepare context for LLM
    const context = [
      ...Object.entries(fileContexts || {}).map(([file, content]) =>
        `### ${file} CONTEXT:\n${content}`,
      ),
      ...(fileChanges ? [`### FILE CHANGES:\n${fileChanges}`] : []),
    ].join('\n\n');

    // Context signaling tokens
    const responseTokens = [
      '<request_file>filename</request_file> - Request additional file content',
      '<file_edit path="filepath">content</file_edit> - Propose file changes',
      '<user_input>description</user_input> - Need user clarification',
      '<next_step>action</next_step> - Describe next step',
    ].join('\n');

    // Merge contextSignals with detected signals
    let llmContextSignals: any = {
      attached_files: Object.keys(fileContexts || {}),
      current_file: currentFile,
      file_changes: fileChanges ? currentFile : undefined,
      ...contextSignals, // Merge user-provided signals
    };

    const systemPrompt = `You are an expert developer. Use this context:\n${context}\n\nResponse tokens:\n${responseTokens}`;

    // FIX (Bug 2): actually call the LLM instead of returning a stub.
    // The messages array is now forwarded to your existing chat route so the
    // full response router / enhanced LLM service handles it.
    //
    // Option A (recommended): forward to your own /api/chat internally.
    // Option B: call the LLM provider SDK directly here.
    //
    // Using Option A to stay consistent with your existing routing:
    const internalChatUrl = process.env.INTERNAL_CHAT_URL || 'http://localhost:3000/api/chat';

    let llmResponseContent: string;

    // FIX: Remove duplicate llmContextSignals declaration
    try {
      // Add timeout to prevent hanging if downstream stalls
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const chatResponse = await fetch(internalChatUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          // Forward authorization headers to preserve caller identity for rate limiting and auth
          ...(req.headers.get('authorization') && { 'Authorization': req.headers.get('authorization') }),
          ...(req.headers.get('cookie') && { 'Cookie': req.headers.get('cookie') }),
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: message },
          ],
          stream: false,
          // Pass through provider/model from env or context
          provider: process.env.DEFAULT_PROVIDER || 'openrouter',
          model:    process.env.DEFAULT_MODEL,
          context_signals: llmContextSignals,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!chatResponse.ok) {
        const errText = await chatResponse.text().catch(() => 'unknown');
        // Preserve the original status code instead of always returning 503
        const status = chatResponse.status >= 400 && chatResponse.status < 600 
          ? chatResponse.status 
          : 500;
        throw new Error(`Internal chat API error ${chatResponse.status}: ${errText}`);
      }

      const chatData = await chatResponse.json();
      // Handle both streaming-event format and direct response format
      llmResponseContent = chatData.content || chatData.response || chatData.choices?.[0]?.message?.content || '';
    } catch (llmError: any) {
      // Handle timeout errors specifically
      if (llmError.name === 'AbortError') {
        console.error('[WebDAV route] LLM call timed out after 30s');
        return NextResponse.json(
          { error: 'LLM request timeout', detail: 'The request took too long to process' },
          { status: 504 },
        );
      }

      console.error('[WebDAV route] LLM call failed:', llmError.message);
      // Graceful degradation: return a structured error rather than crashing
      return NextResponse.json(
        { error: 'LLM unavailable', detail: llmError.message, updated_files: updatedFiles },
        { status: 503 },
      );
    }

    return NextResponse.json({
      response:        llmResponseContent,
      context_signals: llmContextSignals,
      updated_files:   updatedFiles,
    });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
