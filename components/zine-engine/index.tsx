/**
 * Zine Engine - Unbounded Display Automation System
 * 
 * An avant-garde, boundary-breaking content display system that handles
 * multiple data sources with artistic, zine-like layouts and floating UI elements.
 * 
 * Features:
 * - Unbounded/floating display elements (no conventional borders)
 * - Multiple data sources (RSS, webhooks, APIs, cron, files, OAuth platforms)
 * - Rotating artistic templates with dynamic positioning
 * - Visual storytelling automation
 * - Notification system with fade-ins
 * - Modular responsive displays
 * - Custom data form handling
 * - 3rd party integrations (Discord, etc.)
 * 
 * @module @/components/zine-engine
 */

"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type DataSourceType = 
  | "rss"
  | "webhook"
  | "api"
  | "cron"
  | "file"
  | "oauth"
  | "websocket"
  | "manual"
  | "notification";

export type ContentType = 
  | "text"
  | "image"
  | "video"
  | "audio"
  | "mixed"
  | "interactive"
  | "embed";

export type LayoutStyle = 
  | "floating"
  | "scattered"
  | "spiral"
  | "wave"
  | "grid-free"
  | "organic"
  | "typographic"
  | "brutalist"
  | "minimal"
  | "maximal";

export type AnimationStyle = 
  | "fade-in"
  | "fly-in"
  | "typewriter"
  | "rotate-in"
  | "scale-in"
  | "blur-in"
  | "chalk-write"
  | "glitch"
  | "none";

export interface ZineContent {
  id: string;
  type: ContentType;
  title?: string;
  subtitle?: string;
  body?: string;
  media?: string[];
  metadata?: Record<string, any>;
  source?: string;
  createdAt: number;
  expiresAt?: number;
  priority?: number;
  style?: ContentStyle;
  position?: ContentPosition;
  animation?: AnimationStyle;
}

export interface ContentStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  rotation?: number;
  scale?: number;
  letterSpacing?: string;
  lineHeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  shadow?: string;
  border?: string;
  blendMode?: string;
}

export interface ContentPosition {
  x?: number | string;
  y?: number | string;
  vx?: number; // velocity x
  vy?: number; // velocity y
  fixed?: boolean;
  zone?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "random";
}

export interface DataSource {
  id: string;
  type: DataSourceType;
  name: string;
  url?: string;
  config?: Record<string, any>;
  refreshInterval?: number;
  enabled: boolean;
  lastFetched?: number;
  contentFilter?: (data: any) => ZineContent[];
}

export interface ZineTemplate {
  id: string;
  name: string;
  layout: LayoutStyle;
  styles: ContentStyle;
  animation: AnimationStyle;
  transitionDuration?: number;
  contentLimit?: number;
}

