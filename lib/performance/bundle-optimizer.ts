/**
 * Bundle Optimizer
 * Tools and utilities for optimizing bundle size and loading performance
 */

export interface BundleOptimizationConfig {
  enableCodeSplitting: boolean;
  enableTreeShaking: boolean;
  enableLazyLoading: boolean;
  enablePreloading: boolean;
  enableCompression: boolean;
  chunkSizeThreshold: number;
}

export interface BundleMetrics {
  totalSize: number;
  chunkSizes: Map<string, number>;
  loadTimes: Map<string, number>;
  cacheHitRates: Map<string, number>;
  compressionRatios: Map<string, number>;
}

export interface LoadingStrategy {
  critical: string[];
  important: string[];
  lazy: string[];
  preload: string[];
}

class BundleOptimizer {
  private config: BundleOptimizationConfig;
  private metrics: BundleMetrics;
  private loadedChunks: Set<string> = new Set();
  private loadingPromises: Map<string, Promise<any>> = new Map();
  private preloadedResources: Set<string> = new Set();
  private compressionCache: Map<string, string> = new Map();

  constructor(config: Partial<BundleOptimizationConfig> = {}) {
    this.config = {
      enableCodeSplitting: true,
      enableTreeShaking: true,
      enableLazyLoading: true,
      enablePreloading: true,
      enableCompression: true,
      chunkSizeThreshold: 250 * 1024, // 250KB
      ...config
    };

    this.metrics = {
      totalSize: 0,
      chunkSizes: new Map(),
      loadTimes: new Map(),
      cacheHitRates: new Map(),
      compressionRatios: new Map()
    };

    this.setupOptimizations();
  }

  private setupOptimizations(): void {
    if (this.config.enablePreloading) {
      this.setupResourcePreloading();
    }

    if (this.config.enableLazyLoading) {
      this.setupLazyLoading();
    }

    this.setupPerformanceMonitoring();
  }

  private setupResourcePreloading(): void {
    // Preload critical resources
    this.preloadCriticalResources();
    
    // Setup intersection observer for predictive preloading
    if ('IntersectionObserver' in window) {
      this.setupPredictivePreloading();
    }
  }

  private preloadCriticalResources(): void {
    const criticalResources = [
      '/api/auth/validate',
      '/api/health'
    ];

    criticalResources.forEach(resource => {
      this.preloadResource(resource);
    });
  }

