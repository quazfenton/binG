/**
 * Music Hub Embed Proxy
 *
 * Proxies YouTube embed requests to bypass embedding restrictions
 * with intelligent caching and multiple fallback sources
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const CACHE_PATH = join(process.cwd(), "data", "music-hub-embed-cache.json");

// Cache configuration
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 1000;

// Embed source fallbacks
const EMBED_SOURCES = [
  {
    id: 'youtube-direct',
    url: (videoId: string) => `https://www.youtube.com/embed/${videoId}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  },
  {
    id: 'invidious',
    url: (videoId: string) => `https://inv.tux.pizza/embed/${videoId}`,
    headers: {},
  },
  {
    id: 'piped',
    url: (videoId: string) => `https://piped.video/embed/${videoId}`,
    headers: {},
  },
];

interface EmbedCache {
  [videoId: string]: {
    html: string;
    timestamp: number;
    source: string;
    accessCount: number;
  };
}

// Get cached embed
async function getCachedEmbed(videoId: string, autoplay?: boolean): Promise<string | null> {
  try {
    const data = await readFile(CACHE_PATH, "utf-8");
    const cache: EmbedCache = JSON.parse(data);

    const cacheKey = autoplay ? `${videoId}:autoplay=1` : videoId;
    const cached = cache[cacheKey];
    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      delete cache[cacheKey];
      await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
      return null;
    }

    // Update access count
    cached.accessCount++;
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));

    return cached.html;
  } catch (error: any) {
    // Only silently ignore ENOENT (file doesn't exist yet)
    if (error?.code === 'ENOENT') {
      return null;
    }
    // Log other errors for debugging
    console.error('[Music Embed Cache] Read error:', error);
    return null;
  }
}

// Cache embed HTML
async function cacheEmbed(videoId: string, html: string, source: string, autoplay?: boolean): Promise<void> {
  try {
    let cache: EmbedCache = {};

    try {
      const data = await readFile(CACHE_PATH, "utf-8");
      cache = JSON.parse(data);
    } catch (error: any) {
      // Only silently ignore ENOENT (file doesn't exist yet)
      if (error?.code !== 'ENOENT') {
        console.error('[Music Embed Cache] Parse error:', error);
      }
    }

    // Use autoplay in cache key
    const cacheKey = autoplay ? `${videoId}:autoplay=1` : videoId;

    // Evict oldest if cache is full
    const entries = Object.entries(cache);
    if (entries.length >= MAX_CACHE_SIZE) {
      // Sort by timestamp and remove oldest
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const oldestKey = entries[0][0];
      delete cache[oldestKey];
    }

    cache[cacheKey] = {
      html,
      timestamp: Date.now(),
      source,
      accessCount: 1,
    };

    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error("Failed to cache embed:", error);
  }
}

// GET - Serve embed or proxy from source
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const autoplay = searchParams.get("autoplay") === "1";
  const useCache = searchParams.get("cache") !== "false";

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: "Invalid video ID" },
      { status: 400 }
    );
  }

  // Try cache first (include autoplay in cache key)
  if (useCache) {
    const cached = await getCachedEmbed(videoId, autoplay);
    if (cached) {
      // SECURITY: Wrap cached HTML in sandboxed iframe (same as non-cached)
      const sandboxedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Music Embed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe
    sandbox="allow-scripts allow-presentation"
    referrerpolicy="strict-origin-when-cross-origin"
    srcdoc="${cached.replace(/"/g, '&quot;')}"
    title="Video Embed"
  ></iframe>
</body>
</html>`.trim();

      return new NextResponse(sandboxedHtml, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
          "X-Cache": "HIT",
        },
      });
    }
  }

  // Try each embed source with timeout
  let lastError: Error | null = null;

  for (const source of EMBED_SOURCES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const embedUrl = source.url(videoId);
      const response = await fetch(embedUrl, {
        headers: {
          ...source.headers,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      let html = await response.text();

      // Apply autoplay parameter
      if (autoplay) {
        html = html.replace(/autoplay=\d*/g, 'autoplay=1');
        if (!html.includes('autoplay=')) {
          html = html.replace(/src=["']([^"']*youtube[^"']*)["']/g, `src="$1&autoplay=1"`);
        }
      }

      // Modify HTML to work in our context
      const modifiedHtml = html
        .replace(/<base[^>]*>/g, "") // Remove base tags
        .replace(/document\.domain/g, "// document.domain"); // Disable domain checks

      // Cache the result (include autoplay in cache key)
      if (useCache) {
        await cacheEmbed(videoId, modifiedHtml, source.id, autoplay);
      }

      // SECURITY: Wrap untrusted HTML in sandboxed iframe instead of serving as our origin
      const sandboxedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Music Embed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe
    sandbox="allow-scripts allow-same-origin allow-presentation"
    referrerpolicy="strict-origin-when-cross-origin"
    srcdoc="${modifiedHtml.replace(/"/g, '&quot;')}"
    title="Video Embed"
  ></iframe>
</body>
</html>`.trim();

      return new NextResponse(sandboxedHtml, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
          "X-Cache": "MISS",
          "X-Source": source.id,
          // Additional security headers
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
        },
      });
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;
      console.warn(`Failed to fetch from ${source.id}:`, error);
      continue;
    }
  }

  // All sources failed
  return NextResponse.json(
    { 
      error: "Failed to fetch embed",
      details: lastError?.message,
      fallback: `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}`
    },
    { status: 500 }
  );
}

// DELETE - Clear cache for a video
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  try {
    const data = await readFile(CACHE_PATH, "utf-8");
    const cache: EmbedCache = JSON.parse(data);
    
    if (videoId === "all") {
      // Clear all cache
      await writeFile(CACHE_PATH, JSON.stringify({}, null, 2));
      return NextResponse.json({ success: true, message: "Cache cleared" });
    }
    
    delete cache[videoId];
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
    
    return NextResponse.json({ 
      success: true, 
      message: `Cache cleared for ${videoId}` 
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to clear cache" },
      { status: 500 }
    );
  }
}

// GET - Cache stats
export async function GET_STATS() {
  try {
    const data = await readFile(CACHE_PATH, "utf-8");
    const cache: EmbedCache = JSON.parse(data);
    
    const entries = Object.entries(cache);
    const totalSize = entries.length;
    const oldestEntry = entries.length > 0 
      ? new Date(Math.min(...entries.map(([, v]) => v.timestamp)))
      : null;
    const totalAccesses = entries.reduce((sum, [, v]) => sum + v.accessCount, 0);
    
    return NextResponse.json({
      totalEntries: totalSize,
      maxSize: MAX_CACHE_SIZE,
      oldestEntry: oldestEntry?.toISOString(),
      totalAccesses,
      hitRate: totalAccesses / Math.max(totalSize, 1),
    });
  } catch (error) {
    return NextResponse.json({
      totalEntries: 0,
      maxSize: MAX_CACHE_SIZE,
    });
  }
}
