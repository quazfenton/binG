"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, ChevronDown, Loader2, Folder, Home } from 'lucide-react';
import { useWorkspace } from '@/contexts/workspace-context';
import { isDesktopMode } from '@bing/platform/env';
import { getDesktopWorkspaceDir } from '@/lib/utils/desktop-env';
import { Button } from '@/components/ui/button';

/**
 * WorkspaceIndicator — desktop-only UI showing the current workspace folder.
 *
 * - Displays the current working directory name (truncated path)
 * - Clicking opens a native folder-picker dialog to change the workspace
 * - Hover reveals the full path
 * - Only renders in desktop mode
 */
export function WorkspaceIndicator() {
  const { workspaceRoot, isChanging, openProjectFolder } = useWorkspace();
  const [isHovered, setIsHovered] = useState(false);

  // Don't render in web mode
  if (!isDesktopMode()) return null;

  // Extract a short display name from the path
  const displayName = (() => {
    if (!workspaceRoot) return 'No folder selected';
    // Use the last segment of the path as the display name
    const segments = workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments[segments.length - 1] || workspaceRoot;
  })();

  const fullDisplayPath = workspaceRoot || getDesktopWorkspaceDir() || 'Not set';

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <motion.button
        onClick={openProjectFolder}
        disabled={isChanging}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
          transition-all duration-200 cursor-pointer
          bg-white/[0.04] border border-white/[0.08]
          hover:bg-white/[0.08] hover:border-white/[0.15]
          active:bg-white/[0.12]
          ${isChanging ? 'opacity-70 cursor-wait' : ''}
        `}
        title={`Workspace: ${fullDisplayPath}\nClick to change`}
      >
        {isChanging ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
        )}
        <span className="text-white/80 max-w-[180px] truncate">
          {displayName}
        </span>
        <ChevronDown className="w-3 h-3 text-white/40" />
      </motion.button>

      {/* Tooltip with full path on hover */}
      <AnimatePresence>
        {isHovered && workspaceRoot && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 z-[9999] px-3 py-2 rounded-lg
              bg-black/90 border border-white/10 backdrop-blur-xl
              shadow-xl shadow-black/50 min-w-[200px] max-w-[400px]"
          >
            <div className="flex items-center gap-2 mb-1">
              <Folder className="w-3 h-3 text-blue-400 shrink-0" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium">
                Project Folder
              </span>
            </div>
            <p className="text-xs text-white/70 break-all font-mono leading-relaxed">
              {workspaceRoot}
            </p>
            <div className="mt-2 pt-1.5 border-t border-white/[0.06]">
              <span className="text-[10px] text-white/30">
                Click to change workspace
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Empty-state workspace prompt — shown when no workspace is set.
 * Prompts the user to open a project folder.
 */
export function WorkspacePrompt() {
  const { openProjectFolder, isChanging } = useWorkspace();

  if (!isDesktopMode()) return null;

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-4">
      <div className="w-14 h-14 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
        <Home className="w-7 h-7 text-blue-400" />
      </div>
      <div className="text-center space-y-1">
        <h3 className="text-sm font-semibold text-white/90">Open a Project Folder</h3>
        <p className="text-xs text-white/50 max-w-[280px]">
          Select a folder on your computer to use as your workspace. The agent will work with files in this directory.
        </p>
      </div>
      <Button
        onClick={openProjectFolder}
        disabled={isChanging}
        className="bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 hover:text-blue-200"
        size="sm"
      >
        {isChanging ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <FolderOpen className="w-4 h-4 mr-2" />
        )}
        {isChanging ? 'Opening...' : 'Open Folder'}
      </Button>
    </div>
  );
}