export interface ZineEngineProps {
  /** Data sources to fetch content from */
  dataSources?: DataSource[];
  /** Templates to cycle through */
  templates?: ZineTemplate[];
  /** Enable auto-rotation of templates */
  autoRotateTemplates?: boolean;
  /** Template rotation interval (ms) */
  rotationInterval?: number;
  /** Maximum concurrent displayed items */
  maxItems?: number;
  /** Enable notifications */
  enableNotifications?: boolean;
  /** Custom content renderer */
  renderContent?: (content: ZineContent) => React.ReactNode;
  /** On content click */
  onContentClick?: (content: ZineContent) => void;
  /** Debug mode */
  debug?: boolean;
  /** Container className */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEMPLATES: ZineTemplate[] = [
  {
    id: "floating-minimal",
    name: "Floating Minimal",
    layout: "floating",
    styles: {
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      fontWeight: "300",
      color: "rgba(255, 255, 255, 0.9)",
      opacity: 0.8,
      textAlign: "left",
      blendMode: "normal",
    },
    animation: "fade-in",
    transitionDuration: 8000,
    contentLimit: 5,
  },
  {
    id: "typographic-bold",
    name: "Typographic Bold",
    layout: "typographic",
    styles: {
      fontFamily: "Georgia, serif",
      fontSize: "24px",
      fontWeight: "700",
      color: "rgba(255, 255, 255, 0.95)",
      letterSpacing: "0.05em",
      textAlign: "center",
      textTransform: "uppercase",
      shadow: "0 4px 20px rgba(0,0,0,0.3)",
    },
    animation: "typewriter",
    transitionDuration: 10000,
    contentLimit: 3,
  },
  {
    id: "scattered-organic",
    name: "Scattered Organic",
    layout: "scattered",
    styles: {
      fontFamily: "Courier New, monospace",
      fontSize: "12px",
      fontWeight: "400",
      color: "rgba(200, 255, 200, 0.8)",
      rotation: 0,
      opacity: 0.7,
      blendMode: "overlay",
    },
    animation: "fly-in",
    transitionDuration: 6000,
    contentLimit: 8,
  },
  {
    id: "brutalist-raw",
    name: "Brutalist Raw",
    layout: "brutalist",
    styles: {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "32px",
      fontWeight: "900",
      color: "rgba(255, 255, 255, 1)",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      border: "2px solid rgba(255, 255, 255, 0.3)",
      textAlign: "left",
    },
    animation: "glitch",
    transitionDuration: 5000,
    contentLimit: 4,
  },
  {
    id: "spiral-dream",
    name: "Spiral Dream",
    layout: "spiral",
    styles: {
      fontFamily: "Palatino, serif",
      fontSize: "16px",
      fontWeight: "400",
      color: "rgba(255, 200, 255, 0.85)",
      rotation: 0,
      opacity: 0.75,
      blendMode: "screen",
    },
    animation: "rotate-in",
    transitionDuration: 12000,
    contentLimit: 6,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return `zine-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getRandomPosition(zone?: ContentPosition["zone"]): ContentPosition {
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1920;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 1080;
  
  let x, y;
  
  switch (zone) {
    case "top-left":
      x = Math.random() * (viewportW * 0.3);
      y = Math.random() * (viewportH * 0.3);
      break;
    case "top-right":
      x = viewportW * 0.7 + Math.random() * (viewportW * 0.3);
      y = Math.random() * (viewportH * 0.3);
      break;
    case "bottom-left":
      x = Math.random() * (viewportW * 0.3);
      y = viewportH * 0.7 + Math.random() * (viewportH * 0.3);
      break;
    case "bottom-right":
      x = viewportW * 0.7 + Math.random() * (viewportW * 0.3);
      y = viewportH * 0.7 + Math.random() * (viewportH * 0.3);
      break;
    case "center":
      x = viewportW * 0.4 + Math.random() * (viewportW * 0.2);
      y = viewportH * 0.4 + Math.random() * (viewportH * 0.2);
      break;
    case "random":
    default:
      x = Math.random() * viewportW;
      y = Math.random() * viewportH;
      break;
  }
  
  return {
    x: `${x}px`,
    y: `${y}px`,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
  };
}

function getRandomRotation(): number {
  return (Math.random() - 0.5) * 30; // -15 to 15 degrees
}

// ============================================================================
// Floating Content Element
// ============================================================================

interface FloatingContentElementProps {
  content: ZineContent;
  style: ContentStyle;
  animation: AnimationStyle;
  layout: LayoutStyle;
  onClick?: () => void;
  onRemove?: () => void;
  debug?: boolean;
}

function FloatingContentElement({
  content,
  style,
  animation,
  layout,
  onClick,
  onRemove,
  debug,
}: FloatingContentElementProps) {
  const controls = useAnimation();
  const elementRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ContentPosition>(
    content.position || getRandomPosition(content.position?.zone || "random")
  );
  const [rotation, setRotation] = useState(
    content.style?.rotation ?? (layout !== "typographic" ? getRandomRotation() : 0)
  );

  // Animation variants
  const animationVariants = useMemo(() => {
    const base = {
      hidden: { opacity: 0 },
      visible: { 
        opacity: style.opacity ?? 0.8,
        scale: style.scale ?? 1,
        rotate: rotation,
      },
      exit: { opacity: 0, scale: 0.8 },
    };

    switch (animation) {
      case "fade-in":
        return {
          ...base,
          hidden: { opacity: 0 },
          visible: { opacity: style.opacity ?? 0.8 },
        };
      
      case "fly-in":
        return {
          ...base,
          hidden: { 
            opacity: 0, 
            x: position.vx! * -100, 
            y: position.vy! * -100 
          },
          visible: { 
            opacity: style.opacity ?? 0.8,
            x: 0,
            y: 0,
          },
        };
      
      case "typewriter":
        return {
          ...base,
          hidden: { opacity: 0, width: 0 },
          visible: { 
            opacity: style.opacity ?? 0.8,
            width: "auto",
            transition: { duration: 1.5, ease: "easeOut" }
          },
        };
      
      case "rotate-in":
        return {
          ...base,
          hidden: { opacity: 0, rotate: rotation - 180, scale: 0.5 },
          visible: { 
            opacity: style.opacity ?? 0.8,
            rotate: rotation,
            scale: style.scale ?? 1,
          },
        };
      
      case "scale-in":
        return {
          ...base,
          hidden: { opacity: 0, scale: 0 },
          visible: { 
            opacity: style.opacity ?? 0.8,
            scale: style.scale ?? 1,
          },
        };
      
      case "blur-in":
        return {
          ...base,
          hidden: { opacity: 0, filter: "blur(10px)" },
          visible: { 
            opacity: style.opacity ?? 0.8,
            filter: "blur(0px)",
          },
        };
      
      case "glitch":
        return {
          ...base,
          hidden: { 
            opacity: 0, 
            x: -10,
            filter: "hue-rotate(90deg)"
          },
          visible: { 
            opacity: style.opacity ?? 0.8,
            x: 0,
            filter: "hue-rotate(0deg)",
            transition: { duration: 0.3 }
          },
        };
      
      default:
        return base;
    }
  }, [animation, style.opacity, style.scale, rotation, position]);

  // Auto-remove on expiry
  useEffect(() => {
    if (content.expiresAt) {
      const timeToLive = content.expiresAt - Date.now();
      if (timeToLive > 0) {
        const timer = setTimeout(() => {
          controls.start("exit").then(() => onRemove?.());
        }, timeToLive);
        return () => clearTimeout(timer);
      } else {
        controls.start("exit").then(() => onRemove?.());
      }
    }
  }, [content.expiresAt, controls, onRemove]);

  // Floating animation for certain layouts
  useEffect(() => {
    if (layout === "floating" || layout === "scattered" || layout === "organic") {
      const floatAnimation = async () => {
        while (true) {
          await controls.start({
            y: (position.y as number || 0) + Math.sin(Date.now() / 1000) * 10,
            x: (position.x as number || 0) + Math.cos(Date.now() / 1000) * 5,
            transition: { duration: 2, ease: "easeInOut" }
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      };
      
      floatAnimation();
    }
  }, [layout, position, controls]);

  // Render content based on type
  const renderContent = () => {
    switch (content.type) {
      case "image":
        return (
          <div className="relative">
            {content.media?.[0] && (
              <img
                src={content.media[0]}
                alt={content.title}
                className="max-w-full h-auto rounded-lg shadow-lg"
                style={{ mixBlendMode: style.blendMode as any }}
              />
            )}
            {(content.title || content.body) && (
              <div className="mt-2 p-2 bg-black/50 backdrop-blur-sm rounded">
                {content.title && (
                  <h3 style={{ ...style, fontSize: "16px", marginBottom: "4px" }}>
                    {content.title}
                  </h3>
                )}
                {content.body && (
                  <p style={{ ...style, fontSize: "12px", opacity: 0.7 }}>
                    {content.body}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      
      case "video":
        return (
          <div className="relative">
            {content.media?.[0] && (
              <video
                src={content.media[0]}
                autoPlay
                muted
                loop
                className="max-w-full rounded-lg shadow-lg"
                style={{ mixBlendMode: style.blendMode as any }}
              />
            )}
          </div>
        );
      
      case "mixed":
        return (
          <div className="space-y-2">
            {content.title && (
              <h2 style={{ ...style, fontSize: "20px", fontWeight: "700" }}>
                {content.title}
              </h2>
            )}
            {content.subtitle && (
              <h3 style={{ ...style, fontSize: "14px", opacity: 0.7 }}>
                {content.subtitle}
              </h3>
            )}
            {content.body && (
              <p style={style}>{content.body}</p>
            )}
            {content.media?.map((media, i) => (
              <img
                key={i}
                src={media}
                alt=""
                className="max-w-full h-auto rounded"
                style={{ mixBlendMode: style.blendMode as any }}
              />
            ))}
          </div>
        );
      
      default:
        return (
          <div className="space-y-1">
            {content.title && (
              <h2 style={{ ...style, fontSize: "18px", fontWeight: "600" }}>
                {content.title}
              </h2>
            )}
            {content.subtitle && (
              <h3 style={{ ...style, fontSize: "12px", opacity: 0.7 }}>
                {content.subtitle}
              </h3>
            )}
            {content.body && (
              <p style={style}>{content.body}</p>
            )}
          </div>
        );
    }
  };

  return (
    <motion.div
      ref={elementRef}
      initial="hidden"
      animate={controls}
      exit="exit"
      variants={animationVariants}
      className={cn(
        "absolute cursor-pointer select-none",
        layout === "brutalist" ? "p-4" : "p-2"
      )}
      style={{
        left: position.x,
        top: position.y,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        textAlign: style.textAlign,
        textTransform: style.textTransform,
        textShadow: style.shadow,
        border: style.border,
        mixBlendMode: style.blendMode as any,
        zIndex: content.priority || 10,
      }}
      onClick={onClick}
      data-content-id={content.id}
      data-debug={debug ? JSON.stringify(content) : undefined}
    >
      {renderContent()}
      
      {/* Debug info */}
      {debug && (
        <div className="absolute -bottom-4 left-0 text-[8px] text-white/50 bg-black/80 px-1 rounded">
          {content.type} | {content.source || "manual"}
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// Main Zine Engine Component
// ============================================================================

export function ZineEngine({
  dataSources = [],
  templates = DEFAULT_TEMPLATES,
  autoRotateTemplates = true,
  rotationInterval = 30000,
  maxItems = 10,
  enableNotifications = true,
  renderContent,
  onContentClick,
  debug = false,
  className,
}: ZineEngineProps) {
  const [contents, setContents] = useState<ZineContent[]>([]);
  const [currentTemplate, setCurrentTemplate] = useState<ZineTemplate>(templates[0]);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  const controls = useAnimation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch content from data sources
  const fetchFromSources = useCallback(async () => {
    const now = Date.now();
    
    for (const source of dataSources) {
      if (!source.enabled) continue;
      
      // Check refresh interval
      if (source.lastFetched && source.refreshInterval) {
        if (now - source.lastFetched < source.refreshInterval) {
          continue;
        }
      }
      
      try {
        let data: any;
        
        switch (source.type) {
          case "rss":
          case "api":
          case "webhook":
            if (source.url) {
              const response = await fetch(source.url);
              data = await response.json();
            }
            break;
          
          case "cron":
            // Cron sources are triggered externally
            break;
          
          case "file":
            if (source.config?.filePath) {
              // Would need server-side file reading
              console.log("File source:", source.config.filePath);
            }
            break;
          
          case "oauth":
            // OAuth sources would use stored tokens
            if (source.config?.platform && source.config?.endpoint) {
              console.log("OAuth fetch:", source.config.platform);
            }
            break;
          
          case "websocket":
            // WebSocket connections are persistent
            break;
        }
        
        // Transform data using contentFilter if provided
        if (data && source.contentFilter) {
          const newContents = source.contentFilter(data);
          addContents(newContents);
        }
        
        // Update last fetched time
        source.lastFetched = now;
        
      } catch (error) {
        console.error(`Error fetching from ${source.name}:`, error);
      }
    }
  }, [dataSources]);

  // Add new contents
  const addContents = useCallback((newContents: ZineContent[]) => {
    setContents(prev => {
      const combined = [...prev, ...newContents];
      
      // Remove expired content
      const now = Date.now();
      const valid = combined.filter(c => !c.expiresAt || c.expiresAt > now);
      
      // Sort by priority and limit
      const sorted = valid
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, maxItems);
      
      return sorted;
    });
    
    // Show notification if enabled
    if (enableNotifications && newContents.length > 0) {
      toast.info(`New content: ${newContents[0].title || "Untitled"}`, {
        duration: 3000,
      });
    }
  }, [maxItems, enableNotifications]);

  // Remove content
  const removeContent = useCallback((id: string) => {
    setContents(prev => prev.filter(c => c.id !== id));
  }, []);

  // Handle content click
  const handleContentClick = useCallback((content: ZineContent) => {
    onContentClick?.(content);
    
    // Default behavior: show details in toast
    if (content.body) {
      toast(content.title || "Content", {
        description: content.body,
        duration: 5000,
      });
    }
  }, [onContentClick]);

  // Rotate templates
  useEffect(() => {
    if (!autoRotateTemplates || templates.length <= 1) return;
    
    const interval = setInterval(() => {
      setTemplateIndex(prev => (prev + 1) % templates.length);
    }, rotationInterval);
    
    return () => clearInterval(interval);
  }, [autoRotateTemplates, templates.length, rotationInterval]);

  // Update current template
  useEffect(() => {
    setCurrentTemplate(templates[templateIndex]);
  }, [templates, templateIndex]);

  // Initial fetch
  useEffect(() => {
    if (dataSources.length > 0) {
      fetchFromSources();
      setIsInitialized(true);
    }
  }, [dataSources, fetchFromSources]);

  // Periodic fetch
  useEffect(() => {
    if (!isInitialized) return;
    
    const interval = setInterval(fetchFromSources, 5000);
    return () => clearInterval(interval);
  }, [isInitialized, fetchFromSources]);

  // Template transition animation
  useEffect(() => {
    controls.start({
      opacity: [1, 0.5, 1],
      transition: { duration: 1 }
    });
  }, [currentTemplate, controls]);

  return (
    <motion.div
      ref={containerRef}
      className={cn(
        "fixed inset-0 pointer-events-none overflow-hidden",
        className
      )}
      initial={{ opacity: 0 }}
      animate={controls}
      style={{ zIndex: 9999 }}
    >
      {/* Content layer - pointer events enabled for interaction */}
      <div className="absolute inset-0 pointer-events-auto">
        <AnimatePresence>
          {contents.map(content => (
            <FloatingContentElement
              key={content.id}
              content={content}
              style={{ ...currentTemplate.styles, ...content.style }}
              animation={content.animation || currentTemplate.animation}
              layout={currentTemplate.layout}
              onClick={() => handleContentClick(content)}
              onRemove={() => removeContent(content.id)}
              debug={debug}
            />
          ))}
        </AnimatePresence>
      </div>
      
      {/* Debug overlay */}
      {debug && (
        <div className="absolute top-4 right-4 p-4 bg-black/80 text-white text-xs rounded pointer-events-auto">
          <div className="font-bold mb-2">Zine Engine Debug</div>
          <div>Template: {currentTemplate.name}</div>
          <div>Contents: {contents.length}</div>
          <div>Sources: {dataSources.filter(s => s.enabled).length} active</div>
          <button
            onClick={() => {
              addContents([{
                id: generateId(),
                type: "text",
                title: "Test Content",
                body: `Created at ${new Date().toLocaleTimeString()}`,
                createdAt: Date.now(),
                expiresAt: Date.now() + 10000,
              }]);
            }}
            className="mt-2 px-2 py-1 bg-white/20 rounded hover:bg-white/30"
          >
            Add Test
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default ZineEngine;
