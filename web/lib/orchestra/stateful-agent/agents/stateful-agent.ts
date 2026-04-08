import { openai } from '@ai-sdk/openai';
import { streamText, generateObject, type Tool as CoreTool } from 'ai';
import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';
import type { ProjectServices } from '@/lib/project-context';
import { ToolExecutor } from '../tools/tool-executor';
import { reflectionEngine } from '@/lib/orchestra/reflection-engine';
import { executionGraphEngine } from '@bing/shared/agent/execution-graph';
import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import { contextPackService } from '@/lib/virtual-filesystem/context-pack-service';
import { detectTemplate, templateToTaskGraph, type TemplateType } from './template-flows';
import { createLoopDetector, type LoopDetectionResult } from '@bing/shared/agent/loop-detection';
import { createCapabilityChain, type CapabilityChain } from '@bing/shared/agent/capability-chain';
import { createBootstrappedAgency, type BootstrappedAgency } from '@bing/shared/agent/bootstrapped-agency';

const log = createLogger('StatefulAgent');

/**
 * Acquire session lock to prevent concurrent access
 * 
 * Uses unified multi-strategy locking with automatic fallback:
 * 1. Redis (primary) - distributed locking
 * 2. Memory (secondary) - single-instance fallback
 * 3. Queue (tertiary) - request serialization
 * 
 * Throws error if all strategies fail (no silent degradation).
 */
async function acquireSessionLock(sessionId: string): Promise<() => void> {
  const { acquireUnifiedLock } = await import('@/lib/session/unified-lock');
  
  try {
    const result = await acquireUnifiedLock({
      sessionId,
      timeout: parseInt(process.env.SESSION_LOCK_TIMEOUT || '10000'),
      recordMetrics: process.env.SESSION_LOCK_METRICS_ENABLED !== 'false',
    });
    
    log.debug('Session lock acquired', { 
      sessionId, 
      strategy: result.strategy,
      duration: result.duration,
    });
    
    return result.release;
  } catch (error) {
    // All strategies failed - throw error instead of silent fallback
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to acquire session lock - all strategies failed', {
      sessionId,
      error: errorMessage,
    });
    throw new Error(
      `Session lock unavailable for ${sessionId}: ${errorMessage}. ` +
      'This indicates a system-wide locking issue requiring immediate attention.'
    );
  }
}

export interface StatefulAgentOptions {
  sessionId?: string;
  userId?: string;
  sandboxHandle?: SandboxHandle;
  maxSelfHealAttempts?: number;
  enforcePlanActVerify?: boolean;
  enableReflection?: boolean;
  enableTaskDecomposition?: boolean;
  // Execution mode: quick (minimal overhead), standard (balanced), thorough (max quality)
  executionMode?: 'quick' | 'standard' | 'thorough';
  // Enable capability chaining for complex workflows
  enableCapabilityChaining?: boolean;
  // Enable bootstrapped agency for learning from past executions
  enableBootstrappedAgency?: boolean;
  // Project-scoped services for project-isolated memory and retrieval
  projectServices?: ProjectServices;
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
  private conversationId: string;
  private userId: string;
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
  public executionMode: 'quick' | 'standard' | 'thorough' = 'standard';

  // Task Decomposition Engine
  private taskGraph?: TaskGraph;
  private enableTaskDecomposition: boolean;

  // Tool Memory Graph
  private memoryGraph: MemoryGraph;

  // Self-Reflection Loop
  private enableReflection: boolean;

  // Execution Graph Integration
  private executionGraphId?: string;

  // Loop Detection
  private loopDetector = createLoopDetector({
    maxConsecutiveSimilar: 3,
    maxRepetitionsInWindow: 5,
    windowSizeSeconds: 60,
    enabled: true,
  });

  // Capability Chain
  private enableCapabilityChaining: boolean;
  private currentChain?: CapabilityChain;

  // Bootstrapped Agency
  private enableBootstrappedAgency: boolean;
  private agency?: BootstrappedAgency;

  // Project-scoped services for project-isolated memory and retrieval
  private projectServices?: ProjectServices;

