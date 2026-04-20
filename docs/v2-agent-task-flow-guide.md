---
id: v2-agent-task-flow-guide
title: V2 Agent Task Flow Guide
aliases:
  - V2_TASK_FLOW_GUIDE
  - V2_TASK_FLOW_GUIDE.md
  - v2-agent-task-flow-guide
  - v2-agent-task-flow-guide.md
tags:
  - agent
  - spawn
  - v2
  - guide
layer: core
summary: "# V2 Agent Task Flow Guide\r\n\r\n## Architecture Overview\r\n\r\n```\r\nUser Request\r\n    ↓\r\n┌─────────────────────────────────────────────────────────────┐\r\n│                    Task Router                               │\r\n│  Analyzes task and routes to appropriate agent              │\r\n└───────────────────"
anchors:
  - Architecture Overview
  - Task Routing Logic
  - OpenCode Agent (Coding Tasks)
  - Nullclaw Agent (Non-Coding Tasks)
  - API Usage
  - Execute Task (Automatic Routing)
  - Response Format
  - Task Router Implementation
  - Analysis Process
  - Example Analysis
  - Container Communication Flow
  - 1. Session Creation
  - 2. Task Execution Flow
  - Hybrid Tasks
  - 'Execution Flow:'
  - Error Handling
  - OpenCode Errors
  - Nullclaw Errors
  - Router Errors
  - Configuration
  - Environment Variables
  - docker-compose.v2.yml
  - Monitoring
  - Task Metrics
  - Logging
  - Best Practices
  - 1. Clear Task Descriptions
  - 2. Specify Target Agent (Optional)
  - 3. Handle Streaming Responses
  - 4. Monitor Task Confidence
  - Troubleshooting
  - Task Routed to Wrong Agent
  - Nullclaw Not Available
  - Task Timeout
---
# V2 Agent Task Flow Guide

## Architecture Overview

```
User Request
    ↓
┌─────────────────────────────────────────────────────────────┐
│                    Task Router                               │
│  Analyzes task and routes to appropriate agent              │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   OpenCode      │     │   Nullclaw      │
│   (Coding)      │     │   (Non-coding)  │
│                 │     │                 │
│ - File ops      │     │ - Messaging     │
│ - Bash commands │     │ - Browsing      │
│ - Code gen      │     │ - Automation    │
│ - Git ops       │     │ - API calls     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
              Response to User
```

---

## Task Routing Logic

### OpenCode Agent (Coding Tasks)

**Keywords:** code, program, function, file, directory, bash, shell, npm, pnpm, git, test, debug, build, compile, typescript, javascript, python, react, api, database

**Example Tasks:**
- "Create a React component for a todo list"
- "Fix the bug in src/utils.ts"
- "Run the tests and fix any failures"
- "Install lodash and update package.json"
- "Create a new API endpoint for user login"

### Nullclaw Agent (Non-Coding Tasks)

**Keywords:** discord, telegram, message, send, browse, website, url, http, scrape, automate, schedule, server, deploy, monitor

**Example Tasks:**
- "Send a message to Discord channel #general"
- "Browse https://example.com and extract the title"
- "Set up a daily backup cron job"
- "Monitor the server CPU usage"
- "Notify me on Telegram when the build fails"

---

## API Usage

### Execute Task (Automatic Routing)

```typescript
// POST /api/agent/v2/execute
const response = await fetch('/api/agent/v2/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'user-123:conv-456',
    task: 'Create a login form and send a notification to Discord',
    stream: false,
  }),
});

const result = await response.json();
console.log(result);
```

### Response Format

```json
{
  "success": true,
  "data": {
    "type": "coding",
    "confidence": 0.85,
    "target": "opencode",
    "reasoning": "Task involves coding, file operations, or shell commands",
    "agent": "opencode",
    "response": "Created login form component...",
    "fileChanges": [...],
    "bashCommands": [...]
  }
}
```

---

## Task Router Implementation

### Analysis Process

1. **Keyword Scoring** - Count matches for each category
2. **Primary Type Detection** - Find highest scoring category
3. **Target Selection** - Choose OpenCode or Nullclaw
4. **Confidence Calculation** - Score / task length

### Example Analysis

**Task:** "Create a function to send Discord messages"

```
Keyword Scores:
- coding: 3 (function, create, send)
- messaging: 1 (discord)
- browsing: 0
- automation: 0

Primary Type: coding (score: 3)
Target: opencode
Reasoning: "Task involves coding, file operations, or shell commands"
```

---

## Container Communication Flow

### 1. Session Creation

```
POST /api/agent/v2/session
    ↓
Create Agent Session
    ↓
┌─────────────────────────────────────┐
│  App Container (Port 3000)          │
│  - Next.js frontend                 │
│  - OpenCode agent                   │
│  - Task router                      │
└─────────────────────────────────────┘
         │
         │ HTTP
         ↓
┌─────────────────────────────────────┐
│  Nullclaw Container (Port 3001)     │
│  - Discord/Telegram APIs            │
│  - Web browsing                     │
│  - Automation tools                 │
└─────────────────────────────────────┘
```

