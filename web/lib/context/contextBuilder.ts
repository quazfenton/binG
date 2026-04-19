/**
 * contextBuilder.ts — Unified, token-aware, structured context window builder
 *
 * Single source of truth for:
 * - Token estimation (consistent ratio across ALL callers)
 * - Format serialization (markdown | xml | json | plain)
 * - Ranked symbol selection with diversity constraints
 * - Prompt injection helpers
 *
 * All context-producing systems should use this instead of ad-hoc formatting.
 */

import type { RankedSymbol } from "../retrieval/similarity";

// ─── Unified Token Estimation ────────────────────────────────────────────────

/**
 * Fast token approximation for code text.
 * Uses 3.8 chars/token — middle ground between OpenAI's ~4 and code-heavy ~3.5.
 * This single function should be used by ALL context builders for consistency.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 3.8);
}

/**
 * Estimate tokens from raw bytes (UTF-8).
 * Useful when you already have the byte length.
 */
export function estimateTokensFromBytes(byteLength: number): number {
  if (byteLength === 0) return 0;
  return Math.ceil(byteLength / 3.8);
}

// ─── Context Format ─────────────────────────────────────────────────────────

export type ContextFormat = 'markdown' | 'xml' | 'json' | 'plain';

// ─── Context Building Options ────────────────────────────────────────────────

export interface ContextBuilderOptions {
  /** Token budget for context (default: 6000) */
  maxTokens?: number;
  /** Max symbols per file (prevents one file dominating, default: 3) */
  maxPerFile?: number;
  /** Group related symbols by file (default: true) */
  groupByFile?: boolean;
  /** Include score breakdown (default: false) */
  includeScores?: boolean;
  /** Output format (default: 'markdown') */
  format?: ContextFormat;
}

// ─── Built Context (structured, format-agnostic) ─────────────────────────────

export interface BuiltContext {
  /** Serialized text in the requested format */
  text: string;
  /** Estimated token count of the serialized text */
  tokenCount: number;
  /** Number of symbols included */
  symbolCount: number;
  /** File paths included */
  filesIncluded: string[];
  /** Detailed symbol info for debugging */
  symbolsIncluded: Array<{ name: string; file: string; score: number }>;
  /** Whether some symbols were dropped due to budget */
  truncated: boolean;
  /** Format used for serialization */
  format: ContextFormat;
}

// ─── Main Builder ────────────────────────────────────────────────────────────

export function buildContext(
  rankedSymbols: RankedSymbol[],
  opts: ContextBuilderOptions = {}
): BuiltContext {
  const {
    maxTokens = 6000,
    maxPerFile = 3,
    groupByFile = true,
    includeScores = false,
    format = 'markdown',
  } = opts;

  // Guard against invalid options
  const safeMaxTokens = Math.max(1, maxTokens);
  const safeMaxPerFile = Math.max(1, Math.min(maxPerFile, 20));

  // 1. Apply diversity constraint — max per file
  const fileCounters = new Map<string, number>();
  const selected: RankedSymbol[] = [];

  for (const symbol of rankedSymbols) {
    const count = fileCounters.get(symbol.filePath) ?? 0;
    if (count < safeMaxPerFile) {
      selected.push(symbol);
      fileCounters.set(symbol.filePath, count + 1);
    }
  }

  // 2. Fit into token budget — greedy with continue-on-skip
  let tokenCount = 0;
  const fitted: RankedSymbol[] = [];

  for (const symbol of selected) {
    const blockText = formatSymbolBlockPlain(symbol, includeScores);
    const cost = estimateTokens(blockText);

    if (tokenCount + cost > safeMaxTokens) continue;

    fitted.push(symbol);
    tokenCount += cost;
  }

  const truncated = fitted.length < selected.length;

  // 3. Serialize in requested format
  const text = serializeContext(fitted, format, groupByFile, includeScores);

  // 4. Re-count tokens on final serialized text (more accurate)
  const finalTokenCount = estimateTokens(text);

  return {
    text,
    tokenCount: finalTokenCount,
    symbolCount: fitted.length,
    filesIncluded: Array.from(new Set(fitted.map((s) => s.filePath))),
    symbolsIncluded: fitted.map((s) => ({
      name: s.name,
      file: s.filePath,
      score: parseFloat(s.score.toFixed(3)),
    })),
    truncated,
    format,
  };
}

// ─── Serialization Dispatcher ────────────────────────────────────────────────

function serializeContext(
  symbols: RankedSymbol[],
  format: ContextFormat,
  groupByFile: boolean,
  includeScores: boolean
): string {
  switch (format) {
    case 'xml':
      return serializeXml(symbols, groupByFile);
    case 'json':
      return serializeJson(symbols, groupByFile);
    case 'plain':
      return serializePlain(symbols);
    case 'markdown':
    default:
      return groupByFile
        ? serializeMarkdownGrouped(symbols, includeScores)
        : serializeMarkdownFlat(symbols, includeScores);
  }
}

// ─── Markdown Serializer ─────────────────────────────────────────────────────

function serializeMarkdownGrouped(symbols: RankedSymbol[], includeScores: boolean): string {
  const groups = new Map<string, RankedSymbol[]>();
  for (const s of symbols) {
    if (!groups.has(s.filePath)) groups.set(s.filePath, []);
    groups.get(s.filePath)!.push(s);
  }

  const parts: string[] = [];

  for (const [filePath, fileSymbols] of groups) {
    const symbolBlocks = fileSymbols.map((s) => formatSymbolBlock(s, includeScores));
    parts.push(`## File: ${filePath}\n\n${symbolBlocks.join('\n\n')}`);
  }

  return parts.join('\n\n---\n\n');
}

