/**
 * CrewAI Observability & Tracing
 *
 * Comprehensive tracing, metrics, and LangSmith integration.
 *
 * @see https://docs.crewai.com/en/enterprise/features/traces.md
 */

import { EventEmitter } from 'node:events';

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ExecutionMetrics {
  traceId: string;
  spanId: string;
  parentSpanId?: string;

  agentId?: string;
  taskId?: string;
  crewId?: string;

  name: string;
  type: 'crew' | 'agent' | 'task' | 'tool' | 'llm';

  startTime: number;
  endTime?: number;
  durationMs?: number;

  status: 'started' | 'completed' | 'error';

  input?: unknown;
  output?: unknown;
  error?: string;

  tokenUsage?: TokenUsage;
  cost?: number;

  metadata?: Record<string, unknown>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;

  name: string;
  kind: 'server' | 'client' | 'producer' | 'consumer';

  startTime: number;
  endTime?: number;
  durationMs?: number;

  attributes: Record<string, unknown>;

  status: {
    code: 'ok' | 'error' | 'unset';
    message?: string;
  };

  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;

  children: Span[];
}

export interface Trace {
  traceId: string;
  rootSpan: Span;
  spans: Map<string, Span>;
  startTime: number;
  endTime?: number;

  attributes: Record<string, unknown>;

  status: 'running' | 'completed' | 'error';
}

export interface LangSmithConfig {
  apiKey: string;
  projectName: string;
  endpoint?: string;
}

const TOKEN_PRICING: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o': { prompt: 0.005, completion: 0.015 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'gpt-4': { prompt: 0.03, completion: 0.06 },
  'claude-3-opus': { prompt: 0.015, completion: 0.075 },
  'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
  'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 },
  'gemini-pro': { prompt: 0.00125, completion: 0.005 },
};

export class TraceRecorder extends EventEmitter {
  private traces: Map<string, Trace> = new Map();
  private activeSpans: Map<string, Span> = new Map();
  private traceIdCounter = 0;

  startTrace(name: string, attributes: Record<string, unknown> = {}): string {
    const traceId = `trace_${++this.traceIdCounter}_${Date.now()}`;
    
    const rootSpan: Span = {
      traceId,
      spanId: `${traceId}_root`,
      name,
      kind: 'server',
      startTime: Date.now(),
      attributes,
      status: { code: 'unset' },
      events: [],
      children: [],
    };

    const trace: Trace = {
      traceId,
      rootSpan,
      spans: new Map([[rootSpan.spanId, rootSpan]]),
      startTime: Date.now(),
      attributes,
      status: 'running',
    };

    this.traces.set(traceId, trace);
    this.activeSpans.set(rootSpan.spanId, rootSpan);
    
    this.emit('trace:started', trace);
    
    return traceId;
  }

