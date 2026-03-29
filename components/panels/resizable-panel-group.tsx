/**
 * Enhanced Resizable Panel Group with Drag-to-Snap
 *
 * Features:
 * - Smooth responsive resizing with CSS transitions
 * - Drag-to-snap functionality for borders
 * - Memory-efficient requestAnimationFrame-based rendering
 * - Touch/mouse/keyboard support
 * - Edge case handling (min/max bounds, viewport changes)
 * - Persistent panel sizes in localStorage
 * - Snap zones with haptic feedback visual indicators
 *
 * @see docs/PANEL_RESIZING_IMPLEMENTATION.md for detailed documentation
 */

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { GripVertical, GripHorizontal, Maximize2, Minimize2 } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface PanelSize {
  width?: number;
  height?: number;
}

export interface PanelBounds {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface SnapZone {
  position: number;
  tolerance: number;
  type: "left" | "right" | "top" | "bottom" | "center";
  label?: string;
}

export interface ResizablePanelGroupProps {
  children: React.ReactNode;
  orientation?: "horizontal" | "vertical";
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  snapPoints?: number[];
  snapTolerance?: number;
  storageKey?: string;
  onSizeChange?: (size: number) => void;
  className?: string;
  panelClassName?: string;
  handleClassName?: string;
  showSnapIndicators?: boolean;
  enableKeyboardShortcuts?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SNAP_TOLERANCE = 15; // pixels
const RESIZE_THROTTLE = 16; // ~60fps
const STORAGE_PREFIX = "bing-panel-";
const SNAP_ANIMATION_DURATION = 0.2;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Save panel size to localStorage with throttling
 */
const saveToStorage = (() => {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (key: string, value: number) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
      } catch (e) {
        console.warn("Failed to save panel size to localStorage:", e);
      }
    }, 500);
  };
})();

/**
 * Load panel size from localStorage
 */
function loadFromStorage(key: string, defaultValue: number): number {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored !== null) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load panel size from localStorage:", e);
  }
  return defaultValue;
}

/**
 * Find nearest snap point
 */
function findNearestSnapPoint(
  value: number,
  snapPoints: number[],
  tolerance: number
): { snapPoint: number; distance: number } | null {
  let nearest: { snapPoint: number; distance: number } | null = null;
  
  for (const snap of snapPoints) {
    const distance = Math.abs(value - snap);
    if (distance <= tolerance) {
      if (!nearest || distance < nearest.distance) {
        nearest = { snapPoint: snap, distance };
      }
    }
  }
  
  return nearest;
}

// ============================================================================
// Main Component
// ============================================================================

