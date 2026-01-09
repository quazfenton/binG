/**
 * Comprehensive Error Types for Enhanced Code System
 * 
 * Defines specific error types for different parts of the system to enable
 * better error handling, recovery, and monitoring.
 */

export interface SystemError extends Error {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;
}

export class OrchestratorError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string, 
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = options.code || 'ORCH_001';
    this.component = 'orchestrator';
    this.severity = options.severity || 'high';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

export class StreamError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'StreamError';
    this.code = options.code || 'STREAM_001';
    this.component = 'streaming';
    this.severity = options.severity || 'medium';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

export class AgenticError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'AgenticError';
    this.code = options.code || 'AGENT_001';
    this.component = 'agentic';
    this.severity = options.severity || 'high';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

export class FileManagementError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'FileManagementError';
    this.code = options.code || 'FILE_001';
    this.component = 'file_management';
    this.severity = options.severity || 'medium';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

export class PromptEngineError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'PromptEngineError';
    this.code = options.code || 'PROMPT_001';
    this.component = 'prompt_engine';
    this.severity = options.severity || 'low';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

export class SafeDiffError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'SafeDiffError';
    this.code = options.code || 'DIFF_001';
    this.component = 'safe_diff_operations';
    this.severity = options.severity || 'high';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

export class LLMError extends Error implements SystemError {
  code: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  timestamp: Date;
  context?: any;
  suggestion?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      recoverable?: boolean;
      context?: any;
      suggestion?: string;
    } = {}
  ) {
    super(message);
    this.name = 'LLMError';
    this.code = options.code || 'LLM_001';
    this.component = 'llm';
    this.severity = options.severity || 'high';
    this.recoverable = options.recoverable ?? true;
    this.timestamp = new Date();
    this.context = options.context;
    this.suggestion = options.suggestion;
  }
}

// Error factory functions for consistency
export const createOrchestratorError = (
  message: string,
  options: Parameters<typeof OrchestratorError>[1] = {}
): OrchestratorError => new OrchestratorError(message, options);

export const createStreamError = (
  message: string,
  options: Parameters<typeof StreamError>[1] = {}
): StreamError => new StreamError(message, options);

export const createAgenticError = (
  message: string,
  options: Parameters<typeof AgenticError>[1] = {}
): AgenticError => new AgenticError(message, options);

export const createFileManagementError = (
  message: string,
  options: Parameters<typeof FileManagementError>[1] = {}
): FileManagementError => new FileManagementError(message, options);

export const createPromptEngineError = (
  message: string,
  options: Parameters<typeof PromptEngineError>[1] = {}
): PromptEngineError => new PromptEngineError(message, options);

export const createSafeDiffError = (
  message: string,
  options: Parameters<typeof SafeDiffError>[1] = {}
): SafeDiffError => new SafeDiffError(message, options);

export const createLLMError = (
  message: string,
  options: Parameters<typeof LLMError>[1] = {}
): LLMError => new LLMError(message, options);

// Error code constants for consistency
export const ERROR_CODES = {
  ORCHESTRATOR: {
    SESSION_NOT_FOUND: 'ORCH_001',
    MAX_CONCURRENT_EXCEEDED: 'ORCH_002',
    INVALID_REQUEST: 'ORCH_003',
    COMPONENT_INIT_FAILED: 'ORCH_004',
    PROCESSING_FAILED: 'ORCH_005',
    RECOVERY_FAILED: 'ORCH_006',
    CONFIG_VALIDATION_FAILED: 'ORCH_007'
  },
  STREAMING: {
    CHUNK_PROCESSING_FAILED: 'STREAM_001',
    CONTEXT_WINDOW_EXCEEDED: 'STREAM_002',
    VALIDATION_FAILED: 'STREAM_003',
    CONNECTION_TIMEOUT: 'STREAM_004',
    ASSEMBLY_FAILED: 'STREAM_005',
    COMPLETION_FAILED: 'STREAM_006'
  },
  AGENTIC: {
    FRAMEWORK_NOT_CONFIGURED: 'AGENT_001',
    COLLABORATION_FAILED: 'AGENT_002',
    QUALITY_THRESHOLD_FAILED: 'AGENT_003',
    ITERATION_LIMIT_EXCEEDED: 'AGENT_004',
    VALIDATION_FAILED: 'AGENT_005',
    FEEDBACK_APPLICATION_FAILED: 'AGENT_006'
  },
  FILE_MANAGEMENT: {
    FILE_NOT_FOUND: 'FILE_001',
    ACCESS_DENIED: 'FILE_002',
    DIFF_APPLICATION_FAILED: 'FILE_003',
    VALIDATION_FAILED: 'FILE_004',
    CONFLICT_DETECTION_FAILED: 'FILE_005',
    BACKUP_CREATION_FAILED: 'FILE_006',
    ROLLBACK_FAILED: 'FILE_007'
  },
  PROMPT_ENGINE: {
    PROMPT_GENERATION_FAILED: 'PROMPT_001',
    RESPONSE_PROCESSING_FAILED: 'PROMPT_002',
    SYNTAX_VALIDATION_FAILED: 'PROMPT_003',
    CONTEXT_BUILDING_FAILED: 'PROMPT_004'
  },
  SAFE_DIFF: {
    PRE_VALIDATION_FAILED: 'DIFF_001',
    CONFLICT_DETECTED: 'DIFF_002',
    ROLLBACK_FAILED: 'DIFF_003',
    BACKUP_FAILED: 'DIFF_004',
    SYNTAX_VALIDATION_FAILED: 'DIFF_005',
    CHANGE_TRACKING_FAILED: 'DIFF_006'
  },
  LLM: {
    REQUEST_FAILED: 'LLM_001',
    UNSUPPORTED_PROVIDER: 'LLM_002',
    INVALID_MODEL: 'LLM_003',
    AUTHENTICATION_FAILED: 'LLM_004',
    RATE_LIMIT_EXCEEDED: 'LLM_005',
    TIMEOUT: 'LLM_006',
    NETWORK_ERROR: 'LLM_007',
    RESPONSE_PARSING_FAILED: 'LLM_008',
    PROVIDER_UNAVAILABLE: 'LLM_009'
  }
} as const;