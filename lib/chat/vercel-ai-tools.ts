/**
 * Vercel AI SDK Tool Integration
 *
 * Converts existing capability definitions and tools from lib/tools
 * into Vercel AI SDK tool format for seamless integration.
 *
 * @example
 * ```typescript
 * import { convertCapabilitiesToTools } from '@/lib/chat/vercel-ai-tools';
 *
 * const tools = await convertCapabilitiesToTools(['file.read', 'file.write', 'sandbox.execute']);
 *
 * const result = streamText({
 *   model: openai('gpt-4o'),
 *   messages,
 *   tools,
 * });
 * ```
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { chatLogger } from './chat-logger';
import type { ToolExecutionContext } from './vercel-ai-streaming';

/**
 * Convert a capability definition to Vercel AI SDK tool
 *
 * @param capabilityId - Capability ID (e.g., 'file.read', 'sandbox.execute')
 * @param executeFn - Function to execute the capability
 * @param options - Tool options (description, parameters)
 * @returns Vercel AI SDK tool
 */
export function createToolFromCapability(
  capabilityId: string,
  executeFn: (args: any, context: ToolExecutionContext) => Promise<any>,
  options?: {
    description?: string;
    parameters?: z.ZodSchema;
  }
): Tool {
  // Use double cast to work around Vercel AI SDK tool() type issues
  // First cast to unknown, then to Tool - avoids overload matching issues
  return tool({
    description: options?.description || `Execute ${capabilityId} capability`,
    parameters: options?.parameters || z.record(z.any()),
    execute: async (args: any) => {
      const context: ToolExecutionContext = {};

      try {
        chatLogger.debug('Executing capability via Vercel AI SDK tool', {
          capabilityId,
          args: sanitizeArgs(args),
        });

        const result = await executeFn(args, context);

        chatLogger.debug('Capability execution completed', {
          capabilityId,
          success: true,
        });

        return result;
      } catch (error: any) {
        chatLogger.error('Capability execution failed', {
          capabilityId,
          error: error.message,
        });
        throw error;
      }
    },
  }) as unknown as Tool;
}

/**
 * Sanitize arguments for logging (remove sensitive data)
 */
