import React from "react";

/**
 * Sub-provider prefix → human-readable label for grouping ninerouter models in the UI.
 *
 * Used by both llm-selector.tsx and interaction-panel.tsx to provide
 * consistent visual grouping of the 130+ ninerouter models by internal provider.
 */
export const SUBPROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini API',
  ag: 'Antigravity OAuth',
  gc: 'Gemini CLI',
  gh: 'GitHub Copilot',
  kc: 'Kilo Code',
  kr: 'Kiro (Amazon)',
  oc: 'Opencode Free',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  ollama: 'Ollama Cloud',
  cf: 'Cloudflare',
  mistral: 'Mistral',
};

/**
 * Fuzzy-match a model ID against a search term.
 * Splits the search term by spaces into tokens; each token must be a
 * case-insensitive substring of the model ID.  "gem flash" matches
 * "gemini/gemini-3-flash-preview" because both "gem" and "flash" are
 * substrings.
 */
export function fuzzyMatchModel(modelId: string, searchTerm: string): boolean {
  const term = searchTerm.toLowerCase().trim();
  if (!term) return true;
  const tokens = term.split(/\s+/);
  const lower = modelId.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

/** Highlight match region */
interface MatchRegion {
  start: number;
  end: number;
}

/**
 * Build a React fragment where every occurrence of every search-token
 * substring is wrapped in a bold span.  Non-overlapping matches only;
 * earlier matches take priority when tokens overlap.
 *
 * Returns a plain string when `searchTerm` is empty, so callers always
 * get a ReactNode.
 */
export function highlightFuzzyMatches(
  text: string,
  searchTerm: string,
): string | React.ReactNode {
  const term = searchTerm.toLowerCase().trim();
  if (!term) return text;

  const tokens = term.split(/\s+/);
  const lowerText = text.toLowerCase();
  const regions: MatchRegion[] = [];

  for (const token of tokens) {
    let pos = 0;
    while (pos < lowerText.length) {
      const idx = lowerText.indexOf(token, pos);
      if (idx === -1) break;
      regions.push({ start: idx, end: idx + token.length });
      pos = idx + 1; // allow overlapping matches for same token
    }
  }

  if (regions.length === 0) return text;

  // Sort by start, then by longest match first (so longer tokens win ties)
  regions.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Merge overlapping regions, keeping first (longest) for each span
  const merged: MatchRegion[] = [];
  for (const r of regions) {
    if (merged.length === 0 || r.start >= merged[merged.length - 1].end) {
      merged.push(r);
    }
  }

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const r of merged) {
    if (r.start > last) parts.push(text.slice(last, r.start));
    parts.push(
      <span key={r.start} className="font-bold text-white">
        {text.slice(r.start, r.end)}
      </span>
    );
    last = r.end;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <>{parts}</>;
}
