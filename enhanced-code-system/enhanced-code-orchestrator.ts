/**
 * Enhanced Code Orchestrator
 *
 * Main integration system that orchestrates all components for enhanced technical code responses:
 * - Enhanced Prompt Engine with advanced prompting techniques
 * - Agentic Framework Integration (CrewAI, PraisonAI, AG2)
 * - Advanced File Management with diff handling
 * - Enhanced Streaming Manager with context optimization
 * - Unified workflow coordination and state management
 * - Multi-modal response handling and validation
 */

import { EventEmitter } from "events";
import { z } from "zod";
import {
  EnhancedPromptEngine,
  EnhancedResponse,
  ProjectItem,
  PROMPT_TEMPLATES,
} from "./core/enhanced-prompt-engine";
import {
  AgenticFrameworkManager,
  FrameworkConfig,
  BaseAgent,
  QualityMetrics,
} from "./agentic/framework-integration";
import {
  AdvancedFileManager,
  DiffOperation,
  FileState,
  WorkflowStep,
  AutoTriggerRule,
} from "./file-management/advanced-file-manager";
import {
  EnhancedStreamingManager,
  StreamingConfig,
  StreamChunk,
  ProgressUpdate,
  StreamingMetrics,
} from "./streaming/enhanced-streaming-manager";

// Orchestrator configuration schema
const OrchestratorConfigSchema = z.object({
  mode: z
    .enum(["streaming", "agentic", "hybrid", "standard"])
    .default("hybrid"),
  enableStreaming: z.boolean().default(true),
  enableAgenticFrameworks: z.boolean().default(true),
  enableFileManagement: z.boolean().default(true),
  enableAutoWorkflows: z.boolean().default(true),
  maxConcurrentSessions: z.number().min(1).max(10).default(3),
  defaultTimeoutMs: z.number().min(10000).max(600000).default(120000),
  qualityThreshold: z.number().min(0).max(1).default(0.8),
  maxIterations: z.number().min(1).max(10).default(5),
  contextOptimization: z.boolean().default(true),
  errorRecovery: z.boolean().default(true),
  promptEngineering: z
    .object({
      depthLevel: z.number().min(1).max(10).default(8),
      verbosityLevel: z
        .enum(["minimal", "standard", "verbose", "exhaustive"])
        .default("verbose"),
      includeDocumentation: z.boolean().default(true),
      includeTestCases: z.boolean().default(false),
      includeOptimization: z.boolean().default(true),
    })
    .default({}),
  streamingConfig: z
    .object({
      chunkSize: z.number().default(1000),
      maxTokens: z.number().default(32000),
      enablePartialValidation: z.boolean().default(true),
    })
    .optional(),
  agenticConfig: z
    .object({
      defaultFramework: z
        .enum(["crewai", "praisonai", "ag2", "custom"])
        .default("crewai"),
      maxAgents: z.number().min(1).max(10).default(5),
      collaborationMode: z
        .enum(["sequential", "parallel", "hierarchical"])
        .default("sequential"),
    })
    .optional(),
});

const EnhancedRequestSchema = z.object({
  id: z.string(),
  task: z.string().min(10),
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      content: z.string(),
      language: z.string(),
      hasEdits: z.boolean(),
      lastModified: z.date(),
    }),
  ),
  options: z
    .object({
      mode: z.enum(["streaming", "agentic", "hybrid", "standard"]).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      expectedOutputSize: z.number().optional(),
      contextHints: z.array(z.string()).default([]),
      requireApproval: z.boolean().default(true),
      enableDiffs: z.boolean().default(true),
      frameworkPreference: z
        .enum(["crewai", "praisonai", "ag2", "custom"])
        .optional(),
      customAgents: z.array(z.any()).optional(),
      timeoutMs: z.number().optional(),
      qualityThreshold: z.number().min(0).max(1).optional(),
    })
    .default({}),
});

