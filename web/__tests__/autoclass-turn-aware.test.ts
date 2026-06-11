/**
 * Regression tests for the turn-aware AutoMode classifier.
 *
 * Bug #9 / #32: the prior classifier demoted every request to v1-api with
 * reason `not_agentic_enough` whenever the raw user task was short, even when
 * the conversation carried rich tooling (18+ tools), a code/error/tool-result
 * context, or a [STEER]/[INCOMPLETE-RESPONSE-FEEDBACK] injection. The
 * perceived failure was that v2-api was never invoked; a 55-character
 * follow-up after a code-fence exchange landed on the less-resilient v1-api
 * path every time.
 *
 * The fix:
 *   1. Adds contextual signals (hasCodeContext, hasErrorContext,
 *      hasToolResultContext, hasReprompt) derived from conversationHistory.
 *   2. Adds a `toolingRichness` score in [0, 1] from the tool set.
 *   3. Escalates to v1-agent-loop when either (a) raw agentic verbs are
 *      present, (b) contextual grounding + rich tooling, or (c) rich tooling
 *      + any agentic verb.
 *   4. Stops permanently demoting follow-ups with short rawLength when the
 *      rest of the turn is well-grounded.
 */

import { describe, it, expect } from 'vitest';
import { classifyV1Route, type UnifiedAgentConfig } from '@/lib/orchestra/unified-agent-service';

const tool = (name: string) => ({ name, description: name, parameters: {} });

const cfg = (overrides: Partial<UnifiedAgentConfig>): UnifiedAgentConfig => ({
  userMessage: '',
  ...overrides,
});

const RICH_TOOL_NAMES = [
  'bash', 'edit_file', 'read_file', 'list_files', 'apply_diff', 'write_file',
  'str_replace', 'grep_code', 'search_files', 'list_directory', 'batch_write',
  'mkdir', 'delete_file', 'web_search', 'web_fetch', 'choose_role', 'mcp_tool',
  'glob',
];

const buildRichToolset = (n = 18): Array<{ name: string; description: string; parameters: {} }> =>
  RICH_TOOL_NAMES.slice(0, Math.min(n, RICH_TOOL_NAMES.length)).map(tool);

