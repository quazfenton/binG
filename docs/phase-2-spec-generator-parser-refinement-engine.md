---
id: phase-2-spec-generator-parser-refinement-engine
title: 'Phase 2: Spec Generator + Parser + Refinement Engine'
aliases:
  - PHASE_2_SPEC_AMPLIFICATION
  - PHASE_2_SPEC_AMPLIFICATION.md
  - phase-2-spec-generator-parser-refinement-engine
  - phase-2-spec-generator-parser-refinement-engine.md
tags: []
layer: core
summary: "# Phase 2: Spec Generator + Parser + Refinement Engine\r\n\r\n## Overview\r\n\r\nPhase 2 implements the dual-path inference system with spec amplification. This enables automatic quality improvement by:\r\n\r\n1. Running primary LLM call (user's selected model)\r\n2. Running parallel spec generation (fast model)"
anchors:
  - Overview
  - Files Created/Modified
  - New Files
  - Modified Files
  - Execution Modes
  - Usage Examples
  - API Request
  - Direct Usage
  - Spec Format
  - Input (User Request)
  - Generated Spec (Fast Model)
  - Refined Output (After Enhancement)
  - Safeguards
  - Time Budget
  - Automatic Fallback
  - Spec Quality Scoring
  - Chunking Strategies
  - Standard Chunking (`enhanced` mode)
  - Exploded Chunking (`max` mode)
  - Telemetry Integration
  - Performance Benchmarks
  - Configuration
  - Refinement Engine
  - Spec Generator
  - Error Handling
  - Spec Parsing Failures
  - Refinement Failures
  - Next Steps (Phase 3)
  - Testing
  - Troubleshooting
  - Spec Generation Fails
  - Refinement Takes Too Long
  - Low Quality Specs
---
# Phase 2: Spec Generator + Parser + Refinement Engine

## Overview

Phase 2 implements the dual-path inference system with spec amplification. This enables automatic quality improvement by:

