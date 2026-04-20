/**
 * Tests for the auto-inject powers mechanism.
 *
 * Validates that only powers with `autoInject: true` are proactively
 * injected as USER messages, and that all other powers remain
 * discoverable on-demand via power_list/power_read tools.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PowersRegistry,
  PowerManifest,
  powersRegistry,
  buildAutoInjectUserMessage,
  appendAutoInjectPowers,
  webSearchPowerManifest,
  codeSearchPowerManifest,
  docLookupPowerManifest,
} from '@/lib/powers';

// Create a test power with autoInject: true (e.g., URL scraper)
const urlScraperPower: PowerManifest = {
  id: 'url-scraper-test',
  name: 'URL Scraper',
  version: '1.0.0',
  description: 'Scrape content from URLs for context',
  triggers: ['http://', 'https://', 'www.'],
  actions: [
    { name: 'scrape', description: 'Scrape a URL and return its content', paramsSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  ],
  source: 'core',
  enabled: true,
  autoInject: true,
};

// Create a test power WITHOUT autoInject (discovered on-demand)
const sqlOptimizerPower: PowerManifest = {
  id: 'sql-optimizer-test',
  name: 'SQL Optimizer',
  version: '1.0.0',
  description: 'Optimize SQL queries for performance',
  triggers: ['sql', 'query', 'database'],
  actions: [
    { name: 'optimize', description: 'Optimize a SQL query', paramsSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ],
  source: 'local',
  enabled: true,
  // autoInject is NOT set — discovered on-demand only
};

describe('Auto-Inject Powers', () => {
  let localRegistry: PowersRegistry;

  beforeEach(() => {
    localRegistry = new PowersRegistry();
    // Clean up singleton registry between tests
    powersRegistry.clear();
  });

  afterEach(() => {
    // Clean up singleton registry after tests
    powersRegistry.clear();
  });

  describe('PowersRegistry.getAutoInjectPowers', () => {
    it('returns only powers with autoInject: true that match triggers', () => {
      localRegistry.register(urlScraperPower);
      localRegistry.register(sqlOptimizerPower);

      const result = localRegistry.getAutoInjectPowers('check out https://example.com for details');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('url-scraper-test');
    });

    it('returns empty array when no autoInject powers match triggers', () => {
      localRegistry.register(urlScraperPower);
      localRegistry.register(sqlOptimizerPower);

      const result = localRegistry.getAutoInjectPowers('optimize this SQL query');
      expect(result).toHaveLength(0); // sql-optimizer is NOT autoInject
    });

    it('returns empty array when no powers have autoInject: true', () => {
      localRegistry.register(sqlOptimizerPower);

      const result = localRegistry.getAutoInjectPowers('optimize this SQL query');
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no user message provided', () => {
      localRegistry.register(urlScraperPower);

      const result = localRegistry.getAutoInjectPowers('');
      expect(result).toHaveLength(0);
    });
  });

  describe('Real web-search auto-inject power', () => {
    it('webSearchPowerManifest triggers on URLs', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('check out https://example.com for details');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('web-search');
      expect(result[0].autoInject).toBe(true);
    });

    it('webSearchPowerManifest triggers on search keywords', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('search for the latest news on AI');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('web-search');
    });

    it('webSearchPowerManifest triggers on "look up" keyword', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('look up the docs for React hooks');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('web-search');
    });

    it('webSearchPowerManifest does NOT trigger on casual questions', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      // 'what is' and 'who is' are intentionally NOT triggers — too broad
      const result = powersRegistry.getAutoInjectPowers('what is a closure in JavaScript?');
      expect(result).toHaveLength(0);
    });

    it('buildAutoInjectUserMessage returns web-search content for URLs', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      const msg = buildAutoInjectUserMessage('look up https://example.com');
      expect(msg).not.toBe('');
      expect(msg).toContain('web-search');
      expect(msg).toContain('Web Search & URL Fetch');
      expect(msg).toContain('search');
      expect(msg).toContain('fetch');
      expect(msg).toContain('browse');
    });

    it('appendAutoInjectPowers works end-to-end with web-search power', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an AI assistant.' },
        { role: 'user', content: 'What does https://example.com say?' },
      ];

      appendAutoInjectPowers(messages, 'What does https://example.com say?');
      expect(messages.length).toBe(3);
      expect(messages[2].role).toBe('user');
      expect(messages[2].content).toContain('web-search');
      expect(messages[1].content).toBe('What does https://example.com say?'); // unchanged
    });

    it('webSearchPowerManifest does NOT trigger on irrelevant messages', async () => {
      await powersRegistry.register(webSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('help me refactor this TypeScript code');
      expect(result).toHaveLength(0);
    });
  });

  describe('Real code-search auto-inject power', () => {
    it('codeSearchPowerManifest triggers on "find in repo"', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('find in repo where authenticate is defined');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('code-search');
      expect(result[0].autoInject).toBe(true);
    });

    it('codeSearchPowerManifest triggers on "search codebase"', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('search codebase for usage of fetch');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('code-search');
    });

    it('codeSearchPowerManifest triggers on "where is"', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('where is the AuthProvider component defined?');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('code-search');
    });

    it('codeSearchPowerManifest triggers on "grep for"', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('grep for TODO comments in the codebase');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('code-search');
    });

    it('codeSearchPowerManifest does NOT trigger on casual questions', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('help me write a new component');
      expect(result).toHaveLength(0);
    });

    it('codeSearchPowerManifest has coversCapabilityIds for dedup', () => {
      expect(codeSearchPowerManifest.coversCapabilityIds).toBeDefined();
      expect(codeSearchPowerManifest.coversCapabilityIds).toContain('file.search');
      expect(codeSearchPowerManifest.coversCapabilityIds).toContain('repo.search');
      expect(codeSearchPowerManifest.coversCapabilityIds).toContain('repo.semantic-search');
    });

    it('buildAutoInjectUserMessage returns code-search content', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const msg = buildAutoInjectUserMessage('find in repo where authenticate is defined');
      expect(msg).not.toBe('');
      expect(msg).toContain('code-search');
      expect(msg).toContain('Code Search & Grep');
      expect(msg).toContain('search');
      expect(msg).toContain('glob');
      expect(msg).toContain('semantic');
    });

    it('appendAutoInjectPowers works end-to-end with code-search power', async () => {
      await powersRegistry.register(codeSearchPowerManifest);

      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an AI assistant.' },
        { role: 'user', content: 'where is the AuthProvider defined?' },
      ];

      appendAutoInjectPowers(messages, 'where is the AuthProvider defined?');
      expect(messages.length).toBe(3);
      expect(messages[2].role).toBe('user');
      expect(messages[2].content).toContain('code-search');
    });

    it('both web-search and code-search can trigger simultaneously', async () => {
      await powersRegistry.register(webSearchPowerManifest);
      await powersRegistry.register(codeSearchPowerManifest);

      // Message with a URL (web-search) AND a search keyword (code-search)
      const result = powersRegistry.getAutoInjectPowers('look for https://example.com/api in the codebase');
      expect(result.length).toBeGreaterThanOrEqual(1); // At least web-search triggers
      const ids = result.map(p => p.id);
      expect(ids).toContain('web-search');
    });
  });

  describe('Real doc-lookup auto-inject power', () => {
    it('docLookupPowerManifest triggers on "read the docs"', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('read the docs for React hooks');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-lookup');
      expect(result[0].autoInject).toBe(true);
    });

    it('docLookupPowerManifest triggers on "documentation for"', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('documentation for Express.js middleware');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-lookup');
    });

    it('docLookupPowerManifest triggers on "how to use"', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('how to use the useState hook');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-lookup');
    });

    it('docLookupPowerManifest triggers on "api reference"', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('check the api reference for fetch');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-lookup');
    });

    it('docLookupPowerManifest triggers on "official documentation"', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('official documentation for Node.js streams');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-lookup');
    });

    it('docLookupPowerManifest triggers on "man page"', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('man page for grep');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-lookup');
    });

    it('docLookupPowerManifest does NOT trigger on casual questions', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('help me refactor this TypeScript code');
      expect(result).toHaveLength(0);
    });

    it('docLookupPowerManifest has coversCapabilityIds for dedup', () => {
      expect(docLookupPowerManifest.coversCapabilityIds).toBeDefined();
      expect(docLookupPowerManifest.coversCapabilityIds).toContain('doc.lookup');
      expect(docLookupPowerManifest.coversCapabilityIds).toContain('doc.search');
      expect(docLookupPowerManifest.coversCapabilityIds).toContain('doc.api_ref');
    });

    it('docLookupPowerManifest has three actions', () => {
      expect(docLookupPowerManifest.actions).toHaveLength(3);
      const actionNames = docLookupPowerManifest.actions.map(a => a.name);
      expect(actionNames).toContain('search');
      expect(actionNames).toContain('lookup');
      expect(actionNames).toContain('api_ref');
    });

    it('buildAutoInjectUserMessage returns doc-lookup content', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const msg = buildAutoInjectUserMessage('read the docs for React hooks');
      expect(msg).not.toBe('');
      expect(msg).toContain('doc-lookup');
      expect(msg).toContain('Documentation Lookup');
      expect(msg).toContain('search');
      expect(msg).toContain('lookup');
      expect(msg).toContain('api_ref');
    });

    it('appendAutoInjectPowers works end-to-end with doc-lookup power', async () => {
      await powersRegistry.register(docLookupPowerManifest);

      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an AI assistant.' },
        { role: 'user', content: 'how to use the useState hook?' },
      ];

      appendAutoInjectPowers(messages, 'how to use the useState hook?');
      expect(messages.length).toBe(3);
      expect(messages[2].role).toBe('user');
      expect(messages[2].content).toContain('doc-lookup');
    });

    it('doc-lookup and web-search can both trigger for docs + URL', async () => {
      await powersRegistry.register(docLookupPowerManifest);
      await powersRegistry.register(webSearchPowerManifest);

      const result = powersRegistry.getAutoInjectPowers('read the docs at https://react.dev/reference/react');
      expect(result.length).toBeGreaterThanOrEqual(2);
      const ids = result.map(p => p.id);
      expect(ids).toContain('doc-lookup');
      expect(ids).toContain('web-search');
    });
  });

  describe('buildAutoInjectUserMessage (singleton)', () => {
    it('returns non-empty string when autoInject power triggers match on singleton', async () => {
      await powersRegistry.register(urlScraperPower);

      const msg = buildAutoInjectUserMessage('check out https://example.com');
      expect(msg).not.toBe('');
      expect(msg).toContain('url-scraper-test');
      expect(msg).toContain('URL Scraper');
      expect(msg).toContain('scrape');
    });

    it('returns empty string when no autoInject powers match', () => {
      const msg = buildAutoInjectUserMessage('random text with no triggers');
      expect(msg).toBe('');
    });

    it('returns empty string when only non-autoInject powers match triggers', async () => {
      await powersRegistry.register(sqlOptimizerPower);

      const msg = buildAutoInjectUserMessage('optimize this SQL query');
      expect(msg).toBe(''); // sql-optimizer matches triggers but is NOT autoInject
    });
  });

  describe('appendAutoInjectPowers', () => {
    it('appends auto-inject as separate USER message (not system prompt)', async () => {
      await powersRegistry.register(urlScraperPower);

      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an AI assistant.' },
        { role: 'user', content: 'Check https://example.com' },
      ];

      appendAutoInjectPowers(messages, 'Check https://example.com');
      expect(messages.length).toBe(3);
      expect(messages[2].role).toBe('user');
      expect(messages[2].content).toContain('[Auto-loaded power(s)');
    });

    it('deduplicates — does not inject twice', async () => {
      await powersRegistry.register(urlScraperPower);

      const messages: Array<{ role: string; content: string }> = [
        { role: 'user', content: 'Check https://example.com' },
        { role: 'user', content: '[Auto-loaded power(s) — these are always available when their triggers match]\n\nSome power details' },
      ];

      appendAutoInjectPowers(messages, 'Check https://example.com');
      expect(messages.length).toBe(2); // No new message added
    });

    it('does not inject when no autoInject powers match', async () => {
      await powersRegistry.register(sqlOptimizerPower); // NOT autoInject

      const messages: Array<{ role: string; content: string }> = [
        { role: 'user', content: 'Optimize this SQL query' },
      ];

      appendAutoInjectPowers(messages, 'Optimize this SQL query');
      expect(messages.length).toBe(1); // No auto-inject message
    });

    it('does not mutate existing user messages', async () => {
      await powersRegistry.register(urlScraperPower);

      const messages: Array<{ role: string; content: string }> = [
        { role: 'user', content: 'Original user message' },
      ];
      const originalContent = messages[0].content;

      appendAutoInjectPowers(messages, 'Check https://example.com');
      expect(messages[0].content).toBe(originalContent); // Original unchanged
    });
  });
});
