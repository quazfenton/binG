/**
 * AutoContinueBanner — user-facing explanation of auto-continue decisions.
 *
 * Renders a small inline banner above the chat timeline that explains WHY
 * the orchestrator just made an auto-continue decision. The banner is the
 * user-facing counterpart to the upstream `autoDecision.reason` field on
 * `AutoContinueDecision`; without it, a user sees a stream re-prompt
 * itself but has no way to tell whether the trigger was:
 *
 *   - ramble-no-tools   — LLM produced >4KB of text without any tool call
 *                         (advisory amber; nudges the model to act).
 *   - read-then-stall   — last tool was read-only with no writes.
 *   - file_request_detected — LLM asked for a file by name in the response.
 *   - max_continuations_reached / max_iterations — route-layer cap hit
 *                         (terminal red; operator intervention needed).
 *   - failure_plan_loop / loop_abort — circuit-breaker preempts the run.
 *   - resolved / no_continuation_needed — happy-path stop.
 *
 * Declarative (no state, no timers, animations limited to Tailwind hover).
 * Hidden when `reason` is undefined so the chat timeline stays clean for
 * happy-path stops. Mirrors the `tool-call-tracker` and SSE
 * `loop_abort` payload style: no side-effects, fully typed props.
 */

import type { ComponentType } from 'react';
import { FileText, Clock, ShieldAlert, Wand2, AlertTriangle, CheckCircle2 } from 'lucide-react';

export type AutoContinueReasonDisplay =
  | 'ramble-no-tools'
  | 'read-then-stall'
  | 'deep-research-loop'
  | 'file_request_detected'
  | 'file_edits_present'
  | 'continuation_requested'
  | 'incomplete_response'
  | 'mid-sentence-cutoff'
  | 'announced-next-step'
  | 'failure_plan_loop'
  | 'loop_abort'
  | 'max_continuations_reached'
  | 'max_iterations'
  | 'user_stop'
  | 'agent_stop'
  | 'failure-cascade'
  | 'write-verify-loop'
  | 'empty-after-tools'
  | 'unclosed-code-block'
  | string; // forward-compat for new detector buckets added after this banner shipped

export interface AutoContinueBannerProps {
  /**
   * `decision.reason` from the latest `AutoContinueDecision` — the
   * canonical reason literal from `lib/chat/auto-continue-helper.ts`.
   * Undefined → banner hidden (happy-path stop; no heuristic fired).
   */
  reason: AutoContinueReasonDisplay | undefined | null;
  /**
   * Optional count display so the user can see "this was the 2nd of 3
   * automatic continuations." Defaults to undefined → banner shows no
   * counter row.
   */
  continuationsSoFar?: number | undefined;
  /**
   * Optional cap. Defaults to undefined; if provided alongside
   * `continuationsSoFar`, drives the adversarial-cases row
   * ("limit reached").
   */
  maxContinuations?: number | undefined;
  /**
   * Layout consumers inject this (chat panel uses it for sticky
   * positioning; the timeline drawer does not).
   */
  className?: string;
}

type ReasonMeta = {
  title: string;
  body: string;
  // Tailwind utility palette picked by stop semantics:
  //   amber   = advisory nudge, conversation continues
  //   blue    = in-progress, model wanted another turn
  //   red     = terminal cap-hit / circuit-breaker, intervention needed
  //   green   = happy-path
  palette: 'amber' | 'blue' | 'red' | 'green';
  Icon: ComponentType<{ className?: string }>;
};

