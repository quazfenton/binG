/**
 * Code Mode Integration Layer
 * 
 * This service acts as a bridge between the code-mode.tsx component and the 
 * enhanced-code-orchestrator.ts, providing session management, request/response 
 * mapping, and unified error handling for code operations.
 */

import { EventEmitter } from 'events';
import { CodeModeErrorHandler, CodeModeError } from './code-mode-error-handler';
import { codeRequestDeduplicator } from '../utils/request-deduplicator';

// Import the actual enhanced code orchestrator
import { EnhancedCodeOrchestrator } from '../../enhanced-code-system/enhanced-code-orchestrator';

// Types for code mode integration
export interface CodeModeSession {
  id: string;
  orchestratorSessionId: string;
  status: 'initializing' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  lastActivity: Date;
  files: CodeModeFile[];
  pendingDiffs: CodeModeDiff[];
  error?: string;
}

export interface CodeModeFile {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  hasEdits: boolean;
  lastModified: Date;
}

export interface CodeModeDiff {
  type: 'add' | 'remove' | 'modify';
  lineStart: number;
  lineEnd?: number;
  content: string;
  originalContent?: string;
  confidence?: number;
}

export interface CodeModeRequest {
  type: 'read_file' | 'write_diff' | 'list_files' | 'create_file' | 'delete_file';
  files?: string[];
  diffs?: { [filePath: string]: CodeModeDiff[] };
  content?: string;
  path?: string;
  task?: string;
  rules?: string;
}

export interface CodeModeResponse {
  type: 'file_content' | 'diff_preview' | 'file_list' | 'confirmation' | 'error';
  files?: { [path: string]: string };
  diffs?: { [filePath: string]: CodeModeDiff[] };
  message?: string;
  nextFiles?: string[];
  sessionId?: string;
  success?: boolean;
}

export interface CodeModeConfig {
  maxConcurrentSessions: number;
  sessionTimeoutMs: number;
  enableAutoValidation: boolean;
  enableSafetyChecks: boolean;
  orchestratorConfig?: {
    mode: 'streaming' | 'agentic' | 'hybrid' | 'standard';
    enableStreaming: boolean;
    enableFileManagement: boolean;
    qualityThreshold: number;
  };
}

/**
 * Code Mode Integration Service
 * 
 * Manages the integration between the code mode UI and the enhanced code orchestrator,
 * providing session management, request/response mapping, and error handling.
 */
export class CodeModeIntegrationService extends EventEmitter {
  private orchestrator: EnhancedCodeOrchestrator;
  private sessions: Map<string, CodeModeSession> = new Map();
  private config: CodeModeConfig;
  private sessionCleanupInterval: NodeJS.Timeout;
  private activeRequests: Map<string, Promise<any>> = new Map();

