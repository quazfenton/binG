/**
 * Smart Context Pack Generator
 *
 * Intelligently selects and ranks files for LLM context based on:
 * - Explicit @mentions (highest weight)
 * - Manual attachments (highest weight)
 * - Prompt keyword matching with extension detection
 * - Session awareness (recent projects ranked higher)
 * - Import tree awareness (related files get slight boost)
 * - Empty VFS graceful handling
 *
 * Usage:
 * ```ts
 * const context = await generateSmartContext({
 *   userId: 'user-123',
 *   prompt: 'Fix the bug in App.tsx',
 *   conversationId: 'sess-001',
 *   explicitFiles: ['src/App.tsx'],  // from @mentions or manual attachments
 *   messageHistory: [...],  // for session awareness
 * });
 * ```
 */

import { virtualFilesystem } from './virtual-filesystem-service';
import type { VirtualFile, VirtualFilesystemNode } from './filesystem-types';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SmartContext');

export interface SmartContextOptions {
  /** User ID for VFS access */
  userId: string;
  /** User's current prompt message */
  prompt: string;
  /** Conversation/session ID */
  conversationId?: string;
  /** Explicitly attached files (from @mentions or manual attachment) */
  explicitFiles?: string[];
  /** Files referenced in recent conversation messages (for session awareness) */
  recentSessionFiles?: string[];
  /** Current project root path (to prioritize files in this project) */
  currentProjectPath?: string;
  /** Maximum total context size in bytes */
  maxTotalSize?: number;
  /** Output format */
  format?: 'markdown' | 'xml' | 'json' | 'plain';
  /** Maximum lines per file */
  maxLinesPerFile?: number;
}

export interface FileScore {
  path: string;
  score: number;
  reasons: string[];
}

export interface SmartContextResult {
  /** The formatted context bundle */
  bundle: string;
  /** Directory tree */
  tree: string;
  /** Files included, ranked by relevance */
  rankedFiles: FileScore[];
  /** Total file count in VFS */
  totalFilesInVfs: number;
  /** Files included in context */
  filesIncluded: number;
  /** Estimated token count */
  estimatedTokens: number;
  /** Whether VFS was empty */
  vfsIsEmpty: boolean;
  /** Warnings during generation */
  warnings: string[];
}

/**
 * Score thresholds for file inclusion
 */
const SCORE_THRESHOLDS = {
  /** Explicit @mention or manual attachment — always included */
  EXPLICIT: 1000,
  /** Exact filename match in prompt */
  EXACT_MATCH: 500,
  /** Extension match in prompt (e.g., ".tsx" mentioned) */
  EXTENSION_MATCH: 200,
  /** Keyword match in filename */
  KEYWORD_MATCH: 100,
  /** Same directory as explicit file */
  SAME_DIR: 50,
  /** Imported by or imports an explicit file */
  IMPORT_RELATED: 75,
  /** Recent session file (last modified recently) */
  RECENT: 30,
  /** Base score for all files (ensures small VFS gets included) */
  BASE: 10,
} as const;

/**
 * Extract file-related signals from user prompt
 */
function extractPromptSignals(prompt: string): {
  extensions: Set<string>;
  keywords: Set<string>;
  possiblePaths: string[];
  hasAtMention: boolean;
  atMentionedFiles: string[]; // Track specific @mentioned filenames
} {
  const extensions = new Set<string>();
  const keywords = new Set<string>();
  const possiblePaths: string[] = [];
  const atMentionedFiles: string[] = [];
  let hasAtMention = false;

  // Normalize prompt
  const lower = prompt.toLowerCase();

  // Detect @mentions and extract filenames
  // Pattern: @filename.ext or @path/to/file.ext
  const atMentionPattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;
  for (const match of prompt.matchAll(atMentionPattern)) {
    hasAtMention = true;
    const mentionedFile = match[1];
    atMentionedFiles.push(mentionedFile);
    possiblePaths.push(mentionedFile.toLowerCase());
    const ext = mentionedFile.split('.').pop();
    if (ext) extensions.add(`.${ext}`);
  }

  // Extract file-like patterns: words with extensions (without @)
  const filePattern = /[\w-]+\.(tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)/gi;
  for (const match of prompt.matchAll(filePattern)) {
    const filename = match[0].toLowerCase();
    possiblePaths.push(filename);
    const ext = filename.split('.').pop();
    if (ext) extensions.add(`.${ext}`);
    // The base name without extension is a keyword
    const base = filename.split('.')[0];
    if (base.length > 2) keywords.add(base);
  }

  // Detect standalone extensions mentioned
  const extPattern = /\.(tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)\b/gi;
  for (const match of prompt.matchAll(extPattern)) {
    extensions.add(match[0].toLowerCase());
  }

  // Extract meaningful keywords (excluding common stop words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'if', 'when', 'where', 'what', 'which', 'who', 'whom', 'how', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'i', 'my', 'me']);
  for (const word of lower.split(/[\s,;:.!?(){}[\]<>]+/)) {
    if (word.length > 3 && !stopWords.has(word) && !/^\d+$/.test(word)) {
      keywords.add(word);
    }
  }

  return { extensions, keywords, possiblePaths, hasAtMention, atMentionedFiles };
}

