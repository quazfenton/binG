# Skills System - System Prompt Engineering & Reinforcement Learning

**Location:** `lib/skills/`

## Overview

The Skills System provides a sophisticated framework for:
- **Skill.md parsing** - Structured skill definitions with context
- **EJSON object passing** - Structured data for skill parameters
- **Sub-capabilities tracking** - Granular skill feature tracking
- **Reinforcement learning** - Success/failure tracking with weight adjustments
- **Agent-type specific weights** - Different weights for CLI, cloud, Nullclaw, etc.
- **System prompt engineering** - Dynamic prompt injection based on skills

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Skills Manager                             │
│  (lib/skills/skills-manager.ts)                         │
│  - Skill loading from .agents/skills/                   │
│  - Reinforcement tracking                               │
│  - Weight calculation                                   │
│  - Agent-type profiles                                  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│          Prompt Engineering Service                     │
│  (lib/skills/prompt-engineering.ts)                     │
│  - System prompt generation                             │
│  - Skill context injection                              │
│  - EJSON data generation                                │
│  - Feedback recording                                   │
└─────────────────────────────────────────────────────────┘
            │                    │
            ▼                    ▼
┌──────────────────┐  ┌──────────────────┐
│  Skill Files     │  │  Reinforcement   │
│  - SKILL.md      │  │  - Weights       │
│  - workflows/*.md│  │  - Feedback      │
│  - reinforcement │  │  - Trends        │
└──────────────────┘  └──────────────────┘
```

## Skill Structure

### SKILL.md Format

```markdown
---
name: terminaluse
description: Create, edit, deploy, and interact with agents on TerminalUse
tags: [deployment, agents, terminaluse]
---

# TerminalUse

Build, deploy, interact with agents. Flow: init → deploy → create task → send messages.

## Quick Reference

| Action | Command |
|--------|---------|
| Login | `tu login`, `tu whoami` |
| Init agent | `tu init` |
| Deploy | `tu deploy -y` |

## Workflows

| Task | Reference |
|------|-----------|
| Create agent | [./workflows/create.md](./workflows/create.md) |
| Deploy | [./workflows/deploy.md](./workflows/deploy.md) |

## Anti-patterns

- Creating task without filesystem or project
- Modifying Dockerfile ENTRYPOINT/CMD

## Error Recovery

| Error | Action |
|-------|--------|
| Deploy fails | `tu ls <branch>` → find FAILED → fix → redeploy |
```

### Workflow Format (workflows/*.md)

```markdown
# Creating an Agent

**Trigger**: User wants to create a new agent

## Steps

1. `tu namespaces ls` - List available namespaces
2. `tu init -ns <namespace> --name <name>` - Initialize agent
3. Modify agent code as needed
4. Deploy: `tu deploy -y`
```

### Reinforcement Data (reinforcement.json)

```json
{
  "totalExecutions": 150,
  "successfulExecutions": 127,
  "failedExecutions": 23,
  "avgSuccessRate": 0.847,
  "weights": {
    "overall": 1.35,
    "byAgentType": {
      "cli": 1.2,
      "cloud": 1.5,
      "nullclaw": 1.1
    },
    "byWorkflow": {
      "create": 1.4,
      "deploy": 1.3,
      "interact": 1.2
    },
    "trend": "improving"
  },
  "recentFeedback": [
    {
      "timestamp": 1234567890,
      "agentType": "cli",
      "workflowName": "create",
      "success": true,
      "executionTime": 2500,
      "notes": "Completed successfully"
    }
  ],
  "lastUpdated": 1234567890
}
```

## Usage

### Programmatic API

```typescript
import { skillsManager } from '@/lib/skills/skills-manager';
import { promptEngineeringService } from '@/lib/skills/prompt-engineering';

// Load all skills
await skillsManager.loadAllSkills();

// Engineer prompt with skill contexts
const prompt = await promptEngineeringService.engineerPrompt({
  agentType: 'cli',
  taskDescription: 'Create and deploy a new agent',
  includeSkills: ['terminaluse'],
  maxSkills: 5,
  weightThreshold: 0.7,
});

console.log(prompt.systemPrompt);
// Includes skill contexts with weights

console.log(prompt.ejsonData);
// Structured data for skill parameters

// Record feedback for reinforcement learning
await promptEngineeringService.recordFeedback(
  'terminaluse',
  'cli',
  'create',
  true, // success
  2500, // execution time in ms
  'Completed successfully'
);

// Get skill recommendations
const recommendations = await promptEngineeringService.getSkillRecommendations(
  'Deploy an agent to production',
  'cloud'
);
```

### CLI Commands

```bash
# Add new skill
npx skills add \
  --name my-skill \
  --description "My custom skill" \
  --system-prompt "..." \
  --tags "custom,automation"

# List skills
npx skills list

# Show skill details
npx skills show terminaluse

# Update skill weights (manual adjustment)
npx skills weight terminaluse --agent-type cli --value 1.5

# Export skill reinforcement data
npx skills export terminaluse --output reinforcement.json

# Import skill reinforcement data
npx skills import reinforcement.json
```

## Agent Type Profiles

### CLI Agent
- **Strengths**: Local execution, filesystem access, fast response
- **Weaknesses**: Limited resources, no persistence
- **Preferred Skills**: terminal-operations, file-manipulation, local-testing
- **Weight Modifier**: 1.0

### Cloud Agent
- **Strengths**: Scalability, persistence, API access
- **Weaknesses**: Latency, cost
- **Preferred Skills**: api-integration, cloud-deployment, database-operations
- **Weight Modifier**: 1.2

### Nullclaw Agent
- **Strengths**: MCP integration, tool calling, structured output
- **Weaknesses**: Complexity, setup requirements
- **Preferred Skills**: mcp-operations, tool-orchestration, multi-step-workflows
- **Weight Modifier**: 1.1

### TerminalUse Agent
- **Strengths**: Agent deployment, task management, filesystem isolation
- **Weaknesses**: Platform dependency
- **Preferred Skills**: agent-creation, deployment-workflows, task-orchestration
- **Weight Modifier**: 1.15

## Reinforcement Learning

### Weight Adjustment

Weights are adjusted based on execution outcomes:

```typescript
// Success increases weight
skill.reinforcement.weights.byAgentType[agentType] += 0.05 * modifier;

// Failure decreases weight (larger impact)
skill.reinforcement.weights.byAgentType[agentType] -= 0.1 * modifier;
```

### Trend Detection

Trends are calculated from recent 10 executions:
- **Improving**: >70% success rate
- **Stable**: 30-70% success rate
- **Declining**: <30% success rate

### Agent-Type Specific Learning

Each agent type has independent weights:
- CLI agents may excel at filesystem operations
- Cloud agents may excel at API integrations
- Weights are tracked separately per agent type

## System Prompt Engineering

### Prompt Structure

```
# Task
{task description}

You are an AI agent of type: {AGENT_TYPE}

# Available Skills

## Skill: {skill-name}
[HIGHLY RECOMMENDED - Success Rate: 75%]
{skill system prompt}

**Workflows**: create, deploy, interact
**Sub-Capabilities**: capability1, capability2
**Weight**: 1.35

# Agent Type: CLI

## Strengths
- Local execution
- Filesystem access
- Fast response

## Execution Guidelines

1. Choose skills based on weight indicators
2. Follow workflow steps precisely
3. If a skill fails, check recent feedback
4. Your results improve future recommendations
```

### Weight Indicators

- **Weight > 1.5**: `[HIGHLY RECOMMENDED - Success Rate: X%]`
- **Weight < 0.7**: `[USE WITH CAUTION - Recent issues detected]`
- **Weight 0.7-1.5**: No indicator (normal)

## EJSON Data Passing

Skills can define JSON schemas for structured data:

```typescript
// Skill definition
{
  ejsonSchema: {
    type: 'object',
    properties: {
      agentName: { type: 'string' },
      deploymentEnv: { type: 'string', enum: ['prod', 'preview'] },
    }
  }
}

// Generated EJSON data
{
  "terminaluse": {
    "skill": "terminaluse",
    "version": "1.0.0",
    "capabilities": ["agent-creation", "deployment"],
    "workflows": [
      { "name": "create", "trigger": "create agent", "steps": 4 }
    ],
    "reinforcement": {
      "successRate": 0.847,
      "trend": "improving",
      "totalExecutions": 150
    }
  }
}
```

## File Structure

```
.agents/skills/
├── terminaluse/
│   ├── SKILL.md
│   ├── reinforcement.json
│   └── workflows/
│       ├── create.md
│       ├── deploy.md
│       └── interact.md
├── my-custom-skill/
│   ├── SKILL.md
│   └── reinforcement.json
└── ...
```

## Best Practices

### Creating Skills

1. **Clear Naming**: Use descriptive, unique names
2. **Comprehensive Description**: Explain what the skill does
3. **Tag Appropriately**: Use relevant tags for discovery
4. **Define Workflows**: Break down complex tasks into workflows
5. **Test Thoroughly**: Ensure workflows work before deploying

### Reinforcement Learning

1. **Record All Executions**: Success and failure data is valuable
2. **Include Notes**: Context helps understand failures
3. **Provide Corrections**: Document what fixed the issue
4. **Monitor Trends**: Watch for declining performance

### System Prompt Engineering

1. **Weight Thresholds**: Adjust based on use case
2. **Max Skills**: Limit to prevent prompt bloat
3. **Agent Type Awareness**: Leverage type-specific strengths
4. **EJSON Usage**: Use for complex parameter passing

## Troubleshooting

### Skills Not Loading

1. Check SKILL.md format
2. Verify directory structure
3. Check logs for parse errors

### Weights Not Updating

1. Ensure reinforcement is enabled
2. Check execution recording
3. Verify reinforcement.json is writable

### Prompt Too Long

1. Reduce maxSkills parameter
2. Increase weightThreshold
3. Exclude non-essential skills

## Related Documentation

- [TerminalUse Skills](../.agents/skills/terminaluse/SKILL.md) - Example skill
- [Event System](./EVENT_SYSTEM.md) - Skill bootstrap events
- [Agent Orchestration](./AGENT_ORCHESTRATION.md) - Agent type profiles
