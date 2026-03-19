/**
 * Image URL Validation API
 * 
 * Validates image URLs for SSRF safety before loading.
 * Can be used to pre-validate URLs or as a proxy for additional security.
 * 
 * GET /api/image/validate?url=<image_url>
 * 
 * Response:
 * - 200: { valid: true, url: string }
 * - 400: { valid: false, error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateImageUrl } from '@/lib/utils/image-loader';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { valid: false, error: 'Missing "url" parameter' },
      { status: 400 }
    );
  }

  const validation = validateImageUrl(url);

  if (!validation.valid) {
    return NextResponse.json(
      { valid: false, error: validation.error },
      { status: 400 }
    );
  }

  return NextResponse.json({
    valid: true,
    url,
  });
}
