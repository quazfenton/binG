/**
 * File Mention Autocomplete Hook
 *
 * Detects @mentions in textarea input and provides file autocomplete suggestions.
 * Features:
 * - Detects @pattern and extracts query string
 * - Fetches file list from VFS for suggestions
 * - Supports arrow key navigation and Enter to select
 * - Inserts selected file as @filename.tsx syntax
 *
 * Usage:
 * ```tsx
 * const {
 *   showMenu,
 *   query,
 *   suggestions,
 *   selectedIndex,
 *   handleInputChange,
 *   handleKeyDown,
 *   handleSelect,
 *   getHighlightedInput,
 * } = useFileMentionAutocomplete({
 *   input: inputValue,
 *   setInput: setInputValue,
 *   userId: sessionId,
 *   onFileSelect: (files) => setExplicitFiles(files),
 * });
 * ```
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getOrCreateAnonymousSessionId, buildApiHeaders } from '@/lib/utils';

export interface FileMentionOption {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

export interface UseFileMentionAutocompleteOptions {
  /** Current input value */
  input: string;
  /** Setter for input value */
  setInput: (value: string) => void;
  /** User/session ID for VFS access */
  userId?: string;
  /** Callback when files are selected via @mention */
  onFileSelect?: (files: string[]) => void;
  /** Maximum suggestions to show */
  maxSuggestions?: number;
}

export interface UseFileMentionAutocompleteReturn {
  /** Whether to show the autocomplete menu */
  showMenu: boolean;
  /** Current query text after @ */
  query: string;
  /** File suggestions matching query */
  suggestions: FileMentionOption[];
  /** Currently selected index */
  selectedIndex: number;
  /** Whether suggestions are loading */
  isLoading: boolean;
  /** Handle input change (call from onChange) */
  handleInputChange: (value: string) => void;
  /** Handle key down (call from onKeyDown) */
  handleKeyDown: (e: React.KeyboardEvent) => boolean; // returns true if handled
  /** Handle file selection */
  handleSelect: (option: FileMentionOption) => void;
  /** Get input value with @ mentions highlighted (for display) */
  getHighlightedInput: () => { text: string; mentionRanges: { start: number; end: number }[] };
  /** Reset autocomplete state */
  reset: () => void;
  /** All tracked file references for this session */
  recentFiles: string[];
}

/**
 * Regex to detect @mention pattern
 * Matches: @filenam, @App.ts, @src/compo
 */
const AT_MENTION_REGEX = /@([\w\-/.]*)$/;

/**
 * Regex to find all completed @mentions in text
 */
const COMPLETED_AT_MENTION_REGEX = /@([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))/gi;

/**
 * Hook for @mention file autocomplete
 */
