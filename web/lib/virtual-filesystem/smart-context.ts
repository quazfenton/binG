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
import type { VirtualFile } from './filesystem-types';
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
} {
  const extensions = new Set<string>();
  const keywords = new Set<string>();
  const possiblePaths: string[] = [];
  let hasAtMention = false;

  // Normalize prompt
  const lower = prompt.toLowerCase();

  // Detect @mentions (already resolved to filenames by UI)
  if (prompt.includes('@')) {
    hasAtMention = true;
  }

  // Extract file-like patterns: words with extensions
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

  return { extensions, keywords, possiblePaths, hasAtMention };
}

/**
 * Scan a file's content for import statements to find related files
 */
function extractImportsFromContent(content: string): string[] {
  const imports: string[] = [];
  // Match various import patterns
  const patterns = [
    /(?:import|from)\s+['"]([^'"]+)['"]/g,     // ES imports
    /require\(['"]([^'"]+)['"]\)/g,              // CommonJS
    /#include\s+["<]([^">]+)[">]/g,              // C/C++
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let path = match[1];
      // Normalize: remove leading ./ and extensions
      path = path.replace(/^\.\//, '').replace(/\.(tsx?|jsx?)$/, '');
      if (path && !path.startsWith('node_modules') && !path.startsWith('@/')) {
        imports.push(path);
      }
    }
  }
  return imports;
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
): FileScore {
  const path = file.path.toLowerCase();
  const filename = path.split('/').pop() || '';
  const ext = '.' + (filename.split('.').pop() || '');
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  const score = SCORE_THRESHOLDS.BASE;
  const reasons: string[] = [];

  // 1. Explicit @mention or manual attachment (highest weight)
  if (explicitFiles.has(path) || explicitFiles.has(filename)) {
    return { path: file.path, score: SCORE_THRESHOLDS.EXPLICIT, reasons: ['explicitly attached'] };
  }

  // 2. Exact filename match in prompt
  if (signals.possiblePaths.some(p => path.includes(p) || filename.includes(p))) {
    reasons.push('exact filename match');
    return { path: file.path, score: SCORE_THRESHOLDS.EXACT_MATCH, reasons };
  }

  // 3. Extension match
  if (signals.extensions.has(ext)) {
    reasons.push(`extension match (${ext})`);
  }

  // 4. Keyword match in filename
  for (const keyword of signals.keywords) {
    if (filename.includes(keyword) || filename.replace(/\.(tsx?|jsx?|py|rs)$/, '').includes(keyword)) {
      reasons.push(`keyword "${keyword}" in filename`);
      break;
    }
  }

  // 5. Same directory as explicit file
  for (const explicit of explicitFiles) {
    const explicitDir = explicit.substring(0, explicit.lastIndexOf('/') + 1);
    if (dir === explicitDir && explicitDir.length > 0) {
      reasons.push('same directory as attached file');
      break;
    }
  }

  // 6. Import-related files
  if (importMap.has(path)) {
    for (const imported of importMap.get(path)!) {
      if (explicitFiles.has(imported)) {
        reasons.push('imports an attached file');
        break;
      }
    }
  }
  if (reverseImportMap.has(path)) {
    for (const importer of reverseImportMap.get(path)!) {
      if (explicitFiles.has(importer)) {
        reasons.push('imported by attached file');
        break;
      }
    }
  }

  if (reasons.length === 0) return { path: file.path, score: 0, reasons: [] };

  // Calculate final score
  let finalScore = score;
  if (signals.extensions.has(ext)) finalScore += SCORE_THRESHOLDS.EXTENSION_MATCH;
  if (reasons.some(r => r.includes('keyword'))) finalScore += SCORE_THRESHOLDS.KEYWORD_MATCH;
  if (reasons.some(r => r.includes('same directory'))) finalScore += SCORE_THRESHOLDS.SAME_DIR;
  if (reasons.some(r => r.includes('import'))) finalScore += SCORE_THRESHOLDS.IMPORT_RELATED;

  return { path: file.path, score: finalScore, reasons };
}

/**
 * Generate smart context — intelligently ranked file selection for LLM
 */
