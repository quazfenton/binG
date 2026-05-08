import { NextRequest } from 'next/server';
import { GET as zipballGET } from './zipball/[owner]/[repo]/gateway';

export async function GET(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/github/zipball/:owner/:repo
  const owner = pathParts[3] || '';
  const repo = pathParts[4] || '';
  return zipballGET(request, { params: Promise.resolve({ owner, repo }) });
}
