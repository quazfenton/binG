# Harness Modes Implementation Plan

> Practical V1 API modes derived from 0harness.md's 53 concepts.
> Only includes ideas that can be implemented as `run*Mode` functions
> using existing infrastructure (LLM API, tools, VFS, embeddings, classification).

---

## What's Implementable

| Rating | Count | What it means |
|---|---|---|
| ✅ **Now** | 21 | New `run*Mode` function, uses existing modules only |
| 🔧 **Minor additions** | 17 | Needs 1 new helper class (~50-80 LOC) + mode function |
| ❌ **Not a V1 mode** | 15 | Too abstract, requires infrastructure we don't have, or is cross-cutting |

### The 15 that won't work as V1 modes

These require fundamentally different infrastructure (differentiable memory, neural field simulation, physics engines, gauge transformations, hypergraph reasoning, emergent language evolution, continuous runtime loops, self-modifying harness). They're research concepts, not production mode functions.

---

## The 5 Modes to Build (Highest ROI)

These 5 modes are selected because: (a) they're implementable with existing infrastructure, (b) they solve real problems in the current system, (c) they compose well with each other, and (d) each is <200 LOC.

---

### Mode 1: `runDualProcessMode` — Fast/Slow Cognition Split

**From harness idea #3: Dual-Process Cognition**

**Problem it solves:** Currently every task gets the same model + same prompt depth. Simple tasks waste tokens on expensive calls; complex tasks get shallow treatment.

**What it does:**
```
User task
    ↓
┌─ Fast pass (gpt-4o-mini, 0.7 temp, 4k max tokens)
│   ├─ LLM produces initial response
│   └─ Check stability:
│       ├─ High confidence + no tool errors → RETURN (done)
│       └─ Low confidence OR errors detected →
│           ↓
└─ Slow pass (gpt-4o or claude-sonnet, 0.3 temp, 16k max tokens)
    ├─ Receives: original task + fast output + instability signals
    ├─ System prompt: "Review and correct the following. Focus on: ..."
    └─ RETURN corrected output
```

**Files it uses:**
- `streamWithVercelAI` / `generateText` — V1 API calls
- `task-classifier.ts` — to detect task complexity upfront
- Existing provider fallback chain — for model selection

**New code needed:**
- `detectInstability(result)` function (~20 lines) — checks: tool error count, loop detection flags, response confidence
- `runDualProcessMode()` function (~80 lines) — orchestrates fast→slow with state passing

**Estimated:** ~100 LOC

**Integration point:** Add to `processUnifiedAgentRequest` switch statement, triggered when `mode === 'dual-process'` or when classifier outputs `moderate` complexity with `confidence < 0.5`.

---

### Mode 2: `runAdversarialVerifyMode` — Self-Verification via Critics

**From harness idea #7: Self-Verification via Counterfactual Forking**

**Problem it solves:** The LLM claims success but the code has bugs, missing error handling, or doesn't actually solve the task. No independent verification step exists.

**What it does:**
```
Primary LLM produces output
    ↓
┌─ Critic 1: "Find bugs and edge cases in this code"
├─ Critic 2: "How would you break this? Find security issues"
├─ Critic 3: "Does this actually solve the original task?"
│
├─ Aggregate critiques
│   ├─ If no significant issues → RETURN output as-is
│   └─ If issues found →
│       ↓
└─ Revision pass: "Fix these issues: [critiques]"
    └─ RETURN revised output
```

**Files it uses:**
- `streamWithVercelAI` — 4 parallel LLM calls (1 primary + 3 critics)
- Existing tool execution system — critics can call read_file to inspect results
- `formatToolError` from `shared-agent-context.ts` — for structured critique output

**New code needed:**
- `spawnCritics(output, task, n=3)` function (~30 lines) — creates 3 LLM calls with different adversarial system prompts
- `aggregateCritiques(critiques)` function (~15 lines) — merges overlapping criticisms, ranks by severity
- `runAdversarialVerifyMode()` function (~45 lines) — orchestrates primary → critics → revision

**Estimated:** ~90 LOC

**Integration point:** Add as `mode: 'adversarial-verify'`. Also usable as a post-processing wrapper around any other mode (wrap the output of progressive-build, intent-driven, etc.).

---

### Mode 3: `runAttractorDrivenMode` — Goal-Convergent Iteration

**From harness idea #5: Attractor-Based Thought Stabilization**

**Problem it solves:** The progressive-build mode stops when the LLM emits `[BUILD_COMPLETE]` — but this is self-reported and unreliable. There's no objective measure of "are we close to done?"

**What it does:**
```
Define attractor states (target conditions):
  A1: "All files compile without errors"    → embedding of success criteria
  A2: "API matches the spec"                → embedding of spec requirements
  A3: "Tests pass"                          → embedding of test expectations

Each iteration:
  LLM produces output
    ↓
  Score output against each attractor:
    alignment_A1 = cosineSimilarity(embed(output), embed(A1))
    alignment_A2 = cosineSimilarity(embed(output), embed(A2))
    alignment_A3 = cosineSimilarity(embed(output), embed(A3))
    ↓
  If ALL alignments > 0.85 → STOP (converged)
  If ANY alignment < 0.5 → iterate again, prompt includes:
    "You're far from satisfying: [lowest attractor]. Focus on that."
  If 0.5-0.85 → iterate with weaker guidance
```