  private setupPredictivePreloading(): void {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const element = entry.target as HTMLElement;
          const preloadHint = element.dataset.preload;
          
          if (preloadHint && !this.preloadedResources.has(preloadHint)) {
            this.preloadResource(preloadHint);
          }
        }
      });
    }, {
      rootMargin: '100px'
    });

    // This would be used to observe elements with preload hints
    // observer.observe(element);
  }

  private setupLazyLoading(): void {
    // Setup dynamic import optimization
    this.optimizeDynamicImports();
    
    // Setup component lazy loading
    this.setupComponentLazyLoading();
  }

  private optimizeDynamicImports(): void {
    // Wrap dynamic imports with optimization logic
    const originalImport = window.import || ((specifier: string) => import(specifier));
    
    (window as any).optimizedImport = async (specifier: string) => {
      const startTime = performance.now();
      
      try {
        // Check if already loaded
        if (this.loadedChunks.has(specifier)) {
          return this.getCachedModule(specifier);
        }

        // Check if currently loading
        if (this.loadingPromises.has(specifier)) {
          return this.loadingPromises.get(specifier);
        }

        // Start loading
        const loadPromise = this.loadModuleWithOptimization(specifier);
        this.loadingPromises.set(specifier, loadPromise);

        const module = await loadPromise;
        
        // Record metrics
        const loadTime = performance.now() - startTime;
        this.metrics.loadTimes.set(specifier, loadTime);
        this.loadedChunks.add(specifier);
        this.loadingPromises.delete(specifier);

        return module;
      } catch (error) {
        this.loadingPromises.delete(specifier);
        throw error;
      }
    };
  }

  private async loadModuleWithOptimization(specifier: string): Promise<any> {
    // Apply compression if enabled
    if (this.config.enableCompression) {
      const compressedSpecifier = this.getCompressedVersion(specifier);
      if (compressedSpecifier) {
        try {
          return await import(compressedSpecifier);
        } catch (error) {
          // Fall back to original if compressed version fails
          console.warn(`Failed to load compressed version of ${specifier}, falling back to original`);
        }
      }
    }

    return await import(specifier);
  }

  private getCompressedVersion(specifier: string): string | null {
    // Check if compressed version exists
    if (this.compressionCache.has(specifier)) {
      return this.compressionCache.get(specifier)!;
    }

    // In a real implementation, this would check for .gz or .br versions
    const compressedSpecifier = specifier.replace(/\.js$/, '.gz.js');
    this.compressionCache.set(specifier, compressedSpecifier);
    
    return compressedSpecifier;
  }

  private getCachedModule(specifier: string): any {
    // Return cached module if available
    // This would integrate with the module cache
    return null;
  }

  private setupComponentLazyLoading(): void {
    // Setup React.lazy optimization
    this.optimizeReactLazy();
  }

  private optimizeReactLazy(): void {
    // Enhance React.lazy with additional optimizations
    // This would wrap React.lazy calls with performance monitoring
  }

  private setupPerformanceMonitoring(): void {
    // Monitor bundle loading performance
    this.monitorBundlePerformance();
    
    // Setup resource timing observer
    if ('PerformanceObserver' in window) {
      this.setupResourceTimingObserver();
    }
  }

  private monitorBundlePerformance(): void {
    // Monitor overall bundle performance
    setInterval(() => {
      this.updateBundleMetrics();
    }, 30000); // Update every 30 seconds
  }

  private setupResourceTimingObserver(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'resource') {
          this.processResourceTiming(entry as PerformanceResourceTiming);
        }
      }
    });

    observer.observe({ entryTypes: ['resource'] });
  }

  private processResourceTiming(entry: PerformanceResourceTiming): void {
    const resourceName = entry.name;
    const loadTime = entry.responseEnd - entry.requestStart;
    const size = entry.transferSize || 0;

    // Update metrics
    this.metrics.loadTimes.set(resourceName, loadTime);
    this.metrics.chunkSizes.set(resourceName, size);
    this.metrics.totalSize += size;

    // Calculate compression ratio if available
    if (entry.encodedBodySize && entry.decodedBodySize) {
      const compressionRatio = entry.encodedBodySize / entry.decodedBodySize;
      this.metrics.compressionRatios.set(resourceName, compressionRatio);
    }
  }

  private updateBundleMetrics(): void {
    // Update various bundle metrics
    this.calculateCacheHitRates();
    this.analyzeChunkSizes();
  }

  private calculateCacheHitRates(): void {
    // Calculate cache hit rates for different resources
    // This would integrate with the cache manager
  }

  private analyzeChunkSizes(): void {
    // Analyze chunk sizes and suggest optimizations
    for (const [chunk, size] of this.metrics.chunkSizes) {
      if (size > this.config.chunkSizeThreshold) {
        console.warn(`Large chunk detected: ${chunk} (${(size / 1024).toFixed(2)}KB)`);
        this.suggestChunkOptimization(chunk, size);
      }
    }
  }

  private suggestChunkOptimization(chunk: string, size: number): void {
    // Suggest optimizations for large chunks
    console.log(`Consider splitting ${chunk} into smaller chunks or lazy loading parts of it`);
  }

  // Public API methods
  async loadModule(specifier: string): Promise<any> {
    return (window as any).optimizedImport ? 
      (window as any).optimizedImport(specifier) : 
      import(specifier);
  }

  preloadResource(url: string): Promise<void> {
    if (this.preloadedResources.has(url)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = url;
      
      // Determine resource type
      if (url.endsWith('.js')) {
        link.as = 'script';
      } else if (url.endsWith('.css')) {
        link.as = 'style';
      } else if (url.match(/\.(woff2?|ttf|eot)$/)) {
        link.as = 'font';
        link.crossOrigin = 'anonymous';
      } else {
        link.as = 'fetch';
        link.crossOrigin = 'anonymous';
      }

      link.onload = () => {
        this.preloadedResources.add(url);
        resolve();
      };
      
      link.onerror = () => {
        reject(new Error(`Failed to preload ${url}`));
      };

      document.head.appendChild(link);
    });
  }

  async preloadModules(modules: string[]): Promise<void[]> {
    const promises = modules.map(module => this.preloadResource(module));
    return Promise.all(promises);
  }

  createLoadingStrategy(routes: string[]): LoadingStrategy {
    const strategy: LoadingStrategy = {
      critical: [],
      important: [],
      lazy: [],
      preload: []
    };

    routes.forEach(route => {
      if (this.isCriticalRoute(route)) {
        strategy.critical.push(route);
      } else if (this.isImportantRoute(route)) {
        strategy.important.push(route);
      } else {
        strategy.lazy.push(route);
      }

      // Add to preload if it's likely to be visited
      if (this.shouldPreload(route)) {
        strategy.preload.push(route);
      }
    });

    return strategy;
  }

  private isCriticalRoute(route: string): boolean {
    // Determine if route is critical (e.g., home page, auth)
    const criticalRoutes = ['/', '/login', '/dashboard'];
    return criticalRoutes.includes(route);
  }

  private isImportantRoute(route: string): boolean {
    // Determine if route is important but not critical
    const importantRoutes = ['/settings', '/profile'];
    return importantRoutes.includes(route);
  }

  private shouldPreload(route: string): boolean {
    // Determine if route should be preloaded based on usage patterns
    // This could integrate with analytics data
    return false;
  }

  optimizeForDevice(deviceType: 'mobile' | 'tablet' | 'desktop'): void {
    switch (deviceType) {
      case 'mobile':
        this.optimizeForMobile();
        break;
      case 'tablet':
        this.optimizeForTablet();
        break;
      case 'desktop':
        this.optimizeForDesktop();
        break;
    }
  }

  private optimizeForMobile(): void {
    // Mobile-specific optimizations
    this.config.chunkSizeThreshold = 150 * 1024; // Smaller chunks for mobile
    this.config.enableLazyLoading = true;
    this.config.enablePreloading = false; // Reduce preloading on mobile
  }

  private optimizeForTablet(): void {
    // Tablet-specific optimizations
    this.config.chunkSizeThreshold = 200 * 1024;
    this.config.enablePreloading = true;
  }

  private optimizeForDesktop(): void {
    // Desktop-specific optimizations
    this.config.chunkSizeThreshold = 500 * 1024; // Larger chunks OK on desktop
    this.config.enablePreloading = true;
  }

  generateOptimizationReport(): string {
    const totalChunks = this.metrics.chunkSizes.size;
    const averageChunkSize = Array.from(this.metrics.chunkSizes.values())
      .reduce((sum, size) => sum + size, 0) / totalChunks;
    
    const averageLoadTime = Array.from(this.metrics.loadTimes.values())
      .reduce((sum, time) => sum + time, 0) / this.metrics.loadTimes.size;

    const averageCompressionRatio = Array.from(this.metrics.compressionRatios.values())
      .reduce((sum, ratio) => sum + ratio, 0) / this.metrics.compressionRatios.size;

    return `
Bundle Optimization Report
==========================

Total Bundle Size: ${(this.metrics.totalSize / 1024 / 1024).toFixed(2)} MB
Total Chunks: ${totalChunks}
Average Chunk Size: ${(averageChunkSize / 1024).toFixed(2)} KB
Average Load Time: ${averageLoadTime.toFixed(2)} ms
Average Compression Ratio: ${(averageCompressionRatio * 100).toFixed(1)}%

Loaded Chunks: ${this.loadedChunks.size}
Preloaded Resources: ${this.preloadedResources.size}
Active Loading Promises: ${this.loadingPromises.size}

Optimizations Enabled:
- Code Splitting: ${this.config.enableCodeSplitting ? 'Yes' : 'No'}
- Tree Shaking: ${this.config.enableTreeShaking ? 'Yes' : 'No'}
- Lazy Loading: ${this.config.enableLazyLoading ? 'Yes' : 'No'}
- Preloading: ${this.config.enablePreloading ? 'Yes' : 'No'}
- Compression: ${this.config.enableCompression ? 'Yes' : 'No'}
    `.trim();
  }

  getMetrics(): BundleMetrics {
    return {
      totalSize: this.metrics.totalSize,
      chunkSizes: new Map(this.metrics.chunkSizes),
      loadTimes: new Map(this.metrics.loadTimes),
      cacheHitRates: new Map(this.metrics.cacheHitRates),
      compressionRatios: new Map(this.metrics.compressionRatios)
    };
  }

  clearMetrics(): void {
    this.metrics = {
      totalSize: 0,
      chunkSizes: new Map(),
      loadTimes: new Map(),
      cacheHitRates: new Map(),
      compressionRatios: new Map()
    };
  }
}

export const bundleOptimizer = new BundleOptimizer();
export { BundleOptimizer };
export default BundleOptimizer;