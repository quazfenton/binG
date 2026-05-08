import { NextRequest } from 'next/server';
import { POST as rollbackPOST } from './git/[sessionId]/rollback/gateway';
import { GET as versionsGET } from './git/[sessionId]/versions/gateway';

export async function GET(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/gateway/git/:sessionId/versions
  const sessionId = pathParts[3] || '';
  return versionsGET(request, { params: Promise.resolve({ sessionId }) });
}

export async function POST(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/gateway/git/:sessionId/rollback
  const sessionId = pathParts[3] || '';
  return rollbackPOST(request, { params: Promise.resolve({ sessionId }) });
}
