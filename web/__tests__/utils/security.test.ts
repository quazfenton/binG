/**
 * Security Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizePath,
  validateInput,
  isDangerousCommand,
  maskSecrets,
  generateSecureToken,
  hashForLogging,
  isAllowedFileExtension,
  isPathAllowed
} from '../../lib/utils/security';

describe('Security Utilities', () => {
  describe('sanitizePath', () => {
    it('should allow safe relative paths', () => {
      const result = sanitizePath('src/components/Button.tsx');
      expect(result).toBeTruthy();
      expect(result).toContain('src/components/Button.tsx');
    });

    it('should block directory traversal', () => {
      const result = sanitizePath('../../../etc/passwd');
      expect(result).toBeNull();
    });

    it('should block access to sensitive directories', () => {
      const result = sanitizePath('node_modules/package.json');
      expect(result).toBeNull();
    });

    it('should handle empty input', () => {
      expect(sanitizePath('')).toBeNull();
      expect(sanitizePath(null as any)).toBeNull();
    });
  });

  describe('validateInput', () => {
    it('should validate against patterns', () => {
      const pattern = /^[a-zA-Z0-9]+$/;
      expect(validateInput('abc123', pattern)).toBe(true);
      expect(validateInput('abc-123', pattern)).toBe(false);
    });
  });

  describe('isDangerousCommand', () => {
    it('should detect dangerous commands', () => {
      expect(isDangerousCommand('rm -rf /')).toBe(true);
      expect(isDangerousCommand('rm -rf ~')).toBe(true);
      expect(isDangerousCommand('dd if=/dev/zero of=/dev/sda')).toBe(true);
      expect(isDangerousCommand('ls -la')).toBe(false);
    });
  });

  describe('maskSecrets', () => {
    it('should mask API keys', () => {
      const input = 'sk-abc123def456ghi789';
      const masked = maskSecrets(input);
      expect(masked).toBe('sk-[REDACTED]');
    });

    it('should mask tokens', () => {
      const input = 'Bearer abc123def456ghi789';
      const masked = maskSecrets(input);
      expect(masked).toBe('Bearer [REDACTED]');
    });

    it('should mask passwords', () => {
      const input = 'password=mysecret123';
      const masked = maskSecrets(input);
      expect(masked).toBe('password=[REDACTED]');
    });
  });

  describe('generateSecureToken', () => {
    it('should generate tokens of correct length', () => {
      const token = generateSecureToken(16);
      expect(token).toHaveLength(32); // hex encoding doubles the byte length
      expect(/^[a-f0-9]+$/.test(token)).toBe(true);
    });
  });

  describe('hashForLogging', () => {
    it('should create consistent hashes', () => {
      const hash1 = hashForLogging('test data');
      const hash2 = hashForLogging('test data');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });
  });

  describe('isAllowedFileExtension', () => {
    it('should validate file extensions', () => {
      const allowed = ['.js', '.ts', '.json'];
      expect(isAllowedFileExtension('file.js', allowed)).toBe(true);
      expect(isAllowedFileExtension('file.py', allowed)).toBe(false);
      expect(isAllowedFileExtension('file.JS', allowed)).toBe(true); // case insensitive
    });
  });

  describe('isPathAllowed', () => {
    it('should check path containment', () => {
      const allowedDirs = ['/workspace', '/tmp'];
      expect(isPathAllowed('/workspace/file.txt', allowedDirs)).toBe(true);
      expect(isPathAllowed('/home/file.txt', allowedDirs)).toBe(false);
    });
  });
});