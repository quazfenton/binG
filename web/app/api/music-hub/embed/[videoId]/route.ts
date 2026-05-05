/**
 * Music Hub Embed Proxy
 *
 * Serves YouTube embeds with proper headers for cross-origin embedding
 */

import { NextRequest, NextResponse } from "next/server";



// GET - Serve YouTube embed page
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const autoplay = searchParams.get("autoplay") === "1";

  // Validate video ID (YouTube video IDs are 11 characters)
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: "Invalid video ID. Must be 11 characters." },
      { status: 400 }
    );
  }

  // Serve a simple HTML page with YouTube iframe
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Music Embed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    .embed-container {
      position: relative;
      width: 100%;
      height: 100%;
      padding-bottom: 56.25%; /* 16:9 aspect ratio */
    }
    .embed-container iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <div class="embed-container">
    <iframe
      src="https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&rel=0&modestbranding=1&controls=1&enablejsapi=1"
      title="YouTube video player"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
    ></iframe>
  </div>
</body>
</html>`.trim();

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
