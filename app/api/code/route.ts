/**
 * Enhanced Code System API Route
 *
 * Backend endpoint that manages the EnhancedCodeOrchestrator and handles
 * all code generation requests from the frontend code service.
 */

import { NextRequest, NextResponse } from "next/server";
import { EnhancedCodeOrchestrator } from '../../../enhanced-code-system/enhanced-code-orchestrator';
import { AdvancedFileManager, FileState, DiffOperation } from '../../../enhanced-code-system/file-management/advanced-file-manager';
import { ProjectItem } from '../../../enhanced-code-system/core/enhanced-prompt-engine';
import {
  createOrchestratorError,
  createFileManagementError,
  createStreamError,
  createCodeManagementError,
  ERROR_CODES
} from '../../../enhanced-code-system/core/error-types';
import type { Message } from '../../../types/index';
import { randomBytes } from 'crypto';

// Configuration constants
const CONFIG_CONSTANTS = {
  MAX_CONCURRENT_SESSIONS: 3,
  DEFAULT_TIMEOUT_MS: 120000,
  QUALITY_THRESHOLD: 0.8,
  MAX_ITERATIONS: 5,
  PROMPT_DEPTH_LEVEL: 8,
  CHUNK_SIZE: 1000,
  MAX_TOKENS: 32000,
  MAX_AGENTS: 5
};

// Function to get orchestrator configuration with validation
function getOrchestratorConfig(mode: "streaming" | "agentic" | "hybrid" | "standard" = "hybrid") {
  const config = {
    mode,
    enableStreaming: true,
    enableAgenticFrameworks: true,
    enableFileManagement: true,
    enableAutoWorkflows: true,
    maxConcurrentSessions: CONFIG_CONSTANTS.MAX_CONCURRENT_SESSIONS,
    defaultTimeoutMs: CONFIG_CONSTANTS.DEFAULT_TIMEOUT_MS,
    qualityThreshold: CONFIG_CONSTANTS.QUALITY_THRESHOLD,
    maxIterations: CONFIG_CONSTANTS.MAX_ITERATIONS,
    contextOptimization: true,
    errorRecovery: true,
    promptEngineering: {
      depthLevel: CONFIG_CONSTANTS.PROMPT_DEPTH_LEVEL,
      verbosityLevel: "verbose" as const,
      includeDocumentation: true,
      includeTestCases: false,
      includeOptimization: true,
    },
    streamingConfig: {
      chunkSize: CONFIG_CONSTANTS.CHUNK_SIZE,
      maxTokens: CONFIG_CONSTANTS.MAX_TOKENS,
      enablePartialValidation: true,
    },
    agenticConfig: {
      defaultFramework: "crewai",
      maxAgents: CONFIG_CONSTANTS.MAX_AGENTS,
      collaborationMode: "sequential" as const,
    },
  };

  // Validate configuration values
  if (config.maxConcurrentSessions <= 0) {
    throw new Error(`Invalid maxConcurrentSessions: ${config.maxConcurrentSessions}`);
  }
  if (config.defaultTimeoutMs <= 0) {
    throw new Error(`Invalid defaultTimeoutMs: ${config.defaultTimeoutMs}`);
  }
  if (config.qualityThreshold < 0 || config.qualityThreshold > 1) {
    throw new Error(`Invalid qualityThreshold: ${config.qualityThreshold}`);
  }
  if (config.maxIterations <= 0) {
    throw new Error(`Invalid maxIterations: ${config.maxIterations}`);
  }

  return config;
}

// Session storage (in production, use Redis or database)
const activeSessions = new Map<
  string,
  {
    orchestrator: EnhancedCodeOrchestrator;
    status: "pending" | "processing" | "completed" | "error";
    progress: number;
    files: { [key: string]: string };
    pendingDiffs: { path: string; diff: string }[];
    error?: string;
    createdAt: Date;
    updatedAt: Date;
  }
>();

