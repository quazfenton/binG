/**
 * Kilocode Types and Interfaces
 *
 * Type definitions for the Kilocode AI coding assistant server,
 * including request/response formats, configuration options,
 * and integration interfaces.
 */

export interface KilocodeConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** API key for authentication */
  apiKey?: string;
  /** Maximum requests per hour */
  maxRequestsPerHour: number;
  /** Enable streaming responses */
  enableStreaming: boolean;
  /** Supported programming languages */
  supportedLanguages: string[];
  /** AI model endpoints */
  modelEndpoints: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Enable CORS */
  enableCors?: boolean;
  /** Trusted origins for CORS */
  trustedOrigins?: string[];
}

export interface CodeGenerationRequest {
  /** Natural language prompt describing desired code */
  prompt: string;
  /** Target programming language */
  language: string;
  /** Code context for better generation */
  context?: {
    /** Related files for context */
    files?: Array<{ name: string; content: string }>;
    /** Cursor position for completion */
    cursor?: { line: number; column: number };
    /** Selected text range */
    selection?: { start: number; end: number };
  };
  /** Generation options */
  options?: {
    /** Sampling temperature (0-2) */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Code style preference */
    style?: 'concise' | 'verbose' | 'documented';
    /** Target framework/library */
    framework?: string;
    /** Include tests */
    includeTests?: boolean;
    /** Include documentation */
    includeDocs?: boolean;
  };
}

export interface CodeCompletionRequest extends Omit<CodeGenerationRequest, 'prompt'> {
  /** Current code prefix */
  prefix: string;
  /** Current code suffix (after cursor) */
  suffix?: string;
  /** Completion trigger character */
  trigger?: string;
}

export interface CodeAnalysisRequest {
  /** Code to analyze */
  code: string;
  /** Programming language */
  language: string;
  /** Type of analysis to perform */
  analysisType: 'lint' | 'format' | 'refactor' | 'optimize' | 'explain' | 'review';
  /** Analysis-specific options */
  options?: Record<string, any>;
}

export interface CodeRefactorRequest extends CodeAnalysisRequest {
  /** Specific refactoring operation */
  refactorType: 'extract-method' | 'rename-variable' | 'simplify-condition' | 'add-error-handling' | 'optimize-performance';
  /** Selection range for refactoring */
  selection?: { start: number; end: number };
}

export interface CodeReviewRequest {
  /** Code to review */
  code: string;
  /** Programming language */
  language: string;
  /** Review focus areas */
  focus?: ('security' | 'performance' | 'maintainability' | 'best-practices')[];
  /** Code context */
  context?: {
    /** Related files */
    files?: Array<{ name: string; content: string }>;
    /** Project structure */
    projectType?: string;
    /** Target environment */
    environment?: 'web' | 'server' | 'mobile' | 'desktop';
  };
}

export interface KilocodeResponse<T = any> {
  /** Success status */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error message (if success is false) */
  error?: string;
  /** Response metadata */
  metadata?: {
    /** AI model used */
    model: string;
    /** Tokens consumed */
    tokens: number;
    /** Processing time in milliseconds */
    processingTime: number;
    /** Request ID for tracking */
    requestId: string;
  };
}

export interface StreamingResponse {
  /** Response chunk */
  chunk?: string;
  /** Completion signal */
  done?: boolean;
  /** Error information */
  error?: string;
  /** Progress information */
  progress?: {
    /** Current step */
    step: string;
    /** Progress percentage (0-100) */
    percentage: number;
  };
}

export interface CodeSuggestion {
  /** Suggested code */
  code: string;
  /** Explanation of the suggestion */
  explanation: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Suggestion category */
  category: 'completion' | 'correction' | 'optimization' | 'enhancement';
  /** Affected code range */
  range?: { start: number; end: number };
}

