/**
 * Custom Test Endpoint: Direct File Edit Parser Testing
 * 
 * POST /api/test/vfs-parse-edits
 * Body: { content: string }
 * Returns: parsed edits from the file-edit-parser
 * 
 * This bypasses the LLM entirely and tests ONLY the parser logic.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'content string required' }, { status: 400 });
    }

    // Dynamically import the parser
    const { extractFileEdits } = await import('@/lib/chat/file-edit-parser');

    const edits = extractFileEdits(content);

    return NextResponse.json({
      inputLength: content.length,
      editCount: edits.length,
      edits,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
