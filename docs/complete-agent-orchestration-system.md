---
id: complete-agent-orchestration-system
title: Complete Agent Orchestration System
aliases:
  - ORCHESTRATION_GUIDE
  - ORCHESTRATION_GUIDE.md
  - complete-agent-orchestration-system
  - complete-agent-orchestration-system.md
tags:
  - agent
  - spawn
layer: core
summary: "# Complete Agent Orchestration System\r\n\r\n## Executive Summary\r\n\r\nThis document provides a comprehensive overview of the fully integrated agent orchestration system, including all enhancements, new services, and integration points.\r\n\r\n**Status**: ✅ Production Ready\r\n\r\n## System Architecture\r\n\r\n```\r\n┌"
anchors:
  - Executive Summary
  - System Architecture
  - Core Components
  - 1. Session Manager (`lib/session/session-manager.ts`)
  - 2. Enhanced Background Jobs (`lib/agent/enhanced-background-jobs.ts`)
  - 3. Execution Graph Engine (`lib/agent/execution-graph.ts`)
  - 4. Workforce Manager (`lib/agent/workforce-manager.ts`)
  - 5. Mastra Workflow Integration (`lib/agent/mastra-workflow-integration.ts`)
  - 6. Cloud Deployment Service (`lib/sandbox/cloud-deployment-service.ts`)
  - 7. Workflow Templates (`lib/agent/workflow-templates.ts`)
  - 8. Multi-Agent Collaboration (`lib/agent/multi-agent-collaboration.ts`)
  - 9. Stateful Agent (`lib/orchestra/stateful-agent/agents/stateful-agent.ts`)
  - 10. HITL System (`lib/orchestra/stateful-agent/human-in-the-loop.ts`)
  - Integration Points
  - Unified Agent Service (`lib/orchestra/unified-agent-service.ts`)
  - Response Router (`lib/api/response-router.ts`)
  - Agent Gateway (`lib/agent/services/agent-gateway/src/index-enhanced.ts`)
  - Agent Worker (`lib/agent/services/agent-worker/src/index.ts`)
  - Quick Start Guide
  - 1. Initialize Orchestration
  - 2. Create Session with Full Features
  - 3. Start Background Monitoring
  - 4. Execute Workflow Template
  - 5. Deploy to Cloud
  - 6. Get Comprehensive Statistics
  - Testing
  - Run All Tests
  - Test Coverage
  - Environment Variables
  - Best Practices
  - 1. Session Management
  - 2. Workflow Templates
  - 3. Cloud Deployment
  - 4. Error Handling
  - 5. Resource Management
  - Troubleshooting
  - Common Issues
  - Future Enhancements
  - References
---
# Complete Agent Orchestration System

## Executive Summary

This document provides a comprehensive overview of the fully integrated agent orchestration system, including all enhancements, new services, and integration points.

**Status**: ✅ Production Ready

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Agent Orchestration System                        │
│                     lib/agent/orchestration.ts                       │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
┌────────▼────────┐  ┌────────▼────────┐  ┌──────▼───────┐
│ Session Manager │  │  Cloud Deploy   │  │  Workforce   │
│                 │  │   Service       │  │   Manager    │
│ + Background    │  │                 │  │              │
│   Jobs          │  │ - Fastly Edge   │  │ + YAML       │
│ + Execution     │  │ - Vercel Func   │  │   Persist    │
│   Graph         │  │ - Val Town      │  │ + Recurring  │
│ + Quota Track   │  │ - Multi-Cloud   │  │ + Graph      │
└────────┬────────┘  └────────┬────────┘  └──────┬───────┘
         │                    │                   │
         └────────────────────┼───────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Mastra Workflow   │
                    │   Integration      │
                    │                    │
                    │ - code-agent       │
                    │ - hitl             │
                    │ - parallel         │
                    └─────────┬──────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
┌────────▼────────┐  ┌────────▼────────┐  ┌──────▼───────┐
│   Workflow      │  │  Multi-Agent    │  │  Stateful    │
│   Templates     │  │  Collaboration  │  │   Agent      │
│                 │  │                 │  │              │
│ - code-review   │  │ - Role-based    │  │ - Plan-Act-  │
│ - deployment    │  │ - Handoff       │  │   Verify     │
│ - memory-wipe   │  │ - Coordination  │  │ - Self-Heal  │
│ - security      │  │                 │  │ - Reflection │
│ - bug-fix       │  │                 │  │              │
└─────────────────┘  └─────────────────┘  └──────────────┘
```

## Core Components

### 1. Session Manager (`lib/session/session-manager.ts`)

**Features:**
- Unified session lifecycle management
- Background jobs integration with quota tracking
- Execution graph creation per session
- TTL-based cleanup (30 minutes default)
- Multi-provider sandbox support

**API:**
```typescript
// Create session
const session = await sessionManager.getOrCreateSession(
  userId,
  conversationId,
  { mode: 'opencode', enableMCP: true }
);

