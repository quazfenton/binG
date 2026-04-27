/**
 * Configuration Validation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  validateEnvironment,
  createValidatedConfig,
  databaseConfigSchema,
  apiConfigSchema,
  filesystemConfigSchema,
  orchestrationConfigSchema
} from '../utils/config-validation';

describe('Configuration Validation', () => {
  describe('validateConfig', () => {
    it('should validate valid configuration', () => {
      const config = { host: 'localhost', port: 5432, database: 'test', username: 'user', password: 'pass' };
      const result = validateConfig(config, databaseConfigSchema);

      expect(result.success).toBe(true);
      expect((result as any).data.host).toBe('localhost');
    });

    it('should reject invalid configuration', () => {
      const config = { host: '', port: 99999, database: '', username: 'user' };
      const result = validateConfig(config, databaseConfigSchema);

      expect(result.success).toBe(false);
      expect((result as any).errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should pass with all required variables present', () => {
      process.env.REQUIRED_VAR = 'value';
      const result = validateEnvironment(['REQUIRED_VAR']);

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should fail with missing required variables', () => {
      const result = validateEnvironment(['MISSING_VAR']);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('MISSING_VAR');
    });

    it('should validate port numbers', () => {
      process.env.TEST_PORT = 'invalid';
      const result = validateEnvironment([], ['TEST_PORT']);

      expect(result.valid).toBe(false);
      expect(result.invalid.length).toBeGreaterThan(0);
    });
  });

  describe('createValidatedConfig', () => {
    it('should merge defaults with input', () => {
      const input = { host: 'localhost' };
      const defaults = { host: 'default', port: 5432, database: 'test' };
      const result = createValidatedConfig(input, defaults, databaseConfigSchema);

      expect(result.host).toBe('localhost');
      expect(result.port).toBe(5432);
    });

    it('should throw on invalid configuration', () => {
      const input = { port: -1 };
      const defaults = { host: 'localhost', port: 5432 };

      expect(() => {
        createValidatedConfig(input, defaults, databaseConfigSchema);
      }).toThrow();
    });
  });

  describe('Schema validation', () => {
    it('should validate API config', () => {
      const config = { baseUrl: 'https://api.example.com' };
      const result = validateConfig(config, apiConfigSchema);

      expect(result.success).toBe(true);
    });

    it('should validate filesystem config', () => {
      const config = { rootDir: '/workspace' };
      const result = validateConfig(config, filesystemConfigSchema);

      expect(result.success).toBe(true);
    });

    it('should validate orchestration config', () => {
      const config = { defaultMode: 'unified-agent' as const };
      const result = validateConfig(config, orchestrationConfigSchema);

      expect(result.success).toBe(true);
    });
  });
});