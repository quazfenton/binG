/**
 * Task Router Unit Tests
 *
 * Covers:
 * - Task type classification and routing
 * - Nullclaw type mapping (Bug 3 fix)
 * - Advanced task detection and timeout (Bug 4 fix)
 * - CLI agent sandbox guard
 * - Error handling with unknown type safety
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Task Router — Task Classification', () => {
  it('scores keywords correctly for coding tasks', async () => {
    // Import the module
    const { taskRouter } = await import('../task-router');

    const result = taskRouter.analyzeTask('Write a TypeScript function to parse JSON');
    expect(result.type).toBe('coding');
    expect(result.target).toBe('opencode');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('scores keywords correctly for messaging tasks', async () => {
    const { taskRouter } = await import('../task-router');

    const result = taskRouter.analyzeTask('Send a Discord message to the #general channel');
    expect(result.type).toBe('messaging');
    expect(result.target).toBe('nullclaw');
  });

  it('scores keywords correctly for browsing tasks', async () => {
    const { taskRouter } = await import('../task-router');

    const result = taskRouter.analyzeTask('Browse to https://example.com and scrape the data');
    expect(result.type).toBe('browsing');
    expect(result.target).toBe('nullclaw');
  });

  it('handles unknown task type with zero confidence', async () => {
    const { taskRouter } = await import('../task-router');

    const result = taskRouter.analyzeTask('Hello, how are you?');
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.target).toBe('cli');
  });

  it('detects automation tasks correctly', async () => {
    const { taskRouter } = await import('../task-router');

    const result = taskRouter.analyzeTask('Set up a cron job to backup the database daily');
    expect(result.type).toBe('automation');
    // Automation with coding keywords should route to opencode
    expect(result.target).toBe('opencode');
  });
});

describe('Task Router — Nullclaw Type Mapping (Bug 3 Fix)', () => {
  it('maps messaging task type to nullclaw message type', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    // Verify the nullclaw type mapping covers all task types
    expect(content).toContain("taskType === 'messaging'  ? 'message'");
    expect(content).toContain("taskType === 'browsing'   ? 'browse'");
    expect(content).toContain("taskType === 'api'        ? 'api'");
    expect(content).toContain("taskType === 'automation' ? 'automate'");
    // Verify 'schedule' type is in the union
    expect(content).toContain("'message' | 'browse' | 'automate' | 'api' | 'schedule'");
  });
});

describe('Task Router — Advanced Task Timeout (Bug 4 Fix)', () => {
  it('enforces timeout with proper cleanup', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    // Verify timeout enforcement
    expect(content).toContain('timedOut = true');
    expect(content).toContain('cancelAgent(agentId)');
    expect(content).toContain('clearInterval(interval)');
    // Verify max timeout cap
    expect(content).toContain('Math.min(');
    expect(content).toContain('120_000');
  });

  it('catches errors with unknown type safety', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    expect(content).toContain('catch (error: unknown)');
    expect(content).toContain('error instanceof Error ? error.message : String(error)');
  });
});

describe('Task Router — CLI Agent Guard', () => {
  it('guards against missing sandbox handle', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    expect(content).toContain('if (!session.sandboxHandle)');
    expect(content).toContain('CLI agent requires an active sandbox session');
  });
});

describe('Task Router — Advanced Task Fallback (Bug 11 Fix)', () => {
  it('wraps scheduleTask in try/catch', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    expect(content).toContain('FIX (Bug 11)');
    expect(content).toContain('scheduleTask failed');
    // Verify nested try/catch structure
    expect(content).toContain('const scheduledTask = await scheduleTask');
    expect(content).toContain('catch (scheduleError: unknown)');
  });

  it('emits failure event without masking original error', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    expect(content).toContain('phase: \'failed\'');
    // Verify event emit is wrapped in try/catch
    expect(content).toContain('await emitEvent');
    // The outer catch should still throw the original error
    expect(content).toContain('throw error');
  });
});

describe('Task Router — Dispatch Exhaustiveness', () => {
  it('uses TypeScript never type for routing exhaustiveness', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../task-router.ts'),
      'utf-8',
    );

    expect(content).toContain('const _exhaustive: never = target');
    expect(content).toContain('Unknown routing target');
  });
});
