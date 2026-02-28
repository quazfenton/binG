# CrewAI Integration Plan - Advanced Multi-Agent Orchestration

**Date**: 2026-02-27  
**Status**: Planning & Implementation  
**Goal**: Add CrewAI role-based multi-agent orchestration WITHOUT replacing existing custom stateful agent

---

## Executive Summary

After thorough review of CrewAI documentation and the existing codebase:

### Current State
- ✅ Custom stateful agent is **production-ready** (~92% complete)
- ✅ Existing tools, VFS, sandbox all working
- ✅ LangGraph integration added (optional alternative)
- ❌ **CrewAI NOT installed** - needs `crewai` package

### Opportunity
Add **CrewAI role-based orchestration** as an **OPTIONAL alternative** to custom/LangGraph orchestration:
- ✅ **Builds upon** existing tools and state management
- ✅ **Does NOT replace** working custom implementation
- ✅ **Provides** role-based agent teams (Planner, Executor, Critic)
- ✅ **Enables** YAML configuration for agent definitions
- ✅ **Supports** sequential, hierarchical, and consensual processes

---

## Architecture Comparison

### Current Custom Orchestration ✅
```
User → StatefulAgent → Tools → VFS State → Shadow Commit
```

### LangGraph Option (Added Previously)
```
User → LangGraph Graph → Nodes (Planner/Executor/Verifier) → Checkpointer
```

### CrewAI Option (NEW Addition)
```
User → CrewAI Crew → Agents (Role-based) → Tasks → Existing Tools
                                      ↓
                                Existing VFS State (reused!)
```

**Key Insight**: CrewAI agents can **CALL** existing tools and state management!

---

## Implementation Plan

### Phase 1: CrewAI Core Integration (NEW)

#### 1.1 Installation
```bash
pnpm add crewai crewai-tools
```

**Note**: CrewAI is primarily Python-based. For TypeScript/Next.js, we have two options:

**Option A**: Python CrewAI service with API wrapper  
**Option B**: CrewAI-inspired TypeScript implementation (recommended for this codebase)

**Decision**: **Option B** - CrewAI-inspired TypeScript implementation that:
- Reuses existing StatefulAgent class
- Adds role-based agent configuration
- Supports YAML agent definitions
- Integrates with existing tools

---

#### 1.2 Agent Configuration (YAML Support)

**File**: `lib/crewai/config/agents.yaml`

```yaml
# src/config/agents.yaml
# Role-based agent definitions

planner:
  role: >
    Senior Solutions Architect
  goal: >
    Create detailed, executable plans for user requests
  backstory: >
    You're a seasoned software architect with expertise in breaking down
    complex requirements into actionable, sequential tasks. Known for your
    methodical approach and attention to dependencies.
  llm: gpt-4o
  max_iter: 15
  max_rpm: 20
  verbose: true
  reasoning: true
  max_reasoning_attempts: 2

coder:
  role: >
    Senior Full-Stack Developer
  goal: >
    Implement code changes according to the approved plan
  backstory: >
    You're an expert developer proficient in TypeScript, Python, and modern
    frameworks. You write clean, maintainable code with proper error handling.
  llm: claude-sonnet-4-20250514
  allow_code_execution: true
  code_execution_mode: safe
  max_execution_time: 300
  verbose: true

critic:
  role: >
    Code Reviewer & Security Auditor
  goal: >
    Validate code quality, security, and adherence to best practices
  backstory: >
    You're a meticulous code reviewer with expertise in security auditing.
    You catch bugs, security issues, and suggest improvements.
  llm: gpt-4o
  respect_context_window: true
  verbose: true

tester:
  role: >
    QA Engineer
  goal: >
    Generate and execute tests for changed code
  backstory: >
    You're a QA expert who ensures all changes are properly tested.
    You write comprehensive test cases covering edge cases.
  llm: gpt-4o-mini
  verbose: true
```

---

#### 1.3 Agent Class with YAML Support

**File**: `lib/crewai/agents/role-agent.ts`