// Generate unique session ID using cryptographically secure random generation
function generateSessionId(): string {
  const randomPart = randomBytes(9).toString('hex'); // 18 hex characters
  return `session_${Date.now()}_${randomPart}`;
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[DEBUG] Code API: Incoming request');
  }

  try {
    // Validate content type
    const contentType = request.headers.get('content-type');
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Code API: Content-Type:', contentType);
    }

    if (!contentType || !contentType.includes('application/json')) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[DEBUG] Code API: Invalid content type');
      }
      return NextResponse.json(
        {
          error: "Content-Type must be application/json",
          received: contentType
        },
        { status: 400 }
      );
    }

    let body: any;
    try {
      body = await request.json();
      // Only log minimal information about the request body to avoid sensitive data exposure
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Code API: Request body parsed:', {
          action: body.action,
          hasPrompt: !!body.prompt,
          hasSelectedFiles: !!body.selectedFiles,
          bodyKeys: Object.keys(body)
        });
      }
    } catch (parseError) {
      console.error('[ERROR] Code API: JSON parse error:', parseError instanceof Error ? parseError.message : String(parseError));
      return NextResponse.json(
        {
          error: "Invalid JSON in request body",
          details: parseError instanceof Error ? parseError.message : 'JSON parse error'
        },
        { status: 400 }
      );
    }

    // Validate action field
    const { action } = body;
    if (!action || typeof action !== 'string') {
      console.error('[ERROR] Code API: Invalid action field:', typeof action);
      return NextResponse.json(
        {
          error: "Action is required and must be a string",
          received: {
            action: action ? typeof action : 'undefined',
            type: typeof action
          }
        },
        { status: 400 }
      );
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Code API: Processing action:', action);
    }

    switch (action) {
      case "start_session":
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] Code API: Handling start_session');
        }
        return handleStartSession(body);

      case "get_session_status":
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] Code API: Handling get_session_status');
        }
        return handleGetSessionStatus(body);

      case "apply_diffs":
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] Code API: Handling apply_diffs');
        }
        return handleApplyDiffs(body);

      case "cancel_session":
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] Code API: Handling cancel_session');
        }
        return handleCancelSession(body);

      default:
        console.error('[ERROR] Code API: Unknown action:', action);
        return NextResponse.json(
          {
            error: "Invalid action",
            received: action,
            validActions: ["start_session", "get_session_status", "apply_diffs", "cancel_session"]
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("API Error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 },
    );
  }
}

/**
 * Starts a new code generation session: validates the request body, initializes an EnhancedCodeOrchestrator,
 * stores a session in the in-memory session store, and begins asynchronous processing.
 *
 * @param body - Request payload expected to contain:
 *   - `prompt` (string): non-empty task description to drive generation (required).
 *   - `selectedFiles` (object): mapping of file paths to contents (optional, default {}).
 *   - `rules` (array): rule or hint items to influence generation (optional, default []).
 *   - `mode` (string): one of "streaming", "agentic", "hybrid", or "standard" (optional, defaults to "hybrid" when invalid).
 *   - `context` (object): additional contextual information (optional).
 * @returns On success, a JSON response with `{ success: true, sessionId }`. On validation or internal failure, a JSON error object with an appropriate HTTP status code describing the failure. */