export function useFileMentionAutocomplete(
  options: UseFileMentionAutocompleteOptions
): UseFileMentionAutocompleteReturn {
  const {
    input,
    setInput,
    userId,
    onFileSelect,
    maxSuggestions = 10,
  } = options;

  const [showMenu, setShowMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<FileMentionOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [allFiles, setAllFiles] = useState<FileMentionOption[]>([]);
  
  const abortRef = useRef<AbortController | null>(null);
  // Promise-based guard to prevent concurrent fetch calls (race condition fix)
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  // Tracks whether a fetch has completed (for deciding whether to re-fetch)
  const hasFetchedFiles = useRef(false);

  /**
   * Fetch all files from VFS for autocomplete
   * Uses the snapshot API which returns the complete file tree
   */
  const fetchAllFiles = useCallback(async () => {
    // If already fetching, return the existing promise (prevents duplicate concurrent requests)
    if (fetchPromiseRef.current) return fetchPromiseRef.current;

    const fetchPromise = (async () => {
      const sessionId = userId || getOrCreateAnonymousSessionId();

      try {
        // Use the snapshot API which returns all files in the workspace
        const response = await fetch(`/api/filesystem/snapshot`, {
          method: 'GET',
          headers: buildApiHeaders({ json: false }),
          credentials: 'include',
        });

      if (!response.ok) {
        // Snapshot may fail for new users - that's OK, start with empty list
        fetchPromiseRef.current = null; // Clear guard so next @ triggers retry
        return;
      }

      const payload = await response.json();
      if (!payload?.success || !payload?.data?.files) {
        fetchPromiseRef.current = null;
        return;
      }

      // Flatten files from snapshot format
      const snapshotFiles = payload.data.files;
      const files: FileMentionOption[] = snapshotFiles.map((f: any) => ({
        path: f.path.startsWith('/') ? f.path : `/${f.path}`,
        name: f.path.split('/').pop() || f.path,
        type: 'file',
      }));

      setAllFiles(files);

      // Extract unique filenames for recent files
      const uniqueFiles = [...new Set(files.map(f => f.name))];
      setRecentFiles(uniqueFiles.slice(0, 20));

      hasFetchedFiles.current = true; // Mark as completed
    } catch (error) {
      console.error('[FileMention] Failed to fetch files:', error);
      fetchPromiseRef.current = null; // Allow retry on next @ trigger
    } finally {
      // Always clear the guard when fetch completes (success or failure)
      fetchPromiseRef.current = null;
    }
    })();

    fetchPromiseRef.current = fetchPromise;
    return fetchPromise;
  }, [userId]);

  /**
   * Fetch recent files from session tracker
   */
  const fetchRecentFiles = useCallback(async () => {
    // We'll fetch this from server-side tracker via a lightweight endpoint
    // For now, use the cached allFiles list
    await fetchAllFiles();
  }, [fetchAllFiles]);

  /**
   * Filter files based on query
   */
  const filterFiles = useCallback((searchQuery: string): FileMentionOption[] => {
    if (!searchQuery) {
      // No query - return recent files first, then all files
      const recentSet = new Set(recentFiles.map(f => f.toLowerCase()));
      const recent = allFiles.filter(f => recentSet.has(f.name.toLowerCase())).slice(0, 5);
      const others = allFiles.filter(f => !recentSet.has(f.name.toLowerCase())).slice(0, maxSuggestions - 5);
      return [...recent, ...others];
    }

    const lowerQuery = searchQuery.toLowerCase();
    
    // Score and rank matches
    const scored = allFiles
      .map(file => {
        const name = file.name.toLowerCase();
        const path = file.path.toLowerCase();
        let score = 0;

        // Exact name match (highest priority)
        if (name === lowerQuery) {
          score = 1000;
        }
        // Name starts with query
        else if (name.startsWith(lowerQuery)) {
          score = 500;
        }
        // Name contains query
        else if (name.includes(lowerQuery)) {
          score = 200;
        }
        // Path contains query
        else if (path.includes(lowerQuery)) {
          score = 100;
        }

        return { file, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name))
      .slice(0, maxSuggestions)
      .map(({ file }) => file);

    return scored;
  }, [allFiles, recentFiles, maxSuggestions]);

  /**
   * Handle input change
   */
  const handleInputChange = useCallback((value: string) => {
    setInput(value);

    // Check for @mention pattern
    const match = value.match(AT_MENTION_REGEX);
    
    if (match) {
      const mentionQuery = match[1];
      setQuery(mentionQuery);
      setShowMenu(true);
      setSelectedIndex(0);

      // Filter suggestions
      const filtered = filterFiles(mentionQuery);
      setSuggestions(filtered);

      // Fetch files if not already done
      if (!hasFetchedFiles.current) {
        setIsLoading(true);
        fetchAllFiles().then(() => {
          // Re-filter with fetched files
          const filtered = filterFiles(mentionQuery);
          setSuggestions(filtered);
          setIsLoading(false);
        });
      }
    } else {
      setShowMenu(false);
      setQuery('');
      setSuggestions([]);
      setSelectedIndex(0);
    }
  }, [setInput, filterFiles, fetchAllFiles]);

  /**
   * Handle key down events
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!showMenu || suggestions.length === 0) {
      return false;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % suggestions.length);
      return true;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      return true;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        // Inline the select logic to avoid ref issue
        const option = suggestions[selectedIndex];
        const atIndex = input.lastIndexOf('@');
        if (atIndex !== -1) {
          const beforeAt = input.substring(0, atIndex);
          const newInput = `${beforeAt}@${option.path} `;
          setInput(newInput);
          setShowMenu(false);
          setQuery('');
          setSuggestions([]);
          setSelectedIndex(0);
          if (onFileSelect) onFileSelect([option.path]);
          setTimeout(() => {
            const textarea = document.querySelector('textarea');
            textarea?.focus();
          }, 0);
        }
        return true;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setShowMenu(false);
      return true;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        const option = suggestions[selectedIndex];
        const atIndex = input.lastIndexOf('@');
        if (atIndex !== -1) {
          const beforeAt = input.substring(0, atIndex);
          const newInput = `${beforeAt}@${option.path} `;
          setInput(newInput);
          setShowMenu(false);
          setQuery('');
          setSuggestions([]);
          setSelectedIndex(0);
          if (onFileSelect) onFileSelect([option.path]);
          setTimeout(() => {
            const textarea = document.querySelector('textarea');
            textarea?.focus();
          }, 0);
        }
        return true;
      }
    }

    return false;
  }, [showMenu, suggestions, selectedIndex, input, setInput, onFileSelect]);

  /**
   * Handle file selection from autocomplete
   */
  const handleSelect = useCallback((option: FileMentionOption) => {
    // Replace @query with @fullpath
    const atIndex = input.lastIndexOf('@');
    if (atIndex === -1) return;

    const beforeAt = input.substring(0, atIndex);
    const newInput = `${beforeAt}@${option.path} `;
    
    setInput(newInput);
    setShowMenu(false);
    setQuery('');
    setSuggestions([]);
    setSelectedIndex(0);

    // Notify parent of file selection
    if (onFileSelect) {
      onFileSelect([option.path]);
    }

    // Refocus the textarea
    setTimeout(() => {
      const textarea = document.querySelector('textarea');
      textarea?.focus();
    }, 0);
  }, [input, setInput, onFileSelect]);

  /**
   * Get input with @mentions highlighted
   */
  const getHighlightedInput = useCallback(() => {
    const mentionRanges: { start: number; end: number }[] = [];
    let match;
    
    const regex = new RegExp(COMPLETED_AT_MENTION_REGEX);
    while ((match = regex.exec(input)) !== null) {
      mentionRanges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return { text: input, mentionRanges };
  }, [input]);

  /**
   * Reset autocomplete state
   */
  const reset = useCallback(() => {
    setShowMenu(false);
    setQuery('');
    setSuggestions([]);
    setSelectedIndex(0);
    setIsLoading(false);
  }, []);

  // Fetch files on mount
  useEffect(() => {
    fetchRecentFiles();
  }, [fetchRecentFiles]);

  return {
    showMenu,
    query,
    suggestions,
    selectedIndex,
    isLoading,
    handleInputChange,
    handleKeyDown,
    getHighlightedInput,
    handleSelect,
    reset,
    recentFiles,
  };
}
