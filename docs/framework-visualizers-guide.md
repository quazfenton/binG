---
id: framework-visualizers-guide
title: Framework Visualizers Guide
aliases:
  - FRAMEWORK_VISUALIZERS
  - FRAMEWORK_VISUALIZERS.md
  - framework-visualizers-guide
  - framework-visualizers-guide.md
tags:
  - guide
layer: core
summary: "# Framework Visualizers Guide\r\n\r\n## Overview\r\n\r\nThe **Framework Visualizers** provide no-code, interactive visualization and control for **Mastra** and **CrewAI** workflows with real-time monitoring, parameter editing, and execution control.\r\n\r\n**Location**: `components/framework-visualizer.tsx`"
anchors:
  - Overview
  - Features
  - "1. **Visual Workflow Editor** \U0001F3A8"
  - "2. **No-Code Parameter Knobs** \U0001F39B️"
  - 3. **Execution Control** ▶️
  - "4. **Real-time Logs** \U0001F4CB"
  - 5. **Event Bus** ⚡
  - Supported Frameworks
  - Mastra Workflows
  - CrewAI Workflows
  - Usage
  - Basic Integration
  - Data Format
  - Visual Elements
  - Step Status Colors
  - Step Type Icons
  - Edge Types
  - No-Code Controls
  - Parameter Sliders
  - Boolean Toggles
  - Select Dropdowns
  - Real-time Monitoring
  - Logs Panel
  - Events Panel
  - API Integration
  - Backend Endpoints (TODO)
  - Customization
  - Adding Custom Workflows
  - Styling
  - Layout
  - Performance
  - Troubleshooting
  - Workflow not showing
  - Parameters not updating
  - Logs not streaming
  - Controls not working
  - Future Enhancements
  - Related Files
  - Support
---
# Framework Visualizers Guide

## Overview

The **Framework Visualizers** provide no-code, interactive visualization and control for **Mastra** and **CrewAI** workflows with real-time monitoring, parameter editing, and execution control.

**Location**: `components/framework-visualizer.tsx`  
**Integration**: `components/plugins/orchestration-tab.tsx` (Mastra & CrewAI tabs)

---

## Features

### 1. **Visual Workflow Editor** 🎨

Interactive DAG-based visualization showing:
- **Workflow Steps** - Color-coded by status
- **Execution Flow** - Sequential, conditional, parallel edges
- **Step Types** - Action, condition, loop, parallel, wait
- **Real-time Status** - Pending, running, completed, failed

### 2. **No-Code Parameter Knobs** 🎛️

Adjust workflow parameters without code:
- **Sliders** - Numeric values with min/max/step
- **Toggles** - Boolean on/off switches
- **Dropdowns** - Select from predefined options
- **Text Inputs** - String parameters
- **Reset to Default** - Quick revert button

### 3. **Execution Control** ▶️

Full workflow lifecycle management:
- **Enable/Disable** - Toggle workflow activation
- **Run** - Start workflow execution
- **Stop** - Halt running workflow
- **Refresh** - Manual data refresh

### 4. **Real-time Logs** 📋

Live streaming logs with:
- **Log Levels** - Info, warn, error, debug (color-coded)
- **Source Tracking** - Which step/component generated log
- **Timestamps** - Precise timing information
- **Auto-scroll** - Always shows latest logs
- **Data Payloads** - JSON data inspection

### 5. **Event Bus** ⚡

Workflow event timeline:
- **Step Start/Complete** - Track execution progress
- **Step Fail** - Error notifications
- **Condition Events** - Branch decisions
- **Parallel Events** - Concurrent execution tracking
- **Color-coded** - Easy visual scanning

---

## Supported Frameworks

### Mastra Workflows

