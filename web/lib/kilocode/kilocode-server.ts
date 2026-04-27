/**
 * Kilocode Server Implementation
 *
 * Provides AI-powered code generation, completion, and analysis capabilities
 * through a REST API that integrates with binG's agent ecosystem.
 *
 * Features:
 * - Code generation from natural language prompts
 * - Code completion and suggestions
 * - Code analysis and refactoring
 * - Multi-language support
 * - Integration with binG's sandbox and filesystem systems
 * - Streaming responses for real-time interaction
 * - Authentication and rate limiting
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Optional security middleware - gracefully handle if not available
let helmet: any;
try {
  helmet = require('helmet');
} catch {
  // Helmet not available, will skip security headers
}
import { createLogger } from '../utils/logger';
import { validateConfig, apiConfigSchema } from '../utils/config-validation';
import { handleError, withErrorHandling, withRetry } from '../utils/error-handling';
import { performanceMonitor } from '../utils/performance';
import { maskSecrets } from '../utils/security';
import { createKiloGatewayClient, type KiloGatewayConfig, type ChatCompletionRequest } from './kilo-gateway';

type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;

const logger = createLogger('KilocodeServer');

export interface KilocodeConfig {
  port: number;
  host: string;
  apiKey?: string;
  maxRequestsPerHour: number;
  enableStreaming: boolean;
  supportedLanguages: string[];
  modelEndpoints: Record<string, string>;
  timeout: number;
  // Kilo AI Gateway configuration
  kiloGateway?: KiloGatewayConfig;
  // Default AI model for code generation
  defaultModel?: string;
}

export interface CodeGenerationRequest {
  prompt: string;
  language: string;
  context?: {
    files?: Array<{ name: string; content: string }>;
    cursor?: { line: number; column: number };
    selection?: { start: number; end: number };
  };
  options?: {
    temperature?: number;
    maxTokens?: number;
    style?: 'concise' | 'verbose' | 'documented';
    framework?: string;
  };
}

export interface CodeAnalysisRequest {
  code: string;
  language: string;
  analysisType: 'lint' | 'format' | 'refactor' | 'optimize' | 'explain';
  options?: Record<string, any>;
}

export interface KilocodeResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    model: string;
    tokens: number;
    processingTime: number;
  };
}

/**
 * Kilocode Server Class
 */
export class KilocodeServer {
  private app: express.Application;
  private config: KilocodeConfig;
  private server: any;
  private gatewayClient: any;

  constructor(config: Partial<KilocodeConfig> = {}) {
    this.config = this.validateAndMergeConfig(config);
    this.app = this.createExpressApp();
    this.setupRoutes();
    this.setupMiddleware();

    // Initialize Kilo AI Gateway client if configured
    if (this.config.kiloGateway) {
      this.gatewayClient = createKiloGatewayClient(this.config.kiloGateway);
      logger.info('Kilocode server initialized with Kilo AI Gateway');
    } else {
      logger.warn('Kilocode server initialized without Kilo AI Gateway - using placeholder implementations');
    }
  }

  /**
   * Validate and merge configuration
   */
  private validateAndMergeConfig(config: Partial<KilocodeConfig>): KilocodeConfig {
    const defaults: KilocodeConfig = {
      port: 3001,
      host: 'localhost',
      maxRequestsPerHour: 1000,
      enableStreaming: true,
      supportedLanguages: ['javascript', 'typescript', 'python', 'java', 'cpp', 'go', 'rust', 'php'],
      modelEndpoints: {
        'gpt-4': 'https://api.openai.com/v1/chat/completions',
        'claude-3': 'https://api.anthropic.com/v1/messages',
        'codellama': 'https://api.replicate.com/v1/predictions'
      },
      timeout: 30000,
      defaultModel: 'anthropic/claude-sonnet-4.5'
    };

    const merged = { ...defaults, ...config };

    // Validate API configuration
    const apiConfig = {
      baseUrl: `http://${merged.host}:${merged.port}`,
      timeout: merged.timeout,
      apiKey: merged.apiKey
    };

    const result = validateConfig(apiConfig, apiConfigSchema);
    if (!result.success) {
      throw new Error(`Invalid Kilocode server configuration: ${(result as any).errors.join(', ')}`);
    }

    return merged;
  }

