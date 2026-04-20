---
id: prompt-parameters-integration-plan
title: Prompt Parameters Integration Plan
aliases:
  - PROMPT_PARAMETERS_INTEGRATION_PLAN
  - PROMPT_PARAMETERS_INTEGRATION_PLAN.md
  - prompt-parameters-integration-plan
  - prompt-parameters-integration-plan.md
tags: []
layer: core
summary: "# Prompt Parameters Integration Plan\r\n\r\n## Overview\r\n\r\nThis plan details how to integrate the `PromptParameters` system (response depth, expertise level, reasoning mode, tone, etc.) into the existing codebase — covering API contracts, backend integration points, UI components, and configuration pers"
anchors:
  - Overview
  - 1. API Contract Changes
  - 1.1 Extend `chatRequestSchema`
  - 2. Backend Integration Points
  - 'Priority Order: Highest impact first'
  - 2.1 `web/app/api/chat/route.ts` — Primary Integration (CRITICAL)
  - 2.2 `packages/shared/agent/opencode-direct.ts` — OpenCode Direct (HIGH)
  - >-
    2.3 `packages/shared/agent/orchestration-mode-handler.ts` — Orchestration
    Modes (HIGH)
  - 2.4 `packages/shared/agent/task-router.ts` — Task Router (MEDIUM)
  - 2.5 `packages/shared/agent/v2-executor.ts` — V2 Executor (MEDIUM)
  - >-
    2.6 `web/lib/orchestra/unified-agent-service.ts` — Unified Agent Service
    (MEDIUM)
  - 3. UI Components
  - 3.1 Create Response Style Selector Component
  - 3.2 Integrate into Interaction Panel
  - 3.3 Integrate into Agent Tab
  - 3.4 Integrate into Settings Panel
  - 4. Request Flow Integration
  - 4.1 Conversation Interface
  - 4.2 Workspace Panel (Chat Sender)
  - 5. Configuration & Persistence
  - 5.1 Create Response Style Context
  - 5.2 Environment Variable Defaults
  - 6. Phase Implementation Order
  - 'Phase 1: Backend Foundation (1-2 days)'
  - 'Phase 2: Additional Backend Paths (1 day)'
  - 'Phase 3: UI Components (2-3 days)'
  - 'Phase 4: Polish & Testing (1 day)'
  - 7. Risk Assessment
  - 8. Files to Modify Summary
---
# Prompt Parameters Integration Plan

## Overview

This plan details how to integrate the `PromptParameters` system (response depth, expertise level, reasoning mode, tone, etc.) into the existing codebase — covering API contracts, backend integration points, UI components, and configuration persistence.

---

## 1. API Contract Changes

### 1.1 Extend `chatRequestSchema`

**File:** `web/app/api/chat/chat-helpers.ts`

**Current schema already has:** `temperature`, `maxTokens`, `stream`, `agentMode`, `mode`

**Add:**

```typescript
// New optional prompt parameter fields
responseDepth: z.enum(['minimal', 'brief', 'standard', 'detailed', 'comprehensive', 'exhaustive']).optional(),
expertiseLevel: z.enum(['layperson', 'informed', 'practitioner', 'expert', 'world-class']).optional(),
reasoningMode: z.enum(['direct', 'structured', 'analytical', 'deliberative', 'dialectical', 'socratic']).optional(),
tone: z.enum(['formal', 'professional', 'conversational', 'casual', 'authoritative', 'tentative']).optional(),
creativityLevel: z.enum(['strictly-factual', 'evidence-based', 'balanced', 'exploratory', 'creative']).optional(),
outputFormat: z.enum(['prose', 'bulleted', 'tabular', 'mixed', 'outline', 'json']).optional(),
selfCorrection: z.enum(['none', 'light', 'thorough', 'iterative']).optional(),
presetKey: z.string().optional(), // e.g., 'QuickAnswer', 'MaximumRigor'
```

