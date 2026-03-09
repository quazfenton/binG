/**
 * Prometheus Metrics
 * Provides Prometheus-compatible metrics endpoint
 * Migrated from ephemeral/serverless_workers_sdk/metrics.py
 */

import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricSample {
  labels: MetricLabels;
  value: number;
  timestamp?: number;
}

export abstract class Metric extends EventEmitter {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly type: MetricType,
    public readonly labelNames: string[] = []
  ) {
    super();
  }

  abstract inc(labels?: MetricLabels, value?: number): void;
  abstract dec(labels?: MetricLabels, value?: number): void;
  abstract set(value: number, labels?: MetricLabels): void;
  abstract reset(): void;
  abstract getSamples(): MetricSample[];
}

export class Counter extends Metric {
  private values: Map<string, number> = new Map();

  constructor(name: string, description: string, labelNames: string[] = []) {
    super(name, description, 'counter', labelNames);
  }

  inc(labels: MetricLabels = {}, value: number = 1): void {
    if (value < 0) {
      throw new Error('Counter can only be incremented');
    }
    const key = this.getLabelKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
    this.emit('change', { labels, value: current + value });
  }

  dec(): void {
    throw new Error('Counter cannot be decremented');
  }

  set(): void {
    throw new Error('Counter cannot be set directly');
  }

  reset(): void {
    this.values.clear();
    this.emit('reset');
  }

  getSamples(): MetricSample[] {
    const samples: MetricSample[] = [];
    for (const [key, value] of this.values.entries()) {
      const labels = this.parseLabelKey(key);
      samples.push({ labels, value });
    }
    return samples;
  }

  private getLabelKey(labels: MetricLabels): string {
    return this.labelNames.map(name => labels[name] || '').join('|');
  }

  private parseLabelKey(key: string): MetricLabels {
    const values = key.split('|');
    const labels: MetricLabels = {};
    this.labelNames.forEach((name, index) => {
      labels[name] = values[index] || '';
    });
    return labels;
  }
}

export class Gauge extends Metric {
  private value: number = 0;
  private labelsValue: Map<string, number> = new Map();

  constructor(name: string, description: string, labelNames: string[] = []) {
    super(name, description, 'gauge', labelNames);
  }

  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.labelsValue.get(key) || 0;
    this.set(current + value, labels);
  }

  dec(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.getLabelKey(labels);
    const current = this.labelsValue.get(key) || 0;
    this.set(current - value, labels);
  }

  set(value: number, labels: MetricLabels = {}): void {
    const key = this.getLabelKey(labels);
    this.labelsValue.set(key, value);
    this.emit('change', { labels, value });
  }

  reset(): void {
    this.labelsValue.clear();
    this.emit('reset');
  }

  getSamples(): MetricSample[] {
    const samples: MetricSample[] = [];
    for (const [key, value] of this.labelsValue.entries()) {
      const labels = this.parseLabelKey(key);
      samples.push({ labels, value });
    }
    return samples;
  }

  private getLabelKey(labels: MetricLabels): string {
    return this.labelNames.map(name => labels[name] || '').join('|');
  }

  private parseLabelKey(key: string): MetricLabels {
    const values = key.split('|');
    const labels: MetricLabels = {};
    this.labelNames.forEach((name, index) => {
      labels[name] = values[index] || '';
    });
    return labels;
  }
}

export class Histogram extends Metric {
  private buckets: number[];
  private counts: Map<string, Map<number, number>> = new Map();
  private sums: Map<string, number> = new Map();

  constructor(
    name: string,
    description: string,
    labelNames: string[] = [],
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ) {
    super(name, description, 'histogram', labelNames);
    this.buckets = buckets;
  }

