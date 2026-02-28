/**
 * CrewAI Integration Tests
 * 
 * Advanced tests for CrewAI role-based multi-agent orchestration.
 * Tests agent creation, YAML loading, task execution, and crew workflows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleAgent } from '@/lib/crewai/agents/role-agent';
import { Task } from '@/lib/crewai/tasks/task';
import { Crew } from '@/lib/crewai/crew/crew';

describe('CrewAI Integration', () => {
  describe('RoleAgent', () => {
    it('should create agent with role configuration', () => {
      const agent = new RoleAgent('test-session-123', {
        role: 'Senior Developer',
        goal: 'Write high-quality code',
        backstory: 'You are an expert developer with 10 years of experience',
        llm: 'gpt-4o',
        verbose: true,
      });

      expect(agent.role).toBe('Senior Developer');
      expect(agent.goal).toBe('Write high-quality code');
      expect(agent.config.verbose).toBe(true);
    });

    it('should emit events on kickoff', async () => {
      const agent = new RoleAgent('test-session-456', {
        role: 'Test Agent',
        goal: 'Test event emission',
        backstory: 'You are a test agent',
      });

      const startCallback = vi.fn();
      const completeCallback = vi.fn();

      agent.events.on('kickoff:start', startCallback);
      agent.events.on('kickoff:complete', completeCallback);

      await agent.kickoff('Test input');

      expect(startCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'Test input',
          role: 'Test Agent',
        })
      );
      expect(completeCallback).toHaveBeenCalled();
    });

    it('should handle kickoff errors', async () => {
      const agent = new RoleAgent('test-session-789', {
        role: 'Error Agent',
        goal: 'Test error handling',
        backstory: 'You are an error test agent',
      });

      const errorCallback = vi.fn();
      agent.events.on('kickoff:error', errorCallback);

      // Should not throw, should emit error event
      const result = await agent.kickoff('Test error input');
      
      expect(result.success).toBeDefined();
    });

    it('should enable/disable memory', () => {
      const agent = new RoleAgent('test-session-memory', {
        role: 'Memory Agent',
        goal: 'Test memory',
        backstory: 'You are a memory test agent',
      });

      expect(agent.config.memory).toBeUndefined();

      agent.enableMemory();
      expect(agent.config.memory).toBe(true);

      agent.disableMemory();
      expect(agent.config.memory).toBe(false);
    });

    it('should set embedder configuration', () => {
      const agent = new RoleAgent('test-session-embedder', {
        role: 'Embedder Agent',
        goal: 'Test embedder',
        backstory: 'You are an embedder test agent',
      });

      agent.setEmbedder('openai', 'text-embedding-3-small', 'test-key');
      
      expect(agent.config.embedder).toEqual({
        provider: 'openai',
        model: 'text-embedding-3-small',
        api_key: 'test-key',
      });
    });
  });

  describe('Task System', () => {
    it('should create task with configuration', () => {
      const agent = new RoleAgent('test-session-task', {
        role: 'Test Agent',
        goal: 'Test tasks',
        backstory: 'You are a test agent',
      });

      const task = new Task({
        description: 'Test task description',
        expected_output: 'Expected output',
        agent,
      });

      expect(task.description).toBe('Test task description');
      expect(task.expected_output).toBe('Expected output');
      expect(task.agent).toBe(agent);
    });

    it('should handle task context from previous tasks', async () => {
      const agent = new RoleAgent('test-session-context', {
        role: 'Context Agent',
        goal: 'Test context',
        backstory: 'You are a context test agent',
      });

      const task1 = new Task({
        description: 'First task',
        agent,
      });

      const task2 = new Task({
        description: 'Second task with context',
        agent,
        context: [task1],
      });

      // Execute first task
      await task1.execute({ input: 'test' });

      // Second task should have context from first
      const result = await task2.execute({ input: 'test2' });

      expect(result.raw).toBeDefined();
    });

    it('should set input files for multimodal tasks', () => {
      const agent = new RoleAgent('test-session-files', {
        role: 'File Agent',
        goal: 'Test files',
        backstory: 'You are a file test agent',
      });

      const task = new Task({
        description: 'Analyze image',
        agent,
      });

      task.setInputFiles({
        chart: {
          type: 'image',
          source: 'https://example.com/chart.png',
        },
      });

      expect(task.input_files).toBeDefined();
      expect(task.input_files?.chart.type).toBe('image');
    });

    it('should call callback on completion', async () => {
      const agent = new RoleAgent('test-session-callback', {
        role: 'Callback Agent',
        goal: 'Test callbacks',
        backstory: 'You are a callback test agent',
      });

      const callback = vi.fn();

      const task = new Task({
        description: 'Test callback task',
        agent,
        callback,
      });

      await task.execute({ input: 'test' });

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Crew Orchestration', () => {
    it('should create crew with agents and tasks', () => {
      const agent1 = new RoleAgent('test-crew-1', {
        role: 'Agent 1',
        goal: 'Goal 1',
        backstory: 'Backstory 1',
      });

      const agent2 = new RoleAgent('test-crew-2', {
        role: 'Agent 2',
        goal: 'Goal 2',
        backstory: 'Backstory 2',
      });

      const task1 = new Task({
        description: 'Task 1',
        agent: agent1,
      });

      const task2 = new Task({
        description: 'Task 2',
        agent: agent2,
      });

      const crew = new Crew({
        agents: [agent1, agent2],
        tasks: [task1, task2],
        process: 'sequential',
        verbose: true,
      });

      expect(crew.agents.length).toBe(2);
      expect(crew.tasks.length).toBe(2);
      expect(crew.process).toBe('sequential');
      expect(crew.verbose).toBe(true);
    });

    it('should execute sequential process', async () => {
      const agent1 = new RoleAgent('test-sequential-1', {
        role: 'Sequential Agent 1',
        goal: 'Goal 1',
        backstory: 'Backstory 1',
      });

      const agent2 = new RoleAgent('test-sequential-2', {
        role: 'Sequential Agent 2',
        goal: 'Goal 2',
        backstory: 'Backstory 2',
      });

      const task1 = new Task({
        description: 'Sequential task 1',
        agent: agent1,
      });

      const task2 = new Task({
        description: 'Sequential task 2',
        agent: agent2,
        context: [task1],
      });

      const crew = new Crew({
        agents: [agent1, agent2],
        tasks: [task1, task2],
        process: 'sequential',
      });

      const result = await crew.kickoff({ input: 'test' });

      expect(result.raw).toBeDefined();
      expect(result.tasks_output.length).toBe(2);
    });

    it('should execute hierarchical process', async () => {
      const manager = new RoleAgent('test-hierarchical-manager', {
        role: 'Manager',
        goal: 'Coordinate team',
        backstory: 'You are an experienced manager',
        allow_delegation: true,
      });

      const developer = new RoleAgent('test-hierarchical-dev', {
        role: 'Developer',
        goal: 'Write code',
        backstory: 'You are a skilled developer',
      });

      const task = new Task({
        description: 'Hierarchical task',
        agent: developer,
      });

      const crew = new Crew({
        agents: [manager, developer],
        tasks: [task],
        process: 'hierarchical',
        manager_agent: manager,
        verbose: true,
      });

      const result = await crew.kickoff({ input: 'test' });

      expect(result.raw).toBeDefined();
    });

    it('should stream crew execution', async () => {
      const agent = new RoleAgent('test-stream', {
        role: 'Stream Agent',
        goal: 'Test streaming',
        backstory: 'You are a streaming test agent',
      });

      const task = new Task({
        description: 'Streaming task',
        agent,
      });

      const crew = new Crew({
        agents: [agent],
        tasks: [task],
        stream: true,
      });

      const chunks: any[] = [];
      for await (const chunk of crew.kickoffStream({ input: 'test' })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.type === 'task_start')).toBe(true);
      expect(chunks.some(c => c.type === 'final')).toBe(true);
    });

    it('should call task callbacks', async () => {
      const agent = new RoleAgent('test-callback-crew', {
        role: 'Callback Crew Agent',
        goal: 'Test crew callbacks',
        backstory: 'You are a callback test agent',
      });

      const taskCallback = vi.fn();

      const task = new Task({
        description: 'Callback task',
        agent,
      });

      const crew = new Crew({
        agents: [agent],
        tasks: [task],
        task_callback: taskCallback,
      });

      await crew.kickoff({ input: 'test' });

      expect(taskCallback).toHaveBeenCalled();
    });

    it('should enable tracing', () => {
      const agent = new RoleAgent('test-tracing', {
        role: 'Tracing Agent',
        goal: 'Test tracing',
        backstory: 'You are a tracing test agent',
      });

      const task = new Task({
        description: 'Tracing task',
        agent,
      });

      const crew = new Crew({
        agents: [agent],
        tasks: [task],
      });

      expect(crew.tracing).toBe(false);

      crew.enableTracing();
      expect(crew.tracing).toBe(true);

      crew.disableTracing();
      expect(crew.tracing).toBe(false);
    });
  });

  describe('Event System', () => {
    it('should emit crew start event', async () => {
      const agent = new RoleAgent('test-event-start', {
        role: 'Event Agent',
        goal: 'Test events',
        backstory: 'You are an event test agent',
      });

      const task = new Task({
        description: 'Event task',
        agent,
      });

      const crew = new Crew({
        agents: [agent],
        tasks: [task],
      });

      const startCallback = vi.fn();
      crew.events.on('crew:start', startCallback);

      await crew.kickoff({ input: 'test' });

      expect(startCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          process: 'sequential',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should emit crew complete event', async () => {
      const agent = new RoleAgent('test-event-complete', {
        role: 'Complete Agent',
        goal: 'Test complete events',
        backstory: 'You are a complete test agent',
      });

      const task = new Task({
        description: 'Complete task',
        agent,
      });

      const crew = new Crew({
        agents: [agent],
        tasks: [task],
      });

      const completeCallback = vi.fn();
      crew.events.on('crew:complete', completeCallback);

      await crew.kickoff({ input: 'test' });

      expect(completeCallback).toHaveBeenCalled();
    });
  });
});
