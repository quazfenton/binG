/**
 * Repo Index / Code Search
 *
 * Indexes codebase for fast semantic and keyword search.
 * Supports AST parsing, embeddings, and full-text search.
 *
 * @module repo-index
 */

import { createLogger } from '@/lib/utils/logger';
import { getDatabase } from '@/lib/database/connection';
import { getEmbeddingProvider } from '@/lib/vector-memory/embeddings';
import { contentHash, embeddingCache } from '@/lib/cache';

const logger = createLogger('RepoIndex');

/**
 * Indexed file record
 */
export interface IndexedFile {
  id: string;
  path: string;
  content: string;
  language: string;
  symbols: SymbolInfo[];
  embeddings?: number[];
  keywords: string[];
  indexedAt: number;
  size: number;
}

/**
 * Code symbol (function, class, variable, etc.)
 */
export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'interface' | 'variable' | 'constant' | 'type';
  line: number;
  column: number;
  signature?: string;
  documentation?: string;
}

/**
 * Search result
 */
export interface SearchResult {
  file: IndexedFile;
  score: number;
  matches: MatchInfo[];
}

/**
 * Match information
 */
export interface MatchInfo {
  type: 'keyword' | 'symbol' | 'semantic';
  line: number;
  text: string;
  score: number;
}

/**
 * Repo Indexer
 */
export class RepoIndexer {
  private db: any;
  private indexQueue: string[] = [];
  private isIndexing = false;

  constructor() {
    this.db = getDatabase();
    this.initializeTables();
  }

