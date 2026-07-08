/**
 * NEW-1 followup-d (2026-07-07): Vitest unit tests for the #70 + #71 Promise.all
 * parallelization apply to /opt/bing/web/lib/spawn/orchestration/agent-team.ts
 *
 *   - #70 executeConsensus (L611-L664): per-iteration agent fan-out
 *   - #71 executeCompetitive (L722-L775): competitive solution generation
 *
 * Asserts per user spec:
 *   (a) all-or-nothing survival in solutions[] / contributions[]
 *   (b) voteOnSolutions submitted array has expected survivor count
 *   (c) competitive-mode judge prompt receives correct solutions[index] ↔ agent-index correspondence
 *   (d) Promise.all order vs. completion order verified (vi fake timers)
 *   (e) logger.warn called once per failed agent with { error } context object
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.mock hoists above imports; the factory creates the mock logger ONCE
// and exposes it via __mockLogger for test assertion access. The same
// `mock` reference is captured by BOTH the createLogger return value AND
// the __mockLogger export, so agent-team.ts's `logger.warn(...)` and the
// test's `mockLog.warn.mock.calls` reference the SAME underlying vi.fn().
vi.mock('@/lib/utils/logger', () => {
  const mock = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    createLogger: vi.fn(() => mock),
    __mockLogger: mock,
  };
});

import { AgentTeam } from '@/lib/spawn/orchestration/agent-team';
import * as loggerModule from '@/lib/utils/logger';

const mockLog = (loggerModule as any).__mockLogger as {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

const AGENTS = [
  { role: 'architect', type: 'claude-code', model: 'claude-opus' },
  { role: 'developer', type: 'claude-code', model: 'claude-sonnet' },
  { role: 'reviewer', type: 'amp', model: 'amp-coder' },
] as const;

function makeTeam(): any {
  const team = new AgentTeam({
    name: 'test-team',
    agents: [...AGENTS],
    workspaceDir: '/tmp/test-ws',
  });
  // Populate activeAgents (the iteration loop iterates `Array.from(this.activeAgents.entries())`)
  (team as any).activeAgents = new Map(
    AGENTS.map((a) => [a.role, { prompt: () => {} } as any]),
  );
  // Stub updateProgress to a no-op (private method)
  (team as any).updateProgress = vi.fn();
  return team;
}

describe('AgentTeam #70 executeConsensus (NEW-1 followup-d parallelization)', () => {
  let team: any;
  let contributions: any[];
  let startTime: number;

  beforeEach(() => {
    mockLog.warn.mockClear();
    mockLog.info.mockClear();
    mockLog.error.mockClear();
    team = makeTeam();
    contributions = [];
    startTime = Date.now();
  });

  const baseTask = { task: 'Consensus test', successCriteria: ['A', 'B'] } as any;

  it('(a) only surviving agents appear in solutions[] + contributions[]', async () => {
    (team as any).runLLM = vi.fn(async ({ role }: any) => {
      if (role === 'developer') throw new Error('developer LLM call failed');
      return { response: `result-from-${role}`, filesModified: [] };
    });
    (team as any).voteOnSolutions = vi.fn(async (_solutions: any[]) => ({
      consensusScore: 0.85,
      bestSolution: 'winning',
    }));

    await (team as any).executeConsensus(baseTask, contributions, startTime);

    const submitted = (team as any).voteOnSolutions.mock.calls[0][0];
    // contributions[] also gets a `manager` consensus-summary push at L661 when
    // consensusScore > 0.7 — filter it out so we assert only on agent-fan-out.
    // Tighten: also assert the manager push's content shape so a future contributor
    // adding a different manager-role push surfaces as a test mismatch (not silent pass).
    const agentFanoutContributions = contributions.filter((c) => c.role !== 'manager');
    const managerSummary = contributions.find((c) => c.role === 'manager');
    expect(submitted).toHaveLength(2);
    expect(submitted.map((s: any) => s.role)).toEqual(['architect', 'reviewer']);
    expect(agentFanoutContributions.map((c: any) => c.role)).toEqual(['architect', 'reviewer']);
    expect(managerSummary?.content).toMatch(/Consensus reached with score/);
  });

  it('(b) voteOnSolutions receives surviving count (1 of 3 when 2 fail)', async () => {
    (team as any).runLLM = vi.fn(async ({ role }: any) => {
      if (role === 'developer' || role === 'reviewer') throw new Error('boom');
      return { response: 'ok' };
    });
    (team as any).voteOnSolutions = vi.fn(async (_solutions: any[]) => ({
      consensusScore: 0.85,
      bestSolution: 'winning',
    }));

    await (team as any).executeConsensus(baseTask, contributions, startTime);

    expect((team as any).voteOnSolutions).toHaveBeenCalledTimes(1);
    const submitted = (team as any).voteOnSolutions.mock.calls[0][0];
    expect(submitted).toHaveLength(1);
    expect(submitted[0].role).toBe('architect');
  });

  it('(d) Promise.all preserves INPUT order despite varying completion times', async () => {
    vi.useFakeTimers();
    try {
      (team as any).runLLM = vi.fn(({ role }: any) =>
        new Promise((resolve) => {
          // architect completes LAST (30ms), developer (20ms), reviewer FIRST (10ms).
          // Promise.all must still produce INPUT ORDER in output.
          const delay = role === 'architect' ? 30 : role === 'developer' ? 20 : 10;
          setTimeout(
            () => resolve({ response: `result-from-${role}`, filesModified: [] }),
            delay,
          );
        }),
      );
      (team as any).voteOnSolutions = vi.fn(async (_solutions: any[]) => ({
        consensusScore: 0.5,
        bestSolution: '',
      }));
      team.config.maxIterations = 1;

      const promise = (team as any).executeConsensus(baseTask, contributions, startTime);
      await vi.runAllTimersAsync();
      await promise;

      const submitted = (team as any).voteOnSolutions.mock.calls[0][0];
      expect(submitted.map((s: any) => s.role)).toEqual([
        'architect',
        'developer',
        'reviewer',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(e) logger.warn called once per failed agent with { error } context object', async () => {
    (team as any).runLLM = vi.fn(async ({ role }: any) => {
      if (role === 'developer') throw new Error('developer boom');
      if (role === 'reviewer') throw new Error('reviewer boom');
      return { response: 'ok' };
    });
    (team as any).voteOnSolutions = vi.fn(async (_solutions: any[]) => ({
      consensusScore: 0.85,
      bestSolution: 'winning',
    }));

    await (team as any).executeConsensus(baseTask, contributions, startTime);

    expect(mockLog.warn).toHaveBeenCalledTimes(2);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('developer failed in consensus iteration 1'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('reviewer failed in consensus iteration 1'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});

describe('AgentTeam #71 executeCompetitive (NEW-1 followup-d parallelization)', () => {
  let team: any;
  let contributions: any[];
  let startTime: number;

  beforeEach(() => {
    mockLog.warn.mockClear();
    mockLog.info.mockClear();
    mockLog.error.mockClear();
    team = makeTeam();
    contributions = [];
    startTime = Date.now();
  });

  const baseTask = { task: 'Competitive test', successCriteria: ['Quality'] } as any;

  it('(a) competitive-mode survivors in contributions[]', async () => {
    (team as any).runLLM = vi.fn(async ({ role, message }: any) => {
      // The judge call uses role=reviewer + a "Judge these solutions" message — let it succeed.
      if (message && message.includes('Judge these solutions')) {
        return { response: 'judge verdict', filesModified: [] };
      }
      if (role === 'developer') throw new Error('boom');
      return { response: `result-from-${role}`, filesModified: [] };
    });

    await (team as any).executeCompetitive(baseTask, contributions, startTime);

    // contributions[] in executeCompetitive receives THREE kinds of pushes:
    //   - Agent fan-out (per surviving agent): type='claude-code', role=agent-role
    //   - Judge block (L870-875): type='amp', role='reviewer'
    //   - Finalization (L913-918): type='claude-code', role='manager' (always)
    // We separate them by type/role:
    const survivingAgentContributions = contributions.filter(
      (c) => c.role !== 'manager' && c.type !== 'amp',
    );
    const judgeContribution = contributions.find((c) => c.type === 'amp');
    const finalizationContribution = contributions.find((c) => c.role === 'manager');
    expect(survivingAgentContributions.map((c: any) => c.role)).toEqual(['architect', 'reviewer']);
    expect(judgeContribution?.role).toBe('reviewer');
    expect(finalizationContribution?.role).toBe('manager');
  });

  it('(c) judge prompt receives solutions[index] ↔ agent-index correspondence', async () => {
    let capturedJudgePrompt = '';

    (team as any).runLLM = vi.fn(({ role, message }: any) =>
      new Promise((resolve) => {
        if (message && message.includes('Judge these solutions')) {
          capturedJudgePrompt = message;
          resolve({ response: 'judge verdict', filesModified: [] });
          return;
        }
        // reviewer FIRST (10ms), architect (15ms), developer LAST (25ms)
        const delay = role === 'reviewer' ? 10 : role === 'architect' ? 15 : 25;
        setTimeout(() => resolve({ response: `result-from-${role}` }), delay);
      }),
    );

    await (team as any).executeCompetitive(baseTask, contributions, startTime);

    // Despite reviewer completing FIRST, INPUT ORDER is preserved in judge prompt
    expect(capturedJudgePrompt).toContain('Solution 1 (architect)');
    expect(capturedJudgePrompt).toContain('Solution 2 (developer)');
    expect(capturedJudgePrompt).toContain('Solution 3 (reviewer)');
  });

  it('(d) agents kick off in parallel and wallclock ≈ max(delay), not sum', async () => {
    const kickoffTimes: Record<string, number> = {};

    (team as any).runLLM = vi.fn(async ({ role, message }: any) => {
      // Skip the judge for kickoff-time tracking: it runs sequentially after fan-out.
      if (message && message.includes('Judge these solutions')) {
        return { response: 'judge verdict', filesModified: [] };
      }
      if (!(role in kickoffTimes)) {
        kickoffTimes[role] = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { response: 'ok' };
    });

    const beforeMs = Date.now();
    await (team as any).executeCompetitive(baseTask, contributions, beforeMs);
    const elapsed = Date.now() - beforeMs;

    // Wallclock: parallel ~50ms, sequential ~150ms. Bound for setup overhead.
    expect(elapsed).toBeLessThan(120);
    expect(elapsed).toBeGreaterThanOrEqual(45);

    // All 3 agents should kick off within a tight window (parallel fan-out)
    const startSpread =
      Math.max(
        kickoffTimes.architect,
        kickoffTimes.developer,
        kickoffTimes.reviewer,
      ) -
      Math.min(
        kickoffTimes.architect,
        kickoffTimes.developer,
        kickoffTimes.reviewer,
      );
    expect(startSpread).toBeLessThan(30);
  });

  it('(e) logger.warn called once per failed agent with { error } context object', async () => {
    (team as any).runLLM = vi.fn(async ({ role, message }: any) => {
      // Judge response includes parseable scores per L887-L890 regex so the
      // L910 "No scores found" warn doesn't fire (would inflate the count).
      if (message && message.includes('Judge these solutions')) {
        return {
          response:
            'Solution 1: 90/100. Solution 2: 85/100. Solution 3: 80/100. Best is Solution 1.',
          filesModified: [],
        };
      }
      if (role === 'developer') throw new Error('developer boom in competitive');
      if (role === 'reviewer') throw new Error('reviewer boom in competitive');
      return { response: 'ok' };
    });

    await (team as any).executeCompetitive(baseTask, contributions, startTime);

    // 2 per-agent fan-out failures (developer + reviewer); 0 from L910 because
    // judge response carries parseable scores; 0 from L816 since competitive-mode.
    expect(mockLog.warn).toHaveBeenCalledTimes(2);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('developer failed in competitive strategy'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('reviewer failed in competitive strategy'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});
