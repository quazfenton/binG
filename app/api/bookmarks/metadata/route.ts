/**
 * Bookmarks Metadata API
 * 
 * Fetches OpenGraph metadata for link previews
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Only allow HTTP/HTTPS
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'Only HTTP and HTTPS URLs are allowed' },
        { status: 400 }
      );
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; binG Bookmarks/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch URL' },
        { status: 500 }
      );
    }

    const html = await response.text();

    // Parse OpenGraph metadata
    const metadata = parseOpenGraph(html, url);

    return NextResponse.json(metadata);
  } catch (error) {
    console.error('Error fetching metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metadata' },
      { status: 500 }
    );
  }
}

/**
 * Parse OpenGraph and meta tags from HTML
 */
function parseOpenGraph(html: string, baseUrl: string): {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  url?: string;
} {
  const metadata: any = {};

  // Extract title
  const ogTitle = extractMetaTag(html, 'og:title');
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  metadata.title = ogTitle || titleTag?.[1]?.trim() || 'Untitled';

  // Extract description
  const ogDescription = extractMetaTag(html, 'og:description');
  const metaDescription = extractMetaTag(html, 'description');
  metadata.description = ogDescription || metaDescription || '';

  // Extract image
  const ogImage = extractMetaTag(html, 'og:image');
  const twitterImage = extractMetaTag(html, 'twitter:image');
  if (ogImage || twitterImage) {
    metadata.imageUrl = resolveUrl(ogImage || twitterImage, baseUrl);
  }

  // Extract site name
  const ogSiteName = extractMetaTag(html, 'og:site_name');
  metadata.siteName = ogSiteName || '';

  // Extract URL
  const ogUrl = extractMetaTag(html, 'og:url');
  metadata.url = ogUrl || baseUrl;

  return metadata;
}

/**
 * Extract meta tag content by property/name
 */
function extractMetaTag(html: string, property: string): string | null {
  // Try property attribute (OpenGraph)
  const propertyMatch = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  );
  if (propertyMatch?.[1]) {
    return propertyMatch[1];
  }

  // Try content attribute first (some sites put it first)
  const contentFirstMatch = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, 'i')
  );
  if (contentFirstMatch?.[1]) {
    return contentFirstMatch[1];
  }

  // Try name attribute (Twitter Cards, regular meta)
  const nameMatch = html.match(
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  );
  if (nameMatch?.[1]) {
    return nameMatch[1];
  }

  return null;
}

/**
 * Resolve relative URLs to absolute
 */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}
