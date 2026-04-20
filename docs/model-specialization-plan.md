---
id: model-specialization-plan
title: Model Specialization Plan
aliases:
  - model-specialization-plan
  - model-specialization-plan.md
tags: []
layer: core
summary: "# Model Specialization Plan\r\n\r\n> Specializing external API models **without weight updates** — using prompt engineering, RAG, verification, iterative feedback, tool orchestration, and self-learning.\r\n\r\n---\r\n\r\n## Executive Summary\r\n\r\nThis codebase already has strong infrastructure for **task classifi"
anchors:
  - Executive Summary
  - 'Current State: What Exists vs. What''s Missing'
  - ✅ Already Built (use these)
  - ❌ Missing Gaps (this plan fills them)
  - 'Layer 1: Dynamic Prompt Engine'
  - 1.1 Model-Specific Prompt Variants
  - 1.2 Few-Shot Example Injection
  - 1.3 Progressive Context Building
  - 'Layer 2: RAG Knowledge Pipeline'
  - 2.1 Server-Side Knowledge Vector Store
  - 2.2 Corpus Preparation (RAG Step 2)
  - 2.3 Retrieval Pipeline (RAG Steps 3–5)
  - 2.4 Prompt Integration (RAG Step 6)
  - Relevant Examples (from similar past tasks)
  - 2.5 Verification & Post-Processing (RAG Step 6 continued)
  - 2.6 Evaluation & Iteration (RAG Step 7)
  - 'Layer 3: Verification & Self-Healing'
  - 3.1 Pre-Execution Tool Validator
  - 3.2 Post-Execution Self-Check
  - 3.3 Schema Validation for All Outputs
  - 'Layer 4: Practice → Production Loop'
  - 4.1 Auto-Apply Practice Results
  - '4.2 Shared Database: Python Practice ↔ TypeScript Agent'
  - 4.3 Continuous Practice on Real Trajectories
  - 4.4 Synthetic Example Generation
  - 'Layer 5: Model-Aware Routing'
  - 5.1 Task Type + Model Recommendation
  - 5.2 Per-Model Circuit Breaker
  - 5.3 Per-Model Tool Success Tracking
  - Implementation Phases
  - 'Phase 1: Quick Wins (1–2 weeks) — Highest ROI, Lowest Effort'
  - 'Phase 2: Prompt Engine + Model Routing (2–3 weeks)'
  - 'Phase 3: RAG Knowledge Pipeline (3–4 weeks)'
  - 'Phase 4: Practice → Production Loop (2–3 weeks)'
  - 'Phase 5: Synthetic Data + Dashboard (ongoing)'
  - Architecture Diagram
  - Cost Estimates
  - Savings from Improvement
  - Success Metrics
  - Risks & Mitigations
  - 'Appendix: File Inventory'
  - New Files to Create
  - Existing Files to Leverage
  - 'Quick Start: What to Build First'
  - 'Day 1: Add few-shot examples to VFS tool descriptions'
  - 'Day 2: Pre-execution validator'
  - 'Day 3: Task type detection'
---
# Model Specialization Plan

> Specializing external API models **without weight updates** — using prompt engineering, RAG, verification, iterative feedback, tool orchestration, and self-learning.

---

## Executive Summary

This codebase already has strong infrastructure for **task classification**, **mode routing**, **tool execution**, **plan-act-verify orchestration**, and a **practice/learning system**. But these pieces operate in **isolation**.

The plan below connects them into a **unified Model Specialization Pipeline** organized as 5 coordinated layers. Each layer maps to specific files in this codebase and builds on what already exists.

| Layer | Maps to Approach | What it does | Effort | Impact |
|---|---|---|---|---|
| **1. Dynamic Prompt Engine** | #1 Prompt Engineering, #3 Instruction Tuning via Adapters | Structured templates + few-shot injection + model-specific variants | Medium | High |
| **2. RAG Knowledge Pipeline** | #2 RAG | Retrieve relevant examples, rules, and past solutions at request time | High | Very High |
| **3. Verification & Self-Healing** | #4 Response Post-Processing, #6 Tool Orchestration | Pre-execution validation + self-check + schema enforcement | Low | High |
| **4. Practice → Production Loop** | #5 Iterative Feedback, #7 Synthetic Data | Training-Free GRPO extracts experiences → auto-injects into prompts | Medium | Very High |
| **5. Model-Aware Routing** | #8 Provider Tuning, #9 Engineering Notes | Classifier picks optimal model per task + per-model circuit breaker | Low | Medium |

---

## Current State: What Exists vs. What's Missing

### ✅ Already Built (use these)

| Capability | File | What it does |
|---|---|---|
| **Task Classifier** | `packages/shared/agent/task-classifier.ts` (~620 lines) | Multi-factor scoring (keyword 0.4, semantic 0.3, context 0.2, historical 0.1). Outputs complexity + recommendedMode + confidence. |
| **Unified Router** | `packages/shared/agent/unified-router.ts` (462 lines) | Circuit breaker + health checks + mode selection + fallback chain. |
| **Unified Agent Service** | `web/lib/orchestra/unified-agent-service.ts` (2065 lines) | 8 execution modes (v1-api, v1-agent-loop, v1-progressive-build, v2-native, v2-containerized, v2-local, mastra-workflow, desktop). Fallback chain. |
| **VFS MCP Tools** | `web/lib/mcp/vfs-mcp-tools.ts` (1452 lines) | 10 structured tools with `normalizeToolArgs` (field alias mapping), `normalizeToolCall` (canonical shape), tolerant JSON parsing, 16+ tool name aliases. |
| **Plan-Act-Verify Orchestrator** | `packages/shared/agent/orchestration/plan-act-verify.ts` (584 lines) | State machine with planning, acting, verifying, responding phases. Structured `ToolResult` and `ToolError` types. Self-healing executor. |
| **System Prompts** | `packages/shared/agent/system-prompts.ts` (3542 lines) | Role-based prompts (coder, reviewer, planner, architect) with TOOL_CAPABILITIES, coding standards, anti-patterns, self-validation checklists. |
| **Prompt Composer** | `packages/shared/agent/prompt-composer.ts` (591 lines) | Section-based composition (IDENTITY, DIRECTIVES, TOOL STRATEGY, EXAMPLES, ANTI-PATTERNS, OUTPUT FORMAT). Has `composeRole()` API and `FEW-SHOT` section support. |
| **Hybrid Retrieval** | `web/lib/retrieval/hybrid-retrieval.ts` (439 lines) | AST-based symbol retrieval → smart-context fallback. Cosine + PageRank ranking. |
| **Vector Store** | `web/lib/memory/vectorStore.ts` (190 lines) | IndexedDB (Dexie) with symbols, edges, projects tables. |
| **Embeddings** | `web/lib/memory/embeddings.ts` (112 lines) | `/api/embed` endpoint with in-memory cache + batch support. |
| **Verification** | `web/lib/orchestra/stateful-agent/agents/verification.ts` (938 lines) | Syntax verification (TypeScript/JavaScript/JSON via AST parsing). Reprompt generation from errors. |
| **Practice System** | `packages/shared/agent/practice/` (Python) | Training-Free GRPO: rollout → judge → summarize → extract experiences → save enhanced agent config. |
| **VFS Tool Practice** | `scripts/practice/practice_vfs_tools.py` | Lightweight trainer: 8 VFS tasks, regex evaluation, experience extraction, enhanced prompt generation. |
| **VFS Verifier** | `packages/shared/agent/practice/verify/vfs_tool_use.py` | 5-criterion rule-based verifier (tool usage, correct names, argument structure, content quality, completion). |
| **Experience Prompts** | `packages/shared/agent/practice/prompts/experience.yaml` | 6 templates: summarize_correct, summarize_wrong, group_advantage, group_update, generate_final, judge. |

