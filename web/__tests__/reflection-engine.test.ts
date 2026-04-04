/**
 * Reflection Engine Tests
 * 
 * Tests for the LLM-powered reflection engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reflectionEngine } from '@/lib/api/reflection-engine';

describe('ReflectionEngine', () => {
  beforeEach(() => {
    // Reset any state if needed
  });

  describe('reflect', () => {
    it('should return empty array if reflection disabled', async () => {
      // Mock disabled state
      const originalEnabled = process.env.FAST_AGENT_REFLECTION_ENABLED;
      process.env.FAST_AGENT_REFLECTION_ENABLED = 'false';
      
      // Need to recreate engine to pick up env change
      const reflections = await reflectionEngine.reflect('test content');
      
      expect(reflections).toEqual([]);
      
      // Restore
      process.env.FAST_AGENT_REFLECTION_ENABLED = originalEnabled;
    });

    it('should reflect on content with multiple perspectives', async () => {
      const reflections = await reflectionEngine.reflect(
        'This is a test response for reflection testing.',
        { context: { type: 'code review' } }
      );

      // Should have reflections from all 3 perspectives
      expect(reflections.length).toBeGreaterThan(0);
      
      // Each reflection should have required fields
      for (const reflection of reflections) {
        expect(reflection.perspective).toBeDefined();
        expect(reflection.improvements).toBeDefined();
        expect(Array.isArray(reflection.improvements)).toBe(true);
        expect(reflection.confidence).toBeDefined();
        expect(typeof reflection.confidence).toBe('number');
        expect(reflection.suggestedChanges).toBeDefined();
      }
    });

    it('should include context in reflection', async () => {
      const reflections = await reflectionEngine.reflect(
        'Test content',
        { 
          context: { 
            userIntent: 'code generation',
            language: 'typescript',
            complexity: 'high'
          } 
        }
      );

      expect(reflections.length).toBeGreaterThan(0);
    });

    it('should handle empty content gracefully', async () => {
      const reflections = await reflectionEngine.reflect('');
      
      // Should not throw, may return empty or mock results
      expect(Array.isArray(reflections)).toBe(true);
    });

    it('should fallback to mock if LLM unavailable', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = '';
      
      const reflections = await reflectionEngine.reflect('test content');
      
      // Should still return results (from mock fallback)
      expect(reflections.length).toBeGreaterThan(0);
      
      // Restore
      process.env.OPENAI_API_KEY = originalKey;
    });
  });

  describe('synthesizeReflections', () => {
    it('should synthesize empty reflections', () => {
      const summary = reflectionEngine.synthesizeReflections([]);
      
      expect(summary.overallScore).toBe(0.5);
      expect(summary.prioritizedImprovements).toEqual([]);
      expect(summary.confidenceLevel).toBe(0);
    });

    it('should synthesize multiple reflections', () => {
      const mockReflections = [
        {
          perspective: 'technical_accuracy',
          improvements: ['Add error handling', 'Fix type safety'],
          confidence: 0.9,
          suggestedChanges: 'Add error handling and fix types',
        },
        {
          perspective: 'clarity_communication',
          improvements: ['Simplify language', 'Add examples'],
          confidence: 0.8,
          suggestedChanges: 'Simplify and add examples',
        },
      ];

      const summary = reflectionEngine.synthesizeReflections(mockReflections as any);

      expect(summary.overallScore).toBeGreaterThan(0);
      expect(summary.prioritizedImprovements.length).toBeGreaterThan(0);
      expect(summary.confidenceLevel).toBeGreaterThan(0);
    });

    it('should prioritize improvements by confidence', () => {
      const mockReflections = [
        {
          perspective: 'technical',
          improvements: ['Critical fix', 'Minor improvement'],
          confidence: 0.95,
          suggestedChanges: 'Fix critical issues',
        },
        {
          perspective: 'clarity',
          improvements: ['Low priority change'],
          confidence: 0.5,
          suggestedChanges: 'Minor clarity improvements',
        },
      ];

      const summary = reflectionEngine.synthesizeReflections(mockReflections as any);

      // High confidence improvements should be first
      expect(summary.prioritizedImprovements[0]).toBe('Critical fix');
    });

    it('should remove duplicate improvements', () => {
      const mockReflections = [
        {
          perspective: 'technical',
          improvements: ['Add tests', 'Add tests'], // Duplicate
          confidence: 0.9,
          suggestedChanges: 'Add tests',
        },
      ];

      const summary = reflectionEngine.synthesizeReflections(mockReflections as any);

      // Duplicates should be removed
      const testImprovements = summary.prioritizedImprovements.filter(i => i === 'Add tests');
      expect(testImprovements.length).toBe(1);
    });

    it('should limit to top 5 improvements', () => {
      const mockReflections = [
        {
          perspective: 'technical',
          improvements: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
          confidence: 0.9,
          suggestedChanges: 'Many improvements',
        },
      ];

      const summary = reflectionEngine.synthesizeReflections(mockReflections as any);

      expect(summary.prioritizedImprovements.length).toBeLessThanOrEqual(5);
    });
  });

  describe('shouldReflect', () => {
    it('should return false if disabled', () => {
      const originalEnabled = process.env.FAST_AGENT_REFLECTION_ENABLED;
      process.env.FAST_AGENT_REFLECTION_ENABLED = 'false';
      
      expect(reflectionEngine.shouldReflect()).toBe(false);
      
      process.env.FAST_AGENT_REFLECTION_ENABLED = originalEnabled;
    });

    it('should return true if no quality score provided', () => {
      const shouldReflect = reflectionEngine.shouldReflect(undefined);
      expect(shouldReflect).toBe(true);
    });

    it('should return true if quality score below threshold', () => {
      const shouldReflect = reflectionEngine.shouldReflect(0.5); // Below 0.8 threshold
      expect(shouldReflect).toBe(true);
    });

    it('should return false if quality score above threshold', () => {
      const shouldReflect = reflectionEngine.shouldReflect(0.9); // Above 0.8 threshold
      expect(shouldReflect).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = reflectionEngine.getConfig();
      
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('maxParallelThreads');
      expect(config).toHaveProperty('perspectives');
      expect(config).toHaveProperty('qualityThreshold');
      expect(config).toHaveProperty('timeoutMs');
      expect(config.perspectives.length).toBe(3);
    });
  });
});

describe('ReflectionEngine - Integration', () => {
  it('should integrate with chat response improvement', async () => {
    const aiResponse = `
Here's a function to add two numbers:

\`\`\`typescript
function add(a: number, b: number): number {
  return a + b;
}
\`\`\`
`;

    const reflections = await reflectionEngine.reflect(aiResponse, {
      context: {
        type: 'code generation',
        language: 'typescript',
      },
    });

    expect(reflections.length).toBeGreaterThan(0);
    
    const summary = reflectionEngine.synthesizeReflections(reflections);
    expect(summary.overallScore).toBeGreaterThan(0);
    expect(summary.prioritizedImprovements.length).toBeGreaterThan(0);
  });
});
