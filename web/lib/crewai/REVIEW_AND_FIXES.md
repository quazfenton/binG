# CrewAI Implementation Review & Fixes

**Date**: February 27, 2026
**Status**: ⚠️ **PARTIAL - Integration Fixes Needed**

---

## Review Summary

All 8 files were reviewed against official CrewAI documentation (`docs/sdk/crewai-llms.txt`).

### Implementation Quality Score: ⭐⭐⭐ (3/5)

| Component | Status | Issues |
|-----------|--------|--------|
| MCP Server | ⚠️ Partial | Missing crew integration |
| Self-Healing | ⚠️ Partial | Not connected to crew execution |
| Observability | ⚠️ Partial | LangSmith config incomplete |
| Context Window | ⚠️ Partial | Missing LLM summarization |
| Streaming | ⚠️ Partial | Not connected to crew events |
| Code Execution | ⚠️ Partial | Docker SDK calls missing |
| Tools | ✅ Good | Proper interface, needs decorators |
| Swarm | ⚠️ Partial | Not integrated with crews |

---

## Critical Fixes Required

### 1. MCP Server - Add Crew Integration

**Current Issue**: MCP server doesn't actually execute CrewAI crews.

**Fix Required**:
```typescript
// lib/crewai/mcp/server.ts
import { Crew } from '../crew/crew';

export class MCPServer extends EventEmitter {
  private crews: Map<string, Crew> = new Map();

  registerCrew(name: string, crew: Crew): void {
    this.crews.set(name, crew);
    
    // Register crew kickoff as MCP tool
    this.registerTool({
      name: `${name}_kickoff`,
      description: `Execute the ${name} crew`,
      inputSchema: z.object({ input: z.string() }),
      handler: async (params: any) => {
        const result = await crew.kickoff(params.input);
        return result.raw;
      },
    });
  }
}
```

---

### 2. Self-Healing - Connect to Crew Execution

**Current Issue**: Retry logic exists but not integrated with crew kickoff.

**Fix Required**:
```typescript
// lib/crewai/runtime/run-crewai.ts
import { RetryBudget } from './self-healing';

export async function runCrewWithRetry(
  crew: Crew,
  input: string,
  retryBudget: RetryBudget
): Promise<CrewOutput> {
  while (retryBudget.canRetry()) {
    try {
      return await crew.kickoff(input);
    } catch (error) {
      retryBudget.recordAttempt(error);
      
      if (!retryBudget.canRetry()) {
        throw error;
      }
      
      const delay = retryBudget.calculateDelay();
      await sleep(delay);
    }
  }
}
```

---

### 3. Observability - Complete LangSmith Integration

**Current Issue**: Exporter exists but not properly configured.

**Fix Required**:
```typescript
// lib/crewai/observability/index.ts
export class LangSmithExporter {
  private apiKey: string;
  private projectName: string;

  constructor(config: { apiKey: string; projectName: string }) {
    this.apiKey = config.apiKey;
    this.projectName = config.projectName;
  }

  async export(trace: Trace): Promise<void> {
    const run = this.traceToRun(trace);
    
    await fetch('https://api.smith.langchain.com/runs', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(run),
    });
  }

  private traceToRun(trace: Trace): any {
    return {
      id: trace.traceId,
      name: trace.rootSpan.name,
      run_type: 'chain',
      start_time: new Date(trace.startTime).toISOString(),
      end_time: trace.endTime ? new Date(trace.endTime).toISOString() : null,
      inputs: trace.rootSpan.attributes.input,
      outputs: trace.rootSpan.attributes.output,
      error: trace.rootSpan.status.code === 'error' ? trace.rootSpan.status.message : null,
      extra: {
        metadata: trace.attributes,
      },
    };
  }
}
```

---

### 4. Context Window - Add LLM Summarization

**Current Issue**: Summarization logic exists but doesn't actually call LLM.

**Fix Required**:
```typescript
// lib/crewai/runtime/context-window.ts
import { getModel } from './model-router';

export class ContextWindowManager {
  async summarize(): Promise<string> {
    const agent = getModel('fast');
    
    const messagesToSummarize = this.messageHistory.slice(
      -this.config.maxMessagesToSummarize
    );
    
    const conversationText = messagesToSummarize
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');
    
    const response = await agent.generate([
      { role: 'system', content: this.config.summaryPrompt },
      { role: 'user', content: conversationText },
    ]);
    
    this.summary = response.text;
    this.messageHistory = [];
    this.tokenCount = this.estimateTokens(`[Summary: ${this.summary}]`);
    
    return this.summary;
  }
}
```

---

### 5. Streaming - Connect to Crew Events

**Current Issue**: Streaming class exists but not connected to crew kickoff.

