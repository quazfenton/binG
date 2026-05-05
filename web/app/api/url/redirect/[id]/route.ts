import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getUrl, incrementClicks } from '@/lib/url-shortener/store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stored = getUrl(id);
  if (!stored) {
    // Derive origin from request URL for proper 404 redirect in all environments
    const origin = new URL(req.url).origin;
    return NextResponse.redirect(new URL('/404', origin));
  }

  incrementClicks(id);
  return NextResponse.redirect(stored.original);
}