**Files it uses:**
- `embed()` from `lib/memory/embeddings.ts` — for embedding outputs and attractor definitions
- `cosineSimilarity()` from `lib/retrieval/similarity.ts` — for alignment scoring
- `progressive-build-engine.ts` — for the iteration loop structure

**New code needed:**
- `defineAttractors(task)` function (~25 lines) — creates initial attractor embeddings from task analysis
- `scoreAgainstAttractors(output, attractors)` function (~20 lines) — computes alignment scores
- `runAttractorDrivenMode()` function (~75 lines) — iteration loop with attractor-guided prompting

**Estimated:** ~120 LOC

**Integration point:** Add as `mode: 'attractor-driven'`. Can replace or wrap progressive-build mode. Also provides the stopping criterion for Mode 4 (Intent-Driven).

---

### Mode 4: `runIntentDrivenMode` — Latent Intent Field

**From harness idea #1: Latent Intent Field (LIF)**

**Problem it solves:** The current system processes tasks linearly. It doesn't track unresolved subgoals, structural gaps, or competing priorities. When a task has implicit subtasks, they get dropped.

**What it does:**
```
Task: "Build a REST API with auth"
    ↓
IntentField initialized with parsed intents:
  I1: "Create API endpoints"        priority=0.9  entropy=0.3  resolved=false
  I2: "Implement authentication"    priority=0.8  entropy=0.7  resolved=false
  I3: "Add database models"         priority=0.6  entropy=0.5  resolved=false
  I4: "Write tests"                 priority=0.5  entropy=0.8  resolved=false
    ↓
Each iteration:
  Sample top intents by priority*entropy → I2, I4 (highest unresolved uncertainty)
  Prompt: "Focus on these unresolved goals: [I2, I4]"
  LLM produces output
    ↓
  Update intent field:
    I2: resolved=true (auth was implemented)
    I4: entropy reduced (partial tests added)
    Decay all entropy by 0.97
    ↓
  Stop when: max(priority*entropy for unresolved) < 0.1
```

**Files it uses:**
- `embed()` — to embed intent descriptions for similarity matching against LLM output
- `cosineSimilarity()` — to detect which intents were addressed by the output
- V1 API calls — one per iteration
- Tool execution — to implement the intents (file creation, etc.)

**New code needed:**
- `IntentField` class (~80 lines) — stores IntentVector[] with merge/decay/sampling methods
- `inferIntentsFromTask(task)` function (~30 lines) — uses LLM to parse task into intent vectors
- `updateIntentsFromOutput(field, output)` function (~40 lines) — marks resolved/reduced entropy
- `runIntentDrivenMode()` function (~50 lines) — main loop with intent sampling and decay

**Estimated:** ~200 LOC

**Integration point:** Add as `mode: 'intent-driven'`. This is the most reusable primitive — it powers attractor-driven (Mode 3) for stopping, dual-process (Mode 1) for complexity detection, and energy-driven (Mode 5) for optimization.

---

### Mode 5: `runEnergyDrivenMode` — Unified Objective Function

**From harness idea #30: Energy-Based Cognition**

**Problem it solves:** There's no single metric to decide "should we continue iterating?" or "was this change an improvement?" Each mode uses ad-hoc criteria.

**What it does:**
```
SystemEnergy =
  α * intentEntropy        (are goals still unclear?)
  + β * contradictionDensity (are there conflicting decisions?)
  + γ * specMisalignment    (does output match requirements?)
  + δ * codeComplexity     (is the code getting unnecessarily complex?)

Each iteration:
  E_before = computeEnergy(state)
  LLM produces output
  E_after = computeEnergy(state)

  ΔE = E_after - E_before

  If ΔE < 0 (improvement):
    Accept output, continue
  If ΔE > 0 but small (exploration):
    Accept with probability exp(-ΔE / temperature)
  If ΔE >> 0 (regression):
    Reject output, revert, try different approach

  Stop when: ΔE ≈ 0 for 2 consecutive iterations
```

**Files it uses:**
- `task-classifier.ts` — for complexity scoring (code complexity term)
- `embed()` + `cosineSimilarity()` — for spec alignment term
- Loop detection — for contradiction density term
- Intent field (Mode 4) — for entropy term

**New code needed:**
- `computeEnergy(state)` function (~40 lines) — calculates the 4 terms
- `acceptOrReject(deltaE, temperature)` function (~10 lines) — simulated annealing logic
- `runEnergyDrivenMode()` function (~50 lines) — iteration loop with energy-guided acceptance

**Estimated:** ~100 LOC

**Integration point:** Add as `mode: 'energy-driven'`. Can also be used as a scoring layer on top of any other mode (wrap progressive-build, intent-driven, etc. with energy evaluation).

---

## Implementation Order