**Location:** After `mode` field in the schema (~line 25-30 of `chat-helpers.ts`)

---

## 2. Backend Integration Points

### Priority Order: Highest impact first

### 2.1 `web/app/api/chat/route.ts` — Primary Integration (CRITICAL)

**Why:** This is the main chat API route. Every chat request flows through here. Changes here affect all downstream modes.

**Current (line ~603):**
```typescript
const config: UnifiedAgentConfig = {
  conversationHistory: contextualMessages.map(...),
  systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
  maxSteps: parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
  temperature,
  maxTokens,
  mode: 'auto',
};
```

**Change to:**
```typescript
import { applyPromptModifiers, getPreset, PROMPT_PRESETS, PromptParameters } from '@bing/shared/agent/prompt-parameters';

// Extract prompt parameters from request body
const promptParams: PromptParameters = {
  responseDepth: body.responseDepth,
  expertiseLevel: body.expertiseLevel,
  reasoningMode: body.reasoningMode,
  tone: body.tone,
  creativityLevel: body.creativityLevel,
  outputFormat: body.outputFormat,
  selfCorrection: body.selfCorrection,
};

// If preset is specified, merge it with explicit overrides
let promptSuffix = '';
if (body.presetKey && body.presetKey in PROMPT_PRESETS) {
  const preset = getPreset(body.presetKey as keyof typeof PROMPT_PRESETS);
  promptSuffix = applyPromptModifiers({ ...preset, ...promptParams });
} else if (Object.values(promptParams).some(v => v !== undefined)) {
  promptSuffix = applyPromptModifiers(promptParams);
}

const baseSystemPrompt = process.env.OPENCODE_SYSTEM_PROMPT || '';
const config: UnifiedAgentConfig = {
  conversationHistory: contextualMessages.map(...),
  systemPrompt: promptSuffix ? baseSystemPrompt + promptSuffix : baseSystemPrompt,
  maxSteps: parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
  temperature,
  maxTokens,
  mode: 'auto',
};
```

**Impact:** All downstream consumers (v1-api, v2-native, stateful-agent, desktop, mastra-workflow) already respect `config.systemPrompt`, so the modifier suffix flows through automatically.

---

### 2.2 `packages/shared/agent/opencode-direct.ts` — OpenCode Direct (HIGH)

**Why:** Direct OpenCode invocation path used by V2 executor and agent-loop.

**Current (line 109):**
```typescript
systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
```

**Change to:**
- Extend `OpenCodeDirectOptions` interface with `promptParams?: PromptParameters`
- Construct system prompt: `const systemPrompt = (process.env.OPENCODE_SYSTEM_PROMPT || '') + applyPromptModifiers(options.promptParams ?? {})`

---

### 2.3 `packages/shared/agent/orchestration-mode-handler.ts` — Orchestration Modes (HIGH)

**Why:** Handles 12 orchestration modes (task-router, unified-agent, stateful-agent, etc.). Each mode passes a system prompt to LLM calls.

**Current (line ~198):**
```typescript
systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
```

**Change to:**
- Extend `ModeConfig` interface with `promptParams?: PromptParameters`
- In each mode handler (unified-agent, execution-graph, crewai, mastra-workflow), append `applyPromptModifiers(promptParams)` to the system prompt

---

### 2.4 `packages/shared/agent/task-router.ts` — Task Router (MEDIUM)

**Why:** Used for task routing and V2 OpenCode execution.

**Current (line 750):**
```typescript
systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
```

**Change to:**
- Extend `TaskRequest` interface with `promptParams?: PromptParameters`
- Construct: `systemPrompt: (process.env.OPENCODE_SYSTEM_PROMPT || '') + applyPromptModifiers(request.promptParams ?? {})`

---

### 2.5 `packages/shared/agent/v2-executor.ts` — V2 Executor (MEDIUM)

