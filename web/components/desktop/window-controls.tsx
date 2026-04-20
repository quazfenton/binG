"use client";

import React, { useEffect, useState } from "react";
import { X, Minus, Square, Copy } from "lucide-react";

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<any>(null);

  useEffect(() => {
    // Only run in Tauri environment
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      const initTauri = async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          setAppWindow(win);
          
          // Update maximization state
          const updateMaximized = async () => {
            setIsMaximized(await win.isMaximized());
          };
          
          updateMaximized();
          const unlisten = await win.onResized(updateMaximized);
          
          return () => {
            unlisten();
          };
        } catch (e) {
          console.error("Failed to init Tauri window API", e);
        }
      };
      
      const cleanup = initTauri();
      return () => {
        cleanup.then(f => f && f());
      };
    }
  }, []);

  if (!appWindow) return null;

  return (
    <div 
      data-tauri-drag-region
      className="h-8 bg-black/80 backdrop-blur-md flex justify-between items-center px-3 select-none border-b border-white/5 z-[9999]"
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
          Quaz Desktop
        </span>
      </div>

      <div className="flex items-center">
        <button
          onClick={() => appWindow.minimize()}
          className="h-8 w-10 flex items-center justify-center hover:bg-white/10 transition-colors"
          title="Minimize"
        >
          <Minus size={14} className="text-zinc-400" />
        </button>
        
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="h-8 w-10 flex items-center justify-center hover:bg-white/10 transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy size={12} className="text-zinc-400" />
          ) : (
            <Square size={12} className="text-zinc-400" />
          )}
        </button>

        <button
          onClick={() => appWindow.close()}
          className="h-8 w-12 flex items-center justify-center hover:bg-red-500 transition-colors group"
          title="Close"
        >
          <X size={14} className="text-zinc-400 group-hover:text-white" />
        </button>
      </div>
    </div>
  );
}
