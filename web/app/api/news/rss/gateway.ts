import { NextRequest, NextResponse } from 'next/server';


import { z } from 'zod';

// RSS Feed URLs for different sources
const RSS_FEEDS = {
  hn: 'https://hnrss.org/frontpage',
  hnnew: 'https://hnrss.org/newest',
  hnshow: 'https://hnrss.org/show',
  hnask: 'https://hnrss.org/ask',
  techcrunch: 'https://techcrunch.com/feed/',
 ars: 'https://feeds.arstechnica.com/arstechnica/index',
 verge: 'https://www.theverge.com/rss/index.xml',
 wired: 'https://www.wired.com/feed/rss',
 bbc: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
 reuters: 'https://www.reutersagency.com/feed/?best-topics=tech',
};

// Simple XML parser for RSS feeds
function parseRSS(xml: string): any[] {
  const items: any[] = [];
  
  try {
    // Extract item elements
    const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
    
    for (const itemXml of itemMatches.slice(0, 30)) {
      const item: any = {};
      
      // Extract title
      const titleMatch = itemXml.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/i);
      item.title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      
      // Extract link
      const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      item.url = linkMatch ? linkMatch[1].trim() : '';
      
      // Extract description
      const descMatch = itemXml.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/i);
      item.description = descMatch ? (descMatch[1] || descMatch[2] || '').trim() : '';
      // Strip HTML tags from description
      item.description = item.description.replace(/<[^>]+>/g, '').substring(0, 200);
      
      // Extract pubDate
      const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
      if (pubDateMatch) {
        item.publishedAt = new Date(pubDateMatch[1].trim()).getTime();
      }
      
      // Extract enclosure (image)
      const enclosureMatch = itemXml.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]*)"/i) ||
                           itemXml.match(/<media:content[^>]*url="([^"]*)"[^>]*type="image/i) ||
                           itemXml.match(/<media:thumbnail[^>]*url="([^"]*)"/i);
      if (enclosureMatch) {
        item.imageUrl = enclosureMatch[1];
      }
      
      // Try to extract image from content
      if (!item.imageUrl) {
        const contentMatch = itemXml.match(/<content:encoded[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>|<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
        if (contentMatch) {
          const content = contentMatch[1] || contentMatch[2] || '';
          const imgMatch = content.match(/<img[^>]*src="([^"]*)"/i);
          if (imgMatch) {
            item.imageUrl = imgMatch[1];
          }
        }
      }
      
      // Extract author
      const authorMatch = itemXml.match(/<author[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/author>|<author[^>]*>([\s\S]*?)<\/author>/i) ||
                         itemXml.match(/<dc:creator[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/dc:creator>|<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
      item.author = authorMatch ? (authorMatch[1] || authorMatch[2] || '').trim() : 'Unknown';
      
      // Extract categories
      const categoryMatches = itemXml.match(/<category[^>]*>([\s\S]*?)<\/category>/gi) || [];
      item.categories = categoryMatches.map(c => c.replace(/<[^>]+>/g, '').trim()).slice(0, 3);
      
      // Generate ID from URL
      item.id = item.url ? btoa(item.url).substring(0, 20) : `item-${Date.now()}-${Math.random()}`;
      
      if (item.title && item.url) {
        items.push(item);
      }
    }
  } catch (error) {
    console.error('[RSS] Parse error:', error);
  }
  
  return items;
}

// Fetch RSS feed from URL
async function fetchRSS(feedUrl: string): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'binG-News-Panel/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const xml = await response.text();
    return parseRSS(xml);
  } catch (error) {
    console.error('[RSS] Fetch error:', error);
    return [];
  }
}

// GET handler - fetch RSS feeds
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const source = searchParams.get('source') || 'hn';
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
  
  // Validate source
  const feedUrl = RSS_FEEDS[source as keyof typeof RSS_FEEDS];
  if (!feedUrl) {
    // Check if it's a custom URL
    const customUrl = searchParams.get('url');
    if (customUrl) {
      const articles = await fetchRSS(customUrl);
      return NextResponse.json({
        success: true,
        source,
        articles: articles.slice(0, limit),
      });
    }
    
    return NextResponse.json(
      { success: false, error: `Unknown source: ${source}. Available: ${Object.keys(RSS_FEEDS).join(', ')}` },
      { status: 400 }
    );
  }
  
  const articles = await fetchRSS(feedUrl);
  
  return NextResponse.json({
    success: true,
    source,
    feedUrl,
    articles: articles.slice(0, limit),
    count: articles.length,
  });
}

// POST handler - add custom RSS feed
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const schema = z.object({
      name: z.string().min(1).max(50),
      url: z.string().url(),
      category: z.string().optional(),
    });
    
    const { name, url, category } = schema.parse(body);
    
    // Validate RSS feed is accessible
    const testArticles = await fetchRSS(url);
    if (testArticles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Unable to fetch RSS feed from provided URL' },
        { status: 400 }
      );
    }
    
    // In production, this would save to database
    // For now, return the feed info
    return NextResponse.json({
      success: true,
      feed: {
        id: btoa(url).substring(0, 20),
        name,
        url,
        category: category || 'custom',
        articles: testArticles.slice(0, 5),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: 'Failed to add custom feed' },
      { status: 500 }
    );
  }
}
