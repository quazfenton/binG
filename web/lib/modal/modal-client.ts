/**
 * Modal HTTP Client
 *
 * Calls the Modal FastAPI endpoints from the backend.
 * Used for offloading heavy agent work to Modal's serverless GPU/CPU infrastructure.
 *
 * Usage:
 *   const modal = new ModalClient(process.env.MODAL_API_URL!);
 *   const result = await modal.executeAgent({ userMessage: '...', ... });
 */

export interface AgentExecuteRequest {
  userMessage: string;
  conversationId: string;
  userId: string;
  systemPrompt?: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface AgentExecuteResponse {
  success: boolean;
  response: string;
  model: string;
  provider: string;
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

export interface SandboxRunRequest {
  code: string;
  language?: 'python' | 'node' | 'bash';
  timeoutSeconds?: number;
  envVars?: Record<string, string>;
  memoryMb?: number;
}

export interface SandboxRunResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ImageGenRequest {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
}

export interface ModalHealth {
  status: string;
  service: string;
  timestamp: number;
  services?: Record<string, unknown>;
}

/**
 * Client for binG's Modal FastAPI backend.
 */
export class ModalClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 120_000) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Execute an agent task on Modal's compute infrastructure.
   * Use this for heavy agent loops that would strain the OCI backend.
   */
  async executeAgent(request: AgentExecuteRequest): Promise<AgentExecuteResponse> {
    const body = {
      user_message: request.userMessage,
      conversation_id: request.conversationId,
      user_id: request.userId,
      system_prompt: request.systemPrompt ?? 'You are an expert coding assistant.',
      model: request.model ?? 'gpt-4o',
      provider: request.provider ?? 'openai',
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      tools: request.tools ?? [],
      conversation_history: request.conversationHistory ?? [],
    };

    const response = await this.post<AgentExecuteResponse>('/api/agent/execute', body);
    return response;
  }

  /**
   * Execute code in an isolated Modal sandbox.
   * Use this for running untrusted code without Docker overhead.
   */
  async runSandbox(request: SandboxRunRequest): Promise<SandboxRunResponse> {
    const body = {
      code: request.code,
      language: request.language ?? 'python',
      timeout_seconds: request.timeoutSeconds ?? 30,
      env_vars: request.envVars ?? {},
      memory_mb: request.memoryMb ?? 512,
    };

    const response = await this.post<SandboxRunResponse>('/api/sandbox/run', body);
    return response;
  }

  /**
   * Generate an image using Modal's GPU infrastructure.
   */
  async generateImage(request: ImageGenRequest): Promise<Blob> {
    const url = new URL('/api/inference', this.baseUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: request.prompt,
          model: request.model ?? 'stabilityai/stable-diffusion-3.5',
          width: request.width ?? 1024,
          height: request.height ?? 1024,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`Image generation failed (${response.status}): ${error}`);
      }

      return await response.blob();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if Modal services are healthy.
   */
  async health(): Promise<ModalHealth> {
    return this.get<ModalHealth>('/health');
  }

  /**
   * Determine whether to route a request to Modal or handle locally.
   * Routes to Modal when:
   *  - The task is compute-heavy (GPU inference, sandbox execution)
   *  - The OCI backend is under load (fallback)
   *  - A user specifically requests GPU acceleration
   */
  static shouldOffloadToModal(options: {
    provider?: string;
    requiresGpu?: boolean;
    codeExecution?: boolean;
    taskComplexity?: 'simple' | 'moderate' | 'complex';
    fileSize?: number;
    model?: string;
  }): boolean {
    // Always offload GPU tasks to Modal
    if (options.requiresGpu) return true;

    // Offload code execution to Modal's sandboxes
    if (options.codeExecution) return true;

    // Offload image generation
    if (options.model?.includes('image') || options.model?.includes('diffusion')) return true;

    // Offload complex tasks when we want burst capacity
    if (options.taskComplexity === 'complex') return true;

    // Don't offload simple chat or small file operations
    return false;
  }