// Start background job
await sessionManager.startBackgroundJob(session.id, {
  command: 'npm run dev',
  interval: 30,
  quotaCategory: 'compute',
});

// Get job statistics
const stats = sessionManager.getBackgroundJobsStats(session.id);
```

### 2. Enhanced Background Jobs (`lib/agent/enhanced-background-jobs.ts`)

**Features:**
- Session-aware job management
- Execution graph integration
- Quota enforcement
- LLM-evaluated stop conditions
- Event emission for real-time updates

**Job Types:**
- **Compute-intensive**: Long-running calculations
- **IO-heavy**: File operations, network calls
- **API-based**: External service integration

**API:**
```typescript
const job = await enhancedBackgroundJobsManager.startJob({
  sessionId: 'session-123',
  sandboxId: 'sandbox-456',
  command: 'npm run build',
  interval: 300,
  quotaCategory: 'compute',
  maxExecutions: 10,
  stopCondition: 'Build completes successfully',
});
```

### 3. Execution Graph Engine (`lib/agent/execution-graph.ts`)

**Features:**
- DAG-based task execution
- Parallel execution of independent tasks
- Real-time status tracking
- Automatic retry on failure
- Progress reporting

**Node Types:**
- `agent_step` - Agent reasoning/action
- `tool_call` - Tool execution
- `sandbox_action` - Sandbox operation
- `preview_task` - Preview generation
- `git_operation` - Git operations

### 4. Workforce Manager (`lib/agent/workforce-manager.ts`)

**Features:**
- YAML-based state persistence (survives restarts)
- Concurrency control (configurable max)
- Recurring task support via background jobs
- Execution graph tracking
- Task priority and tagging

**API:**
```typescript
// Spawn one-time task
const task = await workforceManager.spawnTask(
  userId,
  conversationId,
  {
    title: 'Implement Auth',
    description: 'Add JWT authentication',
    agent: 'opencode',
  }
);

// Spawn recurring task
await workforceManager.spawnTask(
  userId,
  conversationId,
  {
    title: 'Health Check',
    description: 'Monitor system health',
    agent: 'opencode',
    isRecurring: true,
    interval: 60,
    tags: ['monitoring', 'health'],
  }
);
```

### 5. Mastra Workflow Integration (`lib/agent/mastra-workflow-integration.ts`)

**Features:**
- Real Mastra SDK workflow execution
- Task proposal/review system
- Fallback simulation when Mastra unavailable
- Support for code-agent, HITL, parallel workflows

**API:**
```typescript
// Propose task
const proposal = await mastraWorkflowIntegration.proposeTask(
  'Implement Feature',
  'Add user authentication',
  { priority: 1, assignedTo: 'developer' }
);

// Review task
await mastraWorkflowIntegration.reviewTask(
  proposal.id,
  'approve',
  { reviewedBy: 'tech-lead', feedback: 'Looks good' }
);

// Execute workflow
const result = await mastraWorkflowIntegration.executeWorkflow(
  'code-agent',
  { task: 'Implement login', ownerId: userId }
);
```

### 6. Cloud Deployment Service (`lib/sandbox/cloud-deployment-service.ts`)

**Features:**
- Multi-cloud deployment (Fastly, Vercel, Val Town, E2B, Daytona)
- Auto-scaling based on CPU/memory
- Health check monitoring
- Failover support
- Load balancing

**Deployment Flow:**
```
Request → Load Balancer → Try Provider 1
                            ↓ (fail)
                        Try Provider 2
                            ↓ (success)
                        Deploy & Monitor
