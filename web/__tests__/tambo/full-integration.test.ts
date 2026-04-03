/**
 * E2E Tests: Tambo Integration
 * 
 * Tests for Tambo local tools and React hooks.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Tambo Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tambo Local Tools', () => {
    const {
      formatCodeTool,
      validateInputTool,
      calculateTool,
      allTamboTools,
    } = require('@/lib/tambo/tambo-tools');

    it('should export format code tool', () => {
      expect(formatCodeTool).toBeDefined();
      expect(formatCodeTool.description).toContain('format');
    });

    it('should export validate input tool', () => {
      expect(validateInputTool).toBeDefined();
      expect(validateInputTool.description).toContain('validate');
    });

    it('should export calculate tool', () => {
      expect(calculateTool).toBeDefined();
      expect(calculateTool.description).toContain('calculate');
    });

    it('should have all tools collection', () => {
      expect(allTamboTools).toBeDefined();
      expect(Object.keys(allTamboTools).length).toBeGreaterThan(0);
    });

    it('should format code', async () => {
      const result = await formatCodeTool.execute({
        code: 'function test( ) { return 1; }',
        language: 'typescript',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should validate input', async () => {
      const result = await validateInputTool.execute({
        input: { name: 'test', value: 123 },
        schema: { type: 'object' },
      });

      expect(result).toBeDefined();
      expect(result.valid).toBeDefined();
    });

    it('should calculate expression', async () => {
      const result = await calculateTool.execute({
        expression: '2 + 2 * 3',
      });

      expect(result).toBeDefined();
      expect(result.result).toBe(8);
    });
  });

  describe('Tambo React Hooks', () => {
    const { useTamboChat } = require('@/hooks/use-tambo-chat');

    it('should export useTamboChat hook', () => {
      expect(useTamboChat).toBeDefined();
    });

    it('should return chat interface', () => {
      // Hook would be tested in component tests
      expect(typeof useTamboChat).toBe('function');
    });
  });

  describe('Tambo Components', () => {
    const TamboComponents = require('@/components/tambo');

    it('should export TamboChat component', () => {
      expect(TamboComponents.TamboChat).toBeDefined();
    });

    it('should export TamboTools component', () => {
      expect(TamboComponents.TamboTools).toBeDefined();
    });
  });

  describe('Tambo Integration: Full Workflow', () => {
    it('should support complete Tambo workflow', async () => {
      const { formatCodeTool, validateInputTool, calculateTool } = require('@/lib/tambo/tambo-tools');

      // Format code
      const formatResult = await formatCodeTool.execute({
        code: 'const x=1;',
        language: 'typescript',
      });
      expect(formatResult.success).toBe(true);

      // Validate input
      const validateResult = await validateInputTool.execute({
        input: { test: 'value' },
        schema: { type: 'object' },
      });
      expect(validateResult.valid).toBeDefined();

      // Calculate
      const calcResult = await calculateTool.execute({
        expression: '10 / 2',
      });
      expect(calcResult.result).toBe(5);
    });
  });
});