**Icon**: 📑 Layers  
**Color**: Purple (#a855f7)

**Features**:
- Multi-step workflows
- Conditional branching
- Self-healing logic
- Tool integration
- State management

**Default Workflow**: Code Agent Workflow
- Plan Generation
- Tool Selection
- Code Execution
- Syntax Check
- Self-Healing (conditional)
- Final Review

**Parameters**:
| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| Max Steps | Number | 15 | 1-50 | Maximum execution steps |
| Temperature | Number | 0.7 | 0-2 | LLM temperature |
| Enable Self-Healing | Boolean | true | - | Auto-retry on failures |
| Model | Select | gpt-4o | - | LLM model selection |

---

### CrewAI Workflows

**Icon**: 🤖 Bot  
**Color**: Cyan (#06b6d4)

**Features**:
- Multi-agent collaboration
- Sequential/hierarchical/consensual processes
- Role-based agents
- Memory & caching
- Rate limiting

**Default Workflow**: Multi-Agent Crew
- Planner Agent
- Researcher Agent
- Writer Agent
- Critic Agent
- Manager Agent

**Parameters**:
| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| Process Type | Select | sequential | - | Agent coordination mode |
| Verbose | Boolean | true | - | Detailed logging |
| Memory | Boolean | true | - | Enable agent memory |
| Cache | Boolean | true | - | Enable result caching |
| Max RPM | Number | 30 | 1-100 | Rate limit |
| Manager LLM | Select | gpt-4o | - | Manager model |

---

## Usage

### Basic Integration

```typescript
import FrameworkVisualizer from '@/components/framework-visualizer';

<FrameworkVisualizer
  framework="mastra"
  workflows={workflows}
  onToggleWorkflow={(id, enabled) => {
    // Enable/disable workflow
  }}
  onUpdateParameter={(id, paramId, value) => {
    // Update parameter value
  }}
  onRunWorkflow={(id) => {
    // Start workflow execution
  }}
  onStopWorkflow={(id) => {
    // Stop workflow
  }}
  onRefresh={() => {
    // Refresh data
  }}
/>
```

### Data Format

```typescript
interface WorkflowConfig {
  id: string;
  name: string;
  framework: 'mastra' | 'crewai';
  enabled: boolean;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  parameters: WorkflowParameter[];
  logs: WorkflowLog[];
  events: WorkflowEvent[];
}
```

---

## Visual Elements

### Step Status Colors

| Status | Color | Animation |
|--------|-------|-----------|
| **Pending** | Gray (#6b7280) | None |
| **Running** | Blue (#3b82f6) | Pulse |
| **Completed** | Green (#22c55e) | None |
| **Failed** | Red (#ef4444) | None |
| **Skipped** | Gray (#6b7280) | None |

### Step Type Icons

| Type | Icon | Description |
|------|------|-------------|
| **Action** | ⚡ | Execute action/tool |
| **Condition** | 🔀 | Branching decision |
| **Loop** | 🔄 | Iterative execution |
| **Parallel** | ∥ | Concurrent execution |
| **Wait** | ⏳ | Delay/pause |

### Edge Types

| Type | Style | Description |
|------|-------|-------------|
| **Sequential** | Solid line | Direct flow |
| **Conditional** | Dashed line | Branch with condition |
| **Parallel** | Dotted line | Concurrent paths |

---

## No-Code Controls

### Parameter Sliders

For numeric values:
```typescript
{
  id: 'p1',
  name: 'Temperature',
  type: 'number',
  value: 0.7,
  min: 0,
  max: 2,
  step: 0.1,
  description: 'LLM temperature'
}
```

**Features**:
- Visual slider control
- Current value display
- Min/max bounds
- Custom step size
- Description tooltip
- Reset to default button

### Boolean Toggles

For on/off settings:
```typescript
{
  id: 'p2',
  name: 'Enable Memory',
  type: 'boolean',
  value: true,
  description: 'Enable agent memory'
}
```

**Features**:
- iOS-style toggle switch
- Clear visual state
- Optional description

### Select Dropdowns

For predefined options:
```typescript
{
  id: 'p3',
  name: 'Model',
  type: 'select',
  value: 'gpt-4o',
  options: ['gpt-4o', 'claude-sonnet', 'gemini-pro'],
  description: 'LLM model'
}
```

**Features**:
- Native select dropdown
- Dark theme styling
- Option descriptions

---

## Real-time Monitoring

### Logs Panel

**Auto-scrolling** log viewer:
- Shows last 20 logs
- Color-coded by level
- Source identification
- Timestamp display
- JSON data inspection

**Log Levels**:
- **Info** (Blue) - General information
- **Warn** (Yellow) - Warnings
- **Error** (Red) - Errors
- **Debug** (Gray) - Debug info

### Events Panel

**Event timeline**:
- Step lifecycle events
- Condition evaluations
- Parallel execution tracking
- Color-coded by type
- Auto-scrolling

**Event Types**:
- `step_start` - Step execution begins
- `step_complete` - Step completed successfully
- `step_fail` - Step failed
- `condition` - Condition evaluated
- `parallel_start` - Parallel execution starts
- `parallel_complete` - All parallel steps done

---

## API Integration

### Backend Endpoints (TODO)

```typescript
// Get workflows
GET /api/frameworks/{framework}/workflows

// Toggle workflow
POST /api/frameworks/{framework}/workflows/{id}/toggle
Body: { enabled: boolean }

// Update parameter
POST /api/frameworks/{framework}/workflows/{id}/parameters/{paramId}
Body: { value: any }

// Run workflow
POST /api/frameworks/{framework}/workflows/{id}/run

// Stop workflow
POST /api/frameworks/{framework}/workflows/{id}/stop

// Get logs
GET /api/frameworks/{framework}/workflows/{id}/logs

// Get events
GET /api/frameworks/{framework}/workflows/{id}/events

// Subscribe to real-time updates
WS /api/frameworks/{framework}/workflows/{id}/stream
```

---

## Customization

### Adding Custom Workflows

```typescript
const customWorkflow: WorkflowConfig = {
  id: 'my-workflow',
  name: 'My Custom Workflow',
  framework: 'mastra',
  enabled: true,
  steps: [
    { id: 'step-1', name: 'Init', type: 'action', status: 'pending' },
    // ... more steps
  ],
  edges: [
    { id: 'edge-1', source: 'step-1', target: 'step-2', type: 'sequential' },
  ],
  parameters: [
    { id: 'p1', name: 'Custom Param', type: 'string', value: 'default' },
  ],
  logs: [],
  events: [],
};
```

### Styling

All colors are customizable via CSS variables or inline styles.

### Layout

Adjust zoom, panel visibility, and layout via props.

---

## Performance

- **Zoom**: CSS transform (GPU accelerated)
- **Animations**: Framer Motion (optimized)
- **Logs**: Limited to last 20 entries
- **Events**: Limited to last 20 entries
- **Updates**: Debounced state updates
- **Auto-scroll**: Smooth scrolling

---

## Troubleshooting

### Workflow not showing
- Check `workflows` array is populated
- Verify framework type matches
- Check zoom level

### Parameters not updating
- Verify `onUpdateParameter` callback
- Check parameter ID matches
- Verify state update logic

### Logs not streaming
- Check `logs` array is being updated
- Verify `showLogs` is enabled
- Check auto-scroll ref

### Controls not working
- Verify workflow is enabled
- Check callbacks are provided
- Check console for errors

---

## Future Enhancements

- [ ] Real-time WebSocket streaming
- [ ] Drag-and-drop step reordering
- [ ] Visual step editor
- [ ] Parameter validation
- [ ] Workflow templates
- [ ] Export/import workflows
- [ ] Version history
- [ ] A/B testing
- [ ] Performance metrics
- [ ] Error recovery suggestions
- [ ] Step debugging
- [ ] Breakpoints

---

## Related Files

- **Component**: `components/framework-visualizer.tsx`
- **Integration**: `components/plugins/orchestration-tab.tsx`
- **Mastra Handler**: `lib/agent/mastra-workflow-integration.ts`
- **CrewAI Handler**: `lib/crewai/crew/crew.ts`
- **Documentation**: `docs/FRAMEWORK_VISUALIZERS.md`

---

## Support

For issues or questions:
1. Check component props
2. Verify data format matches interfaces
3. Check console for errors
4. Review mock data for examples
5. Check API endpoint availability