### ❌ Missing Gaps (this plan fills them)

| Gap | Why it matters |
|---|---|
| **No model-tier routing** | Same model used for classification, planning, and execution — wastes tokens/cost on easy tasks |
| **No per-model prompt variants** | Smaller models need more examples + explicit schemas; stronger models need less hand-holding |
| **No calibrated few-shot examples** | Prompt composer supports EXAMPLES section but system prompts have no inline examples |
| **No task type classification** | Classifier outputs complexity (simple/moderate/complex) but not task type (vfs_write, code_gen, debug, etc.) |
| **No retrieval of few-shot experiences** | Vector store holds code symbols only — not task solutions or learned experiences |
| **No pre-execution tool validation** | `normalizeToolArgs` fixes mistakes reactively but doesn't prevent them |
| **No post-execution self-check** | Model claims are not verified against actual tool invocations |
| **Practice → production disconnect** | Practice outputs enhanced configs to disk but they are never auto-applied |
| **No per-model tool success tracking** | No telemetry on which models fail at which tools |
| **No synthetic data pipeline** | All practice tasks are hand-written; no automated example generation from real trajectories |
| **No query rewriting for retrieval** | Retrieval uses raw query without normalization or expansion |
| **No re-ranking of retrieved results** | Only PageRank + cosine; no cross-encoder or quality-based reranking |
| **No retrieval quality feedback** | No learning from which retrievals were actually useful |

---

## Layer 1: Dynamic Prompt Engine

> **Approach #1: Prompt Engineering** + **Approach #3: Instruction Tuning via Adapters**

### 1.1 Model-Specific Prompt Variants

**Problem:** The same 3542-line system prompt (`system-prompts.ts`) is used regardless of whether the model is `gpt-4o-mini` (needs explicit schemas + examples) or `claude-sonnet-4-5` (needs less hand-holding).

**Solution:** Build prompt variants keyed by model capability tier.

```
Model Tiers:
├── Tier 1 (Small): gpt-4o-mini, Mistral Small, Haiku
│   → Explicit tool schemas, 4-6 few-shot examples, strict output format
├── Tier 2 (Medium): gpt-4o, Claude Sonnet, Gemini Pro
│   → Tool schemas, 2-3 few-shot examples, flexible output format
└── Tier 3 (Large): o1, Claude Opus, Gemini Ultra
│   → Minimal tool schemas, 0-1 examples, natural output format
```

**New file:** `packages/shared/agent/prompt-engine/model-variants.ts`

```typescript
interface ModelVariant {
  tier: 1 | 2 | 3;
  fewShotCount: number;
  includeToolSchemas: boolean;
  includeOutputFormat: boolean;
  includeChainOfThought: boolean;
  maxContextTokens: number;
}

const MODEL_VARIANTS: Record<string, ModelVariant> = {
  'gpt-4o-mini':   { tier: 1, fewShotCount: 5, includeToolSchemas: true,  includeOutputFormat: true,  includeChainOfThought: false, maxContextTokens: 4000 },
  'gpt-4o':        { tier: 2, fewShotCount: 3, includeToolSchemas: true,  includeOutputFormat: true,  includeChainOfThought: false, maxContextTokens: 8000 },
  'claude-sonnet': { tier: 2, fewShotCount: 2, includeToolSchemas: true,  includeOutputFormat: false, includeChainOfThought: false, maxContextTokens: 8000 },
  'o1':            { tier: 3, fewShotCount: 0, includeToolSchemas: false, includeOutputFormat: false, includeChainOfThought: true,  maxContextTokens: 16000 },
  // ... add all models
};
```

**Modify:** `web/lib/orchestra/shared-agent-context.ts` → `buildAgentSystemPrompt()` accepts a `modelVariant` parameter.

### 1.2 Few-Shot Example Injection

**Problem:** `prompt-composer.ts` supports a `FEW-SHOT` / `EXAMPLES` section (line 329), but `system-prompts.ts` has no inline examples — only abstract patterns.

**Solution:** Build a curated few-shot library keyed by task type, inject 2–5 examples at runtime.

**New file:** `packages/shared/agent/prompt-engine/few-shot-library.ts`

```typescript
interface FewShotExample {
  id: string;
  taskType: TaskType;       // 'vfs_write' | 'vfs_batch' | 'vfs_diff' | 'code_gen' | 'debug'
  input: string;            // User request
  output: string;           // Expected tool call pattern or response
  model?: string;           // Which model this was validated for
  quality: number;          // 0–1 from verification
  source: 'curated' | 'practice' | 'production_trajectory';
}

// Pre-populated with known-good examples
const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    id: 'vfs_write_001',
    taskType: 'vfs_write',
    input: 'Create a hello.py that prints Hello World',
    output: 'write_file(path="hello.py", content="print(\'Hello World\')")',
    quality: 1.0,
    source: 'curated',
  },
  {
    id: 'vfs_batch_001',
    taskType: 'vfs_batch',
    input: 'Create a Flask app with app.py, templates/index.html, and requirements.txt',
    output: 'batch_write(files=[{path:"app.py",content:"from flask import Flask..."},{path:"templates/index.html",content:"<!DOCTYPE html>..."},{path:"requirements.txt",content:"flask"}])',
    quality: 1.0,
    source: 'curated',
  },
  // ... 20+ examples covering all task types
];

function selectFewShots(taskType: TaskType, model: string, count: number): FewShotExample[] {
  return FEW_SHOT_EXAMPLES
    .filter(e => e.taskType === taskType && (!e.model || e.model === model))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, count);
}
```

**Integration point:** `packages/shared/agent/prompt-composer.ts` → when composing a role, inject selected few-shots into the EXAMPLES section.

### 1.3 Progressive Context Building

**Problem:** All context is prepended upfront in `runV1ApiCompletion` — burning tokens even for easy tasks.

**Solution:** Build context incrementally based on failure:

```
Attempt 1: Identity + tool schema + N few-shot examples
           ↓ (if tool call fails)
Attempt 2: + Experiences from practice ("You previously failed at...")
           ↓ (if still failing)
Attempt 3: + RAG-retrieved similar tasks
           ↓ (if still failing)
Attempt 4: + Chain-of-thought example + explicit step-by-step guidance
```

**Modify:** `web/lib/orchestra/unified-agent-service.ts` → each `run*Mode` function accepts an `attemptNumber` parameter that controls context depth.

---

## Layer 2: RAG Knowledge Pipeline

> **Approach #2: RAG**

### 2.1 Server-Side Knowledge Vector Store

**Problem:** The current vector store (`web/lib/memory/vectorStore.ts`) is IndexedDB-based (browser-only) and stores code symbols only — not task solutions, experiences, or few-shot examples.

**Solution:** Add a server-side knowledge store that persists across sessions and users.

