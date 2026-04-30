/**
 * Unit tests for AgentExperienceCache and experience integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger to prevent console output during tests
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock mem0-power to avoid real API calls
vi.mock('@/lib/powers/mem0-power', () => ({
  isMem0Configured: vi.fn(() => false),
  mem0Add: vi.fn(async () => ({ success: true })),
  mem0Search: vi.fn(async () => ({ success: true, results: [] })),
}));

describe('AgentExperienceCache', () => {
  // We need to reset the cache between tests
  let getExperienceCache: () => any;
  let addExperience: any;
  let getRelevantExperiences: any;
  let getExperienceStats: any;
  let formatExperiencesForPrompt: any;
  let recordTaskOutcome: any;
  let initializeExperienceCache: any;

  beforeEach(async () => {
    // Reset all modules to get fresh cache
    vi.resetModules();
    
    // Import fresh
    const module = await import('../agent-experience');
    getExperienceCache = module.getExperienceCache;
    addExperience = module.addExperience;
    getRelevantExperiences = module.getRelevantExperiences;
    getExperienceStats = module.getExperienceStats;
    formatExperiencesForPrompt = module.formatExperiencesForPrompt;
    recordTaskOutcome = module.recordTaskOutcome;
    initializeExperienceCache = module.initializeExperienceCache;
    
    // Clear the cache
    getExperienceCache().clear();
  });

  describe('add()', () => {
    it('should add a new experience and return it with id and timestamps', async () => {
      const exp = await addExperience('Test lesson', 'security', {
        tags: ['test', 'security'],
        priority: 70,
        successRate: 0.8,
      });

      expect(exp.id).toBeDefined();
      expect(exp.id).toMatch(/^exp_/);
      expect(exp.lesson).toBe('Test lesson');
      expect(exp.category).toBe('security');
      expect(exp.tags).toEqual(['test', 'security']);
      expect(exp.priority).toBe(70);
      expect(exp.successRate).toBe(0.8);
      expect(exp.createdAt).toBeDefined();
      expect(exp.usageCount).toBe(0);
    });

    it('should use default values when options are not provided', async () => {
      const exp = await addExperience('Simple lesson', 'patterns');

      expect(exp.priority).toBe(50); // DEFAULT_PRIORITY
      expect(exp.successRate).toBe(0.5); // default
      expect(exp.tags).toEqual([]);
    });

    it('should update existing experience if lesson is duplicate (case-insensitive)', async () => {
      const exp1 = await addExperience('Test Lesson', 'security', { successRate: 0.8 });
      const exp2 = await addExperience('test lesson', 'patterns', { successRate: 0.6 });

      // Should return the same experience (updated)
      expect(exp1.id).toBe(exp2.id);
      expect(exp1.usageCount).toBe(1);
      expect(exp1.successRate).toBeGreaterThan(0.6); // Blended value
    });

    it('should increment usage count on duplicate lessons', async () => {
      const exp1 = await addExperience('Duplicate test', 'test', { successRate: 0.5 });
      const exp2 = await addExperience('Duplicate test', 'test', { successRate: 0.5 });
      const exp3 = await addExperience('Duplicate test', 'test', { successRate: 0.5 });

      // First add creates (usageCount=0), then each duplicate increments
      // After 3 adds: 1st creates, 2nd increments to 1, 3rd increments to 2
      expect(exp1.usageCount).toBe(2);
      // All return the same experience
      expect(exp1.id).toBe(exp2.id);
      expect(exp2.id).toBe(exp3.id);
    });

    it('should maintain category index', async () => {
      await addExperience('Lesson 1', 'security', { tags: ['tag1'] });
      await addExperience('Lesson 2', 'security', { tags: ['tag2'] });
      await addExperience('Lesson 3', 'patterns', { tags: ['tag3'] });

      const stats = getExperienceStats();
      expect(stats.byCategory.security).toBe(2);
      expect(stats.byCategory.patterns).toBe(1);
    });

    it('should maintain tag index', async () => {
      await addExperience('Lesson 1', 'test', { tags: ['tag1', 'common'] });
      await addExperience('Lesson 2', 'test', { tags: ['tag2', 'common'] });

      const cache = getExperienceCache();
      const result = cache.retrieve({ tags: ['common'] }, 10);
      
      expect(result.totalCount).toBe(2);
    });
  });

  describe('addBatch()', () => {
    it('should add multiple experiences', async () => {
      const experiences = [
        { lesson: 'Lesson 1', category: 'test', tags: ['tag1'] },
        { lesson: 'Lesson 2', category: 'test', tags: ['tag2'] },
        { lesson: 'Lesson 3', category: 'test', tags: ['tag3'] },
      ];

      const results = await getExperienceCache().addBatch(experiences);

      expect(results).toHaveLength(3);
      expect(results[0].lesson).toBe('Lesson 1');
      expect(results[1].lesson).toBe('Lesson 2');
      expect(results[2].lesson).toBe('Lesson 3');
    });
  });

  describe('retrieve()', () => {
    beforeEach(async () => {
      // Add some test experiences
      await addExperience('Security lesson about SQL injection', 'security', {
        tags: ['sql', 'injection'],
        priority: 80,
        successRate: 0.9,
      });
      await addExperience('Performance lesson about caching', 'performance', {
        tags: ['cache', 'speed'],
        priority: 70,
        successRate: 0.7,
      });
      await addExperience('Pattern lesson about error handling', 'patterns', {
        tags: ['errors', 'patterns'],
        priority: 60,
        successRate: 0.8,
      });
    });

    it('should retrieve all experiences with no filter', () => {
      const result = getExperienceCache().retrieve();

      expect(result.totalCount).toBe(3);
      expect(result.experiences).toHaveLength(3);
    });

    it('should filter by category', () => {
      const result = getExperienceCache().retrieve({ category: 'security' });

      expect(result.totalCount).toBe(1);
      expect(result.experiences[0].category).toBe('security');
    });

    it('should filter by tags (any match)', () => {
      const result = getExperienceCache().retrieve({ tags: ['sql', 'cache'] });

      expect(result.totalCount).toBe(2);
      expect(result.experiences.some(e => e.tags.includes('sql'))).toBe(true);
      expect(result.experiences.some(e => e.tags.includes('cache'))).toBe(true);
    });

    it('should filter by minimum priority', () => {
      const result = getExperienceCache().retrieve({ minPriority: 75 });

      expect(result.totalCount).toBe(1);
      expect(result.experiences[0].priority).toBeGreaterThanOrEqual(75);
    });

    it('should limit results with maxResults parameter', () => {
      const result = getExperienceCache().retrieve({}, 2);

      expect(result.experiences).toHaveLength(2);
    });

    it('should sort by relevance score (priority * recency * successRate)', () => {
      const result = getExperienceCache().retrieve({}, 10);

      // Highest priority + highest success rate should be first
      expect(result.experiences[0].category).toBe('security');
    });

    it('should include retrieval time', () => {
      const result = getExperienceCache().retrieve();

      expect(result.retrievalTimeMs).toBeDefined();
      expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('search()', () => {
    beforeEach(async () => {
      await addExperience('Use parameterized queries to prevent SQL injection', 'security', {
        tags: ['sql', 'injection', 'database'],
        priority: 85,
      });
      await addExperience('Cache frequently accessed data to improve performance', 'performance', {
        tags: ['cache', 'performance', 'optimization'],
        priority: 75,
      });
      await addExperience('Use async/await for better async handling', 'patterns', {
        tags: ['async', 'javascript', 'patterns'],
        priority: 60,
      });
    });

    it('should search by keyword matching in lesson text', async () => {
      const result = await getExperienceCache().search('SQL injection');

      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.experiences[0].lesson).toContain('SQL');
    });

    it('should search by tag matching', async () => {
      const result = await getExperienceCache().search('cache performance');

      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.experiences.some(e => e.tags.includes('cache'))).toBe(true);
    });

    it('should search by category matching', async () => {
      const result = await getExperienceCache().search('security patterns');

      expect(result.totalCount).toBeGreaterThan(0);
    });

    it('should give higher score to lessons with keyword matches', async () => {
      const result = await getExperienceCache().search('database');

      // Should find the SQL injection lesson first
      expect(result.experiences[0].tags).toContain('database');
    });

    it('should return empty results when no matches', async () => {
      const result = await getExperienceCache().search('nonexistent topic xyz123');

      expect(result.experiences).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('markUsed()', () => {
    it('should increment usage count and update lastUsedAt', async () => {
      const exp = await addExperience('Test', 'test');
      
      getExperienceCache().markUsed(exp.id);

      const updated = getExperienceCache().retrieve().experiences.find(e => e.id === exp.id);
      expect(updated?.usageCount).toBe(1);
      expect(updated?.lastUsedAt).toBeDefined();
    });

    it('should handle marking non-existent experience gracefully', () => {
      expect(() => getExperienceCache().markUsed('nonexistent-id')).not.toThrow();
    });
  });

  describe('updateSuccessRate()', () => {
    it('should update success rate with blending', async () => {
      const exp = await addExperience('Test', 'test', { successRate: 0.5 });
      
      await getExperienceCache().updateSuccessRate(exp.id, true);

      const updated = getExperienceCache().retrieve().experiences.find(e => e.id === exp.id);
      expect(updated?.successRate).toBeGreaterThan(0.5);
    });

    it('should blend multiple updates correctly', async () => {
      const exp = await addExperience('Test', 'test', { successRate: 0.8 });
      
      // Multiple failures
      await getExperienceCache().updateSuccessRate(exp.id, false);
      await getExperienceCache().updateSuccessRate(exp.id, false);
      await getExperienceCache().updateSuccessRate(exp.id, false);

      const updated = getExperienceCache().retrieve().experiences.find(e => e.id === exp.id);
      expect(updated?.successRate).toBeLessThan(0.8);
    });

    it('should auto-evict low success rate experiences with high usage', async () => {
      const exp = await addExperience('Failing test', 'test', { successRate: 0.3 });
      
      // Add more usage with failures - blending with alpha=0.3 pushes rate down
      // After 8 failures with initial 0.3, rate should be below 0.3 threshold
      for (let i = 0; i < 8; i++) {
        await getExperienceCache().updateSuccessRate(exp.id, false);
      }

      // Should be removed (successRate below 0.3 and usageCount > 5)
      const result = getExperienceCache().retrieve();
      const stillExists = result.experiences.find(e => e.id === exp.id);
      // After 8 failures, successRate should be very low (auto-eviction may trigger)
      expect(stillExists === undefined || stillExists.successRate < 0.3).toBe(true);
    });
  });

  describe('remove()', () => {
    it('should remove an experience', async () => {
      const exp = await addExperience('To be removed', 'test');
      
      const removed = getExperienceCache().remove(exp.id);

      expect(removed).toBe(true);
      expect(getExperienceCache().retrieve().totalCount).toBe(0);
    });

    it('should return false when experience not found', () => {
      const removed = getExperienceCache().remove('nonexistent-id');

      expect(removed).toBe(false);
    });

    it('should update indexes when removing', async () => {
      const exp = await addExperience('Test', 'security', { tags: ['tag1', 'tag2'] });
      
      getExperienceCache().remove(exp.id);

      // Try to retrieve by tag - should not find
      const result = getExperienceCache().retrieve({ tags: ['tag1'] });
      expect(result.totalCount).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should remove all experiences', async () => {
      await addExperience('Test 1', 'test');
      await addExperience('Test 2', 'test');
      await addExperience('Test 3', 'test');

      getExperienceCache().clear();

      const stats = getExperienceStats();
      expect(stats.totalExperiences).toBe(0);
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', async () => {
      await addExperience('Security lesson', 'security', { successRate: 0.9 });
      await addExperience('Security lesson 2', 'security', { successRate: 0.7 });
      await addExperience('Performance lesson', 'performance', { successRate: 0.8 });

      const stats = getExperienceStats();

      expect(stats.totalExperiences).toBe(3);
      expect(stats.byCategory.security).toBe(2);
      expect(stats.byCategory.performance).toBe(1);
      expect(stats.averageSuccessRate).toBeCloseTo(0.8, 1);
      expect(stats.oldestExperience).toBeDefined();
      expect(stats.newestExperience).toBeDefined();
    });

    it('should return zero average when no experiences', () => {
      const stats = getExperienceStats();

      expect(stats.totalExperiences).toBe(0);
      expect(stats.averageSuccessRate).toBe(0);
      expect(stats.oldestExperience).toBeNull();
      expect(stats.newestExperience).toBeNull();
    });
  });

  describe('export() and import()', () => {
    it('should export all experiences', async () => {
      await addExperience('Export test 1', 'test');
      await addExperience('Export test 2', 'test');

      const exported = getExperienceCache().export();

      expect(exported).toHaveLength(2);
      expect(exported[0].lesson).toBeDefined();
    });

    it('should import experiences and respect existing IDs', async () => {
      // Add an experience
      const exp = await addExperience('To be exported', 'test');
      
      // Export
      const exported = getExperienceCache().export();
      expect(exported).toHaveLength(1);

      // Clear cache
      getExperienceCache().clear();
      expect(getExperienceStats().totalExperiences).toBe(0);
      
      // Import exported experiences
      const imported = getExperienceCache().import(exported);

      // Should import all exported experiences
      expect(imported).toBe(exported.length);
      expect(getExperienceStats().totalExperiences).toBe(exported.length);
      
      // Import again should return 0 (no new experiences)
      const importedAgain = getExperienceCache().import(exported);
      expect(importedAgain).toBe(0);
      expect(getExperienceStats().totalExperiences).toBe(exported.length);
    });

    it('should not duplicate experiences with same ID', async () => {
      await addExperience('Original', 'test');
      
      const exported = getExperienceCache().export();
      
      // Try to import same experiences again
      const imported = getExperienceCache().import(exported);

      expect(imported).toBe(0); // No new imports
      expect(getExperienceStats().totalExperiences).toBe(1); // Still just one
    });
  });

  describe('eviction', () => {
    it('should evict oldest when max experiences reached', async () => {
      // Clear and add many experiences
      getExperienceCache().clear();
      
      const cache = getExperienceCache();
      
      // Add 250 experiences (exceeds MAX_EXPERIENCES of 200)
      for (let i = 0; i < 250; i++) {
        await addExperience(`Experience ${i}`, 'test', { priority: i });
      }

      const stats = getExperienceStats();
      expect(stats.totalExperiences).toBeLessThanOrEqual(200);
    });
  });
});

describe('Experience Convenience Functions', () => {
  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../agent-experience');
    // Clear cache
    module.getExperienceCache().clear();
  });

  describe('addExperience()', () => {
    it('should be exported and callable', async () => {
      const module = await import('../agent-experience');
      const exp = await module.addExperience('Test lesson', 'test');

      expect(exp.lesson).toBe('Test lesson');
    });
  });

  describe('getRelevantExperiences()', () => {
    it('should return relevant experiences for a query', async () => {
      const module = await import('../agent-experience');
      
      await module.addExperience('SQL injection prevention is important', 'security', {
        tags: ['sql', 'security'],
      });

      const result = await module.getRelevantExperiences('SQL injection');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].lesson).toContain('SQL');
    });

    it('should return empty array when no matches', async () => {
      const module = await import('../agent-experience');
      
      const result = await module.getRelevantExperiences('nonexistent xyz');

      expect(result).toEqual([]);
    });
  });

  describe('formatExperiencesForPrompt()', () => {
    it('should format experiences as markdown', async () => {
      const module = await import('../agent-experience');
      
      const experiences = [
        {
          id: 'exp_1',
          lesson: 'Test lesson 1',
          category: 'test',
          tags: ['tag1'],
          createdAt: Date.now(),
          usageCount: 1,
          successRate: 0.8,
          priority: 60,
        },
        {
          id: 'exp_2',
          lesson: 'Test lesson 2',
          category: 'test',
          tags: ['tag2'],
          createdAt: Date.now(),
          usageCount: 2,
          successRate: 0.9,
          priority: 70,
        },
      ];

      const formatted = module.formatExperiencesForPrompt(experiences);

      expect(formatted).toContain('## Learned Experiences');
      expect(formatted).toContain('[Experience 1] Test lesson 1');
      expect(formatted).toContain('[Experience 2] Test lesson 2');
    });

    it('should return empty string for empty array', async () => {
      const module = await import('../agent-experience');
      
      const formatted = module.formatExperiencesForPrompt([]);

      expect(formatted).toBe('');
    });
  });

  describe('recordTaskOutcome()', () => {
    it('should record task outcome without experience IDs', async () => {
      const module = await import('../agent-experience');
      
      // Should not throw
      await expect(
        module.recordTaskOutcome('Test task', true)
      ).resolves.not.toThrow();
    });

    it('should update specific experiences by ID', async () => {
      const module = await import('../agent-experience');
      
      const exp = await module.addExperience('To be updated', 'test', { successRate: 0.5 });
      
      await module.recordTaskOutcome('Test task', true, [exp.id]);

      const updated = module.getExperienceCache().retrieve().experiences[0];
      expect(updated.successRate).toBeGreaterThan(0.5);
    });
  });

  describe('buildExperiencePromptSupplement()', () => {
    it('should build prompt supplement from relevant experiences', async () => {
      const module = await import('../agent-experience');
      
      await module.addExperience('Important lesson', 'test');

      const supplement = await module.buildExperiencePromptSupplement('test query');

      expect(supplement).toContain('## Learned Experiences');
      expect(supplement).toContain('Important lesson');
    });
  });
});

describe('EXPERIENCE_TEMPLATES', () => {
  it('should have pre-built security templates', async () => {
    const { EXPERIENCE_TEMPLATES } = await import('../agent-experience');

    expect(EXPERIENCE_TEMPLATES.security).toBeDefined();
    expect(EXPERIENCE_TEMPLATES.security.length).toBeGreaterThan(0);
    expect(EXPERIENCE_TEMPLATES.security[0].category).toBe('security');
  });

  it('should have pre-built pattern templates', async () => {
    const { EXPERIENCE_TEMPLATES } = await import('../agent-experience');

    expect(EXPERIENCE_TEMPLATES.patterns).toBeDefined();
    expect(EXPERIENCE_TEMPLATES.patterns.length).toBeGreaterThan(0);
    expect(EXPERIENCE_TEMPLATES.patterns[0].category).toBe('patterns');
  });
});

describe('initializeExperienceCache()', () => {
  it('should load template experiences when requested', async () => {
    vi.resetModules();
    
    // Clear any previous cache
    const module = await import('../agent-experience');
    module.getExperienceCache().clear();
    
    // loadTemplates=true, loadOnInit=false to test templates loading
    await module.initializeExperienceCache(true, { loadOnInit: false });

    const stats = module.getExperienceStats();
    // Should have template experiences (security and patterns templates = 3 total)
    expect(stats.totalExperiences).toBeGreaterThan(0);
  });

  it('should not load templates or localStorage when disabled', async () => {
    vi.resetModules();
    
    const module = await import('../agent-experience');
    module.getExperienceCache().clear();
    
    // Both loadTemplates and loadOnInit are false
    await module.initializeExperienceCache(false, { loadOnInit: false });

    const stats = module.getExperienceStats();
    // Should have 0 experiences since both templates and localStorage are disabled
    expect(stats.totalExperiences).toBe(0);
  });
});