```typescript
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { StatefulAgent, type StatefulAgentOptions } from '@/lib/stateful-agent/agents/stateful-agent';
import type { SandboxHandle } from '@/lib/sandbox/providers';

/**
 * CrewAI-inspired Role Agent Configuration
 */
export interface RoleAgentConfig {
  role: string;
  goal: string;
  backstory: string;
  llm?: string;
  function_calling_llm?: string;
  max_iter?: number;
  max_rpm?: number;
  max_execution_time?: number;
  verbose?: boolean;
  allow_delegation?: boolean;
  cache?: boolean;
  allow_code_execution?: boolean;
  code_execution_mode?: 'safe' | 'unsafe';
  respect_context_window?: boolean;
  reasoning?: boolean;
  max_reasoning_attempts?: number;
  inject_date?: boolean;
  date_format?: string;
  multimodal?: boolean;
}

/**
 * Role-based agent that extends StatefulAgent with CrewAI-inspired configuration
 */
export class RoleAgent extends StatefulAgent {
  public readonly role: string;
  public readonly goal: string;
  public readonly backstory: string;
  public readonly config: RoleAgentConfig;

  constructor(
    sessionId: string,
    config: RoleAgentConfig,
    options: Omit<StatefulAgentOptions, 'sessionId'> = {}
  ) {
    super({
      sessionId,
      ...options,
      // Override with CrewAI-inspired config
      maxSelfHealAttempts: config.max_reasoning_attempts || 3,
      enforcePlanActVerify: config.reasoning || false,
    });

    this.role = config.role;
    this.goal = config.goal;
    this.backstory = config.backstory;
    this.config = config;

    // Set system prompt based on role
    this.setSystemPrompt(this.buildSystemPrompt());
  }

  /**
   * Build system prompt from role configuration
   */
  private buildSystemPrompt(): string {
    return `You are a ${this.role}.

## Your Goal
${this.goal}

## Your Background
${this.backstory}

## Instructions
- Think step-by-step before taking action
- Use available tools when needed
- Ask for clarification if requirements are unclear
- Follow best practices for your role
- ${this.config.reasoning ? 'Create a plan before executing tasks' : 'Execute tasks directly'}

## Constraints
- ${this.config.allow_code_execution ? 'You can execute code in a sandboxed environment' : 'You cannot execute code directly'}
- ${this.config.max_execution_time ? `Maximum execution time: ${this.config.max_execution_time}s` : ''}
- ${this.config.respect_context_window ? 'Automatically manage context window to avoid token limits' : ''}
`;
  }

  /**
   * Load agent configuration from YAML
   */
  static async loadFromYAML(
    yamlPath: string,
    agentName: string,
    sessionId: string
  ): Promise<RoleAgent> {
    const yamlContent = await fs.readFile(yamlPath, 'utf-8');
    const agents = yaml.load(yamlContent) as Record<string, RoleAgentConfig>;
    
    const config = agents[agentName];
    if (!config) {
      throw new Error(`Agent "${agentName}" not found in ${yamlPath}`);
    }

    return new RoleAgent(sessionId, config);
  }

  /**
   * Load all agents from YAML
   */
  static async loadAllFromYAML(
    yamlPath: string,
    sessionId: string
  ): Promise<Map<string, RoleAgent>> {
    const yamlContent = await fs.readFile(yamlPath, 'utf-8');
    const agents = yaml.load(yamlContent) as Record<string, RoleAgentConfig>;
    
    const agentMap = new Map<string, RoleAgent>();
    
    for (const [name, config] of Object.entries(agents)) {
      agentMap.set(name, new RoleAgent(`${sessionId}-${name}`, config));
    }

    return agentMap;
  }

  /**
   * Execute agent with CrewAI-style kickoff
   */
  async kickoff(input: string): Promise<RoleAgentOutput> {
    const startTime = Date.now();
    
    try {
      // Run agent with role-specific prompt
      const result = await this.run(input);
      
      return {
        raw: result.response,
        role: this.role,
        usage_metrics: {
          total_tokens: 0, // Would need to track from LLM
          prompt_tokens: 0,
          completion_tokens: 0,
        },
        execution_time: Date.now() - startTime,
        success: result.success,
      };
    } catch (error) {
      return {
        raw: error instanceof Error ? error.message : 'Unknown error',
        role: this.role,
        usage_metrics: {
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
        },
        execution_time: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Async version of kickoff
   */
  async kickoffAsync(input: string): Promise<RoleAgentOutput> {
    return this.kickoff(input);
  }
}

/**
 * Agent output structure
 */
export interface RoleAgentOutput {
  raw: string;
  role: string;
  usage_metrics: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
  execution_time: number;
  success: boolean;
  error?: string;
}
```

