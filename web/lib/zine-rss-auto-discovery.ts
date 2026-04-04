/**
 * RSS Auto-Discovery Module
 * 
 * Provides:
 * - HTML page RSS/Atom auto-detection from <link> tags
 * - Common platform RSS detection (Twitter, YouTube, GitHub, etc.)
 * - URL feed discovery via web scraping
 * - Feed validation and parsing
 * - Category detection for sources
 */

import { z } from 'zod';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export interface DiscoveredFeed {
  url: string;
  type: 'rss' | 'atom';
  title: string;
  description?: string;
  categories: string[];
  platform?: string;
  reliability: 'high' | 'medium' | 'low';
}

export interface FeedValidation {
  valid: boolean;
  itemCount: number;
  error?: string;
}

export interface RSSDiscoveryOptions {
  timeout?: number;
  maxFeeds?: number;
  validateFeeds?: boolean;
}

// Known RSS feed URLs for common platforms
const PLATFORM_FEEDS: Record<string, { url: string; type: 'rss' | 'atom'; categories: string[]; platform: string }[]> = {
  // Tech news
  'techcrunch.com': [
    { url: 'https://techcrunch.com/feed/', type: 'rss', categories: ['tech', 'news', 'startups'], platform: 'TechCrunch' },
  ],
  'theverge.com': [
    { url: 'https://www.theverge.com/rss/index.xml', type: 'atom', categories: ['tech', 'news'], platform: 'The Verge' },
  ],
  'wired.com': [
    { url: 'https://www.wired.com/feed/rss', type: 'rss', categories: ['tech', 'science'], platform: 'Wired' },
  ],
  'ars technica': [
    { url: 'https://feeds.arstechnica.com/arstechnica/index', type: 'rss', categories: ['tech', 'science'], platform: 'Ars Technica' },
  ],
  'bbc.com': [
    { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', type: 'rss', categories: ['tech', 'news'], platform: 'BBC' },
  ],
  
  // Developer platforms
  'github.com': [
    { url: 'https://github.com/blog.atom', type: 'atom', categories: ['dev', 'code'], platform: 'GitHub' },
    { url: 'https://github.com/engineering.atom', type: 'atom', categories: ['dev', 'engineering'], platform: 'GitHub Engineering' },
  ],
  'dev.to': [
    { url: 'https://dev.to/feed', type: 'rss', categories: ['dev', 'tutorial'], platform: 'DEV.to' },
  ],
  'medium.com': [
    { url: 'https://medium.com/feed', type: 'atom', categories: ['blog', 'tech'], platform: 'Medium' },
  ],
  
  // Social/Community
  'reddit.com': [
    { url: 'https://www.reddit.com/r/programming/.rss', type: 'rss', categories: ['dev', 'community'], platform: 'Reddit Programming' },
    { url: 'https://www.reddit.com/r/javascript/.rss', type: 'rss', categories: ['dev', 'javascript'], platform: 'Reddit JavaScript' },
  ],
  'hacker news': [
    { url: 'https://hnrss.org/frontpage', type: 'rss', categories: ['tech', 'news'], platform: 'Hacker News' },
    { url: 'https://hnrss.org/newest', type: 'rss', categories: ['tech'], platform: 'Hacker News' },
  ],
  'youtube.com': [
    { url: '', type: 'rss', categories: ['video', 'tech'], platform: 'YouTube' }, // Requires channel ID
  ],
  'twitter.com': [
    { url: '', type: 'rss', categories: ['social', 'tech'], platform: 'Twitter' }, // Deprecated
  ],
  
  // Productivity
  'product hunt': [
    { url: 'https://www.producthunt.com/feed', type: 'rss', categories: ['productivity', 'discover'], platform: 'Product Hunt' },
  ],
  'indie hacker': [
    { url: 'https://www.indiehackers.com/feed', type: 'rss', categories: ['startup', 'business'], platform: 'Indie Hackers' },
  ],
  
  // Security
  'krebsonsecurity': [
    { url: 'https://krebsonsecurity.com/feed/', type: 'rss', categories: ['security'], platform: 'Krebs on Security' },
  ],
  'threatpost': [
    { url: 'https://threatpost.com/feed/', type: 'rss', categories: ['security'], platform: 'Threatpost' },
  ],
};

// ---------------------------------------------------------------------
// Link tag regex patterns for RSS/Atom discovery
// ---------------------------------------------------------------------

const RSS_LINK_PATTERN = /<link[^>]*type="application\/rss\+xml"[^>]*href="([^"]+)"[^>]*>/gi;
const ATOM_LINK_PATTERN = /<link[^>]*type="application\/atom\+xml"[^>]*href="([^"]+)"[^>]*>/gi;
const ANY_LINK_PATTERN = /<link[^>]*(?:type="application\/(?:rss|atom)\+xml")[^>]*href="([^"]+)"[^>]*>/gi;