function sanitizeArgs(args: any): any {
  if (!args || typeof args !== 'object') return args;

  const sanitized: any = {};
  const sensitiveKeys = ['apiKey', 'password', 'secret', 'token', 'authorization'];

  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * File system tools for Vercel AI SDK
 */
export function createFileSystemTools(context: ToolExecutionContext): Record<string, Tool> {
  return {
    read_file: createToolFromCapability(
      'file.read',
      async (args: { path: string; encoding?: string }) => {
        // Lazy import to avoid circular dependencies
        const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
        const ownerId = context.userId || 'default';
        const file = await virtualFilesystem.readFile(ownerId, args.path);
        return {
          success: true,
          content: file.content,
          path: file.path,
          size: file.size,
        };
      },
      {
        description: 'Read contents of a file from the filesystem',
        parameters: z.object({
          path: z.string().describe('File path to read'),
          encoding: z.enum(['utf-8', 'base64', 'binary']).optional().default('utf-8'),
        }),
      }
    ),

    write_file: createToolFromCapability(
      'file.write',
      async (args: { path: string; content: string; encoding?: string; createDirs?: boolean }) => {
        const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
        const ownerId = context.userId || 'default';
        const file = await virtualFilesystem.writeFile(
          ownerId,
          args.path,
          args.content,
          undefined,
          { failIfExists: false, append: false }
        );
        return {
          success: true,
          path: file.path,
          size: file.size,
        };
      },
      {
        description: 'Write content to a file. Creates new file or overwrites existing.',
        parameters: z.object({
          path: z.string().describe('File path to write'),
          content: z.string().describe('Content to write'),
          encoding: z.enum(['utf-8', 'base64', 'binary']).optional().default('utf-8'),
          createDirs: z.boolean().optional().default(true),
        }),
      }
    ),

    delete_file: createToolFromCapability(
      'file.delete',
      async (args: { path: string; recursive?: boolean }) => {
        const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
        const ownerId = context.userId || 'default';
        const result = await virtualFilesystem.deletePath(ownerId, args.path);
        return {
          success: true,
          deletedCount: result.deletedCount,
          path: args.path,
        };
      },
      {
        description: 'Delete a file or directory',
        parameters: z.object({
          path: z.string().describe('Path to delete'),
          recursive: z.boolean().optional().default(false),
        }),
      }
    ),

    list_directory: createToolFromCapability(
      'file.list',
      async (args: { path?: string; pattern?: string; recursive?: boolean }) => {
        const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
        const ownerId = context.userId || 'default';
        const listing = await virtualFilesystem.listDirectory(ownerId, args.path || 'project');
        return {
          success: true,
          path: listing.path,
          nodes: listing.nodes.map(node => ({
            name: node.name,
            path: node.path,
            type: node.type,
            size: node.size,
          })),
        };
      },
      {
        description: 'List contents of a directory',
        parameters: z.object({
          path: z.string().optional().describe('Directory path to list'),
          pattern: z.string().optional().describe('Glob pattern to filter'),
          recursive: z.boolean().optional().default(false),
        }),
      }
    ),
  };
}

/**
 * Sandbox execution tools for Vercel AI SDK
 */
export function createSandboxTools(context: ToolExecutionContext): Record<string, Tool> {
  return {
    execute_code: createToolFromCapability(
      'sandbox.execute',
      async (args: { code: string; language: string; timeout?: number }) => {
        const { sandboxBridge } = await import('../sandbox');
        const session = await sandboxBridge.getOrCreateSession(context.userId || 'default');
        
        if (!session.sandboxHandle) {
          throw new Error('Sandbox not available');
        }

        const result = await session.sandboxHandle.executeCommand(
          `${args.language} -e "${args.code.replace(/"/g, '\\"')}"`,
          session.workspacePath,
          { timeout: args.timeout || 30000 }
        );

        return {
          success: result.success,
          output: result.output,
          exitCode: result.exitCode,
        };
      },
      {
        description: 'Execute code in a sandboxed environment',
        parameters: z.object({
          code: z.string().describe('Code to execute'),
          language: z.enum(['javascript', 'typescript', 'python', 'bash']).describe('Programming language'),
          timeout: z.number().optional().default(30000),
        }),
      }
    ),

    run_shell: createToolFromCapability(
      'sandbox.shell',
      async (args: { command: string; cwd?: string; timeout?: number }) => {
        const { sandboxBridge } = await import('../sandbox');
        const session = await sandboxBridge.getOrCreateSession(context.userId || 'default');
        
        if (!session.sandboxHandle) {
          throw new Error('Sandbox not available');
        }

        const result = await session.sandboxHandle.executeCommand(
          args.command,
          args.cwd || session.workspacePath,
          { timeout: args.timeout || 60000 }
        );

        return {
          success: result.success,
          stdout: result.output,
          stderr: '',
          exitCode: result.exitCode,
        };
      },
      {
        description: 'Execute a shell command in the sandbox environment',
        parameters: z.object({
          command: z.string().describe('Shell command to execute'),
          cwd: z.string().optional().describe('Working directory'),
          timeout: z.number().optional().default(60000),
        }),
      }
    ),
  };
}

/**
 * Web browsing tools for Vercel AI SDK
 */
export function createWebTools(context: ToolExecutionContext): Record<string, Tool> {
  return {
    browse_url: createToolFromCapability(
      'web.browse',
      async (args: { url: string; action?: string }) => {
        const { isHostnameBlocked } = await import('@/lib/utils/url-validation');
        const fetch = (await import('node-fetch')).default;

        // SSRF protection
        let parsed: URL;
        try {
          parsed = new URL(args.url);
        } catch {
          return { success: false, error: 'Invalid URL format' };
        }
        if (parsed.protocol !== 'https:') {
          return { success: false, error: 'Only HTTPS URLs are allowed' };
        }
        if (isHostnameBlocked(parsed.hostname)) {
          return { success: false, error: `Hostname blocked: ${parsed.hostname}` };
        }

        const response = await fetch(args.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; binG/1.0)' },
          signal: AbortSignal.timeout(15000),
          redirect: 'follow',
        });

        // Re-validate final URL after redirects to prevent SSRF via redirect chains
        // (e.g., allowed HTTPS hostname redirects to blocked internal IP like 169.254.169.254)
        const finalUrl = new URL(response.url || args.url);
        if (finalUrl.protocol !== 'https:' || isHostnameBlocked(finalUrl.hostname)) {
          return { success: false, error: 'Redirect to unsafe URL blocked' };
        }

        const content = await response.text();
        return {
          success: true,
          content: content.slice(0, 10000),
          url: finalUrl.href,
          statusCode: response.status,
        };
      },
      {
        description: 'Fetch and parse web pages (HTTPS only, SSRF-protected)',
        parameters: z.object({
          url: z.string().describe('HTTPS URL to browse'),
          action: z.enum(['fetch', 'extract']).optional().default('fetch'),
        }),
      }
    ),
  };
}

