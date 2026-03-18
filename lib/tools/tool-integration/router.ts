import type {
  IntegrationProvider,
  ProviderExecutionRequest,
  ToolExecutionResult,
  ToolProvider,
} from './types';

interface RouterConfig {
  providerChain: IntegrationProvider[];
  retryableErrorPatterns: RegExp[];
}

const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  providerChain: ['arcade', 'nango', 'composio', 'mcp', 'smithery', 'tambo'],
  retryableErrorPatterns: [
    /timeout/i,
    /rate.?limit/i,
    /temporar/i,
    /503/,
    /429/,
    /network/i,
  ],
};

export class ToolProviderRouter {
  private readonly providers = new Map<IntegrationProvider, ToolProvider>();
  private readonly config: RouterConfig;

  constructor(providers: ToolProvider[], config?: Partial<RouterConfig>) {
    this.config = {
      ...DEFAULT_ROUTER_CONFIG,
      ...config,
    };

    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
  }

  private getProviderOrder(preferred: IntegrationProvider): IntegrationProvider[] {
    const envChain = (process.env.TOOL_ROUTER_PROVIDER_CHAIN || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean) as IntegrationProvider[];

    const configuredChain = envChain.length > 0 ? envChain : this.config.providerChain;
    const deduped = [preferred, ...configuredChain].filter(
      (provider, index, list) => list.indexOf(provider) === index,
    );

    return deduped;
  }

  private isRetryableError(error?: string): boolean {
    if (!error) return false;
    return this.config.retryableErrorPatterns.some((pattern) => pattern.test(error));
  }

  private async executeWithRetry(
    provider: ToolProvider,
    request: ProviderExecutionRequest,
    maxRetries: number = 3
  ): Promise<ToolExecutionResult> {
    let lastError = 'Unknown error'
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await provider.execute(request)
      if (result.success) return result
      
      lastError = result.error || 'Execution failed'
      
      if (!this.isRetryableError(lastError)) {
        return { ...result, error: lastError }
      }
      
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise(r => setTimeout(r, delay))
    }
    
    return { success: false, error: lastError, provider: provider.name }
  }

  async executeWithFallback(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    const providerOrder = this.getProviderOrder(request.config.provider);
    const errors: string[] = [];
    const attempted: IntegrationProvider[] = [];

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider || !provider.isAvailable()) {
        continue;
      }

      attempted.push(providerName);

      if (!provider.supports(request)) {
        continue;
      }

      const result = await this.executeWithRetry(provider, request);
      if (result.success) {
        return {
          ...result,
          fallbackChain: attempted,
        };
      }

      errors.push(`${providerName}: ${result.error || 'execution failed'}`);

      if (result.authRequired) {
        return {
          ...result,
          fallbackChain: attempted,
          provider: providerName,
        };
      }

      if (!this.isRetryableError(result.error)) {
        break;
      }
    }

    return {
      success: false,
      error: errors.length > 0 ? errors.join('; ') : 'No provider could execute this tool',
      fallbackChain: attempted,
    };
  }
}
