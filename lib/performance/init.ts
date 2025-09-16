/**
 * Performance System Initialization
 * Initialize performance monitoring and optimization on app startup
 */

import { performanceManager } from './performance-manager';
import { mobileOptimizer } from './mobile-optimizer';
import { bundleOptimizer } from './bundle-optimizer';

let isInitialized = false;

export function initializePerformanceSystem() {
  if (isInitialized || typeof window === 'undefined') {
    return;
  }

  console.log('Initializing performance system...');

  try {
    // Configure performance manager based on environment
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isProduction = process.env.NODE_ENV === 'production';

    performanceManager.updateConfig({
      enableMonitoring: true,
      enableMemoryOptimization: true,
      enableCaching: true,
      enableMobileOptimization: true,
      enableBundleOptimization: true,
      autoOptimization: isProduction, // Only auto-optimize in production
      optimizationThresholds: {
        memoryUsage: isDevelopment ? 200 : 100, // More lenient in dev
        frameRate: 30,
        loadTime: 3000,
        batteryLevel: 0.2,
        networkLatency: 1000
      }
    });

    // Detect device type and optimize accordingly
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isTablet = /ipad|android(?!.*mobile)/i.test(userAgent);

    if (isMobile) {
      bundleOptimizer.optimizeForDevice('mobile');
      console.log('Optimized for mobile device');
    } else if (isTablet) {
      bundleOptimizer.optimizeForDevice('tablet');
      console.log('Optimized for tablet device');
    } else {
      bundleOptimizer.optimizeForDevice('desktop');
      console.log('Optimized for desktop device');
    }

    // Preload critical resources
    const criticalResources = [
      '/api/health',
      // Add other critical resources here
    ];

    criticalResources.forEach(resource => {
      bundleOptimizer.preloadResource(resource).catch(error => {
        console.warn(`Failed to preload ${resource}:`, error);
      });
    });

    // Setup performance monitoring callbacks
    performanceManager.onOptimization((report) => {
      if (isDevelopment) {
        console.log('Performance optimization completed:', {
          score: report.score,
          memoryFreed: report.memory.memoryFreed,
          recommendations: report.recommendations
        });
      }

      // Show warning if performance is poor
      if (report.score < 50) {
        console.warn('Poor performance detected. Consider optimizing your application.');
      }
    });

    // Setup error handling for performance system
    window.addEventListener('error', (event) => {
      // Track JavaScript errors that might affect performance
      console.error('JavaScript error detected:', event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      // Track unhandled promise rejections
      console.error('Unhandled promise rejection:', event.reason);
    });

    // Setup visibility change optimization
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // App went to background - optimize for background
        console.log('App backgrounded, optimizing...');
        performanceManager.optimize().catch(error => {
          console.warn('Background optimization failed:', error);
        });
      } else {
        // App came to foreground - restore normal operation
        console.log('App foregrounded, restoring normal operation');
      }
    });

    // Setup memory pressure handling
    if ('memory' in performance) {
      const checkMemoryPressure = () => {
        const memory = (performance as any).memory;
        const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        
        if (usageRatio > 0.8) {
          console.warn('High memory pressure detected, triggering optimization');
          performanceManager.optimize().catch(error => {
            console.error('Emergency optimization failed:', error);
          });
        }
      };

      // Check memory pressure every 30 seconds
      setInterval(checkMemoryPressure, 30000);
    }

    // Setup network change optimization
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      
      const handleNetworkChange = () => {
        const networkType = connection.effectiveType;
        console.log(`Network changed to: ${networkType}`);
        
        // Adjust optimizations based on network speed
        if (networkType === 'slow-2g' || networkType === '2g') {
          // Enable aggressive optimizations for slow networks
          mobileOptimizer.forceOptimization();
        }
      };

      connection.addEventListener('change', handleNetworkChange);
      handleNetworkChange(); // Initial check
    }

    // Setup battery optimization
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const handleBatteryChange = () => {
          if (battery.level < 0.2 && !battery.charging) {
            console.log('Low battery detected, enabling power saving mode');
            mobileOptimizer.forceOptimization();
          }
        };

        battery.addEventListener('levelchange', handleBatteryChange);
        battery.addEventListener('chargingchange', handleBatteryChange);
        handleBatteryChange(); // Initial check
      }).catch((error: any) => {
        console.warn('Battery API not available:', error);
      });
    }

    // Initialize performance monitoring in development
    if (isDevelopment) {
      // Log performance metrics every minute in development
      setInterval(async () => {
        try {
          const report = await performanceManager.generatePerformanceReport();
          console.log('Performance metrics:', {
            score: report.score,
            memoryUsage: `${(report.overall.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            frameRate: `${report.overall.ui.frameRate} FPS`,
            networkLatency: `${report.overall.network.averageLatency.toFixed(2)} ms`
          });
        } catch (error) {
          console.warn('Failed to generate performance report:', error);
        }
      }, 60000);
    }

    isInitialized = true;
    console.log('Performance system initialized successfully');

  } catch (error) {
    console.error('Failed to initialize performance system:', error);
  }
}

// Auto-initialize when this module is imported
if (typeof window !== 'undefined') {
  // Initialize after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePerformanceSystem);
  } else {
    // DOM is already ready
    setTimeout(initializePerformanceSystem, 0);
  }
}

export default initializePerformanceSystem;