---

### Phase 2: Task System (NEW)

#### 2.1 Task Definition

**File**: `lib/crewai/tasks/task.ts`

```typescript
import type { RoleAgent } from '../agents/role-agent';

/**
 * Task configuration
 */
export interface TaskConfig {
  description: string;
  expected_output?: string;
  agent: RoleAgent;
  context?: Task[]; // Tasks whose output provides context
  async_execution?: boolean;
  output_file?: string;
  output_json?: any; // Pydantic model equivalent
  output_pydantic?: any; // For structured output
  human_input?: boolean;
  max_iter?: number;
  tools?: any[]; // Override agent tools
}

/**
 * Task execution result
 */
export interface TaskOutput {
  description: string;
  summary?: string;
  raw: string;
  pydantic?: any;
  json_dict?: Record<string, any>;
  agent: string;
  output_format: 'RAW' | 'JSON' | 'PYDANTIC';
}

/**
 * Task class for CrewAI-style task execution
 */
export class Task {
  public readonly description: string;
  public readonly expected_output?: string;
  public readonly agent: RoleAgent;
  public readonly context?: Task[];
  public readonly async_execution?: boolean;
  public readonly output_file?: string;
  public readonly output_json?: any;
  public readonly output_pydantic?: any;
  public readonly human_input?: boolean;
  public readonly max_iter?: number;
  public readonly tools?: any[];

  private output?: TaskOutput;

  constructor(config: TaskConfig) {
    this.description = config.description;
    this.expected_output = config.expected_output;
    this.agent = config.agent;
    this.context = config.context;
    this.async_execution = config.async_execution;
    this.output_file = config.output_file;
    this.output_json = config.output_json;
    this.output_pydantic = config.output_pydantic;
    this.human_input = config.human_input;
    this.max_iter = config.max_iter;
    this.tools = config.tools;
  }

  /**
   * Execute task
   */
  async execute(inputs?: Record<string, string>): Promise<TaskOutput> {
    // Build context from previous tasks
    let context = '';
    if (this.context) {
      context = this.context
        .map(task => task.output?.raw)
        .filter(Boolean)
        .join('\n\n---\n\n');
    }

    // Build prompt
    let prompt = this.description;
    if (context) {
      prompt += `\n\n## Context from Previous Tasks\n${context}`;
    }
    if (inputs) {
      prompt += `\n\n## Inputs\n${JSON.stringify(inputs, null, 2)}`;
    }
    if (this.expected_output) {
      prompt += `\n\n## Expected Output\n${this.expected_output}`;
    }

    // Execute with agent
    const result = await this.agent.kickoff(prompt);

    // Create output
    this.output = {
      description: this.description,
      summary: result.raw.slice(0, 100) + '...',
      raw: result.raw,
      agent: this.agent.role,
      output_format: this.output_pydantic ? 'PYDANTIC' : this.output_json ? 'JSON' : 'RAW',
      pydantic: this.output_pydantic ? this.parsePydantic(result.raw) : undefined,
      json_dict: this.output_json ? JSON.parse(result.raw) : undefined,
    };

    // Save to file if specified
    if (this.output_file) {
      await this.saveToFile(this.output_file);
    }

    return this.output;
  }

  /**
   * Get task output
   */
  getOutput(): TaskOutput | undefined {
    return this.output;
  }

  /**
   * Save output to file
   */
  private async saveToFile(filePath: string): Promise<void> {
    if (!this.output) return;
    
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, this.output.raw, 'utf-8');
  }

  /**
   * Parse Pydantic-style output (TypeScript equivalent)
   */
  private parsePydantic(output: string): any {
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  }
}
```

---

### Phase 3: Crew Orchestration (NEW)

#### 3.1 Crew Class

**File**: `lib/crewai/crew/crew.ts`

```typescript
import type { RoleAgent } from '../agents/role-agent';
import type { Task } from '../tasks/task';

