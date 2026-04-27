# Agent Execution Modes

Extended execution modes for the unified agent service, derived from [0harness.md](../../../0harness.md) concepts.

Each mode is a self-contained function that calls `processUnifiedAgentRequest` internally. They plug into the switch statement in `unified-agent-service.ts` and are activated by setting `mode` in `UnifiedAgentConfig`.

---

## Mode 1: Dual-Process Cognition (`runDualProcessMode`)

**Harness Idea #3: Fast/Slow Split**

Fast model first → detect instability → escalate to slow model only if needed.

```
User task
    ↓
┌─ Fast path (gpt-4o-mini, temp 0.7, 4k tokens)
│   ├─ LLM produces initial response
│   └─ Detect instability:
│       ├─ Tool failures
│       ├─ Error keywords in response
│       ├─ Incomplete/placeholder text
│       └─ Score >= threshold → escalate
│           ↓
└─ Slow path (gpt-4o, temp 0.3, 16k tokens)
    ├─ Receives fast output + instability signals
    └─ Produces corrected response
```

**When to use:** Default for most tasks. Cheap on easy tasks, catches errors on hard ones.

**Config:**
```typescript
{
  mode: 'dual-process',
  dualProcessConfig: {
    fastModel: 'gpt-4o-mini',
    slowModel: 'gpt-4o',
    instabilityThreshold: 0.3,  // score above which slow path triggers
    fastTemperature: 0.7,
    slowTemperature: 0.3,
  },
}
```

---

## Mode 2: Adversarial Verify (`runAdversarialVerifyMode`)

**Harness Idea #7: Counterfactual Forking**

Primary LLM produces output → N independent critics review → revise if issues found.

```
Primary LLM → output
    ↓
┌─ Critic 1: Correctness (bugs, edge cases, logic)
├─ Critic 2: Security (injection, auth, data exposure)
├─ Critic 3: Requirements (does it solve the task?)
├─ Critic 4: Performance (complexity, redundancy)    [optional]
├─ Critic 5: Maintainability (naming, DRY, coupling) [optional]
│
├─ Aggregate: rank by severity (HIGH/MEDIUM/LOW)
│   ├─ No significant issues → RETURN output
│   └─ Issues found → Revision pass
│       └─ "Fix these issues: [critique]" → corrected output
```

**When to use:** High-stakes code where correctness matters more than cost.

**Config:**
```typescript
{
  mode: 'adversarial-verify',
  adversarialConfig: {
    numCritics: 3,
    severityThreshold: 'medium',  // 'low' | 'medium' | 'high'
    criticModel: 'gpt-4o',
    criticTemperature: 0.5,
  },
}
```

---

## Mode 3: Attractor-Driven (`runAttractorDrivenMode`)

**Harness Idea #5: Goal-Convergent Iteration**

Defines target states (attractors) and scores each iteration against them via embedding alignment. Iterates until all are satisfied.

```
Define attractors:
  A1: Correctness (weight 0.35)
  A2: Completeness (weight 0.25)
  A3: Structure (weight 0.20)
  A4: Robustness (weight 0.20)
    ↓
Each iteration:
  LLM produces output
    ↓
  Score output against each attractor (cosine similarity of embeddings)
  alignment = [0.82, 0.71, 0.65, 0.43]
    ↓
  If ALL >= 0.7 → CONVERGED, stop
  If ANY < 0.4 → iterate, focus on weakest (A4: Robustness)
```

**When to use:** Tasks where you need objective stopping criteria beyond "LLM says done."

**Config:**
```typescript
{
  mode: 'attractor-driven',
  attractorConfig: {
    convergenceThreshold: 0.7,
    lowThreshold: 0.4,
    maxIterations: 6,
  },
}
```

---

## Mode 4: Intent-Driven (`runIntentDrivenMode`)

**Harness Idea #1: Latent Intent Field**

Maintains a persistent field of unresolved intents across iterations. Each iteration samples the most uncertain high-priority intents and focuses the LLM on resolving them.

```
Parse task → extract intents:
  I1: "Create API endpoints"       priority=0.9  entropy=1.0
  I2: "Implement authentication"   priority=0.8  entropy=1.0
  I3: "Add database models"        priority=0.6  entropy=1.0
  I4: "Write tests"                priority=0.5  entropy=1.0
    ↓
Sample top-K by priority × entropy → I1, I2 (highest unresolved)
    ↓
LLM focuses on: "1. Create API endpoints... 2. Implement authentication..."
    ↓
Update: I1 resolved, I2 entropy reduced, decay all by 0.97
    ↓
Repeat until max(priority × entropy) < 0.05
```

**When to use:** Complex tasks with implicit subgoals that would otherwise be dropped.

**Config:**
```typescript
{
  mode: 'intent-driven',
  intentConfig: {
    decayFactor: 0.97,
    stopThreshold: 0.05,
    sampleSize: 3,
    maxIterations: 10,
  },
}
```

---

## Mode 5: Energy-Driven (`runEnergyDrivenMode`)

**Harness Idea #30: Unified Objective Function**

Defines `E = α·intentEntropy + β·contradictionDensity + γ·specMisalignment + δ·codeComplexity`. Each iteration accepts if ΔE < 0 (improvement), or with probability exp(-ΔE/T) (exploration). Stops on stagnation.

