---
id: orchestration-visualizer-guide
title: Orchestration Visualizer Guide
aliases:
  - ORCHESTRATION_VISUALIZER
  - ORCHESTRATION_VISUALIZER.md
  - orchestration-visualizer-guide
  - orchestration-visualizer-guide.md
tags:
  - guide
layer: core
summary: "# Orchestration Visualizer Guide\r\n\r\n## Overview\r\n\r\nThe **Orchestration Visualizer** is an interactive DAG-based visualization for monitoring and controlling multi-agent orchestration in real-time.\r\n\r\n**Location**: `components/orchestration-visualizer.tsx`  \r\n**Integration**: `components/plugins/orch"
anchors:
  - Overview
  - Features
  - "1. **Live Agent Visualization** \U0001F3AF"
  - "2. **Human-In-The-Loop (HITL)** \U0001F464"
  - "3. **Real-time Logs** \U0001F4CB"
  - "4. **Interactive Controls** \U0001F3AE"
  - Agent Types & Icons
  - Status Colors
  - Usage
  - Basic Integration
  - Data Format
  - HITL Workflows
  - Approval Flow
  - Nudge Flow
  - API Integration
  - Backend Endpoints (TODO)
  - Mock Data
  - Performance
  - Customization
  - Styling
  - Layout
  - Troubleshooting
  - Agents not showing
  - HITL controls not working
  - Logs not updating
  - Future Enhancements
  - Related Files
  - Support
relations:
  - type: example-of
    id: orchestration-modes-guide
    title: Orchestration Modes Guide
    path: orchestration-modes-guide.md
    confidence: 0.339
    classified_score: 0.442
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: framework-visualizers-guide
    title: Framework Visualizers Guide
    path: framework-visualizers-guide.md
    confidence: 0.337
    classified_score: 0.433
    auto_generated: true
    generator: apply-classified-suggestions
---
# Orchestration Visualizer Guide

## Overview

The **Orchestration Visualizer** is an interactive DAG-based visualization for monitoring and controlling multi-agent orchestration in real-time.

**Location**: `components/orchestration-visualizer.tsx`  
**Integration**: `components/plugins/orchestration-tab.tsx` (DAG tab)

---

## Features

### 1. **Live Agent Visualization** 🎯

- **Agent Nodes**: Visual representation of each agent with:
  - Status indicator (color-coded)
  - Agent type icon
  - Current task display
  - HITL approval badges
  - Activity log count

- **Connection Edges**: Shows relationships between agents:
  - Flow edges (solid lines)
  - Approval edges (dashed lines with approval nodes)
  - Data edges (dotted lines)
  - Status-based coloring

### 2. **Human-In-The-Loop (HITL)** 👤

Interactive controls for human oversight:

- **Approve**: Allow agent to continue execution
- **Reject**: Stop agent with reason provided
- **Nudge**: Send custom instructions to agents
- **Visual Indicators**: Pulsing yellow badges for pending approvals

### 3. **Real-time Logs** 📋

Each agent maintains an activity log:
- **Info**: General information
- **Action**: Actions taken by agent
- **Decision**: Decisions made
- **Error**: Errors encountered
- **Approval**: HITL events

Logs include:
- Timestamp
- Type badge (color-coded)
- Message
- Optional data payload (JSON)

### 4. **Interactive Controls** 🎮

- **Zoom**: Zoom in/out (50% - 200%)
- **Pan**: Click and drag canvas
- **Select**: Click agent to view details
- **Refresh**: Manual data refresh

---

## Agent Types & Icons

| Type | Icon | Role |
|------|------|------|
| **Planner** | 📋 | Breaks down tasks into steps |
| **Executor** | ⚡ | Executes planned steps |
| **Critic** | 🔍 | Reviews code quality |
| **Manager** | 🎯 | Coordinates agents |
| **Tool** | 🔧 | Provides tool capabilities |

---

## Status Colors

