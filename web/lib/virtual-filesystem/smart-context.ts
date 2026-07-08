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
import { stripScopePrefixForDisplay } from './path-normalizer';
import { sliceLines } from '@/lib/utils/slice-lines';
import { detectNeedsMoreTurns } from '@/lib/chat/auto-continue-detector';
import type { DetectableResult } from '@/lib/chat/auto-continue-detector';
import { recordToolCallTelemetry, prepareTelemetryPayload } from '@/lib/errors/logging-utils';

const logger = createLogger('SmartContext');

/**
 * Strip VFS scope prefix from a path so the LLM sees session-relative paths.
 * "workspace/sessions/001/src/App.tsx" → "src/App.tsx"
 * "workspace/sessions/my-app/package.json" → "package.json"
 * Paths not matching the prefix are returned as-is.
 */
function stripScopePrefix(filePath: string): string {
  return stripScopePrefixForDisplay(filePath);
}

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
  /** Current workspace root path (to prioritize files in this workspace) */
  currentProjectPath?: string;
  /** VFS scope path for session isolation (e.g. "workspace/sessions/001").
   *  Used as a priority boost for files within the scope — NOT a hard filter.
   *  New chats and cross-workspace suggestions still work normally. */
  scopePath?: string;
  /** Maximum total context size in bytes */
  maxTotalSize?: number;
  /** Output format */
  format?: 'markdown' | 'xml' | 'json' | 'plain';
  /** Maximum lines per file */
  maxLinesPerFile?: number;
  /** Context injection mode for iterative build loops.
   *  - 'read' (default): Full file contents inlined. Highest quality, most tokens.
   *  - 'diff': Only the changes since last iteration (unified diffs). Efficient for
   *    multi-round build loops where the LLM already knows the prior state.
   *  - 'tree': Directory tree only, no file content. Lightest weight — the LLM
   *    infers what files contain from their names and the workspace structure. */
  contextMode?: 'diff' | 'read' | 'tree';
  /** Snapshot of file contents BEFORE the last iteration's writes.
   *  Required when contextMode is 'diff'. Used to generate unified diffs
   *  of what changed in the last round. Map of path → previous content. */
  snapshotBefore?: Map<string, string>;
  /** Snapshot of file contents AFTER the last iteration's writes.
   *  Required when contextMode is 'diff'. Map of path → current content. */
  snapshotAfter?: Map<string, string>;
  /** Line ranges for specific files. Map of lowercase path → { startLine, endLine? }.
   *  When set, only the specified line range is read and injected into context.
   *  Parsed from patterns like @file.ts:50-100 or "read lines 50-100 of file.ts". */
  fileRanges?: Map<string, { startLine: number; endLine?: number }>;
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
  /** Context mode used: 'diff' | 'read' | 'tree' */
  contextMode?: 'diff' | 'read' | 'tree';
  /** Number of diff entries included (only for contextMode 'diff') */
  diffCount?: number;
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
export function extractPromptSignals(prompt: string): {
  extensions: Set<string>;
  keywords: Set<string>;
  possiblePaths: string[];
  hasAtMention: boolean;
  atMentionedFiles: string[]; // Track specific @mentioned filenames
  /** Line ranges parsed from file references: path → { startLine, endLine? } */
  fileRanges: Map<string, { startLine: number; endLine?: number }>;
} {
  const extensions = new Set<string>();
  const keywords = new Set<string>();
  const possiblePaths: string[] = [];
  const atMentionedFiles: string[] = [];
  const fileRanges = new Map<string, { startLine: number; endLine?: number }>();
  let hasAtMention = false;

  // Normalize prompt
  const lower = prompt.toLowerCase();

  // Detect @mentions with line range: @filename.ext:50-100 or @filename.ext:50
  // Must come BEFORE the plain @mention pattern to consume the line range first
  const atMentionLineRangePattern = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)):(\d+)(?:-(\d+))?\b/gi;
  for (const match of prompt.matchAll(atMentionLineRangePattern)) {
    hasAtMention = true;
    const mentionedFile = match[1];
    const startLine = parseInt(match[2], 10);
    const endLine = match[3] ? parseInt(match[3], 10) : undefined;
    atMentionedFiles.push(mentionedFile);
    possiblePaths.push(mentionedFile.toLowerCase());
    // Store line range keyed by lowercase path for case-insensitive matching
    fileRanges.set(mentionedFile.toLowerCase(), endLine ? { startLine, endLine } : { startLine });
    const ext = mentionedFile.split('.').pop();
    if (ext) extensions.add(`.${ext}`);
  }


  // Detect @mentions and extract filenames (plain, no line range)
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

  // Detect text-based line range references: "file.ts lines 50-100", "read lines 50-100 of file.ts"
  const textLineRangePattern = /([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\s+lines?\s+(\d+)(?:\s*-\s*(\d+))?\b|(?:read|show|get|fetch)\s+lines?\s+(\d+)(?:\s*-\s*(\d+))?\s+(?:of|from|in)\s+([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gim;
  for (const match of prompt.matchAll(textLineRangePattern)) {
    // Groups 1-3: "file.ts lines 50-100" → file=1, start=2, end=3
    // Groups 4-6: "read lines 50-100 of file.ts" → start=4, end=5, file=6
    const file = (match[1] || match[6] || '').toLowerCase();
    const start = parseInt(match[2] || match[4] || '0', 10);
    const end = match[3] || match[5] ? parseInt(match[3] || match[5] || '0', 10) : undefined;
    if (file && start > 0 && !fileRanges.has(file)) {
      fileRanges.set(file, end ? { startLine: start, endLine: end } : { startLine: start });
      if (!possiblePaths.includes(file)) possiblePaths.push(file);
    }
  }

  // Also detect bare colon-style file:line-range outside @mentions: "file.ts:50-100"
  const bareColonRangePattern = /\b([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)):(\d+)(?:-(\d+))?\b/g;
  for (const match of prompt.matchAll(bareColonRangePattern)) {
    const file = match[1].toLowerCase();
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : undefined;
    if (!fileRanges.has(file) && start > 0) {
      fileRanges.set(file, end ? { startLine: start, endLine: end } : { startLine: start });
      if (!possiblePaths.includes(file)) possiblePaths.push(file);
    }
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
  const stopWords = new Set<string>(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'if', 'when', 'where', 'what', 'which', 'who', 'whom', 'how', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'i', 'my', 'me']);
  for (const word of lower.split(/[\s,;:.!?(){}[\]<>]+/)) {
    if (word.length > 3 && !stopWords.has(word) && !/^\d+$/.test(word)) {
      keywords.add(word);
    }
  }

  return { extensions, keywords, possiblePaths, hasAtMention, atMentionedFiles, fileRanges };
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
    const allExts = [...new Set<string>([...sourceExts, ...fallbackExts])];

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
  currentProjectPath?: string, // Current workspace path to prioritize
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

  // 8. Current workspace path priority (prevent editing wrong workspace)
  if (currentProjectPath && path.startsWith(currentProjectPath)) {
    reasons.push('current workspace file');
    score += 40; // Moderate boost to current workspace files
  }

  // 9. Scope path priority boost — files within the active session scope get priority.
  // This is a soft boost, NOT a hard filter, so new chats and cross-workspace suggestions
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

// ============================================================================
// Diff Snapshot Utilities (for contextMode: 'diff')
// ============================================================================

/**
 * Generate unified diff entries between two snapshots of file contents.
 *
 * @param before — Map of path → content BEFORE the last iteration
 * @param after  — Map of path → content AFTER the last iteration (current VFS state)
 * @param maxDiffEntries — Maximum number of diffs to include (default: 20)
 * @param maxDiffLines   — Maximum lines per individual diff (default: 200)
 * @returns Array of { path, diff } objects sorted by change significance
 */
export function generateUnifiedDiffs(
  before: Map<string, string>,
  after: Map<string, string>,
  maxDiffEntries = 20,
  maxDiffLines = 200
): Array<{ path: string; diff: string; status: 'modified' | 'created' | 'deleted' }> {
  const entries: Array<{ path: string; diff: string; status: 'modified' | 'created' | 'deleted'; significance: number }> = new Array<{ path: string; diff: string; status: 'modified' | 'created' | 'deleted'; significance: number }>();

  // All unique paths across both snapshots
  const allPaths = new Set<string>([...before.keys(), ...after.keys()]);

  for (const path of allPaths) {
    const beforeContent = before.get(path) ?? null;
    const afterContent = after.get(path) ?? null;

    let diff: string;
    let status: 'modified' | 'created' | 'deleted';
    let significance: number;

    if (beforeContent === null && afterContent !== null) {
      // File created
      status = 'created';
      const lines = afterContent.split('\n');
      const shown = lines.slice(0, maxDiffLines);
      diff = `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${shown.length} @@\n${shown.map(l => '+' + l).join('\n')}`;
      significance = 100 + afterContent.length; // New files are important
    } else if (beforeContent !== null && afterContent === null) {
      // File deleted
      status = 'deleted';
      const lines = beforeContent.split('\n');
      const shown = lines.slice(0, maxDiffLines);
      diff = `--- a/${path}\n+++ /dev/null\n@@ -1,${shown.length} +0,0 @@\n${shown.map(l => '-' + l).join('\n')}`;
      significance = 50; // Deletions are less significant
    } else if (beforeContent !== afterContent) {
      // File modified — generate a simple line-based unified diff
      status = 'modified';
      diff = generateSimpleUnifiedDiff(path, beforeContent!, afterContent!, maxDiffLines);
      if (!diff) continue; // Too large, skip
      const addedLines = (diff.match(/^\+/gm) || []).length;
      const removedLines = (diff.match(/^-/gm) || []).length;
      significance = 30 + addedLines * 2 + removedLines * 2;
    } else {
      // Unchanged
      continue;
    }

    entries.push({ path, diff, status, significance });
  }

  // Sort by significance (most changed first) and take top N
  entries.sort((a, b) => b.significance - a.significance);
  return entries.slice(0, maxDiffEntries).map(({ path, diff, status }) => ({ path, diff, status }));
}

/**
 * Generate a simple line-based unified diff between two strings.
 * Falls back to a truncation marker if the diff is too large.
 */
function generateSimpleUnifiedDiff(
  path: string,
  before: string,
  after: string,
  maxLines: number
): string | null {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  // Use LCS-based diff for accuracy
  const ops = computeDiffOps(beforeLines, afterLines);

  // Build diff lines with proper unified diff format
  const diffLines: string[] = [];

  // Group ops into hunks: consecutive changes with 3 lines of context
  const hunks: Array<{
    beforeStart: number;
    afterStart: number;
    beforeCount: number;
    afterCount: number;
    lines: string[];
  }> = [];
  let currentHunk: typeof hunks[0] | null = null;
  let beforeIdx = 0;
  let afterIdx = 0;

  function startHunk(beforeLineNum: number, afterLineNum: number) {
    currentHunk = {
      beforeStart: beforeLineNum,
      afterStart: afterLineNum,
      beforeCount: 0,
      afterCount: 0,
      lines: [],
    };
  }

  function endHunk() {
    if (currentHunk && currentHunk.lines.length > 0) {
      hunks.push(currentHunk);
    }
    currentHunk = null;
  }

  for (const op of ops) {
    if (op.type === 'equal') {
      // Context lines — show up to 3 before/after a change
      const start = Math.max(0, op.count <= 3 ? 0 : op.count - 3);
      for (let i = start; i < op.count; i++) {
        if (!currentHunk) startHunk(beforeIdx + i + 1, afterIdx + i + 1);
        currentHunk.lines.push(' ' + beforeLines[op.start + i]);
        currentHunk.beforeCount++;
        currentHunk.afterCount++;
      }
      // Flush hunk after context if no more changes follow
      if (op.count > 3) endHunk();
      beforeIdx += op.count;
      afterIdx += op.count;
    } else if (op.type === 'delete') {
      if (!currentHunk) startHunk(beforeIdx + 1, afterIdx + 1);
      for (let i = 0; i < op.count; i++) {
        currentHunk.lines.push('-' + beforeLines[op.start + i]);
        currentHunk.beforeCount++;
      }
      beforeIdx += op.count;
    } else if (op.type === 'insert') {
      if (!currentHunk) startHunk(beforeIdx + 1, afterIdx + 1);
      for (let i = 0; i < op.count; i++) {
        currentHunk.lines.push('+' + afterLines[op.start + i]);
        currentHunk.afterCount++;
      }
      afterIdx += op.count;
    }
    // Cap output
    if (diffLines.length > maxLines) {
      diffLines.push('\\ ... (diff truncated for brevity)');
      endHunk();
      break;
    }
  }
  endHunk();

  // Format hunks
  for (const hunk of hunks) {
    diffLines.push(`@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`);
    diffLines.push(...hunk.lines);
  }

  if (diffLines.length === 0) return null;
  return `--- a/${path}\n+++ b/${path}\n${diffLines.join('\n')}`;
}

/**
 * Compute diff operations using a simple LCS algorithm.
 * Returns a list of {type, start, count} operations.
 */
function computeDiffOps(
  a: string[],
  b: string[]
): Array<{ type: 'equal' | 'delete' | 'insert'; start: number; count: number }> {
  const ops: Array<{ type: 'equal' | 'delete' | 'insert'; start: number; count: number }> = new Array<{ type: 'equal' | 'delete' | 'insert'; start: number; count: number }>();
  const m = a.length;
  const n = b.length;

  // For very large files, fall back to a simple approach
  if (m > 500 || n > 500) {
    // Simple approach: show first 50 and last 50 lines as context
    if (m > 0) ops.push({ type: 'delete', start: 0, count: Math.min(m, 100) });
    if (n > 0) ops.push({ type: 'insert', start: 0, count: Math.min(n, 100) });
    return ops;
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find operations
  let i = m;
  let j = n;
  const reverseOps: Array<{ type: 'equal' | 'delete' | 'insert'; start: number; count: number }> = new Array<{ type: 'equal' | 'delete' | 'insert'; start: number; count: number }>();

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      // Check if we can merge with previous equal
      if (reverseOps.length > 0 && reverseOps[reverseOps.length - 1].type === 'equal') {
        reverseOps[reverseOps.length - 1].start--;
        reverseOps[reverseOps.length - 1].count++;
      } else {
        reverseOps.push({ type: 'equal', start: i - 1, count: 1 });
      }
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      if (reverseOps.length > 0 && reverseOps[reverseOps.length - 1].type === 'insert') {
        reverseOps[reverseOps.length - 1].start--;
        reverseOps[reverseOps.length - 1].count++;
      } else {
        reverseOps.push({ type: 'insert', start: j - 1, count: 1 });
      }
      j--;
    } else {
      if (reverseOps.length > 0 && reverseOps[reverseOps.length - 1].type === 'delete') {
        reverseOps[reverseOps.length - 1].start--;
        reverseOps[reverseOps.length - 1].count++;
      } else {
        reverseOps.push({ type: 'delete', start: i - 1, count: 1 });
      }
      i--;
    }
  }

  // Reverse to get forward order
  return reverseOps.reverse();
}

/**
 * Capture a snapshot of current file contents for later diff generation.
 * Reads the specified files from VFS and returns a Map of path → content.
 */
export async function captureFileSnapshot(
  userId: string,
  filePaths: string[]
): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  // NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts` (captureFileSnapshot, L898-L916);
  // parallelize N independent readFile calls via Promise.all + per-path .map try/catch.
  // Each path is independent (read-only VFS call, no cross-file mutation, no shared state),
  // saves ∝N read latency. The per-callback try/catch preserves the original "skip on
  // error" semantics (a single missing/unreadable file does not abort the snapshot).
  // ∝N files per call — typical capture is 5-50 files. No new dependencies.
  await Promise.all(
    filePaths.map(async (path) => {
      try {
        const file = await virtualFilesystem.readFile(userId, path);
        snapshot.set(path, (file as any).content ?? '');
      } catch {
        // File doesn't exist or can't be read — skip
      }
    }),
  );
  return snapshot;
}

/**
 * Capture a snapshot of ALL files in the VFS (for comprehensive diff tracking).
 */
export async function captureFullSnapshot(userId: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  try {
    // NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts` (captureFullSnapshot, L918-L919);
    // drop the redundant external listDirectory call (same fix as Tier 3 #30
    // in generateSmartContext at L976-L987). collectAllFiles already calls
    // listDirectory internally — the external call here was also wasted I/O.
    // listing is unused downstream in this scope (the for-loop only reads
    // file.path + file.content from allFiles). Same wallclock savings as #30
    // (~5-30ms/call on workspaces with >50 files). No new dependencies, no
    // behavior change in the happy path.
    const allFiles = await collectAllFiles(userId, '/');
    for (const file of allFiles) {
      if (file.content) {
        snapshot.set(file.path, file.content);
      }
    }
  } catch {
    // VFS not initialized or empty
  }
  return snapshot;
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
    maxLinesPerFile = 500,
    contextMode = 'read',
    snapshotBefore,
    snapshotAfter,
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
      contextMode,
      diffCount: 0,
      warnings: ['Missing userId'],
    };
  }
  
  const explicitFiles = new Set<string>(explicitFileList.map(f => f.toLowerCase()));
  const recentSessionFiles = new Set<string>(recentSessionFileList.map(f => f.toLowerCase()));
  const signals = extractPromptSignals(prompt || '');
  const normalizedProjectPath = currentProjectPath?.toLowerCase();

  // Collect all files from VFS
  let allFiles: VirtualFile[] = [];
  let tree = '';
  let treeMode = 'full' as string;
  try {
    // NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts` (generateSmartContext, L976-L978);
    // drop the redundant external listDirectory call. collectAllFiles
    // already calls listDirectory internally at L1279 — the external call
    // was wasted I/O. listDirectory's top-level result is unused downstream
    // in this scope (only allFiles is consumed by filterFilesSmart +
    // buildSmartTree). Walk-time savings scale with workspace size; saves
    // a full VFS list call on every generateSmartContext invocation.
    // ~5-30ms/request on workspaces with >50 files. No new dependencies,
    // no behavior change in the happy path. Code-reviewer recommended
    // this over the parallel form (which would have kept `listing` as
    // dead code).
    allFiles = await collectAllFiles(userId, '/');

    // Option B: Filter out excluded files (build artifacts, locks, binaries, etc.)
    // Never filters explicit @mentions even if they match exclusion patterns
    allFiles = filterFilesSmart(allFiles, explicitFiles);

    // Option A: Build smart tree (progressive pruning based on workspace size)
    const referencedPaths = new Set<string>();
    for (const f of explicitFileList) referencedPaths.add(f.toLowerCase());

    const smartTreeResult = await buildSmartTree(userId, '/', referencedPaths, allFiles.length);
    tree = smartTreeResult.tree;
    treeMode = smartTreeResult.mode;
  } catch (e: any) {
    // VFS not initialized or empty — return minimal context
    warnings.push(`VFS access failed: ${e.message}. Returning empty context.`);
    return {
      bundle: format === 'json' ? JSON.stringify({ tree: '', files: [], note: 'No files in workspace yet. Use bash_execute to create files (echo "content" > file.txt) or write_file tool.' }) :
        `--- WORKSPACE ---\n(empty directory — working directory is /workspace)\n\nNo files yet. Use bash_execute to create files: echo "content" > file.txt\nOr use cat > file.txt << 'EOF' for multi-line content.\n--- END WORKSPACE ---\n`,
      tree: '',
      rankedFiles: [],
      totalFilesInVfs: 0,
      filesIncluded: 0,
      estimatedTokens: 15,
      vfsIsEmpty: true,
      treeMode: 'minimal',
      budgetTier: 'compact',
      contextMode,
      diffCount: 0,
      warnings,
    };
  }

  if (allFiles.length === 0) {
    warnings.push('VFS is empty. Returning minimal context.');
    return {
      bundle: format === 'json' ? JSON.stringify({ tree, files: [], note: 'No files in workspace yet. Working directory is /workspace. Use bash_execute to create files.' }) :
        `--- WORKSPACE ---\n${tree || '(empty directory — working directory is /workspace)'}\n\nNo file contents yet. Use bash_execute to create files (e.g., echo "content" > file.txt).\n--- END WORKSPACE ---\n`,
      tree,
      rankedFiles: [],
      totalFilesInVfs: 0,
      filesIncluded: 0,
      estimatedTokens: 15,
      vfsIsEmpty: true,
      treeMode: 'full',
      budgetTier: 'compact',
      contextMode,
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

    // NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts` (import-map extraction, L1071-L1086);
    // parallelize the readFile + import-extraction fan-out via Promise.all + per-file .map try/catch.
    // Each file is independent (read-only VFS call, separate extractImportsFromContent call,
    // separate importMap + reverseImportMap entries keyed by file.path), saves ∝N read latency.
    // filesToScanForImports is capped at 30 code files (L1066), so ∝N is bounded 1-30.
    // The per-callback try/catch preserves the original "skip on error" semantics (a single
    // unreadable file does not abort the import map). No new dependencies.
    await Promise.all(
      filesToScanForImports.map(async (file) => {
        try {
          const content = await virtualFilesystem.readFile(userId, file.path);
          const imports = extractImportsFromContent(content.content, file.path, allFilePathsLower, allFilePathsOriginal);
          importMap.set(file.path.toLowerCase(), new Set<string>(imports));
          for (const imp of imports) {
            if (!reverseImportMap.has(imp)) reverseImportMap.set(imp, new Set<string>());
            reverseImportMap.get(imp)!.add(file.path.toLowerCase());
          }
        } catch {
          // Skip files that can't be read
        }
      }),
    );
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

  // Build fileRanges map from options and signals
  const effectiveFileRanges = new Map<string, { startLine: number; endLine?: number }>();
  if (options.fileRanges) {
    for (const [path, range] of options.fileRanges) {
      effectiveFileRanges.set(path, range);
    }
  }
  // Also merge ranges detected from the prompt signals
  for (const [path, range] of signals.fileRanges) {
    if (!effectiveFileRanges.has(path)) {
      effectiveFileRanges.set(path, range);
    }
  }

  // Helper to get file with caching (applies line range slicing when applicable)
  const getCachedFile = async (filePath: string): Promise<VirtualFile | null> => {
    if (fileContentCache.has(filePath)) {
      return fileContentCache.get(filePath)!;
    }
    try {
      const file = await virtualFilesystem.readFile(userId, filePath);
      // Apply line range slicing if requested for this file
      const range = effectiveFileRanges.get(filePath.toLowerCase()) || effectiveFileRanges.get(filePath);
      if (range) {
        const originalLineCount = file.content.split('\n').length;
        const sliced = sliceLines(
          file.content,
          range.startLine,
          range.endLine
        );
        const result = { ...file, content: sliced, originalLineCount };
        fileContentCache.set(filePath, result);
        return result;
      }
      fileContentCache.set(filePath, file);
      return file;
    } catch {
      return null;
    }
  };

  // Always include explicit files first
  // NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts` (explicit-file loop, L1172-L1186);
  // parallelize the read + content-extraction for explicit files via Promise.all + per-scoredFile filter.
  // The getCachedFile helper internally caches, so duplicate reads are no-ops after the first
  // (subsequent loops in the scored-file branch below will hit the cache); the parallelization
  // pay-off is on the FIRST read for each path. The upfront filter (`score >= EXPLICIT`) preserves
  // the original "explicit-only" branch semantics; the truncation + size accounting is done in
  // the same callback so post-resolution accounting stays identical. No budget cap inside this
  // branch (explicit files are always included unless total exceeds safeEffectiveMaxSize).
  await Promise.all(
    scored
      .filter((scoredFile) => scoredFile.score >= SCORE_THRESHOLDS.EXPLICIT)
      .map(async (scoredFile) => {
        const file = await getCachedFile(scoredFile.path);
        if (file) {
          // Don't truncate if a line range was explicitly requested
          const hasLineRange = effectiveFileRanges.has(scoredFile.path.toLowerCase()) || effectiveFileRanges.has(scoredFile.path);
          const content = hasLineRange ? file.content : truncateContent(file.content, effectiveMaxLines);
          currentSize += encoder.encode(content).length;
          if (currentSize <= safeEffectiveMaxSize) {
            selected.push({ file: { ...file, content }, score: scoredFile });
          }
        }
      }),
  );
  // Re-sort selected after BOTH loops so the final array is in score-desc order regardless
  // of which loop (explicit or scored) pushed each file. This is a defensive guard against
  // future refactors introducing out-of-order resolution (e.g., if getCachedFile's cache
  // miss path adds network-jitter-induced reorder). The sort is a no-op for the current data
  // flow (Promise.all preserves registration order; the input is already sorted).
  selected.sort((a, b) => b.score.score - a.score.score);

  // Then add scored files
  // NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts` (scored-file loop, L1198-L1232);
  // read + compute sizes in parallel via Promise.all (with original index tracking for
  // budget-check ordering), then walk results sequentially to apply the original
  // "accumulate currentSize against safeEffectiveMaxSize" semantics. The getCachedFile
  // helper internally caches, so duplicate path reads (from the explicit-file loop above)
  // are no-ops after the first read. The index-tracking `.map((scoredFile, idx) => ...)` +
  // post-resolution sort preserves the ORIGINAL sequential push order so the budget-check
  // result matches the original byte-for-byte. ∝N files per call — typical scored set is
  // 10-50 files. No new dependencies.
  const scoredReadResults = await Promise.all(
    scored
      .filter((scoredFile) => scoredFile.score < SCORE_THRESHOLDS.EXPLICIT)
      .map(async (scoredFile, idx) => {
        const file = await getCachedFile(scoredFile.path);
        if (!file) return null;
        const hasLineRange = effectiveFileRanges.has(scoredFile.path.toLowerCase()) || effectiveFileRanges.has(scoredFile.path);
        const content = hasLineRange ? file.content : truncateContent(file.content, effectiveMaxLines);
        const size = encoder.encode(content).length;
        return { idx, scoredFile, file: { ...file, content }, size };
      }),
  );
  // Sort by original index to preserve the original budget-check order
  scoredReadResults.sort((a, b) => (a?.idx ?? 0) - (b?.idx ?? 0));
  for (const result of scoredReadResults) {
    if (!result) continue;
    if (currentSize + result.size <= safeEffectiveMaxSize) {
      selected.push({ file: result.file, score: result.scoredFile });
      currentSize += result.size;
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

  // Generate bundle based on contextMode
  let bundle: string;
  let diffCount = 0;

  if (contextMode === 'tree') {
    // TREE MODE: Only the directory tree, no file contents.
    // The LLM infers what files contain from their names and structure.
    bundle = format === 'json'
      ? JSON.stringify({ tree, note: 'Tree-only mode — file contents not included. Infer file purpose from names.' }, null, 2)
      : `--- WORKSPACE TREE ---\n${tree || '(empty)'}\n--- END TREE ---\n`;
  } else if (contextMode === 'diff' && snapshotBefore && snapshotAfter) {
    // DIFF MODE: Only the changes since last iteration (unified diffs).
    // Efficient for multi-round build loops where the LLM already knows the prior state.
    const diffs = generateUnifiedDiffs(snapshotBefore, snapshotAfter, 20, 150);
    diffCount = diffs.length;

    if (diffs.length === 0) {
      // No changes since last snapshot — provide tree only
      bundle = format === 'json'
        ? JSON.stringify({ tree, note: 'No changes since last iteration.', diffs: [] }, null, 2)
        : `--- WORKSPACE TREE ---\n${tree || '(empty)'}\n\nNo changes since last iteration.\n--- END TREE ---\n`;
    } else {
      const diffBlock = diffs.map(d => `## ${d.status === 'created' ? 'CREATED' : d.status === 'deleted' ? 'DELETED' : 'MODIFIED'}: ${d.path}\n\n\`\`\`diff\n${d.diff}\n\`\`\``).join('\n\n');
      bundle = format === 'json'
        ? JSON.stringify({ tree, diffs: diffs.map(d => ({ path: d.path, status: d.status, diff: d.diff })) }, null, 2)
        : `--- CHANGES SINCE LAST ITERATION (${diffs.length} files) ---\n\n${tree ? `Workspace tree:\n${tree}\n\n` : ''}${diffBlock}\n--- END CHANGES ---\n`;
    }
  } else {
    // READ MODE (default): Full file contents inlined.
    if (contextMode === 'diff' && (!snapshotBefore || !snapshotAfter)) {
      warnings.push('contextMode is "diff" but snapshotBefore/snapshotAfter not provided. Falling back to "read" mode.');
    }

    bundle = format === 'plain'
      ? formatBundlePlain(selected, tree)
      : formatBundle(selected, tree, format, signals, explicitFiles, effectiveFileRanges);
  }

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
    contextMode,
    diffCount,
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
  visitedDirs: Set<string> = new Set<string>()
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
  const allEntries: Array<{ node: VirtualFilesystemNode; shown: boolean }> = new Array<{ node: VirtualFilesystemNode; shown: boolean }>();
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
 * Decide which tree mode to use based on workspace size.
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

  // Small workspace (< 10 files) — show full tree
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

  // Medium workspace (10-50 files) — abbreviated tree
  if (totalFileCount <= 50) {
    try {
      const tree = await buildAbbreviatedTree(ownerId, rootPath, referencedFiles);
      return { tree, mode: 'abbreviated' };
    } catch {
      // Fallback to minimal
    }
  }

  // Large workspace (> 50 files) — minimal tree (top-level dirs only)
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
  // Compact: large workspace, no explicit files — tree-only mode
  if (totalFileCount > 50 && !hasExplicitFiles) {
    return 'compact';
  }

  // Full: small workspace or explicit file attachments
  if (totalFileCount <= 15 || hasExplicitFiles) {
    return 'full';
  }

  // Balanced: medium workspace
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
 * Add right-aligned line numbers to file content so LLMs can reference
 * specific lines when discussing or editing code.
 *
 * Format:
 *      1|import React from 'react';
 *      2|
 *      3|function App() {
 *     ...
 *    100|export default App;
 */
export function addLineNumbers(content: string): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  // Pad width based on line count: 1-9 → 1 digit, 10-99 → 2 digits, etc.
  const padWidth = Math.max(1, String(totalLines).length);
  return lines
    .map((line, i) => `${String(i + 1).padStart(padWidth)}|${line}`)
    .join('\n');
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
  fileRanges?: Map<string, { startLine: number; endLine?: number }>,
): string {
  if (format === 'json') {
    return JSON.stringify({
      tree,
      files: selected.map(s => ({
        path: stripScopePrefix(s.file.path),
        content: addLineNumbers(s.file.content),
        score: s.score.score,
        reasons: s.score.reasons,
      })),
    }, null, 2);
  }

  if (format === 'xml') {
    let xml = '<workspace>\n';
    xml += `<tree>\n${escapeXml(tree)}</tree>\n`;
    for (const s of selected) {
      const escapedPath = escapeXml(stripScopePrefix(s.file.path));
      const escapedReasons = escapeXml(s.score.reasons.join(', '));
      xml += `<file path="${escapedPath}" score="${s.score.score}" reasons="${escapedReasons}">\n`;
      xml += `<![CDATA[\n${addLineNumbers(s.file.content)}\n]]>\n`;
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
      const lineCount = s.file.content.split('\n').length;
      const range = fileRanges?.get(s.file.path.toLowerCase()) || fileRanges?.get(s.file.path);
      // Use originalLineCount (set by getCachedFile when slicing) for accurate totals
      const totalCount = (s.file as any).originalLineCount ?? lineCount;
      const rangeLabel = range
        ? ` (attached, lines ${range.startLine}–${range.endLine ?? 'end'} of ${totalCount} total)`
        : ` (attached, ${lineCount} lines)`;
      md += `### \`${stripScopePrefix(s.file.path)}\`${rangeLabel}\n\n`;
      md += `\`\`\`${ext}\n${addLineNumbers(s.file.content)}\n\`\`\`\n\n`;
    }
  }

  if (otherSelected.length > 0) {
    md += '## 📁 Workspace Files\n\n';
    md += '```\n' + tree + '```\n\n';
    for (const s of otherSelected) {
      const ext = s.file.path.split('.').pop() || '';
      const reasons = s.score.reasons.length > 0 ? ` (${s.score.reasons.join(', ')})` : '';
      const lineCount = s.file.content.split('\n').length;
      const range = fileRanges?.get(s.file.path.toLowerCase()) || fileRanges?.get(s.file.path);
      // Use originalLineCount for accurate totals when content was sliced
      const totalCount = (s.file as any).originalLineCount ?? lineCount;
      const rangeSuffix = range
        ? ` (lines ${range.startLine}–${range.endLine ?? 'end'} of ${totalCount} total)`
        : ` (${lineCount} lines)`;
      md += `### \`${stripScopePrefix(s.file.path)}\`${reasons}${rangeSuffix}\n\n`;
      md += `\`\`\`${ext}\n${addLineNumbers(s.file.content)}\n\`\`\`\n\n`;
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
    plain += `--- ${stripScopePrefix(s.file.path)}${reasons} ---\n\n`;
    plain += `${addLineNumbers(s.file.content)}\n\n`;
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
  return { files: Array.from(new Set<string>(requestedFiles)), confidence };
}

/**
 * Tools that are information-gathering but NOT file/directory read operations.
 * These are excluded when deriving FILE_READ_TOOL_VARIANTS from INFO_GATHERING_TOOLS
 * (which is defined below — the derivation itself is placed after INFO_GATHERING_TOOLS
 * to ensure proper declaration order).
 */
const NON_FILE_READ_INFO_GATHERING_TOOLS = new Set<string>([
  'web_search', 'webSearch', 'search', 'web.search',
  'read_url', 'readUrl', 'fetch_url', 'fetchUrl',
  'file_picker', 'pickFiles', 'file.picker',
]);

/**
 * Extract file paths from LLM tool calls (if using structured tool calling).
 * Handles:
 * - read_file / file.read (path argument)
 * - list_directory / listFiles / list_dir / ls (path or directory argument)
 * - glob / globFiles / glob.files (pattern argument)
 */
export function extractToolCallFileRequests(toolCalls: Array<{ name: string; arguments: Record<string, any> }>): string[] {
  const requestedFiles: string[] = [];

  for (const toolCall of toolCalls) {
    if (FILE_READ_TOOL_VARIANTS.has(toolCall.name)) {
      // Prefer path, fall back to directory for list tools, then pattern for glob
      const path = toolCall.arguments?.path || toolCall.arguments?.directory || toolCall.arguments?.pattern;
      if (path && typeof path === 'string') {
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
  const allRequestedFiles = Array.from(new Set<string>([...textRequestedFiles, ...toolRequestedFiles]));

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
    // Parse line ranges from the request text
    const signals = extractPromptSignals(llmResponse);
    const contextResult = await generateSmartContext({
      userId,
      prompt: `Auto-continue: Read requested files`,
      explicitFiles: allRequestedFiles,
      maxTotalSize,
      format: 'markdown',
      fileRanges: signals.fileRanges.size > 0 ? signals.fileRanges : undefined,
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
// LRU-style bounded Map to prevent memory leak
const MAX_CONTINUATION_ENTRIES = 500;
const MAX_CONTINUATION_TTL_MS = 5 * 60 * 1000; // 5 minutes — stale entries expire
const conversationContinuationCount = new Map<string, { count: number; lastAccess: number }>();

/**
 * Set of tool names that are purely information-gathering — the LLM calls these
 * to browse/read/research but then stops without producing a response.
 * When these are the only tools called, the stream should never end without
 * a re-prompt to continue.
 */
const INFO_GATHERING_TOOLS = new Set<string>([
  // File reading
  'read_file', 'readFile', 'file.read',
  // Directory listing
  'list_files', 'listFiles', 'list_directory', 'list_dir', 'ls', 'file.list', 'listDirectory',
  // Web research
  'web_search', 'webSearch', 'search', 'web.search',
  'read_url', 'readUrl', 'fetch_url', 'fetchUrl',
  // File discovery
  'glob', 'globFiles', 'glob.files',
  'file_picker', 'pickFiles', 'file.picker',
]);

/**
 * Set of tool name variants that indicate file/directory reading intent.
 * Derived from INFO_GATHERING_TOOLS by excluding NON_FILE_READ_INFO_GATHERING_TOOLS.
 * This makes the subset relationship explicit — FILE_READ_TOOL_VARIANTS ⊆ INFO_GATHERING_TOOLS.
 *
 * These are info-gathering tools that take a path-like argument and should
 * trigger auto-continue with context pack generation.
 */
const FILE_READ_TOOL_VARIANTS = new Set<string>(
  [...INFO_GATHERING_TOOLS].filter(t => !NON_FILE_READ_INFO_GATHERING_TOOLS.has(t))
);

/** Runtime assertion: FILE_READ_TOOL_VARIANTS is a subset of INFO_GATHERING_TOOLS */
if (![...FILE_READ_TOOL_VARIANTS].every(t => INFO_GATHERING_TOOLS.has(t))) {
  throw new Error('FILE_READ_TOOL_VARIANTS must be a subset of INFO_GATHERING_TOOLS');
}

function trackConversation(id: string, count: number): void {
  // Evict oldest entries if Map is full
  if (conversationContinuationCount.size >= MAX_CONTINUATION_ENTRIES) {
    const firstKey = conversationContinuationCount.keys().next().value;
    if (firstKey) conversationContinuationCount.delete(firstKey);
  }
  conversationContinuationCount.set(id, { count, lastAccess: Date.now() });
}

/** Reset conversation continuation counters (for testing) */
export function resetContinuationCounters(): void {
  conversationContinuationCount.clear();
}

/** Get current continuation count for a conversation */
export function getConversationContinuationCount(conversationId: string): number {
  const entry = conversationContinuationCount.get(conversationId);
  if (!entry) return 0;
  // Expire stale entries (e.g. from a previous session) to prevent permanent cap
  if (Date.now() - entry.lastAccess > MAX_CONTINUATION_TTL_MS) {
    conversationContinuationCount.delete(conversationId);
    return 0;
  }
  return entry.count;
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
    continuationCount = getConversationContinuationCount(conversationId);
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
  // Track toolCallId values for deduplication — tools may appear in both
  // toolCalls (request) and toolInvocations (result) chunks from the SDK;
  // we de-dupe by toolCallId to prevent double-counting.
  const seenToolCallIds = new Set<string>();

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

    // Collect tool calls (requests, no result yet)
    if (chunk.toolCalls && Array.isArray(chunk.toolCalls)) {
      for (const tc of chunk.toolCalls) {
        const callId = tc.id || tc.toolCallId;
        if (callId) {
          if (seenToolCallIds.has(callId)) continue; // already got result for this call
          seenToolCallIds.add(callId);
        }
        allToolCalls.push(tc);
      }
    }

    // Collect tool invocations (results) — preserve result + state so
    // detectNeedsMoreTurns sees accurate success/failure data.
    if (chunk.toolInvocations && Array.isArray(chunk.toolInvocations)) {
      for (const invocation of chunk.toolInvocations) {
        if (invocation.toolCallId && invocation.toolName) {
          // Dedup: if this toolCallId was already seen in toolCalls,
          // update the existing entry with result/state instead of adding a duplicate.
          if (seenToolCallIds.has(invocation.toolCallId)) {
            const existingIdx = allToolCalls.findIndex(
              tc => tc.id === invocation.toolCallId || tc.toolCallId === invocation.toolCallId
            );
            if (existingIdx >= 0) {
              allToolCalls[existingIdx] = {
                ...allToolCalls[existingIdx],
                result: invocation.result,
                state: invocation.state,
              };
            }
            continue;
          }
          seenToolCallIds.add(invocation.toolCallId);
          allToolCalls.push({
            id: invocation.toolCallId,
            name: invocation.toolName,
            arguments: invocation.args || invocation.arguments || {},
            result: invocation.result,
            state: invocation.state,
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
  // NOTE: [CONTINUE_REQUESTED] is intentionally NOT included here — it's a
  // legitimate LLM-to-server signal, unlike [NEXT] or [AUTO-CONTINUE] which
  // are server-to-client markers. The dedicated check below handles it.
  if (fullResponse.includes('[AUTO-CONTINUE]') || fullResponse.includes('[NEXT]')) {
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
          trackConversation(conversationId, continuationCount + 1);
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

// Record telemetry for auto-continue (helps trace malformed/duplicate calls)
const toolCallsForTelemetry = allToolCalls ?? [];
if (toolCallsForTelemetry.length > 0) {
  const { redactedArgs, originStack } = prepareTelemetryPayload(
    { toolCalls: toolCallsForTelemetry, autoContinue: true },
    { maxStringLength: 200, maxObjectProps: 5, maxArrayItems: 5 }
  );
  recordToolCallTelemetry({
    toolName: 'streamWithAutoContinue',
    redactedArgs,
    originStack,
    toolCallId: conversationId ?? null,          }).catch((err) => { logger.debug?.('streamWithAutoContinue telemetry failed:', err); }); // Silent - telemetry should not break flow
}

        // FIX: Update conversation-level counter to prevent infinite loops across requests
        if (conversationId) {
          trackConversation(conversationId, continuationCount + 1);
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
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // MULTI-FACTOR DETECTION (detectNeedsMoreTurns)
      // ═══════════════════════════════════════════════════════════════════════
      // Replaces three separate heuristic blocks (info-gathering tool check,
      // tool-call-only silence detector, and incomplete response detection)
      // with the shared auto-continue-detector's 14-signal engine.
      //
      // The detector covers all three cases above plus:
      //   - read-then-stall / deep-research-loop (info-gathering)
      //   - empty-after-tools (tools without text)
      //   - incomplete-thought / mid-sentence-cutoff / unclosed-code-block (incomplete)
      //   - failure-cascade, write-verify-loop, announced-next-step,
      //     step-enumeration, planned-multi-step, single-write-silent,
      //     diff-no-explanation, edits-mismatch
      // ═══════════════════════════════════════════════════════════════════════

      // Build a DetectableResult from the accumulated stream state
      const hasContinuationMarker = fullResponse.includes('[NEXT]') || fullResponse.includes('[CONTINUE]') || fullResponse.includes('[AUTO-CONTINUE]');

      if (!hasContinuationMarker) {
        const detectableResult: DetectableResult = {
          success: isComplete,
          response: fullResponse,
          steps: allToolCalls.map((tc: any) => ({
            toolName: tc.name || tc.toolName || 'unknown',
            args: tc.arguments || tc.args || {},
            result: tc.result || { success: tc.state === 'result' },
          })),
        };

        const detection = detectNeedsMoreTurns(detectableResult);

        if (detection.needsMoreTurns) {
          // Use the detector's contextual reprompt when available,
          // fall back to generic signal-based prompt
          const reprompt = detection.suggestedReprompt || (
            detection.signals.includes('announced-next-step') || detection.signals.includes('planned-multi-step')
              ? `You outlined next steps. Now execute them — make the necessary changes without re-describing the plan.`
              : `Continue from where you left off. Complete the task by making file changes or providing your final response.`
          );

          logger.info('Auto-continuing: multi-factor detector fired', {
            signals: detection.signals,
            confidence: detection.confidence,
            responseLength: fullResponse.length,
            toolCallCount: allToolCalls.length,
            continuationCount: continuationCount + 1,
            maxContinuations,
            conversationId,
          });

          if (conversationId) {
            trackConversation(conversationId, continuationCount + 1);
          }

          // Determine the right prefix marker based on the dominant signal
          const hasIncompleteSignal = detection.signals.some(s =>
            ['incomplete-thought', 'mid-sentence-cutoff', 'unclosed-code-block'].includes(s)
          );
          const prefix = hasIncompleteSignal ? '[CONTINUE]' : '[NEXT]';

          yield {
            content: `\n\n${prefix} ${reprompt}${hasIncompleteSignal ? `\n\nLast 200 characters of your response:\n${fullResponse.slice(-200)}` : ''}`,
            isComplete: false,
            timestamp: new Date(),
            metadata: {
              autoContinue: true,
              reason: 'multi_factor_detection',
              signals: detection.signals,
              confidence: detection.confidence,
              detectorReprompt: reprompt,
              continuationCount: continuationCount + 1,
              maxContinuations,
            },
          };
          return;
        }
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

/**
 * Server-side auto-re-prompt: When the LLM calls tools but stops without a final response,
 * this wrapper detects it and automatically re-calls the LLM with tool results.
 *
 * This solves the issue where models (especially free-tier OpenRouter ones) don't
 * properly support multi-step tool calling via Vercel AI SDK's maxSteps.
 *
 * Usage:
 * ```ts
 * for await (const chunk of streamWithServerAutoRePrompt(baseStream, {
 *   userId, messages, tools, provider, model,
 * })) {
 *   yield chunk;
 * }
 * ```
 */
export async function* streamWithServerAutoRePrompt(
  generator: AsyncGenerator<any>,
  options: {
    userId: string;
    conversationId?: string;
    /** Original messages to re-prompt with */
    messages: any[];
    /** Tools available for execution */
    tools?: Record<string, any>;
    /** Provider/model for re-prompting */
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    /** Max re-prompt attempts (default: 3) */
    maxRePrompts?: number;
    /** Abort signal */
    signal?: AbortSignal;
  }
): AsyncGenerator<any> {
  const {
    userId,
    conversationId,
    messages,
    tools,
    provider,
    model,
    temperature = 0.7,
    maxTokens = 65536,
    maxRePrompts = 3,
    signal,
  } = options;

  let rePromptCount = 0;
  let fullResponse = '';
  const collectedToolResults: Array<{ toolCallId: string; toolName: string; args: Record<string, any>; result: any }> = [];

  // First pass: consume the original stream
  for await (const chunk of generator) {
    yield chunk;

    // Accumulate response text for multi-factor detection
    if (chunk.content && typeof chunk.content === 'string') {
      fullResponse += chunk.content;
    }

    // Collect tool invocations for potential re-prompt
    // Preserve both args (from the original call) and result (from execution)
    // so detectNeedsMoreTurns can evaluate args-based signals like
    // read-then-stall (uses lastStep.args.path) and write-verify-loop (path comparison).
    if (chunk.toolInvocations && Array.isArray(chunk.toolInvocations)) {
      for (const inv of chunk.toolInvocations) {
        if (inv.state === 'result' && inv.toolCallId && inv.toolName) {
          collectedToolResults.push({
            toolCallId: inv.toolCallId,
            toolName: inv.toolName,
            args: inv.args || inv.arguments || {},
            result: inv.result,
          });
        }
      }
    }

    // Track auto-continue events that indicate the LLM stopped prematurely
    if (chunk.type === 'auto-continue' || chunk.type === 'next') {
      logger.info('Auto-continue event detected, may need server-side re-prompt', {
        reason: chunk.metadata?.reason,
        toolResultCount: collectedToolResults.length,
      });
      // Record telemetry for auto-continue event detection
      if (collectedToolResults.length > 0) {
        const { redactedArgs, originStack } = prepareTelemetryPayload(
          { autoContinueEvent: true, toolResultCount: collectedToolResults.length, reason: chunk.metadata?.reason },
          { maxStringLength: 200, maxObjectProps: 5, maxArrayItems: 5 }
        );
        recordToolCallTelemetry({
          toolName: 'streamWithServerAutoRePrompt.autoContinueDetected',
          redactedArgs,
          model: options.model,
          provider: options.provider,
          originStack,
          toolCallId: options.conversationId ?? null,
        }).catch((err) => { logger.debug?.('streamWithServerAutoRePrompt telemetry failed:', err); });
      }
    }
  }

  // After stream completes: check if we need to re-prompt
  // This happens when tools were executed but the LLM didn't produce a final response
  if (collectedToolResults.length > 0 && rePromptCount < maxRePrompts) {
    // Use multi-factor detection (detectNeedsMoreTurns) instead of the old
    // single-signal `isInfoGatheringTool` check. This evaluates all 14 signals
    // including: read-then-stall, failure-cascade, announced-next-step,
    // incomplete-thought, mid-sentence-cutoff, single-write-silent, etc.
    const detectableResult: DetectableResult = {
      success: true,
      response: fullResponse,
      steps: collectedToolResults.map(tr => ({
        toolName: tr.toolName,
        args: tr.args || {},
        result: { success: tr.result?.success !== false, output: tr.result?.output },
      })),
    };

    const detection = detectNeedsMoreTurns(detectableResult);

    if (detection.needsMoreTurns) {
      logger.info('Server-side re-prompt needed: multi-factor detector fired', {
        signals: detection.signals,
        confidence: detection.confidence,
        toolResults: collectedToolResults.map(t => t.toolName),
        rePromptCount: rePromptCount + 1,
      });
      // Record telemetry for re-prompt trigger
      const { redactedArgs, originStack } = prepareTelemetryPayload(
        { rePromptTriggered: true, signals: detection.signals, confidence: detection.confidence, toolNames: collectedToolResults.map(t => t.toolName), rePromptCount: rePromptCount + 1, maxRePrompts: options.maxRePrompts },
        { maxStringLength: 200, maxObjectProps: 5, maxArrayItems: 5 }
      );
      recordToolCallTelemetry({
        toolName: 'streamWithServerAutoRePrompt.rePromptTriggered',
        redactedArgs,
        model: options.model,
        provider: options.provider,
        originStack,
        toolCallId: options.conversationId ?? null,
      }).catch((err) => { logger.debug?.('streamWithServerAutoRePrompt rePrompt telemetry failed:', err); });

      rePromptCount++;

      // Build messages with tool results appended
      const messagesWithToolResults = [
        ...messages,
        {
          role: 'system' as const,
          content: `\n\n[SYSTEM] You previously executed these tools and got results. Please analyze the results and continue with your task:\n${
            collectedToolResults.map(tr =>
              `- ${tr.toolName}: ${tr.result?.success ? 'success' : 'failed'}${tr.result?.output ? ` (${tr.result.output.slice(0, 200)})` : ''}`
            ).join('\n')
          }\n\nPlease continue with the task based on the tool results above.`,
        },
      ];

      // Re-call the LLM with tool results
      try {
        const { streamWithVercelAI } = await import('../chat/vercel-ai-streaming');

        for await (const chunk of streamWithVercelAI({
          provider,
          model,
          messages: messagesWithToolResults,
          temperature,
          maxTokens,
          maxSteps: 1, // Just one more response, no more tool auto-execution
          tools: tools ? {} : undefined, // Don't re-execute tools in re-prompt
          toolCallStreaming: false,
          smoothStreaming: true,
          signal,
        })) {
          yield {
            ...chunk,
            metadata: {
              ...chunk.metadata,
              isRePrompt: true,
              rePromptCount,
            },
          };
        }
      } catch (error: any) {
        logger.warn('Server-side re-prompt failed, continuing', {
          error: error.message,
        });
      }
    }
  }
}