async function handleStartSession(body: any) {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Code API: Validating start_session request');
    }

    // Validate request body structure
    if (!body || typeof body !== 'object') {
      if (process.env.NODE_ENV === 'development') {
        console.error('[DEBUG] Code API: Invalid request body structure');
      }
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const {
      prompt,
      selectedFiles = {},
      rules = [],
      mode = "hybrid",
      context = {},
    } = body;

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Code API: Extracted request fields:', {
        hasPrompt: !!prompt,
        promptType: typeof prompt,
        promptLength: typeof prompt === 'string' ? prompt.length : 'N/A',
        hasSelectedFiles: !!selectedFiles,
        selectedFilesCount: selectedFiles ? Object.keys(selectedFiles).length : 0,
        mode: mode
      });
    }

    // Enhanced validation with detailed error messages
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[DEBUG] Code API: Prompt validation failed:', {
          hasPrompt: !!prompt,
          promptType: typeof prompt,
          promptLength: typeof prompt === 'string' ? prompt.length : 'N/A',
          isTrimmedEmpty: typeof prompt === 'string' ? prompt.trim().length === 0 : false
        });
      }
      return NextResponse.json(
        {
          error: "Prompt is required and must be a non-empty string",
          received: {
            hasPrompt: !!prompt,
            promptType: typeof prompt,
            promptLength: typeof prompt === 'string' ? prompt.length : 'N/A'
          }
        },
        { status: 400 },
      );
    }

    // Validate selectedFiles format
    if (selectedFiles && typeof selectedFiles !== 'object') {
      if (process.env.NODE_ENV === 'development') {
        console.error('[DEBUG] Code API: selectedFiles validation failed:', {
          selectedFilesCount: selectedFiles ? Object.keys(selectedFiles).length : 0,
          type: typeof selectedFiles
        });
      }
      return NextResponse.json(
        {
          error: "selectedFiles must be an object",
          received: {
            selectedFilesCount: selectedFiles ? Object.keys(selectedFiles).length : 0,
            type: typeof selectedFiles
          }
        },
        { status: 400 },
      );
    }

    // Validate rules format
    if (rules && !Array.isArray(rules)) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[DEBUG] Code API: rules validation failed:', {
          rulesCount: Array.isArray(rules) ? rules.length : 'Not an array',
          type: typeof rules,
          isArray: Array.isArray(rules)
        });
      }
      return NextResponse.json(
        {
          error: "rules must be an array",
          received: {
            rulesCount: Array.isArray(rules) ? rules.length : 'Not an array',
            type: typeof rules,
            isArray: Array.isArray(rules)
          }
        },
        { status: 400 },
      );
    }

    // Validate mode - if invalid, default to "hybrid"
    const validModes = ["streaming", "agentic", "hybrid", "standard"];
    let modeAdjusted = false;
    const effectiveMode = validModes.includes(mode) ? mode : "hybrid";
    if (mode && !validModes.includes(mode)) {
      modeAdjusted = true;
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DEBUG] Code API: Invalid mode provided, defaulting to hybrid:', {
          received: mode,
          using: effectiveMode,
          validModes: validModes
        });
      }
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Code API: All validations passed, creating session');
    }

    const sessionId = generateSessionId();

    // Initialize the enhanced code orchestrator with error handling
    let orchestrator: EnhancedCodeOrchestrator;
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Code API: Initializing EnhancedCodeOrchestrator');
      }

      const config = getOrchestratorConfig(effectiveMode as "streaming" | "agentic" | "hybrid" | "standard");

      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Code API: Using config:', { mode: config.mode });
      }
      orchestrator = new EnhancedCodeOrchestrator(config);
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Code API: EnhancedCodeOrchestrator initialized successfully');
      }
    } catch (initError) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Failed to initialize EnhancedCodeOrchestrator:", initError);
        console.error("Error details:", {
          message: initError instanceof Error ? initError.message : 'Unknown error',
          stack: initError instanceof Error ? initError.stack : 'No stack trace'
        });
      }
      return NextResponse.json(
        {
          error: "Failed to initialize code orchestrator",
          details: initError instanceof Error ? initError.message : 'Unknown error during initialization'
        },
        { status: 500 },
      );
    }

    // Create session record with real orchestrator
    const session = {
      orchestrator,
      status: "pending" as const,
      progress: 0,
      files: selectedFiles,
      pendingDiffs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    activeSessions.set(sessionId, session);

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] Code API: Starting async processing for session:', sessionId);
    }
    // Start processing asynchronously
    processSessionAsync(sessionId, prompt, selectedFiles, rules, context);

    // Prepare response with mode adjustment info if needed
    const responsePayload: any = {
      success: true,
      sessionId,
    };

    if (modeAdjusted) {
      responsePayload.warning = {
        message: "Invalid mode provided, defaulted to hybrid mode",
        originalMode: mode,
        effectiveMode: effectiveMode,
        validModes: validModes
      };
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error("Error starting session:", error);
    }
    return NextResponse.json(
      { error: "Failed to start session" },
      { status: 500 },
    );
  }
}

