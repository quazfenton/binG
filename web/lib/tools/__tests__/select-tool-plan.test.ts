/**
 * Unit tests for the pure `selectToolPlan` planner.
 *
 * Run: npx vitest run web/lib/tools/__tests__/select-tool-plan.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  selectToolPlan,
  BASELINE_CORE_TOOL_IDS,
  type SelectToolPlanInput,
  type SelectToolPlanResult,
} from '@/lib/tools/select-tool-plan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_HISTORY: SelectToolPlanInput['conversationHistory'] = Object.freeze([]);

function expectBaselineTools(result: SelectToolPlanResult): void {
  for (const id of BASELINE_CORE_TOOL_IDS) {
    expect(result.coreTools, `coreTools missing baseline ${id}`).toContain(id);
  }
}

// ---------------------------------------------------------------------------
// 1. No-match → small explicit baseline, never ALL_CAPABILITIES
// ---------------------------------------------------------------------------

describe('selectToolPlan — no-match baseline', () => {
  it('returns the small baseline core set on a generic greeting', () => {
    const result = selectToolPlan({ userMessage: 'thanks' });
    expect(result.fallbackUsed).toBe(true);
    expect(result.matchCount).toBe(0);
    expectBaselineTools(result);
    // Should NOT include write/edit-only tools that the baseline omits
    expect(result.coreTools).not.toContain('file.write');
    expect(result.coreTools).not.toContain('batch_write');
    expect(result.coreTools).not.toContain('bash.execute');
    expect(result.coreTools).not.toContain('web.search');
  });

  it('returns the small baseline for an empty user message', () => {
    const result = selectToolPlan({ userMessage: '' });
    expect(result.fallbackUsed).toBe(true);
    expect(result.intents).toEqual([]);
    expectBaselineTools(result);
  });

  it('keeps baseline when the only signal is whitespace', () => {
    const result = selectToolPlan({ userMessage: '   \n  ' });
    expect(result.fallbackUsed).toBe(true);
    expectBaselineTools(result);
  });

  it('never returns files for an unrelated prompt', () => {
    const result = selectToolPlan({ userMessage: 'tell me a joke' });
    expect(result.fallbackUsed).toBe(true);
    expectBaselineTools(result);
    expect(result.candidateToolIds.length).toBeLessThanOrEqual(BASELINE_CORE_TOOL_IDS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Positive-evidence — code read / edit / search
// ---------------------------------------------------------------------------

describe('selectToolPlan — code work', () => {
  it('matches code.read when user says "show me src/app.tsx"', () => {
    const result = selectToolPlan({ userMessage: 'show me src/app.tsx' });
    expect(result.intents).toContain('code.read');
    expect(result.coreTools).toContain('file.read');
    expect(result.coreTools).toContain('repo.search');
    expect(result.fallbackUsed).toBe(false);
  });

  it('matches code.edit on "edit login.tsx to add error handling"', () => {
    const result = selectToolPlan({
      userMessage: 'edit login.tsx to add error handling',
    });
    expect(result.intents).toContain('code.edit');
    expect(result.coreTools).toContain('file.write');
    expect(result.coreTools).toContain('file.str_replace');
  });

  it('matches pkg.install on "pnpm add zod"', () => {
    const result = selectToolPlan({ userMessage: 'pnpm add zod' });
    expect(result.intents).toContain('pkg.install');
    expect(result.coreTools).toContain('bash.execute');
  });

  it('matches build.test on "npm run test"', () => {
    const result = selectToolPlan({ userMessage: 'npm run test' });
    expect(result.intents).toContain('build.test');
    expect(result.coreTools).toContain('bash.execute');
  });

  it('matches git.ops on "commit my changes and push"', () => {
    const result = selectToolPlan({ userMessage: 'commit my changes and push to main' });
    expect(result.intents).toContain('git.ops');
    expect(result.coreTools).toContain('bash.execute');
    expect(result.coreTools).toContain('repo.git');
  });

  it('matches container.ops on "docker compose up"', () => {
    const result = selectToolPlan({ userMessage: 'docker compose up' });
    expect(result.intents).toContain('container.ops');
    expect(result.coreTools).toContain('sandbox.session');
  });
});

// ---------------------------------------------------------------------------
// 3. Web fetch / search + URL signal
// ---------------------------------------------------------------------------

describe('selectToolPlan — web', () => {
  it('matches web.fetch on a plain URL message', () => {
    const result = selectToolPlan({
      userMessage: "what's at https://example.com/post",
    });
    expect(result.intents).toContain('web.fetch');
    expect(result.coreTools).toContain('web.fetch');
    expect(result.coreTools).toContain('web.browse');
  });

  it('matches web.fetch on "fetch the contents of https://example.com/x"', () => {
    const result = selectToolPlan({
      userMessage: 'fetch the contents of https://example.com/x',
    });
    expect(result.intents).toContain('web.fetch');
    expect(result.coreTools).toContain('web.fetch');
  });

  it('matches web.search on "search the web for best tsdb in 2026"', () => {
    const result = selectToolPlan({
      userMessage: 'search the web for best tsdb in 2026',
    });
    expect(result.intents).toContain('web.search');
    expect(result.coreTools).toContain('web.search');
    expect(result.coreTools).toContain('web.fetch');
  });

  it('"do not browse" + URL suppresses web.fetch intent (negative wins over URL)', () => {
    // "do not browse" hits web.fetch's negative regex → score → 0 and
    // the URL boost is gated on `!webFetchNegated`, so the user's
    // explicit opt-out takes precedence. The intent is not promoted;
    // web.browse (NOT in baseline) does not enter coreTools.
    // web.fetch itself stays in the baseline so the LLM always has a
    // controlled fallback for unexpected URL requests.
    const result = selectToolPlan({
      userMessage:
        'please fetch me the contents of https://example.com/docs but do not browse the rest of the site',
    });
    expect(result.intents).not.toContain('web.fetch');
    expect(result.coreTools).not.toContain('web.browse');
  });

  it('explicit "do not browse" suppresses web.fetch even if URL is present', () => {
    // The negation text is unambiguous — score for web.fetch → 0.
    const result = selectToolPlan({
      userMessage: "don't browse https://example.com — I just want to chat",
    });
    expect(result.intents).not.toContain('web.fetch');
    // Some intents may still match (chat.greeting etc.) but fallbackUsed
    // may be false if score>0 on another intent; the key contract is
    // web.fetch is NOT included.
  });

  it('matches web.fetch when message contains bare URL', () => {
    const result = selectToolPlan({
      userMessage: 'https://example.com',
    });
    // Bare URL is a positive signal — web.fetch MUST appear in coreTools.
    expect(result.coreTools).toContain('web.fetch');
  });
});

// ---------------------------------------------------------------------------
// 4. Negative evidence — explain only / don't change
// ---------------------------------------------------------------------------

describe('selectToolPlan — negative evidence', () => {
  it('explain-only request still gets file.read but not file.write', () => {
    const result = selectToolPlan({
      userMessage: 'explain what happens in src/server.ts without changing anything',
    });
    expect(result.intents).toContain('meta.explain');
    expect(result.coreTools).toContain('file.read');
    // No write/edit intent should be returned.
    expect(result.intents).not.toContain('code.edit');
    expect(result.intents).not.toContain('code.read');
  });

  it('matches code.edit AND respects "do not modify" — code.edit excluded', () => {
    const result = selectToolPlan({
      userMessage: 'please do not modify this file but explain it',
    });
    // "do not modify" matches code.edit's negative regex → score → 0.
    expect(result.intents).not.toContain('code.edit');
  });

  it('"no changes" suppresses code.edit baselines', () => {
    const result = selectToolPlan({
      userMessage: 'audit auth/login.tsx — no changes please',
    });
    expect(result.intents).not.toContain('code.edit');
  });
});

// ---------------------------------------------------------------------------
// 5. Integration / auth-gated
// ---------------------------------------------------------------------------

describe('selectToolPlan — integrations and auth gating', () => {
  it('matches integration.gmail and requests gmail toolkit', () => {
    const result = selectToolPlan({
      userMessage: 'send an email to hello@example.com via gmail',
      authenticated: true,
    });
    expect(result.intents).toContain('integration.gmail');
    expect(result.requestedToolkits).toContain('gmail');
    expect(result.sourcePermissions.composio).toBe(true);
  });

  it('suppresses integration.gmail for anonymous users', () => {
    const result = selectToolPlan({
      userMessage: 'send an email to hello@example.com via gmail',
      authenticated: false,
    });
    expect(result.intents).not.toContain('integration.gmail');
    expect(result.requestedToolkits).not.toContain('gmail');
    // Composio permission should be off for unauthenticated users.
    expect(result.sourcePermissions.composio).toBe(false);
  });

  it('matches integration.slack and requests slack toolkit', () => {
    const result = selectToolPlan({
      userMessage: 'post this build status to slack',
      authenticated: true,
    });
    expect(result.intents).toContain('integration.slack');
    expect(result.requestedToolkits).toContain('slack');
  });

  it('matches integration.github and requests github toolkit', () => {
    const result = selectToolPlan({
      userMessage: 'open a github pull request with these changes',
      authenticated: true,
    });
    expect(result.intents).toContain('integration.github');
    expect(result.requestedToolkits).toContain('github');
  });
});

// ---------------------------------------------------------------------------
// 6. Attached files + file-path signals
// ---------------------------------------------------------------------------

describe('selectToolPlan — explicit file signals', () => {
  it('attached file forces file.read to be in coreTools', () => {
    // "explain this" alone matches `meta.explain` (which contributes
    // file.read). The explicit-path boost is redundant here, but the
    // contract is "file.read is always available when files are in play".
    const result = selectToolPlan({
      userMessage: 'explain this',
      attachedFiles: ['src/auth/session.ts'],
    });
    expect(result.coreTools).toContain('file.read');
    expect(result.intents).toContain('meta.explain');
  });

  it('inline file-path mention matches code.read intent', () => {
    const result = selectToolPlan({
      userMessage: 'show me src/utils/strings.ts',
      attachedFiles: ['src/utils/strings.ts'],
    });
    expect(result.intents).toContain('code.read');
    expect(result.coreTools).toContain('file.read');
  });

  it('inline file-path mention with editing verb matches code.edit', () => {
    const result = selectToolPlan({
      userMessage: 'rename src/utils/strings.ts',
      attachedFiles: ['src/utils/strings.ts'],
    });
    expect(result.intents).toContain('code.edit');
    expect(result.coreTools).toContain('file.write');
  });
});

// ---------------------------------------------------------------------------
// 7. Filesystem-edit eligibility gate
// ---------------------------------------------------------------------------

describe('selectToolPlan — filesystem edit eligibility', () => {
  it('disallowed edits drop write tools from coreTools', () => {
    const result = selectToolPlan({
      userMessage: 'edit src/server.ts',
      filesystemEditEligible: false,
    });
    expect(result.coreTools).not.toContain('file.write');
    expect(result.coreTools).not.toContain('file.str_replace');
    expect(result.coreTools).not.toContain('file.batch_write');
    expect(result.coreTools).not.toContain('file.append');
    // Read-only operations still present
    expect(result.coreTools).toContain('file.read');
    expect(result.coreTools).toContain('file.list');
  });

  it('allowed edits keep write tools', () => {
    const result = selectToolPlan({
      userMessage: 'edit src/server.ts',
      filesystemEditEligible: true,
    });
    expect(result.coreTools).toContain('file.write');
    expect(result.coreTools).toContain('file.str_replace');
  });
});

// ---------------------------------------------------------------------------
// 8. Configured sources
// ---------------------------------------------------------------------------

describe('selectToolPlan — configured source permissions', () => {
  it('configured nullclaw enables nullclaw permission on a bash intent', () => {
    const result = selectToolPlan({
      userMessage: 'bash: ls -la',
      configuredSources: { nullclaw: true },
    });
    expect(result.sourcePermissions.nullclaw).toBe(true);
  });

  it('configured mem0 enables mem0 on memory.recall', () => {
    const result = selectToolPlan({
      userMessage: 'do you remember my last request',
      configuredSources: { mem0: true },
    });
    expect(result.intents).toContain('memory.recall');
    expect(result.sourcePermissions.mem0).toBe(true);
  });

  it('composio is gated off for unauthenticated users even when configured', () => {
    const result = selectToolPlan({
      userMessage: 'send a slack message',
      authenticated: false,
      configuredSources: { composio: true },
    });
    expect(result.sourcePermissions.composio).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Determinism + ordering
// ---------------------------------------------------------------------------

describe('selectToolPlan — determinism', () => {
  it('two equivalent inputs return equivalent results', () => {
    const input: SelectToolPlanInput = {
      userMessage: 'edit src/auth.ts to fix the bug',
      conversationHistory: EMPTY_HISTORY,
      authenticated: false,
    };
    const a = selectToolPlan(input);
    const b = selectToolPlan(input);
    expect(a).toEqual(b);
    expect(a.coreTools).toEqual(b.coreTools);
    expect(a.candidateToolIds).toEqual(b.candidateToolIds);
  });

  it('coreTools list is sorted ascending for determinism', () => {
    const result = selectToolPlan({
      userMessage: 'edit src/a.ts then fetch https://example.com',
    });
    const sorted = [...result.coreTools].sort();
    expect(result.coreTools).toEqual(sorted);
  });

  it('budget cap is honored — custom maxBudget', () => {
    const result = selectToolPlan(
      { userMessage: 'edit src/a.ts' },
      { maxBudget: 4 },
    );
    expect(result.maxBudget).toBe(4);
  });

  it('default budget is 20', () => {
    const result = selectToolPlan({ userMessage: 'thanks' });
    expect(result.maxBudget).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 10. Conversation history
// ---------------------------------------------------------------------------

describe('selectToolPlan — conversation history weighting', () => {
  it('current-turn explicit signal outranks history-only matches', () => {
    // Current turn signals both chat.greeting (low weight) and an
    // unknown random token. History signals code.edit (high weight but
    // discounted). The planner returns both intents, sorted by score.
    const result = selectToolPlan({
      userMessage: 'edit src/foo.ts to fix typo',
      conversationHistory: [
        { role: 'user', content: 'docker compose up' },
      ],
    });
    expect(result.intents).toContain('code.edit');
    // code.edit (current turn, full weight 12) outranks any history match.
    expect(result.intents[0]).toBe('code.edit');
  });

  it('history with high-weight matches contributes when current turn lacks competing tools', () => {
    // Documenting the design: history CAN promote an intent even when
    // the current turn is generic. The discount (0.4×weight) keeps it
    // reasonable, but a strong history matches (e.g. two consecutive
    // 'edit src/...' messages) will surface even if the user just said
    // 'hmm'. This is the weighted (not zeroed) contract.
    const result = selectToolPlan({
      userMessage: 'hmm',
      conversationHistory: [
        { role: 'user', content: 'edit src/a.ts' },
        { role: 'user', content: 'edit src/b.ts' },
      ],
    });
    expect(result.intents).toContain('code.edit');
    expect(result.intents[0]).toBe('code.edit');
  });

  it('history with undefined / empty content does not crash', () => {
    // History entries whose `content` is empty or non-string are
    // filtered out by `extractHistoryTexts`. The point of this test
    // is that adversarial history payloads do not blow up the planner.
    expect(() => {
      const result = selectToolPlan({
        userMessage: 'thanks',
        conversationHistory: [
          { role: 'user' as const, content: '' },
          // Non-string content (typed as string but value undefined at
          // runtime) is filtered out without throwing.
          { role: 'assistant' as const, content: undefined as unknown as string },
        ],
      });
      expect(result).toBeDefined();
      // 'thanks' (intentionally generic) maps to baseline-only.
      expect(result.fallbackUsed).toBe(true);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 11. Reasons telemetry
// ---------------------------------------------------------------------------

describe('selectToolPlan — telemetry reasons', () => {
  it('includes reasons for matched intents', () => {
    const result = selectToolPlan({
      userMessage: 'edit src/auth.ts',
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    const editReason = result.reasons.find((r) => r.intent === 'code.edit');
    expect(editReason).toBeDefined();
    expect(editReason!.score).toBeGreaterThan(0);
  });

  it('records negated signals when "do not modify" matches', () => {
    const result = selectToolPlan({
      userMessage: 'do not modify src/auth.ts',
    });
    const edit = result.reasons.find((r) => r.intent === 'code.edit');
    // If the negative suppressed the intent, the score should be 0.
    if (edit) {
      expect(edit.score).toBe(0);
      expect(edit.negatedSignals.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. URL signal alone — explicit URL boost
// ---------------------------------------------------------------------------

describe('selectToolPlan — explicit URL signal', () => {
  it('bare URL adds web.fetch regardless of intent regex match', () => {
    const input: SelectToolPlanInput = {
      userMessage: 'see https://example.com/path',
    };
    const result = selectToolPlan(input);
    expect(result.coreTools).toContain('web.fetch');
  });

  it('URL with quoted markdown link', () => {
    const result = selectToolPlan({
      userMessage: '[bing docs](https://example.com/docs)',
    });
    expect(result.coreTools).toContain('web.fetch');
  });
});

// ---------------------------------------------------------------------------
// 13. No-match returns exported baseline (regression for the "all capabilities"
// bug in old filterCapabilitiesByTask)
// ---------------------------------------------------------------------------

describe('selectToolPlan — baseline export contract', () => {
  it('BASELINE_CORE_TOOL_IDS is small and explicit', () => {
    expect(BASELINE_CORE_TOOL_IDS.length).toBeLessThan(10);
    expect(BASELINE_CORE_TOOL_IDS.length).toBeGreaterThan(0);
    expect(BASELINE_CORE_TOOL_IDS).toContain('file.read');
    expect(BASELINE_CORE_TOOL_IDS).toContain('web.fetch');
  });

  it('no-match output candidateToolIds length matches baseline size', () => {
    const result = selectToolPlan({ userMessage: 'hello' });
    expect(result.candidateToolIds.length).toBe(BASELINE_CORE_TOOL_IDS.length);
  });
});

// ---------------------------------------------------------------------------
// 14. Negative + hostile input
// ---------------------------------------------------------------------------

describe('selectToolPlan — negative evidence regression', () => {
  it('do not browse + URL does not surface web.fetch', () => {
    const result = selectToolPlan({
      userMessage: 'do not browse https://news.example.com today',
    });
    expect(result.intents).not.toContain('web.fetch');
    expect(result.coreTools).not.toContain('web.browse');
  });

  it('do not search + bare search phrasing suppresses web.search', () => {
    const result = selectToolPlan({
      userMessage: 'do not search the web for that',
    });
    expect(result.intents).not.toContain('web.search');
  });

  it('do not run + bash verb suppresses bash.run', () => {
    const result = selectToolPlan({
      userMessage: 'do not run any bash commands here, just read',
    });
    expect(result.intents).not.toContain('bash.run');
  });
});

describe('selectToolPlan — hostile-input regression', () => {
  // Catastrophic-backtracking / regex-DoS guard. Each rule keyword
  // regex must terminate quickly on a pathological input. If the
  // engine ever blows up, this test will time out before asserting.
  it('terminate quickly on a 4KB adversarial input', () => {
    const adversarial = 'fetch '.repeat(800); // ~4KB of repeated verb
    const start = Date.now();
    const result = selectToolPlan({ userMessage: adversarial });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(250);
    expect(result).toBeDefined();
  });
});