const REASON_META: Record<string, ReasonMeta> = {
  // ── Ramble heuristic ───────────────────────────────────────────────────
  'ramble-no-tools': {
    title: 'Long response with no action',
    body: 'The model produced a very long response without calling any tools. Auto-continuation nudged it again to take action — read a file, search, or write a change.',
    palette: 'amber',
    Icon: FileText,
  },

  // ── Tool-call-pattern detectors (Factor 1) ─────────────────────────────
  'read-then-stall': {
    title: 'Read without follow-up',
    body: 'The model ended on a read-only tool call with no writes — it learned something but did not act. Auto-continuation nudged it to take the next step.',
    palette: 'amber',
    Icon: Wand2,
  },
  'deep-research-loop': {
    title: 'Search loop detected',
    body: '3+ consecutive read/search tools with no writes — the model is gathering information without acting. Auto-continuation nudged it to STOP reading and DO something.',
    palette: 'amber',
    Icon: Wand2,
  },
  'failure-cascade': {
    title: 'Repeated tool failures',
    body: '2+ tool calls failed in a row. Auto-continuation nudged the model to try a DIFFERENT approach rather than retrying the same failing calls.',
    palette: 'amber',
    Icon: AlertTriangle,
  },
  'write-verify-loop': {
    title: 'Write-then-re-read loop',
    body: 'The model wrote a file and immediately re-read it to verify its own work. Auto-continuation nudged it to summarize and move on.',
    palette: 'amber',
    Icon: Wand2,
  },

  // ── Explicit-continuation signals (Factor 2) ───────────────────────────
  'file_request_detected': {
    title: 'Model asked for a file',
    body: `The model mentioned a file path in its response (e.g. "let me check src/App.tsx"). Auto-continuation injected a context pack with that file before re-prompting.`,
    palette: 'blue',
    Icon: FileText,
  },
  'continuation_requested': {
    title: 'Model asked for another turn',
    body: 'The response ended with [CONTINUE_REQUESTED] — an explicit LLM-to-server signal. Auto-continuation re-prompted to complete the task.',
    palette: 'blue',
    Icon: Clock,
  },
  'incomplete_response': {
    title: 'Response looks incomplete',
    body: 'Truncation markers detected (unclosed code block, mid-sentence cutoff, or similar). Auto-continuation re-prompted to finish what was started.',
    palette: 'blue',
    Icon: Clock,
  },
  'mid-sentence-cutoff': {
    title: 'Response cut off mid-sentence',
    body: 'The model ended without terminal punctuation. Auto-continuation re-prompted to continue from where it left off.',
    palette: 'blue',
    Icon: Clock,
  },
  // Template-literal body avoids the apostrophe escape ambiguity
  // (`I'll` / `I'll`) — inside `...`, neither " nor ' requires escaping,
  // so the wire-format renders exactly the human-readable text.
  'announced-next-step': {
    title: 'Model outlined next steps',
    body: `The response contained phrases like "I'll now ...", "Next I'll ...", or similar plan language. Auto-continuation nudged it to execute rather than re-describe.`,
    palette: 'blue',
    Icon: Clock,
  },

  // ── Terminal cap-hit / circuit-breaker ─────────────────────────────────
  'max_continuations_reached': {
    title: 'Auto-continuation limit reached',
    body: 'The orchestrator hit MAX_CONTINUATIONS (env LLM_MAX_CONTINUATIONS_PER_TURN, default 3). The model is now stopped — manual intervention is needed if the task is incomplete.',
    palette: 'red',
    Icon: ShieldAlert,
  },
  max_iterations: {
    title: 'Iteration limit reached',
    body: 'The wrapper-level hard cap on iterations was hit. The model is stopped.',
    palette: 'red',
    Icon: ShieldAlert,
  },
  'failure_plan_loop': {
    title: 'Chat-loop circuit breaker triggered',
    body: 'After a retry, the model produced plan-language text following a failed tool call — a chat-loop pattern. The circuit breaker preempted the continuation to prevent infinite loops.',
    palette: 'red',
    Icon: ShieldAlert,
  },
  loop_abort: {
    title: 'Loop guard aborted the run',
    body: '3+ consecutive tool failures triggered the loop-guard kill. Manual intervention needed.',
    palette: 'red',
    Icon: ShieldAlert,
  },

  // ── Terminal stop on user / agent intent ───────────────────────────────
  user_stop: {
    title: 'Stopped by user',
    body: 'The user pressed stop / interrupted the stream.',
    palette: 'red',
    Icon: ShieldAlert,
  },
  agent_stop: {
    title: 'Stopped by agent',
    body: 'The agent decided the task is complete and stopped on its own.',
    palette: 'green',
    Icon: CheckCircle2,
  },

  // ── Partial-edit detectors (Factor 3) ──────────────────────────────────
  'file_edits_present': {
    title: 'File edits applied',
    body: 'The model made filesystem edits. Auto-continuation fired to ensure the model summarizes the changes.',
    palette: 'blue',
    Icon: FileText,
  },
  'empty-after-tools': {
    title: 'Tools ran with thin response',
    body: 'Multiple tools executed but the model emitted <100 chars of explanation. Auto-continuation nudged it to elaborate.',
    palette: 'amber',
    Icon: Wand2,
  },
  'unclosed-code-block': {
    title: 'Unclosed code block',
    body: `The response has an unclosed \`\`\` fence — likely truncated mid-block. Auto-continuation re-prompted to complete.`,
    palette: 'amber',
    Icon: Wand2,
  },
};

