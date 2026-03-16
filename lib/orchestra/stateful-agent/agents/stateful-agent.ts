import { openai } from '@ai-sdk/openai';
import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';
import { ToolExecutor } from '../tools/tool-executor';
import { reflectionEngine } from '@/lib/orchestra/reflection-engine';
import { executionGraphEngine } from '@/lib/agent/execution-graph';
import { generateObject } from 'ai';
import { z } from 'zod';

export interface StatefulAgentOptions {
  sessionId?: string;
  sandboxHandle?: SandboxHandle;
  maxSelfHealAttempts?: number;
  enforcePlanActVerify?: boolean;
  enableReflection?: boolean;
  enableTaskDecomposition?: boolean;
}

export interface StatefulAgentResult {
  success: boolean;
  response: string;
  steps: number;
  errors: Array<{ step: number; message: string; path?: string }>;
  vfs?: Record<string, string>;
  metrics?: any;
}

// ============================================================================
// Task Decomposition / Planning Engine Types
// ============================================================================

export interface Task {
  id: string;
  description: string;
  dependencies: string[];  // Task IDs that must complete first
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface TaskGraph {
  id: string;
  tasks: Task[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

// ============================================================================
// Tool Memory Graph Types
// ============================================================================

export interface MemoryNode {
  id: string;
  type: 'file' | 'entity' | 'doc' | 'code_snippet' | 'api_doc';
  content: string;
  path?: string;
  relations: MemoryEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEdge {
  type: 'imports' | 'references' | 'depends_on' | 'similar_to';
  target: string;  // Target node ID
}

export interface MemoryGraph {
  nodes: Map<string, MemoryNode>;
  edges: Map<string, Set<string>>;  // from -> to (target IDs)
}

// ============================================================================
// Planner Schema for LLM Task Decomposition
// ============================================================================

const TaskGraphSchema = z.object({
  tasks: z.array(z.object({
    id: z.string().describe('Unique task identifier'),
    description: z.string().describe('Clear, actionable task description'),
    dependencies: z.array(z.string()).describe('Task IDs that must complete first'),
  })),
});

export class StatefulAgent {
  private sessionId: string;
  private sandboxHandle?: SandboxHandle;
  private vfs: Record<string, string> = {};
  private transactionLog: Array<{ path: string; type: string; timestamp: number; originalContent?: string }> = [];
  private maxSelfHealAttempts: number;
  private enforcePlanActVerify: boolean;
  private currentPlan: any = null;
  private status: string = 'idle';
  private errors: Array<{ step: number; path?: string; message: string; timestamp: number }> = [];
  private retryCount: number = 0;
  private steps: number = 0;
  private toolExecutor: ToolExecutor;

  // Task Decomposition Engine
  private taskGraph?: TaskGraph;
  private enableTaskDecomposition: boolean;

  // Tool Memory Graph
  private memoryGraph: MemoryGraph;

  // Self-Reflection Loop
  private enableReflection: boolean;

  // Execution Graph Integration
  private executionGraphId?: string;

  constructor(options: StatefulAgentOptions = {}) {
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.sandboxHandle = options.sandboxHandle;
    this.maxSelfHealAttempts = options.maxSelfHealAttempts || 3;
    this.enforcePlanActVerify = options.enforcePlanActVerify ?? true;
    this.enableReflection = options.enableReflection ?? true;
    this.enableTaskDecomposition = options.enableTaskDecomposition ?? true;

    this.toolExecutor = new ToolExecutor({
      sandboxHandle: this.sandboxHandle,
      vfs: this.vfs,
      transactionLog: this.transactionLog as any,
    });

    // Initialize memory graph
    this.memoryGraph = {
      nodes: new Map(),
      edges: new Map(),
    };
  }

  /**
   * Create execution graph for tracking task progress
   */
  private async createExecutionGraph(): Promise<void> {
    const graph = executionGraphEngine.createGraph(this.sessionId);
    this.executionGraphId = graph.id;
    
    // Add nodes for each task in the task graph
    if (this.taskGraph) {
      for (const task of this.taskGraph.tasks) {
        executionGraphEngine.addNode(graph, {
          id: task.id,
          type: 'agent_step',
          name: task.description,
          description: task.description,
          dependencies: task.dependencies,
        });
      }
    }
  }

  /**
   * Add memory node from tool result
   */
  private async addMemoryNode(type: MemoryNode['type'], content: string, path?: string): Promise<void> {
    const nodeId = path || `memory-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const node: MemoryNode = {
      id: nodeId,
      type,
      content,
      path,
      relations: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.memoryGraph.nodes.set(nodeId, node);
    
    // Auto-detect relations (e.g., imports in code files)
    if (type === 'file' && path?.endsWith('.ts') || path?.endsWith('.js')) {
      this.detectImports(content, nodeId);
    }
  }

  /**
   * Detect import statements and create memory edges
   */
  private detectImports(content: string, nodeId: string): void {
    const importRegex = /(?:import|require)\s*['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      // Create edge to imported module
      if (!this.memoryGraph.edges.has(nodeId)) {
        this.memoryGraph.edges.set(nodeId, new Set());
      }
      this.memoryGraph.edges.get(nodeId)!.add(importPath);
    }
  }

  /**
   * Query memory graph for related content
   */
  private queryMemory(query: string, limit: number = 5): MemoryNode[] {
    const results: MemoryNode[] = [];
    const queryLower = query.toLowerCase();
    
    for (const node of this.memoryGraph.nodes.values()) {
      if (node.content.toLowerCase().includes(queryLower) || 
          node.path?.toLowerCase().includes(queryLower)) {
        results.push(node);
        if (results.length >= limit) break;
      }
    }
    
    return results;
  }

  async run(userMessage: string): Promise<StatefulAgentResult> {
    // Acquire exclusive session lock to prevent concurrent access
    const releaseLock = await acquireSessionLock(this.sessionId);

    try {
      this.status = 'discovering';
      this.steps = 0;

      try {
        await this.runDiscoveryPhase(userMessage);

        this.status = 'planning';
        await this.runPlanningPhase(userMessage);

        // Create execution graph for tracking
        if (this.enableTaskDecomposition && this.taskGraph) {
          await this.createExecutionGraph();
        }

        this.status = 'editing';
        await this.runEditingPhase(userMessage);

        this.status = 'verifying';
        await this.runVerificationPhase();

        // Apply reflection if enabled
        if (this.enableReflection) {
          await this.applyReflection();
        }

        this.status = 'completed';

        return {
          success: this.errors.length === 0,
          response: `Completed ${this.steps} steps. Modified ${this.transactionLog.length} files.`,
          steps: this.steps,
          errors: this.errors,
          vfs: this.vfs,
          metrics: this.toolExecutor.getMetrics(),
        };
      } catch (error: any) {
        this.status = 'error';
        this.errors.push({
          step: this.steps,
          message: error.message || 'Fatal execution error',
          timestamp: Date.now(),
        });

        return {
          success: false,
          response: error instanceof Error ? error.message : 'Unknown error',
          steps: this.steps,
          errors: this.errors,
          vfs: this.vfs,
        };
      }
    } finally {
      // Always release the lock, even if there's an error
      releaseLock();
    }
  }

  /**
   * Apply self-reflection to improve results
   */
  private async applyReflection(): Promise<void> {
    if (!this.enableReflection) return;

    const resultSummary = `Completed ${this.steps} steps. Modified files: ${this.transactionLog.map(t => t.path).join(', ')}`;
    
    const reflections = await reflectionEngine.reflect(resultSummary, {
      userMessage: 'Final result review',
      transactionLog: this.transactionLog,
    });

    const synthesized = reflectionEngine.synthesizeReflections(reflections);
    
    if (synthesized.overallScore < 0.7) {
      console.log('[StatefulAgent] Reflection identified improvements needed:', synthesized.prioritizedImprovements);
      // Could trigger additional fix cycle here
    }
  }

  private getModel() {
    const modelString = (process.env.DEFAULT_MODEL || 'gpt-4o').replace('openai:', '');
    return openai(modelString) as any;
  }

  private async runDiscoveryPhase(userMessage: string) {
    const discoveryPrompt = `Analyze this request and list the EXACT file paths you need to read to understand the task:

REQUEST: ${userMessage}

Respond with a list of file paths, one per line. No other text.`;

    try {
      const { generateText } = await import('ai');
      const result = await generateText({
        model: this.getModel(),
        prompt: discoveryPrompt,
      });

      const filePaths = result.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

      // Track failed reads for better error reporting
      const failedReads: string[] = [];
      const successfulReads: string[] = [];

      for (const filePath of filePaths.slice(0, 15)) {
        try {
          const readResult = await this.toolExecutor.execute('readFile', { path: filePath });
          if (readResult.success && readResult.content) {
            this.vfs[filePath] = readResult.content;
            successfulReads.push(filePath);
          } else {
            failedReads.push(filePath);
            console.warn(`[StatefulAgent] Discovery failed for ${filePath}: ${readResult.error || 'Unknown error'}`);
          }
        } catch (error: any) {
          failedReads.push(filePath);
          console.warn(`[StatefulAgent] Discovery failed for ${filePath}:`, error.message);
        }
      }

      // Log summary for debugging
      console.log(`[StatefulAgent] Discovery complete: ${successfulReads.length} files read, ${failedReads.length} failed`);
      
      if (failedReads.length > 0) {
        console.warn(`[StatefulAgent] Failed to read files:`, failedReads);
      }
      
      if (successfulReads.length === 0 && filePaths.length > 0) {
        console.error('[StatefulAgent] WARNING: No files were successfully read during discovery phase');
      }
    } catch (error: any) {
      console.error('[StatefulAgent] Discovery error:', error.message);
      // Add error to agent errors for tracking
      this.errors.push({
        step: this.steps,
        message: `Discovery phase failed: ${error.message}`,
        timestamp: Date.now(),
      });
    }

    this.steps++;
  }

  /**
   * Run planning phase - creates a systematic plan for the task
   * Enhanced with LLM-based task decomposition
   * @public - Exposed for LangGraph integration
   */
  public async runPlanningPhase(userMessage: string) {
    if (!this.enforcePlanActVerify) {
      this.steps++;
      return this.currentPlan;
    }

    const filesList = Object.keys(this.vfs);
    if (filesList.length === 0) {
      this.currentPlan = { task: userMessage, files: [], execution_order: [] };
      this.steps++;
      return this.currentPlan;
    }

    // Use LLM for task decomposition if enabled
    if (this.enableTaskDecomposition) {
      await this.decomposeIntoTasks(userMessage);
    }

    const planningPrompt = `Create a systematic engineering plan for this task:

TASK: ${userMessage}

AVAILABLE FILES IN CONTEXT:
${filesList.join('\n')}

${this.taskGraph ? `
DECOMPOSED TASKS:
${JSON.stringify(this.taskGraph.tasks, null, 2)}
` : ''}

Return a JSON object:
{
  "task": "Refined task description",
  "files": [{"path": "file.ts", "action": "edit", "reason": "why"}],
  "execution_order": ["file.ts"],
  "rollback_plan": "how to undo"
}`;

    try {
      const { generateText } = await import('ai');
      const result = await generateText({
        model: this.getModel(),
        prompt: planningPrompt,
        maxTokens: 1000,
      });

      try {
        const text = result.text.trim().replace(/^```json\n?|\n?```$/g, '');
        this.currentPlan = JSON.parse(text);
      } catch {
        this.currentPlan = { task: userMessage, files: [], execution_order: [] };
      }
    } catch (error) {
      console.error('[StatefulAgent] Planning error:', error);
      this.currentPlan = { task: userMessage, files: [], execution_order: [] };
    }

    this.steps++;
    return this.currentPlan;
  }

  /**
   * Decompose user request into structured task graph using LLM
   */
  private async decomposeIntoTasks(userMessage: string): Promise<void> {
    const decompositionPrompt = `Break down this request into independent, executable tasks:

REQUEST: ${userMessage}

CONTEXT FILES: ${Object.keys(this.vfs).join(', ')}

Return tasks that can be executed in parallel where possible. Each task should be:
- Atomic and independently executable
- Clear about what it accomplishes
- Dependent only on completed tasks

Respond with valid JSON matching this schema:
{
  "tasks": [
    {
      "id": "task_id",
      "description": "What this task does",
      "dependencies": ["other_task_id"]
    }
  ]
}`;

    try {
      const result = await generateObject({
        model: this.getModel(),
        prompt: decompositionPrompt,
        schema: TaskGraphSchema,
        maxTokens: 1500,
      });

      this.taskGraph = {
        id: `taskgraph-${Date.now()}`,
        tasks: result.object.tasks.map(t => ({
          ...t,
          status: 'pending' as const,
        })),
        status: 'pending' as const,
      };

      console.log('[StatefulAgent] Task decomposition complete:', this.taskGraph.tasks.length, 'tasks');
    } catch (error: any) {
      console.warn('[StatefulAgent] Task decomposition failed, using simple plan:', error.message);
      // Fallback to single task
      this.taskGraph = {
        id: `taskgraph-${Date.now()}`,
        tasks: [{
          id: 'main_task',
          description: userMessage,
          dependencies: [],
          status: 'pending',
        }],
        status: 'pending',
      };
    }
  }

  /**
   * Run editing phase - executes changes to files
   * Enhanced with Tool Memory Graph auto-write
   * @public - Exposed for LangGraph integration
   */
  public async runEditingPhase(userMessage: string) {
    const editPrompt = `You are an automated editor. Execute these changes surgically.

TASK: ${this.currentPlan?.task || userMessage}

FILES TO MODIFY:
${JSON.stringify(this.currentPlan?.files || [], null, 2)}

CURRENT FILE CONTENTS (VFS):
${JSON.stringify(this.vfs, null, 2)}

For each modification, output a tool call to 'applyDiff' with exact search/replace blocks.
Use 'createFile' for new files.`;

    try {
      const { generateText } = await import('ai');
      const { allTools } = await import('../tools/sandbox-tools');

      const result = await generateText({
        model: this.getModel(),
        prompt: editPrompt,
        tools: {
          applyDiff: allTools.applyDiff,
          createFile: allTools.createFile,
          execShell: allTools.execShell,
        },
        maxSteps: 10,
        onStepFinish: async ({ toolCalls, toolResults }) => {
          // Execute tool calls via ToolExecutor
          for (const call of toolCalls) {
            try {
              const execResult = await this.toolExecutor.execute(call.toolName, call.args);
              // Update local state based on result
              if (execResult.success && execResult.content && call.args.path) {
                this.vfs[call.args.path] = execResult.content;
                
                // Auto-write to Tool Memory Graph
                await this.addMemoryNode('file', execResult.content, call.args.path);
                
                // Update execution graph if tracking
                if (this.executionGraphId) {
                  const graph = executionGraphEngine.getGraph(this.executionGraphId);
                  if (graph) {
                    const readyNodes = executionGraphEngine.getReadyNodes(graph);
                    if (readyNodes.length > 0) {
                      executionGraphEngine.markComplete(graph, readyNodes[0].id, {
                        file: call.args.path,
                        success: true,
                      });
                    }
                  }
                }
              }
            } catch (err: any) {
              this.errors.push({
                step: this.steps,
                path: call.args.path,
                message: err.message,
                timestamp: Date.now(),
              });
            }
          }
        }
      });

      this.status = 'verifying';
    } catch (error: any) {
      this.errors.push({
        step: this.steps,
        message: error.message || 'Editing failed',
        timestamp: Date.now(),
      });
    }

    this.steps++;
    return this.getState();
  }

  /**
   * Run verification phase - validates changes
   * @public - Exposed for LangGraph integration
   */
  public async runVerificationPhase() {
    const modifiedFiles = Object.keys(this.vfs);
    if (modifiedFiles.length === 0) return;

    try {
      const result = await this.toolExecutor.execute('syntaxCheck', { paths: modifiedFiles });
      if (!result.success) {
        this.errors.push({
          step: this.steps,
          message: `Syntax check failed: ${result.output}`,
          timestamp: Date.now(),
        });
        
        // Attempt self-healing if under limit
        if (this.retryCount < this.maxSelfHealAttempts) {
          this.retryCount++;
          console.log(`[StatefulAgent] Attempting self-heal ${this.retryCount}/${this.maxSelfHealAttempts}`);
          await this.runEditingPhase(`Fix the following syntax errors:\n${result.output}`);
        }
      }
    } catch (err: any) {
      console.error('[StatefulAgent] Verification failed:', err);
    }
    
    this.steps++;
  }

  /**
   * Run self-healing phase - attempts to fix errors
   * @public - Exposed for LangGraph integration
   */
  public async runSelfHealingPhase(errors: any[]) {
    if (errors.length === 0) {
      return this.getState();
    }

    const errorMessages = errors.map(e => e.message).join('\n');
    
    try {
      await this.runEditingPhase(`Fix the following errors:\n${errorMessages}`);
    } catch (err: any) {
      console.error('[StatefulAgent] Self-healing failed:', err);
      this.errors.push({
        step: this.steps,
        message: `Self-healing failed: ${err.message}`,
        timestamp: Date.now(),
      });
    }

    this.steps++;
    return this.getState();
  }

  getState() {
    return {
      sessionId: this.sessionId,
      vfs: this.vfs,
      transactionLog: this.transactionLog,
      currentPlan: this.currentPlan,
      errors: this.errors,
      retryCount: this.retryCount,
      status: this.status,
      metrics: this.toolExecutor.getMetrics(),
    };
  }
}

export async function createStatefulAgent(options?: StatefulAgentOptions): Promise<StatefulAgent> {
  return new StatefulAgent(options);
}

export async function runStatefulAgent(
  userMessage: string,
  options?: StatefulAgentOptions
): Promise<StatefulAgentResult> {
  const agent = new StatefulAgent(options);
  return agent.run(userMessage);
}