  /**
   * Initialize database tables
   */
  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repo_index (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        content TEXT,
        language TEXT,
        symbols TEXT,
        embeddings TEXT,
        keywords TEXT,
        indexed_at INTEGER,
        size INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_repo_index_path ON repo_index(path);
      CREATE INDEX IF NOT EXISTS idx_repo_index_language ON repo_index(language);
      CREATE INDEX IF NOT EXISTS idx_repo_index_keywords ON repo_index(keywords);

      CREATE TABLE IF NOT EXISTS repo_symbols (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        line INTEGER,
        column INTEGER,
        signature TEXT,
        documentation TEXT,
        FOREIGN KEY (file_id) REFERENCES repo_index(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_repo_symbols_name ON repo_symbols(name);
      CREATE INDEX IF NOT EXISTS idx_repo_symbols_type ON repo_symbols(type);
    `);

    logger.info('Repo index tables initialized');
  }

  /**
   * Index a single file
   */
  async indexFile(
    path: string,
    content: string,
    options?: { language?: string; skipEmbeddings?: boolean }
  ): Promise<IndexedFile> {
    const language = options?.language || this.detectLanguage(path);
    const symbols = this.extractSymbols(content, language);
    const keywords = this.extractKeywords(content, symbols);

    const file: IndexedFile = {
      id: this.generateId(path),
      path,
      content,
      language,
      symbols,
      embeddings: options?.skipEmbeddings ? undefined : await this.generateEmbeddings(content),
      keywords,
      indexedAt: Date.now(),
      size: content.length,
    };

    // Store in database
    this.db.prepare(`
      INSERT OR REPLACE INTO repo_index
      (id, path, content, language, symbols, embeddings, keywords, indexed_at, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      file.id,
      file.path,
      file.content,
      file.language,
      JSON.stringify(file.symbols),
      file.embeddings ? JSON.stringify(file.embeddings) : null,
      JSON.stringify(file.keywords),
      file.indexedAt,
      file.size
    );

    // Store symbols separately for better querying
    const insertSymbol = this.db.prepare(`
      INSERT OR REPLACE INTO repo_symbols
      (id, file_id, name, type, line, column, signature, documentation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const symbol of symbols) {
      insertSymbol.run(
        this.generateId(`${path}:${symbol.name}`),
        file.id,
        symbol.name,
        symbol.type,
        symbol.line,
        symbol.column,
        symbol.signature || null,
        symbol.documentation || null
      );
    }

    logger.debug('Indexed file', { path, language, symbols: symbols.length });

    return file;
  }

  /**
   * Index entire directory
   */
  async indexDirectory(
    rootPath: string,
    options?: {
      extensions?: string[];
      exclude?: string[];
      maxFiles?: number;
    }
  ): Promise<{ indexed: number; skipped: number; errors: number }> {
    const { readdir, readFile } = await import('fs/promises');
    const { join, relative } = await import('path');

    const extensions = options?.extensions || ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];
    const exclude = options?.exclude || ['node_modules', '.git', 'dist', 'build'];
    const maxFiles = options?.maxFiles || 10000;

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    const indexRecursive = async (dir: string) => {
      if (indexed >= maxFiles) return;

      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(rootPath, fullPath);

        // Skip excluded directories
        if (entry.isDirectory()) {
          if (exclude.some(ex => relPath.includes(ex) || entry.name === ex)) {
            skipped++;
            continue;
          }
          await indexRecursive(fullPath);
          continue;
        }

        // Check extension
        if (!extensions.some(ext => entry.name.endsWith(ext))) {
          skipped++;
          continue;
        }

        try {
          const content = await readFile(fullPath, 'utf-8');
          await this.indexFile(relPath, content, { language: this.detectLanguage(entry.name) });
          indexed++;

          if (indexed % 100 === 0) {
            logger.info('Indexing progress', { indexed, skipped, errors });
          }
        } catch (error: any) {
          errors++;
          logger.warn('Failed to index file', { path: relPath, error: error.message });
        }
      }
    };

    await indexRecursive(rootPath);

    logger.info('Directory indexing complete', { indexed, skipped, errors });

    return { indexed, skipped, errors };
  }

  /**
   * Search code by keyword
   */
  search(query: string, options?: {
    language?: string;
    symbolType?: string;
    limit?: number;
  }): SearchResult[] {
    const limit = options?.limit || 50;
    const results: SearchResult[] = [];

    // Search in file content (full-text)
    const fileQuery = `
      SELECT * FROM repo_index
      WHERE content LIKE ?
      ${options?.language ? 'AND language = ?' : ''}
      LIMIT ?
    `;

    const fileParams = options?.language
      ? [`%${query}%`, options.language, limit]
      : [`%${query}%`, limit];

    const files = this.db.prepare(fileQuery).all(...fileParams) as any[];

    for (const file of files) {
      const indexedFile: IndexedFile = {
        ...file,
        symbols: JSON.parse(file.symbols || '[]'),
        keywords: JSON.parse(file.keywords || '[]'),
        embeddings: file.embeddings ? JSON.parse(file.embeddings) : undefined,
      };

      // Find matching lines
      const lines = indexedFile.content.split('\n');
      const matches: MatchInfo[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push({
            type: 'keyword',
            line: i + 1,
            text: line.trim(),
            score: this.calculateMatchScore(line, query),
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          file: indexedFile,
          score: Math.max(...matches.map(m => m.score)),
          matches,
        });
      }
    }

    // Search in symbols
    if (options?.symbolType) {
      const symbolQuery = `
        SELECT rs.*, ri.path as file_path
        FROM repo_symbols rs
        JOIN repo_index ri ON rs.file_id = ri.id
        WHERE rs.name LIKE ?
        ${options?.symbolType ? 'AND rs.type = ?' : ''}
        LIMIT ?
      `;

      const symbolParams = options?.symbolType
        ? [`%${query}%`, options.symbolType, limit]
        : [`%${query}%`, limit];

      const symbols = this.db.prepare(symbolQuery).all(...symbolParams) as any[];

      for (const symbol of symbols) {
        results.push({
          file: {
            id: symbol.file_id,
            path: symbol.file_path,
            content: '',
            language: '',
            symbols: [],
            keywords: [],
            indexedAt: 0,
            size: 0,
          },
          score: 1.0,
          matches: [{
            type: 'symbol',
            line: symbol.line,
            text: `${symbol.name} (${symbol.type})`,
            score: 1.0,
          }],
        });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Search by symbol name
   */
  searchSymbol(name: string, options?: { type?: string }): SearchResult[] {
    const query = `
      SELECT rs.*, ri.path as file_path, ri.content, ri.language
      FROM repo_symbols rs
      JOIN repo_index ri ON rs.file_id = ri.id
      WHERE rs.name = ?
      ${options?.type ? 'AND rs.type = ?' : ''}
    `;

    const params = options?.type ? [name, options.type] : [name];
    const symbols = this.db.prepare(query).all(...params) as any[];

    return symbols.map(symbol => ({
      file: {
        id: symbol.file_id,
        path: symbol.file_path,
        content: symbol.content,
        language: symbol.language,
        symbols: JSON.parse(symbol.symbols || '[]'),
        keywords: JSON.parse(symbol.keywords || '[]'),
        indexedAt: symbol.indexed_at,
        size: symbol.size,
      },
      score: 1.0,
      matches: [{
        type: 'symbol',
        line: symbol.line,
        text: `${symbol.name} (${symbol.type})${symbol.signature ? ': ' + symbol.signature : ''}`,
        score: 1.0,
      }],
    }));
  }

  /**
   * Get indexed file count
   */
  getIndexStats(): { totalFiles: number; totalSymbols: number; languages: Record<string, number> } {
    const totalFiles = this.db.prepare('SELECT COUNT(*) as count FROM repo_index').get() as { count: number };
    const totalSymbols = this.db.prepare('SELECT COUNT(*) as count FROM repo_symbols').get() as { count: number };

    const languages = this.db.prepare(`
      SELECT language, COUNT(*) as count
      FROM repo_index
      GROUP BY language
    `).all() as { language: string; count: number }[];

    return {
      totalFiles: totalFiles.count,
      totalSymbols: totalSymbols.count,
      languages: Object.fromEntries(languages.map(l => [l.language, l.count])),
    };
  }

  /**
   * Clear index
   */
  clearIndex(): void {
    this.db.exec('DELETE FROM repo_symbols');
    this.db.exec('DELETE FROM repo_index');
    logger.info('Repo index cleared');
  }

  // Helper methods

  private generateId(path: string): string {
    return `file_${Buffer.from(path).toString('base64').replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript-react',
      js: 'javascript',
      jsx: 'javascript-react',
      py: 'python',
      rs: 'rust',
      go: 'go',
      rb: 'ruby',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      h: 'c-header',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      ex: 'elixir',
      exs: 'elixir',
      erl: 'erlang',
      hs: 'haskell',
      ml: 'ocaml',
      r: 'r',
      R: 'r',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      fish: 'shell',
      md: 'markdown',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
    };
    return languageMap[ext || ''] || 'unknown';
  }

  private extractSymbols(content: string, language: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = content.split('\n');

    // Simple regex-based symbol extraction
    // For production, use proper AST parser (tree-sitter, babel, etc.)

    interface PatternInfo {
      pattern: RegExp;
      type: SymbolInfo['type'];
    }

    const patterns: Record<string, PatternInfo[]> = {
      typescript: [
        { pattern: /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g, type: 'function' },
        { pattern: /export\s+class\s+(\w+)/g, type: 'class' },
        { pattern: /export\s+interface\s+(\w+)/g, type: 'interface' },
        { pattern: /export\s+(?:const|let|var)\s+(\w+)/g, type: 'variable' },
        { pattern: /export\s+type\s+(\w+)/g, type: 'type' },
      ],
      python: [
        { pattern: /def\s+(\w+)\s*\(([^)]*)\)/g, type: 'function' },
        { pattern: /class\s+(\w+)/g, type: 'class' },
      ],
      rust: [
        { pattern: /fn\s+(\w+)\s*\(([^)]*)\)/g, type: 'function' },
        { pattern: /struct\s+(\w+)/g, type: 'class' },
        { pattern: /trait\s+(\w+)/g, type: 'interface' },
      ],
    };

    const langPatterns = patterns[language] || patterns.typescript;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of langPatterns) {
        const regex = pattern.pattern;
        const type = pattern.type;

        let match;
        while ((match = regex.exec(line)) !== null) {
          symbols.push({
            name: match[1],
            type,
            line: i + 1,
            column: match.index + 1,
            signature: match[2] || undefined,
          });
        }
      }
    }

