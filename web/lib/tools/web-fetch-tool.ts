/**
 * Web Fetch Tool - Intelligent URL Content Extraction
 * 
 * Fetches URL content with intelligent fallback to Firecrawl API:
 * - Primary: Native fetch() with HTML cleansing
 * - Fallback: Firecrawl API for JS-rendered, blocked, or poor-quality content
 * - Removes HTML noise (scripts, styles, nav, footer)
 * - Extracts main content using readability heuristics
 * - Returns clean, LLM-ready text
 * - Uses question/prompt context for focused extraction
 */

import { chatLogger } from '@/lib/chat/chat-logger';

export interface WebFetchOptions {
  url: string;
  maxChars?: number;
  question?: string; // Context for intelligent extraction
  extractMode?: 'full' | 'summary' | 'keyword';
  useFirecrawl?: boolean; // Force Firecrawl usage
}

export interface WebFetchResult {
  success: boolean;
  content: string;
  url: string;
  title?: string;
  statusCode?: number;
  contentType?: string;
  truncated?: boolean;
  originalLength?: number;
  error?: string;
  source?: 'native' | 'firecrawl'; // Which source provided the content
  fallbackUsed?: boolean; // Whether fallback was triggered
}

interface FirecrawlResponse {
  success?: boolean;
  markdown?: string;
  html?: string;
  metadata?: {
    title?: string;
    description?: string;
    statusCode?: number;
  };
  error?: string;
}

/**
 * Remove HTML noise and extract clean text
 */
function extractCleanText(html: string, options: { maxChars?: number; question?: string }): string {
  // For server-side (no DOM), use regex-based extraction
  let text = html;

  // Remove scripts, styles, nav, footer, ads
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  text = text.replace(/class=["'][^"']*(ad|banner|sidebar|nav|menu|cookie|popup)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Extract title
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Extract main content (article, main, or body)
  const articleMatch = text.match(/<article[\s\S]*?<\/article>/gi);
  const mainMatch = text.match(/<main[\s\S]*?<\/main>/gi);
  const contentArea = (articleMatch || mainMatch || []).join('\n') || text;

  // Remove remaining HTML tags
  text = contentArea.replace(/<[^>]+>/g, ' ');

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&apos;/g, "'");

  // If question provided, boost relevant sections (simple keyword matching)
  if (options.question) {
    const keywords = options.question
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3) // Skip short words
      .filter(w => !['what', 'how', 'why', 'when', 'where', 'who', 'the', 'and', 'for', 'with', 'this', 'that', 'from'].includes(w));

    if (keywords.length > 0) {
      // Split into sentences
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

      // Score sentences by keyword matches
      const scored = sentences.map(sentence => {
        const lower = sentence.toLowerCase();
        const score = keywords.filter(kw => lower.includes(kw)).length;
        return { sentence, score };
      });

      // Sort by relevance, keep top sentences
      scored.sort((a, b) => b.score - a.score);
      const relevantSentences = scored.filter(s => s.score > 0);

      if (relevantSentences.length > 0) {
        // Use relevant sentences first, then rest for context
        text = [
          ...relevantSentences.map(s => s.sentence),
          ...scored.filter(s => s.score === 0).map(s => s.sentence),
        ].join(' ');
      }
    }
  }

  // Add title at top
  if (title) {
    text = `Title: ${title}\n\n${text}`;
  }

  // Truncate if needed
  const maxChars = options.maxChars || 8000;
  if (text.length > maxChars) {
    return text.substring(0, maxChars) + '\n\n... [content truncated]';
  }

  return text;
}

/**
 * Boost sentences relevant to the question (simple keyword matching)
 */