```
Each iteration:
  E_before = computeEnergy(state)
  LLM produces output
  E_after = computeEnergy(state)

  ΔE = E_after - E_before
  If ΔE < 0     → accept (improvement)
  If ΔE >= 0    → accept with probability exp(-ΔE/T)

  Stop when: no improvement for N consecutive iterations
```

**Energy components:**
- **Intent entropy:** How scattered the output focus is (0-1)
- **Contradiction density:** How many conflicting markers in output (0-1)
- **Spec misalignment:** What fraction of task key terms are missing (0-1)
- **Code complexity:** Deviation from ideal code/explanation ratio (0-1)

**When to use:** When you want a single metric to guide iteration acceptance/rejection.

**Config:**
```typescript
{
  mode: 'energy-driven',
  energyConfig: {
    maxIterations: 8,
    acceptanceThreshold: 0.05,
    explorationTemperature: 0.5,
    stagnationLimit: 2,
    weights: {
      intentEntropy: 0.25,
      contradictionDensity: 0.25,
      specMisalignment: 0.25,
      codeComplexity: 0.25,
    },
  },
}
```

---

## Mode 6: Distributed Cognition (`runDistributedCognitionMode`)

**Harness Idea #44: Multi-Model Roles**

4 cognitive roles in sequence: Architect → Engineer → Critic → Synthesizer. Each role gets a distinct system prompt tuned to its specialty. Architect designs structure (strong model, low temp), Engineer implements (mid model), Critic reviews (strong model, high temp), Synthesizer merges (fast model). Critic finds severity-rated issues → Engineer revises (configurable rounds). Each role can use a different provider/model combination.

```
Architect (gpt-4o, temp 0.3)    → "Design the structure and abstractions"
    ↓
Engineer (gpt-4o-mini, temp 0.5) → "Implement the design with correct code"
    ↓
Critic (gpt-4o, temp 0.8)       → "Find flaws. How would you break this?"
    ├─ No significant issues → skip revision
    └─ Issues found → Engineer revises (up to N rounds)
        ↓
Synthesizer (gpt-4o-mini, temp 0.4) → "Merge design + implementation + review"
```

**When to use:** Complex tasks where design quality, correctness, and review all matter.

**Config:**
```typescript
{
  mode: 'distributed-cognition',
  distributedConfig: {
    roles: {
      architect: { provider: 'openai', model: 'gpt-4o' },
      engineer: { provider: 'openai', model: 'gpt-4o-mini' },
      critic: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      synthesizer: { provider: 'openai', model: 'gpt-4o-mini' },
    },
    maxRevisionRounds: 1,
  },
}
```

---

## Mode 7: Cognitive Resonance (`runCognitiveResonanceMode`)

**Harness Idea #32: Independent Agreement**

Spawns N independent agents (default 3) with 6 diverse reasoning approaches (conservative, thorough, pragmatic, architectural, minimalist, defensive). Embeds all outputs, builds pairwise similarity matrix. Greedy clustering finds groups that converged on similar answers. If cluster ≥ min size → picks member closest to centroid (high confidence from independent agreement). If no convergence → synthesizer LLM merges best elements across all agents. Returns full similarity matrix in metadata for analysis.

```
Spawn 3 agents with diverse prompts:
  Agent 0 (conservative, temp 0.3)  → "Prioritize correctness and simplicity"
  Agent 1 (thorough, temp 0.5)      → "Address all edge cases comprehensively"
  Agent 2 (pragmatic, temp 0.7)     → "Focus on working code quickly"
    ↓
Embed all outputs → pairwise similarity matrix:
       A0    A1    A2
  A0  1.00  0.72  0.41
  A1  0.72  1.00  0.38
  A2  0.41  0.38  1.00
    ↓
Cluster: {A0, A1} at similarity 0.72 (converged!)
    ↓
Pick A0 (closest to centroid) → RETURN as high-confidence result
```

**When to use:** Ambiguous tasks where no single approach is obviously correct. Independent agreement = strong signal.

**Config:**
```typescript
{
  mode: 'cognitive-resonance',
  resonanceConfig: {
    numAgents: 3,
    minClusterSize: 2,
    similarityThreshold: 0.7,
    temperatures: [0.3, 0.5, 0.7],
  },
}
```

---

## File Inventory

| File | Mode | LOC |
|---|---|---|
| `dual-process.ts` | Mode 1: Dual-Process | 274 |
| `adversarial-verify.ts` | Mode 2: Adversarial Verify | 503 |
| `attractor-driven.ts` | Mode 3: Attractor-Driven | 396 |
| `intent-driven.ts` | Mode 4: Intent-Driven | 507 |
| `energy-driven.ts` | Mode 5: Energy-Driven | 380 |
| `distributed-cognition.ts` | Mode 6: Distributed Cognition | 371 |
| `cognitive-resonance.ts` | Mode 7: Cognitive Resonance | 479 |
| `index.ts` | Barrel export | 45 |
| **Total** | | **2,955** |

## Adding to Unified Agent Service

All modes are wired into `unified-agent-service.ts`. To use:

```typescript
import { processUnifiedAgentRequest } from '@/lib/orchestra/unified-agent-service';

const result = await processUnifiedAgentRequest({
  userMessage: 'Create a REST API with auth',
  mode: 'distributed-cognition',
  distributedConfig: { maxRevisionRounds: 1 },
});
```
