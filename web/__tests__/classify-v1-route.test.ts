/**
 * Unit tests for classifyV1Route — the v1 auto-routing classifier.
 *
 * Pure function, no I/O: validates the routing between the resilient v1-api path
 * and the v1-agent-loop (PlanActVerify orchestrator) path. See classifyV1Route
 * in unified-agent-service.ts for the rationale behind each rule.
 */

import { describe, it, expect } from 'vitest';
import { classifyV1Route, type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';

const tool = (name: string) => ({ name, description: name, parameters: {} });
const cfg = (overrides: Partial<UnifiedAgentConfig>): UnifiedAgentConfig => ({
  userMessage: '',
  ...overrides,
});

describe('classifyV1Route', () => {
  it('routes to v1-api when no external tools are available, even for agentic prompts', () => {
    const d = classifyV1Route(cfg({ userMessage: 'Refactor the auth service in src/auth.ts' }));
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('no_external_tools');
  });

  it('ignores the built-in choose_role tool when deciding tool availability', () => {
    const d = classifyV1Route(
      cfg({ userMessage: 'Refactor the auth service in src/auth.ts', tools: [tool('choose_role')] })
    );
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('no_external_tools');
  });

  it('routes simple chat to v1-api even with tools present', () => {
    const d = classifyV1Route(cfg({ userMessage: 'hi there, how are you?', tools: [tool('bash')] }));
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('not_agentic_enough');
  });

  it('keeps non-code mutation verbs ("write a poem") on v1-api', () => {
    const d = classifyV1Route(cfg({ userMessage: 'write a short poem about the sea', tools: [tool('bash')] }));
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('not_agentic_enough');
  });

  it('routes mutation verb + file path to the orchestrator', () => {
    const d = classifyV1Route(cfg({ userMessage: 'Update src/server/index.ts to add a health route', tools: [tool('edit_file')] }));
    expect(d.mode).toBe('v1-agent-loop');
    expect(d.reason).toBe('agentic_task_with_tools');
  });

  it('routes diagnostic verb + workspace noun to the orchestrator', () => {
    const d = classifyV1Route(cfg({ userMessage: 'Fix the failing tests in this repo', tools: [tool('bash')] }));
    expect(d.mode).toBe('v1-agent-loop');
  });

  it('routes multi-step plans over files to the orchestrator', () => {
    const d = classifyV1Route(cfg({ userMessage: 'First update the api endpoint, then run the tests', tools: [tool('bash')] }));
    expect(d.mode).toBe('v1-agent-loop');
  });

  it('classifies the raw task, ignoring prepended context (TASK: marker)', () => {
    const augmented = 'WORKSPACE STATE: build running on port 3000\nMEMORY: user prefers TS\n\nTASK:\nhello';
    const d = classifyV1Route(cfg({ userMessage: augmented, tools: [tool('bash')] }));
    expect(d.mode).toBe('v1-api');
    expect(d.signals.rawLength).toBe('hello'.length);
  });

  it('routes empty task to v1-api', () => {
    const d = classifyV1Route(cfg({ userMessage: '', tools: [tool('bash')] }));
    expect(d.mode).toBe('v1-api');
  });
});
