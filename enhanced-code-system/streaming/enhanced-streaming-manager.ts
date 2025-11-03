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
import { llmIntegration } from "../core/llm-integration";
import {
  createStreamError,
  ERROR_CODES
} from "../core/error-types";
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
      throw createStreamError(`Streaming session ${sessionId} not found`, {
        code: ERROR_CODES.STREAMING.CHUNK_PROCESSING_FAILED,
        severity: 'high',
        recoverable: false,
        context: { sessionId }
      });
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
      throw createStreamError(`Streaming session ${sessionId} not found`, {
        code: ERROR_CODES.STREAMING.COMPLETION_FAILED,
        severity: 'high',
        recoverable: false,
        context: { sessionId }
      });
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

    // System context with enhanced guidance
    windows.push({
      id: "system",
      content:
        "You are an expert software engineer generating high-quality, production-ready code with:\n" +
        "- Comprehensive error handling and validation\n" +
        "- Detailed comments explaining complex logic\n" +
        "- Performance considerations and optimization notes\n" +
        "- Security best practices where applicable\n" +
        "- Type safety and strict typing\n" +
        "- Extensible and maintainable architecture",
      tokenCount: 80, // More detailed system prompt
      priority: 10,
      timestamp: new Date(),
      type: "system",
      metadata: { guidanceLevel: "expert" },
    });

    // Task context with enhanced structure
    windows.push({
      id: "task",
      content: `PRIMARY TASK:\n${task}\n\nTASK REQUIREMENTS:\n- Generate clean, maintainable code\n- Include comprehensive error handling\n- Add detailed inline documentation\n- Consider performance and security implications`,
      tokenCount: Math.ceil((task.length + 200) / 4), // Account for structure
      priority: 9,
      timestamp: new Date(),
      type: "user",
      metadata: { type: "task", structure: "enhanced" },
    });

    // Project files context with intelligent selection
    const relevantFiles = this.selectRelevantFiles(projectFiles, task, contextHints);
    
    for (const file of relevantFiles) {
      // Calculate content relevance score
      const relevanceScore = this.calculateFileRelevance(file, task, contextHints);
      
      // Extract key sections for context efficiency
      const filePreview = this.extractFilePreview(file.content, 500); // Limit preview size
      
      windows.push({
        id: `file_${file.id}`,
        content: `FILE: ${file.path}\nLANGUAGE: ${file.language}\nMODIFIED: ${file.hasEdits ? 'Yes' : 'No'}\nCONTENT:\n${filePreview}`,
        tokenCount: Math.ceil((file.path.length + file.language.length + filePreview.length + 100) / 4),
        priority: file.hasEdits ? 8 : (relevanceScore > 0.7 ? 7 : 5), // Higher priority for edited/relevant files
        timestamp: file.lastModified,
        type: "context",
        metadata: {
          fileId: file.id,
          language: file.language,
          hasEdits: file.hasEdits,
          relevanceScore: relevanceScore,
          contentLength: file.content.length
        },
      });
    }

    // Context hints with enhanced processing
    if (contextHints.length > 0) {
      const processedHints = this.processContextHints(contextHints, task);
      windows.push({
        id: "hints",
        content: `CONTEXTUAL HINTS FOR THIS TASK:\n${processedHints.join('\n- ')}`,
        tokenCount: Math.ceil((processedHints.join('\n- ').length + 50) / 4),
        priority: 7,
        timestamp: new Date(),
        type: "context",
        metadata: { type: "hints", hintCount: processedHints.length },
      });
    }

    return windows;
  }

  /**
   * Optimize context windows to fit within token limits with enhanced strategies
   */
  private async optimizeContextWindows(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // Calculate current token usage
      const currentTokens = this.calculateTotalTokens(session.contextWindows);
      const maxTokens = session.config.contextWindowSize;
      const bufferTokens = Math.floor(maxTokens * 0.15); // 15% buffer
      const targetTokens = maxTokens - bufferTokens;

      // If already within limits, no optimization needed
      if (currentTokens <= targetTokens) {
        return;
      }

      // Apply multi-stage optimization
      let optimizedWindows = [...session.contextWindows];
      
      // Stage 1: Remove low-priority windows
      optimizedWindows = this.removeLowPriorityWindows(optimizedWindows, targetTokens);
      
      // Recalculate after stage 1
      let currentUsage = this.calculateTotalTokens(optimizedWindows);
      
      // Stage 2: Smart truncation for remaining windows
      if (currentUsage > targetTokens) {
        optimizedWindows = await this.smartTruncateWindows(optimizedWindows, targetTokens);
        currentUsage = this.calculateTotalTokens(optimizedWindows);
      }
      
      // Stage 3: Aggressive compression for critical situations
      if (currentUsage > targetTokens) {
        optimizedWindows = await this.compressWindows(optimizedWindows, targetTokens);
      }

      // Update session with optimized windows
      session.contextWindows = optimizedWindows;
      session.state.contextTokensUsed = this.calculateTotalTokens(optimizedWindows);

      this.emit("context_optimized", {
        sessionId,
        originalTokens: currentTokens,
        optimizedTokens: session.state.contextTokensUsed,
        windowsRemoved: session.contextWindows.length - optimizedWindows.length,
        strategyUsed: currentTokens > session.state.contextTokensUsed ? "multi_stage" : "none"
      });

    } catch (error) {
      throw createStreamError(
        `Context optimization failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.STREAMING.CONTEXT_WINDOW_EXCEEDED,
          severity: 'high',
          recoverable: true,
          context: { sessionId, error }
        }
      );
    }
  }

  /**
   * Remove low-priority context windows to reduce token usage
   */
  private removeLowPriorityWindows(
    windows: ContextWindow[],
    targetTokens: number
  ): ContextWindow[] {
    // Sort by priority (descending) and then by token count (ascending)
    const sortedWindows = [...windows].sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.tokenCount - b.tokenCount; // Lower token count first
    });

    let currentTokens = this.calculateTotalTokens(sortedWindows);
    const result = [...sortedWindows];

    // Remove lowest priority windows that are over the target
    while (result.length > 1 && currentTokens > targetTokens) {
      // Find the lowest priority window that isn't critical
      const lowestPriorityIndex = result.findIndex(window => 
        window.priority < 7 && // Don't remove high-priority windows
        window.metadata?.type !== 'system' && // Don't remove system context
        window.metadata?.type !== 'task' // Don't remove task context
      );

      if (lowestPriorityIndex === -1) {
        break; // No more removable windows
      }

      const removedWindow = result.splice(lowestPriorityIndex, 1)[0];
      currentTokens -= removedWindow.tokenCount;
    }

    return result;
  }

  /**
   * Smart truncate context windows to reduce token usage while preserving information
   */
  private async smartTruncateWindows(
    windows: ContextWindow[],
    targetTokens: number
  ): Promise<ContextWindow[]> {
    let currentTokens = this.calculateTotalTokens(windows);
    const result = [...windows];
    
    if (currentTokens <= targetTokens) {
      return result;
    }

    // Calculate excess tokens
    const excessTokens = currentTokens - targetTokens;
    
    // Sort windows by truncatability (lower priority and higher token count first)
    const truncatableWindows = result
      .filter(window => 
        window.priority < 9 && // Don't truncate system/task windows
        window.tokenCount > 100 // Only truncate substantial content
      )
      .sort((a, b) => {
        // Prioritize truncating larger windows first
        if (b.tokenCount !== a.tokenCount) {
          return b.tokenCount - a.tokenCount;
        }
        return a.priority - b.priority; // Lower priority first
      });

    // Truncate windows proportionally
    let tokensReduced = 0;
    for (const window of truncatableWindows) {
      if (tokensReduced >= excessTokens * 0.8) { // Aim for 80% of excess
        break;
      }

      const targetReduction = Math.min(
        Math.floor(excessTokens * 0.3), // Reduce by up to 30% of excess
        Math.floor(window.tokenCount * 0.5) // But no more than 50% of window
      );

      if (targetReduction > 20) { // Only truncate if meaningful reduction
        const truncated = await this.contextOptimizer.truncateWindow(window, window.tokenCount - targetReduction);
        const reduction = window.tokenCount - truncated.tokenCount;
        
        // Update the window in result
        const index = result.findIndex(w => w.id === window.id);
        if (index !== -1) {
          result[index] = truncated;
          tokensReduced += reduction;
        }
      }
    }

    return result;
  }

  /**
   * Compress context windows using advanced techniques for extreme token reduction
   */
  private async compressWindows(
    windows: ContextWindow[],
    targetTokens: number
  ): Promise<ContextWindow[]> {
    let currentTokens = this.calculateTotalTokens(windows);
    const result = [...windows];
    
    if (currentTokens <= targetTokens) {
      return result;
    }

    // Extreme compression strategy
    const compressionRatio = targetTokens / currentTokens;
    
    // Apply aggressive truncation to all non-critical windows
    for (let i = 0; i < result.length; i++) {
      const window = result[i];
      
      // Skip critical windows
      if (window.priority >= 9 || window.metadata?.type === 'system' || window.metadata?.type === 'task') {
        continue;
      }
      
      // Calculate target token count
      const targetTokenCount = Math.max(
        50, // Minimum size
        Math.floor(window.tokenCount * compressionRatio * 0.7) // Apply slightly more aggressive compression
      );
      
      if (targetTokenCount < window.tokenCount) {
        const compressed = await this.contextOptimizer.truncateWindow(window, targetTokenCount);
        result[i] = compressed;
      }
    }

    return result;
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
   * Calculate file relevance score for context selection
   */
  private calculateFileRelevance(
    file: ProjectItem,
    task: string,
    contextHints: string[]
  ): number {
    let score = 0;
    
    // Boost for recently modified files
    if (file.hasEdits) {
      score += 0.3;
    }
    
    // Boost for files matching task keywords
    const taskKeywords = this.extractKeywords(task);
    const fileContentLower = file.content.toLowerCase();
    const fileMatches = taskKeywords.filter(keyword => 
      fileContentLower.includes(keyword.toLowerCase())
    );
    score += (fileMatches.length / Math.max(1, taskKeywords.length)) * 0.4;
    
    // Boost for files matching context hints
    if (contextHints.length > 0) {
      const hintMatches = contextHints.filter(hint => 
        file.content.toLowerCase().includes(hint.toLowerCase())
      );
      score += (hintMatches.length / contextHints.length) * 0.3;
    }
    
    // Boost for certain file types
    const importantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java'];
    if (importantExtensions.some(ext => file.path.endsWith(ext))) {
      score += 0.1;
    }
    
    return Math.min(1.0, score);
  }

  /**
   * Extract keywords from text for relevance scoring
   */
  private extractKeywords(text: string): string[] {
    // Simple keyword extraction (in practice, this would be more sophisticated)
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'we', 'you', 'i', 'he', 'she', 'they', 'them', 'their', 'there', 'here', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom'];
    const words = text.toLowerCase().match(/\b\w{3,}\b/g) || [];
    return [...new Set(words.filter(word => 
      !commonWords.includes(word)
    ))].slice(0, 50); // Limit to top 50 keywords
  }

  /**
   * Extract preview of file content for context efficiency
   */
  private extractFilePreview(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    
    // Extract beginning and end with indication of truncation
    const previewLength = Math.floor((maxLength - 50) / 2); // Leave room for truncation indicator
    const beginning = content.substring(0, previewLength);
    const ending = content.substring(content.length - previewLength);
    
    return `${beginning}\n// ... [${content.length - (previewLength * 2)} characters truncated] ...\n${ending}`;
  }

  /**
   * Process context hints with enhanced understanding
   */
  private processContextHints(hints: string[], task: string): string[] {
    // Filter and enhance hints
    return hints
      .filter(hint => hint.trim().length > 0)
      .map(hint => {
        // Add context to vague hints
        if (hint.toLowerCase().includes('security')) {
          return `${hint} - Follow OWASP security guidelines and implement proper input validation`;
        }
        if (hint.toLowerCase().includes('performance')) {
          return `${hint} - Optimize for efficiency and consider caching strategies`;
        }
        if (hint.toLowerCase().includes('accessibility')) {
          return `${hint} - Ensure WCAG 2.1 AA compliance and proper ARIA attributes`;
        }
        if (hint.toLowerCase().includes('test')) {
          return `${hint} - Include comprehensive unit tests and integration tests`;
        }
        return hint;
      });
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
    // Use more intelligent truncation based on content type
    const truncatedContent = this.intelligentTruncate(window.content, window.type, maxTokens);
    
    return {
      ...window,
      content: truncatedContent,
      tokenCount: Math.ceil(truncatedContent.length / 4),
      metadata: {
        ...window.metadata,
        truncated: true,
        originalLength: window.content.length,
        truncationMethod: 'intelligent'
      },
    };
  }

  /**
   * Intelligent truncation based on content type
   */
  private intelligentTruncate(content: string, type: string, maxTokens: number): string {
    const maxChars = maxTokens * 4; // Rough approximation
    
    if (content.length <= maxChars) {
      return content;
    }

    // Different truncation strategies based on content type
    switch (type) {
      case 'system':
        // Keep beginning and end for system context
        const keepRatio = 0.4; // Keep 40% at beginning and 40% at end
        const keepChars = Math.floor(maxChars * keepRatio);
        const header = content.substring(0, keepChars);
        const footer = content.substring(content.length - keepChars);
        return `${header}\n// ... [${content.length - (keepChars * 2)} characters truncated] ...\n${footer}`;
        
      case 'user':
        // Keep the beginning for user instructions
        return content.substring(0, maxChars - 20) + "\n// ... [truncated]";
        
      case 'context':
        // For file context, keep important parts
        if (content.includes('File:')) {
          // Extract file header and beginning content
          const lines = content.split('\n');
          const headerLines = lines.slice(0, Math.min(5, lines.length));
          const remainingLines = lines.slice(5);
          const maxRemainingChars = maxChars - headerLines.join('\n').length - 50;
          
          if (remainingLines.length > 0 && maxRemainingChars > 100) {
            const contentToShow = remainingLines.join('\n').substring(0, maxRemainingChars);
            return `${headerLines.join('\n')}\n${contentToShow}\n// ... [truncated]`;
          } else {
            return `${headerLines.join('\n')}\n// ... [truncated]`;
          }
        }
        // Fall through to default
        
      default:
        // Smart truncation keeping beginning and some ending
        if (maxChars > 200) {
          const beginning = content.substring(0, Math.floor(maxChars * 0.7));
          const ending = content.substring(content.length - Math.floor(maxChars * 0.2));
          return `${beginning}\n// ... [middle truncated] ...\n${ending}`;
        } else {
          return content.substring(0, maxChars - 20) + "\n// ... [truncated]";
        }
    }
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

  /**
   * Process real streaming response from LLM integration
   */
  async processRealStreamingResponse(
    sessionId: string,
    stream: AsyncIterable<string>,
    onProgress?: (progress: ProgressUpdate) => void
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw createStreamError(`Streaming session ${sessionId} not found`, {
        code: ERROR_CODES.STREAMING.SESSION_NOT_FOUND,
        severity: 'high',
        recoverable: false,
        context: { sessionId }
      });
    }

    try {
      session.state.status = "streaming";
      session.state.startTime = new Date();

      let chunkSequence = 0;
      let accumulatedContent = "";

      for await (const chunk of stream) {
        if (session.state.status === "cancelled") {
          break;
        }

        accumulatedContent += chunk;
        chunkSequence++;

        // Process chunk with metadata
        const metadata = {
          tokens: Math.ceil(chunk.length / 4),
          chunkType: this.detectChunkType(chunk),
          contextPosition: session.state.contextTokensUsed + Math.ceil(accumulatedContent.length / 4),
        };

        await this.processStreamChunk(sessionId, chunk, metadata);

        // Update progress if callback provided
        if (onProgress && session.state.progressPercentage !== undefined) {
          onProgress({
            sessionId,
            progress: session.state.progressPercentage,
            currentChunk: chunkSequence,
            estimatedTimeRemaining: session.state.estimatedTimeRemaining,
            currentContent: accumulatedContent.substring(0, 100) + "...",
            errors: session.state.errors,
            status: session.state.status,
          });
        }

        // Small delay to simulate real-world processing
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      session.state.status = "completed";
      this.emit("streaming_completed", { sessionId, content: accumulatedContent });

    } catch (error) {
      session.state.status = "error";
      session.state.errors.push(`Streaming failed: ${error instanceof Error ? error.message : String(error)}`);
      
      this.emit("streaming_error", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        context: "real_streaming"
      });

      throw createStreamError(
        `Failed to process real streaming response: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.STREAMING.CHUNK_PROCESSING_FAILED,
          severity: 'high',
          recoverable: true,
          context: { sessionId, error }
        }
      );
    }
  }

  /**
   * Detect chunk type based on content
   */
  private detectChunkType(content: string): StreamChunk["metadata"]["chunkType"] {
    if (content.includes("import ") || content.includes("export ")) {
      return "import";
    }
    
    if (content.includes("//") || content.includes("/**") || content.includes("/*")) {
      return "comment";
    }
    
    if (content.includes("interface ") || content.includes("type ")) {
      return "structure";
    }
    
    if (content.includes("class ") || content.includes("function ") || content.includes("const ")) {
      return "code";
    }
    
    return "code";
  }

  /**
   * Cancel streaming session
   */
  async cancelStreamingSession(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw createStreamError(`Streaming session ${sessionId} not found`, {
        code: ERROR_CODES.STREAMING.SESSION_NOT_FOUND,
        severity: 'high',
        recoverable: false,
        context: { sessionId }
      });
    }

    const previousStatus = session.state.status;
    session.state.status = "cancelled";
    session.state.errors.push(`Session cancelled: ${reason || "User request"}`);

    this.emit("streaming_session_cancelled", {
      sessionId,
      reason,
      previousStatus,
      duration: session.state.startTime ? Date.now() - session.state.startTime.getTime() : 0,
    });
  }

  /**
   * Select relevant files based on task and context hints
   */
  private selectRelevantFiles(
    projectFiles: ProjectItem[],
    task: string,
    contextHints: string[]
  ): ProjectItem[] {
    // Limit to top 10 files to avoid token explosion
    const candidateFiles = projectFiles.slice(0, 10);
    
    // Score files by relevance
    const scoredFiles = candidateFiles.map(file => ({
      file,
      score: this.calculateFileRelevance(file, task, contextHints)
    }));
    
    // Sort by relevance score (descending) and take top 5
    return scoredFiles
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.file);
  }

  /**
   * Calculate file relevance score based on task and context hints
   */
  private calculateFileRelevance(
    file: ProjectItem,
    task: string,
    contextHints: string[]
  ): number {
    let score = 0;
    
    // Boost for recently modified files
    if (file.hasEdits) {
      score += 0.3;
    }
    
    // Boost for files matching task keywords
    const taskKeywords = this.extractKeywords(task);
    const fileContentLower = file.content.toLowerCase();
    const fileMatches = taskKeywords.filter(keyword => 
      fileContentLower.includes(keyword.toLowerCase())
    );
    score += (fileMatches.length / taskKeywords.length) * 0.4;
    
    // Boost for files matching context hints
    if (contextHints.length > 0) {
      const hintMatches = contextHints.filter(hint => 
        file.content.toLowerCase().includes(hint.toLowerCase())
      );
      score += (hintMatches.length / contextHints.length) * 0.3;
    }
    
    // Boost for certain file types
    const importantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java'];
    if (importantExtensions.some(ext => file.path.endsWith(ext))) {
      score += 0.1;
    }
    
    return Math.min(1.0, score);
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    // Simple keyword extraction (in practice, this would be more sophisticated)
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'];
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    return [...new Set(words.filter(word => 
      word.length > 3 && !commonWords.includes(word)
    ))];
  }

  /**
   * Extract preview of file content
   */
  private extractFilePreview(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    
    // Extract beginning and end with indication of truncation
    const previewLength = Math.floor((maxLength - 50) / 2); // Leave room for truncation indicator
    const beginning = content.substring(0, previewLength);
    const ending = content.substring(content.length - previewLength);
    
    return `${beginning}\n// ... [${content.length - (previewLength * 2)} characters truncated] ...\n${ending}`;
  }

  /**
   * Process context hints with enhanced logic
   */
  private processContextHints(hints: string[], task: string): string[] {
    // Filter and enhance hints
    return hints
      .filter(hint => hint.trim().length > 0)
      .map(hint => {
        // Add context to vague hints
        if (hint.toLowerCase().includes('security')) {
          return `${hint} - Follow OWASP security guidelines and implement proper input validation`;
        }
        if (hint.toLowerCase().includes('performance')) {
          return `${hint} - Optimize for efficiency and consider caching strategies`;
        }
        if (hint.toLowerCase().includes('accessibility')) {
          return `${hint} - Ensure WCAG 2.1 AA compliance and proper ARIA attributes`;
        }
        return hint;
      });
  }

  /**
   * Execute real streaming with LLM integration
   */
  async executeRealStreaming(
    sessionId: string,
    prompt: string,
    projectFiles: ProjectItem[],
    options: {
      onProgress?: (progress: ProgressUpdate) => void;
      temperature?: number;
      maxTokens?: number;
      provider?: string;
      model?: string;
    } = {}
  ): Promise<AsyncIterable<string>> {
    try {
      // Get streaming response from LLM integration
      const stream = await llmIntegration.getStreamingResponse(prompt, projectFiles);
      
      // Process the real streaming response
      await this.processRealStreamingResponse(sessionId, stream, options.onProgress);
      
      return stream;
    } catch (error) {
      throw createStreamError(
        `Failed to execute real streaming: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.STREAMING.STREAMING_FAILED,
          severity: 'high',
          recoverable: true,
          context: { sessionId, prompt, error }
        }
      );
    }
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
