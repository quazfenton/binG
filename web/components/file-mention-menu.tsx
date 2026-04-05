/**
 * File Mention Autocomplete Menu
 *
 * Dropdown menu that appears when user types @ in the chat input.
 * Shows matching files from VFS with navigation support.
 */

'use client';

import React, { useRef, useEffect } from 'react';
import type { FileMentionOption } from '@/hooks/use-file-mention-autocomplete';
import { File, Folder, Loader2, FolderOpen } from 'lucide-react';

export interface FileMentionMenuProps {
  /** Whether menu is visible */
  visible: boolean;
  /** Current query text */
  query: string;
  /** File suggestions */
  suggestions: FileMentionOption[];
  /** Currently selected index */
  selectedIndex: number;
  /** Whether suggestions are loading */
  isLoading: boolean;
  /** Callback when file is selected */
  onSelect: (option: FileMentionOption) => void;
  /** Position anchor (optional, for positioning relative to textarea) */
  anchorEl?: HTMLElement | null;
}

/**
 * File mention autocomplete menu component
 */
export const FileMentionMenu: React.FC<FileMentionMenuProps> = ({
  visible,
  query,
  suggestions,
  selectedIndex,
  isLoading,
  onSelect,
  anchorEl,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && menuRef.current) {
      selectedRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  if (!visible || !suggestions || suggestions.length === 0) {
    // Show empty state when menu is visible but no files exist
    if (visible && !isLoading) {
      return (
        <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-gray-900/95 backdrop-blur-sm border border-white/20 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 bg-white/5 border-b border-white/10 text-xs text-gray-400">
            Files
          </div>
          <div className="flex flex-col items-center justify-center py-6 text-gray-500">
            <FolderOpen className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No files in workspace yet</p>
            <p className="text-xs mt-1 text-gray-600">Create or upload files, then use @ to mention them</p>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-gray-900/95 backdrop-blur-sm border border-white/20 rounded-xl shadow-2xl overflow-hidden z-50"
      style={{
        maxHeight: '300px',
        overflowY: 'auto',
      }}
      role="listbox"
      aria-label="File suggestions"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-white/5 border-b border-white/10 text-xs text-gray-400 flex items-center justify-between">
        <span>
          {query ? `Files matching "${query}"` : 'Recent files'}
        </span>
        <span className="text-gray-500">
          {suggestions.length} file{suggestions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-4 text-gray-400">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          <span className="text-sm">Loading files...</span>
        </div>
      )}

      {/* File list */}
      <div className="py-1">
        {suggestions.map((option, index) => (
          <div
            key={option.path}
            ref={index === selectedIndex ? selectedRef : null}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
              index === selectedIndex
                ? 'bg-white/10 text-white'
                : 'text-gray-300 hover:bg-white/5'
            }`}
            onClick={() => onSelect(option)}
            role="option"
            aria-selected={index === selectedIndex}
          >
            {/* Icon */}
            <div className="flex-shrink-0">
              {option.type === 'directory' ? (
                <Folder className="w-4 h-4 text-yellow-400" />
              ) : (
                <File className="w-4 h-4 text-blue-400" />
              )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {option.name}
              </div>
              {option.path !== option.name && (
                <div className="text-xs text-gray-500 truncate">
                  {option.path}
                </div>
              )}
            </div>

            {/* Keyboard hint for selected */}
            {index === selectedIndex && (
              <div className="flex-shrink-0 text-xs text-gray-500">
                Press Enter
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 bg-white/5 border-t border-white/10 text-xs text-gray-500 flex items-center justify-between">
        <span>↑↓ to navigate</span>
        <span>Enter to select</span>
        <span>Esc to close</span>
      </div>
    </div>
  );
};
