import { NextResponse } from 'next/server';
import { createClient } from 'webdav';
import { diffLines } from 'diff';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { FEATURE_FLAGS } from '@/config/features';

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

          // Atomic write: write to tmp then rename
          await fs.writeFile(`${cachePath}.tmp`,      newContent);
          await fs.rename(`${cachePath}.tmp`, cachePath);
          await fs.writeFile(`${cachePath}.etag.tmp`, stats.etag);
          await fs.rename(`${cachePath}.etag.tmp`, `${cachePath}.etag`);

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
    const llmContextSignals = {
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
    let llmContextSignals: any = {
      attached_files: Object.keys(fileContexts || {}),
      current_file:  currentFile,
      file_changes:  fileChanges ? currentFile : undefined,
    };

    // Merge incoming contextSignals if provided (Bug 3 usage)
    if (contextSignals && typeof contextSignals === 'object') {
      llmContextSignals = { ...llmContextSignals, ...contextSignals };
    }

    try {
      const chatResponse = await fetch(internalChatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      });

      if (!chatResponse.ok) {
        const errText = await chatResponse.text().catch(() => 'unknown');
        throw new Error(`Internal chat API error ${chatResponse.status}: ${errText}`);
      }

      const chatData = await chatResponse.json();
      // Handle both streaming-event format and direct response format
      llmResponseContent = chatData.content || chatData.response || chatData.choices?.[0]?.message?.content || '';
    } catch (llmError: any) {
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
