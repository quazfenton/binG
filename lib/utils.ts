import { clsx, type ClassValue } from "clsx";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Mobile utility functions and helpers

/**
 * Device detection utilities
 */
export const deviceUtils = {
  isMobile: () => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 768;
  },

  isTablet: () => {
    if (typeof window === "undefined") return false;
    return window.innerWidth > 768 && window.innerWidth <= 1024;
  },

  isDesktop: () => {
    if (typeof window === "undefined") return true;
    return window.innerWidth > 1024;
  },

  isIOS: () => {
    if (typeof navigator === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  },

  isAndroid: () => {
    if (typeof navigator === "undefined") return false;
    return /Android/.test(navigator.userAgent);
  },

  supportsTouch: () => {
    if (typeof window === "undefined") return false;
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  },

  hasNotch: () => {
    if (typeof window === "undefined") return false;
    const safeAreaTop = getCSSCustomProperty("safe-area-inset-top");
    return safeAreaTop > 20;
  },

  getViewportSize: () => {
    if (typeof window === "undefined") return { width: 0, height: 0 };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  },

  getDevicePixelRatio: () => {
    if (typeof window === "undefined") return 1;
    return window.devicePixelRatio || 1;
  },
};

/**
 * Touch and gesture utilities
 */
export const touchUtils = {
  getTouchDistance: (touch1: Touch, touch2: Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  getTouchCenter: (touch1: Touch, touch2: Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  },

  getSwipeDirection: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => {
    const dx = endX - startX;
    const dy = endY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) < 30) return null; // Too short to be a swipe

    if (absDx > absDy) {
      return dx > 0 ? "right" : "left";
    } else {
      return dy > 0 ? "down" : "up";
    }
  },

  isLongPress: (startTime: number, endTime: number, threshold = 500) => {
    return endTime - startTime > threshold;
  },

  preventBounceScroll: (element: HTMLElement) => {
    let startY = 0;

    element.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
    });

    element.addEventListener("touchmove", (e) => {
      const currentY = e.touches[0].clientY;
      const isScrollingUp = currentY > startY;
      const isScrollingDown = currentY < startY;

      if (
        (element.scrollTop <= 0 && isScrollingUp) ||
        (element.scrollTop + element.clientHeight >= element.scrollHeight &&
          isScrollingDown)
      ) {
        e.preventDefault();
      }
    });
  },
};

/**
 * Responsive utilities
 */
export const responsiveUtils = {
  getBreakpoint: (width: number = window?.innerWidth || 0) => {
    if (width <= 320) return "xs";
    if (width <= 360) return "sm";
    if (width <= 390) return "md";
    if (width <= 414) return "lg";
    if (width <= 768) return "xl";
    return "2xl";
  },

  isBreakpoint: (
    breakpoint: string,
    width: number = window?.innerWidth || 0,
  ) => {
    const breakpoints = {
      xs: 320,
      sm: 360,
      md: 390,
      lg: 414,
      xl: 768,
      "2xl": 1024,
    };
    return width <= (breakpoints[breakpoint as keyof typeof breakpoints] || 0);
  },

  getOptimalFontSize: (
    baseFontSize: number,
    viewport?: { width: number; height: number },
  ) => {
    const vp = viewport || deviceUtils.getViewportSize();
    const scale = Math.min(Math.max(vp.width / 375, 0.8), 1.2);
    return Math.round(baseFontSize * scale);
  },

  getTouchTargetSize: (isMobile = deviceUtils.isMobile()) => {
    return isMobile ? 44 : 32; // iOS HIG recommendation for touch targets
  },

  adaptiveSpacing: (desktop: number, mobile?: number) => {
    const m = mobile ?? Math.max(desktop * 0.75, 8);
    return deviceUtils.isMobile() ? m : desktop;
  },
};

/**
 * Safe area utilities
 */
export const safeAreaUtils = {
  getSafeAreaInsets: () => ({
    top: getCSSCustomProperty("safe-area-inset-top") || 0,
    right: getCSSCustomProperty("safe-area-inset-right") || 0,
    bottom: getCSSCustomProperty("safe-area-inset-bottom") || 0,
    left: getCSSCustomProperty("safe-area-inset-left") || 0,
  }),

  applySafeArea: (
    element: HTMLElement,
    sides: ("top" | "right" | "bottom" | "left")[] = [
      "top",
      "right",
      "bottom",
      "left",
    ],
  ) => {
    const insets = safeAreaUtils.getSafeAreaInsets();

    sides.forEach((side) => {
      element.style.setProperty(`padding-${side}`, `${insets[side]}px`);
    });
  },

  getSafeAreaAdjustedHeight: () => {
    if (typeof window === "undefined") return 0;
    const insets = safeAreaUtils.getSafeAreaInsets();
    return window.innerHeight - insets.top - insets.bottom;
  },
};

/**
 * Network utilities
 */