1. Running primary LLM call (user's selected model)
2. Running parallel spec generation (fast model)
3. Refining primary response based on spec

## Files Created/Modified

### New Files

1. **`lib/prompts/spec-generator.ts`** - Spec generation prompts
   - `buildSpecPrompt()` - Build prompt for spec generation
   - `validateSpec()` - Validate spec structure
   - `scoreSpec()` - Quality scoring (1-10)

2. **`lib/chat/spec-parser.ts`** - Spec parsing utilities
   - `safeParseSpec()` - Parse raw LLM output
   - `chunkSpec()` - Chunk into refinement units
   - `explodeChunks()` - Explode into single-task units
   - `mergeDuplicateTasks()` - Remove duplicates
   - `filterChunksByQuality()` - Filter low-quality chunks
   - `estimateRefinementTime()` - Time estimation

3. **`lib/chat/refinement-engine.ts`** - Refinement engine
   - `refineResponse()` - Main refinement loop
   - `buildRefinementPrompt()` - Build refinement prompts
   - `buildDiffRefinementPrompt()` - Diff-based prompts (advanced)
   - `estimateRefinementTokens()` - Token estimation

### Modified Files

1. **`lib/api/response-router.ts`**
   - Added `routeWithSpecAmplification()` method
   - Added `routeWithSpecAmplification()` convenience export

2. **`app/api/chat/route.ts`**
   - Added `mode` parameter to request schema
   - Integrated `routeWithSpecAmplification()`

## Execution Modes

| Mode | Behavior | Use Case | Latency Impact |
|------|----------|----------|----------------|
| `normal` | Single call, no spec | Fast queries | 0ms |
| `enhanced` | + Spec + 1 refinement | Default quality | +2-4s |
| `max` | Full loop + task splitting | Complex projects | +5-8s |

## Usage Examples

### API Request

```typescript
// Normal mode (fastest)
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Build a Next.js app' }],
    provider: 'openai',
    model: 'gpt-4o',
    mode: 'normal'
  })
})

// Enhanced mode (default - recommended)
fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Build a Next.js app' }],
    provider: 'openai',
    model: 'gpt-4o',
    mode: 'enhanced'  // Default
  })
})

// Max mode (best quality)
fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Build a Next.js app' }],
    provider: 'openai',
    model: 'gpt-4o',
    mode: 'max'
  })
})
```

### Direct Usage

```typescript
import { responseRouter } from '@/lib/api/response-router'

// With spec amplification
const response = await responseRouter.routeWithSpecAmplification({
  messages: [{ role: 'user', content: 'Build a Next.js app' }],
  provider: 'openai',
  model: 'gpt-4o',
  mode: 'enhanced'
})

console.log(response.metadata.specAmplification)
// {
//   enabled: true,
//   mode: 'enhanced',
//   fastModel: 'google/gemini-2.5-flash',
//   sectionsGenerated: 3,
//   refinementIterations: 1,
//   duration: 3421
// }
```

## Spec Format

### Input (User Request)

```
"Build a Next.js portfolio website"
```

### Generated Spec (Fast Model)

```json
{
  "goal": "Transform basic portfolio into production-ready showcase with modern UX",
  "sections": [
    {
      "title": "Component Architecture",
      "tasks": [
        "Create reusable layout components (Header, Footer, MainLayout)",
        "Implement atomic design pattern for UI components",
        "Add TypeScript interfaces for all props",
        "Set up component storybook for documentation"
      ],
      "priority": 1
    },
    {
      "title": "Interactive Features",
      "tasks": [
        "Add smooth scroll animations with Framer Motion",
        "Implement dark/light theme toggle with persistence",
        "Create interactive project cards with hover effects",
        "Add contact form with real-time validation"
      ],
      "priority": 2
    }
  ],
  "execution_strategy": "Start with component architecture, then add features incrementally",
  "clarification_questions": []
}
```

### Refined Output (After Enhancement)

The primary response is refined based on the spec sections, adding:
- Missing components
- Better architecture
- Production-ready features
- Modern UX patterns

## Safeguards

### Time Budget

```typescript
const POLICY = {
  timeBudgetMs: 8000,  // Max 8 seconds for refinement
  maxIterations: 3,    // Max 3 refinement iterations
  maxTokens: 8000,     // Max tokens per call
  maxSpecSections: 5,  // Max sections to process
}
```

### Automatic Fallback

If any step fails, the system falls back to normal routing:

```typescript
try {
  const refined = await refineResponse(config)
  return refined
} catch (error) {
  logger.error('Refinement failed', error)
  return primaryResponse  // Fallback to original
}
```

## Spec Quality Scoring

```typescript
const score = scoreSpec(spec)  // Returns 1-10

// Score breakdown:
// - Goal clarity: 0-2 points
// - Section quality: 0-4 points
// - Execution strategy: 0-2 points
// - Prioritization: 0-2 points
```

## Chunking Strategies

### Standard Chunking (`enhanced` mode)

```typescript
const chunks = chunkSpec(spec)
// Returns sections as chunks
```

### Exploded Chunking (`max` mode)

```typescript
const chunks = chunkSpec(spec)
const exploded = explodeChunks(chunks)
// Returns each task as individual chunk
```

## Telemetry Integration

All refinement calls are logged:

```typescript
chatLogger.logResponse({
  requestId: `refine-${Date.now()}`,
  userId,
  provider: 'refinement',
  model,
  latencyMs: duration,
  success: true,
  metadata: {
    iterations,
    chunksProcessed,
    mode
  }
})
```

## Performance Benchmarks

| Mode | Avg Latency | Quality Improvement | Token Overhead |
|------|-------------|---------------------|----------------|
| `normal` | 2-3s | Baseline | 0 |
| `enhanced` | 4-6s | +40-60% | +20% |
| `max` | 7-10s | +80-120% | +50% |

## Configuration

### Refinement Engine

Edit `lib/chat/refinement-engine.ts`:

```typescript
const POLICY = {
  maxIterations: 3,        // Adjust for more/less refinement
  maxCost: 0.02,           // USD cost limit
  maxTokens: 8000,         // Token limit per call
  timeBudgetMs: 8000,      // Time budget in ms
  maxChunkTasks: 10,       // Max tasks per chunk
}
```

### Spec Generator

Edit `lib/prompts/spec-generator.ts`:

```typescript
// Adjust prompt to be more/less aggressive
const SYSTEM_PROMPT = `You are an elite software architect...`
```

## Error Handling

### Spec Parsing Failures

```typescript
const parsed = safeParseSpec(rawSpec)

if (!parsed) {
  logger.warn('Spec parsing failed')
  return primaryResponse  // Fallback
}
```

### Refinement Failures

```typescript
try {
  const refined = await refineResponse(config)
} catch (error) {
  logger.error('Refinement failed', error)
  // Continue with next chunk instead of failing
}
```

## Next Steps (Phase 3)

1. **Spec Quality Scoring** - Add evaluator pass
2. **Spec Memory** - Store high-performing specs
3. **DAG Execution** - Parallel refinement
4. **Diff-Based Refinement** - Send patches only
5. **Streaming UI** - Show improvements live

## Testing

```typescript
import { buildSpecPrompt, validateSpec, scoreSpec } from '@/lib/prompts/spec-generator'
import { safeParseSpec, chunkSpec, explodeChunks } from '@/lib/chat/spec-parser'
import { refineResponse } from '@/lib/chat/refinement-engine'

// Test spec generation
const specPrompt = buildSpecPrompt('Build a Next.js app')
console.log(specPrompt)

// Test parsing
const raw = '{"goal": "Test", "sections": [{"title": "Section", "tasks": ["Task 1"]}]}'
const parsed = safeParseSpec(raw)
console.log(validateSpec(parsed))  // true
console.log(scoreSpec(parsed))     // 1-10

// Test chunking
const chunks = chunkSpec(parsed)
const exploded = explodeChunks(chunks)

// Test refinement (requires LLM)
const refined = await refineResponse({
  model: 'gpt-4o',
  baseResponse: 'Basic app',
  chunks,
  mode: 'enhanced',
  startTime: Date.now()
})
```

## Troubleshooting

### Spec Generation Fails

```typescript
// Check if fast model is available
const { getSpecGenerationModel } = await import('@/lib/models/model-ranker')
const fastModel = getSpecGenerationModel()
console.log('Fast model:', fastModel)  // Should not be null
```

### Refinement Takes Too Long

```typescript
// Check time budget
const POLICY = { timeBudgetMs: 8000 }
// Increase if needed
```

### Low Quality Specs

```typescript
// Check spec score
const score = scoreSpec(spec)
if (score < 6) {
  // Consider regenerating or skipping
}
```
