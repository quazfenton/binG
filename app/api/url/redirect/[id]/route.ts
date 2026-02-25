import { NextRequest, NextResponse } from 'next/server';
import { urlShortenerStore } from '@/lib/url-shortener/store';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stored = urlShortenerStore.get(id);
  if (!stored) {
    return NextResponse.redirect(new URL('/404', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  }

  stored.clicks += 1;
  urlShortenerStore.set(id, stored);
  return NextResponse.redirect(stored.original);
}
