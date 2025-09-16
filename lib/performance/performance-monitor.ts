/**
 * Performance Monitor
 * Comprehensive performance monitoring system for streaming operations,
 * memory usage, and overall application performance
 */

export interface PerformanceMetrics {
  streaming: StreamingMetrics;
  memory: MemoryMetrics;
  network: NetworkMetrics;
  ui: UIMetrics;
  mobile: MobileMetrics;
}

export interface StreamingMetrics {
  sessionId: string;
  totalChunks: number;
  averageChunkSize: number;
  renderLatency: number;
  bufferUtilization: number;
  throughput: number; // chunks per second
  errorRate: number;
  connectionStability: number;
  backpressureEvents: number;
}

export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  peakUsage: number;
  gcEvents: number;
  memoryLeaks: MemoryLeak[];
}

export interface NetworkMetrics {
  requestCount: number;
  averageLatency: number;
  errorRate: number;
  retryCount: number;
  cacheHitRate: number;
  bandwidthUsage: number;
}

export interface UIMetrics {
  frameRate: number;
  renderTime: number;
  layoutShifts: number;
  interactionLatency: number;
  bundleSize: number;
  componentRenderCount: number;
}

export interface MobileMetrics {
  batteryUsage: number;
  networkType: string;
  deviceMemory: number;
  screenSize: { width: number; height: number };
  touchLatency: number;
  orientationChanges: number;
}

export interface MemoryLeak {
  component: string;
  size: number;
  timestamp: number;
  stackTrace?: string;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics;
  private observers: Map<string, PerformanceObserver> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private isMonitoring = false;

  constructor() {
    this.metrics = this.initializeMetrics();
    this.setupPerformanceObservers();
  }

