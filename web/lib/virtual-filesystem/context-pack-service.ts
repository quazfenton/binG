/**
 * Context Pack Service for VFS
 * 
 * Bundles Virtual Filesystem structure and contents into dense, LLM-friendly formats.
 * Inspired by tools like Repomix and Gitingest.
 * 
 * Features:
 * - Directory tree visualization
 * - File content bundling in multiple formats (markdown, XML, JSON, plain text)
 * - Configurable file filtering (include/exclude patterns)
 * - Size limits and truncation for large files
 * - Token count estimation
 */

import { virtualFilesystem } from './virtual-filesystem-service';
import type { VirtualFilesystemDirectoryListing } from './filesystem-types';
import { getProjectServices } from '@/lib/project-context';
import { contentHash } from '@/lib/cache';

export type ContextPackFormat = 'markdown' | 'xml' | 'json' | 'plain';

export interface ContextPackOptions {
  /** Output format for the context pack */
  format?: ContextPackFormat;
  /** Maximum file size to include (bytes). Files larger will be truncated. */
  maxFileSize?: number;
  /** Maximum total context pack size (bytes) */
  maxTotalSize?: number;
  /** File patterns to include (glob-style, e.g. ['*.ts', 'src/**']) */
  includePatterns?: string[];
  /** File patterns to exclude (glob-style, e.g. ['*.log', 'node_modules/**']) */
  excludePatterns?: string[];
  /** Include file contents (default: true) */
  includeContents?: boolean;
  /** Include directory tree (default: true) */
  includeTree?: boolean;
  /** Truncate file contents to this many lines */
  maxLinesPerFile?: number;
  /** Add line numbers to file contents */
  lineNumbers?: boolean;
}

export interface ContextPackFile {
  path: string;
  size: number;
  lines: number;
  content?: string;
  truncated?: boolean;
  error?: string;
}

export interface ContextPackResult {
  /** Directory tree as a string */
  tree: string;
  /** Files included in the pack */
  files: ContextPackFile[];
  /** The bundled context as a single string */
  bundle: string;
  /** Format used */
  format: ContextPackFormat;
  /** Total size in bytes */
  totalSize: number;
  /** Estimated token count (rough approximation) */
  estimatedTokens: number;
  /** Number of files included */
  fileCount: number;
  /** Number of directories */
  directoryCount: number;
  /** Whether any files were truncated */
  hasTruncation: boolean;
  /** Warnings about the pack generation */
  warnings: string[];
}

const DEFAULT_OPTIONS: Required<ContextPackOptions> = {
  format: 'markdown',
  maxFileSize: 100 * 1024, // 100KB
  maxTotalSize: 2 * 1024 * 1024, // 2MB
  includePatterns: [],
  excludePatterns: [
    'node_modules/**',
    '.git/**',
    '.next/**',
    'dist/**',
    'build/**',
    '*.log',
    '*.lock',
    '.env*',
    '*.min.js',
    '*.min.css',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ],
  includeContents: true,
  includeTree: true,
  maxLinesPerFile: 500,
  lineNumbers: false,
};

/**
 * Context Pack Service
 * Generates dense, LLM-friendly bundles of VFS state
 *
 * Each project gets its own isolated vector store and retrieval pipeline
 * via the project-context layer.
 */