export const networkUtils = {
  getConnectionInfo: () => {
    if (typeof navigator === "undefined") return null;

    const connection =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    return connection
      ? {
          type: connection.type || "unknown",
          effectiveType: connection.effectiveType || "unknown",
          downlink: connection.downlink || 0,
          rtt: connection.rtt || 0,
          saveData: connection.saveData || false,
        }
      : null;
  },

  isSlowConnection: () => {
    const connection = networkUtils.getConnectionInfo();
    return (
      connection?.effectiveType === "2g" ||
      connection?.effectiveType === "slow-2g"
    );
  },

  shouldReduceData: () => {
    const connection = networkUtils.getConnectionInfo();
    return connection?.saveData || networkUtils.isSlowConnection();
  },

  onNetworkChange: (callback: (isOnline: boolean) => void) => {
    if (typeof window === "undefined") return () => {};

    const handleOnline = () => callback(true);
    const handleOffline = () => callback(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  },
};

/**
 * Performance utilities
 */
export const performanceUtils = {
  debounce: <T extends (...args: any[]) => any>(func: T, delay: number) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(null, args), delay);
    };
  },

  throttle: <T extends (...args: any[]) => any>(func: T, delay: number) => {
    let lastCall = 0;
    return (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        return func.apply(null, args);
      }
    };
  },

  requestIdleCallback: (callback: () => void, timeout = 5000) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      return window.requestIdleCallback(callback, { timeout });
    } else {
      return setTimeout(callback, 1);
    }
  },

  measurePerformance: <T>(name: string, fn: () => T): T => {
    if (typeof performance !== "undefined") {
      const start = performance.now();
      const result = fn();
      const end = performance.now();
      console.debug(`${name} took ${end - start}ms`);
      return result;
    }
    return fn();
  },

  prefersReducedMotion: () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },

  isInViewport: (element: HTMLElement, threshold = 0) => {
    if (typeof window === "undefined") return false;

    const rect = element.getBoundingClientRect();
    const windowHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const windowWidth =
      window.innerWidth || document.documentElement.clientWidth;

    return (
      rect.top >= -threshold &&
      rect.left >= -threshold &&
      rect.bottom <= windowHeight + threshold &&
      rect.right <= windowWidth + threshold
    );
  },
};

/**
 * Accessibility utilities
 */
export const a11yUtils = {
  announce: (message: string) => {
    if (typeof document === "undefined") return;

    const announcer = document.createElement("div");
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
    announcer.className = "sr-only";
    announcer.textContent = message;

    document.body.appendChild(announcer);

    setTimeout(() => {
      document.body.removeChild(announcer);
    }, 1000);
  },

  trapFocus: (container: HTMLElement) => {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    container.addEventListener("keydown", handleTabKey);
    firstElement?.focus();

    return () => {
      container.removeEventListener("keydown", handleTabKey);
    };
  },

  getPreferredColorScheme: () => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  },

  prefersHighContrast: () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-contrast: high)").matches;
  },
};

/**
 * Haptic feedback utilities (iOS only)
 */
export const hapticUtils = {
  impact: (style: "light" | "medium" | "heavy" = "light") => {
    if (!deviceUtils.isIOS() || typeof window === "undefined") return;

    const haptic = (window as any).navigator?.hapticFeedback;
    if (haptic) {
      haptic.impactOccurred(style);
    }
  },

  selection: () => {
    if (!deviceUtils.isIOS() || typeof window === "undefined") return;

    const haptic = (window as any).navigator?.hapticFeedback;
    if (haptic) {
      haptic.selectionChanged();
    }
  },

  notification: (type: "success" | "warning" | "error" = "success") => {
    if (!deviceUtils.isIOS() || typeof window === "undefined") return;

    const haptic = (window as any).navigator?.hapticFeedback;
    if (haptic) {
      haptic.notificationOccurred(type);
    }
  },

  vibrate: (pattern: number | number[] = 50) => {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    navigator.vibrate(pattern);
  },
};

/**
 * Storage utilities with mobile considerations
 */
export const storageUtils = {
  setItem: (key: string, value: any, persistent = true) => {
    try {
      const storage = persistent ? localStorage : sessionStorage;
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("Storage not available:", error);
      return false;
    }
  },

  getItem: <T>(
    key: string,
    defaultValue?: T,
    persistent = true,
  ): T | undefined => {
    try {
      const storage = persistent ? localStorage : sessionStorage;
      const item = storage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.warn("Storage not available:", error);
      return defaultValue;
    }
  },

  removeItem: (key: string, persistent = true) => {
    try {
      const storage = persistent ? localStorage : sessionStorage;
      storage.removeItem(key);
      return true;
    } catch (error) {
      console.warn("Storage not available:", error);
      return false;
    }
  },

  clear: (persistent = true) => {
    try {
      const storage = persistent ? localStorage : sessionStorage;
      storage.clear();
      return true;
    } catch (error) {
      console.warn("Storage not available:", error);
      return false;
    }
  },

  isAvailable: (persistent = true) => {
    try {
      const storage = persistent ? localStorage : sessionStorage;
      const test = "__storage_test__";
      storage.setItem(test, test);
      storage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Helper function to get CSS custom properties
 */
function getCSSCustomProperty(property: string): number {
  if (typeof window === "undefined") return 0;

  const value =
    getComputedStyle(document.documentElement).getPropertyValue(
      `--${property}`,
    ) ||
    getComputedStyle(document.documentElement).getPropertyValue(
      `env(${property})`,
    );

  return parseFloat(value) || 0;
}

/**
 * Format utilities for mobile displays
 */
export const formatUtils = {
  truncateText: (text: string, maxLength: number, ellipsis = "...") => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - ellipsis.length) + ellipsis;
  },

  formatFileSize: (bytes: number) => {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  },

  formatDuration: (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  },

  formatRelativeTime: (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  },
};