  startSpan(
    name: string,
    kind: Span['kind'],
    traceId: string,
    parentSpanId?: string,
    attributes: Record<string, unknown> = {}
  ): string {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${traceId}`);
    }

    const spanId = `${traceId}_span_${Date.now()}`;
    
    const span: Span = {
      traceId,
      spanId,
      parentSpanId,
      name,
      kind,
      startTime: Date.now(),
      attributes,
      status: { code: 'unset' },
      events: [],
      children: [],
    };

    trace.spans.set(spanId, span);
    this.activeSpans.set(spanId, span);

    if (parentSpanId) {
      const parent = trace.spans.get(parentSpanId);
      if (parent) {
        parent.children.push(span);
      }
    }

    this.emit('span:started', span);
    
    return spanId;
  }

  endSpan(spanId: string, output?: unknown, error?: string): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    
    if (error) {
      span.status = { code: 'error', message: error };
      span.attributes.error = error;
    } else {
      span.status = { code: 'ok' };
      span.attributes.output = output;
    }

    this.activeSpans.delete(spanId);
    
    const trace = this.traces.get(span.traceId);
    if (trace && trace.spans.size === this.activeSpans.size) {
      this.endTrace(trace.traceId);
    }

    this.emit('span:ended', span);
  }

  endTrace(traceId: string): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();
    trace.status = trace.rootSpan.status.code === 'error' ? 'error' : 'completed';
    
    this.emit('trace:ended', trace);
  }

  addEvent(spanId: string, eventName: string, attributes?: Record<string, unknown>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.events.push({
      name: eventName,
      timestamp: Date.now(),
      attributes,
    });

    this.emit('span:event', { spanId, eventName, attributes });
  }

  recordTokenUsage(spanId: string, usage: TokenUsage, model: string): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.tokenUsage = usage;
    
    const pricing = TOKEN_PRICING[model] || { prompt: 0, completion: 0 };
    span.cost = 
      (usage.prompt_tokens * pricing.prompt) +
      (usage.completion_tokens * pricing.completion);

    this.emit('span:tokens', { spanId, usage, cost: span.cost });
  }

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  getAllTraces(): Trace[] {
    return Array.from(this.traces.values());
  }

  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }
}

export class MetricsCollector extends EventEmitter {
  private metrics: Map<string, ExecutionMetrics[]> = new Map();
  private traceRecorder: TraceRecorder;

  constructor(traceRecorder: TraceRecorder) {
    super();
    this.traceRecorder = traceRecorder;
  }

  recordExecution(metrics: ExecutionMetrics): void {
    const key = `${metrics.type}:${metrics.agentId || 'unknown'}`;
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    this.metrics.get(key)!.push(metrics);
    
    this.emit('metrics:recorded', metrics);
  }

  getAgentMetrics(agentId: string): ExecutionMetrics[] {
    return this.metrics.get(`agent:${agentId}`) || [];
  }

  getCrewMetrics(crewId: string): ExecutionMetrics[] {
    return this.metrics.get(`crew:${crewId}`) || [];
  }

  getTotalTokens(): number {
    let total = 0;
    
    for (const [, metricsList] of this.metrics) {
      for (const metrics of metricsList) {
        if (metrics.tokenUsage) {
          total += metrics.tokenUsage.total_tokens;
        }
      }
    }
    
    return total;
  }

  getTotalCost(): number {
    let total = 0;
    
    for (const [, metricsList] of this.metrics) {
      for (const metrics of metricsList) {
        if (metrics.cost) {
          total += metrics.cost;
        }
      }
    }
    
    return total;
  }

  getAverageDuration(type: ExecutionMetrics['type']): number {
    const durations: number[] = [];
    
    for (const [, metricsList] of this.metrics) {
      for (const metrics of metricsList) {
        if (metrics.type === type && metrics.durationMs) {
          durations.push(metrics.durationMs);
        }
      }
    }
    
    if (durations.length === 0) return 0;
    
    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }
}

export class LangSmithExporter {
  private config: LangSmithConfig;
  private traceRecorder: TraceRecorder;

  constructor(config: LangSmithConfig, traceRecorder: TraceRecorder) {
    this.config = config;
    this.traceRecorder = traceRecorder;
  }

  async exportTrace(traceId: string): Promise<void> {
    const trace = this.traceRecorder.getTrace(traceId);
    if (!trace) return;

    const run = this.traceToRun(trace);
    
    try {
      const endpoint = this.config.endpoint || 'https://api.smith.langchain.com';
      
      await fetch(`${endpoint}/runs`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(run),
      });

      this.traceRecorder.emit('langsmith:exported', { traceId });
    } catch (error) {
      this.traceRecorder.emit('langsmith:error', { traceId, error });
      throw error;
    }
  }

  async exportAllTraces(): Promise<void> {
    const traces = this.traceRecorder.getAllTraces();
    
    await Promise.all(
      traces
        .filter(t => t.status === 'completed')
        .map(t => this.exportTrace(t.traceId))
    );
  }

  private traceToRun(trace: Trace): any {
    return {
      id: trace.traceId,
      name: trace.rootSpan.name,
      run_type: 'chain',
      start_time: new Date(trace.startTime).toISOString(),
      end_time: trace.endTime ? new Date(trace.endTime).toISOString() : null,
      inputs: trace.rootSpan.attributes.input,
      outputs: trace.rootSpan.attributes.output,
      error: trace.rootSpan.status.code === 'error' ? trace.rootSpan.status.message : null,
      extra: {
        metadata: trace.attributes,
      },
      child_runs: Array.from(trace.spans.values())
        .filter(s => s.parentSpanId === trace.rootSpan.spanId)
        .map(s => this.spanToChildRun(s, trace)),
    };
  }

  private spanToChildRun(span: Span, trace: Trace): any {
    return {
      id: span.spanId,
      name: span.name,
      run_type: this.spanTypeToRunType(span.type),
      start_time: new Date(span.startTime).toISOString(),
      end_time: span.endTime ? new Date(span.endTime).toISOString() : null,
      inputs: span.attributes.input,
      outputs: span.attributes.output,
      error: span.status.code === 'error' ? span.status.message : null,
      extra: {
        metadata: {
          tokenUsage: span.tokenUsage,
          cost: span.cost,
        },
      },
    };
  }

  private spanTypeToRunType(type: string): string {
    const mapping: Record<string, string> = {
      crew: 'chain',
      agent: 'llm',
      task: 'tool',
      tool: 'tool',
      llm: 'llm',
    };
    return mapping[type] || 'chain';
  }
}

/**
 * Create observability stack for CrewAI
 */
export function createObservability(config?: { langsmith?: LangSmithConfig }) {
  const traceRecorder = new TraceRecorder();
  const metricsCollector = new MetricsCollector(traceRecorder);
  
  let langSmithExporter: LangSmithExporter | null = null;
  
  if (config?.langsmith) {
    langSmithExporter = new LangSmithExporter(config.langsmith, traceRecorder);
    
    // Auto-export completed traces
    traceRecorder.on('trace:ended', (trace) => {
      if (trace.status === 'completed' && langSmithExporter) {
        langSmithExporter.exportTrace(trace.traceId).catch(console.error);
      }
    });
  }

  return {
    traceRecorder,
    metricsCollector,
    langSmithExporter,
  };
}