export async function generateSmartContext(options: SmartContextOptions): Promise<SmartContextResult> {
  const { userId, prompt, conversationId, explicitFiles: explicitFileList = [], maxTotalSize = 500000, format = 'markdown', maxLinesPerFile = 500 } = options;
  const warnings: string[] = [];
  const explicitFiles = new Set(explicitFileList.map(f => f.toLowerCase()));
  const signals = extractPromptSignals(prompt);

  // Collect all files from VFS
  let allFiles: VirtualFile[] = [];
  let tree = '';
  try {
    // Get directory tree
    const listing = await virtualFilesystem.listDirectory(userId, '/');
    allFiles = await collectAllFiles(userId, '/');
    tree = buildTreeString(listing.nodes || [], '', 0);
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

  // Build import map for relationship scoring
  const importMap = new Map<string, Set<string>>();
  const reverseImportMap = new Map<string, Set<string>>();
  for (const file of allFiles) {
    try {
      const content = await virtualFilesystem.readFile(userId, file.path);
      const imports = extractImportsFromContent(content.content);
      importMap.set(file.path.toLowerCase(), new Set(imports));
      for (const imp of imports) {
        if (!reverseImportMap.has(imp)) reverseImportMap.set(imp, new Set());
        reverseImportMap.get(imp)!.add(file.path.toLowerCase());
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Score all files
  const scored = allFiles
    .map(f => scoreFile(f, signals, explicitFiles, allFiles, importMap, reverseImportMap))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Select files up to maxTotalSize
  const encoder = new TextEncoder();
  const selected: { file: VirtualFile; score: FileScore }[] = [];
  let currentSize = 0;

  // Always include explicit files first
  for (const scoredFile of scored) {
    if (scoredFile.score >= SCORE_THRESHOLDS.EXPLICIT) {
      try {
        const file = await virtualFilesystem.readFile(userId, scoredFile.path);
        const content = truncateContent(file.content, maxLinesPerFile);
        currentSize += encoder.encode(content).length;
        if (currentSize <= maxTotalSize) {
          selected.push({ file: { ...file, content }, score: scoredFile });
        }
      } catch { /* skip */ }
    }
  }

  // Then add scored files
  for (const scoredFile of scored) {
    if (scoredFile.score < SCORE_THRESHOLDS.EXPLICIT) {
      try {
        const file = await virtualFilesystem.readFile(userId, scoredFile.path);
        const content = truncateContent(file.content, maxLinesPerFile);
        const size = encoder.encode(content).length;
        if (currentSize + size <= maxTotalSize) {
          selected.push({ file: { ...file, content }, score: scoredFile });
          currentSize += size;
        }
      } catch { /* skip */ }
    }
  }

  // If VFS is small enough, include everything
  if (allFiles.length <= 5 && selected.length < allFiles.length) {
    for (const file of allFiles) {
      if (!selected.find(s => s.file.path === file.path)) {
        try {
          const fullFile = await virtualFilesystem.readFile(userId, file.path);
          selected.push({ file: fullFile, score: { path: file.path, score: SCORE_THRESHOLDS.BASE, reasons: ['small workspace'] } });
        } catch { /* skip */ }
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
      const nodePath = path === '/' ? node.name : `${path}/${node.name}`;
      if (node.isDirectory) {
        files.push(...await collectAllFiles(ownerId, nodePath));
      } else {
        files.push({
          path: nodePath,
          content: '',
          size: node.size || 0,
          version: 1,
          lastModified: node.modifiedAt || new Date().toISOString(),
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
function buildTreeString(nodes: Array<{ name: string; isDirectory?: boolean }>, prefix: string, depth: number): string {
  let result = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    result += `${prefix}${connector}${node.name}${node.isDirectory ? '/' : ''}\n`;
    if (node.isDirectory) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      // Would need recursive listing here — simplified for now
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
    xml += `<tree>\n${tree}</tree>\n`;
    for (const s of selected) {
      xml += `<file path="${s.file.path}" score="${s.score.score}" reasons="${s.score.reasons.join(', ')}">\n`;
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
