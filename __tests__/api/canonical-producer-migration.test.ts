import { describe, expect, it } from 'vitest';
import { normalizeToolInvocation, type ToolInvocation } from '@/lib/types/tool-invocation';

/**
 * Tests verifying that each migrated producer path creates
 * ToolInvocation records with the expected provenance metadata.
 *
 * These are unit-level tests against normalizeToolInvocation (the shared
 * serialisation boundary), using payloads shaped like each producer emits.
 */
describe('canonical producer migration', () => {
  describe('V2 executor shape', () => {
    it('normalizes a v2-executor tool invocation with provenance', () => {
      const inv = normalizeToolInvocation({
        toolCallId: 'grep-1710000000000',
        toolName: 'grep',
        state: 'result',
        args: { pattern: 'TODO' },
        result: { matches: 3 },
        sourceSystem: 'v2-executor',
        sourceAgent: 'v2',
        timestamp: 1710000000000,
      });

      expect(inv.toolCallId).toBe('grep-1710000000000');
      expect(inv.toolName).toBe('grep');
      expect(inv.state).toBe('result');
      expect(inv.metadata?.sourceSystem).toBe('v2-executor');
      expect(inv.metadata?.sourceAgent).toBe('v2');
    });
  });

  describe('Mastra agent-loop shape', () => {
    it('normalizes a tool-loop-agent invocation with provenance', () => {
      const inv = normalizeToolInvocation({
        toolCallId: 'call-abc',
        toolName: 'read_file',
        state: 'result',
        args: { path: '/src/index.ts' },
        result: { success: true, content: '...' },
        sourceSystem: 'mastra',
        sourceAgent: 'tool-loop-agent',
      });

      expect(inv.toolName).toBe('read_file');
      expect(inv.metadata?.sourceSystem).toBe('mastra');
      expect(inv.metadata?.sourceAgent).toBe('tool-loop-agent');
    });

    it('normalizes a manual-loop invocation from executeManual results', () => {
      const inv = normalizeToolInvocation({
        toolName: 'write_file',
        args: { path: '/out.txt', content: 'hello' },
        result: { success: true },
        sourceSystem: 'mastra',
        sourceAgent: 'manual-loop',
      });

      expect(inv.toolName).toBe('write_file');
      expect(inv.metadata?.sourceSystem).toBe('mastra');
      expect(inv.metadata?.sourceAgent).toBe('manual-loop');
      expect(inv.toolCallId).toMatch(/^write_file-/);
    });
  });

  describe('OpenCode engine shape', () => {
    it('normalizes a bash command invocation', () => {
      const inv = normalizeToolInvocation({
        toolName: 'bash',
        args: { command: 'npm test' },
        result: { output: 'PASS', exitCode: 0 },
        sourceSystem: 'opencode-engine',
      });

      expect(inv.toolName).toBe('bash');
      expect(inv.args).toEqual({ command: 'npm test' });
      expect(inv.metadata?.sourceSystem).toBe('opencode-engine');
    });

    it('normalizes a file_operation invocation', () => {
      const inv = normalizeToolInvocation({
        toolName: 'file_operation',
        args: { path: 'src/app.ts', action: 'create' },
        result: { content: 'console.log("hi")' },
        sourceSystem: 'opencode-engine',
      });

      expect(inv.toolName).toBe('file_operation');
      expect(inv.args).toEqual({ path: 'src/app.ts', action: 'create' });
      expect(inv.metadata?.sourceSystem).toBe('opencode-engine');
    });

    it('normalizes a generic tool_call from opencode CLI', () => {
      const inv = normalizeToolInvocation({
        toolName: 'custom_analyzer',
        args: { target: 'perf' },
        result: { score: 92 },
        sourceSystem: 'opencode-engine',
      });

      expect(inv.toolName).toBe('custom_analyzer');
      expect(inv.metadata?.sourceSystem).toBe('opencode-engine');
    });
  });
});
