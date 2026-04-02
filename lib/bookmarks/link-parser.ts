/**
 * Link Parser Utility
 * 
 * Extracts and validates links from various input formats:
 * - Plain text with newlines
 * - Comma-separated lists
 * - Space-separated lists
 * - Mixed formats
 * - Markdown links
 * - HTML anchors
 * - JSON arrays
 */

export interface ParsedLink {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  source?: string;
  addedAt: number;
}

export interface LinkParserOptions {
  deduplicate?: boolean;
  extractMetadata?: boolean;
  existingLinks?: string[];
}

/**
 * Extract URLs from text using multiple patterns
 */
export function extractUrls(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const urls = new Set<string>();

  // Pattern 1: Full HTTPS URLs
  const httpsPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const httpsMatches = text.match(httpsPattern) || [];
  httpsMatches.forEach(url => urls.add(cleanUrl(url)));

  // Pattern 2: WWW URLs (without protocol)
  const wwwPattern = /www\.[^\s<>"{}|\\^`\[\]]+\.[^\s<>"{}|\\^`\[\]]+/gi;
  const wwwMatches = text.match(wwwPattern) || [];
  wwwMatches.forEach(url => urls.add(cleanUrl(url)));

  // Pattern 3: Markdown links [text](url)
  const markdownPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let markdownMatch;
  while ((markdownMatch = markdownPattern.exec(text)) !== null) {
    if (markdownMatch[2]) {
      urls.add(cleanUrl(markdownMatch[2]));
    }
  }

  // Pattern 4: HTML anchor tags
  const htmlPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let htmlMatch;
  while ((htmlMatch = htmlPattern.exec(text)) !== null) {
    if (htmlMatch[1] && (htmlMatch[1].startsWith('http') || htmlMatch[1].startsWith('www'))) {
      urls.add(cleanUrl(htmlMatch[1]));
    }
  }

  return Array.from(urls);
}

/**
 * Clean and normalize URL
 */
function cleanUrl(url: string): string {
  let cleaned = url.trim();
  
  // Remove trailing punctuation
  cleaned = cleaned.replace(/[.,;:!?)\]]+$/, '');
  
  // Remove leading/trailing quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  
  // Add https:// if missing
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    if (cleaned.startsWith('www.')) {
      cleaned = 'https://' + cleaned;
    }
  }
  
  return cleaned;
}

/**
 * Parse links from various input formats
 */
export async function parseLinks(
  input: string | any[],
  options: LinkParserOptions = {}
): Promise<ParsedLink[]> {
  const {
    deduplicate = true,
    extractMetadata = true,
    existingLinks = [],
  } = options;

  let urls: string[] = [];

  // Handle different input types
  if (Array.isArray(input)) {
    // JSON array or array of objects
    urls = input.flatMap(item => {
      if (typeof item === 'string') {
        return extractUrls(item);
      } else if (item && typeof item === 'object') {
        // Object with url property
        const url = (item as any).url || (item as any).link || (item as any).href;
        if (url && typeof url === 'string') {
          return [cleanUrl(url)];
        }
      }
      return [];
    });
  } else if (typeof input === 'string') {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parseLinks(parsed, options);
      }
    } catch {
      // Not JSON, parse as text
      urls = extractUrls(input);
    }
  }

  // Deduplicate
  if (deduplicate) {
    const seen = new Set(existingLinks);
    urls = urls.filter(url => {
      if (seen.has(url)) {
        return false;
      }
      seen.add(url);
      return true;
    });
  }

  // Validate URLs
  urls = urls.filter(url => isValidUrl(url));

  // Create parsed links with metadata
  const parsedLinks: ParsedLink[] = urls.map(url => ({
    url,
    addedAt: Date.now(),
  }));

  // Extract metadata if enabled
  if (extractMetadata) {
    for (const link of parsedLinks) {
      try {
        const metadata = await fetchLinkMetadata(link.url);
        if (metadata) {
          link.title = metadata.title;
          link.description = metadata.description;
          link.imageUrl = metadata.imageUrl;
        }
      } catch (error) {
        console.warn('Failed to fetch metadata for:', link.url, error);
      }
    }
  }

  return parsedLinks;
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Fetch OpenGraph metadata for a URL
 */
export async function fetchLinkMetadata(url: string): Promise<{
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
} | null> {
  try {
    const response = await fetch('/api/bookmarks/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.warn('Metadata fetch failed:', error);
    return null;
  }
}

/**
 * Parse links from file content
 */
export async function parseLinksFromFile(
  file: File,
  options: LinkParserOptions = {}
): Promise<ParsedLink[]> {
  const content = await file.text();
  const extension = file.name.toLowerCase().split('.').pop();

  // Handle different file types
  switch (extension) {
    case 'json':
      try {
        const json = JSON.parse(content);
        return parseLinks(json, options);
      } catch (error) {
        console.error('Invalid JSON file:', error);
        return [];
      }

    case 'txt':
    case 'md':
    case 'markdown':
      return parseLinks(content, options);

    case 'html':
    case 'htm':
      // Extract links from HTML (bookmark exports)
      const urls = extractUrls(content);
      return parseLinks(urls, options);

    default:
      // Try to parse as text
      return parseLinks(content, options);
  }
}

/**
 * Deduplicate links against existing list
 */
export function deduplicateLinks(
  newLinks: ParsedLink[],
  existingLinks: ParsedLink[]
): ParsedLink[] {
  const existingUrls = new Set(existingLinks.map(link => link.url));
  return newLinks.filter(link => !existingUrls.has(link.url));
}

/**
 * Sort links by date (newest first or last)
 */
export function sortLinksByDate(
  links: ParsedLink[],
  order: 'newest-first' | 'oldest-first' = 'newest-first'
): ParsedLink[] {
  return [...links].sort((a, b) => {
    const comparison = b.addedAt - a.addedAt;
    return order === 'newest-first' ? comparison : -comparison;
  });
}