**New file:** `packages/shared/agent/rag/knowledge-store.ts`

```typescript
interface KnowledgeChunk {
  id: string;
  type: 'few_shot' | 'experience' | 'rule' | 'task_solution' | 'anti_pattern';
  content: string;
  embedding: number[];
  metadata: {
    taskType?: string;        // 'vfs_write', 'vfs_batch', etc.
    model?: string;           // which model this is relevant for
    quality?: number;         // verification score (0–1)
    source?: string;          // 'curated', 'practice', 'production'
    createdAt: number;
    usageCount: number;       // how often this was retrieved
    usefulnessScore: number;  // feedback from downstream verification
  };
}
```

**Storage options (start simple, scale later):**

| Option | When to use | Pros | Cons |
|---|---|---|---|
| **SQLite + sqlite-vec** | Start here (single server) | Zero infra, ACID, fast enough for <100k chunks | Single-node |
| **pgvector** | Multi-server deployment | PostgreSQL ecosystem, scalable | Requires Postgres |
| **Qdrant / Milvus** | Large-scale (>1M chunks) | Purpose-built vector DB | Additional service |

### 2.2 Corpus Preparation (RAG Step 2)

Populate the knowledge store from **three sources**:

| Source | What it adds | How |
|---|---|---|
| **Curated examples** | High-quality few-shot examples (hand-written) | `few-shot-library.ts` → embed → insert |
| **Practice system** | Extracted experiences from Training-Free GRPO runs | `practice/` → auto-insert after each GRPO run |
| **Production trajectories** | Real agent successes/failures | Log → label → embed → insert |

**Corpus preparation pipeline:**

```
1. Source collection
   ├── Manuals, API docs, VFS tool schemas       → 'rule' chunks
   ├── Practice experiences                        → 'experience' chunks
   ├── Curated few-shot examples                   → 'few_shot' chunks
   └── Production task trajectories                → 'task_solution' chunks

2. Normalization
   ├── Remove duplicates (hash-based)
   ├── Canonicalize field names (path vs file vs filename)
   └── Split long chunks into 300–500 token segments (10-20% overlap)

3. Metadata enrichment
   ├── Attach taskType, model relevance, quality score
   ├── Add source attribution
   └── Set initial usageCount = 0, usefulnessScore = 0.5

4. Embedding + indexing
   ├── Embed content via /api/embed endpoint
   ├── Store vector + metadata in knowledge store
   └── Build inverted index for lexical search (BM25)
```

### 2.3 Retrieval Pipeline (RAG Steps 3–5)

**New file:** `packages/shared/agent/rag/retrieval.ts`

```
User Task: "Create a React component src/Button.tsx"
  │
  ├─ Step 1: Query Preprocessing
  │   ├─ Normalize: lowercase, strip punctuation
  │   ├─ Detect taskType: 'vfs_write' (from task classifier)
  │   └─ Extract entities: ['React', 'component', 'Button', 'tsx']
  │
  ├─ Step 2: Coarse Retrieval (top-20)
  │   ├─ Vector similarity (cosine) on embedded query
  │   └─ Lexical match (BM25) on metadata tags
  │
  ├─ Step 3: Rerank (top-5)
  │   Score = relevance × quality × recency × (1 + 0.1 × usageCount)
  │   - relevance: cosine similarity
  │   - quality: verification score from metadata
  │   - recency: exp(-age_in_days / 30) decay
  │   - usageCount boost: frequently-used chunks get slight priority
  │
  ├─ Step 4: Filter
  │   ├─ Remove chunks for different models (if model-specific)
  │   ├─ Remove duplicates (content hash)
  │   └─ Remove low-quality chunks (quality < 0.5)
  │
  └─ Step 5: Format for Prompt
      "Relevant examples:
       [1] (quality: 0.95, source: practice)
       Task: Create React component App.tsx
       → write_file(path='src/App.tsx', content='export default function App() {...}')

       [2] (quality: 0.88, source: experience)
       Always create parent directories before writing files.
       Use batch_write when creating 3+ files."
```

**Default config (good starting point):**
- Chunk size: 300–500 tokens
- Initial top-N vector retrieval: 20
- Rerank top-k to: 5
- Prompt top-k included: 3
- Quality threshold: 0.5

### 2.4 Prompt Integration (RAG Step 6)

**Modify:** `web/lib/orchestra/shared-agent-context.ts` → `buildAgentSystemPrompt()`

Add a new **RETRIEVED CONTEXT** section between the FEW-SHOT EXAMPLES and CONSTRAINTS sections:

```
## Relevant Examples (from similar past tasks)

[1] Task: Create React component App.tsx
    → write_file(path='src/App.tsx', content='export default function App() {...}')
    (quality: 0.95, source: practice experience)

[2] Always create parent directories before writing files.
    (quality: 0.88, source: extracted experience)
```

### 2.5 Verification & Post-Processing (RAG Step 6 continued)

**Modify:** Existing verification in `plan-act-verify.ts`

Add **retrieval-grounded verification**:
```
1. After model generates output, check:
   - Did the model use the retrieved examples as a guide?
   - Is the tool call structure consistent with the examples?
   - Are the arguments in the correct format?

2. Self-check prompt:
   "The model produced: {output}
    The retrieved examples showed: {examples}
    Does the output follow the same pattern?
    Score 0-1 and explain."

3. If self-check score < 0.7:
   - Regenerate with explicit feedback:
     "Your output didn't match the example pattern. Here's what was expected: ..."
```

### 2.6 Evaluation & Iteration (RAG Step 7)

Track retrieval effectiveness:

```typescript
interface RetrievalFeedback {
  query: string;
  retrievedIds: string[];
  usedIds: string[];          // which chunks the model actually used
  taskSuccess: boolean;       // did the task complete successfully?
  toolCallCorrect: boolean;   // were tool calls structurally correct?
}

// After each request, log feedback
// Periodic job: adjust chunk quality scores based on usefulness
// Chunks with low usefulnessScore get deprioritized or removed
```

**Metrics to track:**
- Retrieval hit rate: % of requests where at least one retrieved chunk was used
- Retrieval precision: % of retrieved chunks that were actually useful
- Answer accuracy: task success rate with vs. without retrieval
- Token cost: additional tokens from retrieval context
- Latency: retrieval overhead

---

## Layer 3: Verification & Self-Healing

> **Approach #4: Response Post-Processing** + **Approach #6: Tool Orchestration**

### 3.1 Pre-Execution Tool Validator

**Problem:** `normalizeToolArgs` in `vfs-mcp-tools.ts` fixes field name mistakes **reactively** (after the model made them). It doesn't **prevent** mistakes or **teach** the model.

**Solution:** Add a pre-execution validator that rejects structurally invalid tool calls and returns structured feedback.

**New file:** `packages/shared/agent/verification/tool-validator.ts`

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  suggestions: string[];
  correctedArgs?: Record<string, unknown>;
}

interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  example?: string;  // correct example for this field
}

