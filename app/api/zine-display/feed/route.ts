import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface FeedItem {
  id: string;
  content: string;
  type: string;
  source: string;
  author?: string;
  timestamp?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Mock Data Sources - in production these would call real APIs
// ---------------------------------------------------------------------

const MOCK_SOURCES: Record<string, { name: string; fetch: () => Promise<FeedItem[]> }> = {
  'github-trending': {
    name: 'GitHub Trending',
    fetch: async () => {
      // In production: fetch from GitHub API
      return [
        { id: 'gh-1', content: 'NEW: AI Code Assistant v3.0 released', type: 'heading', source: 'github-trending', timestamp: new Date().toISOString() },
        { id: 'gh-2', content: 'Rust exceeds 50k stars on main repo', type: 'text', source: 'github-trending', author: ' trending-bot', timestamp: new Date().toISOString() },
        { id: 'gh-3', content: '🚀 Hot: WebGPU adoption accelerates', type: 'announcement', source: 'github-trending', timestamp: new Date().toISOString() },
      ];
    },
  },
  'stock-ticker': {
    name: 'Stock Ticker',
    fetch: async () => {
      // Mock stock data - in production fetch from real API
      const stocks = [
        { symbol: 'AAPL', change: '+2.3%' },
        { symbol: 'GOOGL', change: '-0.8%' },
        { symbol: 'MSFT', change: '+1.5%' },
        { symbol: 'NVDA', change: '+4.2%' },
      ];
      const s = stocks[Math.floor(Math.random() * stocks.length)];
      return [
        { id: 'stk-1', content: `${s.symbol} ${s.change}`, type: 'data', source: 'stock-ticker', timestamp: new Date().toISOString() },
      ];
    },
  },
  'weather': {
    name: 'Weather Updates',
    fetch: async () => {
      const conditions = ['☀️ Sunny 72°F', '🌧️ Rain 58°F', '⛅ Cloudy 65°F', '❄️ Snow 28°F'];
      const c = conditions[Math.floor(Math.random() * conditions.length)];
      return [
        { id: 'wthr-1', content: c, type: 'data', source: 'weather', timestamp: new Date().toISOString() },
      ];
    },
  },
  'system-status': {
    name: 'System Status',
    fetch: async () => {
      const statuses = ['All systems operational', 'Minor latency in EU region', 'Deploying v2.1.0'];
      const s = statuses[Math.floor(Math.random() * statuses.length)];
      return [
        { id: 'sys-1', content: s, type: 'notification', source: 'system-status', timestamp: new Date().toISOString() },
      ];
    },
  },
  'dev-quotes': {
    name: 'Dev Quotes',
    fetch: async () => {
      const quotes = [
        '"Code is like humor. When you have to explain it, it\'s bad." — Cory House',
        '"First, solve the problem. Then, write the code." — John Johnson',
        '"Experience is the name everyone gives to their mistakes." — Oscar Wilde',
        '"The best error message is the one that never shows up." — Unknown',
      ];
      return [
        { id: 'q-1', content: quotes[Math.floor(Math.random() * quotes.length)], type: 'quote', source: 'dev-quotes', timestamp: new Date().toISOString() },
      ];
    },
  },
  'crypto-ticker': {
    name: 'Crypto Ticker',
    fetch: async () => {
      const coins = [
        { symbol: 'BTC', change: '+1.2%', price: '$43,250' },
        { symbol: 'ETH', change: '+0.8%', price: '$2,280' },
        { symbol: 'SOL', change: '-2.1%', price: '$98' },
      ];
      const c = coins[Math.floor(Math.random() * coins.length)];
      return [
        { id: 'cry-1', content: `${c.symbol}: ${c.price} (${c.change})`, type: 'data', source: 'crypto-ticker', timestamp: new Date().toISOString() },
      ];
    },
  },
  'reddit-hot': {
    name: 'Reddit Hot',
    fetch: async () => {
      const posts = [
        '🔥 Why I switched from React to Vue (and back)',
        '📊 The state of TypeScript in 2024',
        '⚡ 10 CSS tricks that will blow your mind',
        '🧠 How AI is changing software development',
      ];
      return [
        { id: 'rd-1', content: posts[Math.floor(Math.random() * posts.length)], type: 'heading', source: 'reddit-hot', timestamp: new Date().toISOString() },
      ];
    },
  },
  'news-wire': {
    name: 'News Wire',
    fetch: async () => {
      const headlines = [
        'BREAKING: Major tech company announces AI partnership',
        'UPDATE: New security vulnerability discovered in popular library',
        'RELEASE: Beta program now open for next-gen IDE',
        'RUMOR: Speculation about new framework announcement',
      ];
      return [
        { id: 'nw-1', content: headlines[Math.floor(Math.random() * headlines.length)], type: 'announcement', source: 'news-wire', timestamp: new Date().toISOString() },
      ];
    },
  },
};

// ---------------------------------------------------------------------
// Available sources list
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const source = searchParams.get('source');

  // List available sources
  if (action === 'list') {
    return NextResponse.json({
      success: true,
      sources: Object.entries(MOCK_SOURCES).map(([id, { name }]) => ({
        id,
        name,
      })),
      count: Object.keys(MOCK_SOURCES).length,
    });
  }

  // Fetch from specific source
  if (source && action === 'fetch') {
    const fetcher = MOCK_SOURCES[source];
    if (!fetcher) {
      return NextResponse.json(
        { success: false, error: `Unknown source: ${source}. Available: ${Object.keys(MOCK_SOURCES).join(', ')}` },
        { status: 400 }
      );
    }

    try {
      const items = await fetcher.fetch();
      return NextResponse.json({
        success: true,
        source,
        items,
        count: items.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[Zine-Feed] Error fetching ${source}:`, error);
      return NextResponse.json(
        { success: false, error: `Failed to fetch from ${source}` },
        { status: 500 }
      );
    }
  }

  // Default: return all sources info
  return NextResponse.json({
    service: 'Zine Display Feed',
    version: '1.0.0',
    endpoints: {
      'GET /?action=list': 'List all available feed sources',
      'GET /?action=fetch&source={id}': 'Fetch items from a specific source',
    },
    availableSources: Object.keys(MOCK_SOURCES),
  });
}

// ---------------------------------------------------------------------
// POST handler - add custom feed sources
// ---------------------------------------------------------------------

const feedConfigSchema = z.object({
  name: z.string().min(1).max(50),
  url: z.string().url(),
  type: z.enum(['rss', 'json', 'api']).default('json'),
  pollIntervalMs: z.number().min(10000).max(3600000).default(60000),
  transform: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Register a new feed source
    if (action === 'register') {
      const config = feedConfigSchema.parse(body);
      
      // In production, this would save to a database
      // For now, just acknowledge the registration
      return NextResponse.json({
        success: true,
        message: `Feed source "${config.name}" registered`,
        config: {
          ...config,
          id: btoa(config.url).substring(0, 20),
          enabled: true,
        },
      });
    }

    // Custom fetch (proxy to external URL)
    if (action === 'fetch-url') {
      const { url } = body;
      if (!url) {
        return NextResponse.json(
          { success: false, error: 'URL is required' },
          { status: 400 }
        );
      }

      let response: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        response = await fetch(url, {
          headers: {
            'User-Agent': 'ZineDisplay/1.0',
            'Accept': 'application/json, text/plain, application/xml',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);
      } catch (error) {
        console.error('[Zine-Fetch] Network error:', error);
        return NextResponse.json(
          { success: false, error: 'Failed to connect to URL' },
          { status: 502 }
        );
      }

      try {
        const contentType = response.headers.get('content-type') || '';
        let content: string;

        if (contentType.includes('application/json')) {
          const json = await response.json();
          content = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
        } else if (contentType.includes('xml') || contentType.includes('rss')) {
          content = await response.text();
        } else {
          content = await response.text();
        }

        return NextResponse.json({
          success: true,
          content: content.slice(0, 5000),
          contentType,
          url,
        });
      } catch (parseError) {
        console.error('[Zine-Fetch] Parse error:', parseError);
        return NextResponse.json(
          { success: false, error: 'Failed to parse response from URL' },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action. Use action=list, fetch, register, or fetch-url' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Zine-Feed] Error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}