  constructor(config?: Partial<CodeModeConfig>) {
    super();
    
    this.config = {
      maxConcurrentSessions: 5,
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
      enableAutoValidation: true,
      enableSafetyChecks: true,
      orchestratorConfig: {
        mode: 'hybrid',
        enableStreaming: true,
        enableFileManagement: true,
        qualityThreshold: 0.8,
      },
      ...config,
    };

    // Initialize the enhanced code orchestrator
    this.orchestrator = new EnhancedCodeOrchestrator({
      mode: this.config.orchestratorConfig?.mode || 'hybrid',
      enableStreaming: this.config.orchestratorConfig?.enableStreaming ?? true,
      enableFileManagement: this.config.orchestratorConfig?.enableFileManagement ?? true,
      qualityThreshold: this.config.orchestratorConfig?.qualityThreshold || 0.8,
      maxConcurrentSessions: this.config.maxConcurrentSessions,
      defaultTimeoutMs: this.config.sessionTimeoutMs,
    });

    // Set up orchestrator event listeners
    this.setupOrchestratorEventHandlers();

    // Set up session cleanup
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Create a new code mode session with duplicate prevention
   */
  async createSession(files: CodeModeFile[]): Promise<string> {
    try {
      // Check session limits
      const activeSessions = Array.from(this.sessions.values()).filter(
        s => ['initializing', 'processing'].includes(s.status)
      );

      if (activeSessions.length >= this.config.maxConcurrentSessions) {
        throw CodeModeErrorHandler.createError('SESSION_LIMIT_EXCEEDED');
      }

      // Create session fingerprint to prevent duplicates
      const filesHash = this.hashFiles(files);
      const sessionKey = `session_${filesHash}`;
      
      // Check if identical session already exists
      const existingSession = Array.from(this.sessions.values()).find(
        s => s.status !== 'failed' && s.status !== 'cancelled' && 
        this.hashFiles(s.files) === filesHash
      );

      if (existingSession) {
        console.log('Reusing existing session:', existingSession.id);
        return existingSession.id;
      }

      const sessionId = `code_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const session: CodeModeSession = {
        id: sessionId,
        orchestratorSessionId: '',
        status: 'initializing',
        createdAt: new Date(),
        lastActivity: new Date(),
        files: [...files],
        pendingDiffs: [],
      };

      this.sessions.set(sessionId, session);

      this.emit('session_created', { sessionId, fileCount: files.length });

      return sessionId;
    } catch (error) {
      const codeModeError = CodeModeErrorHandler.handleError(error);
      CodeModeErrorHandler.logError(codeModeError);
      throw codeModeError;
    }
  }

  /**
   * Create a hash of files for deduplication
   */
  private hashFiles(files: CodeModeFile[]): string {
    const fileData = files.map(f => `${f.path}:${f.content.length}`).sort().join('|');
    let hash = 0;
    for (let i = 0; i < fileData.length; i++) {
      const char = fileData.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Process a code mode request with deduplication
   */
  async processRequest(sessionId: string, request: CodeModeRequest): Promise<CodeModeResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = CodeModeErrorHandler.createError('SESSION_NOT_FOUND', undefined, sessionId);
      CodeModeErrorHandler.logError(error);
      throw error;
    }

    // Create request fingerprint for deduplication
    const requestKey = `${sessionId}-${request.type}-${JSON.stringify(request.data)}`;
    
    // Check if identical request is already in progress
    if (this.activeRequests.has(requestKey)) {
      console.log('Deduplicating code mode request:', requestKey);
      return this.activeRequests.get(requestKey)!;
    }

    session.lastActivity = new Date();
    session.status = 'processing';

    // Create the request promise
    const requestPromise = this.executeRequest(session, request);
    
    // Track the active request
    this.activeRequests.set(requestKey, requestPromise);
    
    // Clean up when request completes
    requestPromise.finally(() => {
      this.activeRequests.delete(requestKey);
    });

    return requestPromise;
  }

  /**
   * Execute the actual request
   */
  private async executeRequest(session: CodeModeSession, request: CodeModeRequest): Promise<CodeModeResponse> {
    try {
      switch (request.type) {
        case 'read_file':
          return await this.handleReadFileRequest(session, request);
        
        case 'write_diff':
          return await this.handleWriteDiffRequest(session, request);
        
        case 'list_files':
          return await this.handleListFilesRequest(session, request);
        
        case 'create_file':
          return await this.handleCreateFileRequest(session, request);
        
        case 'delete_file':
          return await this.handleDeleteFileRequest(session, request);
        
        default:
          throw CodeModeErrorHandler.createError('INVALID_REQUEST', `Unsupported request type: ${request.type}`, session.id);
      }
    } catch (error) {
      session.status = 'failed';
      const codeModeError = error instanceof CodeModeError ? error : CodeModeErrorHandler.handleError(error, sessionId);
      session.error = codeModeError.message;
      
      this.emit('session_error', { sessionId, error: codeModeError.message });
      
      return {
        type: 'error',
        message: codeModeError.userMessage,
        sessionId,
        success: false,
      };
    }
  }

  /**
   * Execute a code generation task using the orchestrator
   */
  async executeCodeTask(
    sessionId: string, 
    task: string, 
    rules?: string,
    selectedFiles?: string[]
  ): Promise<CodeModeResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = CodeModeErrorHandler.createError('SESSION_NOT_FOUND', undefined, sessionId);
      CodeModeErrorHandler.logError(error);
      throw error;
    }

    // Check if session is already processing to prevent duplicate requests
    if (session.status === 'processing') {
      throw CodeModeErrorHandler.createError('INVALID_REQUEST', 'Session is already processing a request', sessionId);
    }

    session.status = 'processing';
    session.lastActivity = new Date();

    // Set up timeout for the entire operation
    const timeoutMs = this.config.sessionTimeoutMs || 120000; // 2 minutes default
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        session.status = 'failed';
        session.error = 'Request timed out';
        reject(CodeModeErrorHandler.createError('TIMEOUT_ERROR', 'Code task execution timed out', sessionId));
      }, timeoutMs);
    });

    try {
      // Prepare files for orchestrator
      const filesToProcess = selectedFiles 
        ? session.files.filter(f => selectedFiles.includes(f.path))
        : session.files;

      if (filesToProcess.length === 0) {
        throw CodeModeErrorHandler.createError('INVALID_REQUEST', 'No files selected for processing', sessionId);
      }

      const orchestratorFiles = filesToProcess.map(file => ({
        id: file.id,
        name: file.name,
        path: file.path,
        content: file.content,
        language: file.language,
        hasEdits: file.hasEdits,
        lastModified: file.lastModified,
      }));

      // Race between orchestrator execution and timeout
      const result = await Promise.race([
        this.executeOrchestratorTask(session, task, orchestratorFiles, rules),
        timeoutPromise
      ]);

      session.status = 'completed';
      session.lastActivity = new Date();

      return result;

    } catch (error) {
      session.status = 'failed';
      const codeModeError = error instanceof CodeModeError ? error : CodeModeErrorHandler.handleError(error, sessionId);
      session.error = codeModeError.message;
      
      this.emit('session_error', { sessionId, error: codeModeError.message });
      
      return {
        type: 'error',
        message: codeModeError.userMessage,
        sessionId,
        success: false,
      };
    }
  }

  /**
   * Execute orchestrator task with proper error handling
   */
  private async executeOrchestratorTask(
    session: CodeModeSession,
    task: string,
    files: any[],
    rules?: string
  ): Promise<CodeModeResponse> {
    try {
      // Prepare request for orchestrator
      const orchestratorRequest = {
        id: `request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        task,
        files: files.map(file => ({
          id: file.id,
          name: file.name,
          path: file.path,
          content: file.content,
          language: file.language,
          hasEdits: file.hasEdits,
          lastModified: file.lastModified,
        })),
        options: {
          mode: this.config.orchestratorConfig?.mode,
          requireApproval: true,
          enableDiffs: true,
          contextHints: rules ? [rules] : [],
          priority: 'medium' as const,
          timeoutMs: this.config.sessionTimeoutMs,
          qualityThreshold: this.config.orchestratorConfig?.qualityThreshold,
        },
      };

      // Start orchestrator session
      const orchestratorSessionId = await this.orchestrator.startSession(orchestratorRequest);
      session.orchestratorSessionId = orchestratorSessionId;

      // Set up event listeners for orchestrator progress
      const progressHandler = (data: any) => {
        if (data.sessionId === orchestratorSessionId) {
          this.emit('session_progress', { 
            sessionId: session.id, 
            progress: data.progress,
            currentStep: data.currentStep 
          });
        }
      };

      const completedHandler = (data: any) => {
        if (data.sessionId === orchestratorSessionId) {
          this.orchestrator.off('session_progress', progressHandler);
          this.orchestrator.off('session_completed', completedHandler);
          this.orchestrator.off('session_failed', failedHandler);
        }
      };

      const failedHandler = (data: any) => {
        if (data.sessionId === orchestratorSessionId) {
          this.orchestrator.off('session_progress', progressHandler);
          this.orchestrator.off('session_completed', completedHandler);
          this.orchestrator.off('session_failed', failedHandler);
        }
      };

      this.orchestrator.on('session_progress', progressHandler);
      this.orchestrator.on('session_completed', completedHandler);
      this.orchestrator.on('session_failed', failedHandler);

      // Wait for orchestrator completion with timeout
      const result = await this.waitForOrchestratorCompletion(orchestratorSessionId, session.id);

      // Convert orchestrator response to CodeModeResponse
      return this.convertOrchestratorResponse(result, session.id);

    } catch (error) {
      // Cancel orchestrator session if it was started
      if (session.orchestratorSessionId) {
        try {
          await this.orchestrator.cancelSession(session.orchestratorSessionId);
        } catch (cancelError) {
          console.warn('Failed to cancel orchestrator session:', cancelError);
        }
      }
      throw error;
    }
  }