    return symbols;
  }

  private extractKeywords(content: string, symbols: SymbolInfo[]): string[] {
    const keywords = new Set<string>();

    // Add symbol names
    for (const symbol of symbols) {
      keywords.add(symbol.name.toLowerCase());
    }

    // Extract common programming keywords
    const commonKeywords = [
      'function', 'class', 'interface', 'type', 'const', 'let', 'var',
      'import', 'export', 'from', 'return', 'async', 'await',
      'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue',
      'try', 'catch', 'finally', 'throw', 'error',
      'string', 'number', 'boolean', 'array', 'object', 'null', 'undefined',
    ];

    for (const keyword of commonKeywords) {
      if (content.toLowerCase().includes(keyword)) {
        keywords.add(keyword);
      }
    }

    return Array.from(keywords);
  }

  private async generateEmbeddings(content: string): Promise<number[]> {
    // Check cache first — avoids re-embedding unchanged content during incremental indexing
    const hash = contentHash(content);
    const cached = embeddingCache.get<number[]>(hash);
    if (cached) return cached;

    try {
      const provider = getEmbeddingProvider();
      const result = await provider.embed(content);

      // Store in cache (24h TTL for repo content — content rarely changes)
      embeddingCache.set(hash, result, 24 * 60 * 60 * 1000);
      return result;
    } catch (error: any) {
      logger.warn('Embedding generation failed, using hash fallback', { error: error.message });
      // Hash fallback so indexing never blocks on a missing provider
      const vectorSize = 384;
      const vector = new Array(vectorSize).fill(0);
      for (let i = 0; i < content.length && i < vectorSize; i++) {
        vector[i] = content.charCodeAt(i) / 255;
      }
      // Cache the fallback vector too
      embeddingCache.set(hash, vector, 24 * 60 * 60 * 1000);
      return vector;
    }
  }

  private calculateMatchScore(line: string, query: string): number {
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Exact match gets highest score
    if (lowerLine === lowerQuery) return 1.0;

    // Contains query
    if (lowerLine.includes(lowerQuery)) {
      // Prefer matches at start of line
      const index = lowerLine.indexOf(lowerQuery);
      return 1.0 - (index / line.length) * 0.5;
    }

    // Fuzzy match
    let score = 0;
    let queryIndex = 0;

    for (let i = 0; i < line.length && queryIndex < query.length; i++) {
      if (line[i].toLowerCase() === query[queryIndex].toLowerCase()) {
        score += 1.0 / query.length;
        queryIndex++;
      }
    }

    return score * 0.8; // Reduce fuzzy match score
  }
}

/**
 * Singleton indexer instance
 */
export const repoIndexer = new RepoIndexer();
