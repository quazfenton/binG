/**
 * React hook for performance monitoring and optimization
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { performanceManager, type PerformanceReport } from '@/lib/performance/performance-manager';

export interface UsePerformanceOptions {
  enableMonitoring?: boolean;
  enableOptimization?: boolean;
  componentName?: string;
  trackRenders?: boolean;
  trackInteractions?: boolean;
}

export interface PerformanceHookResult {
  // Performance data
  isOptimizing: boolean;
  lastReport: PerformanceReport | null;
  performanceScore: number;
  
  // Actions
  optimize: () => Promise<PerformanceReport>;
  generateReport: () => Promise<string>;
  trackRender: () => void;
  trackInteraction: (name: string, duration?: number) => void;
  
  // Streaming helpers
  trackStreamingSession: (sessionId: string) => void;
  recordStreamingChunk: (size: number, renderTime: number) => void;
  recordStreamingError: () => void;
  
  // Cache helpers
  setCache: <T>(key: string, data: T, ttl?: number) => void;
  getCache: <T>(key: string) => T | null;
  
  // Mobile helpers
  addRenderTask: (task: () => void) => void;
  isLowPowerMode: boolean;
}

export function usePerformance(options: UsePerformanceOptions = {}): PerformanceHookResult {
  const {
    enableMonitoring = true,
    enableOptimization = true,
    componentName = 'unknown',
    trackRenders = false,
    trackInteractions = false
  } = options;

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [lastReport, setLastReport] = useState<PerformanceReport | null>(null);
  const [performanceScore, setPerformanceScore] = useState(100);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  
  const renderCountRef = useRef(0);
  const interactionTimesRef = useRef<Map<string, number>>(new Map());

  // Initialize performance monitoring
  useEffect(() => {
    if (enableMonitoring) {
      performanceManager.updateConfig({ enableMonitoring: true });
    }

    // Subscribe to optimization events
    const unsubscribe = performanceManager.onOptimization((report) => {
      setLastReport(report);
      setPerformanceScore(report.score);
    });

    return unsubscribe;
  }, [enableMonitoring]);

  // Track component renders
  useEffect(() => {
    if (trackRenders) {
      renderCountRef.current++;
      performanceManager.recordComponentRender?.();
    }
  });

  // Monitor low power mode
  useEffect(() => {
    const checkLowPowerMode = () => {
      const status = performanceManager.getOptimizationStatus();
      setIsLowPowerMode(status.isLowPowerMode);
    };

    checkLowPowerMode();
    const interval = setInterval(checkLowPowerMode, 5000);
    
    return () => clearInterval(interval);
  }, []);

  // Optimize performance
  const optimize = useCallback(async (): Promise<PerformanceReport> => {
    setIsOptimizing(true);
    try {
      const report = await performanceManager.optimize();
      setLastReport(report);
      setPerformanceScore(report.score);
      return report;
    } finally {
      setIsOptimizing(false);
    }
  }, []);

  // Generate performance report
  const generateReport = useCallback(async (): Promise<string> => {
    return performanceManager.generateFullReport();
  }, []);

  // Track render performance
  const trackRender = useCallback(() => {
    renderCountRef.current++;
    // Record render time if available
    if (typeof performance !== 'undefined' && performance.mark) {
      const markName = `${componentName}-render-${renderCountRef.current}`;
      performance.mark(markName);
    }
  }, [componentName]);

  // Track interaction performance
  const trackInteraction = useCallback((name: string, duration?: number) => {
    if (!trackInteractions) return;

    if (duration !== undefined) {
      performanceManager.recordInteractionLatency?.(duration);
      interactionTimesRef.current.set(name, duration);
    } else {
      // Start timing
      const startTime = performance.now();
      interactionTimesRef.current.set(`${name}-start`, startTime);
      
      // Return a function to end timing
      return () => {
        const endTime = performance.now();
        const startTime = interactionTimesRef.current.get(`${name}-start`);
        if (startTime) {
          const duration = endTime - startTime;
          performanceManager.recordInteractionLatency?.(duration);
          interactionTimesRef.current.delete(`${name}-start`);
          interactionTimesRef.current.set(name, duration);
        }
      };
    }
  }, [trackInteractions]);

  // Streaming helpers
  const trackStreamingSession = useCallback((sessionId: string) => {
    performanceManager.trackStreamingSession(sessionId);
  }, []);

  const recordStreamingChunk = useCallback((size: number, renderTime: number) => {
    performanceManager.recordStreamingChunk(size, renderTime);
  }, []);

  const recordStreamingError = useCallback(() => {
    performanceManager.recordStreamingError();
  }, []);

  // Cache helpers
  const setCache = useCallback(<T>(key: string, data: T, ttl?: number) => {
    performanceManager.setCache(key, data, ttl);
  }, []);

  const getCache = useCallback(<T>(key: string): T | null => {
    return performanceManager.getCache<T>(key);
  }, []);

  // Mobile helpers
  const addRenderTask = useCallback((task: () => void) => {
    performanceManager.addRenderTask(task);
  }, []);

  return {
    // Performance data
    isOptimizing,
    lastReport,
    performanceScore,
    
    // Actions
    optimize,
    generateReport,
    trackRender,
    trackInteraction,
    
    // Streaming helpers
    trackStreamingSession,
    recordStreamingChunk,
    recordStreamingError,
    
    // Cache helpers
    setCache,
    getCache,
    
    // Mobile helpers
    addRenderTask,
    isLowPowerMode
  };
}

// Hook for component-specific performance tracking
export function useComponentPerformance(componentName: string) {
  const renderStartTime = useRef<number>(0);
  const mountTime = useRef<number>(Date.now());

  useEffect(() => {
    renderStartTime.current = performance.now();
    
    return () => {
      const renderTime = performance.now() - renderStartTime.current;
      if (renderTime > 16) { // More than one frame
        console.warn(`Slow render in ${componentName}: ${renderTime.toFixed(2)}ms`);
      }
    };
  });

  useEffect(() => {
    // Component mounted
    const mountDuration = Date.now() - mountTime.current;
    console.log(`${componentName} mounted in ${mountDuration}ms`);
    
    return () => {
      // Component unmounting
      const totalLifetime = Date.now() - mountTime.current;
      console.log(`${componentName} unmounting after ${totalLifetime}ms`);
    };
  }, [componentName]);

  const trackAsyncOperation = useCallback(async <T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const startTime = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - startTime;
      console.log(`${componentName}.${operationName} completed in ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      console.error(`${componentName}.${operationName} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }, [componentName]);

  return {
    trackAsyncOperation
  };
}

// Hook for streaming performance
export function useStreamingPerformance() {
  const [streamingMetrics, setStreamingMetrics] = useState({
    chunksReceived: 0,
    totalSize: 0,
    averageChunkSize: 0,
    renderLatency: 0,
    errorCount: 0
  });

  const trackChunk = useCallback((size: number, renderTime: number) => {
    setStreamingMetrics(prev => {
      const newChunksReceived = prev.chunksReceived + 1;
      const newTotalSize = prev.totalSize + size;
      const newAverageChunkSize = newTotalSize / newChunksReceived;
      
      return {
        chunksReceived: newChunksReceived,
        totalSize: newTotalSize,
        averageChunkSize: newAverageChunkSize,
        renderLatency: renderTime,
        errorCount: prev.errorCount
      };
    });

    // Also track in performance manager
    performanceManager.recordStreamingChunk(size, renderTime);
  }, []);

  const trackError = useCallback(() => {
    setStreamingMetrics(prev => ({
      ...prev,
      errorCount: prev.errorCount + 1
    }));

    performanceManager.recordStreamingError();
  }, []);

  const resetMetrics = useCallback(() => {
    setStreamingMetrics({
      chunksReceived: 0,
      totalSize: 0,
      averageChunkSize: 0,
      renderLatency: 0,
      errorCount: 0
    });
  }, []);

  return {
    streamingMetrics,
    trackChunk,
    trackError,
    resetMetrics
  };
}

export default usePerformance;