import { NextRequest } from 'next/server';
import { POST as rollbackPOST } from './git/[sessionId]/rollback/gateway';
import { GET as versionsGET } from './git/[sessionId]/versions/gateway';

export async function GET(request: NextRequest) {
  return versionsGET(request);
}

export async function POST(request: NextRequest) {
  return rollbackPOST(request);
}