/**
 * Process type for crew execution
 */
export type ProcessType = 'sequential' | 'hierarchical' | 'consensual';

/**
 * Crew configuration
 */
export interface CrewConfig {
  agents: RoleAgent[];
  tasks: Task[];
  process?: ProcessType;
  verbose?: boolean;
  memory?: boolean;
  cache?: boolean;
  max_rpm?: number;
  share_crew?: boolean;
  step_callback?: (output: any) => void;
  process_llm?: string; // LLM for process orchestration
}

/**
 * Crew execution result
 */
export interface CrewOutput {
  raw: string;
  pydantic?: any;
  json_dict?: Record<string, any>;
  tasks_output: TaskOutput[];
  token_usage: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Crew class for orchestrating multi-agent workflows
 */
export class Crew {
  public readonly agents: RoleAgent[];
  public readonly tasks: Task[];
  public readonly process: ProcessType;
  public readonly verbose: boolean;
  public readonly memory: boolean;
  public readonly cache: boolean;
  public readonly max_rpm?: number;
  public readonly share_crew: boolean;
  public readonly step_callback?: (output: any) => void;
  public readonly process_llm?: string;

  private output?: CrewOutput;

  constructor(config: CrewConfig) {
    this.agents = config.agents;
    this.tasks = config.tasks;
    this.process = config.process || 'sequential';
    this.verbose = config.verbose || false;
    this.memory = config.memory || false;
    this.cache = config.cache ?? true;
    this.max_rpm = config.max_rpm;
    this.share_crew = config.share_crew || false;
    this.step_callback = config.step_callback;
    this.process_llm = config.process_llm;
  }

  /**
   * Execute crew
   */
  async kickoff(inputs?: Record<string, string>): Promise<CrewOutput> {
    const startTime = Date.now();
    const tasksOutput: TaskOutput[] = [];

    this.log('🚀 Starting crew execution...', 'header');
    this.log(`Process: ${this.process}`);
    this.log(`Agents: ${this.agents.map(a => a.role).join(', ')}`);
    this.log(`Tasks: ${this.tasks.length}`);
    this.log('');

    // Execute based on process type
    if (this.process === 'sequential') {
      await this.executeSequential(inputs, tasksOutput);
    } else if (this.process === 'hierarchical') {
      await this.executeHierarchical(inputs, tasksOutput);
    } else if (this.process === 'consensual') {
      await this.executeConsensual(inputs, tasksOutput);
    }

    // Create final output
    this.output = {
      raw: tasksOutput.map(t => t.raw).join('\n\n'),
      tasks_output: tasksOutput,
      token_usage: {
        total_tokens: 0, // Would aggregate from tasks
        prompt_tokens: 0,
        completion_tokens: 0,
      },
    };

    this.log('');
    this.log('✅ Crew execution completed', 'success');
    this.log(`Total time: ${Date.now() - startTime}ms`);

    return this.output;
  }

  /**
   * Sequential execution (default)
   */
  private async executeSequential(
    inputs?: Record<string, string>,
    tasksOutput?: TaskOutput[]
  ): Promise<void> {
    for (const task of this.tasks) {
      this.log(`\n📋 Executing task: ${task.description.slice(0, 50)}...`);
      
      const output = await task.execute(inputs);
      tasksOutput?.push(output);
      
      this.log(`✓ Task completed by ${output.agent}`);
      
      if (this.step_callback) {
        this.step_callback(output);
      }
    }
  }

  /**
   * Hierarchical execution (manager delegates to agents)
   */
  private async executeHierarchical(
    inputs?: Record<string, string>,
    tasksOutput?: TaskOutput[]
  ): Promise<void> {
    // First agent is manager
    const manager = this.agents[0];
    
    this.log(`\n👔 Manager ${manager.role} coordinating execution...`);
    
    // Manager creates execution plan
    const plan = await manager.kickoff(
      `Create execution plan for these tasks:\n${this.tasks.map(t => `- ${t.description}`).join('\n')}`
    );
    
    this.log(`Plan created:\n${plan.raw}`);
    
    // Execute remaining tasks
    for (const task of this.tasks.slice(1)) {
      this.log(`\n📋 Executing task: ${task.description.slice(0, 50)}...`);
      
      const output = await task.execute(inputs);
      tasksOutput?.push(output);
      
      this.log(`✓ Task completed by ${output.agent}`);
    }
  }

