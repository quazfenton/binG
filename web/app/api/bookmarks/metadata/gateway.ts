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

    // Fetch the URL with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; binG/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timed out' },
          { status: 408 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to fetch URL' },
        { status: 500 }
      );
    }

    // Validate content type before fetching
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        { error: 'URL does not point to an HTML page' },
        { status: 400 }
      );
    }

    // Fetch with size limit - read as stream and cap at 1MB
    const reader = response.body?.getReader();
    if (!reader) {
      return NextResponse.json(
        { error: 'Failed to read response body' },
        { status: 500 }
      );
    }

    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    const MAX_SIZE = 1024 * 1024; // 1MB limit

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalLength += value.length;
        if (totalLength > MAX_SIZE) {
          await reader.cancel();
          return NextResponse.json(
            { error: 'Response too large (max 1MB)' },
            { status: 400 }
          );
        }
        chunks.push(value);
      }
    } finally {
      // Clear timeout after stream is fully consumed or cancelled
      clearTimeout(timeoutId);
    }

    // Concatenate chunks and decode
    const htmlBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      htmlBytes.set(chunk, offset);
      offset += chunk.length;
    }

    const html = new TextDecoder().decode(htmlBytes);

    // Parse OpenGraph metadata
    const metadata = parseOpenGraph(html, url);

    return NextResponse.json(metadata);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timed out' },
        { status: 408 }
      );
    }
    console.error('Error fetching metadata:', error.message);
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
