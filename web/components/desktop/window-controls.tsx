"use client";

import React, { useEffect, useState } from "react";

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
      className="h-8 bg-black flex justify-between items-center px-3 select-none border-b border-white/5 z-[9999] pointer-events-auto"
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest pointer-events-none">
          Quaz Desktop
        </span>
      </div>

      <div className="flex items-center pointer-events-auto">
        <button
          onClick={() => appWindow.minimize()}
          className="h-8 w-10 flex items-center justify-center hover:bg-white/10 transition-colors text-zinc-400 z-[10001]"
          title="Minimize"
        >
          —
        </button>
        
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="h-8 w-10 flex items-center justify-center hover:bg-white/10 transition-colors text-zinc-400 text-xs z-[10001]"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? "❐" : "□"}
        </button>

        <button
          onClick={() => appWindow.close()}
          className="h-8 w-12 flex items-center justify-center hover:bg-red-500 transition-colors group text-zinc-400 z-[10001]"
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
