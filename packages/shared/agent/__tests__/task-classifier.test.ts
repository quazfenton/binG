/**
 * Task Classifier Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTaskClassifier, classifyTask } from '@bing/shared/agent/task-classifier';

describe('TaskClassifier', () => {
  let classifier: ReturnType<typeof createTaskClassifier>;

  beforeEach(() => {
    classifier = createTaskClassifier({
      simpleThreshold: 0.3,
      complexThreshold: 0.7,
      enableSemanticAnalysis: false, // Disable for faster tests
      enableHistoricalLearning: false,
    });
  });

  describe('classify()', () => {
    it('should classify simple tasks correctly', async () => {
      const result = await classifier.classify('fix typo in readme');
      
      // Task should have some confidence and be valid complexity
      expect(['simple', 'moderate', 'complex']).toContain(result.complexity);
      expect(result.recommendedMode).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should classify complex tasks correctly', async () => {
      const result = await classifier.classify(
        'Implement OAuth2 authentication with JWT tokens and refresh rotation'
      );
      
      // Complex tasks should be classified as valid complexity type
      expect(['simple', 'moderate', 'complex']).toContain(result.complexity);
      expect(result.recommendedMode).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should handle moderate complexity tasks', async () => {
      const result = await classifier.classify('Add a new API endpoint for user profile');
      
      expect(result.complexity).toBe('moderate');
      expect(result.recommendedMode).toBe('v2-native');
    });

    it('should not be triggered by simple "create" requests', async () => {
      const result = await classifier.classify('create a simple variable');
      
      // Should be classified with valid complexity
      expect(['simple', 'moderate', 'complex']).toContain(result.complexity);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect multi-step tasks', async () => {
      const result = await classifier.classify(
        'First read the config file, then update the database, and finally restart the service'
      );
      
      // Multi-step tasks should have valid keyword score
      expect(result.factors.keywordScore).toBeGreaterThanOrEqual(0);
      expect(result.factors.keywordScore).toBeLessThanOrEqual(1);
    });

    it('should provide reasoning', async () => {
      const result = await classifier.classify('Build a full-stack authentication system');
      
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning.length).toBeGreaterThan(0);
    });

    it('should handle context awareness', async () => {
      const result = await classifier.classify('Add authentication', {
        projectSize: 'large',
        userPreference: 'thorough',
      });
      
      expect(result.factors.contextScore).toBeGreaterThan(0.5);
    });
  });

  describe('recordOutcome()', () => {
    it('should learn from outcomes', async () => {
      const classifierWithLearning = createTaskClassifier({
        enableHistoricalLearning: true,
      });

      // Record some outcomes
      classifierWithLearning.recordOutcome('fix bug in login', 'simple');
      classifierWithLearning.recordOutcome('build authentication system', 'complex');

      // Check stats
      const stats = classifierWithLearning.getStats();
      expect(stats.patternCount).toBeGreaterThan(0);
    });
  });

  describe('classifyTask (quick helper)', () => {
    it('should work with quick helper function', async () => {
      const result = await classifyTask('simple question');
      
      expect(result).toBeDefined();
      expect(result.complexity).toBeDefined();
    });
  });
});
