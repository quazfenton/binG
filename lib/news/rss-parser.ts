/**
 * RSS Feed Parser (Node.js Compatible)
 *
 * Fetches and parses RSS/Atom feeds from various sources
 * Uses regex-based parsing for Node.js compatibility (no DOMParser)
 * Returns unified article format
 */

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source?: string;
  category?: string;
  publishedAt: Date;
  imageUrl?: string;
  author?: string;
}

/**
 * Parse RSS feed from URL
 */
export async function parseRSSFeed(url: string): Promise<NewsArticle[]> {
  try {
    // Fetch RSS feed directly (server-side, no CORS issues)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; binG RSS Parser/1.0)',
        'Accept': 'application/rss+xml,application/xml,text/xml',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch RSS: ${response.status}`);
    }

    const xml = await response.text();
    return parseRSSContent(xml);
  } catch (error: any) {
    console.error(`[RSS Parser] Failed to parse ${url}:`, error.message);
    return [];
  }
}

/**
 * Parse RSS/Atom XML content using regex (Node.js compatible)
 */
function parseRSSContent(xml: string): NewsArticle[] {
  const articles: NewsArticle[] = [];

  try {
    // Extract items (RSS 2.0) or entries (Atom)
    const itemMatches = xml.match(/<(?:item|entry)[^>]*>[\s\S]*?<\/(?:item|entry)>/gi) || [];

    for (let i = 0; i < itemMatches.length && i < 30; i++) {
      try {
        const itemXml = itemMatches[i];
        
        // Extract title
        const titleMatch = itemXml.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';

        // Extract link/URL
        const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
        const url = linkMatch ? linkMatch[1].trim() : '';

        // Skip if no title or URL
        if (!title || !url) continue;

        // Extract description/summary
        const descMatch = itemXml.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>|<summary[^>]*>([\s\S]*?)<\/summary>/i);
        let summary = descMatch ? (descMatch[1] || descMatch[2] || descMatch[3] || '').trim() : '';
        summary = summary.replace(/<[^>]+>/g, '').substring(0, 500);

        // Extract publication date
        let publishedAt = new Date();
        const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>|<published[^>]*>([\s\S]*?)<\/published>|<updated[^>]*>([\s\S]*?)<\/updated>/i);
        if (pubDateMatch) {
          const dateStr = pubDateMatch[1] || pubDateMatch[2] || pubDateMatch[3] || '';
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            publishedAt = date;
          }
        }

        // Extract image URL
        let imageUrl: string | undefined;
        const enclosureMatch = itemXml.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]*)"/i) ||
                             itemXml.match(/<media:content[^>]*url="([^"]*)"[^>]*type="image/i) ||
                             itemXml.match(/<media:thumbnail[^>]*url="([^"]*)"/i);
        if (enclosureMatch) {
          imageUrl = enclosureMatch[1];
        }

        // Try to extract image from description
        if (!imageUrl) {
          const imgMatch = summary.match(/<img[^>]*src="([^"]*)"/i);
          if (imgMatch) {
            imageUrl = imgMatch[1];
          }
        }

        // Extract author
        let author: string | undefined;
        const authorMatch = itemXml.match(/<author[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/author>|<author[^>]*>([\s\S]*?)<\/author>|<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
        if (authorMatch) {
          author = (authorMatch[1] || authorMatch[2] || authorMatch[3] || '').trim() || undefined;
        }

        articles.push({
          id: `news-${Date.now()}-${i}`,
          title,
          summary,
          url,
          publishedAt,
          imageUrl,
          author,
        });
      } catch (itemError) {
        console.warn('[RSS Parser] Failed to parse item:', itemError);
        continue;
      }
    }
  } catch (error) {
    console.error('[RSS Parser] Parse error:', error);
  }

  return articles;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}
