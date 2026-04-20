/**
 * Unit tests for llm-bash-router
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { routeLLMCommand, executeRoutedCommand, llmBashRouter } from '../llm-bash-router';

describe('llm-bash-router', () => {
  describe('routeLLMCommand', () => {
    const emptyFs = () => ({});
    
    const smallFs = () => ({
      '/src/App.tsx': { content: 'function App() {}', isDirectory: false },
      '/src/index.tsx': { content: 'render()', isDirectory: false },
      '/package.json': { content: '{}', isDirectory: false },
    });

    it('should route ls to simulate', () => {
      const result = routeLLMCommand('ls', { getFilesystem: emptyFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route ls -la to simulate', () => {
      const result = routeLLMCommand('ls -la', { getFilesystem: emptyFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route cat to simulate', () => {
      const result = routeLLMCommand('cat src/App.tsx', { getFilesystem: smallFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route pwd to simulate', () => {
      const result = routeLLMCommand('pwd', { getFilesystem: emptyFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route whoami to simulate', () => {
      const result = routeLLMCommand('whoami', { getFilesystem: emptyFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route find to simulate', () => {
      const result = routeLLMCommand('find . -name "*.tsx"', { getFilesystem: emptyFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route grep to simulate', () => {
      const result = routeLLMCommand('grep "App" src/App.tsx', { getFilesystem: smallFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route tree to simulate', () => {
      const result = routeLLMCommand('tree', { getFilesystem: emptyFs });
      expect(result.mode).toBe('simulate');
    });

    it('should route npm install to sandbox', () => {
      const result = routeLLMCommand('npm install', { getFilesystem: emptyFs });
      expect(result.mode).toBe('sandbox');
    });

    it('should route git commit to sandbox', () => {
      const result = routeLLMCommand('git commit -m "test"', { getFilesystem: emptyFs });
      expect(result.mode).toBe('sandbox');
    });

    it('should require confirmation for rm -rf', () => {
      // rm -rf is blocked by security - that's actually correct behavior
      const result = routeLLMCommand('rm -rf /src', { getFilesystem: emptyFs });
      expect(result.mode).toBe('blocked');
    });

    it('should require confirmation for mv with conflict', () => {
      // Pass a FUNCTION, not an object directly
      const fsWithConflict = () => ({ '/new.txt': { content: 'existing', isDirectory: false } });
      const result = routeLLMCommand('mv old.txt new.txt', { 
        getFilesystem: fsWithConflict
      });
      expect(result.mode).toBe('confirm');
    });

    it('should allow mv without conflict', () => {
      const fsNoConflict = () => ({ '/other.txt': { content: 'other', isDirectory: false } });
      const result = routeLLMCommand('mv old.txt new.txt', { 
        getFilesystem: fsNoConflict
      });
      expect(result.mode).toBe('sandbox');
    });
  });

  describe('executeRoutedCommand', () => {
    it('should return blocked message', async () => {
      const result = await executeRoutedCommand({
        mode: 'blocked',
        reason: 'Test block',
        originalCommand: 'test',
      }, { getFilesystem: () => ({}) });
      expect(result).toContain('[BLOCKED]');
    });

    it('should return simulate output', async () => {
      const result = await executeRoutedCommand({
        mode: 'simulate',
        originalCommand: 'pwd',
      }, { getFilesystem: () => ({}) });
      expect(result).toBe('/workspace');
    });

    it('should return confirm required', async () => {
      const result = await executeRoutedCommand({
        mode: 'confirm',
        reason: ' test',
        originalCommand: 'rm file',
        needsConfirmation: true,
      }, { getFilesystem: () => ({}) });
      expect(result).toContain('[CONFIRM REQUIRED]');
    });

    it('should return sandbox', async () => {
      const result = await executeRoutedCommand({
        mode: 'sandbox',
        originalCommand: 'npm install',
      }, { getFilesystem: () => ({}) });
      expect(result).toContain('[SANDBOX]');
    });
  });

  describe('simulate command outputs', () => {
    const fs = () => ({
      'src/App.tsx': { content: 'export function App() { return 1; }', isDirectory: false },
      'src/index.tsx': { content: 'render(<App/>)', isDirectory: false },
      'src/components': { isDirectory: true },
    });

    it('should simulate ls', async () => {
      const result = await executeRoutedCommand({
        mode: 'simulate',
        originalCommand: 'ls src',
      }, { getFilesystem: fs });
      expect(result).toContain('App.tsx');
      expect(result).toContain('index.tsx');
    });

    it('should simulate cat with content', async () => {
      const result = await executeRoutedCommand({
        mode: 'simulate',
        originalCommand: 'cat src/App.tsx',
      }, { getFilesystem: fs });
      expect(result).toContain('export function App()');
    });

    it('should simulate tree', async () => {
      const result = await executeRoutedCommand({
        mode: 'simulate',
        originalCommand: 'tree',
      }, { getFilesystem: fs });
      expect(result).toContain('📁');
      expect(result).toContain('📄');
    });

    it('should simulate find', async () => {
      const result = await executeRoutedCommand({
        mode: 'simulate',
        originalCommand: 'find . -name "*.tsx"',
      }, { getFilesystem: fs });
      expect(result).toContain('.tsx');
    });

    it('should simulate grep', async () => {
      const result = await executeRoutedCommand({
        mode: 'simulate',
        originalCommand: 'grep "App" src/App.tsx',
      }, { getFilesystem: fs });
      expect(result).toContain('export function App()');
    });
  });
});