// ---------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------

export async function discoverFeedsFromUrl(
  url: string,
  options: RSSDiscoveryOptions = {}
): Promise<DiscoveredFeed[]> {
  const { timeout = 10000, maxFeeds = 10, validateFeeds = true } = options;
  const discovered: DiscoveredFeed[] = [];

  try {
    // First check known platform feeds
    const platformFeeds = checkKnownPlatforms(url);
    if (platformFeeds.length > 0) {
      discovered.push(...platformFeeds.slice(0, maxFeeds));
      if (!validateFeeds) return discovered;
    }

    // Fetch the page and look for RSS links
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'binG-Zine-Discovery/1.0',
        'Accept': 'text/html, application/xhtml+xml',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract RSS feeds
    const rssMatches = html.matchAll(RSS_LINK_PATTERN);
    for (const match of rssMatches) {
      const feedUrl = normalizeUrl(match[1], url);
      const title = extractTitle(html, feedUrl) || 'RSS Feed';
      discovered.push({
        url: feedUrl,
        type: 'rss',
        title,
        categories: detectCategories(url, title),
        platform: detectPlatform(feedUrl),
        reliability: 'high',
      });
    }

    // Extract Atom feeds
    const atomMatches = html.matchAll(ATOM_LINK_PATTERN);
    for (const match of atomMatches) {
      const feedUrl = normalizeUrl(match[1], url);
      const title = extractTitle(html, feedUrl) || 'Atom Feed';
      discovered.push({
        url: feedUrl,
        type: 'atom',
        title,
        categories: detectCategories(url, title),
        platform: detectPlatform(feedUrl),
        reliability: 'high',
      });
    }

    // Deduplicate by URL
    const uniqueFeeds = Array.from(
      new Map(discovered.map(f => [f.url, f])).values()
    );

    return uniqueFeeds.slice(0, maxFeeds);

  } catch (error) {
    console.error('[RSS-Discovery] Error discovering feeds:', error);
    return discovered;
  }
}

// ---------------------------------------------------------------------
// Check known platform feeds
// ---------------------------------------------------------------------

function checkKnownPlatforms(url: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  const lowerUrl = url.toLowerCase();

  for (const [platform, platformFeeds] of Object.entries(PLATFORM_FEEDS)) {
    if (lowerUrl.includes(platform.toLowerCase())) {
      for (const feed of platformFeeds) {
        if (feed.url) { // Some platforms need additional config
          feeds.push({
            url: feed.url,
            type: feed.type,
            title: feed.platform,
            categories: feed.categories,
            platform: feed.platform,
            reliability: 'high',
          });
        } else {
          // Platform known but needs more info
          feeds.push({
            url: url, // Use original URL as placeholder
            type: 'rss',
            title: `${feed.platform} (requires configuration)`,
            categories: feed.categories,
            platform: feed.platform,
            reliability: 'medium',
          });
        }
      }
    }
  }

  return feeds;
}

// ---------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------

function normalizeUrl(feedUrl: string, baseUrl: string): string {
  // Already absolute
  if (feedUrl.startsWith('http://') || feedUrl.startsWith('https://')) {
    return feedUrl;
  }

  // Protocol-relative
  if (feedUrl.startsWith('//')) {
    return 'https:' + feedUrl;
  }

  // Relative URL
  try {
    const base = new URL(baseUrl);
    return new URL(feedUrl, base.origin).href;
  } catch {
    return feedUrl;
  }
}

// ---------------------------------------------------------------------
// Extract feed/channel title from HTML
// ---------------------------------------------------------------------

function extractTitle(html: string, feedUrl: string): string | null {
  // Try to find title in <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1].trim());
  }

  // Try Open Graph title
  const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  if (ogTitleMatch) {
    return decodeHtmlEntities(ogTitleMatch[1]);
  }

  return null;
}

// ---------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  return text.replace(/&[#\w]+;/g, entity => entities[entity] || entity);
}

