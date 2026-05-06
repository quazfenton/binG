import { NextRequest } from 'next/server';
import { GET as contentGET, DELETE as contentDELETE } from './content/[url]/gateway';

export async function GET(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/immersive/content/:url
  const url = pathParts[3] || '';
  return contentGET(request, { params: Promise.resolve({ url }) });
}

export async function DELETE(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
  // /api/immersive/content/:url
  const url = pathParts[3] || '';
  return contentDELETE(request, { params: Promise.resolve({ url }) });
}
