import { useState, useEffect, useCallback } from 'react'

export interface ResponsiveBreakpoints {
  xs: number    // 320px - iPhone SE, small Android
  sm: number    // 360px - Most Android phones
  md: number    // 390px - iPhone 12/13/14
  lg: number    // 414px - iPhone Pro Max
  xl: number    // 768px - Tablets
  '2xl': number // 1024px - Desktop
}

export interface ResponsiveConfig {
  breakpoints: ResponsiveBreakpoints
  messageBubble: {
    maxWidthPercentage: {
      xs: number
      sm: number
      md: number
      lg: number
      xl: number
      '2xl': number
    }
    padding: {
      xs: string
      sm: string
      md: string
      lg: string
      xl: string
      '2xl': string
    }
    fontSize: {
      xs: string
      sm: string
      md: string
      lg: string
      xl: string
      '2xl': string
    }
    touchTargetSize: {
      xs: string
      sm: string
      md: string
      lg: string
      xl: string
      '2xl': string
    }
  }
}

const defaultConfig: ResponsiveConfig = {
  breakpoints: {
    xs: 320,
    sm: 360,
    md: 390,
    lg: 414,
    xl: 768,
    '2xl': 1024
  },
  messageBubble: {
    maxWidthPercentage: {
      xs: 95,  // Very small screens need more space
      sm: 90,  // Small phones
      md: 85,  // Standard phones
      lg: 85,  // Large phones
      xl: 90,  // Tablets - more width available
      '2xl': 95 // Desktop - maximize width usage
    },
    padding: {
      xs: '12px 16px',
      sm: '14px 18px',
      md: '16px 20px',
      lg: '16px 20px',
      xl: '18px 22px',
      '2xl': '20px 24px'
    },
    fontSize: {
      xs: '14px',
      sm: '15px',
      md: '16px',
      lg: '16px',
      xl: '16px',
      '2xl': '16px'
    },
    touchTargetSize: {
      xs: '32px',
      sm: '36px',
      md: '40px',
      lg: '44px',
      xl: '44px',
      '2xl': '44px'
    }
  }
}

export type BreakpointKey = keyof ResponsiveBreakpoints

export interface KeyboardInfo {
  isVisible: boolean
  height: number
}

export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ResponsiveState {
  currentBreakpoint: BreakpointKey
  screenWidth: number
  screenHeight: number
  isPortrait: boolean
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  isReducedMotion: boolean
  isHighContrast: boolean
  isDarkMode: boolean
  keyboard: KeyboardInfo
  safeArea: SafeAreaInsets
  messageBubbleConfig: {
    maxWidthPercentage: number
    padding: string
    fontSize: string
    touchTargetSize: string
  }
}

export function useResponsiveLayout(config: ResponsiveConfig = defaultConfig): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => {
    // Default state for SSR
    return {
      currentBreakpoint: 'md' as BreakpointKey,
      screenWidth: 390,
      screenHeight: 844,
      isPortrait: true,
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      isReducedMotion: false,
      isHighContrast: false,
      isDarkMode: false,
      keyboard: { isVisible: false, height: 0 },
      safeArea: getInitialSafeArea(),
      messageBubbleConfig: {
        maxWidthPercentage: config.messageBubble.maxWidthPercentage.md,
        padding: config.messageBubble.padding.md,
        fontSize: config.messageBubble.fontSize.md,
        touchTargetSize: config.messageBubble.touchTargetSize.md
      }
    }
  })

  const updateKeyboardInfo = useCallback(() => {
    if (typeof window === 'undefined') return

    const visualViewport = (window as any).visualViewport
    if (!visualViewport) return

    const keyboardHeight = window.innerHeight - visualViewport.height
    const isVisible = keyboardHeight > 50

    setState(prev => ({
      ...prev,
      keyboard: {
        isVisible,
        height: Math.max(0, keyboardHeight)
      }
    }))
  }, [])

  const updateSafeArea = useCallback(() => {
    if (typeof window === 'undefined') return

    const safeArea: SafeAreaInsets = {
      top: getCSSCustomProperty('safe-area-inset-top') || 0,
      right: getCSSCustomProperty('safe-area-inset-right') || 0,
      bottom: getCSSCustomProperty('safe-area-inset-bottom') || 0,
      left: getCSSCustomProperty('safe-area-inset-left') || 0
    }

    setState(prev => ({ ...prev, safeArea }))
  }, [])

  useEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const isPortrait = height > width

      // Determine current breakpoint
      let currentBreakpoint: BreakpointKey = 'xs'
      if (width >= config.breakpoints['2xl']) {
        currentBreakpoint = '2xl'
      } else if (width >= config.breakpoints.xl) {
        currentBreakpoint = 'xl'
      } else if (width >= config.breakpoints.lg) {
        currentBreakpoint = 'lg'
      } else if (width >= config.breakpoints.md) {
        currentBreakpoint = 'md'
      } else if (width >= config.breakpoints.sm) {
        currentBreakpoint = 'sm'
      }

      // Determine device type
      const isMobile = width < config.breakpoints.xl
      const isTablet = width >= config.breakpoints.xl && width < config.breakpoints['2xl']
      const isDesktop = width >= config.breakpoints['2xl']

      setState({
        currentBreakpoint,
        screenWidth: width,
        screenHeight: height,
        isPortrait,
        isMobile,
        isTablet,
        isDesktop,
        isReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        isHighContrast: window.matchMedia('(prefers-contrast: high)').matches,
        isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
        keyboard: { isVisible: false, height: 0 },
        safeArea: getInitialSafeArea(),
        messageBubbleConfig: {
          maxWidthPercentage: config.messageBubble.maxWidthPercentage[currentBreakpoint],
          padding: config.messageBubble.padding[currentBreakpoint],
          fontSize: config.messageBubble.fontSize[currentBreakpoint],
          touchTargetSize: config.messageBubble.touchTargetSize[currentBreakpoint]
        }
      })
    }

    // Initial update
    updateLayout()

    // Listen for resize events
    window.addEventListener('resize', updateLayout)
    window.addEventListener('orientationchange', updateLayout)

    // Media query listeners for accessibility
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const highContrastQuery = window.matchMedia('(prefers-contrast: high)')
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

    reducedMotionQuery.addEventListener('change', updateLayout)
    highContrastQuery.addEventListener('change', updateLayout)
    darkModeQuery.addEventListener('change', updateLayout)

    // Visual viewport (keyboard handling)
    const visualViewport = (window as any).visualViewport
    if (visualViewport) {
      visualViewport.addEventListener('resize', updateKeyboardInfo)
    }

    return () => {
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('orientationchange', updateLayout)
      reducedMotionQuery.removeEventListener('change', updateLayout)
      highContrastQuery.removeEventListener('change', updateLayout)
      darkModeQuery.removeEventListener('change', updateLayout)

      if (visualViewport) {
        visualViewport.removeEventListener('resize', updateKeyboardInfo)
      }
    }
  }, [config, updateKeyboardInfo])

  return state
}

