/**
 * Zine Flow API Endpoints
 * 
 * Multi-source content aggregation for the Zine Flow Engine:
 * - RSS feed parsing
 * - Webhook event handling
 * - Integration data fetching
 * - Content deduplication
 * - Rate limiting
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const ZINE_DATA_PATH = join(DATA_DIR, "zine-flow-data.json");
const WEBHOOK_LOG_PATH = join(DATA_DIR, "zine-webhook-log.json");

// Rate limiting
const RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 30,
};

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, { count: 1, resetTime: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
  }

  if (record.count >= RATE_LIMIT.maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - record.count };
}

// Ensure data directory
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Parse RSS feed (simplified - in production use xml2js or similar)
async function parseRSSFeed(url: string): Promise<any[]> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ZineFlow/1.0 (RSS Parser)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const items: any[] = [];

    // Simple XML parsing (in production, use proper XML parser)
    const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    
    itemMatches.forEach(itemXml => {
      const title = itemXml.match(/<title>([^<]+)<\/title>/)?.[1];
      const link = itemXml.match(/<link>([^<]+)<\/link>/)?.[1];
      const description = itemXml.match(/<description>([^<]+)<\/title>/)?.[1];
      const pubDate = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
      const categories = [...(itemXml.match(/<category>([^<]+)<\/category>/g) || [])].map(
        (c: string) => c.match(/<category>([^<]+)<\/category>/)?.[1]
      );

      if (title) {
        items.push({
          title,
          link,
          description: description || '',
          pubDate: pubDate || new Date().toISOString(),
          categories: categories.filter(Boolean),
        });
      }
    });

    return items;
  } catch (error) {
    console.error('RSS parse error:', error);
    return [];
  }
}

// GET /api/zine/rss - Fetch RSS feed content
export async function GET_RSS(request: NextRequest) {
  const clientId = request.headers.get('x-forwarded-for') || request.ip || 'unknown';
  const rateLimit = checkRateLimit(`rss:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'URL parameter required' },
      { status: 400, headers }
    );
  }

  try {
    const items = await parseRSSFeed(url);
    
    return NextResponse.json({
      success: true,
      items,
      source: url,
      count: items.length,
    }, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to parse RSS feed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers }
    );
  }
}

// GET /api/zine/webhook - Get webhook logs
export async function GET_WEBHOOK() {
  try {
    await ensureDataDir();
    let logs = { events: [] };
    
    try {
      const data = await readFile(WEBHOOK_LOG_PATH, "utf-8");
      logs = JSON.parse(data);
    } catch {
      return NextResponse.json({ success: true, events: [], count: 0 });
    }

    return NextResponse.json({
      success: true,
      events: logs.events.slice(0, 50),
      count: logs.events.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read webhook logs' },
      { status: 500 }
    );
  }
}

// POST /api/zine/webhook - Handle incoming webhook events
export async function POST_WEBHOOK(request: NextRequest) {
  const clientId = request.headers.get('x-forwarded-for') || request.ip || 'unknown';
  const rateLimit = checkRateLimit(`webhook:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers }
    );
  }

  try {
    const body = await request.json();
    const { event, type, data, items, source } = body;

    // Validate webhook secret if configured
    const expectedSecret = process.env.ZINE_WEBHOOK_SECRET;
    const providedSecret = request.headers.get('x-webhook-secret');
    
    if (expectedSecret && providedSecret !== expectedSecret) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      );
    }

    // Log the event
    await ensureDataDir();
    let logs = { events: [] };
    try {
      const data = await readFile(WEBHOOK_LOG_PATH, "utf-8");
      logs = JSON.parse(data);
    } catch {
      // File doesn't exist
    }

    logs.events.unshift({
      event,
      type,
      data,
      items,
      source: source || 'webhook',
      timestamp: new Date().toISOString(),
    });

    logs.events = logs.events.slice(0, 100);
    await writeFile(WEBHOOK_LOG_PATH, JSON.stringify(logs, null, 2));

    // Return items if provided
    if (items && Array.isArray(items)) {
      return NextResponse.json({
        success: true,
        message: 'Webhook received',
        items,
        count: items.length,
      }, { headers });
    }

    // Create item from event data
    const newItem = {
      id: `webhook_${Date.now()}`,
      type: type || 'text',
      source: 'webhook',
      title: data?.title || event || 'Webhook Event',
      content: data?.content || JSON.stringify(data),
      media: data?.media,
      metadata: {
        webhookEvent: event,
        customData: data,
      },
      priority: data?.priority || 'normal',
      tags: data?.tags || [],
    };

    return NextResponse.json({
      success: true,
      message: 'Webhook received',
      items: [newItem],
      count: 1,
    }, { headers });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500, headers }
    );
  }
}

// GET /api/zine/integration/:provider - Fetch integration data
export async function GET_INTEGRATION(
  request: NextRequest,
  { params }: { params: { provider: string } }
) {
  const { provider } = params;
  const clientId = request.headers.get('x-forwarded-for') || request.ip || 'unknown';
  const rateLimit = checkRateLimit(`integration:${provider}:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers }
    );
  }

  // Mock integration data (in production, fetch from actual APIs)
  const mockData: Record<string, any[]> = {
    discord: [
      {
        id: 'discord_1',
        type: 'social',
        title: 'New Discord Message',
        content: 'Someone posted in #general',
        metadata: { platform: 'Discord', channel: 'general' },
      },
    ],
    twitter: [
      {
        id: 'twitter_1',
        type: 'social',
        title: 'New Tweet',
        content: 'Check out this amazing update!',
        metadata: { platform: 'Twitter', author: '@user' },
      },
    ],
    github: [
      {
        id: 'github_1',
        type: 'integration',
        title: 'New GitHub Activity',
        content: 'New commit pushed to main',
        metadata: { platform: 'GitHub', repo: 'user/repo' },
      },
    ],
    notion: [
      {
        id: 'notion_1',
        type: 'text',
        title: 'Notion Page Updated',
        content: 'A page was updated in your workspace',
        metadata: { platform: 'Notion' },
      },
    ],
  };

  const items = mockData[provider] || [];

  return NextResponse.json({
    success: true,
    items,
    provider,
    count: items.length,
  }, { headers });
}

// Main GET handler - route to appropriate handler
export async function GET(
  request: NextRequest,
  { params }: { params: { provider?: string } }
) {
  const pathname = request.nextUrl.pathname;

  if (pathname.includes('/rss')) {
    return GET_RSS(request);
  }

  if (pathname.includes('/webhook')) {
    return GET_WEBHOOK();
  }

  if (params?.provider) {
    return GET_INTEGRATION(request, { params });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// Main POST handler
export async function POST(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.includes('/webhook')) {
    return POST_WEBHOOK(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
