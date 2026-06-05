/**
 * Unit tests for spec-generator.ts
 *
 * Covers the fix where buildSpecPrompt was changed from returning
 * Array<{role:'system'|'user';content:string}> to returning
 * {system: string; messages: Array<{role:'user';content:string}>}
 * to comply with the AI SDK ModelMessage[] schema.
 */

import { describe, it, expect } from 'vitest';
import { buildSpecPrompt } from '../spec-generator';

describe('buildSpecPrompt system/messages separation', () => {
  it('should return an object with system and messages properties', () => {
    const result = buildSpecPrompt('Write a test');
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('messages');
    expect(typeof result.system).toBe('string');
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('should NOT contain any system-role messages in the messages array', () => {
    const result = buildSpecPrompt('Write a test');
    const systemRoles = result.messages.filter(m => m.role === 'system');
    expect(systemRoles).toHaveLength(0);
  });

  it('should have only user-role messages in the messages array', () => {
    const result = buildSpecPrompt('Write a test');
    const allUser = result.messages.every(m => m.role === 'user');
    expect(allUser).toBe(true);
  });

  it('should produce a non-empty system prompt', () => {
    const result = buildSpecPrompt('Write a test');
    expect(result.system.length).toBeGreaterThan(100);
    expect(result.system).toContain('You are an elite software architect');
  });

  it('should include user input in the messages content', () => {
    const result = buildSpecPrompt('Build a Node.js server');
    expect(result.messages[0].content).toContain('Build a Node.js server');
    expect(result.messages[0].role).toBe('user');
  });

  it('should include context when provided', () => {
    const result = buildSpecPrompt('Build an API', 'Existing Express app, needs auth');
    expect(result.messages[0].content).toContain('Build an API');
    expect(result.messages[0].content).toContain('Existing Express app, needs auth');
    expect(result.messages[0].content).toContain('Context:');
  });

  it('should not include context label when no context given', () => {
    const result = buildSpecPrompt('Just a simple request');
    expect(result.messages[0].content).not.toContain('Context:');
    expect(result.messages[0].content).toBe('Just a simple request');
  });
});
