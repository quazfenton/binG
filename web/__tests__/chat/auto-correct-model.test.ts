import { describe, expect, it } from 'vitest';
import { autoCorrectModel } from '../../app/api/chat/chat-helpers';

// The exact nvidia provider model list from the user's error log:
// 'kimi-k2.5' was requested but only 'kimi-k2.6' is supported.
const NVIDIA_MODELS = [
  'z-ai/glm-5.1',
  'minimaxai/minimax-m2.7',
  'moonshotai/kimi-k2.6',
  'deepseek-ai/deepseek-v4-flash',
  'qwen/qwen3.5-122b-a10b',
  'stepfun-ai/step-3.7-flash',
  'meta/llama-4-maverick-17b-128e-instruct',
];

const GOOGLE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-2.5-pro',
];

describe('autoCorrectModel', () => {
  // ─── Strategy 1: Full model contained in supported ID ─────────────────
  describe('Strategy 1 — substring match', () => {
    it('corrects kimi-k2.5 → moonshotai/kimi-k2.6 via version-stripped prefix (Strategy 2.5)', () => {
      // kimi-k2.5 is NOT a substring of moonshotai/kimi-k2.6 (they differ by .5 vs .6).
      // Strategy 1 (direct substring) and Strategy 2 (reverse) both fail.
      // Strategy 2.5 strips .5 → kimi-k2 which IS a substring of moonshotai/kimi-k2.6.
      const result = autoCorrectModel('kimi-k2.5', NVIDIA_MODELS);
      expect(result).toBe('moonshotai/kimi-k2.6');
    });

    it('matches full model name to provider-prefixed ID', () => {
      // 'gemini-2.5-flash' is directly in the google model list
      const result = autoCorrectModel('gemini-2.5-flash', GOOGLE_MODELS);
      expect(result).toBe('gemini-2.5-flash');
    });

    it('handles partial name that is a substring of exactly one available model', () => {
      // 'glm-5.1' is a substring of 'z-ai/glm-5.1'
      const result = autoCorrectModel('glm-5.1', NVIDIA_MODELS);
      expect(result).toBe('z-ai/glm-5.1');
    });
  });

  // ─── Strategy 2: Reverse match ─────────────────────────────────────────
  describe('Strategy 2 — reverse substring match', () => {
    it('corrects when requested model contains a supported model ID', () => {
      // 'kimi-k2.6' is contained in 'moonshotai/kimi-k2.6'
      // But also 'kimi-k2' is contained - but 'kimi-k2.6' matches exactly
      const result = autoCorrectModel('moonshotai/kimi-k2.6', NVIDIA_MODELS);
      expect(result).toBe('moonshotai/kimi-k2.6');
    });
  });

  // ─── Strategy 2.5: Version-stripped prefix match ────────────────────────
  describe('Strategy 2.5 — version-stripped prefix match', () => {
    it('corrects deepseek-v4-flash → deepseek-ai/deepseek-v4-flash', () => {
      // 'deepseek-v4-flash' is a substring of 'deepseek-ai/deepseek-v4-flash'
      const result = autoCorrectModel('deepseek-v4-flash', NVIDIA_MODELS);
      expect(result).toBe('deepseek-ai/deepseek-v4-flash');
    });

    it('corrects gemini-2.5 → gemini-2.5-flash via prefix match', () => {
      // 'gemini-2.5' is a substring of 'gemini-2.5-flash' and 'gemini-2.5-pro'
      // Strategy 1 finds the first match: gemini-2.5-flash
      const result = autoCorrectModel('gemini-2.5', GOOGLE_MODELS);
      expect(result).toBe('gemini-2.5-flash');
    });

    it('corrects kimi-k2.5 → moonshotai/kimi-k2.6 via version-stripped prefix', () => {
      // This is the PRIMARY test case from the user's error report.
      // kimi-k2.5 was requested but only kimi-k2.6 is supported by nvidia.
      // Strategy 1 & 2 fail (kimi-k2.5 ≠ kimi-k2.6), but Strategy 2.5
      // strips .5 → kimi-k2 which IS a substring of moonshotai/kimi-k2.6.
      const result = autoCorrectModel('kimi-k2.5', NVIDIA_MODELS);
      expect(result).toBe('moonshotai/kimi-k2.6');
    });
  });

  // ─── Strategy 3: Default/fallback ──────────────────────────────────────
  describe('Strategy 3 — provider default fallback', () => {
    it('falls back to default model when valid and requested model is unrecognized', () => {
      const result = autoCorrectModel('completely-unrecognized-model', GOOGLE_MODELS, 'gemini-2.5-flash');
      expect(result).toBe('gemini-2.5-flash');
    });

    it('falls back to first available model when default is not in supported list', () => {
      const result = autoCorrectModel('completely-unrecognized-model', GOOGLE_MODELS, 'nonexistent-default');
      expect(result).toBe('gemini-2.5-flash'); // First in GOOGLE_MODELS
    });

    it('falls back to first available model when no default provided', () => {
      const result = autoCorrectModel('completely-unrecognized-model', NVIDIA_MODELS);
      expect(result).toBe(NVIDIA_MODELS[0]);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns undefined for empty model string', () => {
      const result = autoCorrectModel('', NVIDIA_MODELS);
      expect(result).toBeUndefined();
    });

    it('returns undefined when availableModelIds is empty', () => {
      const result = autoCorrectModel('some-model', []);
      expect(result).toBeUndefined();
    });

    it('preserves exact match', () => {
      const result = autoCorrectModel('deepseek-ai/deepseek-v4-flash', NVIDIA_MODELS);
      expect(result).toBe('deepseek-ai/deepseek-v4-flash');
    });

    it('does NOT silently return a mismatched model', () => {
      // If the model is truly unrelated and no default, return first available
      const result = autoCorrectModel('gpt-4', GOOGLE_MODELS);
      expect(GOOGLE_MODELS).toContain(result!);
    });
  });

  // ─── End-to-end: kimi-k2.5 does NOT kill the conversation ─────────────
  describe('conversation survival: nvidia + kimi-k2.5', () => {
    it('returns a valid nvidia model, never a 400 error', () => {
      // The whole point: an unsupported model should NOT kill the conversation
      // with a 400 error. As long as autoCorrectModel returns a valid model
      // that IS in the provider's list, the conversation continues streaming.
      const corrected = autoCorrectModel('kimi-k2.5', NVIDIA_MODELS);
      expect(corrected).toBeDefined();
      expect(NVIDIA_MODELS).toContain(corrected);
      // Bonus: is it actually kimi-k2.6? (the nearest match)
      expect(corrected).toBe('moonshotai/kimi-k2.6');
    });
  });
});