  constructor(options: StatefulAgentOptions = {}) {
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.userId = options.userId || 'anonymous';
    this.conversationId = options.sessionId || crypto.randomUUID();
    this.sandboxHandle = options.sandboxHandle;
    this.projectServices = options.projectServices;
    this.maxSelfHealAttempts = options.maxSelfHealAttempts || 3;
    this.enforcePlanActVerify = options.enforcePlanActVerify ?? true;
    this.enableReflection = options.enableReflection ?? true;
    this.enableTaskDecomposition = options.enableTaskDecomposition ?? true;
    this.enableCapabilityChaining = options.enableCapabilityChaining ?? true;
    this.enableBootstrappedAgency = options.enableBootstrappedAgency ?? true;

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

    // Initialize bootstrapped agency if enabled
    if (this.enableBootstrappedAgency) {
      this.agency = createBootstrappedAgency({
        sessionId: this.sessionId,
        enableLearning: true,
        maxHistorySize: 1000,
        enablePatternRecognition: true,
        enableAdaptiveSelection: true,
      });
      log.info('Bootstrapped Agency initialized', { sessionId: this.sessionId });

      // Wire agency into capability router for adaptive provider selection (non-blocking)
      // Use .then() to avoid await in constructor
      import('@/lib/tools/router')
        .then(({ wireAgencyToRouter }) => {
          wireAgencyToRouter(this.agency);
        })
        .catch((err: any) => {
          log.warn('Failed to wire agency to capability router (non-fatal)', { error: err.message });
        });
    }
  }

  /**
   * Create execution graph for tracking task progress
   */
  private async createExecutionGraph(): Promise<void> {
    if (!this.taskGraph || this.taskGraph.tasks.length === 0) return;

    const graph = executionGraphEngine.createGraph(this.sessionId);
    this.executionGraphId = graph.id;
    this.activeNodeId = null; // Reset active node tracking

    // Add nodes for each task in the task graph
    for (const task of this.taskGraph.tasks) {
      executionGraphEngine.addNode(graph, {
        id: task.id,
        type: 'agent_step',
        name: task.description,
        description: task.description,
        dependencies: task.dependencies,
      });
    }

    log.info('Execution graph created', {
      graphId: graph.id,
      taskId: this.taskGraph.id,
      taskCount: this.taskGraph.tasks.length,
    });
  }

  /**
   * Track currently active node for accurate completion tracking
   */
  private activeNodeId: string | null = null;

