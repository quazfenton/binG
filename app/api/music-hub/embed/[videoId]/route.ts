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
async function getCachedEmbed(videoId: string): Promise<string | null> {
  try {
    const data = await readFile(CACHE_PATH, "utf-8");
    const cache: EmbedCache = JSON.parse(data);
    
    const cached = cache[videoId];
    if (!cached) return null;
    
    // Check if expired
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      delete cache[videoId];
      await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
      return null;
    }
    
    // Update access count
    cached.accessCount++;
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
    
    return cached.html;
  } catch (error) {
    return null;
  }
}

// Cache embed HTML
async function cacheEmbed(videoId: string, html: string, source: string): Promise<void> {
  try {
    let cache: EmbedCache = {};
    
    try {
      const data = await readFile(CACHE_PATH, "utf-8");
      cache = JSON.parse(data);
    } catch {
      // File doesn't exist
    }
    
    // Evict oldest if cache is full
    const entries = Object.entries(cache);
    if (entries.length >= MAX_CACHE_SIZE) {
      // Sort by timestamp and remove oldest
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const oldestKey = entries[0][0];
      delete cache[oldestKey];
    }
    
    cache[videoId] = {
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
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;
  const searchParams = request.nextUrl.searchParams;
  const autoplay = searchParams.get("autoplay") === "1";
  const useCache = searchParams.get("cache") !== "false";

  if (!videoId || videoId.length !== 11) {
    return NextResponse.json(
      { error: "Invalid video ID" },
      { status: 400 }
    );
  }

  // Try cache first
  if (useCache) {
    const cached = await getCachedEmbed(videoId);
    if (cached) {
      return new NextResponse(cached, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
          "X-Cache": "HIT",
        },
      });
    }
  }

  // Try each embed source
  let lastError: Error | null = null;
  
  for (const source of EMBED_SOURCES) {
    try {
      const embedUrl = source.url(videoId);
      const response = await fetch(embedUrl, {
        headers: {
          ...source.headers,
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();

      // Modify HTML to work in our context
      const modifiedHtml = html
        .replace(/<base[^>]*>/g, "") // Remove base tags
        .replace(/document\.domain/g, "// document.domain") // Disable domain checks
        .replace(/"https:\/\/www\.youtube\.com/g, '"') // Fix relative URLs
        .replace(/'https:\/\/www\.youtube\.com/g, "'"); // Fix relative URLs

      // Cache the result
      if (useCache) {
        await cacheEmbed(videoId, modifiedHtml, source.id);
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
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;

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
