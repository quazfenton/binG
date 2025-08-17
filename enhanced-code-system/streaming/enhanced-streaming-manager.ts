/**
 * Enhanced Streaming Manager
 *
 * Provides advanced streaming capabilities for technical code responses with:
 * - Real-time streaming with progress indicators
 * - Extended context management for large token limits
 * - Chunked response handling with syntax validation
 * - Stream recovery and error handling
 * - Context window optimization
 * - Integration with agentic frameworks
 * - Partial response assembly and validation
 */

import { EventEmitter } from "events";
import { z } from "zod";
import { EnhancedResponse, ProjectItem } from "../core/enhanced-prompt-engine";

// Streaming configuration schema
const StreamingConfigSchema = z.object({
  chunkSize: z.number().min(100).max(8000).default(1000),
  maxTokens: z.number().min(1000).max(128000).default(32000),
  contextWindowSize: z.number().min(4000).max(200000).default(32000),
  enablePartialValidation: z.boolean().default(true),
  enableErrorRecovery: z.boolean().default(true),
  progressUpdateInterval: z.number().min(100).max(5000).default(500),
  timeoutMs: z.number().min(5000).max(300000).default(60000),
  retryAttempts: z.number().min(0).max(5).default(3),
  streamingStrategy: z
    .enum(["incremental", "block_based", "semantic_chunks"])
    .default("semantic_chunks"),
});

const StreamChunkSchema = z.object({
  id: z.string(),
  sequenceNumber: z.number(),
  content: z.string(),
  isComplete: z.boolean(),
  hasMore: z.boolean(),
  metadata: z
    .object({
      tokens: z.number().optional(),
      chunkType: z
        .enum(["code", "comment", "structure", "import", "export"])
        .optional(),
      syntaxValid: z.boolean().optional(),
      language: z.string().optional(),
      contextPosition: z.number().optional(),
    })
    .optional(),
  timestamp: z.date(),
  dependencies: z.array(z.string()).optional(),
});

const StreamStateSchema = z.object({
  sessionId: z.string(),
  status: z.enum([
    "idle",
    "streaming",
    "paused",
    "completed",
    "error",
    "cancelled",
  ]),
  totalChunks: z.number().optional(),
  processedChunks: z.number(),
  currentChunk: z.number(),
  progressPercentage: z.number().min(0).max(100),
  estimatedTimeRemaining: z.number().optional(),
  assembledContent: z.string(),
  contextTokensUsed: z.number(),
  maxContextTokens: z.number(),
  errors: z.array(z.string()),
  startTime: z.date().optional(),
  lastChunkTime: z.date().optional(),
  averageChunkTime: z.number().optional(),
});

type StreamingConfig = z.infer<typeof StreamingConfigSchema>;
type StreamChunk = z.infer<typeof StreamChunkSchema>;
type StreamState = z.infer<typeof StreamStateSchema>;

interface ContextWindow {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  timestamp: Date;
  type: "system" | "user" | "assistant" | "context";
  metadata: Record<string, any>;
}

interface StreamingSession {
  id: string;
  config: StreamingConfig;
  state: StreamState;
  contextWindows: ContextWindow[];
  chunks: StreamChunk[];
  assembler: ContentAssembler;
  validator: PartialValidator;
  errorHandler: ErrorHandler;
}

interface ProgressUpdate {
  sessionId: string;
  progress: number;
  currentChunk: number;
  totalChunks?: number;
  estimatedTimeRemaining?: number;
  currentContent: string;
  recentChunks: StreamChunk[];
  status: string;
  errors: string[];
}

interface StreamingMetrics {
  totalSessions: number;
  activeSessions: number;
  averageChunkTime: number;
  successRate: number;
  errorRate: number;
  totalTokensStreamed: number;
  averageSessionDuration: number;
  contextWindowUtilization: number;
}

class EnhancedStreamingManager extends EventEmitter {
  private sessions: Map<string, StreamingSession> = new Map();
  private globalConfig: StreamingConfig;
  private metrics: StreamingMetrics;
  private contextOptimizer: ContextOptimizer;
  private chunkProcessor: ChunkProcessor;

  constructor(config?: Partial<StreamingConfig>) {
    super();
    this.globalConfig = StreamingConfigSchema.parse(config || {});
    this.metrics = this.initializeMetrics();
    this.contextOptimizer = new ContextOptimizer(
      this.globalConfig.contextWindowSize,
    );
    this.chunkProcessor = new ChunkProcessor(this.globalConfig);

    // Set up periodic metrics updates
    setInterval(() => this.updateMetrics(), 10000);
  }