const SessionStateSchema = z.object({
  id: z.string(),
  status: z.enum([
    "initializing",
    "processing",
    "streaming",
    "agentic_processing",
    "file_operations",
    "validating",
    "completed",
    "failed",
    "cancelled",
  ]),
  mode: z.enum(["streaming", "agentic", "hybrid", "standard"]),
  startTime: z.date(),
  lastActivity: z.date(),
  progress: z.number().min(0).max(100),
  currentStep: z.string().optional(),
  totalSteps: z.number().optional(),
  estimatedTimeRemaining: z.number().optional(),
  components: z.object({
    promptEngine: z.boolean(),
    streamingManager: z.boolean(),
    agenticFramework: z.boolean(),
    fileManager: z.boolean(),
  }),
  metrics: z.object({
    tokensUsed: z.number(),
    chunksProcessed: z.number(),
    agentIterations: z.number(),
    filesModified: z.number(),
    diffsApplied: z.number(),
    qualityScore: z.number().optional(),
    errorCount: z.number(),
  }),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
type EnhancedRequest = z.infer<typeof EnhancedRequestSchema>;
type SessionState = z.infer<typeof SessionStateSchema>;

interface OrchestratorSession {
  id: string;
  request: EnhancedRequest;
  state: SessionState;
  config: OrchestratorConfig;
  components: {
    promptEngine: EnhancedPromptEngine;
    streamingManager?: EnhancedStreamingManager;
    agenticManager?: AgenticFrameworkManager;
    fileManager: AdvancedFileManager;
  };
  results: {
    responses: EnhancedResponse[];
    fileStates: Map<string, FileState>;
    appliedDiffs: DiffOperation[];
    streamingMetrics?: StreamingMetrics;
    agenticMetrics?: QualityMetrics;
  };
  workflows: {
    active: WorkflowStep[];
    completed: WorkflowStep[];
    failed: WorkflowStep[];
  };
}

interface OrchestratorMetrics {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  failedSessions: number;
  averageSessionDuration: number;
  averageQualityScore: number;
  successRate: number;
  componentsUsage: {
    streaming: number;
    agentic: number;
    fileManagement: number;
  };
  performanceMetrics: {
    averageResponseTime: number;
    throughput: number;
    errorRate: number;
  };
}

class EnhancedCodeOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private sessions: Map<string, OrchestratorSession> = new Map();
  private metrics: OrchestratorMetrics;
  private componentPool: {
    promptEngines: EnhancedPromptEngine[];
    streamingManagers: EnhancedStreamingManager[];
    agenticManagers: AgenticFrameworkManager[];
    fileManagers: AdvancedFileManager[];
  };

  constructor(config?: Partial<OrchestratorConfig>) {
    super();
    this.config = OrchestratorConfigSchema.parse(config || {});
    this.metrics = this.initializeMetrics();
    this.componentPool = this.initializeComponentPool();

    // Set up periodic cleanup and metrics updates
    setInterval(() => this.performMaintenance(), 30000);
  }

  /**
   * Start enhanced code response session
   */
  async startSession(request: Partial<EnhancedRequest>): Promise<string> {
    const validatedRequest = EnhancedRequestSchema.parse({
      id:
        request.id ||
        `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...request,
    });

    // Check concurrent session limit
    const activeSessions = Array.from(this.sessions.values()).filter((s) =>
      [
        "processing",
        "streaming",
        "agentic_processing",
        "file_operations",
      ].includes(s.state.status),
    );

    if (activeSessions.length >= this.config.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached`,
      );
    }

    // Determine effective mode
    const effectiveMode = request.options?.mode || this.config.mode;
    const sessionConfig = this.buildSessionConfig(
      validatedRequest,
      effectiveMode,
    );

    // Initialize session
    const session = await this.initializeSession(
      validatedRequest,
      sessionConfig,
    );
    this.sessions.set(validatedRequest.id, session);

    this.emit("session_started", {
      sessionId: validatedRequest.id,
      mode: effectiveMode,
      fileCount: validatedRequest.files.length,
      taskComplexity: this.estimateTaskComplexity(validatedRequest.task),
    });

    // Start processing based on mode
    setImmediate(() => this.processSession(validatedRequest.id));

    return validatedRequest.id;
  }

  /**
   * Process session based on configured mode
   */
  private async processSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.state.status = "processing";
    session.state.lastActivity = new Date();

    try {
      switch (session.state.mode) {
        case "streaming":
          await this.processStreamingMode(session);
          break;
        case "agentic":
          await this.processAgenticMode(session);
          break;
        case "hybrid":
          await this.processHybridMode(session);
          break;
        case "standard":
          await this.processStandardMode(session);
          break;
      }

      session.state.status = "completed";
      session.state.progress = 100;

      this.emit("session_completed", {
        sessionId,
        results: session.results,
        duration: Date.now() - session.state.startTime.getTime(),
        qualityScore: session.state.metrics.qualityScore,
      });
    } catch (error) {
      session.state.status = "failed";
      session.state.errors.push(`Session processing failed: ${error.message}`);

      this.emit("session_failed", {
        sessionId,
        error: error.message,
        state: session.state,
      });

      if (this.config.errorRecovery) {
        await this.attemptSessionRecovery(sessionId);
      }
    }
  }

  /**
   * Process streaming mode
   */
  private async processStreamingMode(
    session: OrchestratorSession,
  ): Promise<void> {
    if (!session.components.streamingManager) {
      session.components.streamingManager = this.getStreamingManager();
    }

    session.state.status = "streaming";
    session.state.components.streamingManager = true;

    // Generate enhanced prompt
    const prompt = await session.components.promptEngine.generateEnhancedPrompt(
      session.request.task,
      {
        files: session.request.files,
        depthLevel: this.config.promptEngineering.depthLevel,
        promptingStrategy: "verbose",
        streamingRequired: true,
      },
    );

    // Start streaming session
    const streamingSessionId =
      await session.components.streamingManager.startStreamingSession(
        session.id,
        session.request.task,
        session.request.files,
        {
          config: this.config.streamingConfig,
          expectedOutputSize: session.request.options.expectedOutputSize,
          contextHints: session.request.options.contextHints,
        },
      );

    // Set up streaming event handlers
    this.setupStreamingEventHandlers(session, streamingSessionId);

    // Simulate streaming chunks (in real implementation, this would come from LLM)
    await this.simulateStreamingResponse(session, streamingSessionId);

    // Complete streaming and get final response
    const finalResponse =
      await session.components.streamingManager.completeStreamingSession(
        streamingSessionId,
      );
    session.results.responses.push(finalResponse);

    // Process file operations if enabled
    if (this.config.enableFileManagement && finalResponse.diffs.length > 0) {
      await this.processFileOperations(session, finalResponse);
    }
  }

  /**
   * Process agentic mode
   */
  private async processAgenticMode(
    session: OrchestratorSession,
  ): Promise<void> {
    if (!session.components.agenticManager) {
      session.components.agenticManager = this.getAgenticManager();
    }

    session.state.status = "agentic_processing";
    session.state.components.agenticFramework = true;

    const frameworkType =
      session.request.options.frameworkPreference ||
      this.config.agenticConfig?.defaultFramework ||
      "crewai";

    // Execute multi-agent collaboration
    const agenticResponse =
      await session.components.agenticManager.executeCollaboration(
        session.request.task,
        session.request.files,
        frameworkType,
        {
          qualityThreshold:
            session.request.options.qualityThreshold ||
            this.config.qualityThreshold,
          maxIterations: this.config.maxIterations,
          timeoutMs:
            session.request.options.timeoutMs || this.config.defaultTimeoutMs,
        },
      );

    session.results.responses.push(agenticResponse);
    session.state.metrics.agentIterations =
      agenticResponse.agentic_metadata?.iteration_count || 1;
    session.state.metrics.qualityScore =
      agenticResponse.agentic_metadata?.quality_score;

    // Process file operations
    if (this.config.enableFileManagement && agenticResponse.diffs.length > 0) {
      await this.processFileOperations(session, agenticResponse);
    }
  }

  /**
   * Process hybrid mode (combines streaming and agentic)
   */
  private async processHybridMode(session: OrchestratorSession): Promise<void> {
    // Start with streaming for initial response
    await this.processStreamingMode(session);

    const initialResponse =
      session.results.responses[session.results.responses.length - 1];

    // If quality threshold not met, engage agentic framework for refinement
    if (
      !initialResponse.agentic_metadata?.quality_score ||
      initialResponse.agentic_metadata.quality_score <
        this.config.qualityThreshold
    ) {
      session.state.currentStep = "Refining with agentic framework";
      await this.processAgenticMode(session);
    }

    // Merge and optimize results
    await this.optimizeHybridResults(session);
  }

  /**
   * Process standard mode
   */
  private async processStandardMode(
    session: OrchestratorSession,
  ): Promise<void> {
    // Generate enhanced prompt
    const prompt = await session.components.promptEngine.generateEnhancedPrompt(
      session.request.task,
      {
        files: session.request.files,
        depthLevel: this.config.promptEngineering.depthLevel,
        promptingStrategy: "verbose",
        streamingRequired: false,
      },
    );

    // Simulate LLM response (in real implementation, this would call actual LLM)
    const mockResponse = await this.generateMockResponse(
      session.request.task,
      session.request.files,
    );

    const response = await session.components.promptEngine.processCodeResponse(
      mockResponse,
      session.request.files[0], // Primary file
      {
        generateDiffs: this.config.enableFileManagement,
        validateSyntax: true,
        updateProjectState: true,
      },
    );

    session.results.responses.push(response);

    // Process file operations
    if (this.config.enableFileManagement && response.diffs.length > 0) {
      await this.processFileOperations(session, response);
    }
  }

  /**
   * Process file operations and workflows
   */
  private async processFileOperations(
    session: OrchestratorSession,
    response: EnhancedResponse,
  ): Promise<void> {
    session.state.status = "file_operations";

    const fileManager = session.components.fileManager;

    // Register project files
    for (const file of session.request.files) {
      await fileManager.registerFile(file as ProjectItem);
    }

    // Apply diffs if present
    if (response.diffs.length > 0 && response.file_context?.file_name) {
      const targetFile = session.request.files.find(
        (f) => f.name === response.file_context!.file_name,
      );
      if (targetFile) {
        const diffResult = await fileManager.applyDiffs(
          targetFile.id,
          response.diffs,
          {
            requireApproval: session.request.options.requireApproval,
            autoSync: true,
            validateSyntax: true,
          },
        );

        session.results.appliedDiffs.push(...diffResult.appliedDiffs);
        session.state.metrics.diffsApplied += diffResult.appliedDiffs.length;
        session.state.metrics.filesModified = diffResult.success ? 1 : 0;

        if (!diffResult.success) {
          session.state.errors.push(...diffResult.errors);
        }
      }
    }

    // Handle next file request
    if (response.next_file_request && this.config.enableAutoWorkflows) {
      await this.processNextFileRequest(session, response.next_file_request);
    }

    // Update file states
    const allFileStates = fileManager.getAllFileStates();
    session.results.fileStates = allFileStates;
  }

  /**
   * Process next file request in workflow
   */
  private async processNextFileRequest(
    session: OrchestratorSession,
    nextFileName: string,
  ): Promise<void> {
    const nextFile = session.request.files.find((f) => f.name === nextFileName);
    if (!nextFile) {
      session.state.warnings.push(
        `Requested file ${nextFileName} not found in project`,
      );
      return;
    }

    // Create workflow step for next file
    const workflowStep: WorkflowStep = {
      id: `step_${Date.now()}`,
      type: "file_operation",
      fileId: nextFile.id,
      status: "pending",
      dependencies: [],
      autoExecute: true,
    };

    session.workflows.active.push(workflowStep);

    // Execute workflow step
    const workflowResult = await session.components.fileManager.executeWorkflow(
      [workflowStep],
    );

    // Update workflow state
    session.workflows.completed.push(...workflowResult.completedSteps);
    session.workflows.failed.push(...workflowResult.failedSteps);
  }

  /**
   * Optimize results from hybrid mode
   */
  private async optimizeHybridResults(
    session: OrchestratorSession,
  ): Promise<void> {
    if (session.results.responses.length < 2) return;

    const streamingResponse = session.results.responses[0];
    const agenticResponse =
      session.results.responses[session.results.responses.length - 1];

    // Merge the best aspects of both responses
    const optimizedResponse: EnhancedResponse = {
      task: agenticResponse.task,
      rules: [...streamingResponse.rules, ...agenticResponse.rules],
      file_context:
        agenticResponse.file_context || streamingResponse.file_context,
      diffs: this.mergeDiffs(streamingResponse.diffs, agenticResponse.diffs),
      next_file_request:
        agenticResponse.next_file_request ||
        streamingResponse.next_file_request,
      workflow_state: agenticResponse.workflow_state,
      technical_depth: {
        complexity_score: Math.max(
          streamingResponse.technical_depth.complexity_score,
          agenticResponse.technical_depth.complexity_score,
        ),
        requires_streaming:
          streamingResponse.technical_depth.requires_streaming ||
          agenticResponse.technical_depth.requires_streaming,
        estimated_tokens:
          streamingResponse.technical_depth.estimated_tokens +
          agenticResponse.technical_depth.estimated_tokens,
        dependencies: [
          ...new Set([
            ...(streamingResponse.technical_depth.dependencies || []),
            ...(agenticResponse.technical_depth.dependencies || []),
          ]),
        ],
      },
      agentic_metadata: {
        agent_type: "crew",
        iteration_count:
          (streamingResponse.agentic_metadata?.iteration_count || 0) +
          (agenticResponse.agentic_metadata?.iteration_count || 0),
        quality_score: Math.max(
          streamingResponse.agentic_metadata?.quality_score || 0,
          agenticResponse.agentic_metadata?.quality_score || 0,
        ),
        framework: "hybrid",
      },
    };

    // Replace responses with optimized version
    session.results.responses = [optimizedResponse];
  }

  /**
   * Merge diffs from multiple responses
   */
  private mergeDiffs(
    diffs1: DiffOperation[],
    diffs2: DiffOperation[],
  ): DiffOperation[] {
    const merged = [...diffs1];

    for (const diff2 of diffs2) {
      const existingIndex = merged.findIndex(
        (d) =>
          d.lineRange[0] === diff2.lineRange[0] &&
          d.lineRange[1] === diff2.lineRange[1],
      );

      if (existingIndex === -1) {
        merged.push(diff2);
      } else {
        // Use the diff with higher confidence
        if ((diff2.confidence || 0) > (merged[existingIndex].confidence || 0)) {
          merged[existingIndex] = diff2;
        }
      }
    }

    return merged.sort((a, b) => a.lineRange[0] - b.lineRange[0]);
  }

  /**
   * Set up streaming event handlers
   */
  private setupStreamingEventHandlers(
    session: OrchestratorSession,
    streamingSessionId: string,
  ): void {
    if (!session.components.streamingManager) return;

    session.components.streamingManager.on(
      "progress_update",
      (progress: ProgressUpdate) => {
        if (progress.sessionId === streamingSessionId) {
          session.state.progress = progress.progress;
          session.state.currentStep = `Processing chunk ${progress.currentChunk}`;
          session.state.metrics.chunksProcessed = progress.currentChunk;

          this.emit("session_progress", {
            sessionId: session.id,
            progress: progress.progress,
            currentStep: session.state.currentStep,
            estimatedTimeRemaining: progress.estimatedTimeRemaining,
          });
        }
      },
    );

    session.components.streamingManager.on("chunk_processed", (data) => {
      if (data.sessionId === streamingSessionId) {
        session.state.metrics.tokensUsed += data.chunk.metadata?.tokens || 0;
        session.state.lastActivity = new Date();
      }
    });

    session.components.streamingManager.on("streaming_error", (error) => {
      if (error.sessionId === streamingSessionId) {
        session.state.errors.push(error.error);
        session.state.metrics.errorCount += 1;
      }
    });
  }

  /**
   * Simulate streaming response (in real implementation, this would interface with actual LLM)
   */
  private async simulateStreamingResponse(
    session: OrchestratorSession,
    streamingSessionId: string,
  ): Promise<void> {
    const mockChunks = this.generateMockStreamingChunks(session.request.task);

    for (const chunk of mockChunks) {
      await new Promise((resolve) =>
        setTimeout(resolve, 100 + Math.random() * 200),
      ); // Simulate network delay

      await session.components.streamingManager!.processStreamChunk(
        streamingSessionId,
        chunk.content,
        chunk.metadata,
      );
    }
  }

  /**
   * Generate mock streaming chunks
   */
  private generateMockStreamingChunks(
    task: string,
  ): Array<{ content: string; metadata: any }> {
    const chunks = [
      {
        content: `// Enhanced implementation for: ${task}\n`,
        metadata: { chunkType: "comment" },
      },
      {
        content: `import { useState, useEffect, useCallback } from 'react';\n`,
        metadata: { chunkType: "import" },
      },
      {
        content: `\nexport interface EnhancedComponentProps {\n  data: any[];\n  onUpdate: (data: any) => void;\n}\n`,
        metadata: { chunkType: "structure" },
      },
      {
        content: `\nexport const EnhancedComponent: React.FC<EnhancedComponentProps> = ({\n  data,\n  onUpdate\n}) => {\n`,
        metadata: { chunkType: "code" },
      },
      {
        content: `  const [state, setState] = useState(data);\n  const [loading, setLoading] = useState(false);\n`,
        metadata: { chunkType: "code" },
      },
      {
        content: `\n  const handleUpdate = useCallback(async (newData: any) => {\n    setLoading(true);\n    try {\n      await onUpdate(newData);\n      setState(newData);\n    } catch (error) {\n      console.error('Update failed:', error);\n    } finally {\n      setLoading(false);\n    }\n  }, [onUpdate]);\n`,
        metadata: { chunkType: "code" },
      },
      {
        content: `\n  return (\n    <div className="enhanced-component">\n      {/* Component implementation */}\n    </div>\n  );\n};\n`,
        metadata: { chunkType: "code" },
      },
    ];

    return chunks;
  }

  /**
   * Generate mock response for standard mode
   */
  private async generateMockResponse(
    task: string,
    files: any[],
  ): Promise<string> {
    return `
// Enhanced implementation for: ${task}
import { useState, useEffect, useCallback } from 'react';

export interface EnhancedComponentProps {
  data: any[];
  onUpdate: (data: any) => void;
  options?: {
    enableCaching?: boolean;
    validateData?: boolean;
  };
}

export const EnhancedComponent: React.FC<EnhancedComponentProps> = ({
  data,
  onUpdate,
  options = {}
}) => {
  const [state, setState] = useState(data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enhanced update handler with error handling and caching
  const handleUpdate = useCallback(async (newData: any) => {
    setLoading(true);
    setError(null);

    try {
      // Validate data if enabled
      if (options.validateData) {
        if (!Array.isArray(newData)) {
          throw new Error('Data must be an array');
        }
      }

      await onUpdate(newData);
      setState(newData);

      // Cache data if enabled
      if (options.enableCaching) {
        localStorage.setItem('enhanced-component-data', JSON.stringify(newData));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Update failed';
      setError(errorMessage);
      console.error('Update failed:', err);
    } finally {
      setLoading(false);
    }
  }, [onUpdate, options]);

  // Load cached data on mount
  useEffect(() => {
    if (options.enableCaching) {
      try {
        const cached = localStorage.getItem('enhanced-component-data');
        if (cached) {
          const cachedData = JSON.parse(cached);
          setState(cachedData);
        }
      } catch (err) {
        console.warn('Failed to load cached data:', err);
      }
    }
  }, [options.enableCaching]);

  return (
    <div className="enhanced-component">
      {loading && <div className="loading">Processing...</div>}
      {error && <div className="error">Error: {error}</div>}
      <div className="content">
        {state.map((item, index) => (
          <div key={index} className="item">
            {JSON.stringify(item)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default EnhancedComponent;
    `.trim();
  }

  /**
   * Attempt session recovery after failure
   */
  private async attemptSessionRecovery(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.state.currentStep = "Attempting recovery";

    try {
      // Try to salvage any partial results
      if (session.results.responses.length > 0) {
        const lastResponse =
          session.results.responses[session.results.responses.length - 1];

        // If we have partial content, try to validate and complete it
        if (lastResponse.file_context?.content) {
          session.state.status = "completed";
          session.state.warnings.push("Session recovered with partial results");

          this.emit("session_recovered", {
            sessionId,
            partialResults: session.results,
          });
          return;
        }
      }

      // If no partial results, try reprocessing with simpler mode
      session.state.mode = "standard";
      session.state.status = "processing";
      session.state.errors = [
        `Original processing failed, retrying in standard mode`,
      ];

      await this.processStandardMode(session);
    } catch (recoveryError) {
      session.state.status = "failed";
      session.state.errors.push(
        `Recovery attempt failed: ${recoveryError.message}`,
      );

      this.emit("session_recovery_failed", {
        sessionId,
        originalErrors: session.state.errors,
      });
    }
  }

  /**
   * Initialize session
   */
  private async initializeSession(
    request: EnhancedRequest,
    config: OrchestratorConfig,
  ): Promise<OrchestratorSession> {
    const session: OrchestratorSession = {
      id: request.id,
      request,
      state: {
        id: request.id,
        status: "initializing",
        mode: request.options.mode || config.mode,
        startTime: new Date(),
        lastActivity: new Date(),
        progress: 0,
        components: {
          promptEngine: false,
          streamingManager: false,
          agenticFramework: false,
          fileManager: false,
        },
        metrics: {
          tokensUsed: 0,
          chunksProcessed: 0,
          agentIterations: 0,
          filesModified: 0,
          diffsApplied: 0,
          errorCount: 0,
        },
        errors: [],
        warnings: [],
      },
      config,
      components: {
        promptEngine: this.getPromptEngine(),
        fileManager: this.getFileManager(),
      },
      results: {
        responses: [],
        fileStates: new Map(),
        appliedDiffs: [],
      },
      workflows: {
        active: [],
        completed: [],
        failed: [],
      },
    };

    // Initialize optional components based on mode
    if (session.state.mode === "streaming" || session.state.mode === "hybrid") {
      session.components.streamingManager = this.getStreamingManager();
    }

    if (session.state.mode === "agentic" || session.state.mode === "hybrid") {
      session.components.agenticManager = this.getAgenticManager();
    }

    session.state.components.promptEngine = true;
    session.state.components.fileManager = true;

    return session;
  }

  /**
   * Build session-specific configuration
   */
  private buildSessionConfig(
    request: EnhancedRequest,
    mode: string,
  ): OrchestratorConfig {
    const sessionConfig = { ...this.config };

    // Override with request-specific options
    if (request.options.timeoutMs) {
      sessionConfig.defaultTimeoutMs = request.options.timeoutMs;
    }

    if (request.options.qualityThreshold) {
      sessionConfig.qualityThreshold = request.options.qualityThreshold;
    }

    // Adjust configuration based on mode
    switch (mode) {
      case "streaming":
        sessionConfig.enableStreaming = true;
        sessionConfig.enableAgenticFrameworks = false;
        break;
      case "agentic":
        sessionConfig.enableStreaming = false;
        sessionConfig.enableAgenticFrameworks = true;
        break;
      case "hybrid":
        sessionConfig.enableStreaming = true;
        sessionConfig.enableAgenticFrameworks = true;
        break;
      case "standard":
        sessionConfig.enableStreaming = false;
        sessionConfig.enableAgenticFrameworks = false;
        break;
    }

    return sessionConfig;
  }

  /**
   * Estimate task complexity for planning
   */
  private estimateTaskComplexity(task: string): number {
    let complexity = 1;

    // Factor in task length
    complexity += Math.min(task.length / 100, 5);

    // Factor in complexity keywords
    const complexityKeywords = [
      "implement",
      "create",
      "build",
      "design",
      "optimize",
      "refactor",
      "architecture",
      "pattern",
      "algorithm",
      "performance",
      "security",
      "database",
      "api",
      "framework",
      "integration",
      "testing",
    ];

    const foundKeywords = complexityKeywords.filter((keyword) =>
      task.toLowerCase().includes(keyword),
    );

    complexity += foundKeywords.length * 0.5;

    return Math.min(Math.max(complexity, 1), 10);
  }

  /**
   * Initialize component pool for efficient resource management
   */
  private initializeComponentPool() {
    return {
      promptEngines: Array.from(
        { length: this.config.maxConcurrentSessions },
        () => new EnhancedPromptEngine(),
      ),
      streamingManagers: Array.from(
        { length: this.config.maxConcurrentSessions },
        () => new EnhancedStreamingManager(this.config.streamingConfig),
      ),
      agenticManagers: this.config.enableAgenticFrameworks
        ? Array.from({ length: this.config.maxConcurrentSessions }, () => {
            const configs: FrameworkConfig[] = [
              {
                framework: "crewai",
                agents: this.createDefaultAgents(),
                tasks: [],
                process: "sequential",
              },
            ];
            return new AgenticFrameworkManager(configs);
          })
        : [],
      fileManagers: Array.from(
        { length: this.config.maxConcurrentSessions },
        () =>
          new AdvancedFileManager({
            autoSaveInterval: 30000,
            maxHistoryEntries: 100,
            enableRealTimeSync: true,
          }),
      ),
    };
  }

  /**
   * Create default agents for agentic frameworks
   */
  private createDefaultAgents(): BaseAgent[] {
    return [
      {
        id: "senior_developer",
        role: "Senior Developer",
        goal: "Generate high-quality, production-ready code with comprehensive error handling and optimization",
        backstory:
          "An experienced software engineer with deep knowledge of modern development practices and patterns",
        tools: ["code_generation", "syntax_validation", "optimization"],
        expertise: ["typescript", "react", "node.js", "architecture"],
        capabilities: {
          codeGeneration: true,
          codeReview: true,
          testing: false,
          debugging: true,
          optimization: true,
          documentation: true,
        },
      },
      {
        id: "code_reviewer",
        role: "Code Reviewer",
        goal: "Review code for quality, maintainability, and best practices",
        backstory:
          "A meticulous code reviewer focused on code quality and maintainability",
        tools: ["static_analysis", "best_practices_check", "security_audit"],
        expertise: [
          "code_quality",
          "security",
          "performance",
          "maintainability",
        ],
        capabilities: {
          codeGeneration: false,
          codeReview: true,
          testing: false,
          debugging: true,
          optimization: false,
          documentation: true,
        },
      },
      {
        id: "test_engineer",
        role: "Test Engineer",
        goal: "Create comprehensive test cases and ensure code testability",
        backstory:
          "A testing specialist focused on creating robust test suites and ensuring code quality",
        tools: ["test_generation", "coverage_analysis", "mocking"],
        expertise: ["testing", "jest", "cypress", "test_automation"],
        capabilities: {
          codeGeneration: true,
          codeReview: false,
          testing: true,
          debugging: false,
          optimization: false,
          documentation: false,
        },
      },
    ];
  }

  /**
   * Get prompt engine from pool
   */
  private getPromptEngine(): EnhancedPromptEngine {
    return this.componentPool.promptEngines[0] || new EnhancedPromptEngine();
  }

  /**
   * Get streaming manager from pool
   */
  private getStreamingManager(): EnhancedStreamingManager {
    return (
      this.componentPool.streamingManagers[0] ||
      new EnhancedStreamingManager(this.config.streamingConfig)
    );
  }

  /**
   * Get agentic manager from pool
   */
  private getAgenticManager(): AgenticFrameworkManager {
    return (
      this.componentPool.agenticManagers[0] ||
      new AgenticFrameworkManager([
        {
          framework: "crewai",
          agents: this.createDefaultAgents(),
          tasks: [],
          process: "sequential",
        },
      ])
    );
  }

  /**
   * Get file manager from pool
   */
  private getFileManager(): AdvancedFileManager {
    return (
      this.componentPool.fileManagers[0] ||
      new AdvancedFileManager({
        autoSaveInterval: 30000,
        maxHistoryEntries: 100,
        enableRealTimeSync: true,
      })
    );
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): OrchestratorMetrics {
    return {
      totalSessions: 0,
      activeSessions: 0,
      completedSessions: 0,
      failedSessions: 0,
      averageSessionDuration: 0,
      averageQualityScore: 0,
      successRate: 0,
      componentsUsage: {
        streaming: 0,
        agentic: 0,
        fileManagement: 0,
      },
      performanceMetrics: {
        averageResponseTime: 0,
        throughput: 0,
        errorRate: 0,
      },
    };
  }

  /**
   * Perform periodic maintenance
   */
  private performMaintenance(): void {
    // Clean up old sessions
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    let cleanedSessions = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        session.state.status === "completed" ||
        session.state.status === "failed"
      ) {
        if (session.state.startTime.getTime() < cutoffTime) {
          this.sessions.delete(sessionId);
          cleanedSessions++;
        }
      }
    }

    // Update metrics
    this.updateMetrics();

    // Clean up component pools
    this.componentPool.streamingManagers.forEach((sm) => {
      sm.cleanupCompletedSessions(3600000); // 1 hour
    });

    this.emit("maintenance_completed", {
      cleanedSessions,
      activeSessions: this.metrics.activeSessions,
      totalSessions: this.metrics.totalSessions,
    });
  }

  /**
   * Update orchestrator metrics
   */
  private updateMetrics(): void {
    const sessions = Array.from(this.sessions.values());

    this.metrics.activeSessions = sessions.filter((s) =>
      [
        "processing",
        "streaming",
        "agentic_processing",
        "file_operations",
      ].includes(s.state.status),
    ).length;

    this.metrics.completedSessions = sessions.filter(
      (s) => s.state.status === "completed",
    ).length;
    this.metrics.failedSessions = sessions.filter(
      (s) => s.state.status === "failed",
    ).length;
    this.metrics.totalSessions = sessions.length;

    if (this.metrics.totalSessions > 0) {
      this.metrics.successRate =
        this.metrics.completedSessions / this.metrics.totalSessions;
    }

    // Calculate average quality score
    const completedSessions = sessions.filter(
      (s) => s.state.status === "completed",
    );
    if (completedSessions.length > 0) {
      const totalQuality = completedSessions.reduce(
        (sum, session) => sum + (session.state.metrics.qualityScore || 0),
        0,
      );
      this.metrics.averageQualityScore =
        totalQuality / completedSessions.length;
    }

    // Update component usage metrics
    this.metrics.componentsUsage = {
      streaming: sessions.filter((s) => s.state.components.streamingManager)
        .length,
      agentic: sessions.filter((s) => s.state.components.agenticFramework)
        .length,
      fileManagement: sessions.filter((s) => s.state.components.fileManager)
        .length,
    };
  }

  // Public API methods

  /**
   * Cancel a session
   */
  async cancelSession(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.state.status = "cancelled";
    session.state.errors.push(`Session cancelled: ${reason || "User request"}`);

    // Cancel streaming if active
    if (session.components.streamingManager) {
      await session.components.streamingManager.cancelStreamingSession(
        sessionId,
        reason,
      );
    }

    this.emit("session_cancelled", {
      sessionId,
      reason,
      duration: Date.now() - session.state.startTime.getTime(),
    });
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): SessionState | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.state } : null;
  }

  /**
   * Get session results
   */
  getSessionResults(sessionId: string): OrchestratorSession["results"] | null {
    const session = this.sessions.get(sessionId);
    return session
      ? {
          responses: [...session.results.responses],
          fileStates: new Map(session.results.fileStates),
          appliedDiffs: [...session.results.appliedDiffs],
          streamingMetrics: session.results.streamingMetrics,
          agenticMetrics: session.results.agenticMetrics,
        }
      : null;
  }

  /**
   * List active sessions
   */
  getActiveSessions(): Array<{
    id: string;
    status: string;
    progress: number;
    startTime: Date;
  }> {
    return Array.from(this.sessions.values())
      .filter(
        (session) =>
          session.state.status !== "completed" &&
          session.state.status !== "failed",
      )
      .map((session) => ({
        id: session.id,
        status: session.state.status,
        progress: session.state.progress,
        startTime: session.state.startTime,
      }));
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics(): OrchestratorMetrics {
    return { ...this.metrics };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<OrchestratorConfig>): void {
    this.config = OrchestratorConfigSchema.parse({
      ...this.config,
      ...newConfig,
    });

    this.emit("config_updated", this.config);
  }

  /**
   * Shutdown orchestrator gracefully
   */
  async shutdown(): Promise<void> {
    // Cancel all active sessions
    const activeSessions = this.getActiveSessions();

    await Promise.all(
      activeSessions.map((session) =>
        this.cancelSession(session.id, "Orchestrator shutdown"),
      ),
    );

    // Clean up component pools
    this.componentPool = {
      promptEngines: [],
      streamingManagers: [],
      agenticManagers: [],
      fileManagers: [],
    };

    this.emit("shutdown_completed");
  }
}

export {
  EnhancedCodeOrchestrator,
  type OrchestratorConfig,
  type EnhancedRequest,
  type SessionState,
  type OrchestratorSession,
  type OrchestratorMetrics,
  OrchestratorConfigSchema,
  EnhancedRequestSchema,
  SessionStateSchema,
};
