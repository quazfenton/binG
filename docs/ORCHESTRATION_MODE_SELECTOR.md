# Orchestration Mode Selector - Implementation Summary

## Overview

Added a UI-selectable orchestration mode selector in the workspace-panel's Agent tab that allows users to toggle between different agent orchestration frameworks for testing and development.

## What Was Created

### 1. Context & State Management
**File**: `contexts/orchestration-mode-context.tsx`
- React context for managing orchestration mode selection
- Persists selection to localStorage
- Provides helper function `getOrchestrationModeHeaders()` for API requests
- Modes:
  - `task-router` (default) - Current behavior
  - `unified-agent` - lib/orchestra/unified-agent-service.ts
  - `mastra-workflow` - lib/orchestra/mastra/
  - `crewai` - lib/crewai/
  - `v2-executor` - lib/agent/v2-executor.ts

### 2. UI Component
**File**: `components/agent-tab.tsx`
- Agent tab UI with mode selection cards
- Shows mode status (stable/experimental/deprecated)
- Displays features and best-use cases for each mode
- Test button for each mode (placeholder for actual testing)
- Visual feedback for selected mode
- Reset to default button

### 3. Backend Handler
**File**: `lib/orchestration-mode-handler.ts`
- Routes requests to appropriate orchestration backend
- Reads `X-Orchestration-Mode` header
- Executes task with selected orchestration framework
- Returns unified result format

### 4. Integration Points

#### Updated Files:
- `components/providers.tsx` - Added OrchestrationModeProvider wrapper
- `components/workspace-panel.tsx` - Added Agent tab with mode selector
- `contexts/panel-context.tsx` - Already had 'agent' tab type

## How It Works

### User Flow:
1. User opens workspace panel
2. Clicks "Agent" tab (Brain icon)
3. Sees current orchestration mode and available alternatives
4. Selects a different mode for testing
5. Selection persists to localStorage
6. Subsequent agent requests use selected mode

### Technical Flow:
```
User selects mode
  ↓
Context saves to localStorage
  ↓
API requests include X-Orchestration-Mode header
  ↓
orchestration-mode-handler.ts reads header
  ↓
Routes to appropriate backend:
  - task-router → lib/agent/task-router.ts
  - unified-agent → lib/orchestra/unified-agent-service.ts
  - mastra-workflow → lib/orchestra/mastra/
  - crewai → lib/crewai/
  - v2-executor → lib/agent/v2-executor.ts
  ↓
Returns unified result format
```

## Default Behavior

**Unchanged** - Default mode is `task-router`, which is the current behavior. Users must explicitly select an alternative mode to override.

## Mode Descriptions

### Task Router (Default) ✅ Stable
- Routes tasks between OpenCode and Nullclaw
- Automatic task classification
- Best for: General purpose coding + automation

### Unified Agent Service 🟡 Experimental
- Intelligent fallback chain
- StatefulAgent → V2 Native → V2 Local → V1 API
- Mastra workflow integration
- Best for: Complex multi-step agentic workflows

### Mastra Workflows 🟡 Experimental
- Workflow-based execution
- Quality evaluations
- Memory system
- Best for: Structured workflows with quality gates

### CrewAI Agents 🟡 Experimental
- Role-based agents (Planner, Coder, Critic)
- Sequential/hierarchical processes
- Self-healing execution
- Best for: Complex tasks requiring multiple specialized agents

### V2 Containerized ✅ Stable
- OpenCode containerized execution
- Sandbox isolation
- Best for: Isolated code execution with full sandbox

## Testing

To test the orchestration mode selector:

1. Start dev server: `pnpm dev`
2. Open workspace panel
3. Click "Agent" tab (Brain icon in tab bar)
4. Select a different orchestration mode
5. Make an agent request
6. Check logs for mode selection: `[OrchestrationMode] Executing with orchestration mode { mode: '...' }`

## Next Steps

To fully wire up all modes:

1. **unified-agent**: Already integrated in route.ts, just needs header reading
2. **mastra-workflow**: Code exists, needs proper error handling
3. **crewai**: Already wired in stateful-agent route, needs header support
4. **v2-executor**: Already functional, just needs routing

## Environment Variables

No new environment variables required. All modes use existing configuration.

## Storage

Mode selection persists to localStorage under key: `orchestration_mode_config`

Format:
```json
{
  "mode": "task-router",
  "autoApply": false,
  "streamEnabled": true
}
```

## Security

- Mode selection is client-side only
- Server validates mode against whitelist
- Invalid modes fall back to `task-router`
- No privilege escalation risk
