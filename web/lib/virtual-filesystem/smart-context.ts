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
import { estimateTokens } from '@/lib/context/contextBuilder';

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
  /** VFS scope path for session isolation (e.g. "project/sessions/001").
   *  Used as a priority boost for files within the scope — NOT a hard filter.
   *  New chats and cross-project suggestions still work normally. */
  scopePath?: string;
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
  /** Directory tree (may be abbreviated for large projects) */
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
  /** Tree display mode: 'full' | 'abbreviated' | 'minimal' */
  treeMode?: 'full' | 'abbreviated' | 'minimal';
  /** Budget tier: 'compact' | 'balanced' | 'full' */
  budgetTier?: 'compact' | 'balanced' | 'full';
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
 * Get likely file extensions for a given source file's language.
 * Used to prioritize extension guessing during import resolution.
 */
function getExtensionsForLanguage(ext: string): string[] {
  switch (ext) {
    case 'ts': return ['', '.ts', '.tsx'];
    case 'tsx': return ['', '.tsx', '.ts'];
    case 'js': return ['', '.js', '.jsx', '.mjs', '.cjs'];
    case 'jsx': return ['', '.jsx', '.js'];
    case 'py': return ['', '.py'];
    case 'rs': return ['', '.rs'];
    case 'go': return ['', '.go'];
    case 'css': return ['', '.css', '.scss'];
    case 'scss': return ['', '.scss', '.css'];
    default: return ['', '.ts', '.tsx', '.js', '.jsx']; // Default to JS/TS
  }
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
  sourceExt: string,
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

  // Try each candidate with appropriate extensions
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();

    // Direct match (case-insensitive)
    if (allFilePathsLower.has(candidateLower)) {
      return allFilePathsOriginal.get(candidateLower) || candidate;
    }

    // Try with extensions — prioritize source file's language first
    const sourceExts = getExtensionsForLanguage(sourceExt);
    const fallbackExts = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.css', '.scss'];
    const allExts = [...new Set([...sourceExts, ...fallbackExts])];

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
    const resolved = resolveImportPath(rawImport, sourceDir, sourceExt, allFilePathsLower, allFilePathsOriginal);
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
  options: SmartContextOptions, // Changed from individual params to include scopePath
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

  // 9. Scope path priority boost — files within the active session scope get priority.
  // This is a soft boost, NOT a hard filter, so new chats and cross-project suggestions
  // still work normally. Files outside the scope are still included if they score high enough.
  if (options.scopePath && path.startsWith(options.scopePath.toLowerCase())) {
    reasons.push('within active session scope');
    score += 25;
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
    format = 'json', 
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
  let treeMode = 'full' as string;
  try {
    const listing = await virtualFilesystem.listDirectory(userId, '/');
    allFiles = await collectAllFiles(userId, '/');

    // Option B: Filter out excluded files (build artifacts, locks, binaries, etc.)
    // Never filters explicit @mentions even if they match exclusion patterns
    allFiles = filterFilesSmart(allFiles, explicitFiles);

    // Option A: Build smart tree (progressive pruning based on project size)
    const referencedPaths = new Set<string>();
    for (const f of explicitFileList) referencedPaths.add(f.toLowerCase());

    const smartTreeResult = await buildSmartTree(userId, '/', referencedPaths, allFiles.length);
    tree = smartTreeResult.tree;
    treeMode = smartTreeResult.mode;
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
      treeMode: 'minimal',
      budgetTier: 'compact',
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
      treeMode: 'full',
      budgetTier: 'compact',
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
    .map(f => scoreFile(f, signals, explicitFiles, allFiles, importMap, reverseImportMap, options, recentSessionFiles, normalizedProjectPath))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Option D: Dynamic context budget optimizer
  const roughTokenEstimate = allFiles.length * 200; // ~200 tokens/file average
  const budgetTier = estimateContextBudget(
    allFiles.length,
    roughTokenEstimate,
    explicitFileList.length > 0
  );

  // Adjust maxLinesPerFile based on budget tier
  const effectiveMaxLines = budgetTier === 'compact'
    ? Math.min(maxLinesPerFile, 100)  // Compact: 100 lines max
    : budgetTier === 'balanced'
      ? Math.min(maxLinesPerFile, 300) // Balanced: 300 lines max
      : maxLinesPerFile;                // Full: use original value

  // Adjust maxTotalSize based on budget tier
  const effectiveMaxSize = budgetTier === 'compact'
    ? Math.min(maxTotalSize, 100_000)  // ~25K tokens
    : budgetTier === 'balanced'
      ? Math.min(maxTotalSize, 250_000) // ~62K tokens
      : maxTotalSize;

  // Guard against zero — always allow at least some content
  const safeEffectiveMaxSize = Math.max(effectiveMaxSize, 10_000); // minimum 10KB

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
        const content = truncateContent(file.content, effectiveMaxLines);
        currentSize += encoder.encode(content).length;
        if (currentSize <= safeEffectiveMaxSize) {
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
        const content = truncateContent(file.content, effectiveMaxLines);
        const size = encoder.encode(content).length;
        if (currentSize + size <= safeEffectiveMaxSize) {
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
  const bundle = format === 'plain'
    ? formatBundlePlain(selected, tree)
    : formatBundle(selected, tree, format, signals, explicitFiles);

  // Compute detailed metrics for logging
  const bundleBytes = encoder.encode(bundle).length;
  const treeBytes = encoder.encode(tree).length;
  const estimatedTokensVal = estimateTokens(bundle);
  const treeTokens = estimateTokens(tree);
  const contentTokens = estimatedTokensVal - treeTokens;

  // Log token usage for monitoring and optimization
  logger.debug('SmartContext generated', {
    totalFiles: allFiles.length,
    filesIncluded: selected.length,
    treeMode,
    budgetTier,
    bundleBytes,
    treeBytes,
    estimatedTokens: estimatedTokensVal,
    treeTokens,
    contentTokens,
    avgScore: selected.length > 0
      ? (selected.reduce((sum, s) => sum + s.score.score, 0) / selected.length).toFixed(2)
      : '0',
    topReasons: selected.length > 0
      ? selected[0].score.reasons.slice(0, 3).join(', ')
      : 'none',
  });

  return {
    bundle,
    tree,
    rankedFiles: selected.map(s => s.score),
    totalFilesInVfs: allFiles.length,
    filesIncluded: selected.length,
    estimatedTokens: estimatedTokensVal,
    vfsIsEmpty: false,
    treeMode: treeMode as 'full' | 'abbreviated' | 'minimal',
    budgetTier,
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

// ─── Option A: Progressive Tree Pruning ──────────────────────────────────────

/**
 * Build an abbreviated tree that only shows folders + referenced files.
 * Unrelated leaf files are replaced with a `... N more file(s)` placeholder.
 * Always shows directory structure even when no referenced files exist.
 */
async function buildAbbreviatedTree(
  ownerId: string,
  rootPath: string = '/',
  referencedFiles: Set<string> = new Set<string>(),
  maxDepth: number = 10,
  currentDepth: number = 0,
  prefix: string = '',
  visitedDirs: Set<string> = new Set<string>()
): Promise<string> {
  if (currentDepth >= maxDepth) return '';
  if (visitedDirs.has(rootPath)) return '';
  visitedDirs.add(rootPath);

  let result = '';
  let nodes: VirtualFilesystemNode[] = [];
  try {
    const listing = await virtualFilesystem.listDirectory(ownerId, rootPath);
    nodes = listing.nodes || [];
  } catch {
    return '';
  }

  if (nodes.length === 0) return '';

  const dirs = nodes.filter(n => n.type === 'directory');
  const files = nodes.filter(n => n.type === 'file');

  const shownFiles: VirtualFilesystemNode[] = [];
  let hiddenFileCount = 0;

  for (const file of files) {
    const fullPath = rootPath === '/' ? `/${file.name}` : `${rootPath}/${file.name}`;
    if (referencedFiles.has(fullPath.toLowerCase())) {
      shownFiles.push(file);
    } else {
      hiddenFileCount++;
    }
  }

  // Always include all dirs, even if empty of referenced files
  const allEntries: Array<{ node: VirtualFilesystemNode; shown: boolean }> = [];
  for (const dir of dirs) allEntries.push({ node: dir, shown: true });
  for (const file of shownFiles) allEntries.push({ node: file, shown: true });

  const hasHiddenFiles = hiddenFileCount > 0;
  const totalEntries = allEntries.length + (hasHiddenFiles ? 1 : 0);

  for (let i = 0; i < allEntries.length; i++) {
    const { node } = allEntries[i];
    const isLast = i === allEntries.length - 1 && !hasHiddenFiles;
    const connector = isLast ? '└── ' : '├── ';
    const isDir = node.type === 'directory';
    result += `${prefix}${connector}${node.name}${isDir ? '/' : ''}\n`;

    if (isDir && currentDepth < maxDepth - 1) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      const childPath = rootPath === '/' ? `/${node.name}` : `${rootPath}/${node.name}`;
      result += await buildAbbreviatedTree(
        ownerId,
        childPath,
        referencedFiles,
        maxDepth,
        currentDepth + 1,
        newPrefix,
        visitedDirs
      );
    }
  }

  // Add placeholder for hidden files
  if (hasHiddenFiles) {
    const isLast = true;
    const connector = isLast ? '└── ' : '├── ';
    result += `${prefix}${connector}... ${hiddenFileCount} more file(s)\n`;
  }

  return result;
}

/**
 * Decide which tree mode to use based on project size.
 * Returns { tree, mode } where mode is 'full' | 'abbreviated' | 'minimal'.
 */
async function buildSmartTree(
  ownerId: string,
  rootPath: string,
  referencedFiles: Set<string>,
  totalFileCount: number
): Promise<{ tree: string; mode: 'full' | 'abbreviated' | 'minimal' }> {
  // Guard against empty ownerId
  if (!ownerId) {
    return { tree: '', mode: 'minimal' };
  }

  // Small project (< 10 files) — show full tree
  if (totalFileCount <= 10) {
    try {
      const listing = await virtualFilesystem.listDirectory(ownerId, rootPath);
      if (listing.nodes && listing.nodes.length > 0) {
        const tree = await buildTreeString(listing.nodes, '', 0, 10, ownerId, rootPath);
        return { tree, mode: 'full' };
      }
    } catch {
      // Fallback to minimal
    }
  }

  // Medium project (10-50 files) — abbreviated tree
  if (totalFileCount <= 50) {
    try {
      const tree = await buildAbbreviatedTree(ownerId, rootPath, referencedFiles);
      return { tree, mode: 'abbreviated' };
    } catch {
      // Fallback to minimal
    }
  }

  // Large project (> 50 files) — minimal tree (top-level dirs only)
  try {
    const listing = await virtualFilesystem.listDirectory(ownerId, rootPath);
    const topDirs = (listing.nodes || []).filter(n => n.type === 'directory');
    let tree = '';
    if (topDirs.length > 0) {
      for (let i = 0; i < topDirs.length; i++) {
        const dir = topDirs[i];
        const isLast = i === topDirs.length - 1;
        tree += `${isLast ? '└── ' : '├── '}${dir.name}/\n`;
      }
    }
    tree += `... ${totalFileCount} files total (${referencedFiles.size} referenced)\n`;
    return { tree, mode: 'minimal' };
  } catch {
    return { tree: `... ${totalFileCount} files total\n`, mode: 'minimal' };
  }
}

// ─── Option B: File-Type Filtering & Smart Exclusions ────────────────────────

/**
 * Paths / patterns that should always be excluded from context.
 * These are generated, lock, or binary files that waste tokens.
 */
const EXCLUDED_PATH_PATTERNS = [
  // Build output
  '/dist/', '/build/', '/out/', '/.next/', '/.svelte-kit/', '/.nuxt/',
  // Node modules
  '/node_modules/', '/.pnpm-store/', '/.yarn/',
  // Generated / bundled files
  '.min.js', '.min.css', '.bundle.js', '.chunk.js',
  // Lock files (large, not useful for LLM)
  '/package-lock.json', '/yarn.lock', '/pnpm-lock.yaml', '/bun.lockb',
  '/poetry.lock', '/Pipfile.lock', '/Gemfile.lock', '/Cargo.lock',
  // Binary / asset files
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib',
  '.pyc', '.pyo', '.pyd', '__pycache__',
  '.class', '.jar', '.war',
  '.o', '.obj', '.pdb',
  // IDE / editor metadata
  '.DS_Store', '.idea/', '.vscode/', '.vs/',
  // Environment / secrets
  '.env', '.env.local', '.env.production', '.env.development',
  // Git
  '.git/',
] as const;

/**
 * File types that should be limited to a small count per type.
 * E.g. only include 2 config files max per type.
 */
const CONFIG_FILE_CAPS: Record<string, number> = {
  'tsconfig': 2,
  'eslint': 2,
  'prettier': 1,
  'webpack': 1,
  'vite': 1,
  'babel': 1,
  'jest': 1,
  'vitest': 1,
  'docker': 2,
  'compose': 1,
};

/**
 * Check if a file path should be excluded based on patterns.
 */
function isExcludedFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();

  for (const pattern of EXCLUDED_PATH_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) return true;
  }

  return false;
}

/**
 * Extract a config-file "key" from a filename.
 * E.g. `tsconfig.app.json` → `tsconfig`, `.eslintrc.js` → `eslint`
 */
function getConfigFileKey(fileName: string): string | null {
  const base = fileName.toLowerCase();
  for (const key of Object.keys(CONFIG_FILE_CAPS)) {
    if (base.includes(key)) return key;
  }
  return null;
}

/**
 * Filter files using smart exclusion rules.
 * Never excludes files in the `explicitFiles` set (from @mentions).
 * Returns the filtered file list.
 */
function filterFilesSmart(files: VirtualFile[], explicitFiles: Set<string> = new Set<string>()): VirtualFile[] {
  // Track config file counts per key
  const configCounts = new Map<string, number>();

  const filtered: VirtualFile[] = [];

  for (const file of files) {
    const isExplicit = explicitFiles.has(file.path.toLowerCase());

    // Skip excluded patterns — BUT never exclude explicit @mentions
    if (!isExplicit && isExcludedFile(file.path)) continue;

    // Cap config files — BUT never cap explicit @mentions
    const configKey = getConfigFileKey(file.path.split('/').pop() || '');
    if (configKey && !isExplicit) {
      const current = configCounts.get(configKey) || 0;
      if (current >= CONFIG_FILE_CAPS[configKey]) continue;
      configCounts.set(configKey, current + 1);
    }

    filtered.push(file);
  }

  return filtered;
}

// ─── Option D: Dynamic Context Budget Optimizer ──────────────────────────────

/**
 * Estimate context size and return a recommended budget tier.
 * This helps avoid wasting tokens on unnecessary content.
 */
function estimateContextBudget(
  totalFileCount: number,
  estimatedTokenCount: number,
  hasExplicitFiles: boolean
): 'compact' | 'balanced' | 'full' {
  // Compact: large project, no explicit files — tree-only mode
  if (totalFileCount > 50 && !hasExplicitFiles) {
    return 'compact';
  }

  // Full: small project or explicit file attachments
  if (totalFileCount <= 15 || hasExplicitFiles) {
    return 'full';
  }

  // Balanced: medium project
  if (estimatedTokenCount > 8000) {
    return 'compact';
  }

  return 'balanced';
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
  format: 'markdown' | 'xml' | 'json',
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
 * Format the context bundle in plain text format (no markdown, no XML).
 */
function formatBundlePlain(
  selected: { file: VirtualFile; score: FileScore }[],
  tree: string,
): string {
  let plain = '=== WORKSPACE CONTEXT ===\n\n';

  if (tree) {
    plain += `Directory tree:\n${tree}\n\n`;
  }

  for (const s of selected) {
    const reasons = s.score.reasons.length > 0 ? ` (${s.score.reasons.join(', ')})` : '';
    plain += `--- ${s.file.path}${reasons} ---\n\n`;
    plain += `${s.file.content}\n\n`;
  }

  if (selected.length === 0) {
    plain += `Directory tree:\n${tree || '(empty)'}\n\n`;
    plain += 'No file contents available. Create files by asking me to build something.\n';
  }

  plain += '=== END WORKSPACE CONTEXT ===\n';
  return plain;
}

/**
 * Detect if LLM response contains a file read request
 * Parses patterns like:
 * - <request_file>path/to/file.ts</request_file>
 * - "I need to read file.ts"
 * - "Let me check App.tsx"
 * - Tool calls with read_file
 *
 * Returns { files: string[], confidence: 'high' | 'medium' | 'low' }
 */
export function detectFileReadRequest(llmResponse: string): { files: string[]; confidence: 'high' | 'medium' | 'low' } {
  const requestedFiles: string[] = [];
  let confidence: 'high' | 'medium' | 'low' = 'low';

  // Pattern 1: XML-style tags (highest confidence)
  const xmlPattern = /<request_file>([^<]+)<\/request_file>/gi;
  let xmlCount = 0;
  for (const match of llmResponse.matchAll(xmlPattern)) {
    const file = match[1].trim();
    if (file.length > 0 && file.length < 500) {
      requestedFiles.push(file);
      xmlCount++;
    }
  }
  if (xmlCount > 0) confidence = 'high';

  // Pattern 2: "read/check/look at" + filename (medium confidence)
  const readPattern = /\b(read|check|look at|examine|inspect|open)\s+(?:the\s+)?(?:file\s+)?([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gi;
  let readCount = 0;
  for (const match of llmResponse.matchAll(readPattern)) {
    const file = match[2].trim();
    if (file.length > 2 && file.length < 500 && !file.includes(' ')) {
      requestedFiles.push(file);
      readCount++;
    }
  }
  if (readCount > 0 && confidence !== 'high') confidence = 'medium';

  // Pattern 3: "in file.ts" or "from file.ts" (lower confidence)
  const inFilePattern = /\b(?:read|check|see|find|look|search|in|from|at)\s+(?:the\s+)?(?:file\s+)?([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gi;
  let inFileCount = 0;
  for (const match of llmResponse.matchAll(inFilePattern)) {
    const file = match[1].trim();
    if (file.length > 2 && file.length < 500 && !file.includes(' ')) {
      requestedFiles.push(file);
      inFileCount++;
    }
  }
  if (inFileCount > 0 && confidence === 'low') confidence = 'low';

  // Deduplicate
  return { files: Array.from(new Set(requestedFiles)), confidence };
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
 *
 * @param options.maxContinuations - Maximum number of auto-continuations allowed (default: 3)
 *   Prevents infinite loops when the LLM keeps requesting files that don't exist.
 */
export async function autoContinueWithFiles(options: {
  userId: string;
  llmResponse: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>;
  conversationId?: string;
  maxTotalSize?: number;
  maxContinuations?: number;
}): Promise<{ shouldContinue: boolean; contextPack: string; requestedFiles: string[] } | null> {
  const { userId, llmResponse, toolCalls, maxTotalSize = 300000, maxContinuations = 3 } = options;

  // Detect file requests from LLM response text (now returns { files, confidence })
  const textDetection = detectFileReadRequest(llmResponse);
  const textRequestedFiles = textDetection.files;

  // Detect file requests from tool calls
  const toolRequestedFiles = toolCalls ? extractToolCallFileRequests(toolCalls) : [];

  // Combine and deduplicate
  const allRequestedFiles = Array.from(new Set([...textRequestedFiles, ...toolRequestedFiles]));

  if (allRequestedFiles.length === 0) {
    return null; // No files requested, no continuation needed
  }

  // Gate: limit number of files requested to prevent abuse
  if (allRequestedFiles.length > 20) {
    console.warn('[SmartContext] LLM requested too many files, limiting to 20');
    allRequestedFiles.length = 20;
  }

  // Generate context pack with requested files explicitly attached
  try {
    const contextResult = await generateSmartContext({
      userId,
      prompt: `Auto-continue: Read requested files`,
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
 *
 * Guards against infinite loops:
 * - Max 3 continuation attempts
 * - Won't re-trigger if response already contains [AUTO-CONTINUE]
 * - Won't re-trigger if response already contains [CONTINUE_REQUESTED]
 */
// Track continuation count per conversation to prevent infinite loops across requests
const conversationContinuationCount = new Map<string, number>();

/** Reset conversation continuation counters (for testing) */
export function resetContinuationCounters(): void {
  conversationContinuationCount.clear();
}

/** Get current continuation count for a conversation */
export function getConversationContinuationCount(conversationId: string): number {
  return conversationContinuationCount.get(conversationId) || 0;
}

export async function* streamWithAutoContinue(
  generator: AsyncGenerator<any>,
  options: {
    userId: string;
    conversationId?: string;
    enableAutoContinue?: boolean;
    /** Max auto-continuation attempts (default: 3) */
    maxContinuations?: number;
    /** Current continuation count (passed from caller to track across yields) */
    continuationCount?: number;
  }
): AsyncGenerator<any> {
  const {
    userId,
    conversationId,
    enableAutoContinue = true,
    maxContinuations = 3,
    continuationCount: explicitCount,
  } = options;

  // FIX: Use conversation-level continuation count to prevent infinite loops across requests
  // If conversationId is provided, use the persistent counter
  let continuationCount = explicitCount;
  if (conversationId && explicitCount === undefined) {
    continuationCount = conversationContinuationCount.get(conversationId) || 0;
  } else if (continuationCount === undefined) {
    continuationCount = 0;
  }

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

  // Guard: Don't auto-continue if we've already hit the max
  if (continuationCount >= maxContinuations) {
    logger.debug('Auto-continue: max continuations reached, skipping', {
      continuationCount,
      maxContinuations,
    });
    return;
  }

  // Guard: Don't auto-continue if response already has continuation markers
  // (prevents infinite loop if previous continuation already triggered)
  if (fullResponse.includes('[CONTINUE_REQUESTED]') || fullResponse.includes('[AUTO-CONTINUE]')) {
    logger.debug('Auto-continue: response already contains continuation markers, skipping');
    return;
  }

  // After stream completes, check if LLM requested files OR continuation
  // Only auto-continue if we got a complete response
  if (isComplete && (fullResponse.trim() || allToolCalls.length > 0)) {
    try {
      // Check for [CONTINUE_REQUESTED] token — LLM needs more turns
      const requestedContinuation = fullResponse.trimEnd().endsWith('[CONTINUE_REQUESTED]');

      if (requestedContinuation) {
        // Build a context-aware continuation signal with tool execution summary
        const toolSummary = allToolCalls.length > 0
          ? allToolCalls.map(tc => `${tc.name}(${tc.arguments?.path || tc.name})`).join(', ')
          : 'none';

        // Also detect implicit file requests for better context
        const fileDetection = detectFileReadRequest(fullResponse);
        const implicitFiles = fileDetection.files.length > 0
          ? ` (also mentioned: ${fileDetection.files.join(', ')})`
          : '';

        // Get the last 300 chars of response for task context
        const contextHint = fullResponse.length > 300
          ? '...' + fullResponse.slice(-300).replace(/\[CONTINUE_REQUESTED\]/gi, '').trimStart()
          : fullResponse.replace(/\[CONTINUE_REQUESTED\]/gi, '').trim();

        logger.info('Auto-continuing: LLM requested more turns', {
          toolCount: allToolCalls.length,
          toolSummary,
          fileRequestConfidence: fileDetection.confidence,
          implicitFiles: implicitFiles || 'none',
          continuationCount: continuationCount + 1,
          maxContinuations,
          conversationId,
        });

        // FIX: Update conversation-level counter to prevent infinite loops across requests
        if (conversationId) {
          conversationContinuationCount.set(conversationId, continuationCount + 1);
        }

        // Yield a structured event — NOT content — so the client knows
        // to auto-submit a new message with context, not append to current response
        yield {
          type: 'auto-continue',
          content: '',
          toolSummary,
          contextHint: contextHint + implicitFiles,
          isComplete: true,
          timestamp: new Date(),
          metadata: {
            autoContinue: true,
            continuationRequested: true,
            toolCount: allToolCalls.length,
            continuationCount: continuationCount + 1,
            maxContinuations,
            fileRequestConfidence: fileDetection.confidence,
            implicitFiles: fileDetection.files,
          },
        };
        return;
      }

      const autoContinue = await autoContinueWithFiles({
        userId,
        llmResponse: fullResponse,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        conversationId,
        maxContinuations,
      });

      if (autoContinue && autoContinue.shouldContinue) {
        logger.info('Auto-continuing with requested files', {
          fileCount: autoContinue.requestedFiles.length,
          files: autoContinue.requestedFiles,
          continuationCount: continuationCount + 1,
          maxContinuations,
          conversationId,
        });

        // FIX: Update conversation-level counter to prevent infinite loops across requests
        if (conversationId) {
          conversationContinuationCount.set(conversationId, continuationCount + 1);
        }

        // Yield a system-like message with the requested files
        yield {
          content: `\n\n[AUTO-CONTINUE] Automatically attaching requested files: ${autoContinue.requestedFiles.join(', ')}\n\n${autoContinue.contextPack}`,
          isComplete: false,
          timestamp: new Date(),
          metadata: {
            autoContinue: true,
            requestedFiles: autoContinue.requestedFiles,
            continuationCount: continuationCount + 1,
            maxContinuations,
          },
        };
      }
    } catch (error: any) {
      logger.warn('Auto-continue check failed', { error: error.message });
      // Don't fail the stream if auto-continue fails
    }
  }

  // FIX: Reset conversation-level counter on successful completion (no auto-continue)
  // This ensures fresh requests start from 0 again
  if (conversationId && continuationCount > 0) {
    conversationContinuationCount.delete(conversationId);
  }
}


