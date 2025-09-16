import { useCallback, useRef, useEffect } from 'react'
import { useResponsiveLayout } from './use-responsive-layout'

interface TouchHandlerOptions {
  onTap?: (event: TouchEvent | MouseEvent) => void
  onDoubleTap?: (event: TouchEvent | MouseEvent) => void
  onLongPress?: (event: TouchEvent | MouseEvent) => void
  onSwipeLeft?: (event: TouchEvent) => void
  onSwipeRight?: (event: TouchEvent) => void
  onSwipeUp?: (event: TouchEvent) => void
  onSwipeDown?: (event: TouchEvent) => void
  longPressDelay?: number
  swipeThreshold?: number
  doubleTapDelay?: number
  preventDefaultOnTouch?: boolean
}

interface TouchState {
  startX: number
  startY: number
  startTime: number
  lastTapTime: number
  tapCount: number
  isLongPress: boolean
  longPressTimer: NodeJS.Timeout | null
}

export function useTouchHandler(options: TouchHandlerOptions = {}) {
  const {
    onTap,
    onDoubleTap,
    onLongPress,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    longPressDelay = 500,
    swipeThreshold = 50,
    doubleTapDelay = 300,
    preventDefaultOnTouch = false
  } = options

  const layout = useResponsiveLayout()
  const touchState = useRef<TouchState>({
    startX: 0,
    startY: 0,
    startTime: 0,
    lastTapTime: 0,
    tapCount: 0,
    isLongPress: false,
    longPressTimer: null
  })

  const clearLongPressTimer = useCallback(() => {
    if (touchState.current.longPressTimer) {
      clearTimeout(touchState.current.longPressTimer)
      touchState.current.longPressTimer = null
    }
  }, [])

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (preventDefaultOnTouch) {
      event.preventDefault()
    }

    const touch = event.touches[0]
    const now = Date.now()

    touchState.current.startX = touch.clientX
    touchState.current.startY = touch.clientY
    touchState.current.startTime = now
    touchState.current.isLongPress = false

    // Clear any existing long press timer
    clearLongPressTimer()

    // Start long press timer
    if (onLongPress) {
      touchState.current.longPressTimer = setTimeout(() => {
        touchState.current.isLongPress = true
        onLongPress(event)
      }, longPressDelay)
    }
  }, [onLongPress, longPressDelay, clearLongPressTimer, preventDefaultOnTouch])

  const handleTouchMove = useCallback((event: TouchEvent) => {
    const touch = event.touches[0]
    const deltaX = Math.abs(touch.clientX - touchState.current.startX)
    const deltaY = Math.abs(touch.clientY - touchState.current.startY)

    // If user moves finger significantly, cancel long press
    if (deltaX > 10 || deltaY > 10) {
      clearLongPressTimer()
    }
  }, [clearLongPressTimer])

  const handleTouchEnd = useCallback((event: TouchEvent) => {
    clearLongPressTimer()

    // Don't process tap if it was a long press
    if (touchState.current.isLongPress) {
      return
    }

    const touch = event.changedTouches[0]
    const endX = touch.clientX
    const endY = touch.clientY
    const deltaX = endX - touchState.current.startX
    const deltaY = endY - touchState.current.startY
    const deltaTime = Date.now() - touchState.current.startTime

    // Check for swipe gestures
    if (Math.abs(deltaX) > swipeThreshold || Math.abs(deltaY) > swipeThreshold) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight(event)
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft(event)
        }
      } else {
        // Vertical swipe
        if (deltaY > 0 && onSwipeDown) {
          onSwipeDown(event)
        } else if (deltaY < 0 && onSwipeUp) {
          onSwipeUp(event)
        }
      }
      return
    }

    // Handle tap gestures
    const now = Date.now()
    const timeSinceLastTap = now - touchState.current.lastTapTime

    if (timeSinceLastTap < doubleTapDelay) {
      // Double tap
      touchState.current.tapCount++
      if (touchState.current.tapCount === 2 && onDoubleTap) {
        onDoubleTap(event)
        touchState.current.tapCount = 0
        return
      }
    } else {
      touchState.current.tapCount = 1
    }

    touchState.current.lastTapTime = now

    // Single tap (with delay to check for double tap)
    if (onTap) {
      setTimeout(() => {
        if (touchState.current.tapCount === 1) {
          onTap(event)
          touchState.current.tapCount = 0
        }
      }, doubleTapDelay)
    }
  }, [onTap, onDoubleTap, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, swipeThreshold, doubleTapDelay, clearLongPressTimer])

  // Mouse event handlers for desktop compatibility
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (layout.isMobile) return // Only handle mouse events on desktop

    const now = Date.now()
    touchState.current.startX = event.clientX
    touchState.current.startY = event.clientY
    touchState.current.startTime = now
    touchState.current.isLongPress = false

    clearLongPressTimer()

    if (onLongPress) {
      touchState.current.longPressTimer = setTimeout(() => {
        touchState.current.isLongPress = true
        onLongPress(event)
      }, longPressDelay)
    }
  }, [layout.isMobile, onLongPress, longPressDelay, clearLongPressTimer])

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (layout.isMobile) return

    clearLongPressTimer()

    if (touchState.current.isLongPress) {
      return
    }

    const now = Date.now()
    const timeSinceLastTap = now - touchState.current.lastTapTime

    if (timeSinceLastTap < doubleTapDelay) {
      touchState.current.tapCount++
      if (touchState.current.tapCount === 2 && onDoubleTap) {
        onDoubleTap(event)
        touchState.current.tapCount = 0
        return
      }
    } else {
      touchState.current.tapCount = 1
    }

    touchState.current.lastTapTime = now

    if (onTap) {
      setTimeout(() => {
        if (touchState.current.tapCount === 1) {
          onTap(event)
          touchState.current.tapCount = 0
        }
      }, doubleTapDelay)
    }
  }, [layout.isMobile, onTap, onDoubleTap, doubleTapDelay, clearLongPressTimer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLongPressTimer()
    }
  }, [clearLongPressTimer])

  return {
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp
    },
    isTouchDevice: layout.isMobile
  }
}

// Utility hook for keyboard handling on mobile
export function useKeyboardHandler() {
  const layout = useResponsiveLayout()

  const handleKeyDown = useCallback((event: KeyboardEvent, callback: () => void) => {
    // On mobile, treat Enter key as tap
    if (layout.isMobile && event.key === 'Enter') {
      event.preventDefault()
      callback()
    }
    // On desktop, handle both Enter and Space
    else if (!layout.isMobile && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      callback()
    }
  }, [layout.isMobile])

  return {
    handleKeyDown,
    isMobile: layout.isMobile
  }
}