class ToolValidator {
  // Main validation entry point
  validate(toolName: string, args: Record<string, unknown>): ValidationResult {
    const schema = TOOL_SCHEMAS[toolName];
    if (!schema) return { valid: true, errors: [], suggestions: [] };

    const errors: ValidationError[] = [];
    const suggestions: string[] = [];

    // Check required fields
    for (const field of schema.required) {
      if (args[field] === undefined || args[field] === null) {
        errors.push({
          field,
          message: `Missing required field '${field}'`,
          severity: 'error',
          example: schema.examples?.[field],
        });
        suggestions.push(schema.suggestions?.[field] || `Add '${field}' to your tool call`);
      }
    }

    // Type checks
    for (const [field, expectedType] of Object.entries(schema.types || {})) {
      if (args[field] !== undefined && typeof args[field] !== expectedType) {
        errors.push({
          field,
          message: `Field '${field}' should be ${expectedType}, got ${typeof args[field]}`,
          severity: 'error',
        });
      }
    }

    // Tool-specific validation
    if (toolName === 'batch_write') {
      const batchResult = this.validateBatchWrite(args.files);
      errors.push(...batchResult.errors);
      suggestions.push(...batchResult.suggestions);
    }
    if (toolName === 'apply_diff') {
      const diffResult = this.validateDiff(args.diff);
      errors.push(...diffResult.errors);
      suggestions.push(...diffResult.suggestions);
    }

    return {
      valid: errors.filter(e => e.severity === 'error').length === 0,
      errors,
      suggestions,
      correctedArgs: this.attemptCorrection(toolName, args),
    };
  }

  // batch_write-specific validation
  validateBatchWrite(files: unknown): ValidationResult {
    // Check: is it an array? (not stringified JSON)
    // Check: each file has path + content
    // Check: no duplicate paths
    // Check: content size limits
  }

  // apply_diff-specific validation
  validateDiff(diff: string): ValidationResult {
    // Check: starts with --- or +++ headers
    // Check: has @@ hunk headers
    // Check: balanced + / - lines
  }
}