/**
 * Check if file extension is a JavaScript/TypeScript variant
 */
function isJSLanguage(ext: string): boolean {
  return ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext);
}

/**
 * Check if an import path is external (package, stdlib, etc.) based on language
 */
function isExternalImport(rawPath: string, sourceExt: string): boolean {
  // Relative imports (starting with . or /) always reference local files
  if (rawPath.startsWith('.')) return false;
  if (rawPath.startsWith('/')) return false;

  // JS/TS: bare imports are packages (react, lodash, @scope/pkg)
  if (isJSLanguage(sourceExt)) {
    return true;
  }

  // Python: imports without leading dot are packages
  if (sourceExt === 'py') {
    return true;
  }

  // Rust: imports without crate::/super::/self:: are external crates
  if (sourceExt === 'rs') {
    return true;
  }

  // Go: imports without . are external packages
  if (sourceExt === 'go') {
    return true;
  }

  // Java: fully qualified imports are external
  if (sourceExt === 'java') {
    return true;
  }

  // CSS/SCSS: relative imports are local, others may be external
  if (sourceExt === 'css' || sourceExt === 'scss') {
    return false; // Already filtered by regex (only matches quoted paths)
  }

  // C/C++: <angle> brackets are system headers (already filtered by regex)
  // "quotes" are local — let them through
  if (['c', 'cpp', 'h', 'hpp'].includes(sourceExt)) {
    return false;
  }

  // Default: assume external for safety
  return true;
}

/**
 * Resolve a raw import path to an actual VFS file path.
 * Handles:
 * - Relative paths: ./utils, ../components/Header
 * - Extensionless imports: ./utils → ./utils.ts or ./utils/index.ts
 * - Absolute VFS paths: /src/utils.ts
 * - Index file resolution: ./components → ./components/index.ts
 */
function resolveImportPath(
  rawPath: string,
  sourceDir: string,
  allFilePathsLower: Set<string>,
  allFilePathsOriginal: Map<string, string>
): string | null {
  const candidates: string[] = [];

  if (rawPath.startsWith('/')) {
    // Absolute VFS path
    candidates.push(rawPath);
  } else if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
    // Relative path — resolve against source file's directory
    const baseParts = sourceDir === '/' ? [''] : sourceDir.split('/');
    const rawParts = rawPath.split('/');

    for (const part of rawParts) {
      if (part === '..') {
        if (baseParts.length > 1) baseParts.pop();
      } else if (part !== '.' && part !== '') {
        baseParts.push(part);
      }
    }

    const resolvedPath = baseParts.join('/').replace(/^\/+/, '/') || '/';
    candidates.push(resolvedPath);
  } else {
    // Bare package import (react, lodash, os, etc.) — skip
    return null;
  }

  // Common extensions to try for extensionless imports (ordered by likelihood)
  const jsExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs'];
  const pyExtensions = ['', '.py'];
  const rsExtensions = ['', '.rs'];
  const goExtensions = ['', '.go'];
  const cssExtensions = ['', '.css', '.scss'];
  const otherExtensions = ['', '.json', '.md', '.yaml', '.yml', '.toml'];

  // Try each candidate with appropriate extensions
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();

    // Direct match (case-insensitive)
    if (allFilePathsLower.has(candidateLower)) {
      return allFilePathsOriginal.get(candidateLower) || candidate;
    }

    // Try with extensions — try all languages since imports can cross boundaries
    const allExts = [...jsExtensions, ...pyExtensions, ...rsExtensions, ...cssExtensions, ...otherExtensions];
    for (const ext of allExts) {
      const withExt = candidate + ext;
      const withExtLower = withExt.toLowerCase();
      if (allFilePathsLower.has(withExtLower)) {
        return allFilePathsOriginal.get(withExtLower) || withExt;
      }
    }

    // Try as directory with index file
    const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.py', '__init__.py', 'index.css', 'mod.rs'];
    for (const indexFile of indexFiles) {
      const indexPath = candidate.endsWith('/') ? candidate + indexFile : candidate + '/' + indexFile;
      const indexPathLower = indexPath.toLowerCase();
      if (allFilePathsLower.has(indexPathLower)) {
        return allFilePathsOriginal.get(indexPathLower) || indexPath;
      }
    }
  }

  return null;
}

