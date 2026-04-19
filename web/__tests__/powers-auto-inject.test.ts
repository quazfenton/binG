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
