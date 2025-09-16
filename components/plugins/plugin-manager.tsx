"use client"

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  X, 
  Maximize2, 
  Minimize2, 
  Move,
  Settings,
  Sparkles,
  Code,
  FileText,
  Image,
  Calculator,
  Globe,
  Database,
  Zap,
  Shield,
  AlertTriangle
} from 'lucide-react';
import { EnhancedPluginWrapper } from './enhanced-plugin-wrapper';
import { enhancedPluginManager, EnhancedPlugin } from '../../lib/plugins/enhanced-plugin-manager';
import { PluginError } from '../../lib/plugins/plugin-isolation';

export interface Plugin {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<any>;
  component: React.ComponentType<PluginProps>;
  category: 'ai' | 'code' | 'data' | 'media' | 'utility' | 'design';
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize?: { width: number; height: number };
  
  // Enhanced properties for error isolation
  enhanced?: boolean;
  resourceLimits?: {
    maxMemoryMB?: number;
    maxCpuPercent?: number;
    maxNetworkRequests?: number;
    maxStorageKB?: number;
    timeoutMs?: number;
  };
}

export interface PluginProps {
  onClose: () => void;
  onResult?: (result: any) => void;
  initialData?: any;
}

interface PluginWindow {
  id: string;
  plugin: Plugin;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  data?: any;
  status?: 'running' | 'error' | 'paused';
  errorCount?: number;
}

interface PluginManagerProps {
  availablePlugins: Plugin[];
  onPluginResult?: (pluginId: string, result: any) => void;
  openPluginId?: string | null;
  onOpenComplete?: () => void;
  enableEnhancedMode?: boolean;
}

