/**
 * contextBuilder.ts — Token-aware, structured context window builder
 *
 * Turns ranked symbols into a clean, structured prompt context that:
 * - respects token budgets
 * - groups related symbols together
 * - avoids dumping too many symbols from the same file
 * - formats nicely for LLM consumption
 */

import type { RankedSymbol } from "./similarity";

// ─── Token Estimation ─────────────────────────────────────────────────────────

/** Fast token approximation (~4 chars per token for code) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ─── Context Building Options ─────────────────────────────────────────────────

export interface ContextBuilderOptions {
  /** Token budget for context (default: 6000) */
  maxTokens?: number;
  /** Max symbols per file (prevents one file dominating) */
  maxPerFile?: number;
  /** Group related symbols by file */
  groupByFile?: boolean;
  /** Include score breakdown for debugging */
  includeScores?: boolean;
}

// ─── Built Context ────────────────────────────────────────────────────────────

export interface BuiltContext {
  text: string;
  tokenCount: number;
  symbolCount: number;
  filesIncluded: string[];
  symbolsIncluded: Array<{ name: string; file: string; score: number }>;
  truncated: boolean;
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

export function buildContext(
  rankedSymbols: RankedSymbol[],
  opts: ContextBuilderOptions = {}
): BuiltContext {
  const {
    maxTokens = 6000,
    maxPerFile = 3,
    groupByFile = true,
    includeScores = false,
  } = opts;

  // 1. Apply diversity constraint — max per file
  const fileCounters = new Map<string, number>();
  const selected: RankedSymbol[] = [];

  for (const symbol of rankedSymbols) {
    const count = fileCounters.get(symbol.filePath) ?? 0;
    if (count < maxPerFile) {
      selected.push(symbol);
      fileCounters.set(symbol.filePath, count + 1);
    }
  }

  // 2. Fit into token budget greedily
  let tokenCount = 0;
  const fitted: RankedSymbol[] = [];

  for (const symbol of selected) {
    const block = formatSymbolBlock(symbol, includeScores);
    const cost = estimateTokens(block);

    if (tokenCount + cost > maxTokens) break;

    fitted.push(symbol);
    tokenCount += cost;
  }

  const truncated = fitted.length < selected.length;

  // 3. Format output
  const text = groupByFile
    ? formatGroupedByFile(fitted, includeScores)
    : formatFlat(fitted, includeScores);

  return {
    text,
    tokenCount,
    symbolCount: fitted.length,
    filesIncluded: [...new Set(fitted.map((s) => s.filePath))],
    symbolsIncluded: fitted.map((s) => ({
      name: s.name,
      file: s.filePath,
      score: parseFloat(s.score.toFixed(3)),
    })),
    truncated,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatSymbolBlock(symbol: RankedSymbol, includeScore: boolean): string {
  const scoreNote = includeScore
    ? ` [score: ${symbol.score.toFixed(3)}]`
    : "";

  return `### ${symbol.name} (${symbol.kind})${scoreNote}
File: ${symbol.filePath} (L${symbol.startLine}–${symbol.endLine})

\`\`\`${languageTag(symbol.language)}
${symbol.content}
\`\`\``;
}

function formatGroupedByFile(symbols: RankedSymbol[], includeScore: boolean): string {
  // Group by file
  const groups = new Map<string, RankedSymbol[]>();
  for (const s of symbols) {
    if (!groups.has(s.filePath)) groups.set(s.filePath, []);
    groups.get(s.filePath)!.push(s);
  }

  const parts: string[] = [];

  for (const [filePath, fileSymbols] of groups) {
    const symbolBlocks = fileSymbols.map((s) => formatSymbolBlock(s, includeScore));
    parts.push(`## File: ${filePath}\n\n${symbolBlocks.join("\n\n")}`);
  }

  return parts.join("\n\n---\n\n");
}

function formatFlat(symbols: RankedSymbol[], includeScore: boolean): string {
  return symbols.map((s) => formatSymbolBlock(s, includeScore)).join("\n\n---\n\n");
}

function languageTag(lang: string): string {
  const map: Record<string, string> = {
    ts: "typescript",
    py: "python",
    rs: "rust",
    other: "",
  };
  return map[lang] ?? lang;
}

// ─── Prompt Injection ─────────────────────────────────────────────────────────

/**
 * Injects retrieved context into a user message prompt.
 * Use this before sending to the LLM.
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
 */
export function buildSystemPrompt(projectName?: string): string {
  const project = projectName ? ` for the "${projectName}" project` : "";
  return `You are an expert coding assistant${project}. 

When answering, use the provided <context> blocks which contain relevant code symbols retrieved from the codebase. The context is pre-ranked by relevance.

- Reference specific functions, classes, and files by name
- If you need to edit code, output unified diffs
- If context is insufficient, say so explicitly rather than guessing`;
}
