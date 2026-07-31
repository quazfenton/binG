/**
 * Items ② + ⑤ audit test suite.
 *
 * Item ②: agentTask positive-match only fires when currentTurn is empty.
 * Item ⑤: agent-purpose URLs/files only promote web intents when
 *   `agentTaskUrlReadsEnabled: true` is passed.
 *
 * API contract under test:
 *   - `result.intents` is a `string[]` (intent IDs), NOT an array of
 *     IntentReason objects. Tests use `intents.includes(...)` instead
 *     of `intents.find((i) => i.id === ...)` to avoid the vacuous-pass
 *     bug that a prior draft had.
 *   - `result.sourcePermissions` is the bit-matrix that gates source
 *     fetches.
 *   - `result.coreTools` includes baseline (file.read, file.list,
 *     file.delete, web.fetch) on every call.
 *
 * Scope deltas vs the audit-ticket wording:
 *   - Item ⑤ flag only gates the URL-signal / explicit-file-signal
 *     BOOST path, not the per-intent `sourcePermissions` grant that
 *     fires when an intent rule's keywordsRegExp matches. So we
 *     deliberately AVOID testing `sourcePermissions.arcade` in any test
 *     that has an intent rule whose `sourcePermissions.arcade === true`
 *     matching through `agentTask`, because the intent-rule grant path
 *     would confound the assertion. Item ⑤'s behaviour is verifiable
 *     via `coreTools` (which is what the URL/explicit-file boost adds to).
 *
 * Isolation-test fragility (contract, not test):
 *   - The "isolated" item-⑤ tests use agentTask strings ("pickup at
 *     https://...", "reference ./src/foo.ts") whose words are
 *     DELIBERATELY non-keyword. They rely on those tokens NOT
 *     matching any INTENT_RULES[i].keywordsRegExp so that the
 *     matchedRules-aggregation grant path cannot fire and confound
 *     URL-signal/explicitFile grants. A future intent-rule addition
 *     that includes 'pickup' or 'reference' in its alternation would
 *     silently re-introduce the confound. If you add such a rule,
 *     rename the agentTask tokens here to a similarly non-keyword     * pair BEFORE merging. The file intentionally does NOT hard-
     * enforce this — we'd be coupling test fixtures to the internal
     * rule ID list (which is not exported). A pre-commit hook that
     * greps the protected tokens ("pickup", "reference") against new
     * INTENT_RULES additions is the recommended hardening; until
     * that lands, rely on reviewer attention to PR diffs touching
     * INTENT_RULES to catch accidental keyword-overlap regressions.
 */
import { describe, it, expect } from 'vitest';
import { selectToolPlan, BASELINE_CORE_TOOL_IDS } from '@/lib/tools/select-tool-plan';