function boostRelevantContent(content: string, question: string): string {
  const keywords = question
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['what', 'how', 'why', 'when', 'where', 'who', 'the', 'and', 'for', 'with', 'this', 'that', 'from'].includes(w));

  if (keywords.length === 0) return content;

  // Split into paragraphs
  const paragraphs = content.split(/\n\n+/);

  // Score paragraphs by keyword matches
  const scored = paragraphs.map(para => {
    const lower = para.toLowerCase();
    const score = keywords.filter(kw => lower.includes(kw)).length;
    return { paragraph: para, score };
  });

  // Sort by relevance
  scored.sort((a, b) => b.score - a.score);

  // Get relevant paragraphs first, then rest
  const relevant = scored.filter(s => s.score > 0);
  const other = scored.filter(s => s.score === 0);

  if (relevant.length > 0) {
    return [
      ...relevant.map(s => s.paragraph),
      ...other.map(s => s.paragraph),
    ].join('\n\n');
  }

  return content;
}

/**
 * Native fetch implementation with HTML cleansing
 */
async function fetchNative(url: string, maxChars: number, question?: string): Promise<WebFetchResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        success: false,
        content: '',
        url,
        statusCode: response.status,
        contentType: response.headers.get('content-type') || 'unknown',
        error: `HTTP ${response.status}: ${response.statusText}`,
        source: 'native',
        fallbackUsed: false,
      };
    }

    const contentType = response.headers.get('content-type') || 'text/html';

    // Handle different content types
    if (contentType.includes('application/json')) {
      const json = await response.text();
      const truncated = json.length > maxChars;
      return {
        success: true,
        content: truncated ? json.substring(0, maxChars) + '\n... [truncated]' : json,
        url,
        statusCode: response.status,
        contentType,
        truncated,
        originalLength: json.length,
        source: 'native',
        fallbackUsed: false,
      };
    }

    if (contentType.includes('text/plain')) {
      const text = await response.text();
      const truncated = text.length > maxChars;
      return {
        success: true,
        content: truncated ? text.substring(0, maxChars) + '\n... [truncated]' : text,
        url,
        statusCode: response.status,
        contentType,
        truncated,
        originalLength: text.length,
        source: 'native',
        fallbackUsed: false,
      };
    }

    // HTML content - extract and clean
    const html = await response.text();
    const cleanText = extractCleanText(html, { maxChars, question });

    return {
      success: true,
      content: cleanText,
      url,
      statusCode: response.status,
      contentType,
      truncated: cleanText.length >= maxChars,
      originalLength: html.length,
      source: 'native',
      fallbackUsed: false,
    };
  } catch (error: any) {
    throw error; // Re-throw for caller to handle
  }
}

/**
 * Firecrawl API fallback - handles JS-rendered, blocked, or complex pages
 */
async function fetchWithFirecrawl(url: string, maxChars: number, question?: string): Promise<WebFetchResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      content: '',
      url,
      error: 'Firecrawl API key not configured (FIRECRAWL_API_KEY env var)',
      source: 'firecrawl',
      fallbackUsed: true,
    };
  }

  try {
    chatLogger.info('[WebFetch:Firecrawl] Calling Firecrawl API', { url });

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'], // Get clean markdown format
        onlyMainContent: true, // Extract only main content
        timeout: 30000, // 30 second timeout
      }),
      signal: AbortSignal.timeout(35000), // Slightly longer than Firecrawl's timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Firecrawl API error (${response.status}): ${errorText}`);
    }

    const data: FirecrawlResponse = await response.json();

    if (!data.success || !data.markdown) {
      return {
        success: false,
        content: '',
        url,
        error: data.error || 'Firecrawl returned no content',
        source: 'firecrawl',
        fallbackUsed: true,
      };
    }

    let content = data.markdown;

    // Add title if available
    if (data.metadata?.title) {
      content = `Title: ${data.metadata.title}\n\n${content}`;
    }

    // If question provided, boost relevant sections
    if (question && content.length > 200) {
      content = boostRelevantContent(content, question);
    }

    // Truncate if needed
    const truncated = content.length > maxChars;
    if (truncated) {
      content = content.substring(0, maxChars) + '\n\n... [content truncated]';
    }

    return {
      success: true,
      content,
      url,
      title: data.metadata?.title,
      statusCode: data.metadata?.statusCode || 200,
      contentType: 'text/markdown',
      truncated,
      originalLength: content.length,
      source: 'firecrawl',
      fallbackUsed: true,
    };
  } catch (error: any) {
    chatLogger.error('[WebFetch:Firecrawl] Failed', { url, error: error.message });
    throw error; // Re-throw for caller to handle
  }
}

