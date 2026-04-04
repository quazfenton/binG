/**
 * Zine Engine RSS Proxy API
 * GET /api/zine/rss-proxy - CORS proxy for RSS feeds
 */

import { NextRequest, NextResponse } from "next/server";
import { sanitizeUrlInput } from "@/lib/utils/sanitize";

// Helper function for recursive RSS fetch with redirect validation
async function fetchRssWithValidation(url: string, blockedPatterns: string[]): Promise<NextResponse> {
  // Sanitize input to handle edge cases like null bytes and unusual encoding
  let sanitizedUrl: string;
  try {
    sanitizedUrl = sanitizeUrlInput(url);
  } catch (sanitizeError: any) {
    console.error('[RSS-Proxy] URL sanitization failed:', sanitizeError.message);
    return NextResponse.json(
      { error: sanitizeError.message || 'URL sanitization failed' },
      { status: 400 }
    );
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sanitizedUrl);
  } catch {
    return NextResponse.json(
      { error: "Invalid URL format" },
      { status: 400 }
    );
  }

  // Check protocol
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json(
      { error: "Only HTTP and HTTPS URLs are allowed" },
      { status: 400 }
    );
  }

  // Block SSRF attempts
  const hostname = parsedUrl.hostname.toLowerCase();
  if (blockedPatterns.some(pattern => hostname.includes(pattern))) {
    return NextResponse.json(
      { error: "Blocked unsafe URL (internal network or cloud metadata)" },
      { status: 403 }
    );
  }

  // DNS resolution check
  try {
    const { lookup } = await import("dns/promises");
    const resolved = await lookup(hostname, { family: 0 });
    const ips = Array.isArray(resolved) ? resolved : [resolved];
    for (const entry of ips) {
      const ip = entry.address;
      if (
        ip === "127.0.0.1" || ip === "::1" ||
        ip.startsWith("10.") || ip.startsWith("192.168.") ||
        ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") ||
        ip.startsWith("172.19.") || ip.startsWith("172.20.") || ip.startsWith("172.21.") ||
        ip.startsWith("172.22.") || ip.startsWith("172.23.") || ip.startsWith("172.24.") ||
        ip.startsWith("172.25.") || ip.startsWith("172.26.") || ip.startsWith("172.27.") ||
        ip.startsWith("172.28.") || ip.startsWith("172.29.") || ip.startsWith("172.30.") ||
        ip.startsWith("172.31.") ||
        ip.startsWith("169.254.") || ip.startsWith("100.100.") ||
        ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")
      ) {
        return NextResponse.json(
          { error: "Blocked unsafe URL (resolves to internal network)" },
          { status: 403 }
        );
      }
    }
  } catch {
    // DNS resolution failed - let fetch handle it
  }

  // Fetch with manual redirect
  const response = await fetch(sanitizedUrl, {
    headers: {
      "User-Agent": "binG Zine Engine RSS Reader/1.0",
      "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml",
    },
    signal: AbortSignal.timeout(10000),
    redirect: "manual",
  });

  // Handle redirects
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const redirectUrl = response.headers.get("location");
    if (redirectUrl) {
      return await fetchRssWithValidation(redirectUrl, blockedPatterns);
    }
  }

  if (!response.ok) {
    throw new Error(`RSS feed returned ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=60",
      "X-RSS-Source": url,
      "X-RSS-Fetched": new Date().toISOString(),
    },
  });
}

// ============================================================================
// GET /api/zine/rss-proxy?url=xxx - Proxy RSS feed
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json(
        { error: "URL parameter required", hint: "Use ?url=https://example.com/feed.xml" },
        { status: 400 }
      );
    }

    // Use helper function for validated RSS fetch
    return await fetchRssWithValidation(url, [
      "localhost", "127.", "10.", "192.168.",
      "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.",
      "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.",
      "172.28.", "172.29.", "172.30.", "172.31.",
      "169.254.", "0.0.0.0", "100.100.", "168.63.129.",
      "metadata", ".local", ".internal", "::1", "[::1]",
      "fc00:", "fd", "fe80:", "[::ffff:7f", "[::ffff:0:",
    ]);
  } catch (error) {
    console.error("Error proxying RSS:", error);

    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.message.includes("timeout")) {
        return NextResponse.json(
          { error: "RSS feed request timed out" },
          { status: 504 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to fetch RSS feed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/zine/rss-proxy - Documentation
// ============================================================================

export async function GET_DOC() {
  return NextResponse.json({
    endpoint: "/api/zine/rss-proxy",
    description: "CORS proxy for fetching RSS feeds",
    parameters: {
      url: "The RSS feed URL to fetch (required)",
    },
    example: "/api/zine/rss-proxy?url=https://techcrunch.com/feed/",
    security: {
      protocol: "Only HTTP and HTTPS URLs allowed",
      ssrf: "Internal network and cloud metadata URLs are blocked",
      timeout: "10 second timeout for feed requests",
    },
    caching: {
      browser: "5 minutes",
      cdn: "1 minute",
    },
  });
}