export function ResizablePanelGroup({
  children,
  orientation = "vertical",
  defaultSize = 300,
  minSize = 100,
  maxSize,
  snapPoints = [],
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
  storageKey,
  onSizeChange,
  className,
  panelClassName,
  handleClassName,
  showSnapIndicators = true,
  enableKeyboardShortcuts = true,
}: ResizablePanelGroupProps) {
  // State
  const [size, setSize] = useState(() => {
    if (storageKey) {
      return loadFromStorage(storageKey, defaultSize);
    }
    return defaultSize;
  });
  
  const [isDragging, setIsDragging] = useState(false);
  const [snapIndicator, setSnapIndicator] = useState<{ position: number; label?: string } | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [previousSize, setPreviousSize] = useState<number | null>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);
  const lastResizeTime = useRef<number>(0);
  const dragStartRef = useRef({
    startPosition: 0,
    startSize: 0,
  });

  // Compute max size based on viewport
  const computedMaxSize = useMemo(() => {
    if (maxSize) return maxSize;
    
    if (typeof window === "undefined") {
      return orientation === "vertical" ? 800 : 1200;
    }
    
    const viewportSize = orientation === "vertical"
      ? window.innerHeight
      : window.innerWidth;
    
    return Math.floor(viewportSize * 0.75);
  }, [maxSize, orientation]);

  // Compute snap zones for visual indicators
  const snapZones = useMemo<SnapZone[]>(() => {
    return snapPoints.map(position => ({
      position,
      tolerance: snapTolerance,
      type: orientation === "vertical" ? "top" : "left",
    }));
  }, [snapPoints, snapTolerance, orientation]);

  // Update size with validation and callbacks
  const updateSize = useCallback((newSize: number, force = false) => {
    const now = Date.now();
    
    // Throttle resize updates
    if (!force && now - lastResizeTime.current < RESIZE_THROTTLE) {
      return;
    }
    
    lastResizeTime.current = now;
    
    // Clamp to bounds
    const clampedSize = Math.max(minSize, Math.min(newSize, computedMaxSize));
    
    setSize(clampedSize);
    
    // Save to storage
    if (storageKey) {
      saveToStorage(storageKey, clampedSize);
    }
    
    // Callback
    if (onSizeChange) {
      onSizeChange(clampedSize);
    }
  }, [minSize, computedMaxSize, storageKey, onSizeChange]);

  // Find and snap to nearest snap point
  const snapToNearest = useCallback((currentSize: number) => {
    const snap = findNearestSnapPoint(currentSize, snapPoints, snapTolerance);
    
    if (snap) {
      setSnapIndicator({
        position: snap.snapPoint,
        label: `${Math.round((snap.snapPoint / (orientation === "vertical" ? window.innerHeight : window.innerWidth)) * 100)}%`,
      });
      
      // Animate to snap point
      setTimeout(() => {
        updateSize(snap.snapPoint, true);
        setSnapIndicator(null);
      }, SNAP_ANIMATION_DURATION * 1000);
    }
  }, [snapPoints, snapTolerance, orientation, updateSize]);

  // Mouse/Touch event handlers
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    
    const clientPos = "touches" in e ? e.touches[0].clientY : e.clientY;
    
    dragStartRef.current = {
      startPosition: clientPos,
      startSize: size,
    };
    
    setIsDragging(true);
    setPreviousSize(size);
  }, [size]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    
    const clientPos = "touches" in e ? e.touches[0].clientY : e.clientY;
    const delta = clientPos - dragStartRef.current.startPosition;
    
    // For vertical orientation, dragging down increases size
    // For horizontal, dragging right increases size
    const newSize = dragStartRef.current.startSize + (orientation === "vertical" ? delta : -delta);
    
    // Use RAF for smooth updates
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
    }
    
    rafId.current = requestAnimationFrame(() => {
      updateSize(newSize);
      
      // Check for snap
      if (snapPoints.length > 0 && showSnapIndicators) {
        snapToNearest(newSize);
      }
    });
  }, [isDragging, orientation, updateSize, snapPoints, snapToNearest, showSnapIndicators]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    
    // Final snap check
    if (snapPoints.length > 0) {
      snapToNearest(size);
    }
  }, [snapPoints, size, snapToNearest]);

  // Set up global event listeners
  useEffect(() => {
    if (!isDragging) return;
    
    const moveHandler = (e: Event) => {
      handleDragMove(e as MouseEvent | TouchEvent);
    };
    
    const endHandler = () => {
      handleDragEnd();
    };
    
    document.addEventListener("mousemove", moveHandler, { passive: true });
    document.addEventListener("mouseup", endHandler);
    document.addEventListener("touchmove", moveHandler, { passive: true });
    document.addEventListener("touchend", endHandler);
    
    return () => {
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("mouseup", endHandler);
      document.removeEventListener("touchmove", moveHandler);
      document.removeEventListener("touchend", endHandler);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if focused on panel or handle
      if (!containerRef.current?.contains(document.activeElement)) {
        return;
      }
      
      const step = e.shiftKey ? 50 : 10;
      
      switch (e.key) {
        case "ArrowUp":
        case "ArrowRight":
          if (orientation === "vertical" || e.key === "ArrowRight") {
            e.preventDefault();
            updateSize(size + step);
          }
          break;
        case "ArrowDown":
        case "ArrowLeft":
          if (orientation === "vertical" || e.key === "ArrowLeft") {
            e.preventDefault();
            updateSize(size - step);
          }
          break;
        case "m":
        case "M":
          e.preventDefault();
          handleToggleMaximize();
          break;
      }
    };
    
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [size, orientation, enableKeyboardShortcuts, updateSize]);

  // Handle viewport resize
  useEffect(() => {
    const handleResize = () => {
      // Ensure size is still within bounds after viewport change
      if (size > computedMaxSize) {
        updateSize(computedMaxSize, true);
      } else if (size < minSize) {
        updateSize(minSize, true);
      }
    };
    
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [size, computedMaxSize, minSize, updateSize]);

  // Toggle maximize/restore
  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      // Restore to previous size
      if (previousSize !== null) {
        updateSize(previousSize, true);
      }
      setIsMaximized(false);
      setPreviousSize(null);
    } else {
      // Save current size and maximize
      setPreviousSize(size);
      updateSize(computedMaxSize, true);
      setIsMaximized(true);
    }
  }, [isMaximized, previousSize, size, computedMaxSize, updateSize]);

  // Auto-snap to border when dragged very close
  const handleDragNearBorder = useCallback(() => {
    const borderSnapThreshold = 5;
    
    if (size <= minSize + borderSnapThreshold) {
      updateSize(minSize, true);
    } else if (size >= computedMaxSize - borderSnapThreshold) {
      updateSize(computedMaxSize, true);
    }
  }, [size, minSize, computedMaxSize, updateSize]);

  // Call border snap check when dragging ends
  useEffect(() => {
    if (!isDragging && previousSize !== null) {
      handleDragNearBorder();
    }
  }, [isDragging, previousSize, handleDragNearBorder]);

  // Render
  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex",
        orientation === "vertical" ? "flex-col" : "flex-row",
        className
      )}
      style={{
        [orientation === "vertical" ? "height" : "width"]: "100%",
      }}
    >
      {/* Main Panel Content */}
      <motion.div
        className={cn(
          "relative overflow-hidden",
          orientation === "vertical" ? "w-full" : "h-full",
          panelClassName
        )}
        style={{
          [orientation === "vertical" ? "height" : "width"]: isMaximized ? "100%" : size,
          [orientation === "vertical" ? "minHeight" : "minWidth"]: minSize,
          [orientation === "vertical" ? "maxHeight" : "maxWidth"]: computedMaxSize,
        }}
        animate={{
          [orientation === "vertical" ? "height" : "width"]: isMaximized ? "100%" : size,
        }}
        transition={{
          duration: isDragging ? 0 : 0.1,
          ease: "easeOut",
        }}
      >
        {children}
      </motion.div>

      {/* Resize Handle */}
      <div
        className={cn(
          "relative z-50 flex items-center justify-center",
          orientation === "vertical"
            ? "h-2 w-full cursor-ns-resize -mt-1"
            : "w-2 h-full cursor-ew-resize -ml-1",
          isDragging && "bg-white/10",
          handleClassName
        )}
        onMouseDown={handleDragStart as any}
        onTouchStart={handleDragStart as any}
        role="separator"
        aria-orientation={orientation}
        aria-valuemin={minSize}
        aria-valuemax={computedMaxSize}
        aria-valuenow={Math.round(size)}
        tabIndex={0}
      >
        {/* Handle Grip */}
        <div
          className={cn(
            "absolute flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors",
            orientation === "vertical"
              ? "h-1 w-12"
              : "w-1 h-12"
          )}
        >
          {orientation === "vertical" ? (
            <GripHorizontal className="w-3 h-3 text-white/60" />
          ) : (
            <GripVertical className="w-3 h-3 text-white/60" />
          )}
        </div>

        {/* Maximize/Restore Button */}
        <button
          onClick={handleToggleMaximize}
          className={cn(
            "absolute right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity",
            "bg-white/10 hover:bg-white/20 text-white/60 hover:text-white"
          )}
          title={isMaximized ? "Restore" : "Maximize"}
          tabIndex={-1}
        >
          {isMaximized ? (
            <Minimize2 className="w-3 h-3" />
          ) : (
            <Maximize2 className="w-3 h-3" />
          )}
        </button>

        {/* Snap Indicator */}
        <AnimatePresence>
          {snapIndicator && showSnapIndicators && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={cn(
                "absolute px-2 py-1 rounded text-xs font-medium bg-white/90 text-black shadow-lg",
                orientation === "vertical"
                  ? "top-full mt-1"
                  : "left-full ml-1"
              )}
            >
              {snapIndicator.label || "Snap"}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Snap Zone Indicators (visible when dragging) */}
      <AnimatePresence>
        {isDragging && showSnapIndicators && snapZones.map((zone, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "absolute bg-white/10 border border-white/20",
              orientation === "vertical"
                ? "left-0 right-0 h-px"
                : "top-0 bottom-0 w-px",
              zone.type === "top" || zone.type === "left"
                ? orientation === "vertical"
                  ? { top: zone.position }
                  : { left: zone.position }
                : {}
            )}
            style={{
              [orientation === "vertical" ? "top" : "left"]: zone.position,
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Preset Configurations
// ============================================================================

export const PanelPresets = {
  bottomPanel: {
    orientation: "vertical" as const,
    minSize: 200,
    maxSize: 600,
    defaultSize: 320,
    snapPoints: [250, 400, 500],
    storageKey: "bottom-panel-size",
  },
  rightPanel: {
    orientation: "horizontal" as const,
    minSize: 250,
    maxSize: 800,
    defaultSize: 400,
    snapPoints: [300, 450, 600],
    storageKey: "right-panel-size",
  },
  topPanel: {
    orientation: "vertical" as const,
    minSize: 300,
    maxSize: 700,
    defaultSize: 450,
    snapPoints: [400, 550],
    storageKey: "top-panel-size",
  },
};

export default ResizablePanelGroup;