describe('classifyV1Route — turn-aware contextual signals (Bug #9, #32)', () => {
  // ── Regression for the original "always v1-api" failure ────────────────
  it('routes a 55-char follow-up with rich tooling + code context to v1-agent-loop', () => {
    // Simulate a chat that already has a code-fence exchange.
    const augmented = [
      '```ts\nexport function add(a: number, b: number) { return a + b; }\n```',
      'thanks. now also do that for multiplication',
    ].join('\n\nTASK:\n');

    const d = classifyV1Route(
      cfg({ userMessage: augmented, tools: buildRichToolset(18) }),
    );

    // Must NOT be demoted to v1-api with `not_agentic_enough` anymore.
    expect(d.mode).toBe('v1-agent-loop');
    expect(d.reason).not.toBe('not_agentic_enough');

    // Sanity: the signals bag carries the new fields.
    expect(d.signals).toMatchObject({
      hasCodeContext: true,
      toolingRichness: 1.0,
    });
  });

  it('escalates a follow-up with hasErrorContext + rich tooling to v1-agent-loop', () => {
    const augmented = [
      '[user] I am seeing TypeError: x is not a function in src/foo.ts',
      '[assistant] Looking at the trace…',
      '[STEER] please apply the fix',
    ].join('\n');

    const d = classifyV1Route(
      cfg({ userMessage: augmented, tools: buildRichToolset(18) }),
    );

    expect(d.mode).toBe('v1-agent-loop');
    expect(d.signals.hasErrorContext).toBe(true);
    expect(d.signals.hasReprompt).toBe(true);
  });

  it('escalates a follow-up with hasToolResultContext + rich tooling to v1-agent-loop', () => {
    const history = [
      { role: 'tool', content: '{"bash_execute":{"success":true,"output":"3 files listed"}}' },
      { role: 'user', content: 'rename that one' },
    ];

    const d = classifyV1Route(
      cfg({ userMessage: 'rename that one', conversationHistory: history, tools: buildRichToolset(18) }),
    );

    expect(d.mode).toBe('v1-agent-loop');
    expect(d.signals.hasToolResultContext).toBe(true);
  });

  // ── Preserved legacy behavior (no regression in the other direction) ────
  it('still routes a long mutation+file-path message to v1-agent-loop', () => {
    const d = classifyV1Route(
      cfg({
        userMessage:
          'Update src/server/index.ts to add a /health route that returns { ok: true } when called with GET',
        tools: buildRichToolset(18),
      }),
    );
    expect(d.mode).toBe('v1-agent-loop');
    expect(d.reason).toBe('agentic_task_with_tools');
  });

  it('still keeps a short chat turn with no tools / no context on v1-api', () => {
    const d = classifyV1Route(cfg({ userMessage: 'hi there, how are you?' }));
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('no_external_tools');
  });

  it('still keeps a short chat turn with minimal tools on v1-api (no escalation)', () => {
    const d = classifyV1Route(
      cfg({ userMessage: 'thanks!', tools: [tool('bash')] }),
    );
    // Single tool + chat-only message + no contextual grounding → stay v1-api.
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('not_agentic_enough');
  });

  it('routes empty task to v1-api (preserved)', () => {
    const d = classifyV1Route(cfg({ userMessage: '', tools: buildRichToolset(18) }));
    expect(d.mode).toBe('v1-api');
    expect(d.reason).toBe('empty_task');
  });

  // ── Signal derivation edge cases ────────────────────────────────────────
  it('treats no conversation history as no contextual signals', () => {
    const d = classifyV1Route(
      cfg({ userMessage: 'rename src/foo.ts to src/bar.ts', tools: buildRichToolset(18) }),
    );
    expect(d.signals.hasCodeContext).toBe(false);
    expect(d.signals.hasErrorContext).toBe(false);
    expect(d.signals.hasToolResultContext).toBe(false);
    expect(d.signals.hasReprompt).toBe(false);
  });

  it('detects [INCOMPLETE-RESPONSE-FEEDBACK] and [STEER] markers as hasReprompt', () => {
    const d = classifyV1Route(
      cfg({
        userMessage: '[INCOMPLETE-RESPONSE-FEEDBACK] continue',
        tools: buildRichToolset(18),
      }),
    );
    expect(d.signals.hasReprompt).toBe(true);
  });

  it('routes a real self-heal reprompt injection to v1-agent-loop (locks the positive case)', () => {
    // Simulates the actual run.log path: a [INCOMPLETE-RESPONSE-FEEDBACK]
    // injection followed by a short user "yes, retry" follow-up.
    const d = classifyV1Route(
      cfg({
        userMessage: 'yes, retry',
        conversationHistory: [
          { role: 'assistant', content: '[INCOMPLETE-RESPONSE-FEEDBACK] the previous response was truncated; please continue' },
        ],
        tools: buildRichToolset(18),
      }),
    );
    expect(d.signals.hasReprompt).toBe(true);
    expect(d.mode).toBe('v1-agent-loop');
    expect(d.reason).toBe('contextual_followup_with_rich_tooling');
  });

  it('does NOT false-positive on prose like "do NOT retry" or "try a different approach"', () => {
    // These phrases appear in normal English; the strict reprompt detector
    // must ignore them. The context is too thin (no tool history) to
    // escalate anyway, but the signal must remain false.
    const d = classifyV1Route(
      cfg({
        userMessage: 'do NOT retry the install — that approach failed',
        tools: buildRichToolset(18),
      }),
    );
    expect(d.signals.hasReprompt).toBe(false);
  });

  it('does NOT false-positive on prose mentioning "class" without a fenced code block', () => {
    // Regression for the overly-broad hasCodeContext regex — the word "class"
    // in a chat sentence must not trigger hasCodeContext.
    const d = classifyV1Route(
      cfg({
        userMessage: 'I have a class today, do you want to talk about it?',
        tools: buildRichToolset(18),
      }),
    );
    expect(d.signals.hasCodeContext).toBe(false);
  });

  // ── Tooling richness tier checks ───────────────────────────────────────
  it('classifies 0 tools as toolingRichness 0', () => {
    const d = classifyV1Route(cfg({ userMessage: 'rename that file' }));
    expect(d.signals.toolingRichness).toBe(0);
  });

  it('classifies a single read tool as low richness (~0.4)', () => {
    const d = classifyV1Route(
      cfg({ userMessage: 'rename that file', tools: [tool('read_file')] }),
    );
    expect(d.signals.toolingRichness).toBeGreaterThanOrEqual(0.3);
    expect(d.signals.toolingRichness).toBeLessThanOrEqual(0.5);
  });

  it('classifies 4+ tools with mixed read+write as >= 0.7', () => {
    const d = classifyV1Route(
      cfg({
        userMessage: 'rename that file',
        tools: [
          tool('read_file'),
          tool('list_files'),
          tool('edit_file'),
          tool('write_file'),
        ],
      }),
    );
    expect(d.signals.toolingRichness).toBeGreaterThanOrEqual(0.7);
  });

  it('classifies 10+ tools with mixed read+write as 1.0', () => {
    const d = classifyV1Route(
      cfg({ userMessage: 'rename that file', tools: buildRichToolset(15) }),
    );
    expect(d.signals.toolingRichness).toBe(1);
  });

  // ── The headline scenario from the run.log: not_agentic_enough spam ───
  it('NEVER produces reason "not_agentic_enough" when toolingRichness >= 0.6 AND a reprompt/code/error context is present', () => {
    const d = classifyV1Route(
      cfg({
        userMessage: 'yes, do that',
        conversationHistory: [
          { role: 'assistant', content: '```ts\nconst x = 1;\n```' },
          { role: 'user', content: '[STEER] continue' },
        ],
        tools: buildRichToolset(18),
      }),
    );

    // This was the entire run.log bug — the reason was `not_agentic_enough`
    // 100% of the time. After the fix it must route to v1-agent-loop.
    expect(d.reason).not.toBe('not_agentic_enough');
    expect(d.mode).toBe('v1-agent-loop');
  });
});
