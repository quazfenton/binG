import { NextResponse } from 'next/server';
import { createClient } from 'webdav';
import { diffLines } from 'diff';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { FEATURE_FLAGS } from '@/config/features';

export const dynamic = 'force-dynamic';

/**
 * Sanitize filename for cache storage
 * Prevents path traversal attacks
 */
function safeCacheFilename(filename: string): string {
  if (!filename) return 'empty';
  
  // Remove null bytes
  let sanitized = filename.replace(/\0/g, '');
  
  // Remove path traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');
  
  // Replace forward slashes with underscores
  sanitized = sanitized.replace(/\//g, '_');
  
  // Collapse multiple underscores
  sanitized = sanitized.replace(/_+/g, '_');
  
  // Allow only safe characters (alphanumeric, dash, underscore, dot)
  sanitized = sanitized.replace(/[^a-zA-Z0-9_.-]/g, '');
  
  // Limit length
  if (sanitized.length > 200) {
    sanitized = sanitized.slice(0, 200);
  }
  
  return sanitized || 'empty';
}

/**
 * Atomic file write with temp file + rename
 * Prevents corruption from interrupted writes
 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    // Write to temp file
    await fs.writeFile(tmpPath, content, 'utf8');
    
    // Atomic rename
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // Cleanup temp file on error
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const { message, fileContexts, currentFile, contextSignals } = await req.json();

    // Validate input
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Initialize WebDAV client
    const client = createClient(
      process.env.NEXTCLOUD_URL || FEATURE_FLAGS.NEXTCLOUD_URL,
      {
        username: process.env.NEXTCLOUD_USERNAME || FEATURE_FLAGS.NEXTCLOUD_USERNAME,
        password: process.env.NEXTCLOUD_PASSWORD || FEATURE_FLAGS.NEXTCLOUD_PASSWORD
      }
    );

    const updatedFiles: Record<string, string> = {};
    let fileChanges = '';

    // Process file changes using ETag caching
    if (currentFile && typeof currentFile === 'string') {
      try {
        const stats = await client.stat(currentFile) as any;
        
        // Use persistent cache directory with sanitized filename
        const CACHE_DIR = path.join(process.cwd(), 'data', 'webdav-cache');
        const safeFilename = safeCacheFilename(currentFile);
        const cachePath = path.join(CACHE_DIR, safeFilename);

        let cachedETag = '';
        let cachedContent = '';
        try {
          cachedETag = await fs.readFile(`${cachePath}.etag`, 'utf8');
          cachedContent = await fs.readFile(cachePath, 'utf8');
        } catch {
          // Cache miss - will fetch fresh content
        }

        if (cachedETag !== stats.etag) {
          const newContent = await client.getFileContents(currentFile, { format: 'text' }) as string;
          const changes = diffLines(cachedContent, newContent);

          fileChanges = changes
            .map(change =>
              change.added ? `+ ${change.value}` :
              change.removed ? `- ${change.value}` :
              `  ${change.value}`
            )
            .join('');

          // Update cache atomically
          await atomicWriteFile(cachePath, newContent);
          await atomicWriteFile(`${cachePath}.etag`, stats.etag);
          
          updatedFiles[currentFile] = newContent;
        }
      } catch (error) {
        console.error('File change detection error:', error);
      }
    }

    // Prepare context for LLM
    const context = [
      ...Object.entries(fileContexts || {}).map(([file, content]) =>
        `### ${file} CONTEXT:\n${content}`
      ),
      ...(fileChanges ? [`### FILE CHANGES:\n${fileChanges}`] : [])
    ].join('\n\n');

    // Context signaling tokens
    const responseTokens = [
      '<request_file>filename</request_file> - Request additional file content',
      '<file_edit path="filepath">content</file_edit> - Propose file changes',
      '<user_input>description</user_input> - Need user clarification',
      '<next_step>action</next_step> - Describe next step'
    ].join('\n');

    // Merge contextSignals with detected signals
    const llmContextSignals = {
      attached_files: Object.keys(fileContexts || {}),
      current_file: currentFile,
      file_changes: fileChanges ? currentFile : undefined,
      ...contextSignals, // Merge user-provided signals
    };

    // Prepare LLM request
    const llmRequest = {
      messages: [
        {
          role: "system",
          content: `You are an expert developer. Use this context:\n${context}\n\nResponse tokens:\n${responseTokens}`
        },
        { role: "user", content: message }
      ],
      context_signals: llmContextSignals,
    };

    // Call internal chat API for full response router handling
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const chatResponse = await fetch(`${appUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: llmRequest.messages,
        context_signals: llmRequest.context_signals,
      }),
    });

    if (!chatResponse.ok) {
      throw new Error(`Chat API returned ${chatResponse.status}`);
    }

    const chatData = await chatResponse.json();

    return NextResponse.json({
      response: chatData.content || chatData.response || 'No response generated',
      context_signals: llmRequest.context_signals,
      updated_files: updatedFiles,
      tool_invocations: chatData.tool_invocations,
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