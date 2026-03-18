# Experimental Workspace Panel - Update 4: Agent Activity Monitor

## New Feature: Real-Time Agent Activity Tab

**Tab Position:** 8th tab (after Forum)
**Icon:** 🖥️ CPU (blue colored)

---

## 🎯 Overview

A comprehensive real-time monitoring dashboard for agent activities, displaying:
- **Agent Status** (thinking, executing, completed, idle)
- **Tool Invocations** with streaming states
- **Reasoning Chunks** (thoughts, plans, reasoning, reflections)
- **Processing Steps** with progress tracking
- **Git Commits** from git-backed VFS
- **File Diffs** with change visualization
- **Token Usage** tracking

---

## 📋 Features

### **1. Status Banner**

**Dynamic Status Display:**
```typescript
status: 'idle' | 'thinking' | 'executing' | 'completed'
```

**Visual States:**
| Status | Color | Icon | Animation |
|--------|-------|------|-----------|
| Thinking | Purple | 🧠 Brain | Pulse |
| Executing | Blue | 💻 Terminal | Spin |
| Completed | Green | ✅ CheckCircle | None |
| Idle | Gray | 📊 Activity | None |

**Layout:**
```
┌─────────────────────────────────────────┐
│ 🧠 Agent is thinking...                 │
│    Analyzing request...                 │
└─────────────────────────────────────────┘
```

---

### **2. Processing Steps**

**Step States:**
```typescript
status: 'pending' | 'started' | 'completed' | 'failed'
```

**Visual Indicators:**
| Status | Icon | Color |
|--------|------|-------|
| Completed | ✓ CheckCircle | Green |
| Started | ⏳ Loader2 (spin) | Blue |
| Failed | ⚠️ AlertCircle | Red |
| Pending | ○ Circle | Gray |

**Example:**
```
┌─────────────────────────────────────────┐
│ 🕐 Processing Steps               [▲]  │
├─────────────────────────────────────────┤
│ ✓ Step 1: Analyzing request            │
│ ⏳ Step 2: Writing code                 │
│ ○ Step 3: Testing                      │
└─────────────────────────────────────────┘
```

---

### **3. Tool Invocations**

**Tool States:**
```typescript
state: 'partial-call' | 'call' | 'result'
```

**Visual States:**
| State | Icon | Color | Label |
|-------|------|-------|-------|
| partial-call | 📊 Activity | Orange | Streaming... |
| call | ⏳ Loader2 (spin) | Blue | Executing... |
| result | ✓ CheckCircle | Green | Completed |

**Features:**
- **Expandable cards** (click to view details)
- **Arguments display** (JSON formatted)
- **Result display** (string or JSON)
- **Count badge** showing total invocations

**Example:**
```
┌─────────────────────────────────────────┐
│ 💻 Tool Invocations            [3]     │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ ✓ write_file            Completed  │ │
│ │                              [▼]   │ │
│ ├─────────────────────────────────────┤ │
│ │ Arguments:                          │ │
│ │ { "path": "src/index.ts" }          │ │
│ │                                     │ │
│ │ Result:                             │ │
│ │ File written successfully           │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

### **4. Reasoning Chunks**

**Reasoning Types:**
```typescript
type: 'thought' | 'plan' | 'reasoning' | 'reflection'
```

**Color Coding:**
| Type | Color | Icon |
|------|-------|------|
| Thought | Blue | 💬 MessageCircle |
| Plan | Green | 📄 FileText |
| Reasoning | Purple | 🧠 Brain |
| Reflection | Orange | 🔄 RotateCcw |

**Features:**
- **Collapsible section** (toggle visibility)
- **Color-coded cards** per type
- **Timestamp tracking**

**Example:**
```
┌─────────────────────────────────────────┐
│ 🧠 Agent Reasoning                [▲]  │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 💬 Thought                          │ │
│ │ Let me analyze this request...      │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 📄 Plan                             │ │
│ │ 1. Create file structure            │ │
│ │ 2. Implement core logic             │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

### **5. Git Commits**

**Display Information:**
- Version number
- Files changed count
- File paths (truncated with badge)
- Timestamp

**Example:**
```
┌─────────────────────────────────────────┐
│ 📝 Git Commits                   [2]   │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 📝 Version 1         10:30:45 AM   │ │
│ │ 2 files changed                     │ │
│ │ [index.ts] [utils.ts] [+3 more]     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

### **6. File Diffs**

**Display Information:**
- File path
- Change type (create/update/delete)
- Diff content (syntax highlighted)

**Example:**
```
┌─────────────────────────────────────────┐
│ 📄 File Changes                  [1]   │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 📄 src/index.ts          [write]   │ │
│ ├─────────────────────────────────────┤ │
│ │ + console.log("Hello World")        │ │
│ │ + import { app } from './app'       │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

