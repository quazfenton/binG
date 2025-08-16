"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

// Mobile breakpoints based on common device widths
export const MOBILE_BREAKPOINTS = {
  xs: 320,  // iPhone SE, small Android
  sm: 360,  // Most Android phones
  md: 390,  // iPhone 12/13/14
  lg: 414,  // iPhone Pro Max
  xl: 768,  // Tablets
} as const;

export type BreakpointKey = keyof typeof MOBILE_BREAKPOINTS;

export interface DeviceInfo {
  width: number;
  height: number;
  breakpoint: BreakpointKey;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  orientation: 'portrait' | 'landscape';
  hasNotch: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  supportsTouch: boolean;
  devicePixelRatio: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface KeyboardInfo {
  isVisible: boolean;
  height: number;
  wasVisible: boolean;
}

export interface NetworkInfo {
  isOnline: boolean;
  connectionType: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
  effectiveType: string;
  rtt: number;
  downlink: number;
}

export interface TouchGesture {
  type: 'tap' | 'swipe' | 'pinch' | 'long-press';
  direction?: 'up' | 'down' | 'left' | 'right';
  velocity?: number;
  distance?: number;
  scale?: number;
}

export interface MobileState {
  device: DeviceInfo;
  safeArea: SafeAreaInsets;
  keyboard: KeyboardInfo;
  network: NetworkInfo;
  isReducedMotion: boolean;
  isHighContrast: boolean;
  isDarkMode: boolean;
  lastInteraction: number;
}

export function useEnhancedMobile() {
  const [state, setState] = useState<MobileState>(() => ({
    device: getInitialDeviceInfo(),
    safeArea: getInitialSafeArea(),
    keyboard: { isVisible: false, height: 0, wasVisible: false },
    network: getInitialNetworkInfo(),
    isReducedMotion: false,
    isHighContrast: false,
    isDarkMode: false,
    lastInteraction: Date.now(),
  }));

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const gestureCallbacks = useRef<Map<string, (gesture: TouchGesture) => void>>(new Map());
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get current breakpoint
  const getCurrentBreakpoint = useCallback((width: number): BreakpointKey => {
    if (width <= MOBILE_BREAKPOINTS.xs) return 'xs';
    if (width <= MOBILE_BREAKPOINTS.sm) return 'sm';
    if (width <= MOBILE_BREAKPOINTS.md) return 'md';
    if (width <= MOBILE_BREAKPOINTS.lg) return 'lg';
    return 'xl';
  }, []);

  // Update device info
  const updateDeviceInfo = useCallback(() => {
    if (typeof window === 'undefined') return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const breakpoint = getCurrentBreakpoint(width);

    const deviceInfo: DeviceInfo = {
      width,
      height,
      breakpoint,
      isMobile: width <= MOBILE_BREAKPOINTS.xl,
      isTablet: width > MOBILE_BREAKPOINTS.lg && width <= MOBILE_BREAKPOINTS.xl,
      isDesktop: width > MOBILE_BREAKPOINTS.xl,
      orientation: width > height ? 'landscape' : 'portrait',
      hasNotch: checkForNotch(),
      isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
      isAndroid: /Android/.test(navigator.userAgent),
      supportsTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      devicePixelRatio: window.devicePixelRatio || 1,
    };

    setState(prev => ({ ...prev, device: deviceInfo }));
  }, [getCurrentBreakpoint]);

  // Update safe area insets
  const updateSafeArea = useCallback(() => {
    if (typeof window === 'undefined') return;

    const safeArea: SafeAreaInsets = {
      top: getCSSCustomProperty('safe-area-inset-top') || 0,
      right: getCSSCustomProperty('safe-area-inset-right') || 0,
      bottom: getCSSCustomProperty('safe-area-inset-bottom') || 0,
      left: getCSSCustomProperty('safe-area-inset-left') || 0,
    };

    setState(prev => ({ ...prev, safeArea }));
  }, []);

  // Handle keyboard visibility (mobile)
  const updateKeyboardInfo = useCallback(() => {
    if (typeof window === 'undefined') return;

    const visualViewport = (window as any).visualViewport;
    if (!visualViewport) return;

    const keyboardHeight = window.innerHeight - visualViewport.height;
    const isVisible = keyboardHeight > 50; // 50px threshold for keyboard detection

    setState(prev => ({
      ...prev,
      keyboard: {
        isVisible,
        height: Math.max(0, keyboardHeight),
        wasVisible: prev.keyboard.isVisible,
      },
    }));
  }, []);

  // Update network info
  const updateNetworkInfo = useCallback(() => {
    if (typeof navigator === 'undefined') return;

    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

    const networkInfo: NetworkInfo = {
      isOnline: navigator.onLine,
      connectionType: connection?.type || 'unknown',
      effectiveType: connection?.effectiveType || 'unknown',
      rtt: connection?.rtt || 0,
      downlink: connection?.downlink || 0,
    };

    setState(prev => ({ ...prev, network: networkInfo }));
  }, []);

  // Update accessibility preferences
  const updateAccessibilityInfo = useCallback(() => {
    if (typeof window === 'undefined') return;

    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isHighContrast = window.matchMedia('(prefers-contrast: high)').matches;
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    setState(prev => ({
      ...prev,
      isReducedMotion,
      isHighContrast,
      isDarkMode,
    }));
  }, []);

  // Handle window resize with debouncing
  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = setTimeout(() => {
      updateDeviceInfo();
      updateSafeArea();
      updateKeyboardInfo();
    }, 150); // Debounce resize events
  }, [updateDeviceInfo, updateSafeArea, updateKeyboardInfo]);

  // Touch gesture detection
  const handleTouchStart = useCallback((event: TouchEvent) => {
    const touch = event.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };

    setState(prev => ({ ...prev, lastInteraction: Date.now() }));
  }, []);

  const handleTouchEnd = useCallback((event: TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = event.changedTouches[0];
    const startTouch = touchStartRef.current;
    const endTime = Date.now();

    const deltaX = touch.clientX - startTouch.x;
    const deltaY = touch.clientY - startTouch.y;
    const deltaTime = endTime - startTouch.time;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Detect gesture type
    let gesture: TouchGesture;

    if (deltaTime > 500 && distance < 10) {
      // Long press
      gesture = { type: 'long-press' };
    } else if (distance < 10) {
      // Tap
      gesture = { type: 'tap' };
    } else if (distance > 50) {
      // Swipe
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      let direction: 'up' | 'down' | 'left' | 'right';

      if (absX > absY) {
        direction = deltaX > 0 ? 'right' : 'left';
      } else {
        direction = deltaY > 0 ? 'down' : 'up';
      }

      gesture = {
        type: 'swipe',
        direction,
        velocity: distance / deltaTime,
        distance,
      };
    } else {
      return; // No gesture detected
    }

    // Emit gesture to registered callbacks
    gestureCallbacks.current.forEach(callback => callback(gesture));
    touchStartRef.current = null;
  }, []);

  // Register gesture callback
  const onGesture = useCallback((id: string, callback: (gesture: TouchGesture) => void) => {
    gestureCallbacks.current.set(id, callback);

    return () => {
      gestureCallbacks.current.delete(id);
    };
  }, []);

  // Scroll utilities
  const scrollToElement = useCallback((
    element: HTMLElement,
    options: {
      behavior?: 'smooth' | 'instant';
      block?: 'start' | 'center' | 'end' | 'nearest';
      inline?: 'start' | 'center' | 'end' | 'nearest';
      offset?: number;
    } = {}
  ) => {
    const { behavior = 'smooth', block = 'nearest', inline = 'nearest', offset = 0 } = options;

    // Account for safe area and keyboard
    let elementTop = element.offsetTop;
    if (offset !== 0) {
      elementTop += offset;
    }

    // Adjust for keyboard if visible
    if (state.keyboard.isVisible) {
      const availableHeight = window.innerHeight - state.keyboard.height - state.safeArea.bottom;
      if (elementTop + element.offsetHeight > availableHeight) {
        elementTop = Math.max(0, elementTop - (state.keyboard.height / 2));
      }
    }

    element.scrollIntoView({ behavior, block, inline });
  }, [state.keyboard, state.safeArea]);

  // Lock scroll (useful for modals on mobile)
  const lockScroll = useCallback(() => {
    if (typeof document === 'undefined') return;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${window.scrollY}px`;
    document.body.style.width = '100%';
  }, []);

  const unlockScroll = useCallback(() => {
    if (typeof document === 'undefined') return;

    const scrollY = document.body.style.top;
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';

    if (scrollY) {
      window.scrollTo(0, parseInt(scrollY) * -1);
    }
  }, []);

  // Haptic feedback (iOS only)
  const hapticFeedback = useCallback((type: 'light' | 'medium' | 'heavy' | 'selection' = 'light') => {
    if (typeof window === 'undefined' || !state.device.isIOS) return;

    const haptic = (window as any).navigator?.hapticFeedback;
    if (haptic) {
      switch (type) {
        case 'light':
          haptic.impactOccurred('light');
          break;
        case 'medium':
          haptic.impactOccurred('medium');
          break;
        case 'heavy':
          haptic.impactOccurred('heavy');
          break;
        case 'selection':
          haptic.selectionChanged();
          break;
      }
    }
  }, [state.device.isIOS]);

  // Initialize and set up event listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initial setup
    updateDeviceInfo();
    updateSafeArea();
    updateNetworkInfo();
    updateAccessibilityInfo();

    // Window event listeners
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    window.addEventListener('online', updateNetworkInfo);
    window.addEventListener('offline', updateNetworkInfo);

    // Visual viewport (keyboard handling)
    const visualViewport = (window as any).visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', updateKeyboardInfo);
    }

    // Touch events
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Media query listeners for accessibility
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const highContrastQuery = window.matchMedia('(prefers-contrast: high)');
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

    reducedMotionQuery.addEventListener('change', updateAccessibilityInfo);
    highContrastQuery.addEventListener('change', updateAccessibilityInfo);
    darkModeQuery.addEventListener('change', updateAccessibilityInfo);

    // Network connection changes
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', updateNetworkInfo);
    }

    return () => {
      // Cleanup
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      window.removeEventListener('online', updateNetworkInfo);
      window.removeEventListener('offline', updateNetworkInfo);

      if (visualViewport) {
        visualViewport.removeEventListener('resize', updateKeyboardInfo);
      }

      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);

      reducedMotionQuery.removeEventListener('change', updateAccessibilityInfo);
      highContrastQuery.removeEventListener('change', updateAccessibilityInfo);
      darkModeQuery.removeEventListener('change', updateAccessibilityInfo);

      if (connection) {
        connection.removeEventListener('change', updateNetworkInfo);
      }

      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  return {
    // State
    ...state,

    // Utilities
    getCurrentBreakpoint,
    onGesture,
    scrollToElement,
    lockScroll,
    unlockScroll,
    hapticFeedback,

    // Helper functions for responsive design
    isBreakpoint: (breakpoint: BreakpointKey) => state.device.breakpoint === breakpoint,
    isMinBreakpoint: (breakpoint: BreakpointKey) =>
      state.device.width >= MOBILE_BREAKPOINTS[breakpoint],
    isMaxBreakpoint: (breakpoint: BreakpointKey) =>
      state.device.width <= MOBILE_BREAKPOINTS[breakpoint],

    // Touch target helpers
    getTouchTargetSize: () => state.device.isMobile ? 44 : 32,
    getOptimalFontSize: (baseFontSize: number) => {
      const scale = Math.min(Math.max(state.device.width / 375, 0.8), 1.2);
      return baseFontSize * scale;
    },
  };
}

// Helper functions
function getInitialDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      width: 0,
      height: 0,
      breakpoint: 'xl',
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      orientation: 'portrait',
      hasNotch: false,
      isIOS: false,
      isAndroid: false,
      supportsTouch: false,
      devicePixelRatio: 1,
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    width,
    height,
    breakpoint: width <= MOBILE_BREAKPOINTS.xl ? 'lg' : 'xl',
    isMobile: width <= MOBILE_BREAKPOINTS.xl,
    isTablet: width > MOBILE_BREAKPOINTS.lg && width <= MOBILE_BREAKPOINTS.xl,
    isDesktop: width > MOBILE_BREAKPOINTS.xl,
    orientation: width > height ? 'landscape' : 'portrait',
    hasNotch: checkForNotch(),
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
    isAndroid: /Android/.test(navigator.userAgent),
    supportsTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

function getInitialSafeArea(): SafeAreaInsets {
  return {
    top: getCSSCustomProperty('safe-area-inset-top') || 0,
    right: getCSSCustomProperty('safe-area-inset-right') || 0,
    bottom: getCSSCustomProperty('safe-area-inset-bottom') || 0,
    left: getCSSCustomProperty('safe-area-inset-left') || 0,
  };
}

function getInitialNetworkInfo(): NetworkInfo {
  if (typeof navigator === 'undefined') {
    return {
      isOnline: true,
      connectionType: 'unknown',
      effectiveType: 'unknown',
      rtt: 0,
      downlink: 0,
    };
  }

  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

  return {
    isOnline: navigator.onLine,
    connectionType: connection?.type || 'unknown',
    effectiveType: connection?.effectiveType || 'unknown',
    rtt: connection?.rtt || 0,
    downlink: connection?.downlink || 0,
  };
}

function checkForNotch(): boolean {
  if (typeof window === 'undefined') return false;

  // Check for notch indicators
  const safeAreaTop = getCSSCustomProperty('safe-area-inset-top');
  return safeAreaTop > 20; // iPhones with notch typically have > 20px top inset
}

function getCSSCustomProperty(property: string): number {
  if (typeof window === 'undefined') return 0;

  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${property}`) ||
    getComputedStyle(document.documentElement).getPropertyValue(`env(${property})`);

  return parseFloat(value) || 0;
}
