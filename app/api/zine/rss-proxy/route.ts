/**
 * Zine Engine RSS Proxy API
 * GET /api/zine/rss-proxy - CORS proxy for RSS feeds
 */

import { NextRequest, NextResponse } from "next/server";

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
    
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
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
    const blockedPatterns = [
      "localhost",
      "127.",
      "10.",
      "192.168.",
      "172.16.",
      "172.17.",
      "172.18.",
      "172.19.",
      "172.20.",
      "172.21.",
      "172.22.",
      "172.23.",
      "172.24.",
      "172.25.",
      "172.26.",
      "172.27.",
      "172.28.",
      "172.29.",
      "172.30.",
      "172.31.",
      "169.254.",
      "0.0.0.0",
      ".local",
      ".internal",
      "metadata",
      "100.100.",
      "168.63.129.",
    ];
    
    if (blockedPatterns.some(pattern => hostname.includes(pattern))) {
      console.warn("[RSS Proxy] Blocked unsafe URL:", url);
      return NextResponse.json(
        { error: "Blocked unsafe URL (internal network or cloud metadata)" },
        { status: 403 }
      );
    }
    
    // Fetch RSS feed
    const response = await fetch(url, {
      headers: {
        "User-Agent": "binG Zine Engine RSS Reader/1.0",
        "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`RSS feed returned ${response.status} ${response.statusText}`);
    }
    
    const xml = await response.text();
    
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=60", // 5 min browser cache, 1 min CDN cache
        "X-RSS-Source": url,
        "X-RSS-Fetched": new Date().toISOString(),
      },
    });
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