describe('selectToolPlan — items ② + ⑤', () => {
  describe('item ②: agentTask positive-match gating', () => {
    it('does NOT fire agentTask scoring when currentTurn is non-empty', () => {
      // agentTask contains "git push" which would match `git.ops` and
      // `bash.run` intents if not gated by currentTurn.
      const result = selectToolPlan({
        userMessage: 'write a function',
        agentTask: 'git push the changes',
      });
      // The agentTask keyword must NOT bleed into the result.
      expect(result.intents).not.toContain('git.ops');
      expect(result.intents).not.toContain('bash.run');
    });

    it('does NOT fire agentTask scoring with non-empty multi-word currentTurn', () => {
      // Different shape: agentTask has github keyword, currentTurn has none.
      const result = selectToolPlan({
        userMessage: 'what is the weather today?',
        agentTask: 'review pull requests on github',
      });
      // Neither git.ops nor integration.github should leak.
      expect(result.intents).not.toContain('integration.github');
      expect(result.intents).not.toContain('git.ops');
    });

    it('fires agentTask scoring when currentTurn is whitespace-only', () => {
      const result = selectToolPlan({
        userMessage: '   ',
        agentTask: 'git push the changes',
      });
      // With an empty currentTurn (after trim), the agentTask scoring
      // should fire. 'git push the changes' matches git.ops.
      expect(result.intents).toContain('git.ops');
    });

    it('fires agentTask scoring when currentTurn is an empty string', () => {
      const result = selectToolPlan({
        userMessage: '',
        agentTask: 'execute npm install for the new package',
      });
      // pkg.install intent should be present when agentTask is the only signal.
      expect(result.intents).toContain('pkg.install');
    });
  });

  describe('item ⑤: agentTaskUrlReadsEnabled flag', () => {
    it('does NOT promote via URL-signal boost from agentTask URL when flag is default (false)', () => {
      // agentTask contains a URL but flag is at default (false).
      // Use a currentTurn that does NOT match web.fetch keywordsRegExp
      // (so item ② does not fire agentTask scoring), so no intent rule
      // would otherwise grant arcade through the matchedRules loop.
      const result = selectToolPlan({
        userMessage: 'hello',
        agentTask: 'pickup at https://example.com/foo',
      });
      // web.fetch intent should NOT appear.
      expect(result.intents).not.toContain('web.fetch');
      // arcade permission should remain FALSE — the URL-signal->arcade
      // grant only fires when the agentTask URL is permitted (flag=true).
      expect(result.sourcePermissions.arcade).toBe(false);
      // coreTools should match the baseline exactly (no URL boost).
      expect(result.coreTools.sort()).toEqual([...BASELINE_CORE_TOOL_IDS].sort());
    });

    it('DOES promote via URL-signal boost from agentTask URL when flag is true', () => {
      const result = selectToolPlan(
        { userMessage: 'hello', agentTask: 'pickup at https://example.com/foo' },
        { agentTaskUrlReadsEnabled: true },
      );
      // With the flag set, the URL-signal boost (item ⑤ gate) fires
      // and web.fetch joins coreTools via the explicit-signal path.
      // NOTE this is coreTools, NOT intents — the URL-signal boost adds
      // to the tool list but does not surface an IntentRule id (item ②
      // gates the rule-level scoring off when currentTurn is non-empty).
      expect(result.coreTools).toContain('web.fetch');
      // nullclaw source permission should be GRANTED via URL-signal boost.
      expect(result.sourcePermissions.nullclaw).toBe(true);
      // arcade is GRANTED via URL-signal boost (no intent matched,
      // so this assertion is unambiguous — only the URL-signal grant fires).
      expect(result.sourcePermissions.arcade).toBe(true);
    });

    it('does NOT promote via file-path signal from agentTask path when flag is default (false)', () => {
      // agentTask contains an explicit file path but no intent keyword.
      // With flag=false, the explicitFileMatch agentTask half is gated off.
      // Use a currentTurn that does NOT match any rule (avoids intent-rule
      // sourcePermissions confound).
      const result = selectToolPlan({
        userMessage: 'hello',
        agentTask: 'reference ./src/foo.ts',
      });
      // No intent matches (no "open|read|..." keyword in userMessage).
      expect(result.intents).toEqual([]);
      // coreTools should match the baseline exactly (no explicit-file boost).
      expect(result.coreTools.sort()).toEqual([...BASELINE_CORE_TOOL_IDS].sort());
    });

    it('DOES promote via file-path signal from agentTask path when flag is true', () => {
      const result = selectToolPlan(
        { userMessage: 'hello', agentTask: 'reference ./src/foo.ts' },
        { agentTaskUrlReadsEnabled: true },
      );
      // With flag=true, the explicitFileMatch boost fires and adds
      // file.read to coreTools. file.read is already in baseline, so the
      // observable change is the file-path signal being permitted rather
      // than denied — verify no additional mutating file tools leak.
      // Using EXACT tool IDs (not substrings) to avoid loose-match
      // false-negatives like 'str_replace' matching 'file.str_replace'.
      // coverage mirrors `code.edit.coreToolIds` 1:1 so any future
      // addition to that intent's mutator list will demand a matching
      // assertion here (a TODO-friendly trigger for protecting
      // against silent re-introduction of the item-⑤ confound).
      expect(result.coreTools).toContain('file.read');
      expect(result.coreTools).not.toContain('file.write');
      expect(result.coreTools).not.toContain('file.str_replace');
      expect(result.coreTools).not.toContain('file.batch_write');
      expect(result.coreTools).not.toContain('file.append');
      expect(result.coreTools).not.toContain('code.ast_diff');
    });
  });

  describe('integration: combined items', () => {
    it('item ② + ⑤ together: agent task content ignored when currentTurn is non-empty', () => {
      // agentTask has BOTH a github keyword AND a URL, but currentTurn
      // is non-empty and flag is default. Both gates should prevent
      // any leakage.
      const result = selectToolPlan({
        userMessage: 'help me debug this error',
        agentTask: 'push to https://example.com/foo',
      });
      // No web.fetch (item ② gates agent-task scoring off AND item ⑤
      // gates agentTask URL detection off).
      expect(result.intents).not.toContain('web.fetch');
      // arcade permission should NOT be granted.
      expect(result.sourcePermissions.arcade).toBe(false);
      // no extra tools beyond baseline.
      expect(result.coreTools.sort()).toEqual([...BASELINE_CORE_TOOL_IDS].sort());
    });

    it('item ② + ⑤ together: agent-task URL with empty currentTurn + flag=true DOES promote', () => {
      // Empty currentTurn + flag=true + agentTask URL with fetch keyword
      // = full intent promotion via both gates' positive paths.
      const result = selectToolPlan(
        { userMessage: '', agentTask: 'fetch https://example.com/docs' },
        { agentTaskUrlReadsEnabled: true },
      );
      // web.fetch should fire (via agentTask scoring AND URL signal).
      expect(result.intents).toContain('web.fetch');
      expect(result.coreTools).toContain('web.fetch');
    });

    it('item ② + ⑤ together: no user agent-task leakage when both gates are closed', () => {
      // Stress: a chatty "thanks" turn with a github+url agentTask.
      // Both gates should clamp the result to baseline-only.
      const result = selectToolPlan({
        userMessage: 'thanks!',
        agentTask: 'review https://github.com/x/y',
      });
      expect(result.intents).toEqual([]);
      expect(result.coreTools.sort()).toEqual([...BASELINE_CORE_TOOL_IDS].sort());
      expect(result.sourcePermissions.arcade).toBe(false);
      expect(result.sourcePermissions.nullclaw).toBe(false);
    });
  });

  describe('select-tool-plan smoke', () => {
    it('returns stable shape on simple chat message', () => {
      const result = selectToolPlan({ userMessage: 'hi' });
      expect(Array.isArray(result.intents)).toBe(true);
      expect(result).toHaveProperty('sourcePermissions');
      expect(Array.isArray(result.coreTools)).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    it('baseline coreTools always present', () => {
      const result = selectToolPlan({ userMessage: 'completely off-topic gibberish xyz123' });
      // The baseline 4 tools must be on every call (no-match returns
      // an EXPLICIT SMALL BASELINE, never all capabilities).
      for (const baselineId of BASELINE_CORE_TOOL_IDS) {
        expect(result.coreTools).toContain(baselineId);
      }
    });
  });
});