export interface CodeAnalysisResult {
  /** Analysis type performed */
  analysisType: string;
  /** Issues found */
  issues: CodeIssue[];
  /** Suggestions for improvement */
  suggestions: CodeSuggestion[];
  /** Code metrics */
  metrics: {
    /** Cyclomatic complexity */
    complexity: number;
    /** Maintainability index (0-100) */
    maintainability: number;
    /** Lines of code */
    linesOfCode: number;
    /** Code coverage potential */
    testability: number;
  };
  /** Overall assessment */
  assessment: 'excellent' | 'good' | 'fair' | 'needs-improvement' | 'critical';
}

export interface CodeIssue {
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Issue message */
  message: string;
  /** Affected code range */
  range: { start: number; end: number };
  /** Issue category */
  category: 'syntax' | 'logic' | 'performance' | 'security' | 'style' | 'maintainability';
  /** Suggested fix */
  fix?: {
    /** Fix description */
    description: string;
    /** Replacement code */
    code: string;
  };
}

export interface RefactorResult {
  /** Original code */
  originalCode: string;
  /** Refactored code */
  refactoredCode: string;
  /** Applied transformations */
  transformations: RefactorTransformation[];
  /** Impact assessment */
  impact: {
    /** Lines changed */
    linesChanged: number;
    /** Functions affected */
    functionsAffected: number;
    /** Breaking changes introduced */
    breakingChanges: boolean;
  };
}

export interface RefactorTransformation {
  /** Transformation type */
  type: string;
  /** Description of the transformation */
  description: string;
  /** Code range affected */
  range: { start: number; end: number };
  /** Before and after code snippets */
  before: string;
  after: string;
}

export interface CodeReviewResult {
  /** Overall rating (1-10) */
  rating: number;
  /** Review summary */
  summary: string;
  /** Detailed feedback by category */
  feedback: Record<string, CodeReviewFeedback>;
  /** Actionable recommendations */
  recommendations: string[];
  /** Code quality metrics */
  metrics: {
    /** Security score (0-100) */
    security: number;
    /** Performance score (0-100) */
    performance: number;
    /** Maintainability score (0-100) */
    maintainability: number;
    /** Test coverage score (0-100) */
    testCoverage: number;
  };
}

export interface CodeReviewFeedback {
  /** Rating for this category (1-10) */
  rating: number;
  /** Detailed comments */
  comments: string[];
  /** Specific issues found */
  issues: CodeIssue[];
  /** Positive aspects */
  strengths: string[];
}

/**
 * Kilocode client for making requests to the server
 */
export interface KilocodeClient {
  /** Generate code from prompt */
  generate(request: CodeGenerationRequest): Promise<KilocodeResponse<string>>;

  /** Complete code at cursor position */
  complete(request: CodeCompletionRequest): Promise<KilocodeResponse<CodeSuggestion[]>>;

  /** Analyze code for issues and improvements */
  analyze(request: CodeAnalysisRequest): Promise<KilocodeResponse<CodeAnalysisResult>>;

  /** Refactor code */
  refactor(request: CodeRefactorRequest): Promise<KilocodeResponse<RefactorResult>>;

  /** Review code quality */
  review(request: CodeReviewRequest): Promise<KilocodeResponse<CodeReviewResult>>;

  /** Stream code generation */
  generateStream(request: CodeGenerationRequest): AsyncIterable<StreamingResponse>;
}

/**
 * Kilocode server statistics
 */
export interface ServerStats {
  /** Server uptime in milliseconds */
  uptime: number;
  /** Total requests processed */
  totalRequests: number;
  /** Requests in the last hour */
  requestsLastHour: number;
  /** Average response time */
  averageResponseTime: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Memory usage */
  memoryUsage: NodeJS.MemoryUsage;
  /** Active connections */
  activeConnections: number;
}

/**
 * Kilocode integration with binG agents
 */
export interface KilocodeAgentIntegration {
  /** Agent ID */
  agentId: string;
  /** Available Kilocode capabilities */
  capabilities: ('generate' | 'complete' | 'analyze' | 'refactor' | 'review')[];
  /** Integration status */
  status: 'active' | 'inactive' | 'error';
  /** Last used timestamp */
  lastUsed?: number;
  /** Usage statistics */
  stats?: {
    requests: number;
    tokens: number;
    errors: number;
  };
}