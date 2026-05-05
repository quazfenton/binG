import { NextRequest, NextResponse } from 'next/server';


import { z } from 'zod';

// ---------------------------------------------------------------------------
// In-memory notification queue for webhook ingestion
// ---------------------------------------------------------------------------

interface QueuedItem {
  id: string;
  content: string;
  type?: string;
  source?: string;
  author?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

const MAX_QUEUE = 500;
const queue: QueuedItem[] = [];

function pushToQueue(item: QueuedItem): void {
  queue.push(item);
  if (queue.length > MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE);
  }
}

// ---------------------------------------------------------------------------
// GET — Poll queued webhook data
// ?type=poll&since=<timestamp>
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type');

  if (type === 'poll') {
    const since = parseInt(searchParams.get('since') || '0', 10);
    const items = queue.filter((item) => item.timestamp > since);

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      total: queue.length,
    });
  }

  return NextResponse.json({
    success: true,
    service: 'zine-display',
    queueSize: queue.length,
    endpoints: {
      poll: 'GET ?type=poll&since=<timestamp>',
      webhook: 'POST { content, type?, author?, meta? }',
      fetchUrl: 'POST { action: "fetch-url", url: "..." }',
      fetchRss: 'POST { action: "fetch-rss", source: "hn" }',
    },
  });
}

// ---------------------------------------------------------------------------
// POST — Accept webhook payloads, proxy URL/RSS fetches
// ---------------------------------------------------------------------------

const webhookSchema = z.object({
  content: z.string().min(1).max(5000),
  type: z.string().optional(),
  author: z.string().max(100).optional(),
  meta: z.record(z.unknown()).optional(),
});

const fetchUrlSchema = z.object({
  action: z.literal('fetch-url'),
  url: z.string().url(),
});

const fetchRssSchema = z.object({
  action: z.literal('fetch-rss'),
  source: z.string().optional(),
  url: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Route by action
    if (body.action === 'fetch-url') {
      return handleFetchUrl(body);
    }

    if (body.action === 'fetch-rss') {
      return handleFetchRss(body);
    }

    // Default: webhook ingestion
    return handleWebhook(body);
  } catch (error) {
    console.error('[ZineDisplay API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleWebhook(body: unknown): Promise<NextResponse> {
  // Support both single items and arrays
  const items = Array.isArray(body) ? body : [body];
  const results: QueuedItem[] = [];

  for (const item of items) {
    const parsed = webhookSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }

    const queued: QueuedItem = {
      id: crypto.randomUUID(),
      content: parsed.data.content,
      type: parsed.data.type,
      author: parsed.data.author,
      timestamp: Date.now(),
      meta: parsed.data.meta,
    };

    pushToQueue(queued);
    results.push(queued);
  }

  if (results.length === 0) {
    return NextResponse.json(
      { success: false, error: 'No valid items in payload' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    queued: results.length,
    items: results,
  });
}

async function handleFetchUrl(body: unknown): Promise<NextResponse> {
  const parsed = fetchUrlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid URL' },
      { status: 400 },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(parsed.data.url, {
      headers: {
        'User-Agent': 'binG-ZineDisplay/1.0',
        Accept: 'text/html, application/json, text/plain, */*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `HTTP ${response.status}` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get('content-type') || '';
    let content: string | Record<string, unknown>;

    if (contentType.includes('application/json')) {
      content = await response.json();
    } else {
      const text = await response.text();
      // Strip HTML tags for plain content extraction
      content = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
    }

    return NextResponse.json({
      success: true,
      url: parsed.data.url,
      contentType,
      content,
    });
  } catch (fetchError) {
    console.error('[ZineDisplay] URL fetch error:', fetchError);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch URL' },
      { status: 502 },
    );
  }
}

async function handleFetchRss(body: unknown): Promise<NextResponse> {
  const parsed = fetchRssSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid RSS request' },
      { status: 400 },
    );
  }

  // Proxy to the existing RSS route
  const params = new URLSearchParams();
  if (parsed.data.source) params.set('source', parsed.data.source);
  if (parsed.data.url) params.set('url', parsed.data.url);
  params.set('limit', '15');

  try {
    // Use internal URL for the RSS route
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/news/rss?${params.toString()}`);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `RSS fetch failed: HTTP ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (rssError) {
    console.error('[ZineDisplay] RSS proxy error:', rssError);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch RSS' },
      { status: 502 },
    );
  }
}