  /**
   * Find the Modal API URL from environment configuration.
   */
  static getUrlFromEnv(): string | null {
    return process.env.MODAL_API_URL
      ?? process.env.NEXT_PUBLIC_MODAL_API_URL
      ?? process.env.WORKER_MODAL_URL
      ?? null;
  }

  /**
   * Stream an agent execution via Modal's SSE endpoint.
   * Calls `onChunk` for each token and `onToolCall` for each tool invocation.
   * Returns the final AgentExecuteResponse when the stream completes.
   */
  async streamAgent(
    request: AgentExecuteRequest,
    callbacks: {
      onChunk?: (chunk: string) => void;
      onToolCall?: (name: string, args: Record<string, unknown>, result: unknown) => void;
      onError?: (error: string) => void;
    },
  ): Promise<AgentExecuteResponse> {
    const startTime = Date.now();
    const body = {
      user_message: request.userMessage,
      conversation_id: request.conversationId,
      user_id: request.userId,
      system_prompt: request.systemPrompt ?? 'You are an expert coding assistant.',
      model: request.model ?? 'gpt-4o',
      provider: request.provider ?? 'openai',
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      tools: request.tools ?? [],
      conversation_history: request.conversationHistory ?? [],
    };

    const url = new URL('/api/agent/stream', this.baseUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let fullResponse = '';
    let tokensUsed = 0;
    let provider = body.provider;
    let model = body.model;

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`Modal stream failed (${response.status}): ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Modal stream: no response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6).trim();

            if (currentData) {
              try {
                const parsed = JSON.parse(currentData);
                const event = parsed.event || currentEvent;

                switch (event) {
                  case 'token': {
                    const content = parsed.content || '';
                    if (content) {
                      fullResponse += content;
                      callbacks.onChunk?.(content);
                    }
                    if (parsed.done) {
                      // Done flag inside token event
                    }
                    break;
                  }
                  case 'tool_invocation': {
                    callbacks.onToolCall?.(
                      parsed.toolName || 'unknown',
                      parsed.args || {},
                      parsed.result,
                    );
                    if (parsed.tokens) tokensUsed += parsed.tokens;
                    break;
                  }
                  case 'done': {
                    provider = parsed.provider || provider;
                    model = parsed.model || model;
                    tokensUsed = parsed.tokens_used ?? tokensUsed;
                    break;
                  }
                  case 'error': {
                    callbacks.onError?.(parsed.message || parsed.content || 'Unknown Modal error');
                    break;
                  }
                  case 'start':
                  case '':
                  default:
                    break;
                }
              } catch {
                // Ignore parse errors on partial lines
              }
            }

            currentEvent = '';
            currentData = '';
          }
        }
      }

      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        response: fullResponse,
        model,
        provider,
        tokensUsed,
        durationMs,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        response: fullResponse,
        model,
        provider,
        tokensUsed,
        durationMs,
        error: err.message || 'Modal stream error',
      };
    }
  }

  // ── Private HTTP helpers ───────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`Modal GET ${path} failed (${response.status}): ${error}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`Modal POST ${path} failed (${response.status}): ${error}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Modal client singleton — lazy initialized from env.
 * Import this for convenience in backend code.
 */
let _modalClient: ModalClient | null = null;

export function getModalClient(): ModalClient | null {
  const url = ModalClient.getUrlFromEnv();
  if (!url) return null;

  if (!_modalClient) {
    try {
      new URL(url); // Validate URL format
      _modalClient = new ModalClient(url);
    } catch {
      console.error('ModalClient: Invalid MODAL_API_URL:', url);
      return null;
    }
  }
  return _modalClient;
}

/**
 * Convenience: create a modal client and decide if a request should use Modal.
 * Returns the client if Modal is configured AND the request qualifies.
 */
export function maybeUseModal(options: {
  provider?: string;
  requiresGpu?: boolean;
  codeExecution?: boolean;
  taskComplexity?: 'simple' | 'moderate' | 'complex';
  model?: string;
}): ModalClient | null {
  if (!ModalClient.shouldOffloadToModal(options)) return null;
  return getModalClient();
}
