import { NextResponse } from 'next/server';
import { createClient } from 'webdav';
import { diffLines } from 'diff';
import fs from 'fs/promises';
import path from 'path';
import { FEATURE_FLAGS } from '@/config/features';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { message, fileContexts, currentFile, contextSignals } = await req.json();
    
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
    if (currentFile) {
      try {
        const stats = await client.stat(currentFile);
        const cachePath = path.join('/tmp', `${currentFile.replace(/\//g, '_')}`);
        
        let cachedETag = '';
        let cachedContent = '';
        try {
          cachedETag = await fs.readFile(`${cachePath}.etag`, 'utf8');
          cachedContent = await fs.readFile(cachePath, 'utf8');
        } catch {}

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

          // Update cache
          await fs.writeFile(cachePath, newContent);
          await fs.writeFile(`${cachePath}.etag`, stats.etag);
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

    // Prepare LLM request
    const llmRequest = {
      messages: [
        {
          role: "system",
          content: `You are an expert developer. Use this context:\n${context}\n\nResponse tokens:\n${responseTokens}`
        },
        { role: "user", content: message }
      ],
      context_signals: {
        attached_files: Object.keys(fileContexts || {}),
        current_file: currentFile,
        file_changes: fileChanges ? currentFile : undefined
      }
    };

    // In production, this would call the actual LLM API
    return NextResponse.json({
      response: `Processed request for ${currentFile || 'project'}.
        <next_step>Reviewing context and file changes</next_step>
        ${fileChanges ? `<file_edit path="${currentFile}">Updated content</file_edit>` : ''}`,
      context_signals: llmRequest.context_signals,
      updated_files: updatedFiles
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}