  private initializeMetrics(): PerformanceMetrics {
    return {
      streaming: {
        sessionId: '',
        totalChunks: 0,
        averageChunkSize: 0,
        renderLatency: 0,
        bufferUtilization: 0,
        throughput: 0,
        errorRate: 0,
        connectionStability: 1,
        backpressureEvents: 0
      },
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
        peakUsage: 0,
        gcEvents: 0,
        memoryLeaks: []
      },
      network: {
        requestCount: 0,
        averageLatency: 0,
        errorRate: 0,
        retryCount: 0,
        cacheHitRate: 0,
        bandwidthUsage: 0
      },
      ui: {
        frameRate: 60,
        renderTime: 0,
        layoutShifts: 0,
        interactionLatency: 0,
        bundleSize: 0,
        componentRenderCount: 0
      },
      mobile: {
        batteryUsage: 0,
        networkType: 'unknown',
        deviceMemory: 0,
        screenSize: { width: 0, height: 0 },
        touchLatency: 0,
        orientationChanges: 0
      }
    };
  }

  private setupPerformanceObservers(): void {
    if (typeof window === 'undefined') return;

    // Layout shift observer
    if ('LayoutShift' in window) {
      const layoutShiftObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
            this.metrics.ui.layoutShifts += (entry as any).value;
          }
        }
      });
      layoutShiftObserver.observe({ entryTypes: ['layout-shift'] });
      this.observers.set('layout-shift', layoutShiftObserver);
    }

    // Long task observer
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          this.metrics.ui.renderTime = Math.max(this.metrics.ui.renderTime, entry.duration);
        }
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
    this.observers.set('longtask', longTaskObserver);

    // Navigation observer
    const navigationObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const navEntry = entry as PerformanceNavigationTiming;
        this.metrics.network.averageLatency = navEntry.responseEnd - navEntry.requestStart;
      }
    });
    navigationObserver.observe({ entryTypes: ['navigation'] });
    this.observers.set('navigation', navigationObserver);
  }

  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Memory monitoring
    const memoryInterval = setInterval(() => {
      this.updateMemoryMetrics();
    }, 5000);
    this.intervals.set('memory', memoryInterval);

    // Frame rate monitoring
    const frameRateInterval = setInterval(() => {
      this.updateFrameRate();
    }, 1000);
    this.intervals.set('framerate', frameRateInterval);

    // Mobile-specific monitoring
    if (this.isMobileDevice()) {
      this.startMobileMonitoring();
    }
  }

  stopMonitoring(): void {
    this.isMonitoring = false;
    
    // Clear intervals
    this.intervals.forEach((interval) => clearInterval(interval));
    this.intervals.clear();

    // Disconnect observers
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
  }

  private updateMemoryMetrics(): void {
    if (typeof window === 'undefined' || !(performance as any).memory) return;

    const memory = (performance as any).memory;
    this.metrics.memory.heapUsed = memory.usedJSHeapSize;
    this.metrics.memory.heapTotal = memory.totalJSHeapSize;
    this.metrics.memory.peakUsage = Math.max(this.metrics.memory.peakUsage, memory.usedJSHeapSize);

    // Detect potential memory leaks
    if (memory.usedJSHeapSize > this.metrics.memory.peakUsage * 1.5) {
      this.detectMemoryLeaks();
    }
  }

  private updateFrameRate(): void {
    if (typeof window === 'undefined') return;

    let frameCount = 0;
    const startTime = performance.now();

    const countFrames = () => {
      frameCount++;
      const currentTime = performance.now();
      if (currentTime - startTime < 1000) {
        requestAnimationFrame(countFrames);
      } else {
        this.metrics.ui.frameRate = frameCount;
      }
    };

    requestAnimationFrame(countFrames);
  }

  private detectMemoryLeaks(): void {
    // Simple memory leak detection based on heap growth patterns
    const currentHeap = this.metrics.memory.heapUsed;
    const threshold = 50 * 1024 * 1024; // 50MB threshold

    if (currentHeap > threshold) {
      const leak: MemoryLeak = {
        component: 'unknown',
        size: currentHeap,
        timestamp: Date.now(),
        stackTrace: new Error().stack
      };
      this.metrics.memory.memoryLeaks.push(leak);
    }
  }

  private startMobileMonitoring(): void {
    if (typeof window === 'undefined') return;

    // Battery API monitoring
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const updateBattery = () => {
          this.metrics.mobile.batteryUsage = (1 - battery.level) * 100;
        };
        battery.addEventListener('levelchange', updateBattery);
        updateBattery();
      });
    }

    // Network information
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      this.metrics.mobile.networkType = connection.effectiveType || 'unknown';
      
      connection.addEventListener('change', () => {
        this.metrics.mobile.networkType = connection.effectiveType || 'unknown';
      });
    }

    // Device memory
    if ('deviceMemory' in navigator) {
      this.metrics.mobile.deviceMemory = (navigator as any).deviceMemory;
    }

    // Screen size
    this.metrics.mobile.screenSize = {
      width: window.screen.width,
      height: window.screen.height
    };

    // Orientation changes
    window.addEventListener('orientationchange', () => {
      this.metrics.mobile.orientationChanges++;
    });
  }

  private isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // Streaming-specific monitoring methods
  trackStreamingSession(sessionId: string): void {
    this.metrics.streaming.sessionId = sessionId;
    this.metrics.streaming.totalChunks = 0;
    this.metrics.streaming.errorRate = 0;
    this.metrics.streaming.backpressureEvents = 0;
  }

  recordStreamingChunk(chunkSize: number, renderTime: number): void {
    this.metrics.streaming.totalChunks++;
    
    // Update average chunk size
    const totalSize = this.metrics.streaming.averageChunkSize * (this.metrics.streaming.totalChunks - 1) + chunkSize;
    this.metrics.streaming.averageChunkSize = totalSize / this.metrics.streaming.totalChunks;
    
    // Update render latency
    this.metrics.streaming.renderLatency = renderTime;
    
    // Calculate throughput
    this.metrics.streaming.throughput = this.metrics.streaming.totalChunks / (Date.now() / 1000);
  }

  recordStreamingError(): void {
    this.metrics.streaming.errorRate = 
      (this.metrics.streaming.errorRate * this.metrics.streaming.totalChunks + 1) / 
      (this.metrics.streaming.totalChunks + 1);
  }

  recordBackpressureEvent(): void {
    this.metrics.streaming.backpressureEvents++;
  }

  updateBufferUtilization(utilization: number): void {
    this.metrics.streaming.bufferUtilization = utilization;
  }

  // Network monitoring methods
  recordNetworkRequest(latency: number, success: boolean, fromCache: boolean): void {
    this.metrics.network.requestCount++;
    
    // Update average latency
    const totalLatency = this.metrics.network.averageLatency * (this.metrics.network.requestCount - 1) + latency;
    this.metrics.network.averageLatency = totalLatency / this.metrics.network.requestCount;
    
    // Update error rate
    if (!success) {
      this.metrics.network.errorRate = 
        (this.metrics.network.errorRate * (this.metrics.network.requestCount - 1) + 1) / 
        this.metrics.network.requestCount;
    }
    
    // Update cache hit rate
    if (fromCache) {
      this.metrics.network.cacheHitRate = 
        (this.metrics.network.cacheHitRate * (this.metrics.network.requestCount - 1) + 1) / 
        this.metrics.network.requestCount;
    }
  }

  recordRetry(): void {
    this.metrics.network.retryCount++;
  }

  // UI monitoring methods
  recordComponentRender(): void {
    this.metrics.ui.componentRenderCount++;
  }

  recordInteractionLatency(latency: number): void {
    this.metrics.ui.interactionLatency = latency;
  }

  updateBundleSize(size: number): void {
    this.metrics.ui.bundleSize = size;
  }

  // Mobile-specific methods
  recordTouchLatency(latency: number): void {
    this.metrics.mobile.touchLatency = latency;
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  getStreamingMetrics(): StreamingMetrics {
    return { ...this.metrics.streaming };
  }

  getMemoryMetrics(): MemoryMetrics {
    return { ...this.metrics.memory };
  }

  generateReport(): string {
    const metrics = this.getMetrics();
    
    return `
Performance Report
==================

Streaming Performance:
- Total Chunks: ${metrics.streaming.totalChunks}
- Average Chunk Size: ${metrics.streaming.averageChunkSize.toFixed(2)} bytes
- Render Latency: ${metrics.streaming.renderLatency.toFixed(2)}ms
- Throughput: ${metrics.streaming.throughput.toFixed(2)} chunks/sec
- Error Rate: ${(metrics.streaming.errorRate * 100).toFixed(2)}%
- Buffer Utilization: ${(metrics.streaming.bufferUtilization * 100).toFixed(2)}%

Memory Usage:
- Heap Used: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(2)} MB
- Heap Total: ${(metrics.memory.heapTotal / 1024 / 1024).toFixed(2)} MB
- Peak Usage: ${(metrics.memory.peakUsage / 1024 / 1024).toFixed(2)} MB
- Memory Leaks: ${metrics.memory.memoryLeaks.length}

Network Performance:
- Request Count: ${metrics.network.requestCount}
- Average Latency: ${metrics.network.averageLatency.toFixed(2)}ms
- Error Rate: ${(metrics.network.errorRate * 100).toFixed(2)}%
- Cache Hit Rate: ${(metrics.network.cacheHitRate * 100).toFixed(2)}%

UI Performance:
- Frame Rate: ${metrics.ui.frameRate} FPS
- Layout Shifts: ${metrics.ui.layoutShifts.toFixed(4)}
- Component Renders: ${metrics.ui.componentRenderCount}
- Bundle Size: ${(metrics.ui.bundleSize / 1024).toFixed(2)} KB

Mobile Metrics:
- Battery Usage: ${metrics.mobile.batteryUsage.toFixed(2)}%
- Network Type: ${metrics.mobile.networkType}
- Device Memory: ${metrics.mobile.deviceMemory} GB
- Touch Latency: ${metrics.mobile.touchLatency.toFixed(2)}ms
    `.trim();
  }
}

export const performanceMonitor = new PerformanceMonitor();
export { PerformanceMonitor };
export default PerformanceMonitor;