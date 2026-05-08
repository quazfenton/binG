import { NextRequest, NextResponse } from 'next/server';


import { secureRandomString } from '@/lib/utils';
import { setUrl } from '@/lib/url-shortener/store';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL required' }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http/https URLs are allowed' }, { status: 400 });
    }

    const id = secureRandomString(8).toLowerCase();
    const now = new Date().toISOString();
    setUrl(id, {
      id,
      original: parsed.toString(),
      clicks: 0,
      created: now,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const shortened = `${baseUrl.replace(/\/$/, '')}/api/url/redirect/${id}`;

    return NextResponse.json({
      original: parsed.toString(),
      shortened,
      clicks: 0,
      created: now,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to shorten URL' }, { status: 500 });
  }
}