**Why:** Delegates to `opencode-direct.ts`. Adding prompt params to `V2ExecuteOptions` lets them flow through.

**Change to:**
- Extend `V2ExecuteOptions` with `promptParams?: PromptParameters`
- Pass through to `runOpenCodeDirect({ ..., promptParams })`

---

### 2.6 `web/lib/orchestra/unified-agent-service.ts` — Unified Agent Service (MEDIUM)

**Why:** Central hub that routes to 7+ execution engines (OpenCode, Desktop, StatefulAgent, V2, V1 API).

**Current pattern at lines 384, 469, 596, 642, 720, 776:**
```typescript
systemPrompt: config.systemPrompt || 'default prompt...'
```

**Change to:**
- Extend `UnifiedAgentConfig` with `promptParams?: PromptParameters`
- In each engine branch, construct: `config.systemPrompt || 'default...' + applyPromptModifiers(config.promptParams ?? {})`

---

## 3. UI Components

### 3.1 Create Response Style Selector Component

**New file:** `web/components/response-style-selector.tsx`

A compact dropdown or pill selector that maps to `PromptParameters`:

```tsx
interface ResponseStyleSelectorProps {
  value: PromptParameters;
  onChange: (params: PromptParameters) => void;
  className?: string;
}
```

**UI Design:**
- Compact pill-based selector for presets: `[Quick] [Standard] [Deep] [Expert] [Creative]`
- "Custom" expands to dropdowns for individual parameters
- Persists selection to localStorage as `response_style_params`

---

### 3.2 Integrate into Interaction Panel

**File:** `web/components/interaction-panel.tsx` (~line 400-500, near ProviderSelector)

**Add:**
```tsx
import { ResponseStyleSelector } from './response-style-selector';

// In the toolbar row alongside ProviderSelector:
<ResponseStyleSelector
  value={responseStyleParams}
  onChange={setResponseStyleParams}
/>
```

**Position:** Between the ProviderSelector and the send button — same row, compact form.

---

### 3.3 Integrate into Agent Tab

**File:** `web/components/agent-tab.tsx`

The AgentTab already has orchestration mode selection with config options. Add prompt parameters as a configurable option per mode:

```typescript
// In the mode config options:
{
  id: 'responsePreset',
  label: 'Response Style',
  type: 'select' as const,
  options: ['QuickAnswer', 'StandardProfessional', 'DeepExpertAnalysis', 'MaximumRigor', 'Brainstorming', 'Teaching'],
  default: 'StandardProfessional',
}
```

---

### 3.4 Integrate into Settings Panel

**File:** `web/components/settings.tsx`

Add a "Response Preferences" section with:
- Default response preset dropdown
- Default expertise level dropdown
- Default tone dropdown
- Reset to defaults button

These persist to localStorage as `default_response_params`.

---

## 4. Request Flow Integration

### 4.1 Conversation Interface

**File:** `web/components/conversation-interface.tsx`

**Current:** Sends requests with hardcoded `agentMode: 'v1'` and no prompt params.

**Change to:**
```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages,
    provider: currentProvider,
    model: currentModel,
    temperature,
    maxTokens,
    agentMode: 'auto',
    // NEW: Add response style params
    presetKey: responseStyleParams.presetKey,
    responseDepth: responseStyleParams.responseDepth,
    expertiseLevel: responseStyleParams.expertiseLevel,
    // ... other params
  }),
});
```

---

### 4.2 Workspace Panel (Chat Sender)

**File:** `web/components/workspace-panel.tsx` (~line 1472)

**Current:** Hardcoded `agentMode: 'auto'`

**Change to:** Read `responseStyleParams` from context/localStorage and include in the request body alongside `agentMode`.

---

## 5. Configuration & Persistence

### 5.1 Create Response Style Context

**New file:** `web/contexts/response-style-context.tsx`