  observe(value: number, labels: MetricLabels = {}): void {
    const key = this.getLabelKey(labels);
    
    // Initialize counts for this label set
    if (!this.counts.has(key)) {
      const bucketCounts = new Map<number, number>();
      this.buckets.forEach(bucket => bucketCounts.set(bucket, 0));
      this.counts.set(key, bucketCounts);
      this.sums.set(key, 0);
    }

    const counts = this.counts.get(key)!;
    const sum = this.sums.get(key)! || 0;

    // Update bucket counts
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        counts.set(bucket, (counts.get(bucket) || 0) + 1);
      }
    }

    // Update sum
    this.sums.set(key, sum + value);

    this.emit('observe', { labels, value });
  }

  inc(): void {
    throw new Error('Use observe() for histograms');
  }

  dec(): void {
    throw new Error('Histograms cannot be decremented');
  }

  set(): void {
    throw new Error('Histograms cannot be set directly');
  }

  reset(): void {
    this.counts.clear();
    this.sums.clear();
    this.emit('reset');
  }

  getSamples(): MetricSample[] {
    const samples: MetricSample[] = [];

    for (const [key, counts] of this.counts.entries()) {
      const labels = this.parseLabelKey(key);
      let cumulative = 0;

      // Bucket metrics
      for (const bucket of this.buckets) {
        cumulative += counts.get(bucket) || 0;
        samples.push({
          labels: { ...labels, le: bucket.toString() },
          value: cumulative,
        });
      }

      // Infinity bucket
      samples.push({
        labels: { ...labels, le: '+Inf' },
        value: cumulative,
      });

      // Sum metric
      samples.push({
        labels: { ...labels, le: 'sum' },
        value: this.sums.get(key) || 0,
      });
    }

    return samples;
  }

  private getLabelKey(labels: MetricLabels): string {
    return this.labelNames.map(name => labels[name] || '').join('|');
  }

  private parseLabelKey(key: string): MetricLabels {
    const values = key.split('|');
    const labels: MetricLabels = {};
    this.labelNames.forEach((name, index) => {
      labels[name] = values[index] || '';
    });
    return labels;
  }
}

export class MetricsRegistry extends EventEmitter {
  private metrics: Map<string, Metric> = new Map();

  register(metric: Metric): void {
    if (this.metrics.has(metric.name)) {
      throw new Error(`Metric ${metric.name} is already registered`);
    }
    this.metrics.set(metric.name, metric);
    this.emit('registered', metric);
  }

