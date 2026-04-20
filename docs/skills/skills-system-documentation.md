---
id: skills-skills-system-documentation
title: Skills System Documentation
aliases:
  - README
  - README.md
  - skills-system-documentation
  - skills-system-documentation.md
tags:
  - skills
layer: core
summary: "# Skills System Documentation\r\n\r\n## Overview\r\n\r\nThe Skills System allows you to define reusable agent capabilities that can be:\r\n- **Global**: Project-wide skills (placed in `.agents/skills/global/` folder)\r\n- **User-specific**: Per-user customization (placed in `.agents/skills/user/` folder)\r\n\r\nSki"
anchors:
  - Overview
  - Quick Start
  - Adding a Skill Manually
  - CLI Commands
  - Integration with Capabilities
  - Integration with Tool Registry
  - Skill Structure
  - SKILL.md Format
  - Sub-Capabilities
  - EJSON Schema
  - Workflow Format
  - Steps
  - Expected Output
  - Error Handling
  - Reinforcement Learning
  - Best Practices
  - Examples
  - Troubleshooting
  - Skill not loading
  - Skill not being used
  - Weight not updating
relations:
  - type: implements
    id: skills-system-implementation-summary
    title: Skills System Implementation Summary
    path: skills-system-implementation-summary.md
    confidence: 0.369
    classified_score: 0.364
    auto_generated: true
    generator: apply-classified-suggestions
---
# Skills System Documentation

## Overview

The Skills System allows you to define reusable agent capabilities that can be:
- **Global**: Project-wide skills (placed in `.agents/skills/global/` folder)
- **User-specific**: Per-user customization (placed in `.agents/skills/user/` folder)

Skills are automatically loaded and can be used by agents for task execution with reinforcement learning-based weight adjustment.

## Quick Start

### Adding a Skill Manually

1. **Create skill folder**:
   ```bash
   # Global skill (project-wide, versioned with project)
   mkdir -p .agents/skills/global/my-skill
   
   # User-specific skill (per-user instance)
   mkdir -p .agents/skills/user/my-skill
   ```

2. **Create SKILL.md**:
   ```markdown
   ---
   name: my-skill
   description: Description of what this skill does
   tags: [tag1, tag2, tag3]
   ---

   # System Prompt

   This is the system prompt that will be injected when this skill is used.
   
   ## Sub-Capabilities
   
   - capability-1
   - capability-2
   ```

3. **Add workflows** (optional):
   ```bash
   mkdir -p .agents/skills/global/my-skill/workflows
   ```
   
   Create workflow files:
   ```markdown
   # Workflow Name
   
   **Trigger**: When user wants to do X
   
   Workflow description here.
   
   ## Steps
   
   ```bash
   step 1 command
   step 2 command
   ```
   ```

4. **Initialize reinforcement data**:
   ```bash
   cat > .agents/skills/global/my-skill/reinforcement.json << 'EOF'
   {
     "totalExecutions": 0,
     "successfulExecutions": 0,
     "failedExecutions": 0,
     "avgSuccessRate": 0,
     "weights": {
       "overall": 1.0,
       "byAgentType": {},
       "byWorkflow": {},
       "trend": "stable"
     },
     "recentFeedback": [],
     "lastUpdated": 1234567890
   }
   EOF
   ```

## CLI Commands

```bash
# List all skills
npx skills list

# Show skill details
npx skills show <skill-name>

# Add new skill via CLI
npx skills add <name> -d "Description" -p "System prompt" -t "tag1,tag2"

# Enable/disable skills
npx skills enable <skill-name>
npx skills disable <skill-name>

# Update weights
npx skills weight <name> --agent-type cli -v 1.5

# Export/import skills
npx skills export <name> -o skill-export.json
npx skills import skill-export.json

# Test skill
npx skills test <name> --agent-type cli

# View analytics
npx skills analytics <name>
```

## Integration with Capabilities

Skills are automatically exposed as capabilities via `skills-capabilities.ts`:

```typescript
import { registerSkillCapabilities } from '@/lib/tools/skills-capabilities';

// Register all skills as capabilities
const capabilities = await registerSkillCapabilities();

// Capabilities are named: skill.<skill-name> and skill.<skill-name>.<workflow>
```

## Integration with Tool Registry

Skills can be registered as tools:

```typescript
import { ToolRegistry } from '@/lib/tools/registry';
import { skillsRegistry } from '@/lib/skills/skills-registry';

const registry = ToolRegistry.getInstance();
await skillsRegistry.initialize();

for (const skill of skillsRegistry.getAllSkills()) {
  if (skill.enabled) {
    await registry.registerTool({
      name: `skill.${skill.config.metadata.name}`,
      capability: 'skill.execute',
      description: skill.config.metadata.description,
      // ... tool configuration
    });
  }
}
```

## Skill Structure

```
.agents/skills/
├── global/                 # Project-wide skills (versioned)
│   └── my-skill/
│       ├── SKILL.md              # Required: Skill definition
│       ├── reinforcement.json    # Required: Learning data
│       └── workflows/            # Optional: Workflow definitions
│           ├── workflow-1.md
│           └── workflow-2.md
└── user/                   # Per-user customization
    └── my-skill/
        ├── SKILL.md
        └── reinforcement.json
```

### SKILL.md Format

```markdown
---
name: skill-name
description: What this skill does
version: 1.0.0
author: Your Name
tags: [tag1, tag2, tag3]
---

# System Prompt

This content is injected as the system prompt when the skill is used.

## Sub-Capabilities

- List of capabilities this skill provides
- Used for capability-based routing

## EJSON Schema

Optional: Define expected input/output schema for structured data passing.
```

### Workflow Format

```markdown
# Workflow Name

**Trigger**: When user wants to accomplish X

Detailed description of when and how to use this workflow.

## Steps

```bash
command 1
command 2
```

## Expected Output

Description of what successful execution looks like.

## Error Handling

What to do if steps fail.
```

## Reinforcement Learning

The skills system tracks:
- **Execution success/failure** per agent type and workflow
- **Weight adjustments** based on performance
- **Trend analysis** (improving/stable/declining)
- **Recent feedback** for debugging

Weights affect skill selection probability:
- Higher weight = more likely to be chosen
- Agent-type specific weights for specialized skills
- Workflow-specific weights for different scenarios

## Best Practices

1. **Start simple**: Begin with basic skills and add complexity
2. **Test thoroughly**: Use `npx skills test` before deploying
3. **Monitor performance**: Check analytics regularly
4. **Update weights**: Adjust based on real-world performance
5. **Document workflows**: Clear triggers and steps help agents

## Examples

See existing skills in `.agents/skills/global/` and `.agents/skills/user/` for examples.

## Troubleshooting

### Skill not loading
- Check SKILL.md exists and is valid
- Verify directory structure
- Check logs for parse errors

### Skill not being used
- Ensure skill is enabled: `npx skills enable <name>`
- Check weights: `npx skills analytics <name>`
- Verify agent type matches skill's preferred agents

### Weight not updating
- Ensure executions are being recorded
- Check reinforcement.json is writable
- Verify agent type is being passed correctly
