/**
 * Unit tests for fallback text-based tool call parsing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/virtual-filesystem/sync/sync-events', () => ({
  emitFilesystemUpdated: vi.fn(),
}));

describe('Fallback Text-Based Tool Call Parsing', () => {
  describe('parseTextToolCalls pattern matching', () => {
    it('should parse write_file with JSON object syntax', async () => {
      const { AgentLoop } = await import('../agent-loop');
      
      // Create a minimal agent to test parsing
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      
      // Access the private method via any cast
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = 'I will create a file for you: write_file({ "path": "hello.py", "content": "print(\"Hello World\")" })';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('write_file');
      expect(toolCalls[0].arguments.path).toBe('hello.py');
      expect(toolCalls[0].arguments.content).toBe('print("Hello World")');
    });

    it('should parse [Tool: name] { ... } format', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = '[Tool: write_file] { "path": "test.js", "content": "console.log(\"test\")" }';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('write_file');
      expect(toolCalls[0].arguments.path).toBe('test.js');
    });

    it('should parse { "tool": "name", ... } format', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = '{ "tool": "read_file", "path": "src/index.js" }';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('read_file');
      expect(toolCalls[0].arguments.path).toBe('src/index.js');
    });

    it('should parse multiple tool calls in one response', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = `I'll set up the project:
write_file({ "path": "package.json", "content": "{}" })
write_file({ "path": "index.js", "content": "console.log(\"hello\")" })`;
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].name).toBe('write_file');
      expect(toolCalls[0].arguments.path).toBe('package.json');
      expect(toolCalls[1].name).toBe('write_file');
      expect(toolCalls[1].arguments.path).toBe('index.js');
    });

    it('should return empty array when no tool calls present', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = 'Hello! How can I help you today?';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(0);
    });

    it('should handle list_directory tool call', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = 'Let me check the directory: list_directory({ "path": "src" })';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('list_directory');
      expect(toolCalls[0].arguments.path).toBe('src');
    });

    it('should handle create_directory tool call', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = 'Creating directory: create_directory({ "path": "src/components" })';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('create_directory');
      expect(toolCalls[0].arguments.path).toBe('src/components');
    });

    it('should handle delete_file tool call', async () => {
      const { AgentLoop } = await import('../agent-loop');
      const agent = new AgentLoop('test-user', 'test-path', 5, {}, 'test-model');
      const parseTextToolCalls = (agent as any).parseTextToolCalls.bind(agent);
      
      const text = 'Removing old file: delete_file({ "path": "old.txt" })';
      
      const toolCalls = await parseTextToolCalls(text);
      
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('delete_file');
      expect(toolCalls[0].arguments.path).toBe('old.txt');
    });
  });
});