/**
 * Web search and fetch tools for Vercel AI SDK
 * Uses SSRF-safe URL validation from lib/utils/url-validation
 */
export function createSearchTools(context: ToolExecutionContext): Record<string, Tool> {
  return {
    web_search: tool({
      description: 'Search the web for information using DuckDuckGo. Returns titles, URLs, and snippets.',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().default(5).describe('Max results to return (1-10)'),
      }),
      execute: async (args: { query: string; limit?: number }) => {
        const { isHostnameBlocked } = await import('@/lib/utils/url-validation');
        const fetch = (await import('node-fetch')).default;
        const limit = Math.min(args.limit || 5, 10);

        try {
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
          const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000),
          });
          const html = await response.text();

          const results: Array<{ title: string; url: string; snippet: string }> = [];
          const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
          let match: RegExpExecArray | null;

          while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
            let url = match[1];
            const urlMatch = url.match(/uddg=([^&]+)/);
            if (urlMatch) {
              url = decodeURIComponent(urlMatch[1]);
            }
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            const snippet = match[3].replace(/<[^>]+>/g, '').trim();

            // Only include HTTPS URLs that pass SSRF checks
            if (title && url) {
              try {
                const parsed = new URL(url);
                if (parsed.protocol === 'https:' && !isHostnameBlocked(parsed.hostname)) {
                  results.push({ title, url, snippet });
                }
              } catch {
                // Skip malformed URLs
              }
            }
          }

          return {
            success: results.length > 0,
            results,
            query: args.query,
            resultCount: results.length,
          };
        } catch (error: any) {
          chatLogger.error('web_search failed', { query: args.query, error: error.message });
          return {
            success: false,
            results: [],
            query: args.query,
            error: error.message,
          };
        }
      },
    }) as Tool,

    web_fetch: tool({
      description: `Fetch and read the content of a web page by URL. 
USE THIS TOOL whenever:
- The user sends a URL/link in their message (e.g. "https://example.com/article")
- The user asks to read, fetch, scrape, or summarize a web page
- The user references a web page they want you to look at
Returns cleaned article body text with navigation, ads, footers, and boilerplate automatically removed. Prioritizes main content.`,
      parameters: z.object({
        url: z.string().describe('The HTTPS URL to fetch and read'),
        maxChars: z.number().optional().default(12000).describe('Max characters of content to return'),
      }),
      execute: async (args: { url: string; maxChars?: number }) => {
        const { isHostnameBlocked } = await import('@/lib/utils/url-validation');
        const fetch = (await import('node-fetch')).default;
        const maxChars = args.maxChars || 12000;

        try {
          // Validate URL before fetching
          let parsed: URL;
          try {
            parsed = new URL(args.url);
          } catch {
            return { success: false, content: '', url: args.url, error: 'Invalid URL format' };
          }

          // Enforce HTTPS only
          if (parsed.protocol !== 'https:') {
            return { success: false, content: '', url: args.url, error: 'Only HTTPS URLs are allowed' };
          }

          // SSRF protection — block private IPs and internal hostnames
          if (isHostnameBlocked(parsed.hostname)) {
            chatLogger.warn('web_fetch blocked unsafe hostname', { url: args.url, hostname: parsed.hostname });
            return { success: false, content: '', url: args.url, error: `Hostname blocked: ${parsed.hostname}` };
          }

          const response = await fetch(args.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(15000),
            redirect: 'follow',
          });

          // Re-validate hostname after redirects
          const finalUrl = new URL(response.url || args.url);
          if (finalUrl.protocol !== 'https:' || isHostnameBlocked(finalUrl.hostname)) {
            return { success: false, content: '', url: args.url, error: 'Redirect to unsafe URL blocked' };
          }

          const contentType = response.headers.get('content-type') || '';
          let content: string;
          let extractedTitle = '';

          if (contentType.includes('application/json')) {
            const json = await response.json();
            content = JSON.stringify(json, null, 2).slice(0, maxChars);
          } else {
            const raw = await response.text();

            // Extract title before stripping
            const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            if (titleMatch) {
              extractedTitle = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            }

            // ---- Noise removal: strip nav, ads, footers, sidebars, etc. ----
            let cleaned = raw
              // Remove script/style blocks
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              // Remove SVG icons (often decorative)
              .replace(/<svg[\s\S]*?<\/svg>/gi, '')
              // Remove nav, header, footer, aside (boilerplate)
              .replace(/<nav[\s\S]*?<\/nav>/gi, '')
              .replace(/<header[\s\S]*?<\/header>/gi, '')
              .replace(/<footer[\s\S]*?<\/footer>/gi, '')
              .replace(/<aside[\s\S]*?<\/aside>/gi, '')
              // Remove iframes, embeds, objects (ads, trackers)
              .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
              .replace(/<embed[^>]*>/gi, '')
              .replace(/<object[\s\S]*?<\/object>/gi, '')
              // Remove noscript fallbacks
              .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
              // Remove form elements (login boxes, search bars)
              .replace(/<form[\s\S]*?<\/form>/gi, '')
              // Remove elements with common ad/noise class/id patterns
              .replace(/<(div|section|span)[^>]*class="[^"]*(?:ad[s_-]|advert|banner|cookie|consent|modal|popup|sidebar|nav-|breadcrumb|social-|share-|comment|related|recommended|newsletter|signup|login|footer|header|copyright|legal|disclaimer|sponsor|promo|cta-?box|subscribe|paywall|gate|interstitial|overlay|toast|notification|alert)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '')
              .replace(/<(div|section|span)[^>]*id="[^"]*(?:ad[s_-]|advert|banner|cookie|consent|modal|popup|sidebar|nav-|breadcrumb|social-|share-|comment|related|recommended|newsletter|signup|login|footer|header|copyright|legal|disclaimer|sponsor|promo|subscribe|paywall|overlay|toast|notification)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '');

            // ---- Extract main content: try <main>, <article>, then <body> ----
            let bodyContent = '';

            // Try <article> first (most specific)
            const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
            if (articleMatch && articleMatch[1].length > 200) {
              bodyContent = articleMatch[1];
            } else {
              // Try <main>
              const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
              if (mainMatch && mainMatch[1].length > 200) {
                bodyContent = mainMatch[1];
              } else {
                // Try role="main"
                const roleMainMatch = cleaned.match(/<[^>]+role="main"[^>]*>([\s\S]*?)<\/(?:div|section)>/i);
                if (roleMainMatch && roleMainMatch[1].length > 200) {
                  bodyContent = roleMainMatch[1];
                } else {
                  // Fall back to <body>
                  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                  bodyContent = bodyMatch ? bodyMatch[1] : cleaned;
                }
              }
            }

            // Strip remaining HTML tags and decode entities
            content = bodyContent
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#x27;/g, "'")
              .replace(/&#x2F;/g, '/')
              .replace(/&hellip;/g, '...')
              .replace(/&mdash;/g, '—')
              .replace(/&ndash;/g, '–')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, maxChars);
          }

          return {
            success: true,
            title: extractedTitle,
            content,
            url: args.url,
            statusCode: response.status,
            contentType,
          };
        } catch (error: any) {
          chatLogger.error('web_fetch failed', { url: args.url, error: error.message });
          return {
            success: false,
            content: '',
            url: args.url,
            error: error.message,
          };
        }
      },
    }) as Tool,
  };
}

