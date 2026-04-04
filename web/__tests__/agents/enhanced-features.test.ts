/**
 * E2E Tests: Agent Enhanced Features
 * 
 * Tests for multi-agent collaboration and agent memory.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Agent Enhanced Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Multi-Agent Collaboration', () => {
    const { MultiAgentCollaboration, createMultiAgentCollaboration, quickCollaborativeExecute } = require('../../packages/shared/agent/multi-agent-collaboration');

    let collaboration: typeof MultiAgentCollaboration;

    beforeEach(() => {
      collaboration = new MultiAgentCollaboration();
    });

    it('should register agents with roles', () => {
      const planner = collaboration.registerAgent('agent-1', 'planner');
      const coder = collaboration.registerAgent('agent-2', 'coder');
      const reviewer = collaboration.registerAgent('agent-3', 'reviewer');

      expect(planner.id).toBe('agent-1');
      expect(planner.role).toBe('planner');
      expect(coder.role).toBe('coder');
      expect(reviewer.role).toBe('reviewer');
    });

    it('should create tasks', () => {
      const task = collaboration.createTask('Build a todo app', {
        priority: 8,
      });

      expect(task.id).toBeDefined();
      expect(task.description).toBe('Build a todo app');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe(8);
    });

    it('should assign tasks to agents', () => {
      collaboration.registerAgent('agent-1', 'coder');
      const task = collaboration.createTask('Write code');

      const result = collaboration.assignTask(task.id, 'agent-1');

      expect(result).toBe(true);
      expect(task.assignedTo).toBe('agent-1');
      expect(task.status).toBe('in-progress');
    });

    it('should respect task dependencies', () => {
      const task1 = collaboration.createTask('Task 1');
      const task2 = collaboration.createTask('Task 2', {
        dependencies: [task1.id],
      });

      // Should not assign task2 before task1 is complete
      const canAssign = collaboration.assignTask(task2.id, 'agent-1');
      expect(canAssign).toBe(false);

      // Complete task1
      collaboration.completeTask(task1.id, {});

      // Now task2 can be assigned
      collaboration.registerAgent('agent-1', 'coder');
      const canAssignNow = collaboration.assignTask(task2.id, 'agent-1');
      expect(canAssignNow).toBe(true);
    });

    it('should complete tasks', () => {
      collaboration.registerAgent('agent-1', 'coder');
      const task = collaboration.createTask('Test task');
      collaboration.assignTask(task.id, 'agent-1');

      const result = collaboration.completeTask(task.id, { output: 'done' });

      expect(result).toBe(true);
      expect(task.status).toBe('completed');
      expect(task.result).toEqual({ output: 'done' });
    });

    it('should handle task failures', () => {
      collaboration.registerAgent('agent-1', 'coder');
      const task = collaboration.createTask('Test task');
      collaboration.assignTask(task.id, 'agent-1');

      const result = collaboration.failTask(task.id, 'Error occurred');

      expect(result).toBe(true);
      expect(task.status).toBe('failed');
      expect(task.error).toBe('Error occurred');
    });

    it('should send messages between agents', () => {
      collaboration.registerAgent('agent-1', 'planner');
      collaboration.registerAgent('agent-2', 'coder');

      const message = collaboration.sendMessage(
        'agent-1',
        'agent-2',
        'request',
        { task: 'Implement feature' }
      );

      expect(message.id).toBeDefined();
      expect(message.from).toBe('agent-1');
      expect(message.to).toBe('agent-2');
      expect(message.type).toBe('request');
    });

    it('should broadcast messages', () => {
      collaboration.registerAgent('agent-1', 'planner');
      collaboration.registerAgent('agent-2', 'coder');

      collaboration.sendMessage('agent-1', 'all', 'notification', {
        message: 'Meeting at 3pm',
      });

      const agent1Messages = collaboration.getMessagesForAgent('agent-1');
      const agent2Messages = collaboration.getMessagesForAgent('agent-2');

      expect(agent1Messages.length).toBe(1);
      expect(agent2Messages.length).toBe(1);
    });

    it('should handoff tasks between agents', () => {
      collaboration.registerAgent('agent-1', 'planner');
      collaboration.registerAgent('agent-2', 'coder');

      const task = collaboration.createTask('Plan and implement');
      collaboration.assignTask(task.id, 'agent-1');

      const result = collaboration.handoffTask(
        'agent-1',
        'agent-2',
        task.id,
        { plan: 'completed' }
      );

      expect(result).toBe(true);
      expect(task.assignedTo).toBe('agent-2');
    });

    it('should execute collaborative workflow', async () => {
      collaboration.registerAgent('planner_agent', 'planner');
      collaboration.registerAgent('coder_agent', 'coder');

      const result = await collaboration.executeCollaborative(
        'Build a feature',
        ['planner', 'coder']
      );

      expect(result.success).toBe(true);
      expect(Object.keys(result.results).length).toBe(2);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should provide collaboration statistics', () => {
      // Register agents and create tasks
      collaboration.registerAgent('agent-1', 'planner');
      collaboration.registerAgent('agent-2', 'coder');
      collaboration.createTask('Task 1');
      collaboration.createTask('Task 2');

      const stats = collaboration.getStats();

      expect(stats.totalAgents).toBe(2);
      expect(stats.totalTasks).toBe(2);
      expect(stats.pendingTasks).toBe(2);
    });

    it('should support quick collaborative execute', async () => {
      const result = await quickCollaborativeExecute(
        ['planner', 'coder', 'reviewer'],
        'Build and review a feature'
      );

      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
    });
  });

  describe('Agent Memory Manager', () => {
    const { AgentMemoryManager, createAgentMemoryManager, quickAddMemory } = require('../../packages/shared/agent/agent-memory');

    let memoryManager: typeof AgentMemoryManager;

    beforeEach(() => {
      memoryManager = new AgentMemoryManager();
    });

    it('should add memories with types', () => {
      const fact = memoryManager.addFact('Paris is the capital of France', 0.9);
      const event = memoryManager.addEvent('User logged in', 0.7);
      const instruction = memoryManager.addInstruction('Always use TypeScript');

      expect(fact.type).toBe('fact');
      expect(event.type).toBe('event');
      expect(instruction.type).toBe('instruction');
    });

    it('should set memory importance', () => {
      const important = memoryManager.addFact('Critical info', 0.95);
      const trivial = memoryManager.addFact('Trivial info', 0.1);

      expect(important.importance).toBe(0.95);
      expect(trivial.importance).toBe(0.1);
    });

    it('should search memories', () => {
      memoryManager.addFact('Python is a programming language');
      memoryManager.addFact('JavaScript runs in browsers');
      memoryManager.addFact('Python is used for AI');

      const results = memoryManager.searchMemories('Python', 10);

      expect(results.length).toBe(2);
      expect(results[0].content).toContain('Python');
    });

    it('should filter memories by type', () => {
      memoryManager.addFact('Fact 1');
      memoryManager.addFact('Fact 2');
      memoryManager.addEvent('Event 1');

      const facts = memoryManager.getMemoriesByType('fact');
      const events = memoryManager.getMemoriesByType('event');

      expect(facts.length).toBe(2);
      expect(events.length).toBe(1);
    });

    it('should filter memories by tags', () => {
      memoryManager.addMemory('Important note', {
        type: 'fact',
        tags: ['important', 'work'],
      });
      memoryManager.addMemory('Personal note', {
        type: 'fact',
        tags: ['personal'],
      });

      const workMemories = memoryManager.getMemoriesByTags(['work']);
      const personalMemories = memoryManager.getMemoriesByTags(['personal']);

      expect(workMemories.length).toBe(1);
      expect(personalMemories.length).toBe(1);
    });

    it('should build context for agent', async () => {
      memoryManager.addFact('Fact 1');
      memoryManager.addFact('Fact 2');
      memoryManager.addEvent('Event 1');

      const context = await memoryManager.buildContext('Fact');

      expect(context.memories.length).toBeGreaterThan(0);
      expect(context.totalTokens).toBeGreaterThan(0);
      expect(context.truncated).toBe(false);
    });

    it('should summarize memories', async () => {
      for (let i = 0; i < 15; i++) {
        memoryManager.addFact(`Fact ${i}`);
      }

      const memories = memoryManager.getRecentMemories(15);
      const summary = await memoryManager.summarizeMemories(memories);

      expect(summary).toBeDefined();
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should get recent memories', () => {
      for (let i = 0; i < 10; i++) {
        memoryManager.addFact(`Fact ${i}`);
      }

      const recent = memoryManager.getRecentMemories(5);

      expect(recent.length).toBe(5);
    });

    it('should get important memories', () => {
      memoryManager.addFact('Important', 0.9);
      memoryManager.addFact('Less important', 0.5);
      memoryManager.addFact('Trivial', 0.1);

      const important = memoryManager.getImportantMemories(0.7);

      expect(important.length).toBe(1);
      expect(important[0].content).toBe('Important');
    });

    it('should link related memories', () => {
      const mem1 = memoryManager.addFact('Related fact 1');
      const mem2 = memoryManager.addFact('Related fact 2');

      memoryManager.linkMemories(mem1.id, mem2.id);

      const related = memoryManager.getRelatedMemories(mem1.id);

      expect(related.length).toBe(1);
      expect(related[0].id).toBe(mem2.id);
    });

    it('should update memories', () => {
      const memory = memoryManager.addFact('Original content');

      const updated = memoryManager.updateMemory(memory.id, {
        content: 'Updated content',
        importance: 0.9,
      });

      expect(updated?.content).toBe('Updated content');
      expect(updated?.importance).toBe(0.9);
    });

    it('should export and import memories', () => {
      memoryManager.addFact('Fact 1');
      memoryManager.addFact('Fact 2');

      const exported = memoryManager.exportMemories();
      expect(exported.length).toBe(2);

      memoryManager.clear();
      expect(memoryManager.getRecentMemories(10).length).toBe(0);

      memoryManager.importMemories(exported);
      expect(memoryManager.getRecentMemories(10).length).toBe(2);
    });

    it('should provide memory statistics', () => {
      memoryManager.addFact('Fact 1', 0.8);
      memoryManager.addFact('Fact 2', 0.6);
      memoryManager.addEvent('Event 1', 0.5);

      const stats = memoryManager.getStats();

      expect(stats.totalMemories).toBe(3);
      expect(stats.byType.fact).toBe(2);
      expect(stats.byType.event).toBe(1);
      expect(stats.averageImportance).toBeGreaterThan(0);
    });

    it('should support quick add memory', () => {
      const { manager, memory } = quickAddMemory('Quick fact', 'fact');

      expect(memory.content).toBe('Quick fact');
      expect(memory.type).toBe('fact');
    });
  });

  describe('Agent Integration: Collaboration + Memory', () => {
    it('should work together for context-aware collaboration', () => {
      const { MultiAgentCollaboration } = require('../../packages/shared/agent/multi-agent-collaboration');
      const { AgentMemoryManager } = require('../../packages/shared/agent/agent-memory');

      const collaboration = new MultiAgentCollaboration();
      const memory = new AgentMemoryManager();

      // Add context to memory
      memory.addFact('Project uses React', 0.8);
      memory.addInstruction('Always write tests', 0.9);

      // Register agents
      collaboration.registerAgent('agent-1', 'planner');
      collaboration.registerAgent('agent-2', 'coder');

      // Create task with memory context
      const task = collaboration.createTask('Build component');

      expect(collaboration).toBeDefined();
      expect(memory).toBeDefined();
    });
  });
});