const TOOL_SCHEMAS = {
  write_file: {
    required: ['path', 'content'],
    types: { path: 'string', content: 'string' },
    examples: { path: '"src/App.tsx"', content: '"export default function App() {}"' },
    suggestions: {
      path: "Use `path` (not `file`, `filename`, or `filepath`)",
      content: "Use `content` (not `code`, `text`, or `body`)",
    },
  },
  batch_write: {
    required: ['files'],
    types: { files: 'object' }, // must be array, not string
    examples: { files: '[{path:"a.py",content:"..."},{path:"b.py",content:"..."}]' },
    suggestions: {
      files: "Pass `files` as a JSON array, not a stringified string",
    },
  },
  // ... all 10 tools
};
```

**Integration:** `web/lib/chat/vercel-ai-tools.ts` → wrap tool execution with validation. If validation fails, return a structured error to the model instead of executing with bad args.

### 3.2 Post-Execution Self-Check

**Problem:** Smaller models sometimes **claim** to have used a tool without actually invoking it ("hallucinated tool call").

**Solution:** After the model produces a response, verify that claimed tool calls match actual invocations.

**Modify:** `web/lib/orchestra/unified-agent-service.ts` → in `runV1ApiCompletion` and `runV1ApiWithTools`, add a self-check step:

```typescript
async function selfCheckToolClaims(response: string, actualToolCalls: ToolCall[]): Promise<{ ok: boolean; feedback: string }> {
  // Extract tool claims from response text
  const claimedTools = extractToolClaims(response);

  // Compare with actual invocations
  const missing = claimedTools.filter(c => !actualToolCalls.find(a => a.tool === c.tool));
  const extra = actualToolCalls.filter(a => !claimedTools.find(c => c.tool === a.tool));

  if (missing.length > 0) {
    return {
      ok: false,
      feedback: `You claimed to use ${missing.map(t => t.tool).join(', ')} but no tool call was made. Please actually call the tool.`,
    };
  }

  return { ok: true, feedback: '' };
}
```

If self-check fails → regenerate with feedback.

### 3.3 Schema Validation for All Outputs

**Already partially exists** in `vfs-mcp-tools.ts` via `z.preprocess(normalizeToolArgs, z.object(...))`.

**Gap:** Errors are sometimes swallowed and the tool executes with partial data.

**Fix:** When Zod validation fails, return a structured error to the model:

```json
{
  "success": false,
  "tool": "write_file",
  "validation_errors": [
    { "field": "content", "message": "Missing required field", "severity": "error" }
  ],
  "suggestions": ["Add a 'content' argument with the file content"],
  "example": "write_file(path='hello.py', content='print(\"hi\")')"
}
```

This turns every validation failure into a **teaching moment** — the model sees what it did wrong and can self-correct on the next attempt.

---

## Layer 4: Practice → Production Loop

> **Approach #5: Iterative Feedback** + **Approach #7: Synthetic Data**

### 4.1 Auto-Apply Practice Results

**Problem:** The practice system (`packages/shared/agent/practice/`) runs Training-Free GRPO and outputs enhanced agent configs to `configs/agents/practice/*.yaml`. But these are **never automatically applied** to the production agent.

**Solution:** Create an experience loader that reads practice outputs and injects them into production prompts.

**New file:** `packages/shared/agent/practice/experience-loader.ts`

```typescript
class ExperienceLoader {
  // Scan practice output files for new experiences
  async loadExperiences(model?: string): Promise<Experience[]> {
    const practiceDir = path.join(ROOT, 'configs/agents/practice');
    const files = await fs.readdir(practiceDir);

    const experiences: Experience[] = [];
    for (const file of files) {
      if (!file.endsWith('_agent.yaml')) continue;
      if (model && !file.includes(model)) continue;

      const content = await fs.readFile(path.join(practiceDir, file), 'utf-8');
      const parsed = yaml.load(content);
      const instructions = parsed?.agent?.instructions || '';

      // Extract experience section (after "When solving problems, you MUST...")
      const expMatch = instructions.match(/When solving problems.*?experiences?:\n([\s\S]*)/i);
      if (expMatch) {
        experiences.push({
          source: file,
          text: expMatch[1].trim(),
          createdAt: (await fs.stat(path.join(practiceDir, file))).mtimeMs,
        });
      }
    }

    return experiences.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Get experiences relevant to a specific task type
  async getExperiencesForTask(taskType: string, maxItems: number = 5): Promise<string[]> {
    const all = await this.loadExperiences();

    // Score relevance: keyword match + recency
    const scored = all.map(exp => ({
      text: exp.text,
      score: relevanceScore(exp.text, taskType) * 0.6 + recencyScore(exp.createdAt) * 0.4,
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems)
      .map(s => s.text);
  }

  // Build the experiences section of the system prompt
  async buildExperiencesSection(taskType: string, model: string, maxTokens: number): Promise<string> {
    const experiences = await this.getExperiencesForTask(taskType);

    let section = '\n## Learned Experiences\n\n';
    let tokenCount = estimateTokens(section);

    for (let i = 0; i < experiences.length; i++) {
      const line = `${i + 1}. ${experiences[i]}\n`;
      const lineTokens = estimateTokens(line);
      if (tokenCount + lineTokens > maxTokens) break;
      section += line;
      tokenCount += lineTokens;
    }

    return section;
  }
}
```

### 4.2 Shared Database: Python Practice ↔ TypeScript Agent

Create a shared SQLite database that both systems read/write:

**Modify:** `packages/shared/agent/practice/db.py` → add tables for cross-system sharing

```sql
-- Experience records (written by Python practice, read by TypeScript agent)
CREATE TABLE IF NOT EXISTS experience_records (
    id INTEGER PRIMARY KEY,
    experiment_name TEXT NOT NULL,
    step INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    batch INTEGER NOT NULL,
    experience_key TEXT NOT NULL,
    experience_text TEXT NOT NULL,
    task_type TEXT,              -- NEW: 'vfs_write', 'vfs_batch', etc.
    model TEXT,                  -- NEW: which model this applies to
    quality REAL DEFAULT 0.5,    -- NEW: verification score
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge chunks (few-shot examples, rules, solutions)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,          -- 'few_shot', 'experience', 'rule', 'task_solution'
    content TEXT NOT NULL,
    embedding BLOB,              -- serialized vector
    task_type TEXT,
    model TEXT,
    quality REAL DEFAULT 0.5,
    source TEXT,                 -- 'curated', 'practice', 'production'
    usage_count INTEGER DEFAULT 0,
    usefulness_score REAL DEFAULT 0.5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tool call log (written by TypeScript agent, read by Python practice)
CREATE TABLE IF NOT EXISTS tool_call_log (
    id INTEGER PRIMARY KEY,
    model TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args TEXT,                   -- JSON
    success BOOLEAN NOT NULL,
    error TEXT,
    task_type TEXT,
    task_id TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task trajectories (full input → output → result)
CREATE TABLE IF NOT EXISTS task_trajectories (
    id INTEGER PRIMARY KEY,
    task_input TEXT NOT NULL,
    task_type TEXT,
    model TEXT NOT NULL,
    tool_calls TEXT,             -- JSON array of tool calls made
    final_output TEXT,
    success BOOLEAN NOT NULL,
    retries INTEGER DEFAULT 0,
    tokens_used INTEGER,
    duration_ms INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 Continuous Practice on Real Trajectories

Instead of only practicing on hand-written tasks, collect **real agent trajectories**:

```
Production Agent Run
  │
  ├─ Task: "Create src/App.tsx with a React component"
  ├─ Model: gpt-4o-mini
  ├─ Tool calls: write_file(path="src/App.tsx", content="...") ✅
  ├─ Result: success, 1 retry, 4200 tokens
  │
  └─ Log to task_trajectories table

Periodic batch job (hourly):
  │
  ├─ Query: SELECT * FROM task_trajectories WHERE success = true AND retries <= 1
  ├─ For each successful trajectory:
  │   ├─ Convert to knowledge chunk:
  │   │   type = 'task_solution'
  │   │   content = input + "\n→" + tool_calls
  │   │   task_type = detected type
  │   │   quality = 1.0 - (retries * 0.2)
  │   │   source = 'production'
  │   │
  │   └─ Embed + insert into knowledge_chunks
  │
  └─ For failed trajectories:
      ├─ Extract failure pattern
      └─ Add to practice task queue (these become future practice tasks)
```

**New file:** `packages/shared/agent/practice/trajectory-miner.ts`

```typescript
class TrajectoryMiner {
  // Extract successful trajectories and convert to knowledge chunks
  async mineSuccessfulTrajectories(hoursBack: number = 24): Promise<number> {
    const cutoff = Date.now() - hoursBack * 3600_000;
    const trajectories = await db.query(
      `SELECT * FROM task_trajectories
       WHERE success = true AND retries <= 1 AND timestamp > ?`,
      [cutoff]
    );

    let inserted = 0;
    for (const t of trajectories) {
      const chunk: KnowledgeChunk = {
        type: 'task_solution',
        content: `${t.task_input}\n→ ${t.tool_calls}`,
        taskType: this.detectTaskType(t.task_input),
        model: t.model,
        quality: 1.0 - (t.retries * 0.2),
        source: 'production',
      };

      await knowledgeStore.insert(chunk);
      inserted++;
    }

    return inserted;
  }

  // Extract failure patterns for practice task generation
  async extractFailurePatterns(hoursBack: number = 24): Promise<FailurePattern[]> {
    const failures = await db.query(
      `SELECT * FROM task_trajectories
       WHERE success = false AND timestamp > ?`,
      [cutoff]
    );

    // Cluster failures by error pattern
    // Return patterns like: "batch_write with stringified JSON files", "apply_diff with invalid diff"
  }
}
```

### 4.4 Synthetic Example Generation

**Problem:** Practice tasks are hand-written. For comprehensive coverage, we need examples for every (task type × model) combination.

**Solution:** Use a strong model to generate ideal responses for tasks the weak model struggles with.

```
Known failure pattern: gpt-4o-mini can't do batch_write correctly (67% success)
  │
  ├─ Take the task: "Create Flask app with 3 files"
  ├─ Run with strong model (gpt-4o): get correct batch_write call
  ├─ Store as few-shot example tagged for gpt-4o-mini
  └─ Next time gpt-4o-mini gets this task, the example is in its prompt
```

**New file:** `packages/shared/agent/synthesis/example-generator.ts`

```typescript
class ExampleGenerator {
  async generateExamplesForWeakModel(
    weakModel: string,
    taskType: string,
    count: number
  ): Promise<FewShotExample[]> {
    // Get tasks where weak model failed
    const failedTasks = await db.query(
      `SELECT DISTINCT task_input FROM task_trajectories
       WHERE model = ? AND task_type = ? AND success = false
       LIMIT ?`,
      [weakModel, taskType, count * 3]
    );

    const examples: FewShotExample[] = [];
    for (const task of failedTasks) {
      // Run with strong model
      const strongResult = await runWithModel('gpt-4o', task.task_input);

      if (strongResult.success) {
        examples.push({
          id: `synthetic_${weakModel}_${taskType}_${examples.length}`,
          taskType,
          input: task.task_input,
          output: strongResult.toolCalls.map(tc =>
            `${tc.tool}(${formatArgs(tc.args)})`
          ).join('\n'),
          model: weakModel,
          quality: 1.0,
          source: 'synthetic',
        });
      }

      if (examples.length >= count) break;
    }

    return examples;
  }
}
```

---

## Layer 5: Model-Aware Routing

> **Approach #8: Provider-Supported Tuning** + **Approach #9: Engineering Notes**

### 5.1 Task Type + Model Recommendation

**Problem:** The task classifier (`task-classifier.ts`) outputs complexity (simple/moderate/complex) and recommendedMode (v1-api/v2-native/etc.) but does NOT recommend which specific model to use.

**Solution:** Extend the classifier with task type detection and model recommendation.

**Modify:** `packages/shared/agent/task-classifier.ts`

```typescript
// Add to TaskClassification interface:
interface TaskClassification {
  complexity: 'simple' | 'moderate' | 'complex';
  taskType: TaskType;                    // NEW
  recommendedModel?: string;             // NEW
  minModelCapability: number;            // NEW (0-1 scale)
  recommendedMode: string;
  confidence: number;
  factors: ClassificationFactors;
  reasoning: string[];
}

type TaskType =
  | 'vfs_write'        // Single file creation
  | 'vfs_batch'        // Multi-file creation
  | 'vfs_diff'         // Patch application
  | 'vfs_read'         // File reading
  | 'code_gen'         // Code generation (no file ops)
  | 'code_edit'        // Code modification
  | 'debug'            // Bug fixing
  | 'research'         // Information gathering
  | 'analysis'         // Data analysis
  | 'question'         // Simple Q&A
  | 'chat';            // Conversational

// Add model recommendation logic:
function recommendModel(classification: TaskClassification): string {
  const { taskType, complexity } = classification;

  // Task-type-specific recommendations
  if (taskType === 'vfs_diff') return 'claude-sonnet-4-5';  // Hard format
  if (taskType === 'vfs_batch') return complexity === 'simple' ? 'gpt-4o' : 'claude-sonnet-4-5';
  if (taskType === 'vfs_write') return complexity === 'simple' ? 'gpt-4o-mini' : 'gpt-4o';
  if (taskType === 'research') return 'claude-sonnet-4-5';    // Long context
  if (taskType === 'question') return 'gpt-4o-mini';          // Cheap
  if (taskType === 'chat') return 'gpt-4o-mini';

  // Default by complexity
  if (complexity === 'simple') return 'gpt-4o-mini';
  if (complexity === 'moderate') return 'gpt-4o';
  return 'claude-sonnet-4-5';
}
```

**Model recommendation matrix:**

| Task Type | Simple | Moderate | Complex |
|---|---|---|---|
| `vfs_write` | gpt-4o-mini | gpt-4o | gpt-4o |
| `vfs_batch` | gpt-4o | gpt-4o | claude-sonnet-4-5 |
| `vfs_diff` | claude-sonnet-4-5 | claude-sonnet-4-5 | claude-sonnet-4-5 |
| `code_gen` | gpt-4o-mini | gpt-4o | claude-sonnet-4-5 |
| `code_edit` | gpt-4o | gpt-4o | claude-sonnet-4-5 |
| `debug` | gpt-4o | gpt-4o | claude-sonnet-4-5 |
| `research` | gpt-4o | claude-sonnet-4-5 | claude-sonnet-4-5 |
| `analysis` | gpt-4o-mini | gpt-4o | gpt-4o |
| `question` | gpt-4o-mini | gpt-4o-mini | gpt-4o |
| `chat` | gpt-4o-mini | gpt-4o-mini | gpt-4o |

### 5.2 Per-Model Circuit Breaker

**Problem:** The existing circuit breaker (`unified-router.ts`) tracks failures at the provider level, not the model level. But different models from the same provider can have independent reliability.

**Solution:** Extend the circuit breaker to track per-model + per-task-type reliability.

**Modify:** `packages/shared/agent/unified-router.ts`

```typescript
interface ModelCircuitState {
  model: string;
  taskType?: string;         // NEW: failures can be task-type-specific
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  state: 'closed' | 'open' | 'half-open';
}

class ModelCircuitBreaker {
  // Check if a specific model is available for a task type
  isAvailable(model: string, taskType?: string): boolean {
    const key = taskType ? `${model}:${taskType}` : model;
    const state = this.getState(key);

    if (state.state === 'open') {
      const timeSinceFailure = Date.now() - state.lastFailureTime;
      if (timeSinceFailure >= this.config.recoveryTimeoutMs) {
        state.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  // Get the best available model for a task type
  getBestModelForTask(taskType: string, preferredModel: string): string {
    if (this.isAvailable(preferredModel, taskType)) return preferredModel;

    // Fall back to next capable model
    const fallbacks = MODEL_FALLBACKS[taskType] || DEFAULT_FALLBACKS;
    for (const model of fallbacks) {
      if (this.isAvailable(model, taskType)) return model;
    }

    return preferredModel; // Last resort: try anyway
  }
}

const MODEL_FALLBACKS: Record<string, string[]> = {
  'vfs_batch': ['gpt-4o', 'claude-sonnet-4-5'],
  'vfs_diff': ['claude-sonnet-4-5', 'gpt-4o'],
  'research': ['claude-sonnet-4-5', 'gpt-4o'],
  // Default fallback
  'default': ['gpt-4o', 'claude-sonnet-4-5', 'gpt-4o-mini'],
};
```

### 5.3 Per-Model Tool Success Tracking

**Modify:** `web/lib/chat/vercel-ai-tools.ts` → add telemetry

```typescript
// Log every tool call with outcome
async function logToolCall(model: string, toolName: string, args: any, success: boolean, error?: string) {
  await db.execute(
    `INSERT INTO tool_call_log (model, tool_name, args, success, error, timestamp)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [model, toolName, JSON.stringify(args), success, error]
  );
}

// Aggregate stats (for dashboard and routing decisions)
async function getModelToolStats(model: string): Promise<Record<string, { success: number; total: number }>> {
  const rows = await db.query(
    `SELECT tool_name,
            SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
            COUNT(*) as total_count
     FROM tool_call_log
     WHERE model = ?
     GROUP BY tool_name`,
    [model]
  );

  return Object.fromEntries(rows.map(r => [r.tool_name, {
    success: r.success_count,
    total: r.total_count,
  }]));
}
```

**Dashboard view** (conceptual):

```
Model: gpt-4o-mini
  write_file:    92% success (184/200)
  batch_write:   67% success (67/100)   ← needs practice
  apply_diff:    45% success (18/40)    ← critical gap
  read_file:     98% success (196/200)
  list_files:    95% success (95/100)

Model: claude-sonnet-4-5
  write_file:    97% success (194/200)
  batch_write:   89% success (89/100)
  apply_diff:    82% success (33/40)
  read_file:     99% success (198/200)
  list_files:    99% success (99/100)
```

---

## Implementation Phases

### Phase 1: Quick Wins (1–2 weeks) — Highest ROI, Lowest Effort

| # | Item | Files to Create/Modify | Description |
|---|---|---|---|
| 1a | **Pre-execution tool validator** | Create: `packages/shared/agent/verification/tool-validator.ts` | Validate tool calls before execution, return structured errors with examples |
| 1b | **Post-execution self-check** | Modify: `web/lib/orchestra/unified-agent-service.ts` | Verify that claimed tool calls match actual invocations |
| 1c | **Task type detection** | Modify: `packages/shared/agent/task-classifier.ts` | Add `taskType` field to classification output |
| 1d | **Enhanced tool descriptions** | Modify: `web/lib/mcp/vfs-mcp-tools.ts` | Add few-shot examples to tool schema descriptions (e.g., "Example: write_file(path='hello.py', content='...')") |

**Expected impact:** 10-15% improvement in VFS tool success rates from validation feedback alone.

### Phase 2: Prompt Engine + Model Routing (2–3 weeks)

| # | Item | Files to Create/Modify | Description |
|---|---|---|---|
| 2a | **Model-specific prompt variants** | Create: `packages/shared/agent/prompt-engine/model-variants.ts` | Tier-based prompt configuration (small/medium/large models) |
| 2b | **Few-shot library** | Create: `packages/shared/agent/prompt-engine/few-shot-library.ts` | Task-matched example injection (20+ curated examples) |
| 2c | **Model recommendation** | Modify: `packages/shared/agent/task-classifier.ts` | Extend classifier with `recommendedModel` + `taskType` |
| 2d | **Per-model circuit breaker** | Modify: `packages/shared/agent/unified-router.ts` | Per-model + per-task-type fault tolerance |
| 2e | **Tool success tracking** | Modify: `web/lib/chat/vercel-ai-tools.ts` | Log every tool call with outcome to `tool_call_log` table |

**Expected impact:** 20-30% cost reduction from routing simple tasks to cheaper models; 15% improvement in tool success rates from model-matched prompts.

### Phase 3: RAG Knowledge Pipeline (3–4 weeks)

| # | Item | Files to Create/Modify | Description |
|---|---|---|---|
| 3a | **Knowledge vector store** | Create: `packages/shared/agent/rag/knowledge-store.ts` | Server-side persistent storage (SQLite + sqlite-vec) |
| 3b | **Shared database schema** | Modify: `packages/shared/agent/practice/db.py` | Add `experience_records`, `knowledge_chunks`, `tool_call_log`, `task_trajectories` tables |
| 3c | **Corpus preparation** | Create: `scripts/rag/populate-knowledge.ts` | Seed from curated examples + practice outputs |
| 3d | **Retrieval pipeline** | Create: `packages/shared/agent/rag/retrieval.ts` | Query → embed → search → rerank → filter |
| 3e | **Prompt integration** | Modify: `web/lib/orchestra/shared-agent-context.ts` | Inject retrieved context into system prompt |
| 3f | **Retrieval feedback** | Create: `packages/shared/agent/rag/feedback.ts` | Track which retrieved chunks were actually useful |

**Expected impact:** 25-40% improvement on tasks similar to past examples; reduced hallucination from grounded responses.

### Phase 4: Practice → Production Loop (2–3 weeks)

| # | Item | Files to Create/Modify | Description |
|---|---|---|---|
| 4a | **Experience loader** | Create: `packages/shared/agent/practice/experience-loader.ts` | Auto-apply practice results to production prompts |
| 4b | **Trajectory miner** | Create: `packages/shared/agent/practice/trajectory-miner.ts` | Convert successful trajectories to knowledge chunks |
| 4c | **Synthetic example generator** | Create: `packages/shared/agent/synthesis/example-generator.ts` | Use strong model to generate ideal responses for weak-model gaps |
| 4d | **Practice bridge** | Modify: `packages/shared/agent/practice/rollout_manager.py` | Connect Python practice to TypeScript agent for real trajectory practice |
| 4e | **Continuous practice scheduler** | Create: `packages/shared/agent/practice/scheduler.ts` | Periodic job: mine trajectories → generate practice tasks → run GRPO → update prompts |

**Expected impact:** Self-improving system — every production run makes the agent smarter. VFS tool success rates compound over time.

### Phase 5: Synthetic Data + Dashboard (ongoing)

| # | Item | Files to Create/Modify | Description |
|---|---|---|---|
| 5a | **Validation pipeline** | Create: `packages/shared/agent/synthesis/validator.ts` | Schema + tool + quality checks for synthetic examples |
| 5b | **Web dashboard** | New page in web app | Per-model tool success rates, improvement trends, practice status |
| 5c | **A/B testing framework** | Modify: `packages/shared/agent/prompt-composer.ts` | Test prompt variants and measure downstream performance |
| 5d | **Cost optimization** | Modify: `packages/shared/agent/unified-router.ts` | Track token cost per task, prefer cheaper models when quality is acceptable |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Request                                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: Model-Aware Router (unified-router.ts + task-classifier.ts)       │
│                                                                             │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────────┐  │
│  │ Task Classifier  │───▶│ Model Recommender │───▶│ Circuit Breaker      │  │
│  │                  │    │                   │    │                      │  │
│  │ complexity:      │    │ taskType → model  │    │ Per-model +          │  │
│  │ taskType: vfs_   │    │ vfs_batch → gpt-4o│    │ per-task-type        │  │
│  │ confidence: 0.85 │    │ vfs_diff → claude │    │ state tracking       │  │
│  └──────────────────┘    └───────────────────┘    └──────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: RAG Knowledge Retrieval                                           │
│                                                                             │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────────┐  │
│  │ Query Prep       │───▶│ Coarse Retrieval  │───▶│ Rerank + Filter      │  │
│  │                  │    │                   │    │                      │  │
│  │ Normalize        │    │ Vector: top-20    │    │ Score = relevance    │  │
│  │ Detect taskType  │    │ BM25: top-20      │    │   × quality          │  │
│  │ Extract entities │    │ Union + dedup     │    │   × recency          │  │
│  │ Embed query      │    │                   │    │   × usage_boost      │  │
│  └──────────────────┘    └───────────────────┘    └──────────────────────┘  │
│                                                                             │
│  Knowledge Store (SQLite + sqlite-vec):                                     │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐              │
│  │ few_shot   │ │ experience │ │ rule      │ │ task_solution │              │
│  │ (20 chunks)│ │ (50 chunks)│ │ (30 ch.)  │ │ (growing)     │              │
│  └────────────┘ └────────────┘ └───────────┘ └──────────────┘              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Dynamic Prompt Engine (prompt-engine/ + prompt-composer.ts)       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  IDENTITY        "You are an expert software engineer..."            │    │
│  │  TOOL SCHEMA     write_file(path, content) + few-shot example        │    │
│  │  FEW-SHOT        3 task-matched examples (from few-shot-library)     │    │
│  │  EXPERIENCES     5 learned rules (from practice → experience-loader) │    │
│  │  RETRIEVED       3 similar past tasks (from RAG retrieval)           │    │
│  │  CONSTRAINTS     Output format, guardrails                           │    │
│  │                                                         [token budget│    │
│  │                                                          enforced]   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: Verification & Self-Healing (tool-validator.ts + plan-act-verify) │
│                                                                             │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────────┐  │
│  │ Pre-Execution    │───▶│ Tool Execution    │───▶│ Post-Execution       │  │
│  │ Validation       │    │                   │    │ Self-Check           │  │
│  │                  │    │ VFS MCP Tools     │    │                      │  │
│  │ • Required fields│    │ (with normalized  │    │ • Claimed vs actual  │  │
│  │ • Type checks   │    │  args)            │    │   tool calls         │  │
│  │ • batch_write   │    │                   │    │ • Output correctness │  │
│  │   structure     │    │ • write_file      │    │ • Syntax verification│  │
│  │ • diff format   │    │ • batch_write     │    │   (AST parsing)      │  │
│  │                  │    │ • apply_diff      │    │                      │  │
│  │ On failure:     │    │                   │    │ On failure:          │  │
│  │ Return error    │    │ On failure:       │    │ Regenerate with      │  │
│  │ with examples   │    │ Structured error  │    │ feedback             │  │
│  │ to model        │    │ with suggestions  │    │                      │  │
│  └──────────────────┘    └───────────────────┘    └──────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 4: Practice → Production Loop (practice/ + synthesis/)               │
│                                                                             │
│  ┌──────────────────┐         ┌───────────────────┐                        │
│  │ Practice (Python)│         │ Production (TS)   │                        │
│  │                  │         │                   │                        │
│  │ GRPO: rollout ×3 │         │ Real trajectories │                        │
│  │ Judge each       │         │ Tool call logging │                        │
│  │ Extract exps     │◀───────▶│ Trajectory mining │                        │
│  │ Save YAML config │  shared │                   │                        │
│  │                  │  SQLite │                   │                        │
│  └────────┬─────────┘         └────────┬──────────┘                        │
│           │                            │                                    │
│           ▼                            ▼                                    │
│  ┌───────────────────────────────────────────────────┐                      │
│  │ Experience Loader: auto-apply to production prompts│                      │
│  │ Synthetic Generator: strong-model examples for     │                      │
│  │   weak-model gaps                                  │                      │
│  └───────────────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cost Estimates

| Layer | Per-Request Overhead | Monthly (10k requests) |
|---|---|---|
| **Model routing** | Negligible (local classifier) | ~$0 |
| **Few-shot injection** | ~500 extra tokens | ~$0.50 (gpt-4o-mini rate) |
| **RAG retrieval** | 1 embed + rerank call | ~$2.00 |
| **Tool verification** | 0.5 verification call avg | ~$1.00 |
| **Practice (batch)** | 108 calls/run, 2 runs/week | ~$0.10 |
| **Total overhead** | | **~$3.60/month** |

### Savings from Improvement

If `batch_write` success rate for `gpt-4o-mini` improves from 67% → 90%:

| Metric | Before | After | Savings |
|---|---|---|---|
| Retry rate | 33% | 10% | -23% |
| Wasted calls/month (10k tasks) | 3,300 | 1,000 | -2,300 |
| Cost of wasted calls @ $0.002 | $6.60 | $2.00 | -$4.60 |
| **Net: investment pays back in month 1** | | | |

---

## Success Metrics

| Metric | Current (est.) | Target | Measurement |
|---|---|---|---|
| `write_file` success (gpt-4o-mini) | ~85% | >95% | `tool_call_log` table |
| `batch_write` success (gpt-4o-mini) | ~55-67% | >85% | `tool_call_log` table |
| `apply_diff` success (gpt-4o-mini) | ~40-45% | >75% | `tool_call_log` table |
| Avg retries per task | ~1.8 | <1.2 | Agent loop counter |
| Token cost per task | ~12k avg | <8k avg | Usage tracking |
| Practice → production cycle | Manual | <1hr automated | Pipeline timing |
| Hallucinated tool calls | ~10% | <2% | Self-check verifier |
| Retrieval hit rate | N/A (new) | >60% | Retrieval feedback |
| Cost per successful task | N/A | <20% reduction | Billing data |

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Token budget overflow from too many prompt sections | High | Medium | Priority-based truncation in prompt builder; hard cap at model's context limit |
| Stale experiences in knowledge store | Medium | Medium | Time-based decay in reranker: `recency = exp(-age/30)`; auto-prune after 90 days |
| Practice system produces low-quality experiences | Medium | Low | Human review gate for first 3 practice runs; quality threshold (only inject if avg quality > 0.7) |
| Vector store becomes bottleneck | Low | Low | Start with SQLite + sqlite-vec (handles 100k chunks easily); migrate to pgvector at 500k+ |
| Model routing sends hard tasks to weak models | High | Medium | Circuit breaker with fast failover; conservative defaults (prefer stronger model when confidence < 0.5) |
| PII leaked to external APIs | Critical | Low | Strip PII before embedding; log sanitization in trajectory miner; encrypted fields in shared DB |
| Prompt drift over time (experiences contradict each other) | Medium | Low | Experience deduplication by semantic similarity; critique phase in GRPO detects contradictions |
| Increased latency from RAG + verification | Medium | High | Async retrieval (prefetch); cache frequent queries; skip verification for high-confidence model outputs |

---

## Appendix: File Inventory

### New Files to Create

```
packages/shared/agent/
├── prompt-engine/
│   ├── model-variants.ts              # Tier-based prompt configuration
│   └── few-shot-library.ts            # Curated task-matched examples
├── verification/
│   └── tool-validator.ts              # Pre-execution validation
├── rag/
│   ├── knowledge-store.ts             # Server-side vector store
│   ├── retrieval.ts                   # Query → embed → search → rerank
│   └── feedback.ts                    # Retrieval effectiveness tracking
├── practice/
│   ├── experience-loader.ts           # Auto-apply practice to production
│   ├── trajectory-miner.ts            # Convert successes to knowledge chunks
│   └── scheduler.ts                   # Periodic practice automation
├── synthesis/
│   ├── example-generator.ts           # Strong-model generation for weak-model gaps
│   └── validator.ts                   # Schema + quality validation
└── (modify existing)
    ├── task-classifier.ts             # Add taskType + recommendedModel
    ├── unified-router.ts              # Add per-model circuit breaker
    └── prompt-composer.ts             # Integrate few-shot injection

web/lib/
├── mcp/
│   └── vfs-mcp-tools.ts               # Add examples to tool descriptions
├── orchestra/
│   ├── unified-agent-service.ts       # Integrate validator + self-check
│   └── shared-agent-context.ts        # Inject retrieved context
└── chat/
    └── vercel-ai-tools.ts             # Add tool call telemetry
```

### Existing Files to Leverage

```
packages/shared/agent/system-prompts.ts          # Base prompts (3542 lines)
packages/shared/agent/prompt-composer.ts          # Section composition API
packages/shared/agent/task-classifier.ts          # Multi-factor classifier (extend)
packages/shared/agent/unified-router.ts           # Router (extend circuit breaker)
packages/shared/agent/orchestration/plan-act-verify.ts  # Self-healing (extend)
packages/shared/agent/practice/                   # Python practice system (bridge to TS)
packages/shared/agent/practice/verify/            # Verifiers (add more task types)
web/lib/orchestra/stateful-agent/agents/verification.ts  # Syntax verification
web/lib/retrieval/hybrid-retrieval.ts             # Retrieval patterns to adapt
web/lib/memory/vectorStore.ts                     # Storage patterns to replicate server-side
```

---

## Quick Start: What to Build First

If you want immediate impact with minimal effort, start here:

### Day 1: Add few-shot examples to VFS tool descriptions

**File:** `web/lib/mcp/vfs-mcp-tools.ts`

Add `description` examples to each tool:

```typescript
export const writeFileTool = tool({
  description: `Create or overwrite a file in the VFS.

Required arguments:
- path (string): The file path, e.g. "src/App.tsx"
- content (string): The file content

Examples of correct usage:
  write_file(path="hello.py", content="print('Hello World')")
  write_file(path="src/App.tsx", content="export default function App() { return <div>Hello</div> }")

Common mistakes to avoid:
  ❌ create_file(...)        → Use write_file instead
  ❌ writeFile(path=...)     → Use write_file (underscore, not camelCase)
  ❌ write_file(file=...)    → Use path, not file
  ❌ write_file(path=..., code=...)  → Use content, not code`,
  parameters: z.preprocess(
    (raw) => normalizeToolArgs('write_file', raw),
    z.object({
      path: z.string().describe('File path, e.g. "src/App.tsx"'),
      content: z.string().describe('File content'),
      commitMessage: z.string().optional(),
    })
  ).passthrough(),
  // ...
});
```

This single change — adding examples directly to tool descriptions — is the **single highest-ROI change** for improving smaller models' tool usage. It costs nothing, requires no new infrastructure, and works immediately.

### Day 2: Pre-execution validator

**File:** `packages/shared/agent/verification/tool-validator.ts`

Catch structural errors before they reach the tool, return corrective feedback to the model.

### Day 3: Task type detection

**File:** `packages/shared/agent/task-classifier.ts`

Add `taskType` to classification output. Use keyword patterns to detect `vfs_write`, `vfs_batch`, `vfs_diff`, etc.

These three changes alone should yield a **15-25% improvement** in VFS tool success rates for less capable models.