function serializeMarkdownFlat(symbols: RankedSymbol[], includeScores: boolean): string {
  return symbols.map((s) => formatSymbolBlock(s, includeScores)).join('\n\n---\n\n');
}

function formatSymbolBlock(symbol: RankedSymbol, includeScore: boolean): string {
  const scoreNote = includeScore ? ` [score: ${symbol.score.toFixed(3)}]` : '';
  return `### ${symbol.name} (${symbol.kind})${scoreNote}
File: ${symbol.filePath} (L${symbol.startLine}–${symbol.endLine})

\`\`\`${languageTag(symbol.language)}
${symbol.content}
\`\`\``;
}

/** Plain-text block (no markdown fences) for budget estimation and plain format */
function formatSymbolBlockPlain(symbol: RankedSymbol, includeScore: boolean): string {
  const scoreNote = includeScore ? ` [score: ${symbol.score.toFixed(3)}]` : '';
  return `${symbol.name} (${symbol.kind})${scoreNote}\nFile: ${symbol.filePath} (L${symbol.startLine}–${symbol.endLine})\n\n${symbol.content}`;
}

// ─── XML Serializer ──────────────────────────────────────────────────────────

function serializeXml(symbols: RankedSymbol[], groupByFile: boolean): string {
  const escapeXml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  if (groupByFile) {
    const groups = new Map<string, RankedSymbol[]>();
    for (const s of symbols) {
      if (!groups.has(s.filePath)) groups.set(s.filePath, []);
      groups.get(s.filePath)!.push(s);
    }

    const parts: string[] = [];
    for (const [filePath, fileSymbols] of groups) {
      const symbolBlocks = fileSymbols.map((s) =>
        `    <symbol name="${escapeXml(s.name)}" kind="${escapeXml(s.kind)}" lines="${s.startLine}-${s.endLine}">\n${escapeXml(s.content)}\n    </symbol>`
      ).join('\n');
      parts.push(`  <file path="${escapeXml(filePath)}">\n${symbolBlocks}\n  </file>`);
    }
    return `<context>\n${parts.join('\n')}\n</context>`;
  }

  const symbolBlocks = symbols.map((s) =>
    `  <symbol name="${escapeXml(s.name)}" kind="${escapeXml(s.kind)}" file="${escapeXml(s.filePath)}" lines="${s.startLine}-${s.endLine}">\n${escapeXml(s.content)}\n  </symbol>`
  ).join('\n');

  return `<context>\n${symbolBlocks}\n</context>`;
}

// ─── JSON Serializer ─────────────────────────────────────────────────────────

function serializeJson(symbols: RankedSymbol[], groupByFile: boolean): string {
  if (groupByFile) {
    const groups = new Map<string, RankedSymbol[]>();
    for (const s of symbols) {
      if (!groups.has(s.filePath)) groups.set(s.filePath, []);
      groups.get(s.filePath)!.push(s);
    }

    const data: Record<string, any> = {};
    for (const [filePath, fileSymbols] of groups) {
      data[filePath] = fileSymbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        startLine: s.startLine,
        endLine: s.endLine,
        score: s.score,
        content: s.content,
      }));
    }
    return JSON.stringify(data, null, 2);
  }

  const data = {
    context: symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      file: s.filePath,
      startLine: s.startLine,
      endLine: s.endLine,
      score: s.score,
      content: s.content,
    })),
  };
  return JSON.stringify(data, null, 2);
}

// ─── Plain Serializer ────────────────────────────────────────────────────────

function serializePlain(symbols: RankedSymbol[]): string {
  return symbols.map((s) =>
    `${s.name} (${s.kind})\nFile: ${s.filePath} (L${s.startLine}–${s.endLine})\n\n${s.content}`
  ).join('\n\n---\n\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function languageTag(lang: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    rs: 'rust',
    js: 'javascript',
    jsx: 'jsx',
    other: '',
  };
  return map[lang] ?? lang;
}

// ─── Prompt Injection ────────────────────────────────────────────────────────

/**
 * Injects retrieved context into a user message prompt.
 * Uses XML-style <context> tags regardless of internal serialization format.
 */
export function injectContextIntoPrompt(
  userMessage: string,
  context: BuiltContext
): string {
  if (context.symbolCount === 0) return userMessage;

  return `<context>
${context.text}
</context>

${userMessage}`;
}

/**
 * Builds a system prompt that tells the model how to use the injected context.
 * Adapts instructions based on the context format.
 */
export function buildContextSystemPrompt(projectName?: string, format?: ContextFormat): string {
  const project = projectName ? ` for the "${projectName}" project` : '';

  const contextInstructions: Record<ContextFormat, string> = {
    json: 'Use the provided JSON context object which contains relevant code symbols retrieved from the codebase, ranked by relevance score.',
    xml: 'Use the provided XML <context> blocks which contain relevant code symbols retrieved from the codebase, ranked by relevance.',
    markdown: 'Use the provided markdown context blocks which contain relevant code symbols retrieved from the codebase, ranked by relevance.',
    plain: 'Use the provided context which contains relevant code symbols retrieved from the codebase, ranked by relevance.',
  };

  const instruction = contextInstructions[format || 'json'];

  return `You are an expert coding assistant${project}.

When answering, ${instruction}

- Reference specific functions, classes, and files by name
- If you need to edit code, output unified diffs
- If context is insufficient, say so explicitly rather than guessing`;
}
