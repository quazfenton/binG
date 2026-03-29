/**
 * Prometheus Metrics
 *
 * Metrics export for agent execution, tool calls, and sandbox operations.
 *
 * @module observability/metrics
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Observability:Metrics');

/**
 * Metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

/**
 * Metric definition
 */
export interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
  labels?: string[];
}

/**
 * Metric registry
 */
class MetricRegistry {
  private metrics = new Map<string, any>();
  private definitions = new Map<string, MetricDefinition>();

  /**
   * Register a metric definition
   */
  register(definition: MetricDefinition): void {
    this.definitions.set(definition.name, definition);
    logger.debug('Registered metric', { name: definition.name, type: definition.type });
  }

  /**
   * Increment counter
   */
  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    const metric = this.getOrCreateMetric(name, labels);
    if (metric) {
      metric.inc(value);
    }
  }

  /**
   * Set gauge value
   */
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.getOrCreateMetric(name, labels);
    if (metric) {
      metric.set(value);
    }
  }

  /**
   * Record histogram observation
   */
  histogram(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.getOrCreateMetric(name, labels);
    if (metric) {
      metric.observe(value);
    }
  }

  /**
   * Get all metrics as Prometheus format
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    
    for (const [name, metric] of this.metrics.entries()) {
      const definition = this.definitions.get(name);
      if (!definition) continue;
      
      // Add HELP
      lines.push(`# HELP ${name} ${definition.description}`);
      
      // Add TYPE
      lines.push(`# TYPE ${name} ${definition.type}`);
      
      // Add metric value
      const labels = metric.labels || {};
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      
      const value = metric.value ?? metric.count ?? 0;
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${value}`);
    }
    
    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    logger.info('Metrics reset');
  }

  private getOrCreateMetric(name: string, labels?: Record<string, string>): any {
    const key = `${name}:${JSON.stringify(labels || {})}`;
    
    if (!this.metrics.has(key)) {
      const definition = this.definitions.get(name);
      if (!definition) {
        logger.warn('Metric not registered', { name });
        return null;
      }
      
      this.metrics.set(key, {
        name,
        labels,
        value: 0,
        count: 0,
        sum: 0,
        inc: (v: number) => {
          const metric = this.metrics.get(key);
          metric.value += v;
          metric.count += 1;
          metric.sum += v;
        },
        set: (v: number) => {
          const metric = this.metrics.get(key);
          metric.value = v;
        },
        observe: (v: number) => {
          const metric = this.metrics.get(key);
          metric.count += 1;
          metric.sum += v;
        },
      });
    }
    
    return this.metrics.get(key);
  }
}

/**
 * Singleton metric registry
 */
export const metricRegistry = new MetricRegistry();

/**
 * Pre-defined metric definitions
 */