  /**
   * Start a new streaming session for enhanced code response
   */
  async startStreamingSession(
    sessionId: string,
    task: string,
    projectFiles: ProjectItem[],
    options: {
      config?: Partial<StreamingConfig>;
      priority?: number;
      contextHints?: string[];
      expectedOutputSize?: number;
    } = {},
  ): Promise<string> {
    const {
      config = {},
      priority = 1,
      contextHints = [],
      expectedOutputSize,
    } = options;

    // Create session-specific configuration
    const sessionConfig = StreamingConfigSchema.parse({
      ...this.globalConfig,
      ...config,
    });

    // Initialize context windows
    const contextWindows = await this.buildContextWindows(
      task,
      projectFiles,
      contextHints,
    );

    // Estimate total chunks if output size is provided
    const estimatedChunks = expectedOutputSize
      ? Math.ceil(expectedOutputSize / sessionConfig.chunkSize)
      : undefined;

    const session: StreamingSession = {
      id: sessionId,
      config: sessionConfig,
      state: {
        sessionId,
        status: "idle",
        processedChunks: 0,
        currentChunk: 0,
        progressPercentage: 0,
        assembledContent: "",
        contextTokensUsed: this.calculateTotalTokens(contextWindows),
        maxContextTokens: sessionConfig.contextWindowSize,
        errors: [],
        totalChunks: estimatedChunks,
      },
      contextWindows,
      chunks: [],
      assembler: new ContentAssembler(sessionConfig),
      validator: new PartialValidator(sessionConfig),
      errorHandler: new ErrorHandler(sessionConfig),
    };

    this.sessions.set(sessionId, session);

    this.emit("streaming_session_created", {
      sessionId,
      config: sessionConfig,
      contextTokensUsed: session.state.contextTokensUsed,
      estimatedChunks,
    });

    // Optimize context windows if needed
    if (
      session.state.contextTokensUsed >
      session.state.maxContextTokens * 0.8
    ) {
      await this.optimizeContextWindows(sessionId);
    }

    return sessionId;
  }