/**
 * Locks scroll position by fixing the body and preserving scroll offset.
 * Useful for mobile modals and overlays.
 */
export function lockScroll(): void {
  if (typeof document === 'undefined') return

  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.top = `-${window.scrollY}px`
  document.body.style.width = '100%'
}

/**
 * Unlocks scroll and restores the previous scroll position.
 */
export function unlockScroll(): void {
  if (typeof document === 'undefined') return

  const scrollY = document.body.style.top
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''

  if (scrollY) {
    window.scrollTo(0, Number.parseInt(scrollY) * -1)
  }
}

/**
 * Scrolls to an element with keyboard-aware offset adjustment.
 */
export function scrollToElement(
  element: HTMLElement,
  options: {
    behavior?: 'smooth' | 'instant'
    block?: 'start' | 'center' | 'end' | 'nearest'
    inline?: 'start' | 'center' | 'end' | 'nearest'
    offset?: number
  } = {}
): void {
  const { behavior = 'smooth', block = 'nearest', inline = 'nearest', offset = 0 } = options

  if (offset !== 0) {
    // When offset is provided, use manual scroll calculation instead of scrollIntoView
    const elementPosition = element.getBoundingClientRect().top + window.scrollY
    const offsetPosition = elementPosition - offset

    window.scrollTo({
      top: offsetPosition,
      behavior
    })
  } else {
    element.scrollIntoView({ behavior, block, inline })
  }
}

export function calculateDynamicWidth(
  screenWidth: number,
  maxWidthPercentage: number,
  minWidth: number = 280,
  maxWidth: number = 1200
): number {
  const calculatedWidth = (screenWidth * maxWidthPercentage) / 100
  return Math.max(minWidth, Math.min(maxWidth, calculatedWidth))
}

export function getOverflowStrategy(
  contentLength: number,
  hasCodeBlocks: boolean,
  hasUrls: boolean,
  screenWidth: number
): 'wrap' | 'scroll' | 'ellipsis' {
  // For very small screens, prioritize wrapping
  if (screenWidth < 360) {
    return 'wrap'
  }

  // For code blocks, use scroll on mobile to preserve formatting
  if (hasCodeBlocks && screenWidth < 768) {
    return 'scroll'
  }

  // For long URLs, use ellipsis on mobile
  if (hasUrls && screenWidth < 768) {
    return 'ellipsis'
  }

  // Default to wrapping for better readability
  return 'wrap'
}

function getInitialSafeArea(): SafeAreaInsets {
  return {
    top: getCSSCustomProperty('safe-area-inset-top') || 0,
    right: getCSSCustomProperty('safe-area-inset-right') || 0,
    bottom: getCSSCustomProperty('safe-area-inset-bottom') || 0,
    left: getCSSCustomProperty('safe-area-inset-left') || 0
  }
}

function getCSSCustomProperty(property: string): number {
  if (typeof window === 'undefined') return 0

  const value =
    getComputedStyle(document.documentElement).getPropertyValue(`--${property}`) ||
    getComputedStyle(document.documentElement).getPropertyValue(`env(${property})`)

  return parseFloat(value) || 0
}
