/**
 * Execution Graph Unit Tests
 *
 * Covers:
 * - DAG creation and node management
 * - Dependency tracking and unblocking
 * - Abort controller lifecycle (Bug 12 fix)
 * - Graph cancellation with running node abort
 * - Progress tracking and timeline
 * - Retry logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executionGraphEngine, type ExecutionGraph, type ExecutionNode } from '@bing/shared/agent/execution-graph';

describe('Execution Graph — DAG Creation', () => {
  it('creates a graph with unique ID', () => {
    const graph = executionGraphEngine.createGraph('test-session');

    expect(graph).toBeDefined();
    expect(graph.id).toMatch(/^graph-/);
    expect(graph.sessionId).toBe('test-session');
    expect(graph.status).toBe('pending');
    expect(graph.nodes.size).toBe(0);
  });

  it('accepts custom graph ID', () => {
    const graph = executionGraphEngine.createGraph('test-session', 'custom-id');

    expect(graph.id).toBe('custom-id');
  });
});

describe('Execution Graph — Node Management', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('adds a node with correct initial status', () => {
    const node = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test Node',
      dependencies: [],
    });

    expect(node.status).toBe('pending'); // No dependencies → pending
    expect(node.retryCount).toBe(0);
    expect(node.maxRetries).toBe(3);
  });

  it('sets node status to blocked when it has dependencies', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    const node2 = executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'tool_call',
      name: 'Second',
      dependencies: ['node-1'],
    });

    expect(node2.status).toBe('blocked');
  });

  it('creates abort controller when node is marked running', () => {
    const node = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test',
      dependencies: [],
    });

    expect(node.abortController).toBeUndefined();

    executionGraphEngine.markRunning(graph, 'node-1');

    expect(node.abortController).toBeDefined();
    expect(node.abortController).toBeInstanceOf(AbortController);
    expect(node.status).toBe('running');
    expect(node.startedAt).toBeDefined();
  });

  it('cleans up abort controller on completion', () => {
    const node = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    expect(node.abortController).toBeDefined();

    executionGraphEngine.markComplete(graph, 'node-1', { result: 'done' });

    expect(node.abortController).toBeUndefined();
    expect(node.status).toBe('completed');
    expect(node.completedAt).toBeDefined();
  });

  it('cleans up abort controller on failure', () => {
    const node = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    expect(node.abortController).toBeDefined();

    executionGraphEngine.markFailed(graph, 'node-1', 'Test error');

    expect(node.abortController).toBeUndefined();
    expect(node.status).toBe('failed');
    expect(node.error).toBe('Test error');
  });
});

describe('Execution Graph — Dependency Tracking', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('unblocks dependent nodes when dependency completes', () => {
    const node1 = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    const node2 = executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'tool_call',
      name: 'Second',
      dependencies: ['node-1'],
    });

    expect(node2.status).toBe('blocked');

    // Complete node1
    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markComplete(graph, 'node-1', { plan: 'done' });

    // node2 should now be pending (unblocked)
    expect(node2.status).toBe('pending');
  });

  it('keeps node blocked if not all dependencies are complete', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'agent_step',
      name: 'Second',
      dependencies: [],
    });

    const node3 = executionGraphEngine.addNode(graph, {
      id: 'node-3',
      type: 'tool_call',
      name: 'Third',
      dependencies: ['node-1', 'node-2'],
    });

    // Complete only node1
    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markComplete(graph, 'node-1', {});

    // node3 should still be blocked (node2 not complete)
    expect(node3.status).toBe('blocked');
  });

  it('blocks all dependents when a node fails', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    const node2 = executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'tool_call',
      name: 'Second',
      dependencies: ['node-1'],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markFailed(graph, 'node-1', 'Failed');

    expect(node2.status).toBe('blocked');
  });
});

describe('Execution Graph — Cancellation (Bug 12 Fix)', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('aborts running nodes on graph cancellation', () => {
    const node1 = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Running Node',
      dependencies: [],
    });

    const node2 = executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'tool_call',
      name: 'Pending Node',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    expect(node1.abortController).toBeDefined();
    expect(node1.status).toBe('running');

    executionGraphEngine.cancelGraph(graph);

    // node1 should be cancelled with abort triggered
    expect(node1.status).toBe('cancelled');
    expect(node1.abortController).toBeUndefined(); // Cleaned up
    expect(node1.error).toBe('Cancelled by graph');
    expect(node1.completedAt).toBeDefined();

    // node2 (pending) should also be cancelled
    expect(node2.status).toBe('cancelled');
  });

  it('sets graph status to cancelled', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.cancelGraph(graph);

    expect(graph.status).toBe('cancelled');
  });
});

describe('Execution Graph — Progress & Status', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('reports correct progress', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'tool_call',
      name: 'Second',
      dependencies: [],
    });

    executionGraphEngine.addNode(graph, {
      id: 'node-3',
      type: 'sandbox_action',
      name: 'Third',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markComplete(graph, 'node-1', {});
    executionGraphEngine.markRunning(graph, 'node-2');

    const progress = executionGraphEngine.getProgress(graph);

    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.running).toBe(1);
    expect(progress.pending).toBe(1);
    expect(progress.failed).toBe(0);
    expect(progress.percent).toBe(33); // Math.round(1/3 * 100)
  });

  it('detects graph completion when all nodes complete', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markComplete(graph, 'node-1', {});

    expect(graph.status).toBe('completed');
    expect(graph.completedAt).toBeDefined();
  });

  it('detects graph failure when nodes fail', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markFailed(graph, 'node-1', 'Error');

    expect(graph.status).toBe('failed');
  });
});

describe('Execution Graph — Retry Logic', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('retries failed nodes up to maxRetries', () => {
    const node = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markFailed(graph, 'node-1', 'Error');

    expect(node.status).toBe('failed');
    expect(node.retryCount).toBe(0);

    // First retry
    const retry1 = executionGraphEngine.retryNode(graph, 'node-1');
    expect(retry1).toBe(true);
    expect(node.status).toBe('pending');
    expect(node.retryCount).toBe(1);
    expect(node.error).toBeUndefined();

    // Fail again
    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markFailed(graph, 'node-1', 'Error 2');

    // Second retry
    const retry2 = executionGraphEngine.retryNode(graph, 'node-1');
    expect(retry2).toBe(true);
    expect(node.retryCount).toBe(2);

    // Fail again
    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markFailed(graph, 'node-1', 'Error 3');

    // Third retry (maxRetries = 3, so this should be the last)
    const retry3 = executionGraphEngine.retryNode(graph, 'node-1');
    expect(retry3).toBe(true);
    expect(node.retryCount).toBe(3);

    // Fail again — should exceed maxRetries
    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markFailed(graph, 'node-1', 'Error 4');

    const retry4 = executionGraphEngine.retryNode(graph, 'node-1');
    expect(retry4).toBe(false); // Exceeded maxRetries
  });

  it('cannot retry non-failed nodes', () => {
    const node = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'Test',
      dependencies: [],
    });

    // Node is pending, not failed
    const retry = executionGraphEngine.retryNode(graph, 'node-1');
    expect(retry).toBe(false);
  });

  it('cannot retry non-existent nodes', () => {
    const retry = executionGraphEngine.retryNode(graph, 'non-existent');
    expect(retry).toBe(false);
  });
});

describe('Execution Graph — Ready Nodes', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('returns nodes with all dependencies complete', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'tool_call',
      name: 'Second',
      dependencies: ['node-1'],
    });

    const ready = executionGraphEngine.getReadyNodes(graph);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('node-1');
  });

  it('detects parallelization opportunity', () => {
    executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.addNode(graph, {
      id: 'node-2',
      type: 'agent_step',
      name: 'Second',
      dependencies: [],
    });

    expect(executionGraphEngine.canParallelize(graph)).toBe(true);
  });
});

describe('Execution Graph — Timeline', () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = executionGraphEngine.createGraph('test-session');
  });

  it('returns execution timeline sorted by start time', () => {
    const node1 = executionGraphEngine.addNode(graph, {
      id: 'node-1',
      type: 'agent_step',
      name: 'First',
      dependencies: [],
    });

    executionGraphEngine.markRunning(graph, 'node-1');
    executionGraphEngine.markComplete(graph, 'node-1', {});

    const timeline = executionGraphEngine.getTimeline(graph);

    expect(timeline.length).toBe(1);
    expect(timeline[0].nodeId).toBe('node-1');
    expect(timeline[0].duration).toBeDefined();
    expect(timeline[0].duration).toBeGreaterThan(0);
  });
});