const FALLBACK_META: ReasonMeta = {
  title: 'Auto-continuation triggered',
  body: 'A heuristic detector decided the model needs another turn. The continuation decision ran through the standard AutoContinue pipeline.',
  palette: 'blue',
  Icon: Wand2,
};

/**
 * Map every known reason to its banner text. Unknown reasons (forward-
 * compat for new detector buckets) fall through to FALLBACK_META so the
 * user sees something rather than nothing.
 */
function resolveMeta(reason: string | undefined | null): ReasonMeta {
  if (!reason) return FALLBACK_META;
  return REASON_META[reason] ?? FALLBACK_META;
}

const PALETTE_CLASS: Record<ReasonMeta['palette'], { wrap: string; icon: string }> = {
  amber: {
    wrap: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    icon: 'text-amber-400',
  },
  blue: {
    wrap: 'bg-blue-500/10 border-blue-500/30 text-blue-200',
    icon: 'text-blue-400',
  },
  red: {
    wrap: 'bg-red-500/10 border-red-500/30 text-red-200',
    icon: 'text-red-400',
  },
  green: {
    wrap: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
    icon: 'text-emerald-400',
  },
};

export function AutoContinueBanner({
  reason,
  continuationsSoFar,
  maxContinuations,
  className,
}: AutoContinueBannerProps) {
  // Hide the banner for happy-path / undefined decisions — the chat
  // timeline shouldn't show anything when no heuristic fired.
  if (!reason) return null;

  const meta = resolveMeta(reason);
  const palette = PALETTE_CLASS[meta.palette];

  // Operator-facing: when the user sees this banner, the counter lets
  // them know whether this is the 1st nudge or the cap-hit terminal event.
  const showCounter =
    typeof continuationsSoFar === 'number' &&
    typeof maxContinuations === 'number';
  const counterIsAtCap =
    showCounter &&
    continuationsSoFar! >= maxContinuations! &&
    (reason === 'max_continuations_reached' || reason === 'max_iterations');

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'flex items-start gap-3 rounded-lg border px-3 py-2 text-xs ' +
        palette.wrap +
        (className ? ' ' + className : '')
      }
    >
      <meta.Icon className={'mt-0.5 h-4 w-4 shrink-0 ' + palette.icon} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{meta.title}</span>
          {showCounter && (
            <span
              className={
                counterIsAtCap
                  ? 'font-mono rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-300'
                  : 'font-mono rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/70'
              }
              title="auto-continuation counter"
            >
              {continuationsSoFar}/{maxContinuations}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug opacity-90">
          {meta.body}
        </p>
      </div>
    </div>
  );
}

export default AutoContinueBanner;
