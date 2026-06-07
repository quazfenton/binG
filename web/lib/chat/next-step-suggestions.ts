/**
 * Next-Step Suggestion Service
 *
 * Generates 3 short, clickable suggestions of what the user might want
 * to do next, based on the user's recent prompt(s) and the assistant's
 * last response. The suggestions appear as chips below the last message
 * bubble and are sent as new user prompts when clicked.
 *
 * Design goals:
 *  - Lightweight: reuses the spec-amplification "fast model" pipeline
 *    (small model, low token cap) for minimal latency and cost.
 *  - Non-intrusive: only fires on seemingly-complete, non-error,
 *    non-autocontinue sequences.
 *  - Bounded: each suggestion is at most 2 short sentences; chips
 *    are compacted to a max display length with a hover-to-expand
 *    for the longer description.
 *  - Resilient: if the request fails or returns malformed JSON,
 *    the UI simply shows no suggestions.
 *
 * This service deliberately mirrors the spec-amplification request
 * shape (system + user messages, maxTokens, fast-model provider) so
 * the existing telemetry/logging paths can record it consistently.
 */

import { enhancedLLMService } from '@/lib/chat/enhanced-llm-service';
import { getSpecGenerationModel } from '@/lib/providers/model-ranker';
import type { LLMResponse } from '@/lib/providers/llm-providers';

export interface NextStepSuggestion {
  /** Short, clickable label (chip text). <= ~48 chars, ideally 2-6 words. */
  label: string;
  /** Full suggestion text. <= 2 sentences. */
  fullText: string;
}

export interface NextStepSuggestionsResult {
  suggestions: NextStepSuggestion[];
}

/**
 * Build the system prompt for next-step suggestions.
 *
 * The model is asked to return a strict JSON object with exactly 3
 * suggestions. Each suggestion has a short `label` and a slightly
 * longer `fullText`. No markdown, no commentary.
 */
function buildSuggestionsSystemPrompt(): string {
  return `You are a helpful assistant that suggests the 3 most likely next steps a user might want to take after a conversation turn.

STRICT RULES:
- Return ONLY valid JSON (no markdown, no code blocks, no preamble).
- Output exactly 3 suggestions.
- Each suggestion's "label" must be 2-6 words, action-oriented, and <= 48 characters.
- Each suggestion's "fullText" must be at most 2 short sentences describing what would happen if the user picked it.
- Suggestions must be relevant to the user's last prompt(s) and the assistant's last response.
- Do NOT suggest things the assistant already did or is in the middle of doing.
- Do NOT suggest clarifications if the assistant's response was a question to the user (the user will answer that directly).
- Be specific. Avoid generic filler like "Tell me more" or "Continue".

FORMAT (strict JSON, no trailing commas):
{
  "suggestions": [
    { "label": "Short action", "fullText": "Sentence one. Sentence two." },
    { "label": "Another action", "fullText": "Sentence one. Sentence two." },
    { "label": "Third action", "fullText": "Sentence one. Sentence two." }
  ]
}`;
}

/**
 * Build the user message containing the recent conversation context.
 *
 * @param recentPrompts - Last 1-2 user prompts (most recent last).
 * @param lastResponse - The assistant's last response (truncated to a safe size).
 */
function buildSuggestionsUserMessage(
  recentPrompts: string[],
  lastResponse: string,
): string {
  const MAX_RESPONSE_CHARS = 4000; // Cap to keep token usage tiny
  const truncatedResponse =
    lastResponse.length > MAX_RESPONSE_CHARS
      ? lastResponse.slice(0, MAX_RESPONSE_CHARS) + '…'
      : lastResponse;

  const promptSection =
    recentPrompts.length === 0
      ? '(no prior user prompt)'
      : recentPrompts.map((p, i) => `[User prompt ${i + 1}]\n${p}`).join('\n\n');

  return `Recent user prompt(s):\n${promptSection}\n\nAssistant's last response:\n${truncatedResponse}\n\nGenerate 3 next-step suggestions.`;
}

/**
 * Parse the model's raw text output into a validated `NextStepSuggestionsResult`.
 * Returns an empty result on any parse / validation failure.
 *
 * Robust against truncation: if the full JSON parse fails, we attempt to
 * extract individual suggestion objects from anywhere in the raw text.
 * This handles the case where `finishReason: 'length'` cut the output mid-JSON.
 */