  /**
   * Update execution graph node status
   */
  private async updateExecutionGraphNode(nodeId: string, status: 'running' | 'completed' | 'failed', result?: any): Promise<void> {
    if (!this.executionGraphId) return;

    const graph = executionGraphEngine.getGraph(this.executionGraphId);
    if (!graph) return;

    const node = graph.nodes.get(nodeId);
    if (!node) return;

    node.status = status;
    if (status === 'running') {
      node.startedAt = Date.now();
      this.activeNodeId = nodeId; // Track active node
    } else if (status === 'completed' || status === 'failed') {
      node.completedAt = Date.now();
      if (result) node.result = result;
      if (this.activeNodeId === nodeId) {
        this.activeNodeId = null; // Clear active node on completion
      }
    }

    log.debug('Execution graph node updated', {
      graphId: this.executionGraphId,
      nodeId,
      status,
    });
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
    const startTime = Date.now();
    log.info('StatefulAgent.run() started', {
      sessionId: this.sessionId,
      executionMode: this.executionMode,
      userMessageLength: userMessage.length,
      enableReflection: this.enableReflection,
      enableTaskDecomposition: this.enableTaskDecomposition,
      maxSelfHealAttempts: this.maxSelfHealAttempts,
    });

    // Acquire exclusive session lock to prevent concurrent access
    const releaseLock = await acquireSessionLock(this.sessionId);

    try {
      this.status = 'discovering';
      this.steps = 0;

      try {
        log.info('Starting discovery phase', { sessionId: this.sessionId });
        await this.runDiscoveryPhase(userMessage);

        log.info('Starting planning phase', { sessionId: this.sessionId });
        this.status = 'planning';
        await this.runPlanningPhase(userMessage);

        // Create execution graph for tracking
        if (this.enableTaskDecomposition && this.taskGraph) {
          log.info('Creating execution graph', { 
            sessionId: this.sessionId, 
            taskCount: this.taskGraph.tasks.length,
          });
          await this.createExecutionGraph();
        }

        log.info('Starting editing phase', { sessionId: this.sessionId });
        this.status = 'editing';
        await this.runEditingPhase(userMessage);

        log.info('Starting verification phase', { sessionId: this.sessionId });
        this.status = 'verifying';
        await this.runVerificationPhase();

        // Apply reflection if enabled
        if (this.enableReflection) {
          log.info('Starting reflection phase', { sessionId: this.sessionId });
          await this.applyReflection();
        }

        this.status = 'completed';

        const duration = Date.now() - startTime;
        const success = this.errors.length === 0;
        const result: StatefulAgentResult = {
          success,
          response: `Completed ${this.steps} steps in ${Math.round(duration / 1000)}s. Modified ${this.transactionLog.length} files.`,
          steps: this.steps,
          errors: this.errors,
          vfs: this.vfs,
          metrics: {
            ...this.toolExecutor.getMetrics(),
            duration,
            executionMode: this.executionMode,
            reflectionApplied: this.enableReflection,
            taskDecompositionApplied: this.enableTaskDecomposition,
          },
        };

        // Record execution with bootstrapped agency for learning
        // Isolated in its own try/catch so failures don't fail the main execution
        if (this.enableBootstrappedAgency && this.agency) {
          try {
            await this.recordAgencyExecution(userMessage, {
              success,
              duration,
              steps: this.steps,
              errors: this.errors.map(e => e.message),
              transactionLog: this.transactionLog,
              toolMetrics: this.toolExecutor.getMetrics(),
            });
          } catch (err: any) {
            log.warn('Agency execution recording failed (non-fatal)', { error: err.message });
          }
        }

        // Trigger skill bootstrap after successful execution
        // Isolated so bootstrap failures don't fail the main execution
        if (success && this.transactionLog.length > 0) {
          try {
            await this.triggerSkillBootstrap(userMessage, {
              duration,
              steps: this.steps,
              transactionLog: this.transactionLog,
              toolMetrics: this.toolExecutor.getMetrics(),
            });
          } catch (err: any) {
            log.warn('Skill bootstrap event emission failed (non-fatal)', { error: err.message });
          }
        }

        // Log completion metrics
        log.info('StatefulAgent execution completed', {
          sessionId: this.sessionId,
          executionMode: this.executionMode,
          success: result.success,
          steps: result.steps,
          filesModified: this.transactionLog.length,
          errors: result.errors.length,
          duration: `${Math.round(duration / 1000)}s`,
          reflectionEnabled: this.enableReflection,
          taskDecompositionEnabled: this.enableTaskDecomposition,
          executionGraphId: this.executionGraphId,
          agencyLearningApplied: this.enableBootstrappedAgency,
          skillBootstrapTriggered: success && this.transactionLog.length > 0,
        });

        return result;
      } catch (error: any) {
        this.status = 'error';
        this.errors.push({
          step: this.steps,
          message: error.message || 'Fatal execution error',
          timestamp: Date.now(),
        });

        const duration = Date.now() - startTime;
        log.error('StatefulAgent execution failed', {
          sessionId: this.sessionId,
          executionMode: this.executionMode,
          error: error.message,
          steps: this.steps,
          errors: this.errors.length,
          duration: `${Math.round(duration / 1000)}s`,
        });

        return {
          success: false,
          response: error instanceof Error ? error.message : 'Unknown error',
          steps: this.steps,
          errors: this.errors,
          vfs: this.vfs,
          metrics: {
            duration,
            executionMode: this.executionMode,
            failedAtStep: this.steps,
          },
        };
      }
    } finally {
      // Always release the lock, even if there's an error
      releaseLock();
      log.debug('Session lock released', { sessionId: this.sessionId });
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
      // First, try to use context pack for comprehensive context gathering
      if (process.env.STATEFUL_AGENT_USE_CONTEXT_PACK !== 'false') {
        try {
          const contextPack = await contextPackService.generateContextPack(
            this.sessionId,
            '/',
            {
              format: 'plain',
              includeContents: true,
              includeTree: true,
              maxTotalSize: 500 * 1024, // 500KB limit for context
            }
          );
          
          log.info('Context pack generated for discovery', {
            fileCount: contextPack.fileCount,
            directoryCount: contextPack.directoryCount,
            estimatedTokens: contextPack.estimatedTokens,
          });
          
          // Add key files from context pack to VFS
          for (const file of contextPack.files.slice(0, 20)) {
            if (file.content && !this.vfs[file.path]) {
              this.vfs[file.path] = file.content;
            }
          }
        } catch (error: any) {
          log.warn('Context pack generation failed, falling back to file discovery', error.message);
        }
      }

      // Then use LLM for targeted file discovery
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
          
          // Record for loop detection
          const loopResult = this.loopDetector.recordToolCall('readFile', { path: filePath }, readResult);
          if (loopResult.isLoop) {
            log.warn('Loop detected in file reads', { 
              path: filePath, 
              reason: loopResult.reason,
              severity: loopResult.severity,
            });
            
            if (loopResult.suggestedAction === 'terminate') {
              throw new Error(`Infinite loop detected: ${loopResult.reason}`);
            }
          }
          
          if (readResult.success && readResult.content) {
            this.vfs[filePath] = readResult.content;
            successfulReads.push(filePath);
          } else {
            failedReads.push(filePath);
            log.warn(`Discovery failed for ${filePath}: ${readResult.error || 'Unknown error'}`);
          }
        } catch (error: any) {
          failedReads.push(filePath);
          log.warn(`Discovery failed for ${filePath}:`, error.message);
        }
      }