### **7. Token Usage**

**Metrics Displayed:**
- Prompt tokens
- Completion tokens
- Total tokens

**Layout:**
```
┌─────────────────────────────────────────┐
│  Prompt    │  Completion  │   Total    │
│   1,250    │     850      │   2,100    │
└─────────────────────────────────────────┘
```

---

## 🔧 Data Structures

### **AgentActivity Interface**

```typescript
interface AgentActivity {
  status: 'idle' | 'thinking' | 'executing' | 'completed';
  currentAction: string;
  toolInvocations: ToolInvocation[];
  reasoningChunks: ReasoningChunk[];
  processingSteps: ProcessingStep[];
  gitCommits: GitCommit[];
  diffs: Array<{ path: string; diff: string; changeType: string }>;
  tokenUsage?: { prompt: number; completion: number; total: number };
}
```

### **ToolInvocation**

```typescript
interface ToolInvocation {
  id: string;
  toolName: string;
  state: 'partial-call' | 'call' | 'result';
  args?: Record<string, any>;
  result?: any;
  timestamp: number;
}
```

### **ReasoningChunk**

```typescript
interface ReasoningChunk {
  id: string;
  type: 'thought' | 'plan' | 'reasoning' | 'reflection';
  content: string;
  timestamp: number;
}
```

### **ProcessingStep**

```typescript
interface ProcessingStep {
  id: string;
  step: string;
  status: 'pending' | 'started' | 'completed' | 'failed';
  stepIndex: number;
  timestamp: number;
}
```

### **GitCommit**

```typescript
interface GitCommit {
  version: number;
  filesChanged: number;
  paths: string[];
  timestamp: number;
}
```

---

## 📡 SSE Event Integration

### **Backend Event Format**

```typescript
// Tool Invocation
controller.enqueue(encoder.encode(formatEvent('tool_invocation', {
  toolCallId: 'tool-123',
  toolName: 'write_file',
  state: 'partial-call',  // or 'call' or 'result'
  args: { path: 'src/index.ts' },
  result: { success: true },
  timestamp: Date.now(),
})));

// Processing Step
controller.enqueue(encoder.encode(formatEvent('step', {
  step: 'Writing file',
  status: 'started',  // or 'completed' or 'failed'
  stepIndex: 0,
  timestamp: Date.now(),
})));

// Reasoning
controller.enqueue(encoder.encode(formatEvent('reasoning', {
  reasoning: 'Let me think about this...',
  type: 'thought',
  timestamp: Date.now(),
})));

// Git Commit
controller.enqueue(encoder.encode(formatEvent('git:commit', {
  version: 1,
  filesChanged: 2,
  paths: ['src/index.ts', 'src/utils.ts'],
  timestamp: Date.now(),
})));

// Diffs
controller.enqueue(encoder.encode(formatEvent('diffs', {
  files: [{ path: 'src/index.ts', diff: '...', changeType: 'write' }],
  count: 1,
  timestamp: Date.now(),
})));
```

### **Frontend Event Handling**

```typescript
// In useEnhancedChat hook
switch (eventType) {
  case 'tool_invocation':
    setAgentActivity(prev => ({
      ...prev,
      toolInvocations: [...prev.toolInvocations, eventData],
      status: 'executing',
      currentAction: `Executing ${eventData.toolName}...`,
    }));
    break;
    
  case 'step':
    setAgentActivity(prev => ({
      ...prev,
      processingSteps: [...prev.processingSteps, {
        id: Date.now().toString(),
        step: eventData.step,
        status: eventData.status,
        stepIndex: eventData.stepIndex,
        timestamp: eventData.timestamp,
      }],
    }));
    break;
    
  case 'reasoning':
    setAgentActivity(prev => ({
      ...prev,
      reasoningChunks: [...prev.reasoningChunks, {
        id: Date.now().toString(),
        type: eventData.type,
        content: eventData.reasoning,
        timestamp: eventData.timestamp,
      }],
      status: 'thinking',
      currentAction: 'Thinking...',
    }));
    break;
    
  case 'git:commit':
    setAgentActivity(prev => ({
      ...prev,
      gitCommits: [...prev.gitCommits, {
        version: eventData.version,
        filesChanged: eventData.filesChanged,
        paths: eventData.paths,
        timestamp: eventData.timestamp,
      }],
    }));
    break;
    
  case 'diffs':
    setAgentActivity(prev => ({
      ...prev,
      diffs: [...prev.diffs, ...eventData.files],
    }));
    break;
}
```

---

## 🎨 UI States

### **1. Active Execution**