class ContextPackService {
  /**
   * Generate a context pack from the VFS with project isolation
   */
  async generateContextPack(
    ownerId: string,
    rootPath: string = '/',
    options: ContextPackOptions = {}
  ): Promise<ContextPackResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];

    // Initialize project-scoped services for this project (isolated per ownerId+rootPath)
    const projectId = `${ownerId}:${rootPath}`;
    const projectServices = getProjectServices({
      id: projectId,
      name: rootPath === '/' ? 'root' : rootPath.split('/').pop() || 'root',
      root: rootPath,
    });

    // Get directory tree
    const tree = await this.buildDirectoryTree(ownerId, rootPath, opts);

    // Get all files recursively
    const files = await this.collectFiles(ownerId, rootPath, opts, warnings);

    // Index new/changed files into project's vector store (contentHash avoids re-embedding)
    await this.indexFilesToVectorStore(projectServices, files, warnings);
    
    // Generate bundle in requested format
    let bundle = this.generateBundle(tree, files, opts);

    // Calculate metrics
    const encoder = new TextEncoder();
    let totalSize = encoder.encode(bundle).length;
    const originalSize = totalSize;

    if (opts.maxTotalSize && totalSize > opts.maxTotalSize) {
      // Truncate bundle to exactly maxTotalSize bytes (not characters)
      // This handles UTF-8 multibyte characters correctly
      let end = bundle.length;
      while (end > 0 && encoder.encode(bundle.slice(0, end)).length > opts.maxTotalSize) {
        end--;
      }
      bundle = bundle.slice(0, end);
      totalSize = encoder.encode(bundle).length;
      warnings.push(
        `Context pack truncated to approximately ${opts.maxTotalSize} bytes (original size ${originalSize} bytes)`
      );
    }

    // FIX Bug 25: Use JS string length (code points) for better token estimation
    // UTF-8 byte length over-estimates tokens for Unicode-heavy content (CJK, emoji, etc.)
    // 1 token ≈ 4 characters is more accurate for typical code
    const estimatedTokens = Math.ceil(bundle.length / 4);
    const hasTruncation = files.some(f => f.truncated) || totalSize < originalSize;

    return {
      tree,
      files,
      bundle,
      format: opts.format,
      totalSize,
      estimatedTokens,
      fileCount: files.length,
      directoryCount: this.countDirectories(tree),
      hasTruncation,
      warnings,
    };
  }
  
  /**
   * Build directory tree as a string (similar to `tree` command)
   * FIX Bug 24: Use consistent path normalization
   */
  private async buildDirectoryTree(
    ownerId: string,
    rootPath: string,
    options: Required<ContextPackOptions>,
    depth: number = 0,
    prefix: string = ''
  ): Promise<string> {
    let tree = '';

    try {
      const listing = await virtualFilesystem.listDirectory(ownerId, rootPath);
      const entries = listing.nodes || [];

      // Filter entries based on patterns
      const filtered = this.filterEntries(entries, rootPath, options);

      for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i];
        const isLast = i === filtered.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const extension = isLast ? '    ' : '│   ';

        tree += `${prefix}${connector}${entry.name}${entry.type === 'directory' ? '/' : ''}\n`;

        // Recurse into directories (max depth 10)
        if (entry.type === 'directory' && depth < 10) {
          // FIX Bug 24: Use consistent path construction matching VFS internal logic
          // Since normalizePath is private, we replicate its logic here for consistency
          const normalizePath = (p: string): string => {
            const rawPath = (p || '').replace(/\\/g, '/').trim();
            if (!rawPath || rawPath === '/') return '/';
            return rawPath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
          };
          const childPath = normalizePath(
            rootPath === '/' ? `/${entry.name}` : `${rootPath}/${entry.name}`
          );
          tree += await this.buildDirectoryTree(
            ownerId,
            childPath,
            options,
            depth + 1,
            prefix + extension
          );
        }
      }
    } catch (error) {
      // Directory might not exist or be inaccessible
      if (depth === 0) {
        tree = `(error reading directory: ${error instanceof Error ? error.message : 'unknown'})\n`;
      }
    }
    
    return tree;
  }
  
  /**
   * Collect all files recursively with contents
   */
  private async collectFiles(
    ownerId: string,
    rootPath: string,
    options: Required<ContextPackOptions>,
    warnings: string[]
  ): Promise<ContextPackFile[]> {
    const files: ContextPackFile[] = [];
    
    await this.collectFilesRecursive(ownerId, rootPath, options, files, warnings);
    
    // Sort files by path for consistent output
    files.sort((a, b) => a.path.localeCompare(b.path));
    
    return files;
  }
  
  private async collectFilesRecursive(
    ownerId: string,
    currentPath: string,
    options: Required<ContextPackOptions>,
    files: ContextPackFile[],
    warnings: string[]
  ): Promise<void> {
    try {
      const listing = await virtualFilesystem.listDirectory(ownerId, currentPath);
      const entries = listing.nodes || [];
      
      // Filter entries
      const filtered = this.filterEntries(entries, currentPath, options);
      
      for (const entry of filtered) {
        const fullPath = currentPath === '/' 
          ? `/${entry.name}` 
          : `${currentPath}/${entry.name}`;
        
        if (entry.type === 'directory') {
          // Recurse into directory
          await this.collectFilesRecursive(ownerId, fullPath, options, files, warnings);
        } else if (entry.type === 'file') {
          // Check if file should be included
          if (!this.matchesPatterns(fullPath, options.includePatterns) && options.includePatterns.length > 0) {
            continue;
          }
          
          // Read file content
          try {
            const file = await virtualFilesystem.readFile(ownerId, fullPath);
            let content = file.content;
            let truncated = false;
            
            // Check file size
            const size = new TextEncoder().encode(content).length;
            if (size > options.maxFileSize) {
              content = content.slice(0, options.maxFileSize);
              truncated = true;
              warnings.push(`File truncated: ${fullPath} (${size} bytes > ${options.maxFileSize} bytes limit)`);
            }
            
            // Count lines
            const lines = content.split('\n').length;
            if (options.maxLinesPerFile && lines > options.maxLinesPerFile) {
              content = content.split('\n').slice(0, options.maxLinesPerFile).join('\n');
              truncated = true;
              warnings.push(`File truncated: ${fullPath} (${lines} lines > ${options.maxLinesPerFile} lines limit)`);
            }
            
            // Add line numbers if requested
            if (options.lineNumbers && content) {
              const lines = content.split('\n');
              content = lines.map((line, i) => `${(i + 1).toString().padStart(4)}: ${line}`).join('\n');
            }
            
            files.push({
              path: fullPath,
              size: new TextEncoder().encode(content).length,
              lines: content.split('\n').length,
              content: options.includeContents ? content : undefined,
              truncated,
            });
          } catch (error) {
            files.push({
              path: fullPath,
              size: 0,
              lines: 0,
              error: error instanceof Error ? error.message : 'Failed to read file',
            });
          }
        }
      }
    } catch (error) {
      // Directory might not exist
    }
  }
  
  /**
   * Generate the final bundle in the requested format
   */
  private generateBundle(
    tree: string,
    files: ContextPackFile[],
    options: Required<ContextPackOptions>
  ): string {
    switch (options.format) {
      case 'markdown':
        return this.generateMarkdownBundle(tree, files, options);
      case 'xml':
        return this.generateXmlBundle(tree, files, options);
      case 'json':
        return this.generateJsonBundle(tree, files, options);
      case 'plain':
        return this.generatePlainBundle(tree, files, options);
      default:
        return this.generateMarkdownBundle(tree, files, options);
    }
  }
  
  /**
   * Generate Markdown format bundle
   */
  private generateMarkdownBundle(
    tree: string,
    files: ContextPackFile[],
    options: Required<ContextPackOptions>
  ): string {
    let bundle = '';
    
    // Header
    bundle += `# Project Context Pack\n\n`;
    bundle += `**Format:** Markdown\n`;
    bundle += `**Files:** ${files.length}\n`;
    bundle += `**Generated:** ${new Date().toISOString()}\n\n`;
    
    // Directory Tree
    if (options.includeTree) {
      bundle += `## Directory Structure\n\n`;
      bundle += '```\n';
      bundle += tree;
      bundle += '```\n\n';
    }
    
    // File Contents
    if (options.includeContents && files.length > 0) {
      bundle += `## File Contents\n\n`;
      
      for (const file of files) {
        bundle += `### ${file.path}\n\n`;
        
        if (file.error) {
          bundle += `⚠️ Error: ${file.error}\n\n`;
        } else if (file.content !== undefined) {
          const ext = file.path.split('.').pop() || '';
          bundle += '```';
          bundle += ext;
          bundle += '\n';
          bundle += file.content;
          bundle += '\n```\n\n';
          
          if (file.truncated) {
            bundle += `⚠️ *File truncated*\n\n`;
          }
        }
      }
    }
    
    return bundle;
  }
  
  /**
   * Generate XML format bundle (Repomix-style)
   */
  private generateXmlBundle(
    tree: string,
    files: ContextPackFile[],
    options: Required<ContextPackOptions>
  ): string {
    let bundle = '';
    
    bundle += `<?xml version="1.0" encoding="UTF-8"?>\n`;
    bundle += `<context_pack>\n`;
    bundle += `  <meta>\n`;
    bundle += `    <format>XML</format>\n`;
    bundle += `    <file_count>${files.length}</file_count>\n`;
    bundle += `    <generated>${new Date().toISOString()}</generated>\n`;
    bundle += `  </meta>\n\n`;
    
    // Directory Tree
    if (options.includeTree) {
      bundle += `  <directory_tree>\n`;
      bundle += `    <![CDATA[\n${tree}    ]]>\n`;
      bundle += `  </directory_tree>\n\n`;
    }
    
    // File Contents
    if (options.includeContents && files.length > 0) {
      bundle += `  <files>\n`;
      
      for (const file of files) {
        bundle += `    <file path="${this.escapeXml(file.path)}">\n`;
        
        if (file.error) {
          bundle += `      <error>${this.escapeXml(file.error)}</error>\n`;
        } else if (file.content !== undefined) {
          bundle += `      <size>${file.size}</size>\n`;
          bundle += `      <lines>${file.lines}</lines>\n`;
          if (file.truncated) {
            bundle += `      <truncated>true</truncated>\n`;
          }
          bundle += `      <content>\n`;
          bundle += `        <![CDATA[\n${file.content}\n        ]]>\n`;
          bundle += `      </content>\n`;
        }
        
        bundle += `    </file>\n`;
      }
      
      bundle += `  </files>\n`;
    }
    
    bundle += `</context_pack>\n`;
    
    return bundle;
  }
  
  /**
   * Generate JSON format bundle
   */
  private generateJsonBundle(
    tree: string,
    files: ContextPackFile[],
    options: Required<ContextPackOptions>
  ): string {
    const data = {
      meta: {
        format: 'JSON',
        fileCount: files.length,
        generated: new Date().toISOString(),
      },
      tree: options.includeTree ? tree : null,
      files: options.includeContents ? files : files.map(f => ({
        path: f.path,
        size: f.size,
        lines: f.lines,
        truncated: f.truncated,
        error: f.error,
      })),
    };
    
    return JSON.stringify(data, null, 2);
  }
  
  /**
   * Generate plain text format bundle
   */
  private generatePlainBundle(
    tree: string,
    files: ContextPackFile[],
    options: Required<ContextPackOptions>
  ): string {
    let bundle = '';
    
    bundle += `=== PROJECT CONTEXT PACK ===\n`;
    bundle += `Format: Plain Text\n`;
    bundle += `Files: ${files.length}\n`;
    bundle += `Generated: ${new Date().toISOString()}\n\n`;
    
    // Directory Tree
    if (options.includeTree) {
      bundle += `=== DIRECTORY STRUCTURE ===\n\n`;
      bundle += tree;
      bundle += `\n`;
    }
    
    // File Contents
    if (options.includeContents && files.length > 0) {
      bundle += `\n=== FILE CONTENTS ===\n\n`;
      
      for (const file of files) {
        bundle += `--- FILE: ${file.path} ---\n`;
        
        if (file.error) {
          bundle += `ERROR: ${file.error}\n`;
        } else if (file.content !== undefined) {
          bundle += file.content;
          bundle += '\n';
          
          if (file.truncated) {
            bundle += `[FILE TRUNCATED]\n`;
          }
        }
        
        bundle += '\n';
      }
    }
    
    bundle += `\n=== END OF CONTEXT PACK ===\n`;
    
    return bundle;
  }
  
  /**
   * Filter directory entries based on include/exclude patterns
   */
  private filterEntries(
    entries: Array<{ name: string; type: string }>,
    currentPath: string,
    options: Required<ContextPackOptions>
  ): Array<{ name: string; type: string }> {
    return entries.filter(entry => {
      const fullPath = currentPath === '/' 
        ? `/${entry.name}` 
        : `${currentPath}/${entry.name}`;
      
      // Check exclude patterns
      if (this.matchesPatterns(fullPath, options.excludePatterns)) {
        return false;
      }
      
      // Check include patterns (if specified)
      if (options.includePatterns.length > 0) {
        return this.matchesPatterns(fullPath, options.includePatterns);
      }
      
      return true;
    });
  }
  
  /**
   * Check if a path matches any of the given glob patterns
   */
  private matchesPatterns(path: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchGlob(path, pattern)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Simple glob pattern matching (supports * and **)
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const normalizedPath = path.replace(/^\/+/, '');
    const normalizedPattern = pattern.replace(/^\/+/, '');
    let regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    regexPattern = `^${regexPattern}$`;
    try {
      const regex = new RegExp(regexPattern);
      return regex.test(normalizedPath);
    } catch {
      return false;
    }
  }
  
  /**
   * Count directories in tree string
   * Counts lines with tree connector characters (├ or └) which represent entries
   */
  private countDirectories(tree: string): number {
    // Count actual directory entries (lines with tree connectors)
    const treeEntryLines = tree.split('\n').filter(
      line => line.includes('├──') || line.includes('└──')
    );
    return treeEntryLines.length;
  }

  /**
   * Index files into project's vector store using content hash for dedup
   * Skips files that haven't changed since last indexing
   */
  private async indexFilesToVectorStore(
    services: ReturnType<typeof getProjectServices>,
    files: ContextPackFile[],
    warnings: string[]
  ): Promise<void> {
    // Filter files with content and chunk them
    const chunksToIndex: { id: string; text: string; filePath: string; hash: string }[] = [];

    for (const file of files) {
      if (!file.content) continue;

      try {
        const hash = contentHash(file.content);
        const docId = `file:${file.path}`;

        // Check if file already indexed
        const existingCount = await services.vectorStore.count({ source: 'context-pack', filePath: file.path });
        if (existingCount > 0) continue; // Already indexed, skip

        // Chunk file content for better retrieval
        const lines = file.content.split('\n');
        const chunkSize = 50;

        for (let i = 0; i < lines.length; i += chunkSize) {
          const chunk = lines.slice(i, i + chunkSize).join('\n');
          if (chunk.trim()) {
            chunksToIndex.push({
              id: lines.length <= 1 ? docId : `${docId}#${i}`,
              text: chunk,
              filePath: file.path,
              hash,
            });
          }
        }
      } catch (e) {
        warnings.push(`Failed to prepare ${file.path} for indexing: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (chunksToIndex.length === 0) return;

    try {
      // Embed all chunks in batch using the retrieval pipeline's embedder
      const texts = chunksToIndex.map((c) => c.text);
      const embedder = services.retrieval['embedder'] as { embedBatch?: (texts: string[]) => Promise<number[][]>; embed: (text: string) => Promise<number[]> };
      const embeddings = embedder.embedBatch
        ? await embedder.embedBatch(texts)
        : await Promise.all(texts.map((t) => embedder.embed(t)));

      // Build vector entries
      const entries = chunksToIndex.map((chunk, i) => ({
        id: chunk.id,
        text: chunk.text,
        embedding: embeddings[i],
        metadata: {
          source: 'context-pack',
          filePath: chunk.filePath,
          hash: chunk.hash,
          projectId: services.context.id,
          indexedAt: Date.now(),
        },
      }));

      // Add to vector store
      await services.vectorStore.addBatch(entries);
    } catch (e) {
      warnings.push(`Failed to index ${chunksToIndex.length} chunks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const contextPackService = new ContextPackService();
