/**
 * CrewAI Tools Library
 *
 * Integration with common CrewAI tools: Serper, Wikipedia, RAG, Directory, etc.
 *
 * @see https://docs.crewai.com/en/concepts/tools.md
 */

import { z } from 'zod';

export interface BaseTool {
  name: string;
  description: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position?: number;
}

/**
 * SerperDevTool - Web Search
 *
 * @see https://docs.crewai.com/en/enterprise/features/tools-and-integrations.md
 */
export class SerperDevTool implements BaseTool {
  name = 'serper_search';
  description = 'Search the web using Serper. Best for finding current information, news, and articles.';

  private apiKey?: string;
  private numResults: number;

  constructor(options: { apiKey?: string; numResults?: number } = {}) {
    this.apiKey = options.apiKey || process.env.SERPER_API_KEY;
    this.numResults = options.numResults || 10;
  }

  private schema = z.object({
    query: z.string().describe('The search query'),
    type: z.enum(['search', 'images', 'news', 'places']).optional().describe('Type of search'),
  });

  async execute(params: unknown): Promise<ToolResult> {
    const { query, type = 'search' } = this.schema.parse(params);

    if (!this.apiKey) {
      return { success: false, error: 'SERPER_API_KEY not configured' };
    }

    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: this.numResults,
          type,
        }),
      });

      if (!response.ok) {
        throw new Error(`Serper API error: ${response.status}`);
      }

      const data = await response.json();

      const results: SearchResult[] = (data.organic || []).map((item: any, index: number) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        position: index + 1,
      }));

      return { success: true, data: { results, query } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          type: { type: 'string', enum: ['search', 'images', 'news', 'places'], description: 'Type of search' },
        },
        required: ['query'],
      },
    };
  }
}

/**
 * WikipediaTool - Wikipedia Search
 */
export class WikipediaTool implements BaseTool {
  name = 'wikipedia_search';
  description = 'Search Wikipedia for encyclopedic information. Best for factual, historical, and general knowledge.';

  private schema = z.object({
    query: z.string().describe('The search query'),
    lang: z.string().optional().describe('Language code (default: en)'),
  });

  async execute(params: unknown): Promise<ToolResult> {
    const { query, lang = 'en' } = this.schema.parse(params);

    try {
      const response = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`
      );

      if (!response.ok) {
        throw new Error(`Wikipedia API error: ${response.status}`);
      }

      const data = await response.json();
      const results = data.query?.search || [];

      return {
        success: true,
        data: {
          results: results.map((item: any) => ({
            title: item.title,
            snippet: item.snippet,
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
          })),
          query,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Wikipedia search failed',
      };
    }
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          lang: { type: 'string', description: 'Language code (default: en)' },
        },
        required: ['query'],
      },
    };
  }
}

/**
 * DirectorySearchTool - File Content Search
 */
export class DirectorySearchTool implements BaseTool {
  name = 'directory_search';
  description = 'Search for files and directories. Best for finding files by name or content.';

  private schema = z.object({
    path: z.string().describe('Directory path to search'),
    pattern: z.string().optional().describe('File pattern (glob)'),
    contentSearch: z.string().optional().describe('Search within file content'),
  });

  async execute(params: unknown): Promise<ToolResult> {
    const { path, pattern, contentSearch } = this.schema.parse(params);

    try {
      const fs = await import('fs/promises');
      const pathModule = await import('path');

      // Read directory
      const entries = await fs.readdir(path, { withFileTypes: true });
      
      const results: Array<{ name: string; type: string; path: string }> = [];

      for (const entry of entries) {
        const fullPath = pathModule.join(path, entry.name);
        
        // Pattern matching
        if (pattern && !this.matchesPattern(entry.name, pattern)) {
          continue;
        }

        // Content search
        if (contentSearch && entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            if (!content.includes(contentSearch)) {
              continue;
            }
          } catch {
            continue;
          }
        }

        results.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          path: fullPath,
        });
      }

      return { success: true, data: { results, path } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Directory search failed',
      };
    }
  }

  private matchesPattern(name: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(name);
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to search' },
          pattern: { type: 'string', description: 'File pattern (glob)' },
          contentSearch: { type: 'string', description: 'Search within file content' },
        },
        required: ['path'],
      },
    };
  }
}

/**
 * FileReadTool - File Reading
 */
export class FileReadTool implements BaseTool {
  name = 'file_read';
  description = 'Read file contents. Best for reading code, config files, or text documents.';

  private schema = z.object({
    path: z.string().describe('File path to read'),
    encoding: z.string().optional().describe('File encoding (default: utf-8)'),
  });

  async execute(params: unknown): Promise<ToolResult> {
    const { path, encoding = 'utf-8' } = this.schema.parse(params);

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(path, encoding);

      return { success: true, data: { content, path } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'File read failed',
      };
    }
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
        },
        required: ['path'],
      },
    };
  }
}

/**
 * CodeDocsSearchTool - Documentation Search
 */
export class CodeDocsSearchTool implements BaseTool {
  name = 'code_docs_search';
  description = 'Search code documentation. Best for finding API docs, function references, and usage examples.';

  private schema = z.object({
    query: z.string().describe('The documentation search query'),
    docsUrl: z.string().optional().describe('Specific documentation URL to search'),
  });

  async execute(params: unknown): Promise<ToolResult> {
    const { query, docsUrl } = this.schema.parse(params);

    try {
      // In production, this would integrate with a docs search API
      // For now, return a placeholder
      return {
        success: true,
        data: {
          results: [
            {
              title: 'Documentation Search',
              snippet: `Search results for: ${query}`,
              url: docsUrl || 'https://docs.example.com',
            },
          ],
          query,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Docs search failed',
      };
    }
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The documentation search query' },
          docsUrl: { type: 'string', description: 'Specific documentation URL to search' },
        },
        required: ['query'],
      },
    };
  }
}

/**
 * Create tool registry
 */
export function createToolRegistry() {
  const tools = new Map<string, BaseTool & { execute: (params: unknown) => Promise<ToolResult> }>();

  return {
    register(tool: BaseTool & { execute: (params: unknown) => Promise<ToolResult> }) {
      tools.set(tool.name, tool);
    },
    get(name: string) {
      return tools.get(name);
    },
    list() {
      return Array.from(tools.values());
    },
  };
}