  get(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  getSamples(): { name: string; help: string; type: MetricType; samples: MetricSample[] }[] {
    const result = [];
    for (const [name, metric] of this.metrics.entries()) {
      result.push({
        name,
        help: metric.description,
        type: metric.type,
        samples: metric.getSamples(),
      });
    }
    return result;
  }

  toPrometheusFormat(): string {
    const lines: string[] = [];

    for (const [name, metric] of this.metrics.entries()) {
      lines.push(`# HELP ${name} ${metric.description}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      for (const sample of metric.getSamples()) {
        const labelStr = Object.entries(sample.labels)
          .map(([key, value]) => `${key}="${value}"`)
          .join(',');
        
        const metricName = labelStr ? `${name}{${labelStr}}` : name;
        lines.push(`${metricName} ${sample.value}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.reset();
    }
    this.emit('reset');
  }
}

// Pre-defined metrics for sandbox platform
export class SandboxMetrics {
  public registry: MetricsRegistry;

  // Sandbox metrics
  public sandboxCreatedTotal: Counter;
  public sandboxActive: Gauge;
  public sandboxExecTotal: Counter;
  public sandboxExecDuration: Histogram;

  // Snapshot metrics
  public snapshotCreatedTotal: Counter;
  public snapshotRestoredTotal: Counter;
  public snapshotSizeBytes: Histogram;
  public snapshotCreationDuration: Histogram;
  public snapshotRestorationDuration: Histogram;

  // HTTP metrics
  public httpRequestsTotal: Counter;
  public httpRequestDuration: Histogram;

  // Quota metrics
  public quotaViolationsTotal: Counter;

  // Circuit breaker metrics
  public circuitBreakerOperations: Counter;
  public circuitBreakerDuration: Histogram;
  public circuitBreakerStateChanges: Counter;

  // Storage backend metrics
  public storageUploadsTotal: Counter;
  public storageDownloadsTotal: Counter;
  public storageUploadSize: Histogram;
  public storageDownloadSize: Histogram;
  public storageOperationDuration: Histogram;

  // Provider metrics
  public providerInitTotal: Counter;
  public providerInitDuration: Histogram;
  public providerHealthCheckTotal: Counter;
  public providerHealthCheckDuration: Histogram;

  constructor() {
    this.registry = new MetricsRegistry();

    // Sandbox metrics
    this.sandboxCreatedTotal = new Counter('sandbox_created_total', 'Total number of sandboxes created', ['status']);
    this.sandboxActive = new Gauge('sandbox_active', 'Number of currently active sandboxes');
    this.sandboxExecTotal = new Counter('sandbox_exec_total', 'Total number of command executions', ['status']);
    this.sandboxExecDuration = new Histogram(
      'sandbox_exec_duration_seconds',
      'Command execution duration in seconds',
      ['status']
    );

    // Snapshot metrics
    this.snapshotCreatedTotal = new Counter('snapshot_created_total', 'Total number of snapshots created', ['status']);
    this.snapshotRestoredTotal = new Counter('snapshot_restored_total', 'Total number of snapshots restored', ['status']);
    this.snapshotSizeBytes = new Histogram(
      'snapshot_size_bytes',
      'Snapshot size distribution',
      [],
      [1024, 10240, 102400, 1048576, 10485760, 104857600]
    );
    this.snapshotCreationDuration = new Histogram(
      'snapshot_creation_duration_seconds',
      'Snapshot creation duration in seconds',
      ['userId']
    );
    this.snapshotRestorationDuration = new Histogram(
      'snapshot_restoration_duration_seconds',
      'Snapshot restoration duration in seconds',
      ['userId']
    );

    // HTTP metrics
    this.httpRequestsTotal = new Counter('http_requests_total', 'Total HTTP requests', ['method', 'path', 'status']);
    this.httpRequestDuration = new Histogram(
      'http_request_duration_seconds',
      'HTTP request duration in seconds',
      ['method', 'path']
    );

    // Quota metrics
    this.quotaViolationsTotal = new Counter('quota_violations_total', 'Total quota violations', ['type']);

    // Circuit breaker metrics
    this.circuitBreakerOperations = new Counter(
      'circuit_breaker_operations_total',
      'Total circuit breaker operations',
      ['provider', 'operation', 'result']
    );
    this.circuitBreakerDuration = new Histogram(
      'circuit_breaker_operation_duration_seconds',
      'Circuit breaker operation duration in seconds',
      ['provider', 'operation']
    );
    this.circuitBreakerStateChanges = new Counter(
      'circuit_breaker_state_changes_total',
      'Total circuit breaker state changes',
      ['provider', 'from', 'to']
    );

    // Storage backend metrics
    this.storageUploadsTotal = new Counter(
      'storage_uploads_total',
      'Total storage upload operations',
      ['backend', 'status']
    );
    this.storageDownloadsTotal = new Counter(
      'storage_downloads_total',
      'Total storage download operations',
      ['backend', 'status']
    );
    this.storageUploadSize = new Histogram(
      'storage_upload_size_bytes',
      'Storage upload size distribution',
      ['backend']
    );
    this.storageDownloadSize = new Histogram(
      'storage_download_size_bytes',
      'Storage download size distribution',
      ['backend']
    );
    this.storageOperationDuration = new Histogram(
      'storage_operation_duration_seconds',
      'Storage operation duration in seconds',
      ['backend', 'operation']
    );

    // Provider metrics
    this.providerInitTotal = new Counter(
      'provider_init_total',
      'Total provider initialization attempts',
      ['provider', 'status']
    );
    this.providerInitDuration = new Histogram(
      'provider_init_duration_seconds',
      'Provider initialization duration in seconds',
      ['provider']
    );
    this.providerHealthCheckTotal = new Counter(
      'provider_health_check_total',
      'Total provider health check attempts',
      ['provider', 'status']
    );
    this.providerHealthCheckDuration = new Histogram(
      'provider_health_check_duration_seconds',
      'Provider health check duration in seconds',
      ['provider']
    );

    // Register all metrics
    this.registry.register(this.sandboxCreatedTotal);
    this.registry.register(this.sandboxActive);
    this.registry.register(this.sandboxExecTotal);
    this.registry.register(this.sandboxExecDuration);
    this.registry.register(this.snapshotCreatedTotal);
    this.registry.register(this.snapshotRestoredTotal);
    this.registry.register(this.snapshotSizeBytes);
    this.registry.register(this.snapshotCreationDuration);
    this.registry.register(this.snapshotRestorationDuration);
    this.registry.register(this.httpRequestsTotal);
    this.registry.register(this.httpRequestDuration);
    this.registry.register(this.quotaViolationsTotal);
    this.registry.register(this.circuitBreakerOperations);
    this.registry.register(this.circuitBreakerDuration);
    this.registry.register(this.circuitBreakerStateChanges);
    this.registry.register(this.storageUploadsTotal);
    this.registry.register(this.storageDownloadsTotal);
    this.registry.register(this.storageUploadSize);
    this.registry.register(this.storageDownloadSize);
    this.registry.register(this.storageOperationDuration);
    this.registry.register(this.providerInitTotal);
    this.registry.register(this.providerInitDuration);
    this.registry.register(this.providerHealthCheckTotal);
    this.registry.register(this.providerHealthCheckDuration);
  }
}

// Create metrics endpoint handler
export function createMetricsEndpoint(registry: MetricsRegistry) {
  return function metricsHandler(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(registry.toPrometheusFormat());
  };
}

// Singleton instance
export const sandboxMetrics = new SandboxMetrics();

// Export metrics endpoint
export const metricsEndpoint = createMetricsEndpoint(sandboxMetrics.registry);
