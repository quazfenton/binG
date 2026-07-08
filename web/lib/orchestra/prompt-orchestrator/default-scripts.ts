/**
 * prompt-orchestrator/default-scripts.ts
 *
 * Shared `PO_DEFAULT_SCRIPT` constants — previously duplicated in 2 caller
 * files (unified-agent-service.ts + marker-scanner.ts). Promoting them to
 * a single source of truth prevents silent drift if a 3rd caller lands
 * (e.g. a future Tier 8 step 4 round-trip site wanting to keep the
 * observability attribution consistent).
 *
 * ## Two constants, not one (by design)
 *
 * The 2 callers have DIFFERENT `promptId` values intentionally — each
 * promptId becomes a Prometheus label (`prompt_injection_total{...,
 * promptId="..."}`) so the observability dashboard can split the 2 call
 * sites. Collapsing to a single `PO_DEFAULT_SCRIPT` with a shared promptId
 * would mash the metric series together, hiding per-call-site attribution.
 *
 * Each constant's promptId matches the file that originally declared it:
 *   - `PO_UNIFIED_AGENT_SCRIPT`: promptId=`unified-agent-entry` (mirrors
 *     the `prompt-unified-agent` call site at
 *     `web/lib/orchestra/unified-agent-service.ts:L1517` — the 1st
 *     production caller; source label = `unified-agent`).
 *   - `PO_MARKER_TAIL_SCRIPT`: promptId=`marker-tail-poll` (mirrors
 *     the marker-in-history 2nd caller at
 *     `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts` —
 *     source label = `marker-tail`).
 *
 * Both shapes are intentionally empty (`steps: []`) — applying them is
 * a structural no-op that wires the path through the foundation without
 * injecting any markers. Adding a step to EITHER const (or switching to
 * `loadScript(...)` for a disk-stored script) is a Tier 8 step 4/8
 * un-defer unblocker.
 *
 * ## Path-A placement (per docs/MONOREPO_LAYOUT.md)
 *
 * Lives in `lib/orchestra/prompt-orchestrator/` because:
 *
 *   1. The semantic owner is the prompt-orchestrator foundation — these
 *      are the foundation's BUILT-IN defaults, not caller-specific
 *      scripts.
 *   2. Caller A (unified-agent-service.ts) static-imports from this path
 *      (it's already inside the foundation's consumer subtree; no
 *      directionality issue).
 *   3. Caller B (marker-scanner.ts in `web/.bing-shared/`) dynamic-
 *      imports from this path in `start()` (parallel to the existing
 *      scanMarkers + observeApplyScript dynamic-imports) — this preserves
 *      the boot-without-prompt-orchestrator contract at `L11-L16` of the
 *      marker-scanner file. A STATIC value import would force the
 *      marker-scanner module to load the foundation at static-import
 *      time, violating the contract.
 *
 * The reverse-direction import (`.bing-shared/` → `web/lib/`) is OK
 * because the value is dynamic-imported inside `start()`'s try/catch —
 * the static analyzer doesn't require the foundation to resolve at boot.
 */
import type { PromptScript } from './types'

/**
 * Default script for the unified-agent 1st production caller
 * (`unified-agent-service.ts:L1517`). Source label: `unified-agent`.
 * Replaces the local `const PO_DEFAULT_SCRIPT` previously declared inline.
 */
export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = {
  promptId: 'unified-agent-entry',
  steps: [],
}

/**
 * Default script for the marker-tail 2nd production caller (`.bing-shared/
 * services/scheduler/triggers/marker-scanner.ts`). Source label:
 * `marker-tail`. Replaces the local `const PO_DEFAULT_SCRIPT` previously
 * declared inline.
 */
export const PO_MARKER_TAIL_SCRIPT: PromptScript = {
  promptId: 'marker-tail-poll',
  steps: [],
}