```tsx
interface ResponseStyleContextValue {
  params: PromptParameters;
  setParams: (params: PromptParameters) => void;
  preset: PromptPresetKey | null;
  setPreset: (preset: PromptPresetKey | null) => void;
  reset: () => void;
}

// Persists to localStorage: 'response_style_params'
// Defaults to PROMPT_PRESETS.StandardProfessional
```

---

### 5.2 Environment Variable Defaults

**File:** `env.example`

```bash
# Default response style preset (optional)
# Values: QuickAnswer, ExpertBrief, StandardProfessional, DeepExpertAnalysis,
#         MaximumRigor, CasualExplanation, Brainstorming, ExecutiveSummary,
#         Teaching, ResearchAssistant
NEXT_PUBLIC_DEFAULT_RESPONSE_PRESET=StandardProfessional
```

---

## 6. Phase Implementation Order

### Phase 1: Backend Foundation (1-2 days)
1. ✅ `prompt-parameters.ts` already created (964 lines)
2. Extend `chatRequestSchema` in `chat-helpers.ts`
3. Integrate into `web/app/api/chat/route.ts` (primary integration point)
4. Test: Send requests with different presets and verify prompt suffix is appended

### Phase 2: Additional Backend Paths (1 day)
5. Extend `OpenCodeDirectOptions` in `opencode-direct.ts`
6. Extend `ModeConfig` in `orchestration-mode-handler.ts`
7. Extend `TaskRequest` in `task-router.ts`
8. Extend `V2ExecuteOptions` in `v2-executor.ts`
9. Extend `UnifiedAgentConfig` in `unified-agent-service.ts`

### Phase 3: UI Components (2-3 days)
10. Create `ResponseStyleSelector` component
11. Create `response-style-context.tsx` for state management
12. Integrate into `interaction-panel.tsx`
13. Integrate into `conversation-interface.tsx` request flow
14. Add to `agent-tab.tsx` mode configuration
15. Add default settings to `settings.tsx`

### Phase 4: Polish & Testing (1 day)
16. Add environment variable for default preset
17. Test all presets across different agent modes
18. Verify prompt suffix is correctly appended in logs
19. Add UI feedback (e.g., show current preset in chat header)

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Prompt too long for LLM context window | Low | Medium | `applyPromptModifiers` adds ~200-800 tokens; well within limits |
| Breaking existing API consumers | Low | Low | All new fields are optional with sensible defaults |
| UI complexity | Medium | Medium | Start with presets only; advanced params behind "Custom" toggle |
| Inconsistent behavior across modes | Medium | Medium | Test all 12 orchestration modes with each preset |

---

## 8. Files to Modify Summary

| File | Change Type | Effort |
|------|------------|--------|
| `web/app/api/chat/chat-helpers.ts` | Add fields to Zod schema | 5 min |
| `web/app/api/chat/route.ts` | Apply prompt modifiers to systemPrompt | 15 min |
| `packages/shared/agent/opencode-direct.ts` | Extend options interface | 10 min |
| `packages/shared/agent/orchestration-mode-handler.ts` | Extend ModeConfig, apply modifiers | 15 min |
| `packages/shared/agent/task-router.ts` | Extend TaskRequest interface | 10 min |
| `packages/shared/agent/v2-executor.ts` | Extend V2ExecuteOptions | 10 min |
| `web/lib/orchestra/unified-agent-service.ts` | Extend UnifiedAgentConfig | 15 min |
| `web/components/response-style-selector.tsx` | **NEW** component | 1 hour |
| `web/contexts/response-style-context.tsx` | **NEW** context | 30 min |
| `web/components/interaction-panel.tsx` | Integrate selector | 30 min |
| `web/components/conversation-interface.tsx` | Add params to requests | 15 min |
| `web/components/agent-tab.tsx` | Add preset option to mode config | 30 min |
| `web/components/settings.tsx` | Add default response prefs section | 30 min |
| `env.example` | Add default preset variable | 2 min |

**Total estimated effort: ~4-6 hours for full integration**