```

**API:**
```typescript
const deployment = await cloudDeploymentService.deploy(
  userId,
  conversationId,
  {
    providers: ['vercel', 'e2b', 'daytona'],
    region: 'us-east-1',
    enableAutoScaling: true,
    minInstances: 1,
    maxInstances: 10,
  }
);
```

### 7. Workflow Templates (`lib/agent/workflow-templates.ts`)

**Pre-built Templates:**

| Template | Purpose | Steps | Timeout |
|----------|---------|-------|---------|
| `code-review` | Code review with approval | 5 | 10 min |
| `data-pipeline` | ETL with validation | 4 | 30 min |
| `customer-support` | Multi-turn with escalation | 4 | 60 min |
| `security-audit` | Security scanning | 4 | 30 min |
| `deployment` | CI/CD with approval gates | 5 | 30 min |
| `memory-wipe` | Context cleanup | 4 | 30 sec |
| `context-refresh` | Optimize context | 3 | 1 min |
| `agent-handoff` | Transfer between agents | 3 | 30 sec |
| `multi-step-reasoning` | Complex problem solving | 5 | 10 min |
| `research-analysis` | Research with synthesis | 4 | 15 min |
| `bug-fix` | Systematic debugging | 5 | 10 min |
| `feature-implementation` | End-to-end development | 5 | 30 min |

**API:**
```typescript
// Execute template
const result = await workflowTemplateService.executeTemplate({
  templateId: 'code-review',
  variables: { maxReviewRounds: 5 },
  reviewerId: 'tech-lead',
  enableMemoryWipe: true,
});
```

### 8. Multi-Agent Collaboration (`lib/agent/multi-agent-collaboration.ts`)

**Agent Roles:**
- `planner` - Task decomposition
- `researcher` - Information gathering
- `coder` - Implementation
- `reviewer` - Code review
- `tester` - Testing
- `executor` - Execution
- `coordinator` - Orchestration

**Features:**
- Role-based agent assignment
- Task handoff between agents
- Inter-agent messaging
- Parallel execution with `Promise.allSettled`
- Automatic cleanup

### 9. Stateful Agent (`lib/orchestra/stateful-agent/agents/stateful-agent.ts`)

**Workflow:** Plan → Act → Verify

**Features:**
- Task decomposition engine
- Tool memory graph
- Self-reflection loop
- Self-healing with retry
- Execution graph integration
- VFS tracking

### 10. HITL System (`lib/orchestra/stateful-agent/human-in-the-loop.ts`)

**Features:**
- Interrupt-based approval
- Workflow-based rules
- Condition matchers (glob patterns)
- Risk level assessment
- Audit logging

**Pre-built Rules:**
```typescript
// Shell command approval
const shellRule = createShellCommandRule({
  blockedPatterns: ['rm -rf /', 'sudo', 'curl | bash'],
  requireApproval: true,
});

// Sensitive file protection
const sensitiveRule = createSensitiveFilesRule({
  patterns: ['**/.env*', '**/secrets/*', '**/keys/*'],
  requireApproval: true,
});
```

## Integration Points

### Unified Agent Service (`lib/orchestra/unified-agent-service.ts`)

**Execution Modes:**
1. **v2-native** - OpenCode Engine (primary for agentic tasks)
2. **v2-containerized** - OpenCode in sandbox
3. **v2-local** - OpenCode CLI locally
4. **mastra-workflow** - Mastra workflow execution
5. **v1-api** - LLM provider API (fallback)

**Fallback Chain:**
```
StatefulAgent (complex tasks)
    ↓
OpenCode Engine (v2-native)
    ↓
V2 Containerized
    ↓
V2 Local
    ↓
V1 API (fallback)
```

### Response Router (`lib/api/response-router.ts`)

**Features:**
- Priority-based routing
- Circuit breaker protection
- Quota management
- Tool extraction
- Streaming support

**Priority Chain:**
1. Fast Agent Service (low latency)
2. N8N Agent Service (workflow)
3. Enhanced LLM Service (standard)
4. Custom Fallback Service (reliability)

### Agent Gateway (`lib/agent/services/agent-gateway/src/index-enhanced.ts`)

**Features:**
- Redis-based job queue
- SSE streaming to Next.js
- Job priority management
- Worker coordination
- Runaway job termination

### Agent Worker (`lib/agent/services/agent-worker/src/index.ts`)

**Features:**
- Persistent OpenCode engine
- Git-backed VFS
- Checkpoint/resume
- Tool execution with MCP fallback
- Multi-job concurrency

## Quick Start Guide

### 1. Initialize Orchestration

```typescript
import { initializeOrchestration } from '@bing/shared/agent/orchestration';

// At application startup
await initializeOrchestration();
```

### 2. Create Session with Full Features

```typescript
import { sessionManager } from '@bing/shared/agent/orchestration';

const session = await sessionManager.getOrCreateSession(
  'user-123',
  'conversation-456',
  {
    mode: 'opencode',
    enableMCP: true,
    enableCloudOffload: true,
  }
);
```

### 3. Start Background Monitoring

```typescript
await sessionManager.startBackgroundJob(session.id, {
  command: 'npm run dev',
  interval: 30,
  description: 'Development server',
  quotaCategory: 'compute',
  maxExecutions: 100,
});
```

### 4. Execute Workflow Template

```typescript
import { workflowTemplateService } from '@bing/shared/agent/orchestration';