async function handleGetSessionStatus(body: any) {
  try {
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Session ID is required and must be a non-empty string",
          received: {
            sessionId: sessionId,
            type: typeof sessionId
          }
        },
        { status: 400 },
      );
    }

    const session = activeSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      session: {
        id: sessionId,
        status: session.status,
        progress: session.progress,
        files: session.files,
        pendingDiffs: session.pendingDiffs,
        error: session.error,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error getting session status:", error);
    return NextResponse.json(
      { error: "Failed to get session status" },
      { status: 500 },
    );
  }
}

async function handleApplyDiffs(body: any) {
  try {
    const { sessionId, diffPaths } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Session ID is required and must be a non-empty string",
          received: {
            sessionId: sessionId,
            type: typeof sessionId
          }
        },
        { status: 400 },
      );
    }

    if (diffPaths && !Array.isArray(diffPaths)) {
      return NextResponse.json(
        { 
          error: "diffPaths must be an array if provided",
          received: {
            diffPaths: diffPaths,
            type: typeof diffPaths
          }
        },
        { status: 400 },
      );
    }

    const session = activeSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Apply the diffs using the orchestrator
    const diffsToApply = diffPaths
      ? session.pendingDiffs.filter((diff) => diffPaths.includes(diff.path))
      : session.pendingDiffs;

    // Integrate with the AdvancedFileManager to apply diffs
    try {
      // Create file manager instance
      const fileManager = new AdvancedFileManager({
        autoSaveInterval: 30000,
        maxHistoryEntries: 100,
        enableRealTimeSync: true,
        enableSyntaxValidation: true,
        enableAutoBackup: true,
        enableConflictDetection: true,
        enableRollback: true,
        maxBackupHistory: 10,
        validationTimeout: 5000,
        conflictResolutionStrategy: 'hybrid',
        enableErrorRecovery: true,
        enableAutoWorkflows: true,
        contextWindowSize: 32000,
        chunkSize: 1000,
        maxTokens: 32000,
        enablePartialValidation: true,
        progressUpdateInterval: 500,
        timeoutMs: 60000,
        retryAttempts: 3,
        streamingStrategy: 'semantic_chunks',
      });

      // Apply diffs using the file manager
      for (const diff of diffsToApply) {
        // Register file with file manager
        const fileState: FileState = {
          id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: diff.path.split('/').pop() || diff.path,
          path: diff.path,
          content: session.files[diff.path] || '',
          language: detectLanguageFromPath(diff.path),
          hasEdits: true,
          lastModified: new Date(),
          version: 1,
          originalContent: session.files[diff.path] || '',
          pendingDiffs: [diff],
          changeHistory: [],
          isLocked: false,
          metadata: {},
        };

        await fileManager.registerFile(fileState);

        // Apply the diff with validation
        const result = await fileManager.safelyApplyDiffs(
          fileState.id,
          fileState.content,
          [diff],
          fileState,
          {
            enableSyntaxValidation: true,
            enableConflictDetection: true,
            enableAutoBackup: true,
            enableRollback: true,
            maxBackupHistory: 5,
            validationTimeout: 3000,
            conflictResolutionStrategy: 'hybrid',
            enableErrorRecovery: true,
          }
        );

        if (result.success) {
          // Update session with applied content
          session.files[diff.path] = result.updatedContent;
          console.log(`Successfully applied diff for ${diff.path}`);
        } else {
          console.error(`Failed to apply diff for ${diff.path}:`, result.errors);
          session.errors = session.errors || [];
          session.errors.push(...result.errors);
        }
      }
    } catch (error) {
      console.error('File manager diff application failed:', error);
      session.errors = session.errors || [];
      session.errors.push(`File manager error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Remove applied diffs
    session.pendingDiffs = session.pendingDiffs.filter(
      (diff) => !diffsToApply.some((applied) => applied.path === diff.path),
    );

    session.updatedAt = new Date();

    return NextResponse.json({
      success: true,
      appliedCount: diffsToApply.length,
    });
  } catch (error) {
    console.error("Error applying diffs:", error);
    return NextResponse.json(
      { error: "Failed to apply diffs" },
      { status: 500 },
    );
  }
}

async function handleCancelSession(body: any) {
  try {
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Session ID is required and must be a non-empty string",
          received: {
            sessionId: sessionId,
            type: typeof sessionId
          }
        },
        { status: 400 },
      );
    }

    const session = activeSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Cancel the orchestrator processing
    // This would depend on the orchestrator having a cancel method
    session.status = "error";
    session.error = "Cancelled by user";
    session.updatedAt = new Date();

    // Remove from active sessions after a delay to allow status check
    setTimeout(() => {
      activeSessions.delete(sessionId);
    }, 5000);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error canceling session:", error);
    return NextResponse.json(
      { error: "Failed to cancel session" },
      { status: 500 },
    );
  }
}

async function processSessionAsync(
  sessionId: string,
  prompt: string,
  selectedFiles: { [key: string]: string },
  rules: string[],
  context: any,
) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  try {
    session.status = "processing";
    session.progress = 10;
    session.updatedAt = new Date();

    // Use the orchestrator from the session
    const orchestrator = session.orchestrator;

    // Convert selectedFiles to ProjectItem array for orchestrator
    const projectFiles: ProjectItem[] = Object.entries(selectedFiles).map(([path, content]) => ({
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: path.split('/').pop() || path,
      path,
      content,
      language: detectLanguageFromPath(path),
      hasEdits: content.length > 0,
      lastModified: new Date(),
    }));

    // Start orchestrator session
    const requestId = await orchestrator.startSession({
      id: sessionId,
      task: prompt,
      files: projectFiles,
      options: {
        mode: "hybrid",
        priority: "medium",
        expectedOutputSize: 8000,
        contextHints: rules,
        requireApproval: true,
        enableDiffs: true,
        timeoutMs: 120000,
        qualityThreshold: 0.8,
      },
    });

    // Track session progress
    orchestrator.on('session_progress', (progress) => {
      session.progress = Math.min(95, Math.max(10, progress.progressPercentage || session.progress));
      session.updatedAt = new Date();
    });

    // Wait for session completion
    const result = await new Promise<{ success: boolean; response?: any; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: "Session timeout after 120 seconds" });
      }, 120000);

      orchestrator.on('session_completed', (data) => {
        clearTimeout(timeout);
        resolve({ success: true, response: data });
      });

      orchestrator.on('session_failed', (data) => {
        clearTimeout(timeout);
        resolve({ success: false, error: data.error });
      });
    });

    if (result.success && result.response) {
      // Process successful response
      const response = result.response;
      
      // Extract generated files from response
      const generatedFiles: { [key: string]: string } = {};
      
      if (response.file_context?.content) {
        const fileName = response.file_context.file_name || "generated-code.ts";
        generatedFiles[fileName] = response.file_context.content;
      }
      
      // Add any additional files from diffs
      if (response.diffs && response.diffs.length > 0) {
        for (const diff of response.diffs) {
          if (diff.content) {
            const diffFileName = `modified-${Date.now()}.ts`;
            generatedFiles[diffFileName] = diff.content;
          }
        }
      }
      
      session.files = { ...session.files, ...generatedFiles };
      session.pendingDiffs = response.diffs || [];
      
      session.progress = 100;
      session.status = "completed";
      session.updatedAt = new Date();
    } else {
      // Handle error case
      session.status = "error";
      session.error = result.error || "Unknown error during code generation";
      session.updatedAt = new Date();
    }
  } catch (error) {
    console.error(`Error processing session ${sessionId}:`, error);
    session.status = "error";
    session.error = error instanceof Error ? error.message : "Unknown error";
    session.updatedAt = new Date();
  }
}

// Helper function to detect language from file path
function detectLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: { [key: string]: string } = {
    'js': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'tsx': 'tsx',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'json': 'json',
    'md': 'markdown',
    'yml': 'yaml',
    'yaml': 'yaml',
    'xml': 'xml',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'dart': 'dart',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  return langMap[ext || ''] || 'text';
}

// Cleanup old sessions periodically
setInterval(
  () => {
    const now = new Date();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of activeSessions.entries()) {
      if (now.getTime() - session.createdAt.getTime() > maxAge) {
        activeSessions.delete(sessionId);
      }
    }
  },
  5 * 60 * 1000,
); // Run every 5 minutes