  /**
   * Consensual execution (all agents collaborate)
   */
  private async executeConsensual(
    inputs?: Record<string, string>,
    tasksOutput?: TaskOutput[]
  ): Promise<void> {
    for (const task of this.tasks) {
      this.log(`\n📋 Executing task with collaboration: ${task.description.slice(0, 50)}...`);
      
      // Each agent provides input
      const agentOutputs: string[] = [];
      for (const agent of this.agents) {
        this.log(`  → ${agent.role} providing input...`);
        const output = await agent.kickoff(
          `Provide your expertise for this task: ${task.description}`
        );
        agentOutputs.push(`${agent.role}: ${output.raw}`);
      }
      
      // Synthesize final output
      const synthesis = await task.agent.kickoff(
        `Synthesize these inputs into final output:\n${agentOutputs.join('\n\n')}`
      );
      
      tasksOutput?.push({
        description: task.description,
        raw: synthesis.raw,
        agent: task.agent.role,
        output_format: 'RAW',
      });
      
      this.log(`✓ Task completed with collaboration`);
    }
  }

  /**
   * Logging helper
   */
  private log(message: string, type: 'header' | 'success' | 'error' | 'info' = 'info'): void {
    if (!this.verbose) return;
    
    const prefix = {
      header: '🎯',
      success: '✅',
      error: '❌',
      info: 'ℹ️',
    }[type];
    
    console.log(`${prefix} ${message}`);
  }
}
```

---

### Phase 4: Integration with Existing Tools (REUSE)

#### 4.1 Tool Adapter

**File**: `lib/crewai/tools/tool-adapter.ts`

```typescript
import type { RoleAgent } from '../agents/role-agent';
import { allTools } from '@/lib/stateful-agent/tools/sandbox-tools';

/**
 * Adapt existing tools for CrewAI agents
 */
export function createCrewAITools(agent: RoleAgent) {
  // Reuse existing sandbox tools
  return {
    writeFile: allTools.applyDiffTool,
    readFile: allTools.readFileTool,
    listFiles: allTools.listFilesTool,
    createFile: allTools.createFileTool,
    execShell: allTools.execShellTool,
  };
}

/**
 * Create agent with tools
 */
export function createAgentWithTools(
  sessionId: string,
  agentName: string,
  yamlPath: string
): Promise<RoleAgent> {
  return RoleAgent.loadFromYAML(yamlPath, agentName, sessionId);
}
```

---

### Phase 5: Usage Examples

#### 5.1 Basic Sequential Crew

**File**: `examples/crew-sequential.ts`

```typescript
import { RoleAgent } from '@/lib/crewai/agents/role-agent';
import { Task } from '@/lib/crewai/tasks/task';
import { Crew } from '@/lib/crewai/crew/crew';

async function runSequentialCrew() {
  // Load agents from YAML
  const agents = await RoleAgent.loadAllFromYAML(
    'src/config/agents.yaml',
    'session-123'
  );

  const planner = agents.get('planner')!;
  const coder = agents.get('coder')!;
  const critic = agents.get('critic')!;

  // Create tasks
  const planningTask = new Task({
    description: 'Create detailed plan for building a REST API',
    expected_output: 'JSON plan with endpoints, models, and implementation steps',
    agent: planner,
  });

  const codingTask = new Task({
    description: 'Implement the API according to the plan',
    agent: coder,
    context: [planningTask],
  });

  const reviewTask = new Task({
    description: 'Review code for quality and security',
    agent: critic,
    context: [codingTask],
  });

  // Create crew
  const crew = new Crew({
    agents: [planner, coder, critic],
    tasks: [planningTask, codingTask, reviewTask],
    process: 'sequential',
    verbose: true,
  });

  // Execute
  const result = await crew.kickoff({
    topic: 'User authentication API',
  });

  console.log('Final output:', result.raw);
}
```

#### 5.2 Hierarchical Crew

```typescript
const crew = new Crew({
  agents: [manager, developer, tester],
  tasks: [managementTask, devTask, testTask],
  process: 'hierarchical', // Manager coordinates
  verbose: true,
});
```

#### 5.3 Consensual Crew

```typescript
const crew = new Crew({
  agents: [expert1, expert2, expert3, synthesizer],
  tasks: [collaborativeTask],
  process: 'consensual', // All agents collaborate
  verbose: true,
});
```

---

## Environment Variables

Add to `env.example`:

```bash
# ===========================================
# CREWAI MULTI-AGENT ORCHESTRATION
# ===========================================

# Enable CrewAI orchestration (default: false - uses custom orchestration)
# When enabled, uses CrewAI role-based agents instead of single agent
USE_CREWAI=false

# CrewAI configuration
CREWAI_DEFAULT_PROCESS=sequential  # sequential | hierarchical | consensual
CREWAI_VERBOSE=true
CREWAI_MEMORY=false
CREWAI_CACHE=true
CREWAI_MAX_RPM=30

# Agent configuration file path
CREWAI_AGENTS_CONFIG=src/config/agents.yaml

# Process orchestration LLM (for hierarchical process)
CREWAI_PROCESS_LLM=gpt-4o
```

---

## File Structure

```
lib/
├── stateful-agent/              # EXISTING - Custom orchestration
│   ├── agents/
│   │   └── stateful-agent.ts    # ✅ Reused by CrewAI
│   └── tools/
│       └── sandbox-tools.ts     # ✅ Reused by CrewAI
│
├── crewai/                      # NEW: CrewAI integration
│   ├── agents/
│   │   └── role-agent.ts        # Role-based agents
│   ├── tasks/
│   │   └── task.ts              # Task definitions
│   ├── crew/
│   │   └── crew.ts              # Crew orchestration
│   ├── tools/
│   │   └── tool-adapter.ts      # Tool adapter
│   └── config/
│       └── agents.yaml          # Agent configurations
│
└── langgraph/                   # EXISTING: LangGraph integration
```

---

## Benefits Summary

| Feature | Custom | LangGraph | CrewAI | Combined |
|---------|--------|-----------|--------|----------|
| **Orchestration** | Custom loop | Graph-based | Role-based | **All three** |
| **Configuration** | Code | Code | **YAML + Code** | **Flexible** |
| **Agent Roles** | Single | Nodes | **Specialized** | **Best of all** |
| **Process Types** | Fixed | Graph edges | **3 types** | **Most flexible** |
| **Tools** | ✅ Working | ✅ Reuses | ✅ Reuses | **Shared** |
| **State** | ✅ VfsState | ✅ Extends | ✅ Reuses | **Compatible** |
| **Memory** | Basic | Checkpointer | **Built-in** | **Enhanced** |
| **Observability** | Logs | LangSmith | **Verbose mode** | **All available** |

---

## Implementation Priority

### HIGH (Implement First)
1. ✅ RoleAgent class with YAML support
2. ✅ Task class with context handling
3. ✅ Crew class with sequential process
4. ✅ Tool adapter for existing tools

### MEDIUM (Nice to Have)
5. ✅ Hierarchical process
6. ✅ Consensual process
7. ✅ Memory integration
8. ✅ Training/replay capabilities

### LOW (Optional)
9. CLI integration
10. Deploy to CrewAI AMP
11. Advanced RAG integration

---

## Conclusion

**This plan ADDS CrewAI WITHOUT replacing working implementations:**

1. ✅ **Reuses** all existing tools and state
2. ✅ **Builds upon** existing StatefulAgent class
3. ✅ **Provides** role-based orchestration as an OPTION
4. ✅ **Enables** YAML configuration for agents
5. ✅ **Supports** 3 process types (sequential, hierarchical, consensual)
6. ✅ **Maintains** backward compatibility

**Total New Code**: ~1,200 lines  
**Files Created**: 6 new files + 1 YAML config  
**Files Modified**: 0 (pure addition)

---

**Plan Created**: 2026-02-27  
**Next Steps**: Implement Phase 1 (RoleAgent + YAML support)