function parseSuggestions(raw: string): NextStepSuggestionsResult {
  if (!raw || typeof raw !== 'string') {
    return { suggestions: [] };
  }

  // --- Attempt 1: full JSON parse (works when response is complete) ---
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const suggestions = extractSuggestionsFromParsed(parsed);
      if (suggestions.length > 0) {
        return { suggestions };
      }
      // parsed but no valid suggestions — fall through to partial extraction
    } catch {
      // malformed JSON — fall through to partial extraction
    }
  }

  // --- Attempt 2: extract individual { "label": ..., "fullText": ... } objects ---
  // Catches suggestions that were cut mid-JSON or wrapped in code fences, etc.
  const extracted = extractSuggestionsFromRaw(raw);
  return { suggestions: extracted };
}

/**
 * Extract valid NextStepSuggestion[] from a parsed JSON object.
 * Accepts both the canonical { suggestions: [...] } shape and individual
 * suggestion objects.
 */
function extractSuggestionsFromParsed(parsed: any): NextStepSuggestion[] {
  const cleaned: NextStepSuggestion[] = [];

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.suggestions)
    ? parsed.suggestions
    : [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const fullText = typeof item.fullText === 'string' ? item.fullText.trim() : '';
    if (!label || !fullText) continue;
    cleaned.push({ label: cap(label, 48), fullText: cap(fullText, 280) });
    if (cleaned.length === 3) break;
  }

  return cleaned;
}

/**
 * Fallback extractor: scan raw text for individual { "label": ..., "fullText": ... }
 * objects even when JSON.parse fails. Handles truncation, markdown code fences,
 * incomplete JSON, etc.
 */
function extractSuggestionsFromRaw(raw: string): NextStepSuggestion[] {
  const cleaned: NextStepSuggestion[] = [];
  const seen = new Set<string>();

  // Match individual suggestion objects (including partial ones at the end of truncated output)
  const suggestionMatches = raw.matchAll(
    /\{[^{}]*"label"[^{}]*"fullText"[^{}]*\}/g,
  );

  for (const match of suggestionMatches) {
    try {
      const obj = JSON.parse(match[0]);
      const label = typeof obj.label === 'string' ? obj.label.trim() : '';
      const fullText = typeof obj.fullText === 'string' ? obj.fullText.trim() : '';
      if (!label || !fullText) continue;
      const key = label.toLowerCase().slice(0, 24);
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push({ label: cap(label, 48), fullText: cap(fullText, 280) });
      if (cleaned.length === 3) break;
    } catch {
      // not valid JSON — skip
    }
  }

  return cleaned;
}

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Generate next-step suggestions for the given conversation context.
 *
 * Reuses the same "fast model" provider selection as spec-amplification
 * to keep behavior consistent (telemetry, ranking, fallback to
 * `mistral-small-latest` when no telemetry is available).
 *
 * @param recentPrompts - Last 1-2 user prompts (most recent last).
 * @param lastResponse - The assistant's last response text.
 * @param requestId - Optional request ID for telemetry correlation.
 * @returns Up to 3 suggestions, or an empty array on failure.
 */
export async function generateNextStepSuggestions(
  recentPrompts: string[],
  lastResponse: string,
  requestId?: string,
): Promise<NextStepSuggestion[]> {
  // Fast-model provider selection mirrors spec-amplification
  let fastModel: any = null;
  try {
    fastModel = await getSpecGenerationModel();
  } catch {
    fastModel = null;
  }

  if (!fastModel) {
    fastModel = {
      provider: 'mistral',
      model: 'mistral-small-latest',
    };
  }

  const system = buildSuggestionsSystemPrompt();
  const userMessage = buildSuggestionsUserMessage(recentPrompts, lastResponse);

  const reqId =
    requestId ||
    `nextstep-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    const response = (await enhancedLLMService.generateResponse({
      provider: fastModel.provider,
      model: fastModel.model,
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 700,
      stream: false,
      requestId: reqId,
      temperature: 0.4,
    } as any)) as LLMResponse | string | null | undefined;

    // The service can return a string or an `LLMResponse` object. LLMResponse
    // only has a `content` field — `.text` is dead code (see llm-providers.ts).
    const rawText =
      typeof response === 'string'
        ? response
        : (response?.content ?? '');

    const { suggestions } = parseSuggestions(rawText);
    return suggestions;
  } catch {
    // Silent failure: suggestions are a nice-to-have, never block the chat.
    return [];
  }
}