export const METRICS = {
  // Agent metrics
  AGENT_EXECUTIONS_TOTAL: {
    name: 'bing_agent_executions_total',
    type: 'counter' as const,
    description: 'Total number of agent executions',
    labels: ['provider', 'status'],
  },
  AGENT_EXECUTION_DURATION: {
    name: 'bing_agent_execution_duration_seconds',
    type: 'histogram' as const,
    description: 'Agent execution duration in seconds',
    labels: ['provider', 'task_type'],
  },
  AGENT_ACTIVE_COUNT: {
    name: 'bing_agent_active_count',
    type: 'gauge' as const,
    description: 'Number of currently active agents',
    labels: ['provider'],
  },
  
  // Tool metrics
  TOOL_EXECUTIONS_TOTAL: {
    name: 'bing_tool_executions_total',
    type: 'counter' as const,
    description: 'Total number of tool executions',
    labels: ['tool_name', 'status'],
  },
  TOOL_EXECUTION_DURATION: {
    name: 'bing_tool_execution_duration_seconds',
    type: 'histogram' as const,
    description: 'Tool execution duration in seconds',
    labels: ['tool_name'],
  },
  
  // Sandbox metrics
  SANDBOX_CREATIONS_TOTAL: {
    name: 'bing_sandbox_creations_total',
    type: 'counter' as const,
    description: 'Total number of sandbox creations',
    labels: ['provider', 'status'],
  },
  SANDBOX_ACTIVE_COUNT: {
    name: 'bing_sandbox_active_count',
    type: 'gauge' as const,
    description: 'Number of currently active sandboxes',
    labels: ['provider'],
  },
  SANDBOX_WARM_POOL_SIZE: {
    name: 'bing_sandbox_warm_pool_size',
    type: 'gauge' as const,
    description: 'Number of warm sandboxes in pool',
    labels: ['provider'],
  },
  
  // LLM metrics
  LLM_REQUESTS_TOTAL: {
    name: 'bing_llm_requests_total',
    type: 'counter' as const,
    description: 'Total number of LLM requests',
    labels: ['provider', 'model', 'status'],
  },
  LLM_TOKENS_TOTAL: {
    name: 'bing_llm_tokens_total',
    type: 'counter' as const,
    description: 'Total number of tokens used',
    labels: ['provider', 'model', 'type'],
  },
  LLM_REQUEST_DURATION: {
    name: 'bing_llm_request_duration_seconds',
    type: 'histogram' as const,
    description: 'LLM request duration in seconds',
    labels: ['provider', 'model'],
  },
  
  // Event metrics
  EVENTS_TOTAL: {
    name: 'bing_events_total',
    type: 'counter' as const,
    description: 'Total number of events processed',
    labels: ['event_type', 'status'],
  },
  EVENTS_PROCESSING_DURATION: {
    name: 'bing_events_processing_duration_seconds',
    type: 'histogram' as const,
    description: 'Event processing duration in seconds',
    labels: ['event_type'],
  },
};

/**
 * Register all pre-defined metrics
 */
export function registerAllMetrics(): void {
  Object.values(METRICS).forEach(metric => {
    metricRegistry.register(metric);
  });
  logger.info('All metrics registered');
}

/**
 * Record agent execution metrics
 */
export function recordAgentExecution(
  provider: string,
  taskType: string,
  durationSeconds: number,
  success: boolean
): void {
  metricRegistry.increment(
    METRICS.AGENT_EXECUTIONS_TOTAL.name,
    1,
    { provider, status: success ? 'success' : 'failure' }
  );
  
  metricRegistry.histogram(
    METRICS.AGENT_EXECUTION_DURATION.name,
    durationSeconds,
    { provider, task_type: taskType }
  );
}

/**
 * Record tool execution metrics
 */
export function recordToolExecution(
  toolName: string,
  durationSeconds: number,
  success: boolean
): void {
  metricRegistry.increment(
    METRICS.TOOL_EXECUTIONS_TOTAL.name,
    1,
    { tool_name: toolName, status: success ? 'success' : 'failure' }
  );
  
  metricRegistry.histogram(
    METRICS.TOOL_EXECUTION_DURATION.name,
    durationSeconds,
    { tool_name: toolName }
  );
}

/**
 * Record sandbox creation metrics
 */
export function recordSandboxCreation(
  provider: string,
  durationSeconds: number,
  success: boolean
): void {
  metricRegistry.increment(
    METRICS.SANDBOX_CREATIONS_TOTAL.name,
    1,
    { provider, status: success ? 'success' : 'failure' }
  );
}

/**
 * Record LLM request metrics
 */
export function recordLLMRequest(
  provider: string,
  model: string,
  durationSeconds: number,
  promptTokens: number,
  completionTokens: number,
  success: boolean
): void {
  metricRegistry.increment(
    METRICS.LLM_REQUESTS_TOTAL.name,
    1,
    { provider, model, status: success ? 'success' : 'failure' }
  );
  
  metricRegistry.histogram(
    METRICS.LLM_REQUEST_DURATION.name,
    durationSeconds,
    { provider, model }
  );
  
  if (promptTokens > 0) {
    metricRegistry.increment(
      METRICS.LLM_TOKENS_TOTAL.name,
      promptTokens,
      { provider, model, type: 'prompt' }
    );
  }
  
  if (completionTokens > 0) {
    metricRegistry.increment(
      METRICS.LLM_TOKENS_TOTAL.name,
      completionTokens,
      { provider, model, type: 'completion' }
    );
  }
}

/**
 * Get Prometheus metrics endpoint response
 */
export function getPrometheusMetrics(): string {
  return metricRegistry.getPrometheusMetrics();
}