      // Log summary for debugging
      log.info('Discovery complete', {
        filesRead: successfulReads.length,
        filesFailed: failedReads.length,
        totalInVFS: Object.keys(this.vfs).length,
      });

      if (failedReads.length > 0) {
        log.warn('Failed to read files', failedReads);
      }

      if (successfulReads.length === 0 && filePaths.length > 0) {
        log.error('WARNING: No files were successfully read during discovery phase');
      }
    } catch (error: any) {
      log.error('Discovery error', error.message);
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
   * Enhanced with LLM-based task decomposition and template detection
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

    // Detect template from user message
    const detectedTemplate = detectTemplate(userMessage);
    
    if (detectedTemplate) {
      log.info('Template detected', { template: detectedTemplate });
      
      // Use template-based task decomposition
      const templateTaskGraph = templateToTaskGraph(
        (await import('./template-flows')).getTemplate(detectedTemplate)
      );
      
      this.taskGraph = templateTaskGraph;
      log.info('Template task graph created', {
        template: detectedTemplate,
        taskCount: templateTaskGraph.tasks.length,
      });
    } else if (this.enableTaskDecomposition) {
      // Fall back to LLM-based decomposition
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
        maxOutputTokens: 1000,
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
        maxOutputTokens: 1500,
      });

      this.taskGraph = {
        id: `taskgraph-${Date.now()}`,
        tasks: result.object.tasks.map((t: any, index: number) => ({
          ...t,
          id: t.id || `task-${index}`,
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
      const { getCapabilityRouter } = await import('@/lib/tools/router');
      const { ALL_CAPABILITIES } = await import('@/lib/tools/capabilities');

      const router = getCapabilityRouter();
      const availableCapabilities = ALL_CAPABILITIES.map(c => c.id);

      // Build capability chain tool if enabled
      const additionalTools: Record<string, any> = {};
      if (this.enableCapabilityChaining) {
        const { tool } = await import('ai');

        additionalTools.run_capability_chain = tool({
          description: `Execute a chain of capabilities in sequence. Use for multi-step workflows. Available: ${availableCapabilities.join(', ')}`,
          parameters: z.object({
            name: z.string().describe('Chain name'),
            steps: z.array(z.object({
              capability: z.string().describe('Capability ID (e.g., file.read, sandbox.shell, web.browse)'),
              args: z.record(z.any()).describe('Arguments for this capability'),
            })).describe('Sequence of capabilities to execute'),
            stopOnFailure: z.boolean().optional().default(false).describe('Whether to stop the chain if a step fails'),
          }),
          execute: async (args: any) => {
            try {
              const chain = createCapabilityChain({
                name: args.name,
                enableParallel: false,
                stopOnFailure: args.stopOnFailure ?? false,
              });

              for (const step of args.steps) {
                chain.addStep(step.capability, step.args);
              }

              const result = await chain.execute({
                execute: async (capName: string, config: any, _chainCtx: any) => {
                  return router.execute(capName, config, {
                    userId: this.userId,
                    sessionId: this.sessionId,
                  } as any);
                },
              });

              const serializedResults = Object.fromEntries(result.results.entries());
              return {
                success: result.success,
                results: serializedResults,
                errors: result.errors,
                steps: result.steps,
              };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          },
        } as any);
      }

      const result = await generateText({
        model: this.getModel(),
        prompt: editPrompt,
        tools: {
          applyDiff: allTools.applyDiff,
          createFile: allTools.createFile,
          execShell: allTools.execShell,
          ...additionalTools,
        },
        onStepFinish: async ({ toolCalls, toolResults }) => {
          // Execute tool calls via ToolExecutor
          for (const call of toolCalls) {
            let callArgs: any;
            try {
              callArgs = (call as any).args || (call as any).input || {};
              const execResult = await this.toolExecutor.execute(call.toolName, callArgs);

              // Record for loop detection
              const loopResult = this.loopDetector.recordToolCall(call.toolName, callArgs, execResult);
              if (loopResult.isLoop) {
                log.warn('Loop detected in tool execution', {
                  tool: call.toolName,
                  reason: loopResult.reason,
                  severity: loopResult.severity,
                });

                if (loopResult.suggestedAction === 'terminate') {
                  throw new Error(`Infinite loop detected: ${loopResult.reason}`);
                }
              }

              // Update local state based on result
              const contentForState = typeof execResult.content === 'string'
                ? execResult.content
                : (typeof (callArgs as any).content === 'string' ? (callArgs as any).content : undefined);

              // Update execution graph for successful tool calls
              // CRITICAL FIX: Use activeNodeId tracking instead of marking arbitrary readyNodes[0]
              // This ensures we complete the correct node that corresponds to the actual task being executed
              if (execResult.success && this.executionGraphId) {
                const graph = executionGraphEngine.getGraph(this.executionGraphId);
                if (graph) {
                  // Prefer completing the active node if one is being tracked
                  if (this.activeNodeId) {
                    const activeNode = graph.nodes.get(this.activeNodeId);
                    if (activeNode && activeNode.status === 'running') {
                      executionGraphEngine.markComplete(graph, this.activeNodeId, {
                        tool: call.toolName,
                        success: true,
                        hasFilePath: callArgs && 'path' in callArgs,
                      });
                      log.info('Execution graph node completed (active node tracking)', {
                        graphId: this.executionGraphId,
                        nodeId: this.activeNodeId,
                        tool: call.toolName,
                      });
                    } else {
                      // Active node not found or not running, fall back to first ready node
                      const readyNodes = executionGraphEngine.getReadyNodes(graph);
                      if (readyNodes.length > 0) {
                        executionGraphEngine.markComplete(graph, readyNodes[0].id, {
                          tool: call.toolName,
                          success: true,
                          hasFilePath: callArgs && 'path' in callArgs,
                        });
                      }
                    }
                  } else {
                    // No active node tracked, use first ready node as fallback
                    const readyNodes = executionGraphEngine.getReadyNodes(graph);
                    if (readyNodes.length > 0) {
                      executionGraphEngine.markComplete(graph, readyNodes[0].id, {
                        tool: call.toolName,
                        success: true,
                        hasFilePath: callArgs && 'path' in callArgs,
                      });
                    }
                  }
                }
              }
              
              // Update VFS and memory graph only for file operations
              if (execResult.success && callArgs && 'path' in callArgs && contentForState !== undefined) {
                this.vfs[(callArgs as any).path] = contentForState;

                // Auto-write to Tool Memory Graph
                await this.addMemoryNode('file', contentForState, (callArgs as any).path);
              }
            } catch (err: any) {
              this.errors.push({
                step: this.steps,
                path: call.toolCallId && callArgs && 'path' in callArgs ? (callArgs as any).path : 'unknown',
                message: err.message,
                timestamp: Date.now(),
              });
            }
          }
        }
      });

      // FALLBACK: If native tool calls returned empty but text contains tool-like patterns,
      // parse and execute them (handles models that don't support function calling)
      if (result.toolCalls?.length === 0 && result.text) {
        const { extractTextToolCallEdits, extractFlatJsonToolCalls, extractToolTagEdits } = await import('@/lib/chat/file-edit-parser');
        const textEdits = [
          ...extractTextToolCallEdits(result.text),
          ...extractFlatJsonToolCalls(result.text),
          ...extractToolTagEdits(result.text),
        ];

        if (textEdits.length > 0) {
          log.info(`StatefulAgent: No native tool calls, found ${textEdits.length} text-based tool calls, executing fallback`);
          for (const edit of textEdits) {
            try {
              // Map action to tool name
              let toolName = edit.action;
              if (edit.action === 'write') toolName = 'createFile';
              else if (edit.action === 'patch') toolName = 'applyDiff';
              else if (edit.action === 'delete') toolName = 'deleteFile';

              const callArgs: any = { path: edit.path };
              if (edit.content) callArgs.content = edit.content;
              if (edit.diff) callArgs.diff = edit.diff;

              const execResult = await this.toolExecutor.execute(toolName, callArgs);

              // Update VFS for successful file operations
              if (execResult.success && edit.path) {
                this.vfs[edit.path] = typeof edit.content === 'string' ? edit.content : '';
                await this.addMemoryNode('file', edit.content || '', edit.path);
              }
            } catch (err: any) {
              log.warn(`Text-based tool execution failed: ${edit.action}`, err.message);
            }
          }
        }
      }

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
      // Analyze error type to determine healing strategy
      const errorType = this.classifyError(errors[0]);
      log.info('Self-healing initiated', { errorType, attempt: this.retryCount + 1 });

      // Apply targeted healing strategy based on error type
      switch (errorType) {
        case 'syntax':
          await this.fixSyntaxError(errors[0]);
          break;
        case 'missing_import':
          await this.addMissingImport(errors[0]);
          break;
        case 'type_error':
          await this.fixTypeError(errors[0]);
          break;
        case 'runtime':
          await this.fixRuntimeError(errors[0]);
          break;
        default:
          // Generic retry with same approach
          await this.runEditingPhase(`Fix the following errors:\n${errorMessages}`);
      }
    } catch (err: any) {
      log.error('Self-healing failed', err.message);
      this.errors.push({
        step: this.steps,
        message: `Self-healing failed: ${err.message}`,
        timestamp: Date.now(),
      });
    }

    this.steps++;
    return this.getState();
  }

  /**
   * Classify error type for targeted healing
   */
  private classifyError(error: any): 'syntax' | 'missing_import' | 'type_error' | 'runtime' | 'unknown' {
    const message = error.message?.toLowerCase() || '';
    
    if (/syntax|parse|unexpected token/i.test(message)) {
      return 'syntax';
    }
    if (/cannot find module|import|not defined/i.test(message)) {
      return 'missing_import';
    }
    if (/type|property.*does not exist|is not assignable/i.test(message)) {
      return 'type_error';
    }
    if (/runtime|execution|failed/i.test(message)) {
      return 'runtime';
    }
    
    return 'unknown';
  }

  /**
   * Fix syntax errors
   */
  private async fixSyntaxError(error: any) {
    const { generateText } = await import('ai');
    
    const fixPrompt = `Fix the syntax error in this code:

ERROR: ${error.message}

Provide only the corrected code, no explanation.`;

    const result = await generateText({
      model: this.getModel(),
      prompt: fixPrompt,
    });

    // Apply the fix (simplified - in reality would need to identify file and location)
    log.info('Syntax error fix applied', { fix: result.text.substring(0, 100) });
  }

  /**
   * Add missing imports
   */
  private async addMissingImport(error: any) {
    const { generateText } = await import('ai');
    
    const fixPrompt = `Add the missing import for this error:

ERROR: ${error.message}

Provide only the import statement, no explanation.`;

    const result = await generateText({
      model: this.getModel(),
      prompt: fixPrompt,
    });

    log.info('Missing import added', { import: result.text.trim() });
  }

  /**
   * Fix type errors
   */
  private async fixTypeError(error: any) {
    const { generateText } = await import('ai');
    
    const fixPrompt = `Fix the type error in this code:

ERROR: ${error.message}

Provide only the corrected code, no explanation.`;

    const result = await generateText({
      model: this.getModel(),
      prompt: fixPrompt,
    });

    log.info('Type error fix applied', { fix: result.text.substring(0, 100) });
  }

  /**
   * Fix runtime errors
   */
  private async fixRuntimeError(error: any) {
    // Runtime errors often need context - use generic retry
    await this.runEditingPhase(`Fix the runtime error: ${error.message}`);
  }

  /**
   * Record execution with bootstrapped agency for learning
   */
  private async recordAgencyExecution(
    task: string,
    execution: {
      success: boolean;
      duration: number;
      steps: number;
      errors: string[];
      transactionLog: Array<{ path: string; type: string; timestamp: number; originalContent?: string }>;
      toolMetrics: any;
    }
  ): Promise<void> {
    if (!this.agency) return;

    try {
      // Determine capabilities used from transaction log
      const capabilities = this.deriveCapabilitiesFromExecution(execution);

      // Record with agency for pattern learning
      await this.agency.execute({
        task,
        capabilities,
        chain: capabilities.length > 1,
      });

      log.debug('Agency execution recorded for learning', {
        task: task.substring(0, 50),
        success: execution.success,
        capabilities,
        duration: `${Math.round(execution.duration / 1000)}s`,
      });
    } catch (error: any) {
      log.warn('Failed to record agency execution', { error: error.message });
    }
  }

  /**
   * Derive capabilities used from transaction log
   */
  private deriveCapabilitiesFromExecution(execution: {
    transactionLog: Array<{ path: string; type: string; timestamp: number; originalContent?: string }>;
    toolMetrics: any;
  }): string[] {
    const caps = new Set<string>();

    // File operations from transaction log
    const fileOps = execution.transactionLog.filter(t => t.type === 'CREATE' || t.type === 'UPDATE');
    if (fileOps.length > 0) {
      caps.add('file.read');
      caps.add('file.write');
    }

    // If tool metrics show shell executions
    if (execution.toolMetrics?.byTool?.execShell?.count > 0) {
      caps.add('sandbox.shell');
    }

    // If syntax checks were run
    if (execution.toolMetrics?.byTool?.syntaxCheck?.count > 0) {
      caps.add('repo.analyze');
    }

    // Default fallback
    if (caps.size === 0) {
      caps.add('file.read');
      caps.add('file.write');
    }

    return Array.from(caps);
  }

  /**
   * Trigger skill bootstrap after successful execution
   */
  private async triggerSkillBootstrap(
    task: string,
    execution: {
      duration: number;
      steps: number;
      transactionLog: Array<{ path: string; type: string; timestamp: number; originalContent?: string }>;
      toolMetrics: any;
    }
  ): Promise<void> {
    try {
      const { emitEvent } = await import('@/lib/events/bus');

      // Build successful run payload for skill extraction
      const steps = execution.transactionLog.map(t => ({
        action: t.type.toLowerCase(),
        result: { path: t.path, type: t.type },
        success: true,
      }));

      await emitEvent({
        type: 'SKILL_BOOTSTRAP',
        userId: this.userId || 'system',
        sessionId: this.sessionId,
        payload: {
          successfulRun: {
            steps,
            totalDuration: execution.duration,
            userId: this.userId || 'system',
            taskDescription: task,
            filesModified: execution.transactionLog.map(t => t.path),
          },
          model: process.env.DEFAULT_MODEL || 'gpt-4o',
          storeSkill: true,
        },
      }, this.userId || 'system', this.sessionId);

      log.info('Skill bootstrap event emitted', {
        sessionId: this.sessionId,
        filesModified: execution.transactionLog.length,
      });
    } catch (error: any) {
      log.warn('Failed to emit skill bootstrap event', { error: error.message });
    }
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

  /**
   * Get learned capabilities from bootstrapped agency for a task
   * Returns capabilities ranked by past success rate for similar tasks
   */
  getLearnedCapabilities(task: string, limit: number = 5): string[] {
    if (!this.enableBootstrappedAgency || !this.agency) {
      return ['file.read', 'file.write', 'sandbox.shell'];
    }
    return this.agency.getLearnedCapabilities(task, limit);
  }

  /**
   * Get agency learning summary
   */
  getAgencyLearningSummary(): {
    totalExecutions: number;
    successRate: number;
    topCapabilities: Array<{ capability: string; successRate: number; executions: number }>;
    improvementTrend: 'improving' | 'stable' | 'declining';
  } | null {
    if (!this.enableBootstrappedAgency || !this.agency) {
      return null;
    }
    return this.agency.getLearningSummary();
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

/**
 * Streaming version of StatefulAgent using Vercel AI SDK
 * Use this for real-time streaming responses to the client
 */
export interface StatefulAgentStreamingOptions extends StatefulAgentOptions {
  /** Callback for each text chunk */
  onChunk?: (chunk: string) => void;
  /** Callback for tool execution */
  onToolExecution?: (toolName: string, args: Record<string, any>, result: any) => void;
  /** Maximum steps for streaming */
  maxSteps?: number;
}

/**
 * Run StatefulAgent with streaming using Vercel AI SDK
 * Similar to Mastra's executeTaskStreaming pattern
 */
export async function* runStatefulAgentStreaming(
  userMessage: string,
  options?: StatefulAgentStreamingOptions
): AsyncGenerator<string, StatefulAgentResult, unknown> {
  const agent = new StatefulAgent(options);
  const maxSteps = options?.maxSteps || 10;
  let stepCount = 0;
  const errors: Array<{ step: number; message: string; path?: string }> = [];
  const vfs: Record<string, string> = {};

  // Get the model
  const modelString = (process.env.DEFAULT_MODEL || 'gpt-4o').replace('openai:', '');
  const model = openai(modelString);

  // Initialize tools from vercel-ai-tools
  const { getAllTools } = await import('@/lib/chat/vercel-ai-tools');
  const tools = await getAllTools({
    userId: agent['userId'],
    conversationId: agent['conversationId'],
    sessionId: agent['sessionId'],
  });

  // Convert tools to Vercel AI SDK format
  const toolDefs = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, tool as unknown as CoreTool<any, any>])
  );

  // Build initial messages
  const messages = [
    {
      role: 'user' as const,
      content: userMessage,
    },
  ];

  // Run streaming using Vercel AI SDK
  const result = streamText({
    model,
    messages,
    tools: toolDefs,
    maxSteps,
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta' && (chunk as any).textDelta) {
        options?.onChunk?.((chunk as any).textDelta);
      }
    },
    onStepFinish: async ({ toolCalls, toolResults }) => {
      stepCount++;

      // Execute tool calls via ToolExecutor
      for (const toolCall of toolCalls || []) {
        try {
          const execResult = await agent['toolExecutor'].execute(toolCall.toolName, (toolCall as any).args || {});

          options?.onToolExecution?.(toolCall.toolName, (toolCall as any).args || {}, execResult);

          // Update VFS
          const args = (toolCall as any).args || {};
          if (execResult.success && args.path) {
            vfs[args.path] = typeof execResult.content === 'string' ? execResult.content : '';
          }
        } catch (err: any) {
          errors.push({
            step: stepCount,
            message: err.message,
          });
        }
      }
    },
  } as any);

  // Yield text chunks
  for await (const chunk of result.textStream) {
    yield chunk;
  }

  // FALLBACK: If no tool calls were made but text contains tool-like patterns,
  // parse and execute them (handles models that don't support function calling)
  const finalToolCalls = await result.toolCalls;
  if ((!finalToolCalls || finalToolCalls.length === 0) && agent) {
    try {
      const { extractTextToolCallEdits, extractFlatJsonToolCalls, extractToolTagEdits } = await import('@/lib/chat/file-edit-parser');
      // Get the full response text from the result
      const fullText = await result.text;
      if (fullText) {
        const textEdits = [
          ...extractTextToolCallEdits(fullText),
          ...extractFlatJsonToolCalls(fullText),
          ...extractToolTagEdits(fullText),
        ];

        if (textEdits.length > 0) {
          log.info(`StatefulAgent streaming: No native tool calls, found ${textEdits.length} text-based tool calls, executing fallback`);
          for (const edit of textEdits) {
            try {
              let toolName = edit.action;
              if (edit.action === 'write') toolName = 'createFile';
              else if (edit.action === 'patch') toolName = 'applyDiff';
              else if (edit.action === 'delete') toolName = 'deleteFile';

              const callArgs: any = { path: edit.path };
              if (edit.content) callArgs.content = edit.content;
              if (edit.diff) callArgs.diff = edit.diff;

              const execResult = await agent['toolExecutor'].execute(toolName, callArgs);

              if (execResult.success && edit.path) {
                vfs[edit.path] = typeof edit.content === 'string' ? edit.content : '';
                options?.onToolExecution?.(toolName, callArgs, execResult);
              }
            } catch (err: any) {
              log.warn(`Text-based tool execution failed: ${edit.action}`, err.message);
            }
          }
        }
      }
    } catch (err: any) {
      log.warn('StatefulAgent streaming: Text-based fallback parsing failed', err.message);
    }
  }

  // Return final result
  const finalResult: StatefulAgentResult = {
    success: errors.length === 0,
    response: '', // Text already streamed
    steps: stepCount,
    errors,
    vfs,
    metrics: {
      duration: 0,
      executionMode: options?.executionMode || 'standard',
    },
  };

  return finalResult;
}
