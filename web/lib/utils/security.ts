/**
 * Security Utilities for binG
 *
 * Centralized security functions for:
 * - Path sanitization and traversal prevention
 * - Input validation
 * - Command injection prevention
 * - Secret detection and masking
 */

import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Sanitize file paths to prevent directory traversal attacks
 */
export function sanitizePath(inputPath: string, baseDir: string = process.cwd()): string | null {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

  // Resolve to absolute path
  const resolved = path.resolve(baseDir, inputPath);

  // Normalize baseDir to include trailing separator to prevent prefix collision
  const normalizedBaseDir = path.resolve(baseDir) + path.sep;

  // Check for directory traversal attempts
  if (!resolved.startsWith(normalizedBaseDir)) {
    return null;
  }

  // Prevent access to sensitive directories
  const sensitiveDirs = ['node_modules', '.git', '.env', 'tmp', 'temp'];
  const pathParts = resolved.split(path.sep);

  for (const part of pathParts) {
    if (sensitiveDirs.includes(part.toLowerCase())) {
      return null;
    }
  }

  return resolved;
}

/**
 * Validate user input against allowed patterns
 */
export function validateInput(input: string, pattern: RegExp): boolean {
  return pattern.test(input);
}

/**
 * Detect potentially dangerous shell commands
 */
export function isDangerousCommand(command: string): boolean {
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,
    /rm\s+-rf\s+\~/,
    /rm\s+-rf\s+\.\./,
    /dd\s+if=/,
    /mkfs/,
    /fdisk/,
    /\bformat\b/,
    /del\s+.*\*/,
    /rd\s+.*\/s/
  ];

  return dangerousPatterns.some(pattern => pattern.test(command.toLowerCase()));
}

/**
 * Mask sensitive information in strings
 */
export function maskSecrets(text: string): string {
  // API keys
  text = text.replace(/sk-[a-zA-Z0-9]{20,}/gi, 'sk-[REDACTED]');
  text = text.replace(/xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/gi, 'xoxb-[REDACTED]');
  text = text.replace(/ghp_[a-zA-Z0-9]{36}/gi, 'ghp_[REDACTED]');

  // Generic tokens
  text = text.replace(/Bearer\s+[a-zA-Z0-9\-_.]{20,}/gi, 'Bearer [REDACTED]');
  text = text.replace(/token=[a-zA-Z0-9\-_.]{16,}/gi, 'token=[REDACTED]');

  // Passwords
  text = text.replace(/password=[^\s&]*/gi, 'password=[REDACTED]');

  return text;
}

/**
 * Generate secure random tokens
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash sensitive data for logging
 */
export function hashForLogging(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Validate file extensions against allowed list
 */
export function isAllowedFileExtension(filename: string, allowedExtensions: string[]): boolean {
  const ext = path.extname(filename).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(filePath: string, allowedDirs: string[]): boolean {
  const resolved = path.resolve(filePath);
  return allowedDirs.some(dir => resolved.startsWith(path.resolve(dir) + path.sep));
}