**Fix Required**:
```typescript
// lib/crewai/runtime/run-crewai.ts
import { CrewStreamingOutputImpl } from './streaming';

export async function runCrewWithStreaming(
  crew: Crew,
  input: string
): Promise<CrewStreamingOutputImpl<CrewOutput>> {
  const stream = new CrewStreamingOutputImpl<CrewOutput>();
  
  // Subscribe to crew events
  crew.on('agent_started', (data) => {
    stream.emitAgentStart(data.agentId, data.role);
  });
  
  crew.on('agent_ended', (data) => {
    stream.emitAgentEnd(data.agentId, data.output);
  });
  
  crew.on('tool_started', (data) => {
    stream.emitToolCall(data.toolName, data.toolInput);
  });
  
  crew.on('tool_ended', (data) => {
    stream.emitToolOutput(data.toolName, data.toolOutput);
  });
  
  // Execute crew
  crew.kickoff(input).then(
    (result) => stream.setResult(result),
    (error) => stream.setError(error)
  );
  
  return stream;
}
```

---

### 6. Code Execution - Add Docker SDK Calls

**Current Issue**: Docker execution logic incomplete.

**Fix Required**:
```typescript
// lib/crewai/tools/code-execution.ts
import Docker from 'dockerode';

export class DockerCodeExecutor extends EventEmitter {
  private docker: Docker;

  constructor(config: Partial<CodeExecutionConfig> = {}) {
    super();
    this.docker = new Docker();
    // ... rest of config
  }

  async execute(code: string, language: string): Promise<ExecutionResult> {
    const langConfig = SUPPORTED_LANGUAGES[language];
    if (!langConfig) {
      return { success: false, stdout: '', stderr: 'Unsupported language', exitCode: -1, durationMs: 0 };
    }

    const container = await this.docker.createContainer({
      Image: langConfig.dockerImage,
      Cmd: langConfig.runCommand(code),
      HostConfig: {
        Memory: this.config.memoryLimitMb * 1024 * 1024,
        NetworkMode: 'none', // No network access for safety
      },
    });

    try {
      await container.start();
      const logs = await container.logs({ stdout: true, stderr: true });
      const exitCode = (await container.wait()).StatusCode;
      
      return {
        success: exitCode === 0,
        stdout: logs.toString(),
        stderr: '',
        exitCode,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await container.remove();
    }
  }
}
```

---

### 7. Tools - Add CrewAI Decorator Integration

**Current Issue**: Tools have proper interface but not decorated for CrewAI.

**Fix Required**:
```typescript
// lib/crewai/tools/crewai-tools.ts
import { tool } from '@crewai/core';

@tool({
  name: 'serper_search',
  description: 'Search the web using Serper',
})
export class SerperDevTool {
  // ... existing implementation
}

// Or using function decorator pattern
export const serperSearch = tool({
  name: 'serper_search',
  description: 'Search the web using Serper',
  parameters: {
    query: { type: 'string', description: 'The search query' },
  },
})(async ({ query }) => {
  // ... existing implementation
});
```

---

### 8. Swarm - Integrate with CrewAI Crews

**Current Issue**: Swarm orchestration exists but doesn't execute actual crews.

**Fix Required**:
```typescript
// lib/crewai/swarm/index.ts
export class MultiCrewSwarm extends EventEmitter {
  async execute(input: string): Promise<AggregatorResult> {
    // Plan shards
    const shards = await this.planner.plan(input, this.config.maxParallel || 3);
    
    // Execute crews in parallel
    const shardResults = await Promise.all(
      shards.map(shard => this.executeShard(shard))
    );
    
    // Aggregate results
    return this.aggregator.aggregate(shardResults);
  }

  private async executeShard(shard: Shard): Promise<ShardResult> {
    const startTime = Date.now();
    
    try {
      const crew = this.createShardCrew(shard);
      const output = await crew.kickoff(shard.input);
      
      return {
        shardId: shard.id,
        success: true,
        output,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        shardId: shard.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };
    }
  }
}
```

---

## Integration Checklist

- [ ] MCP Server → Connect to CrewAI crews
- [ ] Self-Healing → Integrate with crew kickoff
- [ ] Observability → Complete LangSmith config
- [ ] Context Window → Add LLM summarization
- [ ] Streaming → Connect to crew events
- [ ] Code Execution → Add Docker SDK calls
- [ ] Tools → Add CrewAI decorators
- [ ] Swarm → Integrate with crew execution

---

## Next Steps

1. **Install Missing Dependencies**:
   ```bash
   npm install dockerode @crewai/core langsmith
   ```

2. **Update Files** with fixes above

3. **Test Integration**:
   ```bash
   npm test -- lib/crewai/
   ```

---

**Status**: ⚠️ **FIXES REQUIRED**
**Priority**: High (core functionality incomplete)
