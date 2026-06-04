/**
 * LLM Compatibility Helpers — Unit Tests
 *
 * Tests for all exports from web/lib/llm-compat.ts:
 * - isKnownGoodFC()     — known-good FC model detection
 * - shouldStripTools()  — tool-stripping decisions per provider/model
 * - getTextModeInstructions() — plain-text fallback instruction builder
 * - knownGoodFCModels   — the model list itself
 */

import { describe, it, expect } from 'vitest';
import {
  knownGoodFCModels,
  isKnownGoodFC,
  shouldStripTools,
  getTextModeInstructions,
} from '../llm-compat';

// ─── knownGoodFCModels ────────────────────────────────────────────────

describe('knownGoodFCModels', () => {
  it('should contain at least one entry', () => {
    expect(knownGoodFCModels.length).toBeGreaterThan(0);
  });

  it('should contain mistral-large-latest', () => {
    expect(knownGoodFCModels).toContain('mistral-large-latest');
  });

  it('should contain gpt-4 variants', () => {
    const gptEntries = knownGoodFCModels.filter((m) =>
      m.toLowerCase().startsWith('gpt-'),
    );
    expect(gptEntries.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── isKnownGoodFC ────────────────────────────────────────────────────

describe('isKnownGoodFC()', () => {
  it('should return true for exact matches', () => {
    expect(isKnownGoodFC('mistral-large-latest')).toBe(true);
    expect(isKnownGoodFC('gpt-4')).toBe(true);
    expect(isKnownGoodFC('claude-3')).toBe(true);
  });

  it('should return true for substring matches', () => {
    expect(isKnownGoodFC('gpt-4-turbo')).toBe(true);
    expect(isKnownGoodFC('gpt-4-32k')).toBe(true);
    expect(isKnownGoodFC('claude-3-opus-20240229')).toBe(true);
    expect(isKnownGoodFC('claude-sonnet-4-20250514')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isKnownGoodFC('GPT-4')).toBe(true);
    expect(isKnownGoodFC('Mistral-Large-Latest')).toBe(true);
    expect(isKnownGoodFC('Claude-3-Haiku')).toBe(true);
    expect(isKnownGoodFC('GEMINI-1.5-PRO')).toBe(true);
  });

  it('should return false for non-matching models', () => {
    expect(isKnownGoodFC('llama-3.1-8b-instruct')).toBe(false);
    expect(isKnownGoodFC('mistral-small-latest')).toBe(false);
    expect(isKnownGoodFC('google/gemma-3-27b-it')).toBe(false);
    expect(isKnownGoodFC('')).toBe(false);
  });

  it('should return false for unknown models', () => {
    expect(isKnownGoodFC('completely-fake-model-v99')).toBe(false);
  });
});

// ─── shouldStripTools ─────────────────────────────────────────────────

describe('shouldStripTools()', () => {
  // ── NVIDIA ───────────────────────────────────────────────────────
  describe('NVIDIA provider', () => {
    it('should strip tools for gemma-3 models', () => {
      expect(shouldStripTools('nvidia', 'google/gemma-3-27b-it')).toBe(true);
      expect(shouldStripTools('nvidia', 'google/gemma-3-12b-it')).toBe(true);
      expect(shouldStripTools('nvidia', 'google/gemma-3-4b-it')).toBe(true);
    });

    it('should strip tools for llama-3.1 models', () => {
      expect(shouldStripTools('nvidia', 'meta/llama-3.1-8b-instruct')).toBe(true);
      expect(shouldStripTools('nvidia', 'meta/llama-3.1-70b-instruct')).toBe(true);
    });

    it('should strip tools for llama-3.3 models', () => {
      expect(shouldStripTools('nvidia', 'meta/llama-3.3-70b-instruct')).toBe(true);
    });

    it('should NOT strip tools for non-FC-list NVIDIA models', () => {
      expect(shouldStripTools('nvidia', 'mistral-large-latest')).toBe(false);
      expect(shouldStripTools('nvidia', 'meta/llama-3.2-11b-vision-instruct')).toBe(false);
    });

    it('should treat NVIDIA with mixed-case provider name', () => {
      expect(shouldStripTools('NVIDIA', 'google/gemma-3-27b-it')).toBe(true);
      expect(shouldStripTools('NvIdIa', 'meta/llama-3.1-8b-instruct')).toBe(true);
    });
  });

  // ── Mistral Small ────────────────────────────────────────────────
  describe('Mistral Small (via mistral provider)', () => {
    it('should strip tools for mistral-small-latest', () => {
      expect(shouldStripTools('mistral', 'mistral-small-latest')).toBe(true);
    });

    it('should strip tools for mistral-small-2402', () => {
      expect(shouldStripTools('mistral', 'mistral-small-2402')).toBe(true);
    });

    it('should NOT strip tools for mistral-large-latest (known-good)', () => {
      expect(shouldStripTools('mistral', 'mistral-large-latest')).toBe(false);
    });

    it('should NOT strip tools for mistral-medium-latest (known-good)', () => {
      expect(shouldStripTools('mistral', 'mistral-medium-latest')).toBe(false);
    });
  });

  // ── GitHub Copilot (ninerouter) ──────────────────────────────────
  describe('GitHub Copilot (ninerouter provider)', () => {
    it('should strip tools for gh/ prefixed models', () => {
      expect(shouldStripTools('ninerouter', 'gh/claude-sonnet-4-20250514')).toBe(true);
      expect(shouldStripTools('ninerouter', 'gh/gpt-4o')).toBe(true);
    });

    it('should NOT strip tools for non-gh models through ninerouter', () => {
      expect(shouldStripTools('ninerouter', 'openai/gpt-4')).toBe(false);
    });

    it('should be case-insensitive on provider name', () => {
      expect(shouldStripTools('NineRouter', 'gh/claude-opus')).toBe(true);
    });
  });

  // ── Other providers ──────────────────────────────────────────────
  describe('Other providers', () => {
    it('should NOT strip tools for OpenAI', () => {
      expect(shouldStripTools('openai', 'gpt-4')).toBe(false);
      expect(shouldStripTools('openai', 'gpt-4-turbo')).toBe(false);
    });

    it('should NOT strip tools for Anthropic', () => {
      expect(shouldStripTools('anthropic', 'claude-3-opus-20240229')).toBe(false);
    });

    it('should NOT strip tools for Google', () => {
      expect(shouldStripTools('google', 'gemini-1.5-pro')).toBe(false);
    });

    it('should NOT strip tools for unknown providers', () => {
      expect(shouldStripTools('some-random-provider', 'some-model')).toBe(false);
    });

    it('should handle empty strings gracefully', () => {
      expect(shouldStripTools('', '')).toBe(false);
    });
  });
});

// ─── getTextModeInstructions ──────────────────────────────────────────

describe('getTextModeInstructions()', () => {
  it('should return a non-empty string', () => {
    const instructions = getTextModeInstructions();
    expect(instructions.length).toBeGreaterThan(0);
  });

  it('should mention "plain text"', () => {
    const instructions = getTextModeInstructions();
    expect(instructions.toLowerCase()).toContain('plain text');
  });

  it('should discourage function/tool calls', () => {
    const instructions = getTextModeInstructions();
    expect(instructions.toLowerCase()).toContain('function call');
    expect(instructions.toLowerCase()).toContain('tool call');
  });

  it('should return consistent results across calls', () => {
    const a = getTextModeInstructions();
    const b = getTextModeInstructions();
    expect(a).toBe(b);
  });
});