```
Week 1: Mode 1 (Dual-Process) + Mode 2 (Adversarial Verify)
  → 190 LOC, immediate quality improvement, no new dependencies

Week 2: Mode 3 (Attractor-Driven)
  → 120 LOC, needs embed() + cosineSimilarity (both exist)

Week 3: Mode 4 (Intent-Driven)
  → 200 LOC, most reusable primitive, enables other modes

Week 4: Mode 5 (Energy-Driven)
  → 100 LOC, depends on Mode 4 for entropy term

Total: ~610 LOC across 4 weeks
```

Each mode is independent and can be tested in isolation. They compose:
- Dual-Process + Adversarial: fast pass → critics → slow pass only if needed
- Intent-Driven + Attractor: intent field guides what to work on, attractors decide when to stop
- Energy-Driven wraps any mode: accept/reject based on unified objective

---

## Also Implementable (Lower Priority)

These are rated ✅ or 🔧 but are either cross-cutting utilities (not modes) or lower ROI:

| Idea | What it is | Why lower priority |
|---|---|---|
| #9 Entropy Halting | Stopping criterion utility | Not a mode — add to other modes |
| #11 Prompt Compiler | Prompt construction utility | Not a mode — add to other modes |
| #13 Phase Controller | Mode switcher (explore/crystallize) | Wraps other modes, not standalone |
| #18 Contradiction Mining | Find conflicting beliefs | Useful but narrow use case |
| #24 Spec Drift Detection | Detect requirement drift | Utility, not a mode |
| #25 Observer Layer | Monitoring wrapper | Wraps other modes |
| #27 Failure Signal | Score failures by information gain | Utility |
| #30 Energy-Driven | **INCLUDED ABOVE** | — |
| #32 Cognitive Resonance | Detect convergent multi-agent outputs | Niche |
| #33 Anti-Goal | Prevent local minima | Prompt augmentation |
| #35 Cognitive Shearing | Multi-perspective parallel calls | ~80 LOC, good but narrow |
| #41 Curiosity Field | Intrinsic motivation scoring | ~80 LOC, complements Mode 4 |
| #44 Distributed Models | Use different LLMs for roles | ~110 LOC, needs multi-model config |
| #45 Identity Drift | Monitor system coherence | Utility |
| #47 Constraint Superposition | Weighted constraint prompts | Utility |
| #53 Cognitive Hysteresis | Bias from historical path | ~50 LOC, complements Mode 4 |

### Second-Tier Modes (build after top 5)

If the top 5 prove valuable, these extend the system further:

| Idea | LOC | Depends on |
|---|---|---|
| `runShearingMode` (#35) | ~80 | None — parallel LLM calls with different prompts |
| `runCuriosityDrivenMode` (#41) | ~80 | Mode 4 (Intent Field) |
| `runMultiModelMode` (#44) | ~110 | Provider configuration for multiple models |
| `runForkingMode` (#28) | ~120 | None — parallel branches + merge |
| `runSemanticOpsMode` (#4) | ~150 | VFS + diff parsing |
| `runToolEvolutionMode` (#6) | ~160 | Tool registry + pattern detection |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Request                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
   │ Dual-Process│ │  Adversarial│ │  Intent-     │
   │   (Fast/    │ │   Verify    │ │  Driven      │
   │    Slow)    │ │  (Critics)  │ │  (LIF)       │
   └──────┬──────┘ └──────┬──────┘ └──────┬───────┘
          │               │               │
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
   │ Attractor   │ │  Energy     │ │  Shearing /  │
   │  Driven     │ │  Driven     │ │  Curiosity / │
   │  (Goals)    │ │  (ΔE)       │ │  Forking ... │
   └──────┬──────┘ └──────┬──────┘ └──────┬───────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Shared Infrastructure │
              │                       │
              │  embed()              │
              │  cosineSimilarity()   │
              │  task-classifier      │
              │  VFS MCP tools        │
              │  loop-detection       │
              │  provider fallback    │
              └───────────────────────┘
```

---

## Files to Create

```
web/lib/orchestra/
├── modes/
│   ├── dual-process.ts          # Mode 1: Fast/Slow cognition split
│   ├── adversarial-verify.ts    # Mode 2: Counterfactual critics
│   ├── attractor-driven.ts      # Mode 3: Goal-convergent iteration
│   ├── intent-driven.ts         # Mode 4: Latent Intent Field
│   └── energy-driven.ts         # Mode 5: Unified objective function
└── (modify)
    └── unified-agent-service.ts # Add new modes to switch statement
```

Each mode file exports a single function:
```typescript
export async function runDualProcessMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult>
export async function runAdversarialVerifyMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult>
export async function runAttractorDrivenMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult>
export async function runIntentDrivenMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult>
export async function runEnergyDrivenMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult>
```

---

## Success Metrics

| Metric | Current | After 5 modes |
|---|---|---|
| Simple task cost (tokens) | ~4k (same model for all) | ~1.5k (fast path) |
| Complex task correctness | ~70% (single pass) | ~90% (dual + adversarial) |
| Iteration stopping | LLM self-reports done | Objective attractor alignment |
| Regression detection | None | Energy delta < 0 required |
| Unresolved subtask tracking | Lost between iterations | Intent field persists them |
