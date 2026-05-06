import { NextRequest, NextResponse } from 'next/server';
import { POST as resumePOST } from './resume/gateway';
import { GET as statusGET } from './status/gateway';
import { POST as workflowPOST } from './workflow/gateway';
import { POST as workflowsIdPOST, GET as workflowsIdGET } from './workflows/[workflowId]/gateway';

/**
 * Consolidated mastra route
 * Preserved original at ./main.ts
 */
export async function GET(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/mastra/workflows/:workflowId
  if (pathParts.includes('workflows')) {
    return workflowsIdGET(request);
  }

  // /api/mastra/status
  return statusGET(request);
}

export async function POST(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/mastra/workflows/:workflowId
  if (pathParts.includes('workflows')) {
    return workflowsIdPOST(request);
  }

  // /api/mastra/resume - HITL resume
  if (pathParts.includes('resume')) {
    return resumePOST(request);
  }

  // /api/mastra/workflow - workflow execution
  return workflowPOST(request);
}