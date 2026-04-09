/**
 * Prompt Composer — Unit Tests
 *
 * Tests section parsing, dynamic tool generation, and composition.
 */

import {
  parseSections,
  getRoleSections,
  composeRole,
  composeRoleWithTools,
  generateDynamicToolBlock,
  generateToolHints,
  registerSection,
  getSectionTemplate,
  invalidateSectionCache,
} from './prompt-composer';

// Sample monolithic prompt matching the actual format
const SAMPLE_PROMPT = `# IDENTITY
You are an elite software engineer.

============================================
# PRIME DIRECTIVES
============================================

1. Correctness over speed
2. Simplicity over cleverness

============================================
# TOOL STRATEGY
============================================

Use the right tool:
- **file.read** — Read files
- **web.search** — Search the web

============================================
# OUTPUT FORMAT
============================================

Respond with structured markdown.

============================================
# ANTI-PATTERNS
============================================

- Don't hallucinate tool output
- Don't skip validation

============================================
# EXAMPLES
============================================

Example: Use file.read before file.write
`;

describe('Prompt Composer', () => {
  describe('parseSections', () => {
    it('parses a monolithic prompt into structured sections', () => {
      const sections = parseSections(SAMPLE_PROMPT);
      expect(sections).not.toBeNull();
      expect(sections!.identity).toBeDefined();
      expect(sections!.directives).toBeDefined();
      expect(sections!.toolStrategy).toBeDefined();
      expect(sections!.outputFormat).toBeDefined();
      expect(sections!.antiPatterns).toBeDefined();
      expect(sections!.examples).toBeDefined();
    });

    it('extracts tool references from toolStrategy section', () => {
      const sections = parseSections(SAMPLE_PROMPT);
      expect(sections!.toolStrategy.requiredTools).toContain('file.read');
      expect(sections!.toolStrategy.requiredTools).toContain('web.search');
    });

    it('returns null for prompts without identity/directives', () => {
      const result = parseSections('Just some text without sections');
      expect(result).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(parseSections('')).toBeNull();
    });

    it('handles prompts with missing optional sections', () => {
      const minimal = `# IDENTITY
You are a bot.

============================================
# DIRECTIVES
============================================

Be helpful.`;
      const sections = parseSections(minimal);
      expect(sections).not.toBeNull();
      expect(sections!.identity).toBeDefined();
      expect(sections!.directives).toBeDefined();
      expect(sections!.outputFormat).toBeUndefined();
    });
  });

  describe('generateDynamicToolBlock', () => {
    it('generates a tool block with all capabilities by default', () => {
      const block = generateDynamicToolBlock();
      expect(block).toContain('AVAILABLE CAPABILITIES');
      expect(block).toContain('## Rules');
    });

    it('filters by allowedTools', () => {
      const block = generateDynamicToolBlock({
        allowedTools: ['file.read'],
      });
      expect(block).toContain('file.read');
      // Should not contain tools not in allowed list
      expect(block).not.toContain('sandbox.execute');
      expect(block).not.toContain('web.browse');
    });

    it('excludes tools via excludedTools', () => {
      const block = generateDynamicToolBlock({
        excludedTools: ['automation.discord'],
      });
      expect(block).not.toContain('automation.discord');
    });

    it('includes metadata when showMetadata is true', () => {
      const block = generateDynamicToolBlock({
        allowedTools: ['file.read'],
        showMetadata: true,
      });
      // file.read has metadata with latency/cost info
      expect(block).toMatch(/latency:|cost:/);
    });

    it('returns empty string when no tools match', () => {
      const block = generateDynamicToolBlock({
        allowedTools: ['nonexistent.tool'],
      });
      expect(block).toBe('');
    });

    it('uses custom header', () => {
      const block = generateDynamicToolBlock({
        header: 'MY TOOLS',
      });
      expect(block).toContain('# MY TOOLS');
    });
  });

  describe('generateToolHints', () => {
    it('generates a minimal hint list', () => {
      const hints = generateToolHints(['file.read', 'file.write']);
      expect(hints).toContain('file.read');
      expect(hints).toContain('file.write');
      expect(hints).toContain('Available tools:');
    });

    it('returns empty string for no tools', () => {
      expect(generateToolHints([])).toBe('');
    });
  });

  describe('Section Registry', () => {
    it('registers and retrieves a section', () => {
      const section = { id: 'test.v1', template: 'Test content' };
      registerSection(section);
      expect(getSectionTemplate('test.v1')).toEqual(section);
    });

    it('returns undefined for unknown sections', () => {
      expect(getSectionTemplate('nonexistent')).toBeUndefined();
    });
  });

  describe('composeRole', () => {
    it('composes a role from sections', () => {
      const result = composeRole('coder');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
    });

    it('overrides a section with a custom string', () => {
      const result = composeRole('coder', {
        directives: 'Custom directives only',
      });
      expect(result).toContain('Custom directives only');
    });

    it('skips tool strategy when empty string is passed', () => {
      const result = composeRole('coder', {
        toolStrategy: '',
      });
      // Should not contain the default tool strategy
      expect(result.length).toBeLessThan(
        composeRole('coder').length
      );
    });
  });
});
