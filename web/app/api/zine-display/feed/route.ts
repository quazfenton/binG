import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sanitizeUrlInput } from '@/lib/utils/sanitize';

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

// Expanded data sources with more variety
const MOCK_SOURCES: Record<string, { name: string; fetch: () => Promise<FeedItem[]>; description?: string; category?: string }> = {
  // Existing sources...
  'github-trending': {
    name: 'GitHub Trending',
    description: 'Trending repositories on GitHub',
    category: 'tech',
    fetch: async () => {
      return [
        { id: 'gh-1', content: 'NEW: AI Code Assistant v3.0 released', type: 'heading', source: 'github-trending', timestamp: new Date().toISOString() },
        { id: 'gh-2', content: 'Rust exceeds 50k stars on main repo', type: 'text', source: 'github-trending', author: 'trending-bot', timestamp: new Date().toISOString() },
        { id: 'gh-3', content: '🚀 Hot: WebGPU adoption accelerates', type: 'announcement', source: 'github-trending', timestamp: new Date().toISOString() },
      ];
    },
  },
  'stock-ticker': {
    name: 'Stock Ticker',
    description: 'Real-time stock market data',
    category: 'finance',
    fetch: async () => {
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
    description: 'Current weather conditions',
    category: 'lifestyle',
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
    description: 'Application and service health',
    category: 'monitoring',
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
    description: 'Programming wisdom and quotes',
    category: 'inspiration',
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
    description: 'Cryptocurrency price updates',
    category: 'finance',
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
    description: 'Hot posts from Reddit',
    category: 'social',
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
    description: 'Tech news and updates',
    category: 'news',
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
  // NEW SOURCES
  'dev-to-feed': {
    name: 'DEV.to Feed',
    description: 'Latest articles from DEV community',
    category: 'tech',
    fetch: async () => {
      const articles = [
        'The Ultimate Guide to TypeScript 5.4',
        'Building Scalable React Applications in 2024',
        'Why I switched from REST to GraphQL',
        'CSS Container Queries: A Complete Guide',
      ];
      return [
        { id: 'dev-1', content: articles[Math.floor(Math.random() * articles.length)], type: 'heading', source: 'dev-to-feed', author: '@devcommunity', timestamp: new Date().toISOString() },
      ];
    },
  },
  'product-hunt': {
    name: 'Product Hunt',
    description: 'Trending products and tools',
    category: 'discover',
    fetch: async () => {
      const products = [
        '🆕 AI Code Reviewer - Automated code reviews',
        '🎨 Design OS - All-in-one design workspace',
        '📊 DataLens - Visual analytics platform',
        '🔒 SecureVault - Password manager for teams',
      ];
      return [
        { id: 'ph-1', content: products[Math.floor(Math.random() * products.length)], type: 'announcement', source: 'product-hunt', timestamp: new Date().toISOString() },
      ];
    },
  },
  'hacker-news': {
    name: 'Hacker News',
    description: 'Top stories from Hacker News',
    category: 'tech',
    fetch: async () => {
      const stories = [
        'Show HN: I built a CLI tool that writes code for you',
        'Ask HN: What\'s your favorite programming book?',
        'The hidden costs of technical debt',
        'How we scaled our startup to 1M users',
      ];
      return [
        { id: 'hn-1', content: stories[Math.floor(Math.random() * stories.length)], type: 'heading', source: 'hacker-news', timestamp: new Date().toISOString() },
      ];
    },
  },
  'youtube-trending': {
    name: 'YouTube Trending',
    description: 'Trending tech videos',
    category: 'media',
    fetch: async () => {
      const videos = [
        '📺 Building an AI Agent from Scratch - Full Tutorial',
        '📺 React 19 Features Explained',
        '📺 Vim Masterclass - Advanced Tips',
        '📺 System Design Interview Prep',
      ];
      return [
        { id: 'yt-1', content: videos[Math.floor(Math.random() * videos.length)], type: 'heading', source: 'youtube-trending', timestamp: new Date().toISOString() },
      ];
    },
  },
  'twitch-streams': {
    name: 'Twitch Streams',
    description: 'Live coding streams',
    category: 'media',
    fetch: async () => {
      const streams = [
        '🔴 Live: Building a full-stack app with AI',
        '🔴 Live: Debugging production issues',
        '🔴 Live: Code review session',
        '🔴 Live: Learning Rust together',
      ];
      return [
        { id: 'tw-1', content: streams[Math.floor(Math.random() * streams.length)], type: 'announcement', source: 'twitch-streams', timestamp: new Date().toISOString() },
      ];
    },
  },
  'npm-registry': {
    name: 'NPM Registry',
    description: 'Trending npm packages',
    category: 'devtools',
    fetch: async () => {
      const packages = [
        '📦 new: @ai-sdk/openai v3.0 - GPT-4o support',
        '📦 update: next@14.2 - Server Actions stable',
        '📦 trending: zustand@5 - State management',
        '📦 deprecated: redux - Consider RTK Query',
      ];
      return [
        { id: 'npm-1', content: packages[Math.floor(Math.random() * packages.length)], type: 'data', source: 'npm-registry', timestamp: new Date().toISOString() },
      ];
    },
  },
  'docker-hub': {
    name: 'Docker Hub',
    description: 'Popular Docker images',
    category: 'devtools',
    fetch: async () => {
      const images = [
        '🐳 node:20-alpine - 50M+ pulls this week',
        '🐳 nginx:1.25 - Latest stable',
        '🐳 postgres:16 - New features',
        '🐳 redis:7 - Redis Stack available',
      ];
      return [
        { id: 'docker-1', content: images[Math.floor(Math.random() * images.length)], type: 'data', source: 'docker-hub', timestamp: new Date().toISOString() },
      ];
    },
  },
  'stack-overflow': {
    name: 'Stack Overflow',
    description: 'Top questions and answers',
    category: 'qna',
    fetch: async () => {
      const questions = [
        'Q: How to optimize React re-renders? - 500+ upvotes',
        'Q: Best practices for TypeScript configs - 300+ upvotes',
        'Q: Why is my Docker container slow? - 200+ upvotes',
        'Q: Understanding async/await in loops - 400+ upvotes',
      ];
      return [
        { id: 'so-1', content: questions[Math.floor(Math.random() * questions.length)], type: 'heading', source: 'stack-overflow', timestamp: new Date().toISOString() },
      ];
    },
  },
  'aws-status': {
    name: 'AWS Status',
    description: 'AWS service health dashboard',
    category: 'monitoring',
    fetch: async () => {
      const services = [
        '✅ us-east-1: All services operational',
        '✅ eu-west-1: All services operational',
        '⚠️ ap-southeast-1: Elevated error rates in Lambda',
        '✅ All regions operational',
      ];
      return [
        { id: 'aws-1', content: services[Math.floor(Math.random() * services.length)], type: 'notification', source: 'aws-status', timestamp: new Date().toISOString() },
      ];
    },
  },
  'calendar-events': {
    name: 'Calendar Events',
    description: 'Upcoming events and meetings',
    category: 'productivity',
    fetch: async () => {
      const events = [
        '📅 Team Standup - 10:00 AM',
        '📅 Sprint Planning - 2:00 PM',
        '📅 Code Review - 4:00 PM',
        '📅 1:1 with Manager - 3:00 PM',
      ];
      return [
        { id: 'cal-1', content: events[Math.floor(Math.random() * events.length)], type: 'notification', source: 'calendar-events', timestamp: new Date().toISOString() },
      ];
    },
  },
  'twitter-tech': {
    name: 'Tech Twitter',
    description: 'Tech influencer updates',
    category: 'social',
    fetch: async () => {
      const tweets = [
        '🐦 @typescript: TypeScript 5.4 is out! Check out the new features...',
        '🐦 @reactjs: We\'re working on something exciting. Stay tuned...',
        '🐦 @vercel: Next.js 15 beta is now available for testing...',
        '🐦 @rustlang: Rust 2024 edition RFC is open for feedback...',
      ];
      return [
        { id: 'twt-1', content: tweets[Math.floor(Math.random() * tweets.length)], type: 'text', source: 'twitter-tech', author: '@tech influencer', timestamp: new Date().toISOString() },
      ];
    },
  },
  'server-metrics': {
    name: 'Server Metrics',
    description: 'Real-time server performance',
    category: 'monitoring',
    fetch: async () => {
      const metrics = [
        '📊 CPU: 45% | Memory: 62% | Disk: 78%',
        '📊 Requests: 1.2k/min | Latency: 45ms',
        '📊 Error rate: 0.1% | Uptime: 99.99%',
        '📊 Active connections: 847 | Queue: 12',
      ];
      return [
        { id: 'metrics-1', content: metrics[Math.floor(Math.random() * metrics.length)], type: 'data', source: 'server-metrics', timestamp: new Date().toISOString() },
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

      // Sanitize URL input to handle edge cases like null bytes and unusual encoding
      let sanitizedUrl: string;
      try {
        sanitizedUrl = sanitizeUrlInput(url);
      } catch (sanitizeError: any) {
        console.error('[Zine-Feed] URL sanitization failed:', sanitizeError.message);
        return NextResponse.json(
          { success: false, error: sanitizeError.message || 'URL sanitization failed' },
          { status: 400 }
        );
      }

      let response: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        response = await fetch(sanitizedUrl, {
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