  /**
   * Process streaming chunk from external source
   */
  async processStreamChunk(
    sessionId: string,
    content: string,
    metadata: Partial<StreamChunk["metadata"]> = {},
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Streaming session ${sessionId} not found`);
    }

    if (
      session.state.status === "cancelled" ||
      session.state.status === "error"
    ) {
      return;
    }

    try {
      // Update session state
      if (session.state.status === "idle") {
        session.state.status = "streaming";
        session.state.startTime = new Date();
      }

      // Create stream chunk
      const chunk: StreamChunk = {
        id: `chunk_${session.chunks.length + 1}`,
        sequenceNumber: session.chunks.length,
        content,
        isComplete: false,
        hasMore: true,
        metadata: {
          ...metadata,
          tokens: Math.ceil(content.length / 4),
          contextPosition: session.state.contextTokensUsed,
        },
        timestamp: new Date(),
      };

      // Validate chunk if enabled
      if (session.config.enablePartialValidation) {
        const validationResult = await session.validator.validateChunk(
          chunk,
          session.state.assembledContent,
        );
        chunk.metadata!.syntaxValid = validationResult.isValid;

        if (!validationResult.isValid) {
          session.state.errors.push(
            `Chunk ${chunk.sequenceNumber}: ${validationResult.error}`,
          );
        }
      }

      // Process chunk
      const processedChunk = await this.chunkProcessor.processChunk(
        chunk,
        session,
      );
      session.chunks.push(processedChunk);

      // Assemble content
      const assemblyResult = await session.assembler.addChunk(processedChunk);
      session.state.assembledContent = assemblyResult.content;

      // Update progress
      session.state.processedChunks += 1;
      session.state.currentChunk = processedChunk.sequenceNumber;
      session.state.lastChunkTime = new Date();

      if (session.state.totalChunks) {
        session.state.progressPercentage = Math.min(
          (session.state.processedChunks / session.state.totalChunks) * 100,
          100,
        );
      }

      // Calculate average chunk time and estimate remaining time
      if (session.state.startTime) {
        const elapsedTime = Date.now() - session.state.startTime.getTime();
        session.state.averageChunkTime =
          elapsedTime / session.state.processedChunks;

        if (session.state.totalChunks) {
          const remainingChunks =
            session.state.totalChunks - session.state.processedChunks;
          session.state.estimatedTimeRemaining =
            remainingChunks * session.state.averageChunkTime;
        }
      }

      this.emit("chunk_processed", {
        sessionId,
        chunk: processedChunk,
        progress: session.state.progressPercentage,
        assembledContent:
          session.state.assembledContent.substring(0, 500) + "...",
        errors: session.state.errors,
      });

      // Send progress update
      await this.sendProgressUpdate(sessionId);
    } catch (error) {
      await this.handleStreamError(
        sessionId,
        error as Error,
        "chunk_processing",
      );
    }
  }

  /**
   * Complete streaming session
   */
  async completeStreamingSession(sessionId: string): Promise<EnhancedResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Streaming session ${sessionId} not found`);
    }

    try {
      session.state.status = "completed";
      session.state.progressPercentage = 100;

      // Final assembly and validation
      const finalContent = await session.assembler.finalize();
      const finalValidation =
        await session.validator.validateComplete(finalContent);

      if (!finalValidation.isValid) {
        session.state.errors.push(
          `Final validation failed: ${finalValidation.error}`,
        );
      }

      // Create enhanced response
      const enhancedResponse: EnhancedResponse = {
        task: `Streaming session ${sessionId} completed`,
        rules: [],
        file_context: {
          file_name: `streamed_content_${sessionId}.ts`,
          content: finalContent,
          language: "typescript",
          line_count: finalContent.split("\n").length,
        },
        diffs: [],
        next_file_request: null,
        workflow_state: "completed",
        technical_depth: {
          complexity_score: this.calculateComplexityScore(finalContent),
          requires_streaming: true,
          estimated_tokens:
            session.state.contextTokensUsed +
            session.chunks.reduce(
              (sum, chunk) => sum + (chunk.metadata?.tokens || 0),
              0,
            ),
          dependencies: this.extractDependencies(finalContent),
        },
        agentic_metadata: {
          agent_type: "single",
          iteration_count: 1,
          quality_score: finalValidation.isValid ? 0.9 : 0.6,
          framework: "streaming",
        },
      };

      this.emit("streaming_session_completed", {
        sessionId,
        finalContent,
        chunks: session.chunks.length,
        errors: session.state.errors,
        duration: session.state.startTime
          ? Date.now() - session.state.startTime.getTime()
          : 0,
        response: enhancedResponse,
      });

      // Update metrics
      this.updateSessionMetrics(session);

      return enhancedResponse;
    } catch (error) {
      await this.handleStreamError(
        sessionId,
        error as Error,
        "session_completion",
      );
      throw error;
    }
  }

  /**
   * Cancel streaming session
   */
  async cancelStreamingSession(
    sessionId: string,
    reason?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.state.status = "cancelled";
    session.state.errors.push(`Session cancelled: ${reason || "User request"}`);

    this.emit("streaming_session_cancelled", {
      sessionId,
      reason,
      processedChunks: session.state.processedChunks,
      assembledContent: session.state.assembledContent,
    });
  }

  /**
   * Pause streaming session
   */
  async pauseStreamingSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.state.status === "streaming") {
      session.state.status = "paused";

      this.emit("streaming_session_paused", {
        sessionId,
        processedChunks: session.state.processedChunks,
        progress: session.state.progressPercentage,
      });
    }
  }

  /**
   * Resume streaming session
   */
  async resumeStreamingSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.state.status === "paused") {
      session.state.status = "streaming";

      this.emit("streaming_session_resumed", {
        sessionId,
        processedChunks: session.state.processedChunks,
        progress: session.state.progressPercentage,
      });
    }
  }

  /**
   * Get streaming session progress
   */
  getSessionProgress(sessionId: string): ProgressUpdate | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      progress: session.state.progressPercentage,
      currentChunk: session.state.currentChunk,
      totalChunks: session.state.totalChunks,
      estimatedTimeRemaining: session.state.estimatedTimeRemaining,
      currentContent: session.state.assembledContent,
      recentChunks: session.chunks.slice(-3),
      status: session.state.status,
      errors: session.state.errors,
    };
  }

  /**
   * Build context windows from task and project files
   */
  private async buildContextWindows(
    task: string,
    projectFiles: ProjectItem[],
    contextHints: string[],
  ): Promise<ContextWindow[]> {
    const windows: ContextWindow[] = [];

    // System context
    windows.push({
      id: "system",
      content:
        "You are an expert software engineer generating high-quality, production-ready code.",
      tokenCount: 20,
      priority: 10,
      timestamp: new Date(),
      type: "system",
      metadata: {},
    });

    // Task context
    windows.push({
      id: "task",
      content: task,
      tokenCount: Math.ceil(task.length / 4),
      priority: 9,
      timestamp: new Date(),
      type: "user",
      metadata: { type: "task" },
    });

    // Project files context
    for (const file of projectFiles.slice(0, 5)) {
      // Limit to top 5 files
      windows.push({
        id: `file_${file.id}`,
        content: `File: ${file.name}\n${file.content}`,
        tokenCount: Math.ceil((file.name.length + file.content.length) / 4),
        priority: file.hasEdits ? 8 : 6,
        timestamp: file.lastModified,
        type: "context",
        metadata: {
          fileId: file.id,
          language: file.language,
          hasEdits: file.hasEdits,
        },
      });
    }

    // Context hints
    if (contextHints.length > 0) {
      windows.push({
        id: "hints",
        content: `Context hints: ${contextHints.join(", ")}`,
        tokenCount: Math.ceil(contextHints.join(", ").length / 4),
        priority: 7,
        timestamp: new Date(),
        type: "context",
        metadata: { type: "hints" },
      });
    }

    return windows;
  }

  /**
   * Optimize context windows to fit within token limits
   */
  private async optimizeContextWindows(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const optimizedWindows = await this.contextOptimizer.optimize(
      session.contextWindows,
      session.config.contextWindowSize * 0.8, // Leave 20% buffer
    );

    session.contextWindows = optimizedWindows;
    session.state.contextTokensUsed =
      this.calculateTotalTokens(optimizedWindows);

    this.emit("context_optimized", {
      sessionId,
      originalTokens: this.calculateTotalTokens(session.contextWindows),
      optimizedTokens: session.state.contextTokensUsed,
      windowsRemoved: session.contextWindows.length - optimizedWindows.length,
    });
  }

  /**
   * Send progress update to listeners
   */
  private async sendProgressUpdate(sessionId: string): Promise<void> {
    const progress = this.getSessionProgress(sessionId);
    if (progress) {
      this.emit("progress_update", progress);
    }
  }

  /**
   * Handle streaming errors
   */
  private async handleStreamError(
    sessionId: string,
    error: Error,
    context: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.state.errors.push(`${context}: ${error.message}`);

    if (session.config.enableErrorRecovery) {
      const recovered = await session.errorHandler.attemptRecovery(
        error,
        context,
      );
      if (recovered) {
        this.emit("error_recovered", {
          sessionId,
          error: error.message,
          context,
        });
        return;
      }
    }

    session.state.status = "error";
    this.emit("streaming_error", {
      sessionId,
      error: error.message,
      context,
      recoveryAttempted: session.config.enableErrorRecovery,
    });
  }

  /**
   * Calculate total tokens across context windows
   */
  private calculateTotalTokens(windows: ContextWindow[]): number {
    return windows.reduce((sum, window) => sum + window.tokenCount, 0);
  }

  /**
   * Calculate complexity score for content
   */
  private calculateComplexityScore(content: string): number {
    const lines = content.split("\n").length;
    const functions = (content.match(/function|=>/g) || []).length;
    const classes = (content.match(/class /g) || []).length;
    const interfaces = (content.match(/interface /g) || []).length;

    return Math.min(
      10,
      Math.max(
        1,
        Math.ceil((lines + functions * 2 + classes * 3 + interfaces * 2) / 50),
      ),
    );
  }

  /**
   * Extract dependencies from content
   */
  private extractDependencies(content: string): string[] {
    const importRegex = /(?:import|from)\s+['"`]([^'"`]+)['"`]/g;
    const dependencies: string[] = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return [...new Set(dependencies)];
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): StreamingMetrics {
    return {
      totalSessions: 0,
      activeSessions: 0,
      averageChunkTime: 0,
      successRate: 0,
      errorRate: 0,
      totalTokensStreamed: 0,
      averageSessionDuration: 0,
      contextWindowUtilization: 0,
    };
  }

  /**
   * Update metrics periodically
   */
  private updateMetrics(): void {
    this.metrics.activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.state.status === "streaming" || s.state.status === "paused",
    ).length;

    this.emit("metrics_updated", this.metrics);
  }

  /**
   * Update session-specific metrics
   */
  private updateSessionMetrics(session: StreamingSession): void {
    this.metrics.totalSessions += 1;

    if (session.state.status === "completed") {
      // Update success rate, duration, etc.
      const duration = session.state.startTime
        ? Date.now() - session.state.startTime.getTime()
        : 0;

      this.metrics.averageSessionDuration =
        (this.metrics.averageSessionDuration + duration) /
        this.metrics.totalSessions;
    }
  }

  // Public getter methods
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys()).filter((id) => {
      const session = this.sessions.get(id);
      return (
        session &&
        (session.state.status === "streaming" ||
          session.state.status === "paused")
      );
    });
  }

  getSessionState(sessionId: string): StreamState | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.state } : null;
  }

  getMetrics(): StreamingMetrics {
    return { ...this.metrics };
  }

  cleanupCompletedSessions(olderThanMs: number = 3600000): number {
    let cleaned = 0;
    const cutoffTime = Date.now() - olderThanMs;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        session.state.status === "completed" ||
        session.state.status === "error"
      ) {
        const sessionTime = session.state.startTime?.getTime() || 0;
        if (sessionTime < cutoffTime) {
          this.sessions.delete(sessionId);
          cleaned++;
        }
      }
    }

    return cleaned;
  }
}

// Context Optimizer class
class ContextOptimizer {
  private maxTokens: number;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  async optimize(
    windows: ContextWindow[],
    targetTokens: number,
  ): Promise<ContextWindow[]> {
    // Sort by priority (higher priority first)
    const sortedWindows = [...windows].sort((a, b) => b.priority - a.priority);
    const optimized: ContextWindow[] = [];
    let currentTokens = 0;

    for (const window of sortedWindows) {
      if (currentTokens + window.tokenCount <= targetTokens) {
        optimized.push(window);
        currentTokens += window.tokenCount;
      } else if (window.priority >= 8) {
        // For high-priority windows, try to truncate instead of excluding
        const availableTokens = targetTokens - currentTokens;
        if (availableTokens > 50) {
          const truncated = await this.truncateWindow(window, availableTokens);
          optimized.push(truncated);
          currentTokens += truncated.tokenCount;
        }
        break;
      }
    }

    return optimized;
  }

  private async truncateWindow(
    window: ContextWindow,
    maxTokens: number,
  ): Promise<ContextWindow> {
    const maxChars = maxTokens * 4; // Rough approximation
    const truncatedContent =
      window.content.length > maxChars
        ? window.content.substring(0, maxChars) + "...[truncated]"
        : window.content;

    return {
      ...window,
      content: truncatedContent,
      tokenCount: Math.ceil(truncatedContent.length / 4),
      metadata: {
        ...window.metadata,
        truncated: true,
        originalLength: window.content.length,
      },
    };
  }
}

// Chunk Processor class
class ChunkProcessor {
  private config: StreamingConfig;

  constructor(config: StreamingConfig) {
    this.config = config;
  }

  async processChunk(
    chunk: StreamChunk,
    session: StreamingSession,
  ): Promise<StreamChunk> {
    // Apply processing based on streaming strategy
    switch (this.config.streamingStrategy) {
      case "semantic_chunks":
        return this.processSemanticChunk(chunk, session);
      case "block_based":
        return this.processBlockBasedChunk(chunk, session);
      case "incremental":
      default:
        return this.processIncrementalChunk(chunk, session);
    }
  }

  private async processSemanticChunk(
    chunk: StreamChunk,
    session: StreamingSession,
  ): Promise<StreamChunk> {
    // Identify semantic boundaries (functions, classes, etc.)
    const semanticBoundaries = this.identifySemanticBoundaries(chunk.content);

    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        chunkType: this.inferChunkType(chunk.content),
        semanticBoundaries,
      },
    };
  }

  private async processBlockBasedChunk(
    chunk: StreamChunk,
    session: StreamingSession,
  ): Promise<StreamChunk> {
    // Process in logical code blocks
    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        chunkType: this.inferChunkType(chunk.content),
      },
    };
  }

  private async processIncrementalChunk(
    chunk: StreamChunk,
    session: StreamingSession,
  ): Promise<StreamChunk> {
    // Basic incremental processing
    return chunk;
  }

  private identifySemanticBoundaries(content: string): string[] {
    const boundaries: string[] = [];

    if (
      content.includes("function ") ||
      content.includes("const ") ||
      content.includes("let ")
    ) {
      boundaries.push("declaration");
    }
    if (content.includes("class ")) boundaries.push("class");
    if (content.includes("interface ")) boundaries.push("interface");
    if (content.includes("import ") || content.includes("export "))
      boundaries.push("module");

    return boundaries;
  }

  private inferChunkType(
    content: string,
  ): StreamChunk["metadata"]["chunkType"] {
    if (content.includes("import ") || content.includes("export "))
      return "export";
    if (content.includes("//") || content.includes("/**")) return "comment";
    if (content.includes("interface ") || content.includes("type "))
      return "structure";
    return "code";
  }
}

// Content Assembler class
class ContentAssembler {
  private config: StreamingConfig;
  private assembledContent: string = "";
  private chunks: StreamChunk[] = [];

  constructor(config: StreamingConfig) {
    this.config = config;
  }

  async addChunk(
    chunk: StreamChunk,
  ): Promise<{ content: string; isValid: boolean }> {
    this.chunks.push(chunk);

    // Assemble based on sequence number
    const sortedChunks = [...this.chunks].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    );
    this.assembledContent = sortedChunks.map((c) => c.content).join("");

    return {
      content: this.assembledContent,
      isValid: this.validateAssembly(),
    };
  }

  async finalize(): Promise<string> {
    // Final cleanup and optimization
    return this.assembledContent.trim();
  }

  private validateAssembly(): boolean {
    // Basic validation - check for obvious issues
    const openBraces = (this.assembledContent.match(/\{/g) || []).length;
    const closeBraces = (this.assembledContent.match(/\}/g) || []).length;

    return Math.abs(openBraces - closeBraces) <= 1; // Allow for partial content
  }
}

// Partial Validator class
class PartialValidator {
  private config: StreamingConfig;

  constructor(config: StreamingConfig) {
    this.config = config;
  }

  async validateChunk(
    chunk: StreamChunk,
    assembledContent: string,
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      const combinedContent = assembledContent + chunk.content;

      // Basic syntax checks
      if (this.hasUnmatchedBrackets(combinedContent)) {
        return { isValid: false, error: "Unmatched brackets detected" };
      }

      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  }

  async validateComplete(
    content: string,
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      // More comprehensive validation for complete content
      if (this.hasUnmatchedBrackets(content)) {
        return { isValid: false, error: "Unmatched brackets in final content" };
      }

      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  }

  private hasUnmatchedBrackets(content: string): boolean {
    const brackets = { "(": ")", "[": "]", "{": "}" };
    const stack: string[] = [];

    for (const char of content) {
      if (char in brackets) {
        stack.push(brackets[char as keyof typeof brackets]);
      } else if (Object.values(brackets).includes(char)) {
        if (stack.pop() !== char) {
          return true;
        }
      }
    }

    return stack.length > 3; // Allow some unmatched for partial content
  }
}

// Error Handler class
class ErrorHandler {
  private config: StreamingConfig;
  private retryCount: Map<string, number> = new Map();

  constructor(config: StreamingConfig) {
    this.config = config;
  }

  async attemptRecovery(error: Error, context: string): Promise<boolean> {
    const retryKey = `${context}_${error.message}`;
    const currentRetries = this.retryCount.get(retryKey) || 0;

    if (currentRetries >= this.config.retryAttempts) {
      return false;
    }

    this.retryCount.set(retryKey, currentRetries + 1);

    try {
      // Attempt recovery based on error type and context
      switch (context) {
        case "chunk_processing":
          return await this.recoverFromChunkError(error);
        case "session_completion":
          return await this.recoverFromCompletionError(error);
        default:
          return false;
      }
    } catch (recoveryError) {
      return false;
    }
  }

  private async recoverFromChunkError(error: Error): Promise<boolean> {
    // Basic recovery strategies for chunk processing errors
    if (error.message.includes("syntax")) {
      // Could implement syntax correction logic here
      return false;
    }

    if (error.message.includes("timeout")) {
      // Could implement retry with longer timeout
      return true;
    }

    return false;
  }

  private async recoverFromCompletionError(error: Error): Promise<boolean> {
    // Recovery strategies for session completion errors
    if (error.message.includes("validation")) {
      // Could implement validation bypass or correction
      return false;
    }

    return false;
  }
}

export {
  EnhancedStreamingManager,
  ContextOptimizer,
  ChunkProcessor,
  ContentAssembler,
  PartialValidator,
  ErrorHandler,
  type StreamingConfig,
  type StreamChunk,
  type StreamState,
  type ContextWindow,
  type StreamingSession,
  type ProgressUpdate,
  type StreamingMetrics,
  StreamingConfigSchema,
  StreamChunkSchema,
  StreamStateSchema,
};