export const PluginManager: React.FC<PluginManagerProps> = ({
  availablePlugins,
  onPluginResult,
  openPluginId,
  onOpenComplete,
  enableEnhancedMode = true
}) => {
  const [openWindows, setOpenWindows] = useState<PluginWindow[]>([]);
  const [nextZIndex, setNextZIndex] = useState(1000);
  const [pluginErrors, setPluginErrors] = useState<Map<string, PluginError[]>>(new Map());
  const [dragState, setDragState] = useState<{
    windowId: string | null;
    isDragging: boolean;
    isResizing: boolean;
    startPos: { x: number; y: number };
    startSize: { width: number; height: number };
    startWindowPos: { x: number; y: number };
  }>({
    windowId: null,
    isDragging: false,
    isResizing: false,
    startPos: { x: 0, y: 0 },
    startSize: { width: 0, height: 0 },
    startWindowPos: { x: 0, y: 0 }
  });

  // Register enhanced plugins
  useEffect(() => {
    if (enableEnhancedMode) {
      availablePlugins.forEach(plugin => {
        if (plugin.enhanced) {
          const enhancedPlugin: EnhancedPlugin = {
            ...plugin,
            version: '1.0.0',
            resourceLimits: plugin.resourceLimits,
            isolationConfig: {
              sandboxed: true,
              errorRecovery: true,
              autoRestart: true,
              maxRestarts: 3,
              restartCooldownMs: 5000
            }
          };
          
          try {
            enhancedPluginManager.registerPlugin(enhancedPlugin);
          } catch (error) {
            console.warn(`Failed to register enhanced plugin ${plugin.id}:`, error);
          }
        }
      });
    }
  }, [availablePlugins, enableEnhancedMode]);

  useEffect(() => {
    if (openPluginId) {
      const plugin = availablePlugins.find(p => p.id === openPluginId);
      if (plugin) {
        openPlugin(plugin);
      }
      if (onOpenComplete) {
        onOpenComplete();
      }
    }
  }, [openPluginId]);

  const openPlugin = (plugin: Plugin, initialData?: any) => {
    const windowId = `${plugin.id}-${Date.now()}`;
    const newWindow: PluginWindow = {
      id: windowId,
      plugin,
      position: {
        x: Math.random() * 200 + 100,
        y: Math.random() * 100 + 100
      },
      size: plugin.defaultSize,
      isMinimized: false,
      isMaximized: false,
      zIndex: nextZIndex,
      data: initialData,
      status: 'running',
      errorCount: 0
    };

    setOpenWindows(prev => [...prev, newWindow]);
    setNextZIndex(prev => prev + 1);
  };

  const handlePluginError = (windowId: string, error: PluginError) => {
    setOpenWindows(prev => prev.map(window => 
      window.id === windowId 
        ? { 
            ...window, 
            status: 'error',
            errorCount: (window.errorCount || 0) + 1
          }
        : window
    ));

    setPluginErrors(prev => {
      const newErrors = new Map(prev);
      const windowErrors = newErrors.get(windowId) || [];
      newErrors.set(windowId, [...windowErrors, error]);
      return newErrors;
    });
  };

  const handlePluginStatusChange = (windowId: string, status: string) => {
    setOpenWindows(prev => prev.map(window => 
      window.id === windowId 
        ? { ...window, status: status as any }
        : window
    ));
  };

  const closeWindow = (windowId: string) => {
    setOpenWindows(prev => prev.filter(w => w.id !== windowId));
  };

  const bringToFront = (windowId: string) => {
    setOpenWindows(prev => prev.map(w => 
      w.id === windowId 
        ? { ...w, zIndex: nextZIndex }
        : w
    ));
    setNextZIndex(prev => prev + 1);
  };

  const toggleMinimize = (windowId: string) => {
    setOpenWindows(prev => prev.map(w => 
      w.id === windowId 
        ? { ...w, isMinimized: !w.isMinimized }
        : w
    ));
  };

  const toggleMaximize = (windowId: string) => {
    setOpenWindows(prev => prev.map(w => 
      w.id === windowId 
        ? { 
            ...w, 
            isMaximized: !w.isMaximized,
            position: w.isMaximized ? w.position : { x: 0, y: 0 },
            size: w.isMaximized ? w.size : { width: window.innerWidth, height: window.innerHeight - 100 }
          }
        : w
    ));
  };

  const handleMouseDown = (e: React.MouseEvent, windowId: string, action: 'drag' | 'resize') => {
    e.preventDefault();
    const window = openWindows.find(w => w.id === windowId);
    if (!window) return;

    bringToFront(windowId);

    setDragState({
      windowId,
      isDragging: action === 'drag',
      isResizing: action === 'resize',
      startPos: { x: e.clientX, y: e.clientY },
      startSize: window.size,
      startWindowPos: window.position
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.windowId || (!dragState.isDragging && !dragState.isResizing)) return;

      const deltaX = e.clientX - dragState.startPos.x;
      const deltaY = e.clientY - dragState.startPos.y;

      setOpenWindows(prev => prev.map(w => {
        if (w.id !== dragState.windowId) return w;

        if (dragState.isDragging) {
          return {
            ...w,
            position: {
              x: Math.max(0, dragState.startWindowPos.x + deltaX),
              y: Math.max(0, dragState.startWindowPos.y + deltaY)
            }
          };
        }

        if (dragState.isResizing) {
          const newWidth = Math.max(w.plugin.minSize.width, dragState.startSize.width + deltaX);
          const newHeight = Math.max(w.plugin.minSize.height, dragState.startSize.height + deltaY);
          
          return {
            ...w,
            size: {
              width: w.plugin.maxSize ? Math.min(w.plugin.maxSize.width, newWidth) : newWidth,
              height: w.plugin.maxSize ? Math.min(w.plugin.maxSize.height, newHeight) : newHeight
            }
          };
        }

        return w;
      }));
    };

    const handleMouseUp = () => {
      setDragState({
        windowId: null,
        isDragging: false,
        isResizing: false,
        startPos: { x: 0, y: 0 },
        startSize: { width: 0, height: 0 },
        startWindowPos: { x: 0, y: 0 }
      });
    };

    if (dragState.isDragging || dragState.isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState]);

  return (
    <>
      {/* Plugin Launcher */}
      <div className="flex flex-wrap gap-2 mb-4">
        {availablePlugins.map(plugin => {
          const IconComponent = plugin.icon;
          const isEnhanced = enableEnhancedMode && plugin.enhanced;
          
          return (
            <Button
              key={plugin.id}
              variant="secondary"
              size="sm"
              className={`flex items-center gap-2 bg-black/20 hover:bg-black/40 border border-white/10 ${
                isEnhanced ? 'ring-1 ring-green-500/30' : ''
              }`}
              onClick={() => openPlugin(plugin)}
            >
              <IconComponent className="w-4 h-4" />
              <span className="hidden sm:inline">{plugin.name}</span>
              {isEnhanced && (
                <Shield className="w-3 h-3 text-green-400" title="Enhanced Mode" />
              )}
            </Button>
          );
        })}
      </div>

      {/* Plugin Windows */}
      <AnimatePresence>
        {openWindows.map(window => {
          const PluginComponent = window.plugin.component;
          const useEnhanced = enableEnhancedMode && window.plugin.enhanced;
          
          return (
            <motion.div
              key={window.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ 
                opacity: window.isMinimized ? 0.8 : 1, 
                scale: window.isMinimized ? 0.95 : 1 
              }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl overflow-hidden"
              style={{
                left: window.position.x,
                top: window.position.y,
                width: window.size.width,
                height: window.isMinimized ? 40 : window.size.height,
                zIndex: window.zIndex
              }}
              onMouseDown={() => bringToFront(window.id)}
            >
              {/* Window Header */}
              <div
                className="h-10 bg-black/60 border-b border-white/10 flex items-center justify-between px-3 cursor-move select-none"
                onMouseDown={(e) => handleMouseDown(e, window.id, 'drag')}
              >
                <div className="flex items-center gap-2">
                  <window.plugin.icon className="w-4 h-4" />
                  <span className="text-sm font-medium text-white">
                    {window.plugin.name}
                  </span>
                  
                  {/* Status indicators */}
                  {useEnhanced && (
                    <div className="flex items-center gap-1">
                      <Shield className="w-3 h-3 text-green-400" title="Enhanced Mode" />
                      {window.status === 'error' && (
                        <AlertTriangle className="w-3 h-3 text-red-400" title="Plugin Error" />
                      )}
                      {window.errorCount && window.errorCount > 0 && (
                        <span className="text-xs bg-red-500/20 text-red-300 px-1 rounded">
                          {window.errorCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0 hover:bg-white/10"
                    onClick={() => toggleMinimize(window.id)}
                  >
                    <Minimize2 className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0 hover:bg-white/10"
                    onClick={() => toggleMaximize(window.id)}
                  >
                    <Maximize2 className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0 hover:bg-red-500/20 text-red-400"
                    onClick={() => closeWindow(window.id)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Window Content */}
              {!window.isMinimized && (
                <div className="h-full overflow-hidden">
                  {useEnhanced ? (
                    <EnhancedPluginWrapper
                      pluginId={window.plugin.id}
                      component={PluginComponent}
                      onClose={() => closeWindow(window.id)}
                      onResult={(result) => onPluginResult?.(window.plugin.id, result)}
                      initialData={window.data}
                      onError={(error) => handlePluginError(window.id, error)}
                      onStatusChange={(status) => handlePluginStatusChange(window.id, status)}
                    />
                  ) : (
                    <PluginComponent
                      onClose={() => closeWindow(window.id)}
                      onResult={(result) => onPluginResult?.(window.plugin.id, result)}
                      initialData={window.data}
                    />
                  )}
                </div>
              )}

              {/* Resize Handle */}
              {!window.isMinimized && !window.isMaximized && (
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-white/10 hover:bg-white/20"
                  onMouseDown={(e) => handleMouseDown(e, window.id, 'resize')}
                >
                  <div className="absolute bottom-1 right-1 w-2 h-2 border-r border-b border-white/40" />
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Minimized Windows Taskbar */}
      {openWindows.some(w => w.isMinimized) && (
        <div className="fixed bottom-4 left-4 flex gap-2 z-50">
          {openWindows.filter(w => w.isMinimized).map(window => (
            <Button
              key={window.id}
              size="sm"
              variant="secondary"
              className="flex items-center gap-2 bg-black/60 backdrop-blur-sm"
              onClick={() => toggleMinimize(window.id)}
            >
              <window.plugin.icon className="w-4 h-4" />
              <span className="text-xs">{window.plugin.name}</span>
            </Button>
          ))}
        </div>
      )}
    </>
  );
};

export default PluginManager;