```
┌─────────────────────────────────────────┐
│ ⏳ Executing tasks...                   │
│    Writing file...                      │
├─────────────────────────────────────────┤
│ 🕐 Processing Steps                     │
│ ✓ Step 1: Analyzing request            │
│ ⏳ Step 2: Writing code                 │
│ ○ Step 3: Testing                      │
├─────────────────────────────────────────┤
│ 💻 Tool Invocations            [1]     │
│ ┌─────────────────────────────────────┐ │
│ │ ⏳ write_file         Executing...  │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ 🧠 Agent Reasoning                      │
│ ┌─────────────────────────────────────┐ │
│ │ 💬 Thought                          │ │
│ │ I need to create the file first...  │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### **2. Completed Task**

```
┌─────────────────────────────────────────┐
│ ✅ Task completed                       │
│    Task completed successfully          │
├─────────────────────────────────────────┤
│ 🕐 Processing Steps                     │
│ ✓ Step 1: Analyzing request            │
│ ✓ Step 2: Writing code                  │
│ ✓ Step 3: Testing                       │
├─────────────────────────────────────────┤
│ 💻 Tool Invocations            [2]     │
│ ┌─────────────────────────────────────┐ │
│ │ ✓ write_file            Completed   │ │
│ │ ✓ format_code           Completed   │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ 📝 Git Commits                   [1]   │
│ ┌─────────────────────────────────────┐ │
│ │ 📝 Version 1         10:30:45 AM   │ │
│ │ 2 files changed                     │ │
│ │ [index.ts] [utils.ts]               │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│  Prompt    │  Completion  │   Total    │
│   1,250    │     850      │   2,100    │
└─────────────────────────────────────────┘
```

### **3. Idle State**

```
┌─────────────────────────────────────────┐
│ 📊 Agent idle                           │
├─────────────────────────────────────────┤
│                                         │
│         🖥️ (large icon)                 │
│     No agent activity yet               │
│  Start a task to see real-time actions  │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎮 Demo Controls

**For Testing Purposes:**

Located at bottom of Agent tab:

| Button | Action |
|--------|--------|
| **Add Thought** | Adds a reasoning chunk |
| **Add Tool** | Adds a tool invocation |
| **Add Commit** | Adds a git commit |
| **Complete** | Marks task as completed |
| **Reset** | Clears all activity |

**Usage:**
```typescript
// Add Thought
onClick={() => {
  setAgentActivity(prev => ({
    ...prev,
    status: 'thinking',
    currentAction: 'Analyzing request...',
    reasoningChunks: [...prev.reasoningChunks, {
      id: Date.now().toString(),
      type: 'thought',
      content: 'Let me analyze...',
      timestamp: Date.now(),
    }],
  }));
}}
```

---

## 🔮 Future Enhancements

### **1. Real-Time SSE Integration**
- Wire to actual SSE events from backend
- Auto-update on event reception
- Remove demo controls in production

### **2. Enhanced Filtering**
- Filter by tool name
- Filter by step status
- Search reasoning content

### **3. Export/Import**
- Export activity log
- Import previous sessions
- Share activity snapshots

### **4. Performance Metrics**
- Execution time per step
- Tool execution duration
- Cost estimation

### **5. Multi-Agent Support**
- Distinguish planner vs executor
- Show agent handoffs
- Track agent assignments

### **6. Timeline View**
- Visual timeline of all actions
- Gantt chart for parallel execution
- Dependency graph

---

## 📊 Layout

```
┌─────────────────────────────────────────┐
│ [📁][💬][🧠][🎵][🔄][📺][👥][🖥️] ← Tabs│
├─────────────────────────────────────────┤
│ 🖥️ Agent Activity                       │
│                                         │
│ ═══════════════════════════════════════ │
│                                         │
│ [Status Banner]                         │
│                                         │
│ [Processing Steps]                      │
│                                         │
│ [Tool Invocations]                      │
│                                         │
│ [Agent Reasoning]                       │
│                                         │
│ [Git Commits]                           │
│                                         │
│ [File Diffs]                            │
│                                         │
│ [Token Usage]                           │
│                                         │
│ [Demo Controls]                         │
└─────────────────────────────────────────┘
```

---

## 🎯 Usage

1. **Open Panel**: Click ⊞ icon in interaction-panel
2. **Switch to Agent Tab**: Click 🖥️ Agent tab
3. **Monitor Activity**: Watch real-time agent actions
4. **Expand Tools**: Click tool cards to view details
5. **Toggle Sections**: Use collapse/expand buttons
6. **Test with Demo**: Use demo controls for testing

---

**Implementation complete! The Agent Activity Monitor provides comprehensive real-time visibility into agent operations.** 🎉