/**
 * Fetch URL content and extract clean text
 */
export async function webFetch(options: WebFetchOptions): Promise<WebFetchResult> {
  const { url, maxChars = 8000, question, extractMode = 'full', useFirecrawl } = options;
  
  if (!url) {
    return {
      success: false,
      content: '',
      url: '',
      error: 'Missing required field: url',
      source: 'native',
      fallbackUsed: false,
    };
  }
  
  // If Firecrawl is forced or no API key for native, use Firecrawl directly
  if (useFirecrawl) {
    chatLogger.info('[WebFetch] Firecrawl forced by options', { url });
    return fetchWithFirecrawl(url, maxChars, question);
  }
  
  try {
    // PRIMARY: Try native fetch first
    chatLogger.info('[WebFetch] Attempting native fetch', { url });
    const nativeResult = await fetchNative(url, maxChars, question);
    
    // Check if native fetch succeeded with good content
    if (nativeResult.success && nativeResult.content.length > 100) {
      chatLogger.info('[WebFetch] Native fetch succeeded', { 
        url, 
        contentLength: nativeResult.content.length,
        source: 'native',
      });
      return nativeResult;
    }
    
    // FALLBACK: Content too short or failed - use Firecrawl
    chatLogger.info('[WebFetch] Native fetch returned poor content, trying Firecrawl fallback', {
      url,
      contentLength: nativeResult.content.length,
      error: nativeResult.error,
    });
    
    const firecrawlResult = await fetchWithFirecrawl(url, maxChars, question);
    
    if (firecrawlResult.success) {
      chatLogger.info('[WebFetch] Firecrawl fallback succeeded', {
        url,
        contentLength: firecrawlResult.content.length,
        source: 'firecrawl',
      });
      return {
        ...firecrawlResult,
        fallbackUsed: true,
      };
    }
    
    // Both failed - return native error
    chatLogger.warn('[WebFetch] Both native and Firecrawl failed', { url });
    return {
      ...nativeResult,
      fallbackUsed: true,
    };
  } catch (error: any) {
    // Native fetch threw error - try Firecrawl
    chatLogger.warn('[WebFetch] Native fetch error, trying Firecrawl fallback', {
      url,
      error: error.message,
    });
    
    try {
      const firecrawlResult = await fetchWithFirecrawl(url, maxChars, question);
      if (firecrawlResult.success) {
        chatLogger.info('[WebFetch] Firecrawl fallback succeeded after native error', {
          url,
          contentLength: firecrawlResult.content.length,
          source: 'firecrawl',
        });
        return {
          ...firecrawlResult,
          fallbackUsed: true,
        };
      }
    } catch (firecrawlError: any) {
      chatLogger.error('[WebFetch] Firecrawl also failed', {
        url,
        nativeError: error.message,
        firecrawlError: firecrawlError.message,
      });
    }
    
    return {
      success: false,
      content: '',
      url,
      error: `Native fetch failed: ${error.message}. Firecrawl fallback also failed.`,
      source: 'native',
      fallbackUsed: true,
    };
  }
}

/**
 * Create Vercel AI SDK web_fetch tool
 */
export async function createWebFetchTool(context: { userId?: string; conversationId?: string; question?: string }) {
  const { tool } = await import('ai');
  const { z } = await import('zod');

  const createToolFn = tool as any;
  return {
    web_fetch: createToolFn({
      description: 'Fetch content from a URL and return clean, readable text. Automatically handles JavaScript-rendered pages, anti-bot protection, and complex sites by falling back to Firecrawl API. Removes HTML noise, extracts main content. Use to read web pages, articles, documentation, or any URL.',
      parameters: z.object({
        url: z.string().url().describe('URL to fetch'),
        maxChars: z.number().optional().default(8000).describe('Maximum characters to return'),
      }),
      execute: async (args: { url: string; maxChars: number }) => {
        const result = await webFetch({
          url: args.url,
          maxChars: args.maxChars,
          question: context.question,
        });
        return result;
      },
    }),
  };
}