  /**
   * Create Express application with security and performance middleware
   */
  private createExpressApp(): express.Application {
    const app = express();

    // Security middleware
    if (helmet) {
      app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      }));
    }

    // CORS configuration
    app.use(cors({
      origin: process.env.NODE_ENV === 'development' ? '*' : process.env.ALLOWED_ORIGINS?.split(',') || [],
      credentials: true,
    }));

    // Compression
    app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: this.config.maxRequestsPerHour,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use('/api/', limiter);

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    return app;
  }

  /**
   * Set up API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // API routes with error handling
    this.app.post('/api/generate', withErrorHandling(this.handleCodeGeneration.bind(this)));
    this.app.post('/api/complete', withErrorHandling(this.handleCodeCompletion.bind(this)));
    this.app.post('/api/analyze', withErrorHandling(this.handleCodeAnalysis.bind(this)));
    this.app.post('/api/refactor', withErrorHandling(this.handleCodeRefactoring.bind(this)));

    // Streaming endpoints (if enabled)
    if (this.config.enableStreaming) {
      this.app.post('/api/generate/stream', this.handleStreamingGeneration.bind(this));
    }

    // 404 handler
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });
  }

  /**
   * Set up additional middleware
   */
  private setupMiddleware(): void {
    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      logger.info(`Request: ${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: maskSecrets(JSON.stringify(req.body))
      });

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.info(`Response: ${res.statusCode} (${duration}ms)`, {
          method: req.method,
          path: req.path
        });
      });

      next();
    });

    // Authentication middleware
    this.app.use('/api/', this.authenticateRequest.bind(this));

    // Error handling middleware
    this.app.use((error: any, req: Request, res: Response, next: NextFunction) => {
      const errorResult = handleError(error, `${req.method} ${req.path}`);
      res.status(errorResult.statusCode).json({
        success: false,
        error: errorResult.userMessage,
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Authenticate API requests
   */
  private authenticateRequest(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Missing or invalid authorization header'
      });
      return;
    }

    const token = authHeader.substring(7);

    // Validate token (simplified - in production, verify JWT or API key)
    if (this.config.apiKey && token !== this.config.apiKey) {
      res.status(401).json({
        success: false,
        error: 'Invalid API key'
      });
      return;
    }

    next();
  }

  /**
   * Handle code generation requests
   */
  private async handleCodeGeneration(req: Request, res: Response): Promise<void> {
    const request: CodeGenerationRequest = req.body;

    // Validate request
    if (!request.prompt || !request.language) {
      throw new Error('Missing required fields: prompt and language');
    }

    if (!this.config.supportedLanguages.includes(request.language)) {
      throw new Error(`Unsupported language: ${request.language}`);
    }

    const result = await performanceMonitor.timeAsync('code-generation', async () => {
      // Simulate AI model call (replace with actual implementation)
      const generatedCode = await this.generateCodeWithAI(request);

      return {
        code: generatedCode,
        language: request.language,
        explanation: `Generated ${request.language} code for: ${request.prompt}`
      };
    });

    res.json({
      success: true,
      data: result,
      metadata: {
        model: 'kilocode-v1',
        tokens: Math.floor(result.code.length / 4), // Rough estimate
        processingTime: performanceMonitor.getRecentMetrics(1)[0]?.duration || 0
      }
    });
  }

  /**
   * Handle code completion requests
   */
  private async handleCodeCompletion(req: Request, res: Response): Promise<void> {
    const request: CodeGenerationRequest = req.body;

    const result = await performanceMonitor.timeAsync('code-completion', async () => {
      const completion = await this.generateCompletion(request);

      return {
        completion,
        language: request.language
      };
    });

    res.json({
      success: true,
      data: result
    });
  }

  /**
   * Handle code analysis requests
   */
  private async handleCodeAnalysis(req: Request, res: Response): Promise<void> {
    const request: CodeAnalysisRequest = req.body;

    const result = await performanceMonitor.timeAsync('code-analysis', async () => {
      return await this.analyzeCode(request);
    });

    res.json({
      success: true,
      data: result
    });
  }

  /**
   * Handle code refactoring requests
   */
  private async handleCodeRefactoring(req: Request, res: Response): Promise<void> {
    const request: CodeAnalysisRequest = req.body;

    const result = await performanceMonitor.timeAsync('code-refactor', async () => {
      return await this.refactorCode(request);
    });

    res.json({
      success: true,
      data: result
    });
  }

  /**
   * Handle streaming code generation
   */
  private async handleStreamingGeneration(req: Request, res: Response): Promise<void> {
    const request: CodeGenerationRequest = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      await this.streamCodeGeneration(request, (chunk: string) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }

  /**
   * Generate code using AI models via Kilo Gateway
   */
  private async generateCodeWithAI(request: CodeGenerationRequest): Promise<string> {
    if (!this.gatewayClient) {
      // Fallback to placeholder implementation
      return this.generateCodeFallback(request);
    }

    const systemPrompt = `You are an expert ${request.language} developer. Generate high-quality, well-documented code based on the user's request. Include proper error handling, type annotations (for statically typed languages), and follow best practices.`;

    const userPrompt = `Generate ${request.language} code for: ${request.prompt}

Requirements:
- Use modern ${request.language} features and best practices
- Include proper error handling
- Add meaningful comments and documentation
- Follow ${request.language} naming conventions
- Make the code production-ready

${request.context?.files ? `Reference files:\n${request.context.files.map(f => `${f.name}:\n${f.content}`).join('\n\n')}` : ''}`;

    const chatRequest: ChatCompletionRequest = {
      model: this.config.defaultModel!,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: request.options?.temperature ?? 0.7,
      max_tokens: request.options?.maxTokens ?? 2000,
    };

    try {
      const response = await this.gatewayClient.createChatCompletion(chatRequest);
      const generatedCode = response.choices[0]?.message?.content || '';

      // Clean up the response (remove markdown code blocks if present)
      return generatedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    } catch (error) {
      logger.error('AI code generation failed, falling back to template', error);
      return this.generateCodeFallback(request);
    }
  }

  /**
   * Fallback code generation when AI is not available
   */
  private generateCodeFallback(request: CodeGenerationRequest): string {
    const templates: Record<string, string> = {
      javascript: `/**
 * ${request.prompt}
 */
function ${request.prompt.replace(/\s+/g, '_')}() {
  try {
    console.log('${request.prompt}');
    return true;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}`,
      typescript: `/**
 * ${request.prompt}
 */
function ${request.prompt.replace(/\s+/g, '_')}(): boolean {
  try {
    console.log('${request.prompt}');
    return true;
  } catch (error: any) {
    console.error('Error:', error.message);
    return false;
  }
}`,
      python: `"""
${request.prompt}
"""
def ${request.prompt.replace(/\s+/g, '_')}():
    try:
        print('${request.prompt}')
        return True
    except Exception as e:
        print(f'Error: {e}')
        return False`,
    };

    return templates[request.language] || `// Generated code for: ${request.prompt}\n// AI service not available`;
  }

  /**
   * Generate code completion (placeholder)
   */
  private async generateCompletion(request: CodeGenerationRequest): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));
    return `// Completion for: ${request.prompt}`;
  }

  /**
   * Analyze code (placeholder)
   */
  private async analyzeCode(request: CodeAnalysisRequest): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 200));

    return {
      analysisType: request.analysisType,
      issues: [],
      suggestions: ['Consider adding error handling'],
      metrics: {
        complexity: 5,
        maintainability: 8
      }
    };
  }

  /**
   * Refactor code (placeholder)
   */
  private async refactorCode(request: CodeAnalysisRequest): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 300));

    return {
      originalCode: request.code,
      refactoredCode: request.code.replace(/\s+/g, ' ').trim(),
      improvements: ['Removed extra whitespace']
    };
  }

  /**
   * Stream code generation (placeholder)
   */
  private async streamCodeGeneration(request: CodeGenerationRequest, onChunk: (chunk: string) => void): Promise<void> {
    const fullCode = await this.generateCodeWithAI(request);
    const chunks = fullCode.split(' ');

    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, 50));
      onChunk(chunk + ' ');
    }
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          logger.info(`Kilocode server started`, {
            host: this.config.host,
            port: this.config.port,
            supportedLanguages: this.config.supportedLanguages.length
          });
          resolve();
        });

        this.server.on('error', (error: any) => {
          logger.error('Failed to start Kilocode server', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Kilocode server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server configuration
   */
  public getConfig(): KilocodeConfig {
    return { ...this.config };
  }
}

/**
 * Create and start Kilocode server
 */
export async function createKilocodeServer(config?: Partial<KilocodeConfig>): Promise<KilocodeServer> {
  const server = new KilocodeServer(config);
  await server.start();
  return server;
}

/**
 * Default export for CLI usage
 */
export default KilocodeServer;