const result = await workflowTemplateService.executeTemplate({
  templateId: 'code-review',
  reviewerId: 'tech-lead',
  variables: { maxReviewRounds: 3 },
});
```

### 5. Deploy to Cloud

```typescript
import { cloudDeploymentService } from '@bing/shared/agent/orchestration';

const deployment = await cloudDeploymentService.deploy(
  'user-123',
  'conversation-456',
  {
    providers: ['vercel', 'e2b'],
    enableAutoScaling: true,
    minInstances: 1,
    maxInstances: 5,
  }
);
```

### 6. Get Comprehensive Statistics

```typescript
import { getOrchestrationStats } from '@bing/shared/agent/orchestration';

const stats = getOrchestrationStats();
console.log(stats);
// {
//   sessions: { total: 10, active: 5 },
//   backgroundJobs: { total: 15, running: 8 },
//   executionGraphs: { total: 10, running: 5 },
//   mastraWorkflows: { activeWorkflows: 3, totalProposals: 20 }
// }
```

## Testing

### Run All Tests

```bash
npm test -- __tests__/agent/orchestration-integration.test.ts
npm test -- __tests__/sandbox/cloud-deployment.test.ts
npm test -- __tests__/agent/workflow-templates.test.ts
```

### Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| Session Manager | 25+ | 85% |
| Background Jobs | 20+ | 80% |
| Execution Graph | 15+ | 75% |
| Workforce Manager | 10+ | 70% |
| Mastra Integration | 15+ | 75% |
| Cloud Deployment | 10+ | 65% |
| Workflow Templates | 30+ | 90% |

## Environment Variables

```bash
# Session Management
SESSION_TTL_MINUTES=30
WORKFORCE_MAX_CONCURRENCY=4

# Background Jobs
ENHANCED_JOBS_ENABLED=true
ENHANCED_JOBS_QUOTA_COMPUTE_MS=300000
ENHANCED_JOBS_QUOTA_IO_OPS=1000
ENHANCED_JOBS_QUOTA_API_CALLS=100

# Mastra Workflows
MASTRA_MAX_CONCURRENT_WORKFLOWS=5
MASTRA_WORKFLOW_TIMEOUT=300000

# Cloud Deployment
CLOUD_DEPLOYMENT_ENABLED=true
CLOUD_DEFAULT_REGION=us-east-1
CLOUD_HEALTH_CHECK_INTERVAL=30000

# Stateful Agent
STATEFUL_AGENT_MAX_SELF_HEAL_ATTEMPTS=3
STATEFUL_AGENT_ENABLE_REFLECTION=true

# HITL
ENABLE_HITL=true
HITL_WORKFLOW_ID=default
```

## Best Practices

### 1. Session Management
- Always destroy sessions when done
- Monitor session quotas
- Use background jobs for long-running tasks

### 2. Workflow Templates
- Use pre-built templates for common scenarios
- Enable memory wipe for sensitive workflows
- Set appropriate timeouts

### 3. Cloud Deployment
- Enable failover for production
- Monitor health checks
- Configure auto-scaling thresholds

### 4. Error Handling
- Use try/catch for all async operations
- Implement retry logic for transient failures
- Log errors with context

### 5. Resource Management
- Clean up background jobs
- Stop cloud deployments when done
- Monitor execution graph progress

## Troubleshooting

### Common Issues

**Session creation fails:**
- Check sandbox provider API keys
- Verify quota availability
- Check execution policy

**Background job not starting:**
- Verify quota not exceeded
- Check sandbox availability
- Review job configuration

**Workflow execution fails:**
- Check Mastra workflow availability
- Verify template ID
- Review workflow variables

**Cloud deployment fails:**
- Check provider credentials
- Verify region availability
- Review deployment config

## Future Enhancements

1. **Advanced Scheduling**: Cron-based job scheduling
2. **Workflow Versioning**: Template version management
3. **Multi-Region**: Cross-region deployment
4. **AI Optimization**: ML-based resource allocation
5. **Enhanced Monitoring**: Real-time dashboards
6. **Plugin System**: Third-party integrations

## References

- [Session Manager API](lib/session/session-manager.ts)
- [Background Jobs API](lib/agent/enhanced-background-jobs.ts)
- [Execution Graph API](lib/agent/execution-graph.ts)
- [Workflow Templates API](lib/agent/workflow-templates.ts)
- [Cloud Deployment API](lib/sandbox/cloud-deployment-service.ts)
- [Orchestration Index](lib/agent/orchestration.ts)
