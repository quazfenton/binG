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
 */
function parseSuggestions(raw: string): NextStepSuggestionsResult {
  if (!raw || typeof raw !== 'string') {
    return { suggestions: [] };
  }

  // Try to extract a JSON object from the response (defensive: model may
  // accidentally wrap it in markdown code fences).
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { suggestions: [] };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { suggestions: [] };
  }

  const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const cleaned: NextStepSuggestion[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const fullText = typeof item.fullText === 'string' ? item.fullText.trim() : '';
    if (!label || !fullText) continue;

    // Enforce hard limits to keep the UI compact.
    const cappedLabel = label.length > 48 ? label.slice(0, 47) + '…' : label;
    // fullText: cap to ~280 chars (≈ 2 short sentences)
    const cappedFull =
      fullText.length > 280 ? fullText.slice(0, 279) + '…' : fullText;

    cleaned.push({ label: cappedLabel, fullText: cappedFull });
    if (cleaned.length === 3) break;
  }

  return { suggestions: cleaned };
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
      maxTokens: 400,
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