/**
 * Extract raw import paths from file content based on language.
 * Returns raw strings like './utils', '../components/Header', 'react', etc.
 */
function extractRawImports(content: string, sourceExt: string): Set<string> {
  const rawImports = new Set<string>();

  // ========================================================================
  // JavaScript / TypeScript
  // ========================================================================
  if (isJSLanguage(sourceExt)) {
    // ES module imports: import X from 'path', import { X } from 'path', import 'path'
    for (const match of content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)) {
      rawImports.add(match[1]);
    }
    // CommonJS: require('path')
    for (const match of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      rawImports.add(match[1]);
    }
    // Dynamic imports: import('path')
    for (const match of content.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      rawImports.add(match[1]);
    }
  }

  // ========================================================================
  // Python
  // ========================================================================
  if (sourceExt === 'py') {
    // from .module import X, from ..package.module import X
    for (const match of content.matchAll(/from\s+(\.{1,3}[\w.]*)\s+import/g)) {
      // Convert Python dot-notation to path: .utils.helpers → ./utils/helpers
      const dotPath = match[1];
      const slashPath = dotPath.replace(/\./g, '/');
      rawImports.add(slashPath.startsWith('//') ? slashPath.slice(1) : slashPath);
    }
    // import .module, import ..package.module
    for (const match of content.matchAll(/^\s*import\s+(\.{1,3}[\w.]*)/gm)) {
      const dotPath = match[1];
      const slashPath = dotPath.replace(/\./g, '/');
      rawImports.add(slashPath.startsWith('//') ? slashPath.slice(1) : slashPath);
    }
  }

  // ========================================================================
  // Rust
  // ========================================================================
  if (sourceExt === 'rs') {
    // use crate::module::Item → /module/Item (absolute VFS path from crate root)
    for (const match of content.matchAll(/use\s+crate(?:::[\w]+)+/g)) {
      const path = match[0].replace('use crate::', '').replace(/::/g, '/');
      rawImports.add('/' + path);
    }
    // use super::module::Item, use self::module::Item → ./module/Item (relative)
    for (const match of content.matchAll(/use\s+(?:super|self)(?:::[\w]+)+/g)) {
      const path = match[0].replace(/use\s+(?:super|self)::/, '').replace(/::/g, '/');
      rawImports.add('./' + path);
    }
    // mod module; → ./module (sibling module file)
    for (const match of content.matchAll(/^\s*mod\s+(\w+)\s*;/gm)) {
      rawImports.add('./' + match[1]);
    }
  }

  // ========================================================================
  // Go
  // ========================================================================
  if (sourceExt === 'go') {
    // import "./path" or import "../path"
    for (const match of content.matchAll(/import\s+['"](\.[^'"]+)['"]/g)) {
      rawImports.add(match[1]);
    }
    // Multi-line import blocks
    for (const match of content.matchAll(/\(\s*['"](\.[^'"]+)['"]/g)) {
      rawImports.add(match[1]);
    }
  }

  // ========================================================================
  // CSS / SCSS
  // ========================================================================
  if (sourceExt === 'css' || sourceExt === 'scss') {
    // @import './file.css'
    for (const match of content.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      rawImports.add(match[1]);
    }
    // @import url('./file.css')
    for (const match of content.matchAll(/@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      rawImports.add(match[1]);
    }
  }

  // ========================================================================
  // C / C++
  // ========================================================================
  if (['c', 'cpp', 'h', 'hpp'].includes(sourceExt)) {
    // #include "local.h" (only quotes — angle brackets are system headers)
    for (const match of content.matchAll(/#include\s+"([^"]+)"/g)) {
      rawImports.add(match[1]);
    }
  }

  // ========================================================================
  // Generic fallback (any language with import "path" syntax)
  // ========================================================================
  for (const match of content.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    rawImports.add(match[1]);
  }

  return rawImports;
}

/**
 * Scan a file's content for import statements and resolve them to VFS paths.
 * Returns resolved VFS file paths that can be matched against explicitFiles.
 */
function extractImportsFromContent(
  content: string,
  sourceFilePath: string,
  allFilePathsLower: Set<string>,
  allFilePathsOriginal: Map<string, string>
): string[] {
  const resolvedImports: string[] = [];
  const sourceExt = sourceFilePath.split('.').pop()?.toLowerCase() || '';

  // Extract raw import strings
  const rawImports = extractRawImports(content, sourceExt);

  // Resolve each raw import to a VFS path
  const sourceDir = sourceFilePath.substring(0, sourceFilePath.lastIndexOf('/')) || '/';

  for (const rawImport of rawImports) {
    // Skip external packages (react, lodash, os, std::, etc.)
    if (isExternalImport(rawImport, sourceExt)) continue;

    // Resolve to actual VFS path
    const resolved = resolveImportPath(rawImport, sourceDir, allFilePathsLower, allFilePathsOriginal);
    if (resolved) {
      resolvedImports.push(resolved);
    }
  }

  return resolvedImports;
}

/**
 * Score a file based on prompt signals and context
 */
function scoreFile(
  file: VirtualFile,
  signals: ReturnType<typeof extractPromptSignals>,
  explicitFiles: Set<string>,
  allFiles: VirtualFile[],
  importMap: Map<string, Set<string>>,
  reverseImportMap: Map<string, Set<string>>,
  recentSessionFiles?: Set<string>, // Files from recent conversation sessions
  currentProjectPath?: string, // Current project path to prioritize
): FileScore {
  const path = file.path.toLowerCase();
  const filename = path.split('/').pop() || '';
  const ext = '.' + (filename.split('.').pop() || '');
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  let score = SCORE_THRESHOLDS.BASE;
  const reasons: string[] = [];

  // 1. Explicit @mention or manual attachment (highest weight)
  if (explicitFiles.has(path) || explicitFiles.has(filename)) {
    return { path: file.path, score: SCORE_THRESHOLDS.EXPLICIT, reasons: ['explicitly attached'] };
  }

  // 2. Exact filename match in prompt
  if (signals.possiblePaths.some(p => path.includes(p) || filename.includes(p))) {
    reasons.push('exact filename match');
    score += SCORE_THRESHOLDS.EXACT_MATCH;
  }

  // 3. Extension match (higher weight if user typed extension in prompt)
  if (signals.extensions.has(ext)) {
    reasons.push(`extension match (${ext})`);
    score += SCORE_THRESHOLDS.EXTENSION_MATCH;
  }

  // 4. Keyword match in filename
  let keywordMatchCount = 0;
  for (const keyword of signals.keywords) {
    if (filename.includes(keyword) || filename.replace(/\.(tsx?|jsx?|py|rs)$/, '').includes(keyword)) {
      reasons.push(`keyword "${keyword}" in filename`);
      keywordMatchCount++;
    }
  }
  if (keywordMatchCount > 0) {
    score += SCORE_THRESHOLDS.KEYWORD_MATCH * Math.min(keywordMatchCount, 3); // Cap at 3x
  }

  // 5. Same directory as explicit file
  for (const explicit of explicitFiles) {
    const explicitDir = explicit.substring(0, explicit.lastIndexOf('/') + 1);
    if (dir === explicitDir && explicitDir.length > 0) {
      reasons.push('same directory as attached file');
      score += SCORE_THRESHOLDS.SAME_DIR;
      break;
    }
  }

  // 6. Import-related files (boost score for files in import tree)
  let importRelatedCount = 0;
  if (importMap.has(path)) {
    for (const imported of importMap.get(path)!) {
      if (explicitFiles.has(imported)) {
        reasons.push('imports an attached file');
        importRelatedCount++;
        break;
      }
    }
  }
  if (reverseImportMap.has(path)) {
    for (const importer of reverseImportMap.get(path)!) {
      if (explicitFiles.has(importer)) {
        reasons.push('imported by attached file');
        importRelatedCount++;
        break;
      }
    }
  }
  if (importRelatedCount > 0) {
    score += SCORE_THRESHOLDS.IMPORT_RELATED * importRelatedCount;
  }

  // 7. Recent session files (from conversation history)
  if (recentSessionFiles?.has(path) || recentSessionFiles?.has(filename)) {
    reasons.push('recent session file');
    score += SCORE_THRESHOLDS.RECENT;
  }

  // 8. Current project path priority (prevent editing wrong project)
  if (currentProjectPath && path.startsWith(currentProjectPath)) {
    reasons.push('current project file');
    score += 40; // Moderate boost to current project files
  }

  // If no signals matched, return zero score (file won't be included unless VFS is small)
  if (reasons.length === 0) {
    return { path: file.path, score: 0, reasons: [] };
  }

  return { path: file.path, score, reasons };
}

/**
 * Generate smart context — intelligently ranked file selection for LLM
 */
export async function generateSmartContext(options: SmartContextOptions): Promise<SmartContextResult> {
  const { 
    userId, 
    prompt, 
    conversationId, 
    explicitFiles: explicitFileList = [], 
    recentSessionFiles: recentSessionFileList = [],
    currentProjectPath,
    maxTotalSize = 500000, 
    format = 'markdown', 
    maxLinesPerFile = 500 
  } = options;
  const warnings: string[] = [];
  
  // Validate inputs
  if (!userId) {
    logger.error('userId is required');
    return {
      bundle: '',
      tree: '',
      rankedFiles: [],
      totalFilesInVfs: 0,
      filesIncluded: 0,
      estimatedTokens: 0,
      vfsIsEmpty: true,
      warnings: ['Missing userId'],
    };
  }
  
  const explicitFiles = new Set(explicitFileList.map(f => f.toLowerCase()));
  const recentSessionFiles = new Set(recentSessionFileList.map(f => f.toLowerCase()));
  const signals = extractPromptSignals(prompt || '');
  const normalizedProjectPath = currentProjectPath?.toLowerCase();

  // Collect all files from VFS
  let allFiles: VirtualFile[] = [];
  let tree = '';
  try {
    // Get directory tree
    const listing = await virtualFilesystem.listDirectory(userId, '/');
    allFiles = await collectAllFiles(userId, '/');
    tree = await buildTreeString(listing.nodes || [], '', 0, 10, userId, '/');
  } catch (e: any) {
    // VFS not initialized or empty — return minimal context
    warnings.push(`VFS access failed: ${e.message}. Returning empty context.`);
    return {
      bundle: format === 'json' ? JSON.stringify({ tree: '', files: [], note: 'No files in workspace yet.' }) :
        `--- WORKSPACE ---\nNo files in workspace yet. Create files by asking me to build something.\n--- END WORKSPACE ---\n`,
      tree: '',
      rankedFiles: [],
      totalFilesInVfs: 0,
      filesIncluded: 0,
      estimatedTokens: 15,
      vfsIsEmpty: true,
      warnings,
    };
  }

  if (allFiles.length === 0) {
    warnings.push('VFS is empty. Returning minimal context.');
    return {
      bundle: format === 'json' ? JSON.stringify({ tree, files: [], note: 'No files in workspace yet.' }) :
        `--- WORKSPACE ---\n${tree || '(empty)'}\n\nNo file contents yet. Create files by asking me to build something.\n--- END WORKSPACE ---\n`,
      tree,
      rankedFiles: [],
      totalFilesInVfs: 0,
      filesIncluded: 0,
      estimatedTokens: 15,
      vfsIsEmpty: true,
      warnings,
    };
  }

  // Build import map for relationship scoring (lazy - only read files that are likely candidates)
  const importMap = new Map<string, Set<string>>();
  const reverseImportMap = new Map<string, Set<string>>();

  try {
    // Pre-compute file path lookup maps for import resolution
    const allFilePathsLower = new Set<string>();
    const allFilePathsOriginal = new Map<string, string>();
    for (const file of allFiles) {
      const lower = file.path.toLowerCase();
      allFilePathsLower.add(lower);
      allFilePathsOriginal.set(lower, file.path);
    }

    // Only build import map if we have explicit files or few total files
    const codeExtensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'java'];
    const filesToScanForImports = allFiles.length <= 20
      ? allFiles
      : allFiles.filter(f => {
          const ext = f.path.split('.').pop()?.toLowerCase();
          return codeExtensions.includes(ext || '');
        }).slice(0, 30); // Limit to 30 code files max

    for (const file of filesToScanForImports) {
      try {
        const content = await virtualFilesystem.readFile(userId, file.path);
        const imports = extractImportsFromContent(content.content, file.path, allFilePathsLower, allFilePathsOriginal);
        importMap.set(file.path.toLowerCase(), new Set(imports));
        for (const imp of imports) {
          if (!reverseImportMap.has(imp)) reverseImportMap.set(imp, new Set());
          reverseImportMap.get(imp)!.add(file.path.toLowerCase());
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch (error: any) {
    warnings.push(`Import map building failed: ${error.message}`);
  }

  // Score all files
  const scored = allFiles
    .map(f => scoreFile(f, signals, explicitFiles, allFiles, importMap, reverseImportMap, recentSessionFiles, normalizedProjectPath))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Select files up to maxTotalSize
  const encoder = new TextEncoder();
  const selected: { file: VirtualFile; score: FileScore }[] = [];
  let currentSize = 0;
  
  // Cache file contents to avoid reading twice
  const fileContentCache = new Map<string, VirtualFile>();

  // Helper to get file with caching
  const getCachedFile = async (filePath: string): Promise<VirtualFile | null> => {
    if (fileContentCache.has(filePath)) {
      return fileContentCache.get(filePath)!;
    }
    try {
      const file = await virtualFilesystem.readFile(userId, filePath);
      fileContentCache.set(filePath, file);
      return file;
    } catch {
      return null;
    }
  };

  // Always include explicit files first
  for (const scoredFile of scored) {
    if (scoredFile.score >= SCORE_THRESHOLDS.EXPLICIT) {
      const file = await getCachedFile(scoredFile.path);
      if (file) {
        const content = truncateContent(file.content, maxLinesPerFile);
        currentSize += encoder.encode(content).length;
        if (currentSize <= maxTotalSize) {
          selected.push({ file: { ...file, content }, score: scoredFile });
        }
      }
    }
  }

  // Then add scored files
  for (const scoredFile of scored) {
    if (scoredFile.score < SCORE_THRESHOLDS.EXPLICIT) {
      const file = await getCachedFile(scoredFile.path);
      if (file) {
        const content = truncateContent(file.content, maxLinesPerFile);
        const size = encoder.encode(content).length;
        if (currentSize + size <= maxTotalSize) {
          selected.push({ file: { ...file, content }, score: scoredFile });
          currentSize += size;
        }
      }
    }
  }

  // If VFS is small enough, include everything
  if (allFiles.length <= 5 && selected.length < allFiles.length) {
    for (const file of allFiles) {
      if (!selected.find(s => s.file.path === file.path)) {
        const fullFile = await getCachedFile(file.path);
        if (fullFile) {
          selected.push({ file: fullFile, score: { path: file.path, score: SCORE_THRESHOLDS.BASE, reasons: ['small workspace'] } });
        }
      }
    }
  }

  // Generate bundle
  const bundle = formatBundle(selected, tree, format, signals, explicitFiles);

  return {
    bundle,
    tree,
    rankedFiles: selected.map(s => s.score),
    totalFilesInVfs: allFiles.length,
    filesIncluded: selected.length,
    estimatedTokens: Math.ceil(encoder.encode(bundle).length / 4),
    vfsIsEmpty: false,
    warnings,
  };
}

/**
 * Collect all files recursively from VFS
 */
async function collectAllFiles(ownerId: string, path: string): Promise<VirtualFile[]> {
  const files: VirtualFile[] = [];
  try {
    const listing = await virtualFilesystem.listDirectory(ownerId, path);
    for (const node of listing.nodes || []) {
      const nodePath = path === '/' ? `/${node.name}` : `${path}/${node.name}`;
      if (node.type === 'directory') {
        files.push(...await collectAllFiles(ownerId, nodePath));
      } else if (node.type === 'file') {
        // Create VirtualFile placeholder (will be populated when reading content)
        files.push({
          path: nodePath,
          content: '',
          language: node.language || '',
          lastModified: node.lastModified || new Date().toISOString(),
          createdAt: node.lastModified || new Date().toISOString(),
          version: 1,
          size: node.size || 0,
        });
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
  }
  return files;
}

/**
 * Build a tree string from directory listing
 */
async function buildTreeString(
  nodes: VirtualFilesystemNode[],
  prefix: string = '',
  depth: number = 0,
  maxDepth: number = 10,
  ownerId: string = '',
  currentPath: string = '/',
  visitedDirs: Set<string> = new Set()
): Promise<string> {
  if (depth >= maxDepth || nodes.length === 0) return '';
  
  // Prevent infinite recursion from circular symlinks
  if (visitedDirs.has(currentPath)) return '';
  visitedDirs.add(currentPath);
  
  let result = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const isDir = node.type === 'directory';
    result += `${prefix}${connector}${node.name}${isDir ? '/' : ''}\n`;
    
    if (isDir && depth < maxDepth && ownerId) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      const childPath = currentPath === '/' ? `/${node.name}` : `${currentPath}/${node.name}`;
      try {
        const listing = await virtualFilesystem.listDirectory(ownerId, childPath);
        result += await buildTreeString(
          listing.nodes || [],
          newPrefix,
          depth + 1,
          maxDepth,
          ownerId,
          childPath,
          visitedDirs
        );
      } catch {
        // Directory inaccessible, skip
      }
    }
  }
  return result;
}

/**
 * Truncate content to max lines
 */
function truncateContent(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + `\n\n... (${lines.length - maxLines} more lines truncated)`;
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format the context bundle
 */
function formatBundle(
  selected: { file: VirtualFile; score: FileScore }[],
  tree: string,
  format: string,
  signals: ReturnType<typeof extractPromptSignals>,
  explicitFiles: Set<string>,
): string {
  if (format === 'json') {
    return JSON.stringify({
      tree,
      files: selected.map(s => ({
        path: s.file.path,
        content: s.file.content,
        score: s.score.score,
        reasons: s.score.reasons,
      })),
    }, null, 2);
  }

  if (format === 'xml') {
    let xml = '<workspace>\n';
    xml += `<tree>\n${escapeXml(tree)}</tree>\n`;
    for (const s of selected) {
      const escapedPath = escapeXml(s.file.path);
      const escapedReasons = escapeXml(s.score.reasons.join(', '));
      xml += `<file path="${escapedPath}" score="${s.score.score}" reasons="${escapedReasons}">\n`;
      xml += `<![CDATA[\n${s.file.content}\n]]>\n`;
      xml += `</file>\n`;
    }
    xml += '</workspace>';
    return xml;
  }

  // Markdown (default)
  let md = '';

  // If there are explicit files, highlight them first
  const explicitSelected = selected.filter(s => explicitFiles.has(s.file.path.toLowerCase()));
  const otherSelected = selected.filter(s => !explicitFiles.has(s.file.path.toLowerCase()));

  if (explicitSelected.length > 0) {
    md += '## 📎 Attached Files\n\n';
    for (const s of explicitSelected) {
      const ext = s.file.path.split('.').pop() || '';
      md += `### \`${s.file.path}\` (attached)\n\n`;
      md += `\`\`\`${ext}\n${s.file.content}\n\`\`\`\n\n`;
    }
  }

  if (otherSelected.length > 0) {
    md += '## 📁 Workspace Files\n\n';
    md += '```\n' + tree + '```\n\n';
    for (const s of otherSelected) {
      const ext = s.file.path.split('.').pop() || '';
      const reasons = s.score.reasons.length > 0 ? ` (${s.score.reasons.join(', ')})` : '';
      md += `### \`${s.file.path}\`${reasons}\n\n`;
      md += `\`\`\`${ext}\n${s.file.content}\n\`\`\`\n\n`;
    }
  }

  if (selected.length === 0) {
    md += '## 📁 Workspace\n\n';
    md += '```\n' + (tree || '(empty)') + '\n```\n\n';
    md += 'No file contents available. Create files by asking me to build something.\n';
  }

  return `--- WORKSPACE CONTEXT ---\n\n${md}\n--- END WORKSPACE CONTEXT ---\n`;
}

/**
 * Detect if LLM response contains a file read request
 * Parses patterns like:
 * - <request_file>path/to/file.ts</request_file>
 * - "I need to read file.ts"
 * - "Let me check App.tsx"
 * - Tool calls with read_file
 */
export function detectFileReadRequest(llmResponse: string): string[] {
  const requestedFiles: string[] = [];
  
  // Pattern 1: XML-style tags (highest confidence)
  const xmlPattern = /<request_file>([^<]+)<\/request_file>/gi;
  for (const match of llmResponse.matchAll(xmlPattern)) {
    const file = match[1].trim();
    if (file.length > 0 && file.length < 500) { // Sanity check
      requestedFiles.push(file);
    }
  }
  
  // Pattern 2: "read/check/look at" + filename (medium confidence)
  const readPattern = /\b(read|check|look at|examine|inspect|open)\s+(?:the\s+)?(?:file\s+)?([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gi;
  for (const match of llmResponse.matchAll(readPattern)) {
    const file = match[2].trim();
    // Filter out common false positives
    if (file.length > 2 && file.length < 500 && !file.includes(' ')) {
      requestedFiles.push(file);
    }
  }
  
  // Pattern 3: "in file.ts" or "from file.ts" (lower confidence, more false positives)
  // Only match if preceded by specific verbs that indicate file access
  const inFilePattern = /\b(?:read|check|see|find|look|search|in|from|at)\s+(?:the\s+)?(?:file\s+)?([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gi;
  for (const match of llmResponse.matchAll(inFilePattern)) {
    const file = match[1].trim();
    if (file.length > 2 && file.length < 500 && !file.includes(' ')) {
      requestedFiles.push(file);
    }
  }
  
  return [...new Set(requestedFiles)]; // Deduplicate
}

/**
 * Extract file paths from LLM tool calls (if using structured tool calling)
 */
export function extractToolCallFileRequests(toolCalls: Array<{ name: string; arguments: Record<string, any> }>): string[] {
  const requestedFiles: string[] = [];
  
  for (const toolCall of toolCalls) {
    if (toolCall.name === 'read_file' || toolCall.name === 'file.read') {
      const path = toolCall.arguments?.path;
      if (path) {
        requestedFiles.push(path);
      }
    }
  }
  
  return requestedFiles;
}

/**
 * Auto-continue mechanism: If LLM requested files, generate a follow-up context pack
 * Returns a continuation message with the requested files attached
 */
export async function autoContinueWithFiles(options: {
  userId: string;
  llmResponse: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>;
  conversationId?: string;
  maxTotalSize?: number;
}): Promise<{ shouldContinue: boolean; contextPack: string; requestedFiles: string[] } | null> {
  const { userId, llmResponse, toolCalls, maxTotalSize = 300000 } = options;
  
  // Detect file requests from LLM response text
  const textRequestedFiles = detectFileReadRequest(llmResponse);
  
  // Detect file requests from tool calls
  const toolRequestedFiles = toolCalls ? extractToolCallFileRequests(toolCalls) : [];
  
  // Combine and deduplicate
  const allRequestedFiles = [...new Set([...textRequestedFiles, ...toolRequestedFiles])];
  
  if (allRequestedFiles.length === 0) {
    return null; // No files requested, no continuation needed
  }
  
  // Generate context pack with requested files explicitly attached
  try {
    const contextResult = await generateSmartContext({
      userId,
      prompt: `Auto-continue: Read requested files`, // Not used for scoring when explicitFiles provided
      explicitFiles: allRequestedFiles,
      maxTotalSize,
      format: 'markdown',
    });
    
    return {
      shouldContinue: true,
      contextPack: contextResult.bundle,
      requestedFiles: allRequestedFiles,
    };
  } catch (error: any) {
    console.error('[SmartContext] Auto-continue failed:', error.message);
    return null;
  }
}

/**
 * Wrap a streaming generator to detect file read requests and auto-continue
 * This intercepts the stream, collects the full response, then yields auto-continue context if needed
 */
export async function* streamWithAutoContinue(
  generator: AsyncGenerator<any>,
  options: {
    userId: string;
    conversationId?: string;
    enableAutoContinue?: boolean;
  }
): AsyncGenerator<any> {
  const { userId, conversationId, enableAutoContinue = true } = options;
  
  if (!enableAutoContinue) {
    // Just pass through
    yield* generator;
    return;
  }
  
  // Collect all chunks to reconstruct full response
  let fullResponse = '';
  const allToolCalls: any[] = [];
  let isComplete = false;

  for await (const chunk of generator) {
    yield chunk; // Pass through to caller
    
    // Track completion state
    if (chunk.isComplete === true) {
      isComplete = true;
    }
    
    // Accumulate text content
    if (chunk.content && typeof chunk.content === 'string') {
      fullResponse += chunk.content;
    }
    
    // Collect tool calls
    if (chunk.toolCalls && Array.isArray(chunk.toolCalls)) {
      allToolCalls.push(...chunk.toolCalls);
    }
    if (chunk.toolInvocations && Array.isArray(chunk.toolInvocations)) {
      for (const invocation of chunk.toolInvocations) {
        if (invocation.toolCallId && invocation.toolName) {
          allToolCalls.push({
            id: invocation.toolCallId,
            name: invocation.toolName,
            arguments: invocation.args || invocation.arguments || {},
          });
        }
      }
    }
  }
  
  // After stream completes, check if LLM requested files
  // Only auto-continue if we got a complete response
  if (isComplete && (fullResponse.trim() || allToolCalls.length > 0)) {
    try {
      const autoContinue = await autoContinueWithFiles({
        userId,
        llmResponse: fullResponse,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        conversationId,
      });
      
      if (autoContinue && autoContinue.shouldContinue) {
        logger.info('Auto-continuing with requested files', { 
          fileCount: autoContinue.requestedFiles.length,
          files: autoContinue.requestedFiles,
        });
        
        // Yield a system-like message with the requested files
        yield {
          content: `\n\n[AUTO-CONTINUE] Automatically attaching requested files: ${autoContinue.requestedFiles.join(', ')}\n\n${autoContinue.contextPack}`,
          isComplete: false,
          timestamp: new Date(),
          metadata: { autoContinue: true, requestedFiles: autoContinue.requestedFiles },
        };
      }
    } catch (error: any) {
      logger.warn('Auto-continue check failed', { error: error.message });
      // Don't fail the stream if auto-continue fails
    }
  }
}