/**
 * Get all available tools for a given context
 */
export async function getAllTools(context: ToolExecutionContext): Promise<Record<string, Tool>> {
  const fileTools = createFileSystemTools(context);
  const sandboxTools = createSandboxTools(context);
  const webTools = createWebTools(context);
  const searchTools = createSearchTools(context);

  return {
    ...fileTools,
    ...sandboxTools,
    ...webTools,
    ...searchTools,
  };
}

/**
 * Get tools by category
 */
export async function getToolsByCategory(
  category: 'file' | 'sandbox' | 'web' | 'all',
  context: ToolExecutionContext
): Promise<Record<string, Tool>> {
  switch (category) {
    case 'file':
      return createFileSystemTools(context);
    case 'sandbox':
      return createSandboxTools(context);
    case 'web':
      return createWebTools(context);
    case 'all':
    default:
      return getAllTools(context);
  }
}

/**
 * Extract public HTTPS URLs from user text.
 * Useful for pre-detecting URLs in prompts to auto-trigger web_fetch.
 */
export function extractPublicUrls(text: string): string[] {
  const urlRegex = /https:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex) || [];

  // Deduplicate and filter to well-formed URLs
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const raw of matches) {
    // Strip trailing punctuation that's often part of prose
    const cleaned = raw.replace(/[.,;:!?)\]>]+$/, '');
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'https:' && !seen.has(cleaned)) {
        seen.add(cleaned);
        urls.push(cleaned);
      }
    } catch {
      // Skip malformed
    }
  }

  return urls;
}
