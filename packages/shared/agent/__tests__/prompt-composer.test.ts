/**
 * Unit Tests for prompt-composer.ts — exported constants (PR change)
 *
 * PR change: DEFAULT_DYNAMIC_HEADER and RULES_BLOCK were promoted from
 * module-private consts to `export const` as part of the Q3+Q5 audit-grade
 * single-source-of-truth lift. These tests verify:
 *  - Exported values match the canonical strings used in the prompt pipeline
 *  - RULES_BLOCK structure (header + 3 rules)
 *  - Both exports are stable string values (not functions or undefined)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the web-side dependencies so this test runs in the shared/agent context
// without requiring the full web stack to be available.
vi.mock('@/lib/tools/capabilities', () => ({
  ALL_CAPABILITIES: [],
}));
vi.mock('../system-prompts', () => ({
  SYSTEM_PROMPTS: {},
}));

import {
  DEFAULT_DYNAMIC_HEADER,
  RULES_BLOCK,
} from '../prompt-composer';

// ─── DEFAULT_DYNAMIC_HEADER ───────────────────────────────────────────────────

describe('DEFAULT_DYNAMIC_HEADER', () => {
  it('is a non-empty string', () => {
    expect(typeof DEFAULT_DYNAMIC_HEADER).toBe('string');
    expect(DEFAULT_DYNAMIC_HEADER.length).toBeGreaterThan(0);
  });

  it('equals "AVAILABLE CAPABILITIES" (canonical header value)', () => {
    expect(DEFAULT_DYNAMIC_HEADER).toBe('AVAILABLE CAPABILITIES');
  });

  it('is in uppercase (consistent with section header conventions)', () => {
    expect(DEFAULT_DYNAMIC_HEADER).toBe(DEFAULT_DYNAMIC_HEADER.toUpperCase());
  });

  it('does not contain leading or trailing whitespace', () => {
    expect(DEFAULT_DYNAMIC_HEADER).toBe(DEFAULT_DYNAMIC_HEADER.trim());
  });
});

// ─── RULES_BLOCK ─────────────────────────────────────────────────────────────

describe('RULES_BLOCK', () => {
  it('is a non-empty string', () => {
    expect(typeof RULES_BLOCK).toBe('string');
    expect(RULES_BLOCK.length).toBeGreaterThan(0);
  });

  it('starts with the "## Rules" header', () => {
    expect(RULES_BLOCK.startsWith('## Rules')).toBe(true);
  });

  it('contains the "most specific tool" rule', () => {
    expect(RULES_BLOCK).toContain('1. Use the MOST SPECIFIC tool for the job');
  });

  it('contains the "chain tools" rule', () => {
    expect(RULES_BLOCK).toContain('2. Chain tools logically: search → read → analyze → write');
  });

  it('contains the "never fabricate" rule', () => {
    expect(RULES_BLOCK).toContain('3. NEVER fabricate tool output — always call the actual tool');
  });

  it('contains exactly 3 numbered rules (lines starting with "1.", "2.", "3.")', () => {
    const numberedRules = RULES_BLOCK.split('\n').filter(line =>
      /^\d+\./.test(line.trim())
    );
    expect(numberedRules).toHaveLength(3);
  });

  it('uses newline separators (joined with \\n)', () => {
    expect(RULES_BLOCK).toContain('\n');
  });

  it('is a string (not a function or array — verifies export type promotion)', () => {
    expect(typeof RULES_BLOCK).toBe('string');
    expect(Array.isArray(RULES_BLOCK)).toBe(false);
  });

  it('contains the em-dash in the fabrication rule (not ASCII hyphen)', () => {
    // The rule uses '—' (U+2014 em-dash), not '-'. This regression test
    // ensures the string is not silently converted during export.
    expect(RULES_BLOCK).toContain('—');
  });
});
