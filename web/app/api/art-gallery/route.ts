/**
 * AI Art Gallery API
 * Consolidated route — dispatches to sub-handler route.ts files.
 *
 * Endpoints:
 * - GET    /api/art-gallery       - List artworks (main.ts)
 * - PUT    /api/art-gallery       - Like artwork (main.ts)
 * - GET    /api/art-gallery/images - List images (images/route.ts)
 * - POST   /api/art-gallery/images - Create/update images (images/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, PUT as rootPUT } from './main';
import { GET as imagesGET, POST as imagesPOST } from './images/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/art-gallery/images -> images route
  if (path.endsWith('/images')) {
    return imagesGET(request);
  }

  // /api/art-gallery -> main handler
  return rootGET(request);
}

export async function PUT(request: NextRequest) {
  return rootPUT(request);
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/art-gallery/images -> images route
  if (path.endsWith('/images')) {
    return imagesPOST(request);
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}