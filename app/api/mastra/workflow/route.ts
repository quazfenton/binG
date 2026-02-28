/**
 * Mastra Workflow Execution API
 *
 * Streams workflow execution results via SSE.
 * Supports both code-agent and hitl workflows.
 * 
 * FIXED: Added comprehensive error handling, client disconnect detection, and stream timeout
 */

import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/lib/mastra/mastra-instance';

// Valid workflow types
const VALID_WORKFLOWS = ['code-agent', 'hitl-code-review'];

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const abortController = new AbortController();

  try {
    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body', requestId },
        { status: 400 }
      );
    }

    const { task, ownerId, workflowType = 'code-agent' } = body;

    // Validate required fields
    if (!task || typeof task !== 'string') {
      return NextResponse.json(
        { error: 'task is required and must be a string', requestId },
        { status: 400 }
      );
    }

    if (!ownerId || typeof ownerId !== 'string') {
      return NextResponse.json(
        { error: 'ownerId is required and must be a string', requestId },
        { status: 400 }
      );
    }

    // Validate workflow type
    if (!VALID_WORKFLOWS.includes(workflowType)) {
      return NextResponse.json(
        { error: `Invalid workflowType. Must be one of: ${VALID_WORKFLOWS.join(', ')}`, requestId },
        { status: 400 }
      );
    }

    // Get workflow
    const workflow = mastra.getWorkflow(workflowType);

    if (!workflow) {
      return NextResponse.json(
        { error: `Workflow "${workflowType}" not found`, requestId },
        { status: 404 }
      );
    }

    // Create run
    const run = await workflow.createRun();

    // Handle client disconnect
    request.signal.addEventListener('abort', () => {
      abortController.abort();
      console.log(`[Mastra API] Client disconnected (run: ${run.runId}, request: ${requestId})`);
    });

    // Stream execution with abort signal
    const stream = await run.stream({
      inputData: { task, ownerId },
      abortSignal: abortController.signal,
    });

    // Convert to SSE stream
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        const timeout = setTimeout(() => {
          controller.error(new Error('Stream timeout after 5 minutes'));
        }, 300000); // 5 minute timeout

        try {
          for await (const chunk of stream.toReadableStream()) {
            if (abortController.signal.aborted) {
              break;
            }
            const data = encoder.decode(chunk);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          clearTimeout(timeout);
          controller.close();
        } catch (error) {
          clearTimeout(timeout);
          if (!abortController.signal.aborted) {
            console.error(`[Mastra API] Stream error (request: ${requestId}):`, error);
            controller.error(error);
          }
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-ID': requestId,
        'X-Run-ID': run.runId,
      },
    });
  } catch (error) {
    console.error(`[Mastra API] Workflow execution error (${requestId}):`, error);

    // Don't expose internal errors in production
    const isDev = process.env.NODE_ENV === 'development';
    
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Workflow execution failed',
        requestId,
        stack: isDev && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