### 2. Task Execution Flow

```
User Task
    ↓
Task Router Analysis
    ↓
┌─────────────────────────────────────────────────┐
│ If coding:                                      │
│   1. OpenCode executes in sandbox              │
│   2. File changes written to workspace         │
│   3. VFS sync updates virtual filesystem       │
│   4. Return result to user                     │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ If messaging/browsing:                          │
│   1. HTTP POST to Nullclaw container           │
│   2. Nullclaw executes external API call       │
│   3. Return result to Task Router              │
│   4. Return result to user                     │
└─────────────────────────────────────────────────┘
```

---

## Hybrid Tasks

Some tasks require **both** agents:

**Example:** "Create a script that monitors server CPU and sends Discord alerts"

### Execution Flow:

1. **OpenCode** creates the monitoring script
2. **OpenCode** sets up cron job
3. **Nullclaw** sends test Discord message
4. Return combined result

```typescript
// Task router detects hybrid task
const routing = taskRouter.analyzeTask(task);
// type: 'automation', confidence: 0.7, target: 'opencode'

// OpenCode creates script
const scriptResult = await executeWithOpenCode(task);

// Nullclaw sends test message
const notificationResult = await executeWithNullclaw(
  'Send test message to Discord #alerts'
);

// Return combined result
return {
  success: true,
  agents: ['opencode', 'nullclaw'],
  results: [scriptResult, notificationResult],
};
```

---

## Error Handling

### OpenCode Errors

```json
{
  "success": false,
  "error": "File not found: src/missing.ts",
  "agent": "opencode"
}
```

### Nullclaw Errors

```json
{
  "success": false,
  "error": "Discord API: Invalid channel ID",
  "agent": "nullclaw"
}
```

### Router Errors

```json
{
  "success": false,
  "error": "Nullclaw not available for this session",
  "agent": "unknown"
}
```

---

## Configuration

### Environment Variables

```bash
# Task Router
TASK_ROUTER_DEFAULT_AGENT=opencode
TASK_ROUTER_CONFIDENCE_THRESHOLD=0.5

# OpenCode
OPENCODE_MODEL=claude-3-5-sonnet
OPENCODE_MAX_STEPS=20
OPENCODE_TIMEOUT=300000

# Nullclaw
NULLCLAW_ENABLED=true
NULLCLAW_URL=http://nullclaw:3000
NULLCLAW_TIMEOUT=30000
```

### docker-compose.v2.yml

```yaml
services:
  app:
    environment:
      - NULLCLAW_URL=http://nullclaw:3000  # Internal network URL
  
  nullclaw:
    # Nullclaw container
    image: ghcr.io/nullclaw/nullclaw:latest
    networks:
      - bing-network  # Same network as app
```

---

## Monitoring

### Task Metrics

```typescript
// Track routing decisions
const metrics = {
  totalTasks: 1000,
  opencodeTasks: 750,
  nullclawTasks: 250,
  avgConfidence: 0.82,
  avgDuration: 2500, // ms
};
```

### Logging

```
[Agent:TaskRouter] Task routed: Create login form → opencode (coding, confidence: 0.85)
[Agent:TaskRouter] Task routed: Send Discord message → nullclaw (messaging, confidence: 0.92)
[API:AgentV2:Execute] Executing task in session abc-123
[Agent:FSBridge] Synced 5 files from sandbox
```

---

## Best Practices

### 1. Clear Task Descriptions

✅ **Good:** "Create a Python script to scrape weather data"
❌ **Bad:** "Get weather stuff"

### 2. Specify Target Agent (Optional)

```typescript
// Force specific agent if needed
const result = await taskRouter.executeTask({
  ...request,
  preferredAgent: 'opencode', // Override automatic routing
});
```

### 3. Handle Streaming Responses

```typescript
// For long-running tasks
const response = await fetch('/api/agent/v2/execute', {
  body: JSON.stringify({ stream: true }),
});

const reader = response.body.getReader();
while (true) {
  const { value } = await reader.read();
  console.log(new TextDecoder().decode(value));
}
```

### 4. Monitor Task Confidence

```typescript
const routing = taskRouter.analyzeTask(task);
if (routing.confidence < 0.5) {
  logger.warn(`Low confidence routing: ${routing.reasoning}`);
  // Consider asking user for clarification
}
```

---

## Troubleshooting

### Task Routed to Wrong Agent

**Symptom:** Coding task sent to Nullclaw

**Solution:** Add more coding keywords or increase confidence threshold

```bash
TASK_ROUTER_CONFIDENCE_THRESHOLD=0.7
```

### Nullclaw Not Available

**Symptom:** "Nullclaw not initialized" error

**Solution:** Check container health

```bash
docker-compose -f docker-compose.v2.yml ps
curl http://localhost:3001/health
```

### Task Timeout

**Symptom:** Task takes too long

**Solution:** Adjust timeout settings

```bash
OPENCODE_TIMEOUT=600000  # 10 minutes
NULLCLAW_TIMEOUT=60000   # 1 minute
```

---

**Status:** ✅ Task routing implemented with automatic agent selection.
