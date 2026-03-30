/**
 * RSS Feed Parser
 *
 * Fetches and parses RSS/Atom feeds from various sources
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
 * Parse RSS/Atom XML content
 */
function parseRSSContent(xml: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  
  // Parse XML
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xml, 'text/xml');
  
  // Try RSS 2.0 format (<item>)
  const items = xmlDoc.querySelectorAll('item');
  
  // Try Atom format (<entry>)
  const entries = xmlDoc.querySelectorAll('entry');
  
  const nodes = items.length > 0 ? items : entries;
  
  nodes.forEach((node, index) => {
    try {
      const article: NewsArticle = {
        id: `news-${Date.now()}-${index}`,
        title: extractText(node, 'title'),
        summary: extractText(node, 'description') || 
                 extractText(node, 'summary') || 
                 extractText(node, 'content', 'encoded') ||
                 '',
        url: extractText(node, 'link') || 
             extractAttr(node, 'link', 'href') ||
             '',
        publishedAt: extractDate(node),
        imageUrl: extractImageUrl(node),
        author: extractAuthor(node),
      };

      // Only add if we have minimum required data
      if (article.title && article.url) {
        articles.push(article);
      }
    } catch (error) {
      console.error('[RSS Parser] Failed to parse item:', error);
    }
  });

  return articles;
}

/**
 * Extract text from XML node
 */
function extractText(
  node: Element, 
  tagName: string, 
  namespace?: string
): string {
  let element: Element | null;
  
  if (namespace) {
    // Try with namespace (e.g., content:encoded)
    element = node.querySelector(`${namespace}:${tagName}`);
  }
  
  if (!element) {
    element = node.querySelector(tagName);
  }
  
  return element?.textContent?.trim() || '';
}

/**
 * Extract author from XML node
 */
function extractAuthor(node: Element): string {
  // Try dc:creator
  const dcCreator = node.querySelector('dc\\:creator');
  if (dcCreator?.textContent) {
    return dcCreator.textContent.trim();
  }
  
  // Try author/name (Atom)
  const authorName = node.querySelector('author > name');
  if (authorName?.textContent) {
    return authorName.textContent.trim();
  }
  
  // Try creator (RSS)
  const creator = node.querySelector('creator');
  if (creator?.textContent) {
    return creator.textContent.trim();
  }
  
  return '';
}

/**
 * Extract attribute from XML node
 */
function extractAttr(
  node: Element, 
  tagName: string, 
  attrName: string
): string {
  const element = node.querySelector(tagName);
  return element?.getAttribute(attrName) || '';
}

/**
 * Extract publication date
 */
function extractDate(node: Element): Date {
  // Try various date fields
  const dateStrings = [
    extractText(node, 'pubDate'),
    extractText(node, 'published'),
    extractText(node, 'updated'),
    extractText(node, 'created'),
  ];

  for (const dateStr of dateStrings) {
    if (dateStr) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Default to now if no date found
  return new Date();
}

/**
 * Extract image URL from enclosure or media:content
 */
function extractImageUrl(node: Element): string | undefined {
  // Try enclosure (RSS)
  const enclosure = node.querySelector('enclosure');
  if (enclosure) {
    const type = enclosure.getAttribute('type') || '';
    if (type.startsWith('image/')) {
      return enclosure.getAttribute('url') || undefined;
    }
  }

  // Try media:content (Media RSS)
  const mediaContent = node.querySelector('media\\:content');
  if (mediaContent) {
    const url = mediaContent.getAttribute('url');
    const type = mediaContent.getAttribute('type') || '';
    if (url && (type.startsWith('image/') || !type)) {
      return url;
    }
  }

  // Try media:thumbnail
  const thumbnail = node.querySelector('media\\:thumbnail');
  if (thumbnail) {
    return thumbnail.getAttribute('url') || undefined;
  }

  // Try to extract from description (sometimes images are inline)
  const description = extractText(node, 'description');
  const imgMatch = description.match(/<img[^>]+src="([^"]+)"/);
  if (imgMatch) {
    return imgMatch[1];
  }

  return undefined;
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