// ---------------------------------------------------------------------
// Detect categories from URL/title
// ---------------------------------------------------------------------

function detectCategories(url: string, title: string): string[] {
  const categories: string[] = [];
  const combined = (url + ' ' + title).toLowerCase();

  const categoryMap: Record<string, string[]> = {
    'tech': ['technology', 'tech', ' gadget', 'software'],
    'news': ['news', 'breaking', 'report'],
    'dev': ['dev', 'developer', 'code', 'programming', 'software'],
    'science': ['science', 'research', 'study'],
    'security': ['security', 'cyber', 'hack', 'vulnerability'],
    'video': ['video', 'youtube', 'tube', 'watch'],
    'business': ['business', 'startup', 'entrepreneur', 'vc'],
    'design': ['design', 'ui', 'ux', 'creative'],
    'ai': ['ai', 'machine learning', 'ml', 'deep learning', 'gpt'],
    'crypto': ['crypto', 'bitcoin', 'blockchain', 'web3'],
  };

  for (const [category, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(kw => combined.includes(kw))) {
      categories.push(category);
    }
  }

  return categories.length > 0 ? categories : ['general'];
}

// ---------------------------------------------------------------------
// Detect platform from URL
// ---------------------------------------------------------------------

function detectPlatform(url: string): string | undefined {
  const platformPatterns: Record<string, RegExp> = {
    'Hacker News': /hnrss|news\.ycombinator/i,
    'Reddit': /reddit\.com/i,
    'DEV.to': /dev\.to/i,
    'GitHub': /github\.com.*blog|github\.com.*engineering/i,
    'YouTube': /youtube\.com/i,
    'Medium': /medium\.com/i,
    'Product Hunt': /producthunt/i,
    'TechCrunch': /techcrunch/i,
    'The Verge': /theverge/i,
    'Wired': /wired\.com/i,
    'Ars Technica': /arstechnica/i,
  };

  for (const [platform, pattern] of Object.entries(platformPatterns)) {
    if (pattern.test(url)) {
      return platform;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------
// Validate feed (basic check)
// ---------------------------------------------------------------------

export async function validateFeed(url: string): Promise<FeedValidation> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'binG-Zine-Validation/1.0',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { valid: false, itemCount: 0, error: `HTTP ${response.status}` };
    }

    const xml = await response.text();

    // Basic validation: check for item/channel elements
    const hasItems = /<item[^>]*>/i.test(xml) || /<entry[^>]*>/i.test(xml);
    const hasChannel = /<channel[^>]*>/i.test(xml) || /<feed[^>]*>/i.test(xml);

    if (!hasChannel) {
      return { valid: false, itemCount: 0, error: 'No channel/feed element found' };
    }

    // Count items
    const itemMatches = xml.match(/<(item|entry)[^>]*>/gi) || [];

    return {
      valid: hasItems || true, // Even without items, feed structure is valid
      itemCount: itemMatches.length,
    };

  } catch (error) {
    return {
      valid: false,
      itemCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------
// Quick discovery - check single URL for RSS
// ---------------------------------------------------------------------

export async function discoverSingleFeed(url: string): Promise<DiscoveredFeed | null> {
  const feeds = await discoverFeedsFromUrl(url, { maxFeeds: 1 });
  return feeds[0] || null;
}

// ---------------------------------------------------------------------
// Batch discovery for multiple URLs
// ---------------------------------------------------------------------

export async function discoverMultipleFeeds(
  urls: string[],
  options: RSSDiscoveryOptions = {}
): Promise<Map<string, DiscoveredFeed[]>> {
  const results = new Map<string, DiscoveredFeed[]>();

  // Process in parallel with limit
  const batchSize = 5;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const promises = batch.map(async (url) => {
      const feeds = await discoverFeedsFromUrl(url, options);
      return [url, feeds] as [string, DiscoveredFeed[]];
    });

    const batchResults = await Promise.all(promises);
    for (const [url, feeds] of batchResults) {
      results.set(url, feeds);
    }
  }

  return results;
}

// ---------------------------------------------------------------------
// Schema for validation
// ---------------------------------------------------------------------

export const feedConfigSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(50).optional(),
  category: z.string().optional(),
  pollIntervalMs: z.number().min(10000).max(3600000).default(60000),
});

export type FeedConfig = z.infer<typeof feedConfigSchema>;