| Status | Color | Animation |
|--------|-------|-----------|
| **Idle** | Gray (#6b7280) | None |
| **Thinking** | Purple (#a855f7) | Pulse |
| **Executing** | Blue (#3b82f6) | Pulse |
| **Waiting Approval** | Yellow (#f59e0b) | Pulse |
| **Completed** | Green (#22c55e) | None |
| **Failed** | Red (#ef4444) | None |

---

## Usage

### Basic Integration

```typescript
import OrchestrationVisualizer from '@/components/orchestration-visualizer';

<OrchestrationVisualizer
  agents={agents}
  edges={edges}
  onAgentNudge={(agentId, instruction) => {
    // Send instruction to agent
  }}
  onAgentApprove={(agentId) => {
    // Approve agent continuation
  }}
  onAgentReject={(agentId, reason) => {
    // Reject agent with reason
  }}
  onRefresh={() => {
    // Refresh data
  }}
/>
```

### Data Format

```typescript
interface AgentNode {
  id: string;
  name: string;
  type: 'planner' | 'executor' | 'critic' | 'manager' | 'tool';
  status: 'idle' | 'thinking' | 'executing' | 'waiting_approval' | 'completed' | 'failed';
  x: number;
  y: number;
  goal?: string;
  currentTask?: string;
  logs?: AgentLog[];
  hitlRequired?: boolean;
  hitlApproved?: boolean;
}

interface AgentLog {
  id: string;
  timestamp: number;
  type: 'info' | 'action' | 'decision' | 'error' | 'approval';
  message: string;
  data?: any;
}

interface AgentEdge {
  id: string;
  source: string;
  target: string;
  type: 'flow' | 'approval' | 'data';
  status: 'active' | 'completed' | 'blocked';
}
```

---

## HITL Workflows

### Approval Flow

1. Agent reaches decision point
2. Status changes to `waiting_approval`
3. Yellow badge appears on agent node
4. User clicks agent to select
5. Side panel shows approve/reject buttons
6. User approves → Agent continues execution
7. User rejects → Agent fails with reason

### Nudge Flow

1. User selects agent
2. Types instruction in text area
3. Clicks "Send Nudge"
4. Instruction sent to agent (via API)
5. Agent can adjust behavior based on instruction

---

## API Integration

### Backend Endpoints (TODO)

```typescript
// Approve agent
POST /api/orchestration/agents/{agentId}/approve

// Reject agent
POST /api/orchestration/agents/{agentId}/reject
Body: { reason: string }

// Send nudge
POST /api/orchestration/agents/{agentId}/nudge
Body: { instruction: string }

// Get agent logs
GET /api/orchestration/agents/{agentId}/logs

// Refresh orchestration data
GET /api/orchestration/refresh
```

---

## Mock Data

For development, the visualizer includes mock data:

```typescript
const MOCK_AGENTS: AgentNode[] = [
  {
    id: 'agent-1',
    name: 'Planner Agent',
    type: 'planner',
    status: 'completed',
    x: 50,
    y: 50,
    goal: 'Break down task into steps',
    logs: [...]
  },
  // ... more agents
];
```

---

## Performance

- **Zoom**: CSS transform (GPU accelerated)
- **Animations**: Framer Motion (optimized)
- **Logs**: Virtual scrolling for large datasets
- **Updates**: Debounced state updates

---

## Customization

### Styling

All colors are configurable via inline styles or CSS variables:

```typescript
// Custom status colors
const customColors = {
  idle: '#custom-gray',
  thinking: '#custom-purple',
  // ...
};
```

### Layout

Agent positions are set via `x` and `y` coordinates:

```typescript
// Auto-layout example
agents.map((agent, index) => ({
  ...agent,
  x: 50 + (index % 4) * 200,
  y: 50 + Math.floor(index / 4) * 150,
}));
```

---

## Troubleshooting

### Agents not showing
- Check `agents` array is populated
- Verify x/y coordinates are within canvas bounds
- Check zoom level (not too zoomed out)

### HITL controls not working
- Verify callbacks are provided
- Check console for errors
- Ensure agent has `hitlRequired: true`

### Logs not updating
- Check `logs` array on agent
- Verify `showLogs` is enabled
- Check log timestamp format

---

## Future Enhancements

- [ ] Real-time WebSocket updates
- [ ] Drag-and-drop agent repositioning
- [ ] Agent grouping/clustering
- [ ] Performance metrics overlay
- [ ] Export visualization as image
- [ ] Timeline scrubbing
- [ ] Agent conversation view
- [ ] Multi-workflow support
- [ ] Search/filter agents
- [ ] Keyboard shortcuts

---

## Related Files

- **Component**: `components/orchestration-visualizer.tsx`
- **Integration**: `components/plugins/orchestration-tab.tsx`
- **Handler**: `lib/agent/orchestration-mode-handler.ts`
- **Context**: `contexts/orchestration-mode-context.tsx`

---

## Support

For issues or questions:
1. Check component props
2. Verify data format matches interfaces
3. Check console for errors
4. Review mock data for examples
