/**
 * Performance Manager
 * Central coordinator for all performance optimization systems
 */

import { performanceMonitor, PerformanceMetrics } from './performance-monitor';
import { memoryOptimizer, OptimizationResult } from './memory-optimizer';
import { cacheManager, CacheStats } from './cache-manager';
import { mobileOptimizer, MobileMetrics, DeviceCapabilities } from './mobile-optimizer';
import { bundleOptimizer, BundleMetrics } from './bundle-optimizer';

export interface PerformanceConfig {
  enableMonitoring: boolean;
  enableMemoryOptimization: boolean;
  enableCaching: boolean;
  enableMobileOptimization: boolean;
  enableBundleOptimization: boolean;
  autoOptimization: boolean;
  optimizationThresholds: OptimizationThresholds;
}

export interface OptimizationThresholds {
  memoryUsage: number; // MB
  frameRate: number; // FPS
  loadTime: number; // ms
  batteryLevel: number; // 0-1
  networkLatency: number; // ms
}

export interface PerformanceReport {
  timestamp: number;
  overall: PerformanceMetrics;
  memory: OptimizationResult;
  cache: CacheStats;
  mobile: MobileMetrics;
  bundle: BundleMetrics;
  recommendations: string[];
  score: number; // 0-100
}

class PerformanceManager {
  private config: PerformanceConfig;
  private isInitialized = false;
  private optimizationCallbacks: Set<(report: PerformanceReport) => void> = new Set();
  private lastOptimization = 0;
  private optimizationInterval = 30000; // 30 seconds

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enableMonitoring: true,
      enableMemoryOptimization: true,
      enableCaching: true,
      enableMobileOptimization: true,
      enableBundleOptimization: true,
      autoOptimization: true,
      optimizationThresholds: {
        memoryUsage: 100, // 100MB
        frameRate: 30, // 30 FPS
        loadTime: 3000, // 3 seconds
        batteryLevel: 0.2, // 20%
        networkLatency: 1000 // 1 second
      },
      ...config
    };

    this.initialize();
  }

  private initialize(): void {
    if (this.isInitialized) return;

    console.log('Initializing Performance Manager...');

    // Initialize monitoring
    if (this.config.enableMonitoring) {
      performanceMonitor.startMonitoring();
    }

    // Setup mobile optimization
    if (this.config.enableMobileOptimization) {
      this.setupMobileOptimization();
    }

    // Setup bundle optimization
    if (this.config.enableBundleOptimization) {
      this.setupBundleOptimization();
    }

    // Setup automatic optimization
    if (this.config.autoOptimization) {
      this.startAutoOptimization();
    }

    // Setup memory pressure handling
    if (this.config.enableMemoryOptimization) {
      this.setupMemoryOptimization();
    }

    this.isInitialized = true;
    console.log('Performance Manager initialized successfully');
  }

  private setupMobileOptimization(): void {
    // Listen for mobile optimization changes
    mobileOptimizer.onOptimizationChange(() => {
      this.handleMobileOptimizationChange();
    });
  }

  private setupBundleOptimization(): void {
    // Optimize bundle loading based on device capabilities
    const deviceCapabilities = mobileOptimizer.getDeviceCapabilities();
    
    if (deviceCapabilities.memory < 4) {
      bundleOptimizer.optimizeForDevice('mobile');
    } else if (deviceCapabilities.memory < 8) {
      bundleOptimizer.optimizeForDevice('tablet');
    } else {
      bundleOptimizer.optimizeForDevice('desktop');
    }
  }

  private setupMemoryOptimization(): void {
    // Setup memory pressure callbacks
    memoryOptimizer.onMemoryPressure(() => {
      this.handleMemoryPressure();
    });
  }

  private startAutoOptimization(): void {
    setInterval(() => {
      this.performAutoOptimization();
    }, this.optimizationInterval);
  }

  private async performAutoOptimization(): Promise<void> {
    if (Date.now() - this.lastOptimization < this.optimizationInterval) {
      return;
    }

    const report = await this.generatePerformanceReport();
    
    // Check if optimization is needed
    if (this.shouldOptimize(report)) {
      await this.optimize();
      this.lastOptimization = Date.now();
      
      // Notify callbacks
      this.notifyOptimizationCallbacks(report);
    }
  }

  private shouldOptimize(report: PerformanceReport): boolean {
    const thresholds = this.config.optimizationThresholds;
    
    // Check memory usage
    if (report.overall.memory.heapUsed / 1024 / 1024 > thresholds.memoryUsage) {
      return true;
    }

    // Check frame rate
    if (report.overall.ui.frameRate < thresholds.frameRate) {
      return true;
    }

    // Check network latency
    if (report.overall.network.averageLatency > thresholds.networkLatency) {
      return true;
    }

    // Check battery level (mobile)
    if (report.mobile.batteryUsage > (1 - thresholds.batteryLevel) * 100) {
      return true;
    }

    return false;
  }

  private handleMobileOptimizationChange(): void {
    console.log('Mobile optimization state changed');
    
    // Adjust other systems based on mobile optimization state
    if (mobileOptimizer.isInLowPowerMode()) {
      this.enableLowPowerMode();
    } else {
      this.disableLowPowerMode();
    }
  }

  private handleMemoryPressure(): void {
    console.warn('Memory pressure detected, initiating emergency optimization');
    
    // Perform emergency optimization
    this.performEmergencyOptimization();
  }

  private enableLowPowerMode(): void {
    console.log('Enabling low power mode across all systems');
    
    // Reduce cache sizes
    // Pause non-critical operations
    // Reduce monitoring frequency
    this.optimizationInterval = 60000; // Reduce to 1 minute
  }

  private disableLowPowerMode(): void {
    console.log('Disabling low power mode');
    
    // Restore normal operation
    this.optimizationInterval = 30000; // Back to 30 seconds
  }

  private async performEmergencyOptimization(): Promise<void> {
    console.log('Performing emergency optimization...');
    
    // Aggressive memory cleanup
    const memoryResult = memoryOptimizer.optimize();
    
    // Clear non-essential caches
    const cacheKeys = cacheManager.keys();
    const nonEssentialKeys = cacheKeys.filter(key => 
      !key.includes('auth') && !key.includes('user') && !key.includes('critical')
    );
    
    nonEssentialKeys.forEach(key => cacheManager.delete(key));
    
    // Force mobile optimization
    if (this.config.enableMobileOptimization) {
      mobileOptimizer.forceOptimization();
    }
    
    console.log('Emergency optimization completed:', memoryResult);
  }

  private notifyOptimizationCallbacks(report: PerformanceReport): void {
    this.optimizationCallbacks.forEach(callback => {
      try {
        callback(report);
      } catch (error) {
        console.error('Optimization callback error:', error);
      }
    });
  }

  // Public API methods
  async optimize(): Promise<PerformanceReport> {
    console.log('Starting performance optimization...');
    
    const startTime = Date.now();
    
    // Memory optimization
    let memoryResult: OptimizationResult = {
      memoryFreed: 0,
      objectsPooled: 0,
      cacheCleared: 0,
      weakReferencesCreated: 0
    };
    
    if (this.config.enableMemoryOptimization) {
      memoryResult = memoryOptimizer.optimize();
    }

    // Cache optimization
    if (this.config.enableCaching) {
      // Cache is automatically optimized through its internal mechanisms
    }

    // Mobile optimization
    if (this.config.enableMobileOptimization) {
      // Mobile optimizer handles its own optimization
    }

    const report = await this.generatePerformanceReport();
    
    const optimizationTime = Date.now() - startTime;
    console.log(`Performance optimization completed in ${optimizationTime}ms`);
    
    return report;
  }

  async generatePerformanceReport(): Promise<PerformanceReport> {
    const overall = performanceMonitor.getMetrics();
    const memory = memoryOptimizer.getOptimizationStats();
    const cache = cacheManager.getStats();
    const mobile = mobileOptimizer.getMetrics();
    const bundle = bundleOptimizer.getMetrics();

    const recommendations = this.generateRecommendations(overall, mobile, cache);
    const score = this.calculatePerformanceScore(overall, mobile, cache);

    return {
      timestamp: Date.now(),
      overall,
      memory: {
        memoryFreed: 0,
        objectsPooled: memory.componentCount,
        cacheCleared: 0,
        weakReferencesCreated: 0
      },
      cache,
      mobile,
      bundle,
      recommendations,
      score
    };
  }

  private generateRecommendations(
    overall: PerformanceMetrics,
    mobile: MobileMetrics,
    cache: CacheStats
  ): string[] {
    const recommendations: string[] = [];

    // Memory recommendations
    if (overall.memory.heapUsed > 100 * 1024 * 1024) {
      recommendations.push('Consider reducing memory usage - current heap size is over 100MB');
    }

    // Frame rate recommendations
    if (overall.ui.frameRate < 30) {
      recommendations.push('Frame rate is below 30 FPS - consider optimizing rendering performance');
    }

    // Network recommendations
    if (overall.network.errorRate > 0.1) {
      recommendations.push('Network error rate is high - implement better error handling and retries');
    }

    // Cache recommendations
    if (cache.hitRate < 0.7) {
      recommendations.push('Cache hit rate is low - consider adjusting cache strategy or TTL values');
    }

    // Mobile recommendations
    if (mobile.batteryUsage > 80) {
      recommendations.push('High battery usage detected - enable power saving optimizations');
    }

    if (mobile.touchLatency > 100) {
      recommendations.push('Touch latency is high - optimize touch event handling');
    }

    return recommendations;
  }

  private calculatePerformanceScore(
    overall: PerformanceMetrics,
    mobile: MobileMetrics,
    cache: CacheStats
  ): number {
    let score = 100;

    // Memory score (0-25 points)
    const memoryUsageMB = overall.memory.heapUsed / 1024 / 1024;
    if (memoryUsageMB > 200) score -= 25;
    else if (memoryUsageMB > 100) score -= 15;
    else if (memoryUsageMB > 50) score -= 5;

    // Frame rate score (0-25 points)
    if (overall.ui.frameRate < 20) score -= 25;
    else if (overall.ui.frameRate < 30) score -= 15;
    else if (overall.ui.frameRate < 45) score -= 10;
    else if (overall.ui.frameRate < 55) score -= 5;

    // Network score (0-20 points)
    if (overall.network.errorRate > 0.2) score -= 20;
    else if (overall.network.errorRate > 0.1) score -= 10;
    else if (overall.network.errorRate > 0.05) score -= 5;

    // Cache score (0-15 points)
    if (cache.hitRate < 0.5) score -= 15;
    else if (cache.hitRate < 0.7) score -= 10;
    else if (cache.hitRate < 0.8) score -= 5;

    // Mobile score (0-15 points)
    if (mobile.batteryUsage > 90) score -= 15;
    else if (mobile.batteryUsage > 80) score -= 10;
    else if (mobile.batteryUsage > 70) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  // Streaming-specific methods
  trackStreamingSession(sessionId: string): void {
    if (this.config.enableMonitoring) {
      performanceMonitor.trackStreamingSession(sessionId);
    }
  }

  recordStreamingChunk(chunkSize: number, renderTime: number): void {
    if (this.config.enableMonitoring) {
      performanceMonitor.recordStreamingChunk(chunkSize, renderTime);
    }
  }

  recordStreamingError(): void {
    if (this.config.enableMonitoring) {
      performanceMonitor.recordStreamingError();
    }
  }

  // Cache methods
  setCache<T>(key: string, data: T, ttl?: number): void {
    if (this.config.enableCaching) {
      cacheManager.set(key, data, ttl);
    }
  }

  getCache<T>(key: string): T | null {
    if (this.config.enableCaching) {
      return cacheManager.get<T>(key);
    }
    return null;
  }

  // Mobile methods
  addRenderTask(task: () => void): void {
    if (this.config.enableMobileOptimization) {
      mobileOptimizer.addRenderTask(task);
    }
  }

  // Bundle methods
  async loadModule(specifier: string): Promise<any> {
    if (this.config.enableBundleOptimization) {
      return bundleOptimizer.loadModule(specifier);
    }
    return import(specifier);
  }

  preloadResource(url: string): Promise<void> {
    if (this.config.enableBundleOptimization) {
      return bundleOptimizer.preloadResource(url);
    }
    return Promise.resolve();
  }

  // Event handlers
  onOptimization(callback: (report: PerformanceReport) => void): () => void {
    this.optimizationCallbacks.add(callback);
    
    return () => {
      this.optimizationCallbacks.delete(callback);
    };
  }

  // Configuration methods
  updateConfig(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Reinitialize if needed
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  // Utility methods
  isOptimizationNeeded(): boolean {
    // Quick check if optimization is needed
    const memoryUsage = performanceMonitor.getMemoryMetrics();
    return memoryUsage.heapUsed > this.config.optimizationThresholds.memoryUsage * 1024 * 1024;
  }

  getOptimizationStatus(): {
    lastOptimization: number;
    nextOptimization: number;
    isLowPowerMode: boolean;
    memoryPressure: boolean;
  } {
    return {
      lastOptimization: this.lastOptimization,
      nextOptimization: this.lastOptimization + this.optimizationInterval,
      isLowPowerMode: mobileOptimizer.isInLowPowerMode(),
      memoryPressure: this.isOptimizationNeeded()
    };
  }

  async generateFullReport(): Promise<string> {
    const report = await this.generatePerformanceReport();
    
    return `
Performance Manager Report
==========================
Generated: ${new Date(report.timestamp).toISOString()}
Overall Score: ${report.score}/100

${performanceMonitor.generateReport()}

${bundleOptimizer.generateOptimizationReport()}

Recommendations:
${report.recommendations.map(rec => `- ${rec}`).join('\n')}

Optimization Status:
- Last Optimization: ${new Date(this.lastOptimization).toISOString()}
- Low Power Mode: ${mobileOptimizer.isInLowPowerMode() ? 'Enabled' : 'Disabled'}
- Memory Pressure: ${this.isOptimizationNeeded() ? 'High' : 'Normal'}
    `.trim();
  }

  destroy(): void {
    console.log('Destroying Performance Manager...');
    
    // Stop monitoring
    if (this.config.enableMonitoring) {
      performanceMonitor.stopMonitoring();
    }

    // Clear callbacks
    this.optimizationCallbacks.clear();
    
    this.isInitialized = false;
  }
}

export const performanceManager = new PerformanceManager();
export { PerformanceManager };
export default PerformanceManager;