  /**
   * Wait for orchestrator completion
   */
  private async waitForOrchestratorCompletion(
    orchestratorSessionId: string, 
    sessionId: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Orchestrator session timed out'));
      }, this.config.sessionTimeoutMs);

      const completedHandler = (data: any) => {
        if (data.sessionId === orchestratorSessionId) {
          clearTimeout(timeout);
          this.orchestrator.off('session_completed', completedHandler);
          this.orchestrator.off('session_failed', failedHandler);
          resolve(data);
        }
      };

      const failedHandler = (data: any) => {
        if (data.sessionId === orchestratorSessionId) {
          clearTimeout(timeout);
          this.orchestrator.off('session_completed', completedHandler);
          this.orchestrator.off('session_failed', failedHandler);
          reject(new Error(data.error || 'Orchestrator session failed'));
        }
      };

      this.orchestrator.on('session_completed', completedHandler);
      this.orchestrator.on('session_failed', failedHandler);
    });
  }

  /**
   * Convert orchestrator response to CodeModeResponse
   */
  private convertOrchestratorResponse(orchestratorResult: any, sessionId: string): CodeModeResponse {
    try {
      const { results } = orchestratorResult;
      
      if (!results || !results.responses || results.responses.length === 0) {
        return {
          type: 'error',
          message: 'No response from orchestrator',
          sessionId,
          success: false,
        };
      }

      const response = results.responses[0]; // Use the first/primary response
      const diffs: { [filePath: string]: CodeModeDiff[] } = {};

      // Convert orchestrator diffs to CodeModeDiff format
      if (response.diffs && response.diffs.length > 0) {
        const filePath = response.file_context?.file_name || 'unknown';
        diffs[filePath] = response.diffs.map((diff: any) => ({
          type: diff.type,
          lineStart: diff.lineRange[0],
          lineEnd: diff.lineRange[1],
          content: diff.newContent,
          originalContent: diff.originalContent,
          confidence: diff.confidence,
        }));
      }

      return {
        type: 'diff_preview',
        diffs,
        message: 'Code changes generated successfully by enhanced orchestrator',
        nextFiles: response.next_file_request ? [response.next_file_request] : undefined,
        sessionId,
        success: true,
      };

    } catch (error) {
      console.error('Failed to convert orchestrator response:', error);
      return {
        type: 'error',
        message: 'Failed to process orchestrator response',
        sessionId,
        success: false,
      };
    }
  }

  /**
   * Apply pending diffs to session files
   */
  async applyDiffs(sessionId: string, diffs: { [filePath: string]: CodeModeDiff[] }): Promise<CodeModeResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = CodeModeErrorHandler.createError('SESSION_NOT_FOUND', undefined, sessionId);
      CodeModeErrorHandler.logError(error);
      throw error;
    }

    session.lastActivity = new Date();

    try {
      const appliedFiles: { [path: string]: string } = {};
      const errors: string[] = [];

      for (const [filePath, fileDiffs] of Object.entries(diffs)) {
        const file = session.files.find(f => f.path === filePath);
        if (!file) {
          errors.push(`File not found: ${filePath}`);
          continue;
        }

        // Apply diffs with safety checks
        const result = await this.applyDiffsToFile(file, fileDiffs);
        if (result.success) {
          file.content = result.content!;
          file.hasEdits = true;
          file.lastModified = new Date();
          appliedFiles[filePath] = result.content!;
        } else {
          errors.push(`Failed to apply diffs to ${filePath}: ${result.error}`);
        }
      }

      // Clear pending diffs for successfully applied files
      session.pendingDiffs = session.pendingDiffs.filter(
        diff => !Object.keys(appliedFiles).some(path => 
          session.files.find(f => f.path === path)
        )
      );

      session.status = errors.length === 0 ? 'completed' : 'failed';

      this.emit('diffs_applied', { 
        sessionId, 
        appliedFiles: Object.keys(appliedFiles),
        errors 
      });

      return {
        type: 'confirmation',
        message: errors.length === 0 
          ? `Successfully applied diffs to ${Object.keys(appliedFiles).length} files`
          : `Applied diffs with ${errors.length} errors`,
        files: appliedFiles,
        sessionId,
        success: errors.length === 0,
      };

    } catch (error) {
      session.status = 'failed';
      const codeModeError = error instanceof CodeModeError ? error : CodeModeErrorHandler.handleError(error, sessionId);
      session.error = codeModeError.message;
      
      return {
        type: 'error',
        message: codeModeError.userMessage,
        sessionId,
        success: false,
      };
    }
  }

  /**
   * Get session status and information
   */
  getSessionInfo(sessionId: string): CodeModeSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get orchestrator session status
   */
  getOrchestratorSessionInfo(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session || !session.orchestratorSessionId) {
      return null;
    }

    // In a real implementation, this would query the orchestrator for session info
    // For now, return basic session information
    return {
      orchestratorSessionId: session.orchestratorSessionId,
      status: session.status,
      lastActivity: session.lastActivity,
    };
  }

  /**
   * Update session files and sync with orchestrator
   */
  async updateSessionFiles(sessionId: string, files: CodeModeFile[]): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.files = [...files];
    session.lastActivity = new Date();

    // If orchestrator session is active, update it with new files
    if (session.orchestratorSessionId && session.status === 'processing') {
      try {
        // In a real implementation, this would update the orchestrator session
        // For now, just log the update
        console.log(`Updated orchestrator session ${session.orchestratorSessionId} with ${files.length} files`);
      } catch (error) {
        console.warn('Failed to update orchestrator session files:', error);
        return false;
      }
    }

    return true;
  }

  /**
   * Cancel a session
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const previousStatus = session.status;
    session.status = 'cancelled';
    session.lastActivity = new Date();

    // Cancel orchestrator session if active
    if (session.orchestratorSessionId) {
      try {
        // Set timeout for cancellation to prevent hanging
        const cancelTimeout = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn('Orchestrator cancellation timed out, forcing session cleanup');
            resolve();
          }, 5000); // 5 second timeout for cancellation
        });

        await Promise.race([
          this.orchestrator.cancelSession(session.orchestratorSessionId),
          cancelTimeout
        ]);
      } catch (error) {
        console.warn(`Failed to cancel orchestrator session: ${error}`);
      }
    }

    // Clear any pending operations
    session.pendingDiffs = [];
    session.error = undefined;

    this.emit('session_cancelled', { 
      sessionId, 
      previousStatus,
      forced: previousStatus === 'processing' 
    });
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }

    // Cancel all active sessions
    Array.from(this.sessions.keys()).forEach(sessionId => {
      this.cancelSession(sessionId).catch(console.error);
    });

    // Clear active requests
    this.activeRequests.clear();

    this.sessions.clear();
    this.removeAllListeners();

    // Clean up orchestrator
    if (this.orchestrator) {
      this.orchestrator.removeAllListeners();
    }
  }

  // Private methods

  private setupOrchestratorEventHandlers(): void {
    this.orchestrator.on('session_started', (data) => {
      const session = this.findSessionByOrchestratorId(data.sessionId);
      if (session) {
        session.status = 'processing';
        session.lastActivity = new Date();
        this.emit('session_started', { sessionId: session.id, data });
      }
    });

    this.orchestrator.on('session_completed', (data) => {
      const session = this.findSessionByOrchestratorId(data.sessionId);
      if (session) {
        session.status = 'completed';
        session.lastActivity = new Date();
        this.emit('orchestrator_completed', { sessionId: session.id, data });
      }
    });

    this.orchestrator.on('session_failed', (data) => {
      const session = this.findSessionByOrchestratorId(data.sessionId);
      if (session) {
        session.status = 'failed';
        session.error = data.error;
        session.lastActivity = new Date();
        this.emit('orchestrator_failed', { sessionId: session.id, error: data.error });
      }
    });

    this.orchestrator.on('session_progress', (data) => {
      const session = this.findSessionByOrchestratorId(data.sessionId);
      if (session) {
        session.lastActivity = new Date();
        this.emit('session_progress', { sessionId: session.id, progress: data });
      }
    });

    this.orchestrator.on('session_cancelled', (data) => {
      const session = this.findSessionByOrchestratorId(data.sessionId);
      if (session) {
        session.status = 'cancelled';
        session.lastActivity = new Date();
        this.emit('session_cancelled', { sessionId: session.id });
      }
    });
  }

  private findSessionByOrchestratorId(orchestratorSessionId: string): CodeModeSession | null {
    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      if (session.orchestratorSessionId === orchestratorSessionId) {
        return session;
      }
    }
    return null;
  }

  private async handleReadFileRequest(session: CodeModeSession, request: CodeModeRequest): Promise<CodeModeResponse> {
    const files: { [path: string]: string } = {};
    
    if (request.files) {
      for (const filePath of request.files) {
        const file = session.files.find(f => f.path === filePath);
        if (file) {
          files[filePath] = file.content;
        }
      }
    }

    return {
      type: 'file_content',
      files,
      sessionId: session.id,
      success: true,
    };
  }

  private async handleWriteDiffRequest(session: CodeModeSession, request: CodeModeRequest): Promise<CodeModeResponse> {
    if (!request.diffs) {
      throw CodeModeErrorHandler.createError('INVALID_REQUEST', 'No diffs provided for write_diff request', session.id);
    }

    // Store diffs as pending for user approval
    for (const [filePath, diffs] of Object.entries(request.diffs)) {
      session.pendingDiffs.push(...diffs);
    }

    return {
      type: 'diff_preview',
      diffs: request.diffs,
      message: 'Diffs ready for review and approval',
      sessionId: session.id,
      success: true,
    };
  }

  private async handleListFilesRequest(session: CodeModeSession, request: CodeModeRequest): Promise<CodeModeResponse> {
    const fileList = session.files.map(f => f.path);
    
    return {
      type: 'file_list',
      nextFiles: fileList,
      message: `Found ${fileList.length} files`,
      sessionId: session.id,
      success: true,
    };
  }

  private async handleCreateFileRequest(session: CodeModeSession, request: CodeModeRequest): Promise<CodeModeResponse> {
    if (!request.path || !request.content) {
      throw CodeModeErrorHandler.createError('INVALID_REQUEST', 'Path and content required for create_file request', session.id);
    }

    // Check if file already exists
    const existingFile = session.files.find(f => f.path === request.path);
    if (existingFile) {
      throw CodeModeErrorHandler.createError('INVALID_REQUEST', `File already exists: ${request.path}`, session.id);
    }

    // Create new file
    const newFile: CodeModeFile = {
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: request.path.split('/').pop() || request.path,
      path: request.path,
      content: request.content,
      language: this.getLanguageFromPath(request.path),
      hasEdits: true,
      lastModified: new Date(),
    };

    session.files.push(newFile);

    return {
      type: 'confirmation',
      message: `File created: ${request.path}`,
      files: { [request.path]: request.content },
      sessionId: session.id,
      success: true,
    };
  }

  private async handleDeleteFileRequest(session: CodeModeSession, request: CodeModeRequest): Promise<CodeModeResponse> {
    if (!request.path) {
      throw CodeModeErrorHandler.createError('INVALID_REQUEST', 'Path required for delete_file request', session.id);
    }

    const fileIndex = session.files.findIndex(f => f.path === request.path);
    if (fileIndex === -1) {
      throw CodeModeErrorHandler.createError('INVALID_REQUEST', `File not found: ${request.path}`, session.id);
    }

    session.files.splice(fileIndex, 1);

    return {
      type: 'confirmation',
      message: `File deleted: ${request.path}`,
      sessionId: session.id,
      success: true,
    };
  }

  private async applyDiffsToFile(file: CodeModeFile, diffs: CodeModeDiff[]): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      // Safety checks if enabled
      if (this.config.enableSafetyChecks) {
        const validationResult = await this.validateDiffs(file, diffs);
        if (!validationResult.valid) {
          return { success: false, error: validationResult.error };
        }
      }

      let content = file.content;
      const lines = content.split('\n');

      // Sort diffs by line number (descending) to avoid index shifting
      const sortedDiffs = [...diffs].sort((a, b) => b.lineStart - a.lineStart);

      for (const diff of sortedDiffs) {
        switch (diff.type) {
          case 'add':
            lines.splice(diff.lineStart, 0, diff.content);
            break;
          case 'remove':
            const removeEnd = diff.lineEnd || diff.lineStart;
            lines.splice(diff.lineStart, removeEnd - diff.lineStart + 1);
            break;
          case 'modify':
            const modifyEnd = diff.lineEnd || diff.lineStart;
            lines.splice(diff.lineStart, modifyEnd - diff.lineStart + 1, diff.content);
            break;
        }
      }

      const newContent = lines.join('\n');

      // Auto-validation if enabled
      if (this.config.enableAutoValidation) {
        const syntaxValid = await this.validateSyntax(file.language, newContent);
        if (!syntaxValid) {
          return { success: false, error: 'Syntax validation failed' };
        }
      }

      return { success: true, content: newContent };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error applying diffs' 
      };
    }
  }

  private async validateDiffs(file: CodeModeFile, diffs: CodeModeDiff[]): Promise<{ valid: boolean; error?: string }> {
    // Basic validation - check line ranges
    const lines = file.content.split('\n');
    
    for (const diff of diffs) {
      if (diff.lineStart < 0 || diff.lineStart >= lines.length) {
        return { valid: false, error: `Invalid line start: ${diff.lineStart}` };
      }
      
      if (diff.lineEnd && (diff.lineEnd < diff.lineStart || diff.lineEnd >= lines.length)) {
        return { valid: false, error: `Invalid line end: ${diff.lineEnd}` };
      }
    }

    return { valid: true };
  }

  private async validateSyntax(language: string, content: string): Promise<boolean> {
    // Basic syntax validation - in a real implementation, this would use language-specific parsers
    try {
      switch (language) {
        case 'javascript':
        case 'typescript':
          // Basic check for balanced braces
          const braces = content.match(/[{}]/g) || [];
          let braceCount = 0;
          for (const brace of braces) {
            braceCount += brace === '{' ? 1 : -1;
            if (braceCount < 0) return false;
          }
          return braceCount === 0;
        
        case 'json':
          JSON.parse(content);
          return true;
        
        default:
          // For other languages, assume valid for now
          return true;
      }
    } catch {
      return false;
    }
  }

  private getLanguageFromPath(path: string): string {
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

  private cleanupExpiredSessions(): void {
    const now = new Date();
    const expiredSessions: string[] = [];

    Array.from(this.sessions.entries()).forEach(([sessionId, session]) => {
      const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();
      if (timeSinceLastActivity > this.config.sessionTimeoutMs) {
        expiredSessions.push(sessionId);
      }
    });

    for (const sessionId of expiredSessions) {
      this.cancelSession(sessionId).catch(console.error);
      this.sessions.delete(sessionId);
      this.emit('session_expired', { sessionId });
    }
  }
}

// Export singleton instance
export const codeModeIntegration = new CodeModeIntegrationService();
