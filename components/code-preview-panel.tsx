"use client";

import * as React from "react";
import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import {
  Code as CodeIcon,
  FileText,
  Package,
  FolderOpen,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  Plus,
  FolderPlus,
  X,
  CheckCircle,
  Play,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import JSZip from "jszip";
import type { Message } from "../types/index";
import { parsePatch, applyPatch } from "diff";
import { useVirtualFilesystem } from "../hooks/use-virtual-filesystem";
import { OPFSStatusIndicator } from "./opfs-status-indicator";
import { EnhancedDiffViewer } from "./enhanced-diff-viewer";
import { normalizeScopePath, stripWorkspacePrefixes } from "@/lib/virtual-filesystem/scope-utils";
import { emitFilesystemUpdated, onFilesystemUpdated } from "@/lib/virtual-filesystem/sync-events";
import { createRefreshScheduler } from "@/lib/virtual-filesystem/refresh-scheduler";
import {
  parseCodeBlocksFromMessages,
  type CodeBlock as ParsedCodeBlock,
} from "../lib/code-parser";
import { createDebugLogger } from "@/config/features";

// Lazy load Sandpack to avoid SSR issues
// React.lazy requires default export, so we remap the named export
const Sandpack = lazy(() =>
  import('@codesandbox/sandpack-react')
    .then(mod => ({ default: mod.Sandpack }))
    .catch(() => ({
      default: () => (
        <div className="p-4 text-center text-yellow-600">
          Sandpack preview unavailable
        </div>
      ),
    }))
);

interface CodePreviewPanelProps {
  messages: Message[];
  isOpen: boolean;
  onClose: () => void;
  filesystemScopePath?: string;
  // Optional: Inject project files directly (e.g., from code service)
  // DEBUG: This creates dual data sources - to be removed after debugging
  projectFiles?: { [key: string]: string };
  // commands management
  commandsByFile?: Record<string, string[]>;
  onApplyAllCommandDiffs?: () => void;
  onApplyFileCommandDiffs?: (path: string) => void;
  onClearAllCommandDiffs?: () => void;
  onClearFileCommandDiffs?: (path: string) => void;
  onSquashFileCommandDiffs?: (path: string) => void;
}

// Use CodeBlock from the parser module
type CodeBlock = ParsedCodeBlock;

const previewLogger = createDebugLogger('CodePreviewPanel', 'DEBUG_CODE_PREVIEW');

// =============================================================================
// AUTHORITATIVE STATE ARCHITECTURE
// =============================================================================
// The Code Preview Panel has multiple file sources that can compete, creating race conditions.
// To fix this, we establish a clear authority hierarchy:
//
// 1. MANUAL (highest priority): User explicitly triggered preview via handleManualPreview()
//    - Source: explicit user action, represents specific directory
//    - State: manualPreviewFiles + isManualPreviewActive
//
// 2. VFS (default): Virtual Filesystem sync (the canonical source)
//    - Source: filesystem changes from chat, terminal, or visual editor
//    - State: scopedPreviewFiles (synced via filesystem-updated events)
//    - This is the most up-to-date representation of user code
//
// 3. LEGACY (lowest priority): Parsed from markdown code blocks
//    - Source: LLM responses parsed for code blocks
//    - State: projectStructure
//    - Deprecated: Use VFS instead for code that should persist
//
// The key insight: scopedPreviewFiles is the ONLY source that gets updated via
// filesystem-updated events (cross-panel sync). Manual preview is explicitly
// triggered by user. projectStructure is derived from chat messages.
//
// Resolution: Use manualPreviewFiles if active, else scopedPreviewFiles (VFS), else projectStructure
// =============================================================================

interface ProjectStructure {
  name: string;
  files: { [key: string]: string };
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: { [key: string]: string };
  framework:
    | "react"
    | "vue"
    | "angular"
    | "svelte"
    | "solid"
    | "vanilla"
    | "next"
    | "nuxt"
    | "gatsby"
    | "vite"
    | "astro"
    | "remix"
    | "qwik"
    | "gradio"
    | "streamlit"
    | "flask"
    | "fastapi"
    | "django"
    | "vite-react";
  bundler?: "webpack" | "vite" | "parcel" | "rollup" | "esbuild";
  packageManager?: "npm" | "yarn" | "pnpm" | "bun";
  entryFile?: string | null;
  previewModeHint?: string;
  filesystemScopePath?: string;
}

export default function CodePreviewPanel({
  messages,
  isOpen,
  onClose,
  filesystemScopePath = "project",
  projectFiles,
  commandsByFile = {},
  onApplyAllCommandDiffs,
  onApplyFileCommandDiffs,
  onClearAllCommandDiffs,
  onClearFileCommandDiffs,
  onSquashFileCommandDiffs,
}: CodePreviewPanelProps) {
  const [detectedFramework] = useState<"react" | "vue" | "vanilla">("vanilla");

  const { log, error: logError, warn: logWarn } = previewLogger;
  
  // Track previous scope path to detect navigation
  const previousScopePathRef = useRef(filesystemScopePath);
  const [selectedTab, setSelectedTab] = useState("preview");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [projectStructure, setProjectStructure] =
    useState<ProjectStructure | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [panelWidth, setPanelWidth] = useState(800);
  const [isDragging, setIsDragging] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const [, setDiffErrors] = useState<string[]>([]);
  const pendingFiles = useMemo(
    () => Object.keys(commandsByFile || {}),
    [commandsByFile],
  );
  
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath || 'project');
  const {
    currentPath: filesystemCurrentPath,
    nodes: filesystemRawNodes,
    setCurrentPath: setFilesystemCurrentPath,
    listDirectory: listFilesystemDirectory,
    readFile: readFilesystemFile,
    writeFile: writeFilesystemFile,
    deletePath: deleteFilesystemPath,
    isLoading: isFilesystemLoading,
    getSnapshot: getFilesystemSnapshot,
  } = virtualFilesystem;
  const [selectedFilesystemPath, setSelectedFilesystemPath] = useState<string>("");
  const [selectedFilesystemLanguage, setSelectedFilesystemLanguage] = useState<string>("text");
  const [selectedFilesystemContent, setSelectedFilesystemContent] = useState<string>("");
  const [isFilesystemFileLoading, setIsFilesystemFileLoading] = useState(false);
  const [scopedPreviewFiles, setScopedPreviewFiles] = useState<Record<string, string>>({});
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editableContent, setEditableContent] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  const lastVfsSaveRef = useRef<number>(0);
  const VFS_SAVE_DEBOUNCE_MS = 1000;

  // Normalize filesystem path for display (prevent accumulated prefixes)
  const normalizedFilesystemPath = useMemo(() => {
    let cleanPath = filesystemCurrentPath || 'project';
    
    cleanPath = stripWorkspacePrefixes(cleanPath);
    return normalizeScopePath(cleanPath);
  }, [filesystemCurrentPath]);

  // Debounce loading state to prevent rapid re-renders
  const [debouncedIsLoading, setDebouncedIsLoading] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedIsLoading(isFilesystemLoading);
    }, 300); // 300ms debounce to prevent flickering
    
    return () => clearTimeout(timer);
  }, [isFilesystemLoading]);
  
  // =============================================================================
  // AUTHORITATIVE PREVIEW STATE
  // =============================================================================
  // CRITICAL: These states have specific, non-overlapping purposes to prevent race conditions.
  //
  // manualPreviewFiles: Set ONLY when user explicitly triggers preview (handleManualPreview)
  //   - Never automatically updated by filesystem events
  //   - Cleared only when user explicitly clears or navigates away
  //   - Highest priority in renderLivePreview resolution
  //
  // scopedPreviewFiles: Set ONLY from VFS filesystem-updated events or initial load
  //   - Represents the current state of the virtual filesystem
  //   - Automatically stays in sync with chat/terminal/editor changes
  //   - This is THE authoritative source for persisted code
  //
  // projectStructure: Set ONLY from parsed code blocks in chat messages
  //   - Lowest priority, used only as fallback when VFS is empty
  //   - Deprecated for new code (should go through VFS)
  // =============================================================================
  
  // Manual Sandpack preview state - user-initiated explicit preview
  const [manualPreviewFiles, setManualPreviewFiles] = useState<Record<string, string> | null>(null);
  const [isManualPreviewActive, setIsManualPreviewActive] = useState(false);
  const [manualPreviewMayBeStale, setManualPreviewMayBeStale] = useState(false); // Track if VFS changed while in manual preview
  const [previewMode, setPreviewMode] = useState<'sandpack' | 'iframe' | 'raw' | 'parcel' | 'devbox' | 'pyodide' | 'vite' | 'webpack' | 'webcontainer' | 'nextjs' | 'codesandbox' | 'node' | 'local' | 'cloud'>('sandpack');
  const [devBoxOutput, setDevBoxOutput] = useState<string[]>([]);
  const [isDevBoxRunning, setIsDevBoxRunning] = useState(false);
  const [pyodideOutput, setPyodideOutput] = useState<string>('');
  const [isPyodideLoading, setIsPyodideLoading] = useState(false);
  const [viteOutput, setViteOutput] = useState<string>('');
  const [isViteBuilding, setIsViteBuilding] = useState(false);
  const [webpackOutput, setWebpackOutput] = useState<string>('');
  const [isWebpackBuilding, setIsWebpackBuilding] = useState(false);
  const [nodeOutput, setNodeOutput] = useState<string>('');
  const [isNodeRunning, setIsNodeRunning] = useState(false);
  const [webcontainerUrl, setWebcontainerUrl] = useState<string | null>(null);
  const [isWebcontainerBooting, setIsWebcontainerBooting] = useState(false);
  const [nextjsUrl, setNextjsUrl] = useState<string | null>(null);
  const [isNextjsBuilding, setIsNextjsBuilding] = useState(false);
  const [codesandboxUrl, setCodesandboxUrl] = useState<string | null>(null);
  const [isCodesandboxLoading, setIsCodesandboxLoading] = useState(false);
  const [localExecutionOutput, setLocalExecutionOutput] = useState<string>('');
  const [isLocalExecuting, setIsLocalExecuting] = useState(false);
  const [executionMode, setExecutionMode] = useState<'local' | 'cloud' | 'hybrid'>('local');
  const [executionCache, setExecutionCache] = useState<Map<string, { result: string; timestamp: number; hash: string }>>(new Map());
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheHits, setCacheHits] = useState(0);
  const [cacheMisses, setCacheMisses] = useState(0);
  const [snapshots, setSnapshots] = useState<Array<{ id: string; date: string; size: string }>>([]);
  const pyodideRef = useRef<any>(null);
  const manualPreviewPathRef = useRef<string | null>(null);
  const manualPreviewActiveRef = useRef(false);

  // Context menu state for file operations
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: 'file' | 'directory';
  } | null>(null);
  
  // Monaco editor state (commented out for future use)
  // const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  // const [editorContent, setEditorContent] = useState('');
  const [newFileName, setNewFileName] = useState("");

  const filesystemNodes = useMemo(() => {
    return [...filesystemRawNodes].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [filesystemRawNodes]);

  // Centralized path normalization helper
  const normalizeProjectPath = useCallback((path: string): string => {
    const originalPath = path;
    const cleanPath = stripWorkspacePrefixes(path || 'project');
    const normalized = normalizeScopePath(cleanPath);
    log(`normalizeProjectPath: "${originalPath}" -> "${normalized}"`);
    return normalized;
  }, []);

  const openFilesystemDirectory = useCallback((path: string) => {
    const cleanPath = normalizeProjectPath(path);
    log(`openFilesystemDirectory: "${path}" -> "${cleanPath}"`);
    setFilesystemCurrentPath(cleanPath);
    void listFilesystemDirectory(cleanPath);
  }, [listFilesystemDirectory, normalizeProjectPath, setFilesystemCurrentPath]);

  const openFilesystemParent = useCallback(() => {
    const cleanedCurrentPath = normalizeProjectPath(filesystemCurrentPath);
    const current = cleanedCurrentPath.replace(/\/+$/, "");
    const parts = current.split("/").filter(Boolean);
    if (parts.length <= 1 || (parts.length === 1 && parts[0] === 'project')) {
      openFilesystemDirectory("project");
      return;
    }
    const parentPath = parts.slice(0, -1).join("/");
    openFilesystemDirectory(parentPath || "project");
  }, [filesystemCurrentPath, normalizeProjectPath, openFilesystemDirectory]);

  const selectFilesystemFile = useCallback(async (path: string) => {
    log(`selectFilesystemFile: attempting to open "${path}"`);
    setIsEditingFile(false);
    setIsFilesystemFileLoading(true);
    try {
      const cleanPath = normalizeProjectPath(path);
      log(`selectFilesystemFile: reading from normalized path "${cleanPath}"`);
      const file = await readFilesystemFile(cleanPath);
      log(`selectFilesystemFile: successfully read file, path="${file.path}", language="${file.language || 'text'}", contentLength=${file.content?.length || 0}`);
      setSelectedFilesystemPath(normalizeProjectPath(file.path || cleanPath));
      setSelectedFilesystemLanguage(file.language || "text");
      setSelectedFilesystemContent(file.content || "");
      setSelectedFileIndex(null);
    } catch (error: any) {
      logError(`selectFilesystemFile: failed to open "${path}"`, error);
      const message = error?.message || 'Failed to open file';
      toast.error(message);
    } finally {
      setIsFilesystemFileLoading(false);
      log(`selectFilesystemFile: completed (loading=false)`);
    }
  }, [normalizeProjectPath, readFilesystemFile]);

  const getFileExtension = (language: string): string => {
    const extensions: Record<string, string> = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      java: "java",
      cpp: "cpp",
      c: "c",
      html: "html",
      css: "css",
      json: "json",
      xml: "xml",
      sql: "sql",
      jsx: "jsx",
      tsx: "tsx",
      php: "php",
      vue: "vue",
      vite: "js", // Vite config files are typically JS
      gradio: "py", // Gradio apps are Python
      streamlit: "py", // Streamlit apps are Python
      flask: "py", // Flask apps are Python
      fastapi: "py", // FastAPI apps are Python
      django: "py", // Django apps are Python
      svelte: "svelte",
      astro: "astro",
      solid: "jsx", // SolidJS uses JSX
      qwik: "tsx", // Qwik uses TSX
      remix: "tsx", // Remix uses TSX
      nuxt: "vue", // Nuxt uses Vue
      next: "tsx", // Next.js typically uses TSX
      ruby: "rb",
      go: "go",
      rust: "rs",
      swift: "swift",
      kotlin: "kt",
      scala: "scala",
      r: "r",
      matlab: "m",
      perl: "pl",
      lua: "lua",
      dart: "dart",
      // Removed duplicate entries
      shell: "sh",
      bash: "sh",
      yaml: "yml",
      yml: "yml",
      markdown: "md",
      md: "md",
      text: "txt",
    };
    return extensions[language.toLowerCase()] || "txt";
  };

  // Context menu handlers for file operations
  const handleCreateFile = useCallback((parentPath: string) => {
    const name = prompt('New file name (e.g., index.js):');
    if (!name?.trim()) {
      logWarn('handleCreateFile: user cancelled or empty name');
      return;
    }

    const cleanParentPath = normalizeProjectPath(parentPath || normalizedFilesystemPath);
    const newPath = `${cleanParentPath.replace(/\/+$/, '')}/${name.trim()}`;
    log(`handleCreateFile: creating "${newPath}" in parent "${cleanParentPath}"`);

    writeFilesystemFile(newPath, '').then(async (createdFile) => {
      log(`handleCreateFile: write response`, createdFile);
      const createdPath = normalizeProjectPath(createdFile?.path || newPath);
      log(`handleCreateFile: normalized created path "${createdPath}"`);
      
      await listFilesystemDirectory(cleanParentPath);
      log(`handleCreateFile: refreshed directory "${cleanParentPath}"`);
      
      // Select the newly created file
      setSelectedFilesystemPath(createdPath);
      setSelectedFilesystemContent('');
      setSelectedFilesystemLanguage(createdFile?.language || 'text');
      setSelectedFileIndex(null);
      log(`handleCreateFile: selected new file in UI`);
      
      // Dispatch event for cross-panel sync
      emitFilesystemUpdated({
        path: createdPath,
        scopePath: cleanParentPath,
        source: 'code-preview',
        workspaceVersion: createdFile?.workspaceVersion,
        commitId: createdFile?.commitId,
        sessionId: createdFile?.sessionId,
      });
      log(`handleCreateFile: dispatched filesystem-updated event`);
      
      toast.success('File created: ' + name.trim());
      setContextMenu(null);
    }).catch((err: any) => {
      logError(`handleCreateFile: failed to create file "${newPath}"`, err);
      toast.error('Failed to create file: ' + err.message);
      setContextMenu(null);
    });
  }, [listFilesystemDirectory, normalizeProjectPath, normalizedFilesystemPath, writeFilesystemFile]);

  const handleCreateFolder = useCallback((parentPath: string) => {
    const name = prompt('New folder name:');
    if (!name?.trim()) return;

    const cleanParentPath = normalizeProjectPath(parentPath || normalizedFilesystemPath);
    const folderName = name.trim();
    const newPath = `${cleanParentPath.replace(/\/+$/, '')}/${folderName}/.gitkeep`;

    writeFilesystemFile(newPath, '').then(async (createdFolderMarker) => {
      await listFilesystemDirectory(cleanParentPath);
      
      // Dispatch event for cross-panel sync
      const folderPath = `${cleanParentPath.replace(/\/+$/, '')}/${folderName}`;
      emitFilesystemUpdated({
        path: folderPath,
        scopePath: cleanParentPath,
        source: 'code-preview',
        workspaceVersion: createdFolderMarker?.workspaceVersion,
        commitId: createdFolderMarker?.commitId,
        sessionId: createdFolderMarker?.sessionId,
      });
      
      toast.success('Folder created: ' + folderName);
      setContextMenu(null);
    }).catch((err: any) => {
      toast.error('Failed to create folder: ' + err.message);
      setContextMenu(null);
    });
  }, [listFilesystemDirectory, normalizeProjectPath, normalizedFilesystemPath, writeFilesystemFile]);

  const handleRenameFile = useCallback((oldPath: string) => {
    const oldName = oldPath.split('/').pop() || '';
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;
    
    const parentPath = oldPath.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    
    // Read old file, write new file, delete old file
    readFilesystemFile(oldPath).then((file: any) => {
      return writeFilesystemFile(newPath, file.content).then(() => {
        return deleteFilesystemPath(oldPath);
      });
    }).then(() => {
      toast.success('Renamed to: ' + newName);
      void listFilesystemDirectory(filesystemCurrentPath);
      setContextMenu(null);
      if (selectedFilesystemPath === oldPath) {
        setSelectedFilesystemPath('');
        setSelectedFilesystemContent('');
      }
    }).catch((err: any) => {
      toast.error('Failed to rename: ' + err.message);
    });
  }, [filesystemCurrentPath, readFilesystemFile, writeFilesystemFile, deleteFilesystemPath, listFilesystemDirectory, selectedFilesystemPath]);

  // Helper to detect shell code blocks
  const isShellCodeBlock = useCallback((language: string, code: string): boolean => {
    const shellLanguages = ['bash', 'sh', 'shell', 'zsh', 'fish'];
    return shellLanguages.includes(language) ||
           code.trim().startsWith('npm ') || code.trim().startsWith('yarn ') ||
           code.trim().startsWith('pnpm ') || code.trim().startsWith('pip ') ||
           code.trim().startsWith('python ') || code.trim().startsWith('node ');
  }, []);

  // Handler to send command to terminal
  const handleRunCommand = useCallback((code: string) => {
    // Dispatch custom event for terminal to listen
    const event = new CustomEvent('terminal-run-command', {
      detail: { commands: [code.trim()] }
    });
    window.dispatchEvent(event);
    
    toast.info('Command sent to terminal');
  }, []);

  // Simple hash function for caching
  const hashCode = useCallback((str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }, []);

  // Check cache for execution result
  const getCachedResult = useCallback((code: string, filePath: string): string | null => {
    if (!cacheEnabled) return null;
    
    const cacheKey = `${filePath}:${hashCode(code)}`;
    const cached = executionCache.get(cacheKey);
    
    if (cached) {
      const age = Date.now() - cached.timestamp;
      const maxAge = 5 * 60 * 1000; // 5 minutes cache
      
      if (age < maxAge) {
        setCacheHits(prev => prev + 1);
        return cached.result;
      } else {
        // Cache expired
        executionCache.delete(cacheKey);
        setExecutionCache(new Map(executionCache));
      }
    }
    
    setCacheMisses(prev => prev + 1);
    return null;
  }, [cacheEnabled, executionCache, hashCode]);

  // Cache execution result
  const cacheResult = useCallback((code: string, filePath: string, result: string) => {
    if (!cacheEnabled) return;
    
    const cacheKey = `${filePath}:${hashCode(code)}`;
    const newCache = new Map(executionCache);
    newCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      hash: hashCode(code),
    });
    setExecutionCache(newCache);
    
    // Auto cleanup old entries
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;
    for (const [key, value] of newCache.entries()) {
      if (now - value.timestamp > maxAge) {
        newCache.delete(key);
      }
    }
    setExecutionCache(newCache);
  }, [cacheEnabled, executionCache, hashCode]);

  // Clear execution cache
  const clearExecutionCache = useCallback(() => {
    setExecutionCache(new Map());
    setCacheHits(0);
    setCacheMisses(0);
    toast.success('Execution cache cleared');
  }, []);

  // Manual preview handler
  // FIXED: Add ref guard to prevent multiple concurrent calls
  const handleManualPreviewRef = useRef(false);
  
  const handleManualPreview = useCallback(async (
    directoryPath?: string,
    mode?: 'sandpack' | 'iframe' | 'raw' | 'parcel' | 'devbox' | 'pyodide' | 'vite' | 'webpack' | 'webcontainer' | 'nextjs' | 'codesandbox' | 'local' | 'cloud',
    options?: { silent?: boolean; preserveTab?: boolean },
  ) => {
    // Prevent multiple concurrent calls
    if (handleManualPreviewRef.current) {
      log('[handleManualPreview] already running, skipping duplicate call');
      return;
    }
    handleManualPreviewRef.current = true;
    const silent = options?.silent ?? false;
    const preserveTab = options?.preserveTab ?? false;
    
    try {
      const targetPath = directoryPath || filesystemCurrentPath;
      manualPreviewPathRef.current = targetPath || null;
      // Silent - only log on error
      console.log('[Manual Preview] Loading files from:', targetPath);
      
      // Get all files from the directory
      const nodes = await listFilesystemDirectory(targetPath);
      const files: Record<string, string> = {};
      
      // Recursively load files
      const loadFiles = async (path: string, basePath: string = '') => {
        const dirNodes = await listFilesystemDirectory(path);
        for (const node of dirNodes) {
          const relativePath = basePath ? `${basePath}/${node.name}` : node.name;
          if (node.type === 'directory') {
            await loadFiles(node.path, relativePath);
          } else {
            try {
              const file = await readFilesystemFile(node.path);
              if (file.content) {
                files[relativePath] = file.content;
              }
            } catch (err) {
              console.warn('Failed to load file:', node.path, err);
            }
          }
        }
      };
      
      await loadFiles(targetPath);

      if (Object.keys(files).length === 0) {
        if (!silent) {
          toast.error('No files found in directory');
        }
        return;
      }

      // Advanced root detection: find the project root based on config files and entry points
      const rootScores = new Map<string, number>();
      rootScores.set('', 1);
      const addRootScore = (root: string, score: number) => {
        rootScores.set(root, (rootScores.get(root) || 0) + score);
      };

      for (const filePath of Object.keys(files)) {
        const cleanPath = filePath.replace(/^\/+/, '');
        const parts = cleanPath.split('/').filter(Boolean);
        if (parts.length === 0) continue;
        const fileName = parts[parts.length - 1];
        const dir = parts.slice(0, -1).join('/');
        
        // Score directories based on presence of config/entry files
        if (fileName === 'package.json') addRootScore(dir, 8);
        if (fileName === 'index.html') addRootScore(dir, 6);
        if (fileName === 'vite.config.ts' || fileName === 'vite.config.js' || fileName === 'webpack.config.js' || fileName === '.parcelrc') addRootScore(dir, 6);
        if (/^main\.(js|jsx|ts|tsx)$/.test(fileName)) {
          if (dir.endsWith('/src')) addRootScore(dir.replace(/\/src$/, ''), 5);
          addRootScore(dir, 2);
        }
      }

      // Select the best root directory
      const selectedRoot = Array.from(rootScores.entries())
        .sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          const aDepth = a[0] ? a[0].split('/').length : 0;
          const bDepth = b[0] ? b[0].split('/').length : 0;
          return aDepth - bDepth;
        })[0]?.[0] || '';

      // Normalize files to be relative to the detected root
      const previewFiles = Object.entries(files).reduce((acc, [filePath, content]) => {
        const cleanPath = filePath.replace(/^\/+/, '');
        const relativePath = selectedRoot && cleanPath.startsWith(`${selectedRoot}/`)
          ? cleanPath.slice(selectedRoot.length + 1)
          : cleanPath;
        acc[relativePath] = content;
        return acc;
      }, {} as Record<string, string>);

      log(`[handleManualPreview] detected root="${selectedRoot}", files normalized from ${Object.keys(files).length} to ${Object.keys(previewFiles).length}`);

      // Auto-detect best preview mode AND execution mode
      let selectedMode = mode || 'sandpack';
      let detectedExecutionMode: 'local' | 'cloud' | 'hybrid' = 'local';

      if (!mode) {
        const filePaths = Object.keys(previewFiles);
        const hasHtml = filePaths.some(f => f.endsWith('.html'));
        const hasJsx = filePaths.some(f => f.endsWith('.jsx') || f.endsWith('.tsx'));
        const hasVue = filePaths.some(f => f.endsWith('.vue'));
        const hasSvelte = filePaths.some(f => f.endsWith('.svelte'));
        const hasPython = filePaths.some(f => f.endsWith('.py'));
        const hasNodeServer = filePaths.some(f => ['server.js', 'app.js', 'index.js'].includes(f));
        const hasNextJS = filePaths.some(f => 
          f.startsWith('pages/') || 
          f.startsWith('app/') ||
          f.includes('next.config') ||
          f.includes('/_app.') ||
          f.includes('/_document.')
        );
        const hasPackageJson = filePaths.includes('package.json');
        const hasSimplePython = hasPython && !filePaths.some(f => f.includes('flask') || f.includes('django'));
        const hasViteConfig = filePaths.some(f => f.includes('vite.config'));
        const hasWebpackConfig = filePaths.some(f => f.includes('webpack.config'));
        const hasParcelConfig = filePaths.some(f => f.includes('parcel') || f.endsWith('.parcelrc'));
        const packageJsonContent = hasPackageJson ? previewFiles['package.json'] : '';
        const hasViteProject = hasViteConfig || packageJsonContent.includes('"vite"');
        const hasWebpackProject = hasWebpackConfig || packageJsonContent.includes('"webpack"');
        const hasParcelProject = hasParcelConfig || packageJsonContent.includes('"parcel"');
        const hasHeavyComputation = Object.values(previewFiles).some((c: any) => {
          if (typeof c !== 'string') return false;
          return c.includes('tensorflow') || c.includes('pytorch') || c.includes('cuda') || c.includes('gpu');
        });
        const hasAPIKeys = Object.values(previewFiles).some((c: any) =>
          typeof c === 'string' && (c.includes('OPENAI_API_KEY') || c.includes('process.env'))
        );

        // Determine execution mode based on requirements
        if (hasHeavyComputation || hasAPIKeys) {
          detectedExecutionMode = 'cloud';
        } else if (hasSimplePython || hasJsx || hasVue || hasSvelte || hasHtml) {
          detectedExecutionMode = 'local';
        } else if (hasPython || hasNodeServer) {
          detectedExecutionMode = 'hybrid';
        }

        // Select preview mode with enhanced bundler detection and fallback hierarchy
        // Check for Next.js first (before generic node server detection)
        const nextJsInPackageJson = packageJsonContent && packageJsonContent.includes('"next"');
        const nextJsConfig = filePaths.some(f => f.includes('next.config'));
        const nextJsPagesOrApp = filePaths.some(f => f.startsWith('pages/') || f.startsWith('app/'));
        
        if (nextJsConfig || nextJsInPackageJson || nextJsPagesOrApp) {
          selectedMode = 'nextjs';
        } else if (hasViteProject) {
          selectedMode = 'vite';
        } else if (hasWebpackProject) {
          selectedMode = 'webpack';
        } else if (hasParcelProject) {
          selectedMode = 'parcel';
        } else if (hasSimplePython && !hasPackageJson) {
          selectedMode = 'pyodide';
        } else if (hasNodeServer && hasPackageJson) {
          // Check for Next.js first (highest priority for Node frameworks)
          const hasNextJS = filePaths.some(f => 
            f === 'next.config.js' || 
            f === 'next.config.mjs' || 
            f === 'next.config.ts'
          ) || (packageJsonContent && packageJsonContent.includes('"next"'));
          
          if (hasNextJS) {
            selectedMode = 'nextjs'; // Next.js gets its own optimized preview
          } else {
            // Node.js backend with package.json = WebContainer (preferred, runs in browser)
            selectedMode = 'webcontainer';
          }
        } else if (hasPython || hasNodeServer) {
          // Python or Node without simple setup = CodeSandbox (cloud fallback)
          // Only use CodeSandbox if project is complex (has Docker, complex deps, etc.)
          const hasDocker = filePaths.some(f => f === 'Dockerfile' || f === 'docker-compose.yml');
          const hasComplexDeps = packageJsonContent && (
            packageJsonContent.includes('prisma') ||
            packageJsonContent.includes('sequelize') ||
            packageJsonContent.includes('typeorm') ||
            packageJsonContent.includes('mongodb') ||
            packageJsonContent.includes('redis')
          );
          
          if (hasDocker || hasComplexDeps) {
            selectedMode = 'codesandbox'; // Cloud dev environment for complex apps
          } else {
            selectedMode = detectedExecutionMode === 'local' ? 'local' : 'devbox';
          }
        } else if (hasHtml && !hasJsx && !hasVue && !hasSvelte) {
          selectedMode = 'iframe';
        } else if (hasJsx || hasVue || hasSvelte) {
          selectedMode = 'sandpack';
        }
      }

      log(`[handleManualPreview] mode="${selectedMode}", execution="${detectedExecutionMode}", root="${selectedRoot}"`);

      // Set execution mode
      setExecutionMode(detectedExecutionMode);

      // Set manual preview files and activate (use normalized previewFiles, not raw files)
      setManualPreviewFiles(previewFiles);
      setIsManualPreviewActive(true);
      setPreviewMode(selectedMode);
      if (!preserveTab) {
        setSelectedTab('preview');  // Always switch to preview tab
      }

      const modeIcon = {
        sandpack: '▶', iframe: '📄', raw: '📝', parcel: '⚡',
        devbox: '🔵', pyodide: '🐍', vite: '⚡', webpack: '📦', 
        webcontainer: '📀', nextjs: '▲', codesandbox: '🏖️', node: '🟢', local: '💻', cloud: '☁️'
      }[selectedMode] || '▶';

      const execIcon = { local: '💻', cloud: '☁️', hybrid: '🔄' }[detectedExecutionMode];

      if (!silent) {
        toast.success(`${modeIcon} Preview loaded (${selectedMode}) - ${execIcon} ${detectedExecutionMode} execution`, {
          description: `${Object.keys(previewFiles).length} files (root: "${selectedRoot || 'project root'}")`
        });
      }
    } catch (error: any) {
      logError(`[handleManualPreview] failed`, error);
      console.error('[Manual Preview] Error:', error);
      if (!silent) {
        toast.error('Failed to load preview: ' + error.message);
      }
    } finally {
      // Reset the guard to allow future calls
      handleManualPreviewRef.current = false;
    }
  }, [filesystemCurrentPath, listFilesystemDirectory, readFilesystemFile]);

  useEffect(() => {
    manualPreviewActiveRef.current = isManualPreviewActive;
  }, [isManualPreviewActive]);

  // Clear manual preview
  const handleClearManualPreview = useCallback(() => {
    setManualPreviewFiles(null);
    setIsManualPreviewActive(false);
    setManualPreviewMayBeStale(false); // Clear stale state
    toast.info('Manual preview cleared');
  }, []);

  // Refresh manual preview (clears stale state)
  const handleRefreshManualPreview = useCallback(() => {
    if (manualPreviewPathRef.current) {
      log('[handleRefreshManualPreview] refreshing manual preview');
      setManualPreviewMayBeStale(false); // Clear stale before refresh
      void handleManualPreview(manualPreviewPathRef.current, undefined, { silent: false, preserveTab: true });
    }
  }, [handleManualPreview]);

  // Listen for terminal preview commands
  useEffect(() => {
    const handleTerminalPreview = (e: CustomEvent) => {
      const { directory } = e.detail || {};
      handleManualPreview(directory);
    };
    
    window.addEventListener('code-preview-manual' as any, handleTerminalPreview);
    return () => window.removeEventListener('code-preview-manual' as any, handleTerminalPreview);
  }, [handleManualPreview]);

  // Listen for VFS save events from visual editor
  useEffect(() => {
    const VFS_SAVE_CHANNEL = "visual_editor_vfs_save";

    const processVfsSave = async (savedScopePath: string, updatedFiles: Record<string, string>) => {
      const now = Date.now();
      if (now - lastVfsSaveRef.current < VFS_SAVE_DEBOUNCE_MS) {
        log(`[VFS_SAVE] debounced, last save ${now - lastVfsSaveRef.current}ms ago`);
        return;
      }
      lastVfsSaveRef.current = now;

      const normalizedScope = normalizeProjectPath(savedScopePath || 'project');

      // Track write results for event emission
      const writeResults: Array<{ path: string; workspaceVersion?: number; commitId?: string; sessionId?: string | null }> = [];

      for (const [filePath, content] of Object.entries(updatedFiles)) {
        let fullPath = filePath;
        if (!filePath.startsWith(normalizedScope + '/') && filePath !== normalizedScope) {
          fullPath = `${normalizedScope}/${filePath}`.replace(/\/+/g, '/');
        }
        try {
          const result = await writeFilesystemFile(fullPath, content);
          writeResults.push({
            path: fullPath,
            workspaceVersion: result?.workspaceVersion,
            commitId: result?.commitId,
            sessionId: result?.sessionId,
          });
          log(`[VFS_SAVE] wrote "${fullPath}"`);
        } catch (err) {
          logError(`[VFS_SAVE] failed to write "${fullPath}"`, err);
        }
      }

      try {
        await listFilesystemDirectory(normalizedScope);
      } catch (err) {
        logError(`[VFS_SAVE] failed to refresh filesystem`, err);
      }

      setScopedPreviewFiles(updatedFiles);

      if (selectedTab === 'preview') {
        setTimeout(() => {
          handleManualPreview(normalizedScope);
        }, 500);
      }

      localStorage.removeItem("visualEditorPendingSave");
      toast.success("Visual editor changes synced to filesystem");

      // Dispatch event for cross-panel sync (Terminal, Chat)
      // Include all updated file paths so other panels know what changed
      if (writeResults.length > 0) {
        emitFilesystemUpdated({
          scopePath: normalizedScope,
          source: 'visual-editor',
          paths: writeResults.map(r => r.path),
          workspaceVersion: writeResults[0]?.workspaceVersion,
          commitId: writeResults[0]?.commitId,
          sessionId: writeResults[0]?.sessionId,
        });
        log(`[VFS_SAVE] dispatched filesystem-updated event for ${writeResults.length} files`);
      }
    };

    const bc = new BroadcastChannel(VFS_SAVE_CHANNEL);
    bc.onmessage = async (event) => {
      if (event.data?.type === "VFS_SAVE") {
        const { filesystemScopePath: savedScopePath, files: updatedFiles } = event.data;
        log(`[VFS_SAVE via BroadcastChannel] received, scope="${savedScopePath}", files=[${Object.keys(updatedFiles).join(', ')}]`);
        await processVfsSave(savedScopePath, updatedFiles);
      }
    };

    const handleWindowMessage = async (e: MessageEvent) => {
      if (e.data?.type === "VFS_SAVE") {
        const { filesystemScopePath: savedScopePathRaw, files: updatedFilesRaw } = e.data;
        const savedScopePath = typeof savedScopePathRaw === 'string' ? savedScopePathRaw : filesystemScopePath;
        const updatedFiles = (updatedFilesRaw && typeof updatedFilesRaw === 'object'
          ? updatedFilesRaw
          : {}) as Record<string, string>;
        
        log(`[VFS_SAVE via window message] received, scope="${savedScopePath}", files=[${Object.keys(updatedFiles).join(', ')}]`);
        await processVfsSave(savedScopePath, updatedFiles);
      }
    };

    window.addEventListener("message", handleWindowMessage);

    const handleStorageEvent = async (e: StorageEvent) => {
      if (e.key === "visualEditorPendingSave" && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload?.type === "VFS_SAVE") {
            const { filesystemScopePath: savedScopePath, files: updatedFiles } = payload;
            log(`[VFS_SAVE via storage event] received, scope="${savedScopePath}", files=[${Object.keys(updatedFiles).join(', ')}]`);
            await processVfsSave(savedScopePath, updatedFiles);
            
            toast.success("Visual editor changes synced to filesystem");
          }
        } catch (err) {
          logError("[VFS_SAVE storage] failed to parse payload", err);
        }
      }
    };

    window.addEventListener("storage", handleStorageEvent);

    return () => {
      bc.close();
      window.removeEventListener("message", handleWindowMessage);
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, [filesystemScopePath, writeFilesystemFile, listFilesystemDirectory, selectedTab, handleManualPreview, normalizeProjectPath]);

  // Extract code blocks from messages using centralized parser
  const codeBlocks = useMemo(() => {
    const parsedData = parseCodeBlocksFromMessages(messages);
    return parsedData.codeBlocks;
  }, [messages]);

  // Reset selectedFileIndex when codeBlocks change
  useEffect(() => {
    if (codeBlocks.length === 0) {
      setSelectedFileIndex(0);
    } else if (selectedFileIndex >= codeBlocks.length) {
      setSelectedFileIndex(0);
    }
  }, [codeBlocks.length, selectedFileIndex]);

  // Auto-load preview when panel opens
  // FIXED: Use refs to avoid dependency loop with handleManualPreview
  const autoLoadPreviewRef = useRef(false);
  
  useEffect(() => {
    if (!isOpen) {
      autoLoadPreviewRef.current = false;
      return;
    }
    
    // Only run once when panel opens
    if (autoLoadPreviewRef.current) return;
    autoLoadPreviewRef.current = true;

    const autoLoadPreview = async () => {
      log('[autoLoadPreview] panel opened, checking if preview should load');

      // Check if there are files in the filesystem
      try {
        const nodes = await listFilesystemDirectory(filesystemCurrentPath || filesystemScopePath || 'project');
        const hasFiles = nodes.some(n => n.type === 'file');

        if (hasFiles && !isManualPreviewActive) {
          log('[autoLoadPreview] files detected, loading preview automatically');
          // Small delay to ensure panel is fully rendered
          setTimeout(() => {
            handleManualPreview();
          }, 100);
        }
      } catch (err) {
        logError('[autoLoadPreview] failed to check for files', err);
      }
    };

    autoLoadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Only depend on isOpen - run once when panel opens

  useEffect(() => {
    if (!isOpen || selectedTab !== "files") {
      return;
    }
    let cancelled = false;
    let isInitialized = false;

    const initializeExplorer = async () => {
      if (isInitialized) return;
      isInitialized = true;

      setSelectedFilesystemPath("");
      setSelectedFilesystemContent("");
      setSelectedFilesystemLanguage("text");

      const initialNodes = await listFilesystemDirectory(filesystemScopePath);
      if (cancelled) return;
      setFilesystemCurrentPath(filesystemScopePath);
      if (initialNodes.length > 0) return;

      const sessionsRoot = "project/sessions";
      const sessionDirectories = (await listFilesystemDirectory(sessionsRoot))
        .filter((node) => node.type === "directory");
      if (cancelled) return;
      if (sessionDirectories.length === 0) return;

      const preferred = sessionDirectories
        .slice()
        .sort((a, b) => {
          const aDraft = a.name.startsWith("draft-chat_") ? 1 : 0;
          const bDraft = b.name.startsWith("draft-chat_") ? 1 : 0;
          if (aDraft !== bDraft) return bDraft - aDraft;
          return b.name.localeCompare(a.name);
        });

      for (const directory of preferred) {
        const nodes = await listFilesystemDirectory(directory.path);
        if (cancelled) return;
        if (nodes.length > 0) {
          setFilesystemCurrentPath(directory.path);
          return;
        }
      }
    };

    void initializeExplorer();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesystemScopePath, isOpen, selectedTab]); // Removed listFilesystemDirectory from deps

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    let isRunning = false;
    
    const loadScopedFiles = async () => {
      if (isRunning) return;
      isRunning = true;
      
      try {
        const snapshot = await getFilesystemSnapshot(filesystemScopePath);
        if (cancelled) return;
        if (typeof snapshot?.version === 'number') {
          lastWorkspaceVersionRef.current = Math.max(lastWorkspaceVersionRef.current, snapshot.version);
        }
        const files = (snapshot?.files || []).reduce(
          (acc, file) => {
            acc[file.path] = file.content;
            return acc;
          },
          {} as Record<string, string>,
        );
        if (!cancelled) {
          setScopedPreviewFiles(files);
        }
      } catch {
        if (!cancelled) {
          setScopedPreviewFiles({});
        }
      } finally {
        isRunning = false;
      }
    };

    void loadScopedFiles();
    return () => { cancelled = true; };
  }, [filesystemScopePath, isOpen, getFilesystemSnapshot]);

  // Bidirectional sync: Event-driven refresh from terminal/editor updates
  // FIXED: Use refs to avoid re-creating listener on every dependency change
  const filesystemCurrentPathRef = useRef(filesystemCurrentPath);
  const filesystemScopePathRef = useRef(filesystemScopePath);
  const lastWorkspaceVersionRef = useRef(0);

  useEffect(() => {
    filesystemCurrentPathRef.current = filesystemCurrentPath;
  }, [filesystemCurrentPath]);

  useEffect(() => {
    filesystemScopePathRef.current = filesystemScopePath;
  }, [filesystemScopePath]);

  // Clear preview state on navigation (filesystemScopePath change)
  // This ensures fresh state when user navigates to a different session/directory
  useEffect(() => {
    const prevScope = previousScopePathRef.current;
    if (prevScope !== filesystemScopePath) {
      log(`[navigation] scope changed from "${prevScope}" to "${filesystemScopePath}", clearing preview state`);
      
      // Clear manual preview state on navigation
      setManualPreviewFiles(null);
      setIsManualPreviewActive(false);
      setManualPreviewMayBeStale(false);
      
      // Clear filesystem selection
      setSelectedFilesystemPath('');
      setSelectedFilesystemContent('');
      setSelectedFilesystemLanguage('text');
      
      // Reset workspace version tracking for new scope
      lastWorkspaceVersionRef.current = 0;
      
      previousScopePathRef.current = filesystemScopePath;
    }
  }, [filesystemScopePath, log]);

  useEffect(() => {
    if (!isOpen) return;

    const refresh = async (detail?: any) => {
      log(`[filesystem-updated event] received`, detail);

      try {
        const eventWorkspaceVersion = typeof detail?.workspaceVersion === 'number' ? detail.workspaceVersion : null;
        if (eventWorkspaceVersion !== null && eventWorkspaceVersion <= lastWorkspaceVersionRef.current) {
          log(`[filesystem-updated] skipped stale event at workspaceVersion=${eventWorkspaceVersion}`);
          return;
        }

        // Use refs to avoid re-creating listener
        const currentPath = filesystemCurrentPathRef.current || filesystemScopePathRef.current || 'project';
        const normalizedScopePath = normalizeProjectPath(currentPath);
        log(`[filesystem-updated] refreshing directory: "${normalizedScopePath}"`);
        await listFilesystemDirectory(normalizedScopePath);
        log(`[filesystem-updated] directory refreshed`);

        // Also refresh scoped preview files using ref
        const scopePath = filesystemScopePathRef.current;
        if (scopePath) {
          const snapshot = await getFilesystemSnapshot(scopePath);
          if (typeof snapshot?.version === 'number') {
            lastWorkspaceVersionRef.current = Math.max(lastWorkspaceVersionRef.current, snapshot.version);
          } else if (eventWorkspaceVersion !== null) {
            lastWorkspaceVersionRef.current = Math.max(lastWorkspaceVersionRef.current, eventWorkspaceVersion);
          }
          const files = (snapshot?.files || []).reduce(
            (acc, file) => {
              acc[file.path] = file.content;
              return acc;
            },
            {} as Record<string, string>,
          );
          setScopedPreviewFiles(files);
          log(`[filesystem-updated] refreshed scopedPreviewFiles (${Object.keys(files).length} files)`);
        }

        // CRITICAL: Do NOT auto-refresh manualPreviewFiles!
        // Manual preview is user-initiated and should NOT be overwritten by automatic events.
        // If the user wants to refresh their manual preview, they will explicitly do so.
        // This prevents the race condition where VFS updates overwrite user-selected preview.
        if (manualPreviewActiveRef.current) {
          // PRECISE STALE DETECTION: Only mark as stale if files changed in the previewed directory
          const eventScopePath = detail?.scopePath;
          const eventPaths = detail?.paths as string[] | undefined;
          const previewedDir = manualPreviewPathRef.current;
          
          let isRelevantChange = false;
          
          if (eventScopePath && previewedDir) {
            // Check if the scope path matches or is a subdirectory of the previewed directory
            const normalizedEventScope = normalizeProjectPath(eventScopePath);
            const normalizedPreviewed = normalizeProjectPath(previewedDir);
            
            // Direct match, event is in a subdirectory of previewed, OR previewed is a subdirectory of event
            // (parent directory changes could add new files that get imported)
            if (normalizedEventScope === normalizedPreviewed || 
                normalizedEventScope.startsWith(normalizedPreviewed + '/') ||
                normalizedPreviewed.startsWith(normalizedEventScope + '/')) {
              isRelevantChange = true;
            }
          } else if (eventPaths && eventPaths.length > 0 && previewedDir) {
            // Fallback: check if any changed paths are within the previewed directory
            const normalizedPreviewed = normalizeProjectPath(previewedDir);
            isRelevantChange = eventPaths.some(p => {
              const normalizedPath = normalizeProjectPath(p);
              return normalizedPath.startsWith(normalizedPreviewed + '/') || 
                     normalizedPath === normalizedPreviewed;
            });
          } else if (!eventScopePath && !eventPaths) {
            // No scope info - assume it's a general change (conservative)
            isRelevantChange = true;
          }
          
          if (isRelevantChange) {
            log(`[filesystem-updated] manual preview active - files changed in previewed directory, marking stale`);
            setManualPreviewMayBeStale(true);
          } else {
            log(`[filesystem-updated] manual preview active - change in different directory (${eventScopePath || 'unknown'}), not marking stale`);
          }
        }
      } catch (error) {
        logError(`[filesystem-updated] refresh failed`, error);
        console.error('[CodePreview] Event refresh error:', error);
      }
    };

    const scheduler = createRefreshScheduler(refresh, { minIntervalMs: 1000, maxDelayMs: 3000 });
    const unsubscribe = onFilesystemUpdated((event) => scheduler.schedule(event.detail));
    log('[CodePreviewPanel] registered filesystem-updated event listener');
    return () => {
      unsubscribe();
      scheduler.dispose();
      log('[CodePreviewPanel] removed filesystem-updated event listener');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Only depend on isOpen - listener stays stable

  // Generate project structure for complex projects
  // Also merge virtual filesystem files for live preview
  useEffect(() => {
    if (codeBlocks.length > 0) {
      // Use the centralized parser to get project structure
      const parsedData = parseCodeBlocksFromMessages(messages);
      if (parsedData.projectStructure) {
        setProjectStructure(parsedData.projectStructure);
      } else {
        // Fallback to analyzing existing code blocks
        const structure = analyzeProjectStructure(codeBlocks);
        setProjectStructure(structure);
      }
    } else if (
      (projectFiles && Object.keys(projectFiles).length > 0) ||
      Object.keys(scopedPreviewFiles).length > 0
    ) {
      const files = {
        ...(projectFiles || {}),
        ...scopedPreviewFiles,
      };
      const structure: ProjectStructure = {
        name: 'filesystem-project',
        files,
        framework: 'react',
        bundler: 'vite',
        packageManager: 'npm'
      };
      setProjectStructure(structure);
    }
  }, [codeBlocks, scopedPreviewFiles, projectFiles]);

  const projectStructureWithScopedFiles = useMemo(() => {
    const scopedRelativeFiles = Object.entries(scopedPreviewFiles).reduce(
      (acc, [path, content]) => {
        const relativePath = path.startsWith(`${filesystemScopePath}/`)
          ? path.slice(filesystemScopePath.length + 1)
          : path.replace(/^project\//, '');
        acc[relativePath] = content;
        return acc;
      },
      {} as Record<string, string>,
    );

    if (projectStructure) {
      return {
        ...projectStructure,
        files: {
          ...projectStructure.files,
          ...scopedRelativeFiles,
        },
      };
    }

    if (Object.keys(scopedRelativeFiles).length > 0) {
      return {
        name: 'scoped-filesystem-project',
        files: scopedRelativeFiles,
        framework: 'react' as const,
        bundler: 'vite' as const,
        packageManager: 'npm' as const,
      };
    }

    return null;
  }, [filesystemScopePath, projectStructure, scopedPreviewFiles]);

  const visualEditorProjectData = useMemo(() => {
    let structure = projectStructureWithScopedFiles || projectStructure;
    
    if (!structure && scopedPreviewFiles && Object.keys(scopedPreviewFiles).length > 0) {
      structure = {
        name: 'filesystem-project',
        files: scopedPreviewFiles,
        framework: 'react',
        bundler: 'vite',
        packageManager: 'npm',
        filesystemScopePath: normalizeProjectPath(filesystemScopePath || normalizedFilesystemPath)
      };
    }
    
    if (!structure && projectFiles && Object.keys(projectFiles).length > 0) {
      structure = {
        name: 'filesystem-project',
        files: projectFiles,
        framework: 'react',
        bundler: 'vite',
        packageManager: 'npm',
        filesystemScopePath: normalizeProjectPath(filesystemScopePath || normalizedFilesystemPath)
      };
    }

    const files = structure?.files || {};
    const filePaths = Object.keys(files);
    
    if (filePaths.length === 0) {
      return null;
    }

    const packageJsonPath = filePaths.find((p) => p === 'package.json' || p.endsWith('/package.json'));
    const packageJsonContent = packageJsonPath ? files[packageJsonPath] : '';

    // Infer bundler from config files or package.json
    const inferredBundler = structure.bundler
      || (filePaths.some((p) => p.includes('vite.config')) || packageJsonContent.includes('"vite"') ? 'vite'
        : filePaths.some((p) => p.includes('webpack.config')) || packageJsonContent.includes('"webpack"') ? 'webpack'
          : filePaths.some((p) => p.includes('parcel') || p.endsWith('.parcelrc')) || packageJsonContent.includes('"parcel"') ? 'parcel'
            : filePaths.some((p) => p.includes('next.config')) || packageJsonContent.includes('"next"') || filePaths.some((p) => p.startsWith('pages/') || p.startsWith('app/')) ? 'nextjs'
              : undefined);

    // Detect entry file from common patterns
    const entryCandidates = [
      'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
      'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
      'app.tsx', 'app.jsx', 'page.tsx', 'index.tsx', 'index.jsx', 'index.ts', 'index.js', 'index.html',
      'main.py', 'app.py', 'manage.py', 'server.js', 'app.js', 'index.js'
    ];
    const entryFile =
      entryCandidates.find((candidate) => filePaths.includes(candidate))
      || filePaths.find((path) => path.endsWith('/index.html'))
      || filePaths.find((path) => path.endsWith('/main.tsx') || path.endsWith('/main.jsx') || path.endsWith('/main.ts') || path.endsWith('/main.js'))
      || filePaths.find((path) => path.endsWith('/index.tsx') || path.endsWith('/index.jsx') || path.endsWith('/index.ts') || path.endsWith('/index.js'))
      || filePaths[0]
      || null;

    // Infer preview mode hint
    const previewModeHint =
      inferredBundler === 'vite' ? 'vite'
      : inferredBundler === 'webpack' ? 'webpack'
      : inferredBundler === 'parcel' ? 'parcel'
      : filePaths.some((p) => p.startsWith('next.config')) || (packageJsonContent && packageJsonContent.includes('"next"')) ? 'nextjs'
      : filePaths.some((p) => ['server.js', 'app.js', 'index.js'].includes(p) && packageJsonContent) ? 'webcontainer'
      : filePaths.some((p) => p === 'Dockerfile' || p === 'docker-compose.yml') ? 'codesandbox'
      : filePaths.some((p) => p.endsWith('.html')) ? 'iframe'
      : filePaths.some((p) => p.endsWith('.py')) ? 'pyodide'
      : 'sandpack';

    log(`[visualEditorProjectData] bundler="${inferredBundler}", entryFile="${entryFile}", previewModeHint="${previewModeHint}"`);

    return {
      ...structure,
      filesystemScopePath: normalizeProjectPath(filesystemScopePath || normalizedFilesystemPath),
      bundler: inferredBundler,
      entryFile,
      previewModeHint,
    };
  }, [filesystemScopePath, normalizeProjectPath, normalizedFilesystemPath, projectStructure, projectStructureWithScopedFiles]);

  const applySimpleLineDiff = (
    originalContent: string,
    diffBlock: string,
  ): string => {
    try {
      // Extract only lines with prefixes from unified-like simple diff
      const lines = diffBlock
        .split("\n")
        .filter((l) => /^(\+\s|\-\s|\s\s)/.test(l.trimStart()))
        .map((l) => l.replace(/^\s+/, ""));
      if (lines.length === 0) return originalContent;
      const resultLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("+ ")) {
          resultLines.push(line.slice(2));
        } else if (line.startsWith("- ")) {
          // removed line: skip
          continue;
        } else if (line.startsWith("  ")) {
          resultLines.push(line.slice(2));
        }
      }
      const result = resultLines.join("\n");
      return result || originalContent;
    } catch (e) {
      console.warn("Failed to apply diff, returning original content");
      return originalContent;
    }
  };

  const analyzeProjectStructure = (blocks: CodeBlock[]): ProjectStructure => {
    const files: { [key: string]: string } = {};
    const dependencies: string[] = [];
    const devDependencies: string[] = [];
    const scripts: { [key: string]: string } = {};
    let framework: ProjectStructure["framework"] = "vanilla";
    let bundler: ProjectStructure["bundler"] = undefined;
    let packageManager: ProjectStructure["packageManager"] = "npm";

    for (const block of blocks) {
      // Use the filename that was already cleaned in useMemo
      const finalFilename = block.filename;

      // Ensure a filename is always set, even if it's a default one.
      if (!finalFilename) {
        console.error(
          "Filename is unexpectedly null or undefined after cleaning.",
        );
        continue; // Skip this block if filename is missing
      }

      files[finalFilename] = block.code;

      // Extract dependencies and project info
      if (block.language === "json" && finalFilename === "package.json") {
        try {
          const pkg = JSON.parse(block.code);
          if (pkg.dependencies) {
            dependencies.push(...Object.keys(pkg.dependencies));

            // Enhanced framework detection based on dependencies
            if (pkg.dependencies.next || pkg.dependencies["next"]) {
              framework = "next";
            } else if (
              pkg.dependencies.nuxt ||
              pkg.dependencies["@nuxt/core"] ||
              pkg.dependencies["nuxt3"]
            ) {
              framework = "nuxt";
            } else if (pkg.dependencies.gatsby || pkg.dependencies["gatsby"]) {
              framework = "gatsby";
            } else if (pkg.dependencies.astro || pkg.dependencies["astro"]) {
              framework = "astro";
            } else if (pkg.dependencies["@remix-run/react"]) {
              framework = "remix";
            } else if (pkg.dependencies.svelte || pkg.dependencies["svelte"]) {
              framework = "svelte";
            } else if (pkg.dependencies["solid-js"]) {
              framework = "solid";
            } else if (pkg.dependencies["@builder.io/qwik"]) {
              framework = "qwik";
            } else if (pkg.dependencies.gradio) {
              framework = "gradio";
            } else if (pkg.dependencies.streamlit) {
              framework = "streamlit";
            } else if (pkg.dependencies.flask || pkg.dependencies["Flask"]) {
              framework = "flask";
            } else if (
              pkg.dependencies.fastapi ||
              pkg.dependencies["fastapi"]
            ) {
              framework = "fastapi";
            } else if (pkg.dependencies.django || pkg.dependencies["Django"]) {
              framework = "django";
            } else if (pkg.dependencies.react) {
              framework = "react";
            } else if (pkg.dependencies.vue || pkg.dependencies["@vue/core"]) {
              framework = "vue";
            } else if (pkg.dependencies["@angular/core"]) {
              framework = "angular";
            }
          }

          if (pkg.devDependencies) {
            devDependencies.push(...Object.keys(pkg.devDependencies));

            // Detect bundler from devDependencies
            if (pkg.devDependencies.vite) {
              bundler = "vite";
            } else if (pkg.devDependencies.webpack) {
              bundler = "webpack";
            } else if (pkg.devDependencies.parcel) {
              bundler = "parcel";
            } else if (pkg.devDependencies.rollup) {
              bundler = "rollup";
            } else if (pkg.devDependencies.esbuild) {
              bundler = "esbuild";
            }
          }

          if (pkg.scripts) {
            Object.assign(scripts, pkg.scripts);
          }

          // Detect package manager from lockfiles or packageManager field
          if (pkg.packageManager) {
            if (pkg.packageManager.includes("yarn")) packageManager = "yarn";
            else if (pkg.packageManager.includes("pnpm"))
              packageManager = "pnpm";
            else if (pkg.packageManager.includes("bun")) packageManager = "bun";
          }
        } catch (e) {
          console.warn("Failed to parse package.json");
        }
      }

      // Detect framework based on file extensions and paths
      if (framework === "vanilla") {
        const ext = getFileExtension(block.language);
        if (ext === "jsx" || ext === "tsx") {
          framework = "react";
        } else if (ext === "vue") {
          framework = "vue";
        } else if (ext === "svelte") {
          framework = "svelte";
        } else if (ext === "astro") {
          framework = "astro";
        } else if (ext === "ts" && finalFilename.includes(".component.")) {
          framework = "angular";
        } else if (
          ext === "py" &&
          (finalFilename.includes("gradio") ||
            block.code.includes("import gradio"))
        ) {
          framework = "gradio";
        } else if (
          ext === "py" &&
          (finalFilename.includes("streamlit") ||
            block.code.includes("import streamlit"))
        ) {
          framework = "streamlit";
        } else if (
          ext === "py" &&
          (finalFilename.includes("app.py") ||
            block.code.includes("from flask import"))
        ) {
          framework = "flask";
        } else if (
          ext === "py" &&
          (finalFilename.includes("main.py") ||
            block.code.includes("from fastapi import"))
        ) {
          framework = "fastapi";
        } else if (
          ext === "py" &&
          (finalFilename.includes("manage.py") || block.code.includes("django"))
        ) {
          framework = "django";
        } else if (
          finalFilename.includes("vite.config") ||
          finalFilename.includes("vite.config.js") ||
          finalFilename.includes("vite.config.ts")
        ) {
          // If we see a vite config, it's likely a vite project
          if (framework === "vanilla") framework = "vite-react";
        }
      }

      // Detect package manager from lockfiles
      if (finalFilename === "yarn.lock") packageManager = "yarn";
      else if (finalFilename === "pnpm-lock.yaml") packageManager = "pnpm";
      else if (finalFilename === "bun.lockb") packageManager = "bun";
    }

    // Detect entry file
    const entryCandidates = [
      'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
      'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
      'app.tsx', 'app.jsx', 'page.tsx', 'index.tsx', 'index.jsx', 'index.ts', 'index.js', 'index.html',
      'main.py', 'app.py', 'manage.py', 'server.js', 'app.js'
    ];
    const entryFile =
      entryCandidates.find((candidate) => Object.prototype.hasOwnProperty.call(files, candidate))
      || Object.keys(files).find((path) => path.endsWith('/index.html'))
      || Object.keys(files).find((path) => path.endsWith('/main.tsx') || path.endsWith('/main.jsx') || path.endsWith('/main.ts') || path.endsWith('/main.js'))
      || Object.keys(files).find((path) => path.endsWith('/index.tsx') || path.endsWith('/index.jsx') || path.endsWith('/index.ts') || path.endsWith('/index.js'))
      || Object.keys(files)[0]
      || null;

    // Detect preview mode hint
    const previewModeHint =
      bundler === 'vite' ? 'vite'
      : bundler === 'webpack' ? 'webpack'
      : bundler === 'parcel' ? 'parcel'
      : Object.keys(files).some((p) => p.endsWith('.html')) ? 'iframe'
      : Object.keys(files).some((p) => p.endsWith('.py')) ? 'pyodide'
      : 'sandpack';

    const structure: ProjectStructure = {
      name: "Generated Project",
      files,
      dependencies: dependencies.length > 0 ? dependencies : undefined,
      devDependencies: devDependencies.length > 0 ? devDependencies : undefined,
      scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
      framework,
      bundler,
      packageManager,
      entryFile,
      previewModeHint,
      filesystemScopePath,
    };
    return structure;
  };

  const downloadAsZip = async () => {
    const zip = new JSZip();

    // Try to get files from VFS first (most up-to-date)
    try {
      const snapshot = await getFilesystemSnapshot(filesystemScopePath);
      const vfsFiles = snapshot?.files || [];
      
      if (vfsFiles.length > 0) {
        // Add all VFS files to zip
        for (const file of vfsFiles) {
          // Get relative path from workspace
          const relativePath = file.path.replace(/^project\//, '');
          zip.file(relativePath, file.content || '');
        }
        
        console.log('[Download] Added', vfsFiles.length, 'files from VFS');
      }
    } catch (err) {
      console.warn('[Download] Failed to get VFS files, using fallback:', err);
    }

    // Fallback to project structure if VFS failed or empty
    const structureToUse = projectStructureWithScopedFiles || projectStructure;
    
    if (zip.files['README.md'] === undefined && structureToUse && Object.keys(structureToUse.files).length > 0) {
      // Add all files from project structure
      Object.entries(structureToUse.files).forEach(([filename, fileData]) => {
        const content = fileData;
        if (!zip.files[filename]) {
          zip.file(filename, content);
        }
      });
    }
    
    // Final fallback to code blocks
    if (Object.keys(zip.files).length === 0 && codeBlocks.length > 0) {
      codeBlocks.forEach((block) => {
        const filename =
          block.filename ||
          `snippet-${block.index}.${getFileExtension(block.language)}`;
        zip.file(filename, block.code);
      });
    }

    // Add README if project has files
    if (Object.keys(zip.files).length > 0 && !zip.files['README.md']) {
      const structureToUse = projectStructureWithScopedFiles || projectStructure;
      const shellCommands = (codeBlocks as any).shellCommands || "";
      const nonCodeText = (codeBlocks as any).nonCodeText || "";
      
      const readme = `# Code Project

This project was generated via AI chat assistant.

## Files:
${structureToUse
  ? Object.keys(structureToUse.files)
      .map((filename) => `- ${filename}`)
      .join("\n")
  : Object.keys(zip.files).filter(f => f !== 'README.md').map(f => `- ${f}`).join("\n")
}

## Dependencies:
${
  structureToUse?.dependencies?.length
    ? structureToUse.dependencies.map((dep) => `- ${dep}`).join("\n")
    : "See individual files for requirements"
}

## Usage:
${
  shellCommands
    ? `### Setup Commands:
\`\`\`bash
${shellCommands}
\`\`\`
`
    : "See individual files for usage instructions"
}

Generated on: ${new Date().toLocaleString()}
`;
      zip.file("README.md", readme);
    }

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Download started!");
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("Failed to download ZIP file");
    }
  };

  // Resize handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      e.preventDefault();
    },
    [panelWidth],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = dragStartX.current - e.clientX;
      const newWidth = Math.max(
        400,
        Math.min(1200, dragStartWidth.current + deltaX),
      );
      setPanelWidth(newWidth);
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
    return undefined;
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Function to detect popular dependencies from code content (only used when package.json is missing)
  const getPopularDependencies = (
    codeContent: string,
    framework: string,
  ): Record<string, string> => {
    const deps: Record<string, string> = {};
    switch (framework) {
      case "react":
      case "next":
      case "vite":
      case "vite-react":
      case "gatsby":
      case "remix":
        deps["react"] = "latest";
        deps["react-dom"] = "latest";
        break;
      case "vue":
      case "nuxt":
        deps["vue"] = "latest";
        break;
      case "svelte":
        deps["svelte"] = "latest";
        break;
      case "solid":
        deps["solid-js"] = "latest";
        break;
      default:
        break;
    }
    return deps;
  };

  const renderLivePreview = () => {
    // Enhanced framework support with better template mapping
    const getSandpackTemplate = (framework: string) => {
      switch (framework) {
        case "react":
        case "vite-react":
          return "react";
        case "next":
          return "nextjs";
        case "vue":
        case "nuxt":
          return "vue";
        case "angular":
          return "angular";
        case "svelte":
          return "svelte";
        case "solid":
          return "solid";
        case "astro":
          return "astro";
        case "remix":
          return "remix";
        case "gatsby":
          return "gatsby";
        case "vite":
          return "react";
        default:
          return "vanilla";
      }
    };

    // Use manual preview files if active, otherwise use auto-detected structure
    const useStructure = isManualPreviewActive && manualPreviewFiles
      ? {
          name: 'Manual Preview',
          files: manualPreviewFiles,
          framework: 'react' as const,
        }
      : (projectStructureWithScopedFiles || projectStructure);
    
    if (
      useStructure &&
      [
        "react",
        "vue",
        "angular",
        "svelte",
        "solid",
        "next",
        "nuxt",
        "astro",
        "remix",
        "gatsby",
        "vite",
      ].includes(useStructure.framework)
    ) {
      try {
        // Map files to Sandpack format
        const sandpackFiles = Object.entries(useStructure.files).reduce(
          (acc, [path, content]) => {
            // Skip empty or invalid files
            if (typeof content !== "string" || !content.trim()) return acc;

            // Transform require() to import for browser compatibility
            let transformedContent = content;
            const hasRequire = /require\(['"][^'"]+['"]\)/.test(content);
            
            if (hasRequire) {
              console.log(`[Sandpack] Transforming require() statements in ${path}`);
              // Convert CommonJS require to ES6 import (basic transformation)
              transformedContent = transformedContent.replace(
                /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g,
                "import $1 from '$2'"
              );
              transformedContent = transformedContent.replace(
                /var\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g,
                "import $1 from '$2'"
              );
              transformedContent = transformedContent.replace(
                /let\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g,
                "import $1 from '$2'"
              );
              // Handle destructured requires
              transformedContent = transformedContent.replace(
                /const\s*\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g,
                "import { $1 } from '$2'"
              );
            }

            // The path should already be correctly formatted by cleanFilename.
            // We just need to ensure it's prefixed with '/' for Sandpack.
            const sandpackPath = path.startsWith("/") ? path : `/${path}`;

            acc[sandpackPath] = { code: transformedContent };
            return acc;
          },
          {} as Record<string, { code: string }>,
        );

        // Framework-specific entry file handling
        const addEntryFileIfMissing = () => {
          const hasEntryFile = Object.keys(sandpackFiles).some(
            (path) =>
              path.includes("index.") ||
              path.includes("main.") ||
              path.includes("App."),
          );

          if (!hasEntryFile) {
            switch (useStructure.framework) {
              case "react":
              case "next":
              case "gatsby":
                sandpackFiles["/src/App.jsx"] = {
                  code: `import React from 'react';

export default function App() {
  return (
    <div className="App">
      <h1>Hello React!</h1>
      <p>This is a generated React application.</p>
    </div>
  );
}`,
                };
                sandpackFiles["/src/index.js"] = {
                  code: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`,
                };
                sandpackFiles["/index.html"] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/src/index.js"></script>
  </body>
</html>`,
                };
                break;
              case "vue":
              case "nuxt":
                sandpackFiles["/src/App.vue"] = {
                  code: `<template>
  <div id="app">
    <h1>Hello Vue!</h1>
    <p>This is a generated Vue application.</p>
  </div>
</template>

<script>
export default {
  name: 'App'
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>`,
                };
                sandpackFiles["/src/main.js"] = {
                  code: `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');`,
                };
                sandpackFiles["/index.html"] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`,
                };
                break;
              case "svelte":
                sandpackFiles["/src/App.svelte"] = {
                  code: `<script>
  let name = 'Svelte';
</script>

<main>
  <h1>Hello {name}!</h1>
  <p>This is a generated Svelte application.</p>
</main>

<style>
  main {
    text-align: center;
    padding: 1em;
    max-width: 240px;
    margin: 0 auto;
  }
</style>`,
                };
                sandpackFiles["/src/main.js"] = {
                  code: `import App from './App.svelte';
const app = new App({ target: document.getElementById('app') });
export default app;`,
                };
                sandpackFiles["/index.html"] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`,
                };
                break;
              default:
                sandpackFiles["/src/index.js"] = {
                  code: `console.log('Hello from ${useStructure.framework}!');`,
                };
                sandpackFiles["/index.html"] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/src/index.js"></script>
  </body>
</html>`,
                };
            }
          }
        };

        addEntryFileIfMissing();

        const template = getSandpackTemplate(useStructure.framework);

        // If manual preview with iframe mode and has HTML file, use iframe
        if (isManualPreviewActive && previewMode === 'iframe') {
          const htmlFile = Object.entries(useStructure.files).find(
            ([path]) => path.endsWith('.html')
          );
          
          if (htmlFile) {
            return (
              <div className="h-full bg-white rounded-lg overflow-hidden">
                <div className="bg-gray-800 px-4 py-2 flex items-center justify-between">
                  <span className="text-white text-sm font-medium">HTML Preview</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('sandpack')}
                    className="text-xs"
                  >
                    Switch to Sandpack
                  </Button>
                </div>
                <iframe
                  srcDoc={htmlFile[1]}
                  className="w-full h-[calc(100%-40px)] border-0"
                  title="Preview"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            );
          }
        }

        // Raw HTML view mode
        if (isManualPreviewActive && previewMode === 'raw') {
          const htmlFile = Object.entries(useStructure.files).find(
            ([path]) => path.endsWith('.html')
          );
          
          if (htmlFile) {
            return (
              <div className="h-full bg-gray-900 rounded-lg overflow-hidden">
                <div className="bg-gray-800 px-4 py-2 flex items-center justify-between">
                  <span className="text-white text-sm font-medium">Raw HTML</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreviewMode('iframe')}
                      className="text-xs"
                    >
                      Iframe
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreviewMode('sandpack')}
                      className="text-xs"
                    >
                      Sandpack
                    </Button>
                  </div>
                </div>
                <pre className="p-4 text-green-400 font-mono text-sm overflow-auto h-[calc(100%-40px)]">
                  {htmlFile[1]}
                </pre>
              </div>
            );
          }
        }

        // Parcel bundler preview mode
        if (isManualPreviewActive && previewMode === 'parcel') {
          // Create a single HTML file with all assets inlined for Parcel
          const htmlFile = Object.entries(useStructure.files).find(
            ([path]) => path.endsWith('.html')
          );
          const jsFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')
          );
          const cssFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.css')
          );
          
          // Build inline HTML with all assets
          let inlineHtml = htmlFile ? htmlFile[1] : `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parcel Preview</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

          // Inline CSS
          for (const [path, code] of cssFiles) {
            inlineHtml = inlineHtml.replace(
              '</head>',
              `<style>\n/* ${path} */\n${code}\n</style>\n</head>`
            );
          }

          // Inline JS
          for (const [path, code] of jsFiles) {
            inlineHtml = inlineHtml.replace(
              '</body>',
              `<script>\n// ${path}\n${code}\n</script>\n</body>`
            );
          }

          return (
            <div className="h-full bg-white rounded-lg overflow-hidden flex flex-col">
              <div className="bg-purple-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">⚡ Parcel Preview</span>
                  <span className="text-purple-300 text-xs">Zero-config bundler</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('sandpack')}
                    className="text-xs bg-purple-800 hover:bg-purple-700 text-white"
                  >
                    Sandpack
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('iframe')}
                    className="text-xs bg-purple-800 hover:bg-purple-700 text-white"
                  >
                    Iframe
                  </Button>
                </div>
              </div>
              <iframe
                srcDoc={inlineHtml}
                className="w-full flex-1 border-0"
                title="Parcel Preview"
                sandbox="allow-scripts allow-same-origin allow-modals"
              />
            </div>
          );
        }

        // CodeSandbox DevBox preview mode (for backend/full-stack apps)
        if (isManualPreviewActive && previewMode === 'devbox') {
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json' || path.endsWith('/package.json')
          );
          const pythonFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.py')
          );
          const nodeFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.js') || path.endsWith('.ts')
          );
          
          // Detect runtime
          let runtime = 'node';
          let startCommand = 'npm start';
          
          if (pythonFiles.length > 0) {
            runtime = 'python';
            const hasFlask = pythonFiles.some(([_, code]) => code.includes('flask'));
            const hasDjango = pythonFiles.some(([_, code]) => code.includes('django'));
            if (hasFlask) startCommand = 'python app.py';
            else if (hasDjango) startCommand = 'python manage.py runserver';
            else startCommand = 'python main.py';
          } else if (packageJson) {
            try {
              const pkg = JSON.parse(packageJson[1]);
              if (pkg.scripts?.start) startCommand = `npm start`;
              else if (pkg.scripts?.dev) startCommand = `npm run dev`;
            } catch (e) {
              startCommand = 'node index.js';
            }
          }

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-blue-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">🔵 DevBox Runtime</span>
                  <span className="text-blue-300 text-xs">Full-stack environment</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsDevBoxRunning(!isDevBoxRunning);
                      if (!isDevBoxRunning) {
                        setDevBoxOutput([
                          `> Starting ${runtime} environment...`,
                          `> Running: ${startCommand}`,
                          `> Environment ready.`,
                        ]);
                      }
                    }}
                    className={`text-xs ${isDevBoxRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} text-white`}
                  >
                    {isDevBoxRunning ? '⏹ Stop' : '▶ Run'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('sandpack')}
                    className="text-xs bg-blue-800 hover:bg-blue-700 text-white"
                  >
                    Sandpack
                  </Button>
                </div>
              </div>
              
              {/* Terminal-like output */}
              <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                <div className="text-gray-400 mb-2">
                  <p>📦 Runtime: {runtime}</p>
                  <p>🚀 Command: {startCommand}</p>
                  <p>📁 Files: {Object.keys(useStructure.files).length}</p>
                </div>
                
                {isDevBoxRunning ? (
                  <div className="space-y-1">
                    {devBoxOutput.map((line, i) => (
                      <p key={i} className="text-green-400">{line}</p>
                    ))}
                    <p className="text-blue-400 animate-pulse">▊</p>
                  </div>
                ) : (
                  <div className="text-yellow-400">
                    <p>⚠️  DevBox is stopped</p>
                    <p className="text-gray-500 mt-2">
                      Click "▶ Run" to start the {runtime} environment.<br/>
                      This will simulate running your backend code.
                    </p>
                  </div>
                )}
                
                {/* File tree */}
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <p className="text-gray-400 mb-2">📁 Project Structure:</p>
                  <div className="text-gray-500 text-xs space-y-1">
                    {Object.keys(useStructure.files).slice(0, 20).map((path) => (
                      <p key={path}>  {path}</p>
                    ))}
                    {Object.keys(useStructure.files).length > 20 && (
                      <p className="text-gray-600">  ... and {Object.keys(useStructure.files).length - 20} more files</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // Pyodide Python in-browser execution (ENHANCED)
        if (isManualPreviewActive && previewMode === 'pyodide') {
          const pythonFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.py')
          );
          const mainFile = pythonFiles.find(([path]) => path === 'main.py' || path === 'app.py') || pythonFiles[0];
          const requirementsFile = Object.entries(useStructure.files).find(
            ([path]) => path === 'requirements.txt'
          );
          
          // Enhanced Pyodide with package installation and caching
          React.useEffect(() => {
            const loadPyodide = async () => {
              setIsPyodideLoading(true);
              setPyodideOutput('');

              try {
                // Multiple CDN sources for reliability
                const CDN_SOURCES = [
                  'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/',
                  'https://unpkg.com/pyodide@0.23.4/',
                ];
                
                let pyodide: any = null;
                let lastError: any = null;

                // Try each CDN until one works
                for (const cdn of CDN_SOURCES) {
                  try {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js';
                    script.async = true;
                    
                    await new Promise((resolve, reject) => {
                      script.onload = resolve;
                      script.onerror = reject;
                      document.head.appendChild(script);
                    });

                    if ((window as any).loadPyodide) {
                      pyodide = await (window as any).loadPyodide({
                        indexURL: cdn,
                        // Enable IndexedDB caching
                        packageCacheDir: '/lib/python3.11/site-packages',
                      });
                      break; // Success!
                    }
                  } catch (err: any) {
                    lastError = err;
                    console.warn(`CDN ${cdn} failed, trying next...`);
                    continue;
                  }
                }

                if (!pyodide) {
                  throw new Error(`All CDNs failed: ${lastError?.message}`);
                }

                pyodideRef.current = pyodide;

                // Enhanced stdout capture
                pyodide.setStdout({
                  batched: (msg: string) => {
                    setPyodideOutput(prev => prev + msg);
                  },
                  write: (msg: string) => {
                    setPyodideOutput(prev => prev + msg);
                  },
                  isatty: () => false,
                });

                // Preload common packages if configured
                const preloadPackages = process.env.NEXT_PUBLIC_PYODIDE_PRELOAD_PACKAGES?.split(',') || [];
                
                if (preloadPackages.length > 0) {
                  setPyodideOutput(prev => prev + `# Preloading ${preloadPackages.length} package(s)...\n`);
                  try {
                    await pyodide.loadPackage(preloadPackages);
                    setPyodideOutput(prev => prev + `✓ Preloaded: ${preloadPackages.join(', ')}\n`);
                  } catch (err: any) {
                    setPyodideOutput(prev => prev + `⚠ Preload warning: ${err.message}\n`);
                  }
                }

                // Install requirements if present
                if (requirementsFile) {
                  setPyodideOutput(prev => prev + '# Installing requirements...\n');
                  try {
                    await pyodide.runPythonAsync(`
                      import micropip
                      requirements = """${requirementsFile[1]}"""
                      for pkg in requirements.strip().split('\\n'):
                          pkg = pkg.strip()
                          if pkg and not pkg.startswith('#'):
                              try:
                                  await micropip.install(pkg)
                                  print(f'✓ Installed {pkg}')
                              except Exception as e:
                                  print(f'⚠ Could not install {pkg}: {e}')
                    `);
                  } catch (err: any) {
                    setPyodideOutput(prev => prev + `⚠ Package installation warning: ${err.message}\n`);
                  }
                }

                // Execute main Python file
                if (mainFile) {
                  setPyodideOutput(prev => prev + `\n# Running ${mainFile[0]}...\n# ─────────────────────────────\n`);
                  try {
                    await pyodide.runPythonAsync(mainFile[1]);
                    setPyodideOutput(prev => prev + '\n✅ Execution complete!\n');
                  } catch (err: any) {
                    setPyodideOutput(prev => prev + `\n❌ Error: ${err.message}\n`);
                  }
                }

                setIsPyodideLoading(false);
              } catch (err: any) {
                console.error('Failed to load Pyodide:', err);
                setPyodideOutput(prev => prev + `❌ Failed to load Pyodide: ${err.message}\n`);
                setIsPyodideLoading(false);
              }
            };

            loadPyodide();

            return () => {
              // Cleanup
              if (pyodideRef.current) {
                pyodideRef.current = null;
              }
            };
          }, [mainFile, requirementsFile]);

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-yellow-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">🐍 Pyodide Python</span>
                  <span className="text-yellow-300 text-xs">In-browser execution</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPyodideOutput('');
                      if (pyodideRef.current && mainFile) {
                        pyodideRef.current.runPythonAsync(mainFile[1]).catch((err: any) => {
                          setPyodideOutput(prev => prev + `\nError: ${err.message}\n`);
                        });
                      }
                    }}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white"
                  >
                    ▶ Re-run
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('devbox')}
                    className="text-xs bg-yellow-800 hover:bg-yellow-700 text-white"
                  >
                    DevBox
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                {/* File list */}
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">📁 Python Files:</p>
                      <p className="text-blue-400">{pythonFiles.length} files</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📦 Requirements:</p>
                      <p className={requirementsFile ? 'text-green-400' : 'text-gray-500'}>
                        {requirementsFile ? '✓ Found' : 'Not found'}
                      </p>
                    </div>
                  </div>
                  {requirementsFile && (
                    <div className="mt-2 p-2 bg-black/30 rounded text-xs font-mono text-gray-400 max-h-20 overflow-auto">
                      {requirementsFile[1].split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 5).join('\n')}
                      {requirementsFile[1].split('\n').filter(l => l.trim() && !l.startsWith('#')).length > 5 && '\n...'}
                    </div>
                  )}
                </div>

                {/* Output terminal */}
                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isPyodideLoading ? (
                    <div className="flex items-center gap-2 text-yellow-400">
                      <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                      <span>Loading Pyodide (this may take a moment)...</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-gray-500"># Pyodide Python Runtime</p>
                      <p className="text-gray-500"># Executing: {mainFile?.[0] || 'unknown'}</p>
                      <p className="text-gray-500"># ─────────────────────────────</p>
                      {pyodideOutput ? (
                        <pre className="text-green-400 whitespace-pre-wrap">{pyodideOutput}</pre>
                      ) : (
                        <p className="text-gray-600">No output yet...</p>
                      )}
                      <p className="text-blue-400 animate-pulse">▊</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Vite build preview mode
        if (isManualPreviewActive && previewMode === 'vite') {
          const viteConfig = Object.entries(useStructure.files).find(
            ([path]) => path.includes('vite.config')
          );
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json'
          );
          const indexHtml = Object.entries(useStructure.files).find(
            ([path]) => path === 'index.html' || path.endsWith('/index.html')
          );
          const srcFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.startsWith('src/')
          );
          
          // Simulate Vite build (no hooks inside render)
          const runViteBuild = async () => {
            setIsViteBuilding(true);
            setViteOutput('');
            
            const logs = [
              '> vite build',
              `vite v5.0.0 building for production...`,
              `✓ ${srcFiles.length} modules transformed.`,
            ];
            
            // Simulate build output
            for (const log of logs) {
              await new Promise(resolve => setTimeout(resolve, 300));
              setViteOutput(prev => prev + log + '\n');
            }
            
            // Show built files
            const distFiles = srcFiles.map(([path]) => path.replace('src/', 'dist/assets/'));
            await new Promise(resolve => setTimeout(resolve, 500));
            setViteOutput(prev => prev + `\n✓ built in ${Math.random() * 500 + 200 | 0}ms\n`);
            setViteOutput(prev => prev + `\n📁 dist/\n` + distFiles.slice(0, 5).map(f => `  ${f}`).join('\n') + '\n');
            
            setIsViteBuilding(false);
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-cyan-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">⚡ Vite Build</span>
                  <span className="text-cyan-300 text-xs">Next-gen frontend tooling</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void runViteBuild();
                    }}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white"
                    disabled={isViteBuilding}
                  >
                    {isViteBuilding ? '⏳ Building...' : '🔁 Rebuild'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('sandpack')}
                    className="text-xs bg-cyan-800 hover:bg-cyan-700 text-white"
                  >
                    Sandpack
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col">
                {/* Config info */}
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">⚙️ Vite Config:</p>
                      <p className="text-cyan-400">{viteConfig ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📄 index.html:</p>
                      <p className="text-cyan-400">{indexHtml ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📦 package.json:</p>
                      <p className="text-cyan-400">{packageJson ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📁 src/ files:</p>
                      <p className="text-cyan-400">{srcFiles.length} files</p>
                    </div>
                  </div>
                </div>
                
                {/* Build output */}
                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isViteBuilding ? (
                    <div className="flex items-center gap-2 text-cyan-400">
                      <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      <span>Building with Vite...</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <pre className="text-green-400 whitespace-pre-wrap">{viteOutput || 'Build complete!'}</pre>
                      <p className="text-blue-400 animate-pulse">▊</p>
                    </div>
                  )}
                </div>
                
                {/* File tree */}
                <div className="p-2 bg-gray-900 border-t border-gray-800">
                  <p className="text-gray-400 text-xs mb-1">📁 Project Structure:</p>
                  <div className="text-gray-500 text-xs space-y-1 max-h-32 overflow-auto">
                    {Object.keys(useStructure.files).slice(0, 15).map((path) => (
                      <p key={path}>  {path}</p>
                    ))}
                    {Object.keys(useStructure.files).length > 15 && (
                      <p className="text-gray-600">  ... and {Object.keys(useStructure.files).length - 15} more files</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // Webpack build preview mode
        if (isManualPreviewActive && previewMode === 'webpack') {
          const webpackConfig = Object.entries(useStructure.files).find(
            ([path]) => path.includes('webpack.config')
          );
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json'
          );
          const srcFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.startsWith('src/')
          );

          const runWebpackBuild = async () => {
            setIsWebpackBuilding(true);
            setWebpackOutput('');

            const logs = [
              '> webpack --mode production',
              'asset main.js 96.2 KiB [emitted] [minimized] (name: main)',
              `modules by path ./src/ ${srcFiles.length}`,
            ];

            for (const log of logs) {
              await new Promise(resolve => setTimeout(resolve, 300));
              setWebpackOutput(prev => prev + log + '\n');
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            setWebpackOutput(prev => prev + `\nwebpack 5.0.0 compiled successfully in ${Math.random() * 600 + 250 | 0}ms\n`);
            setIsWebpackBuilding(false);
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-indigo-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">📦 Webpack Build</span>
                  <span className="text-indigo-300 text-xs">Module bundling pipeline</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void runWebpackBuild();
                    }}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white"
                    disabled={isWebpackBuilding}
                  >
                    {isWebpackBuilding ? '⏳ Building...' : '🔁 Rebuild'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('sandpack')}
                    className="text-xs bg-indigo-800 hover:bg-indigo-700 text-white"
                  >
                    Sandpack
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">⚙️ webpack.config:</p>
                      <p className="text-indigo-300">{webpackConfig ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📦 package.json:</p>
                      <p className="text-indigo-300">{packageJson ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📁 src/ files:</p>
                      <p className="text-indigo-300">{srcFiles.length} files</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isWebpackBuilding ? (
                    <div className="flex items-center gap-2 text-indigo-300">
                      <div className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                      <span>Building with Webpack...</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <pre className="text-green-400 whitespace-pre-wrap">{webpackOutput || 'Build complete!'}</pre>
                      <p className="text-blue-400 animate-pulse">▊</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // WebContainer preview mode - Node.js in browser
        if (isManualPreviewActive && previewMode === 'webcontainer') {
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json'
          );
          const serverFiles = Object.entries(useStructure.files).filter(
            ([path]) => ['server.js', 'app.js', 'index.js', 'main.js'].includes(path)
          );
          const hasStartScript = packageJson && useStructure.files[packageJson[0]]?.includes('"start"');

          const bootWebContainer = async () => {
            setIsWebcontainerBooting(true);
            setWebcontainerUrl(null);

            try {
              log('[WebContainer] Creating sandbox via provider...');

              // Use the sandbox bridge to create WebContainer sandbox
              const response = await fetch('/api/sandbox/webcontainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  files: useStructure.files,
                }),
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to create WebContainer sandbox (${response.status})`);
              }

              const data = await response.json();
              const { sandboxId, url } = data;

              log(`[WebContainer] Sandbox ready: ${sandboxId}`);
              setWebcontainerUrl(url);
              setIsWebcontainerBooting(false);
            } catch (err: any) {
              logError('[WebContainer] Boot error:', err);
              
              // If error mentions "Unauthorized" or "not found", suggest clearing sessions
              if (err.message.includes('Unauthorized') || err.message.includes('not found')) {
                log('[WebContainer] Session may be stale, suggesting cleanup');
                toast.error('WebContainer failed - session may be stale', {
                  description: 'Try clicking "Clear Sessions" and retry',
                  duration: 5000,
                });
              } else {
                toast.error('WebContainer boot failed', {
                  description: err.message,
                  duration: 5000,
                });
              }
              
              setWebcontainerUrl(`Error: ${err.message}`);
              setIsWebcontainerBooting(false);
            }
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-green-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">📀 WebContainer</span>
                  <span className="text-green-300 text-xs">Node.js in browser</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void bootWebContainer();
                    }}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white"
                    disabled={isWebcontainerBooting}
                  >
                    {isWebcontainerBooting ? '⏳ Booting...' : '🔁 Boot'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('codesandbox')}
                    className="text-xs bg-green-800 hover:bg-green-700 text-white"
                  >
                    CodeSandbox
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">📦 package.json:</p>
                      <p className="text-green-300">{packageJson ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">🚀 Start script:</p>
                      <p className="text-green-300">{hasStartScript ? '✓ Available' : '⚠ Using node'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📁 Server files:</p>
                      <p className="text-green-300">{serverFiles.length} files</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isWebcontainerBooting ? (
                    <div className="flex items-center gap-2 text-green-300">
                      <div className="w-4 h-4 border-2 border-green-300 border-t-transparent rounded-full animate-spin" />
                      <span>Booting WebContainer...</span>
                    </div>
                  ) : webcontainerUrl ? (
                    webcontainerUrl.startsWith('http') ? (
                      <div className="h-full flex flex-col">
                        <div className="mb-2 text-green-400">
                          ✓ Server running: <a href={webcontainerUrl} target="_blank" rel="noopener noreferrer" className="underline">{webcontainerUrl}</a>
                        </div>
                        <iframe 
                          src={webcontainerUrl} 
                          className="flex-1 w-full bg-white rounded"
                          sandbox="allow-scripts allow-same-origin allow-forms"
                        />
                      </div>
                    ) : (
                      <div className="text-yellow-400">{webcontainerUrl}</div>
                    )
                  ) : (
                    <div className="space-y-2 text-gray-400">
                      <p>Click "Boot" to start the Node.js server in your browser.</p>
                      <p className="text-xs text-gray-500">WebContainer runs Node.js natively in the browser - no cloud needed!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Next.js preview mode - Optimized for Next.js apps
        if (isManualPreviewActive && previewMode === 'nextjs') {
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json'
          );
          const nextConfig = Object.entries(useStructure.files).find(
            ([path]) => path.startsWith('next.config')
          );
          const appDir = Object.entries(useStructure.files).some(
            ([path]) => path.startsWith('app/') || path.startsWith('pages/')
          );
          const hasNextDev = packageJson && useStructure.files[packageJson[0]]?.includes('"dev"');

          const startNextJS = async () => {
            setIsNextjsBuilding(true);
            setNextjsUrl(null);
            
            try {
              log('[Next.js] Starting Next.js dev server...');
              
              // Use WebContainer to run Next.js
              const response = await fetch('/api/sandbox/webcontainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  files: useStructure.files,
                  startCommand: 'npm run dev',
                  waitForPort: 3000,
                }),
              });
              
              if (!response.ok) {
                throw new Error('Failed to start Next.js server');
              }
              
              const data = await response.json();
              // Next.js runs on port 3000 by default
              const devUrl = data.url || 'http://localhost:3000';
              
              setNextjsUrl(devUrl);
              log(`[Next.js] Dev server ready: ${devUrl}`);
              setIsNextjsBuilding(false);
            } catch (err: any) {
              logError('[Next.js] Start error:', err);
              setNextjsUrl(`Error: ${err.message}`);
              setIsNextjsBuilding(false);
            }
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-black px-4 py-2 flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">▲ Next.js</span>
                  <span className="text-gray-400 text-xs">React Framework</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void startNextJS();
                    }}
                    className="text-xs bg-white hover:bg-gray-200 text-black"
                    disabled={isNextjsBuilding}
                  >
                    {isNextjsBuilding ? '⏳ Building...' : '🚀 Dev'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('webcontainer')}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-white"
                  >
                    WebContainer
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">📦 package.json:</p>
                      <p className="text-white">{packageJson ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">⚙️ next.config:</p>
                      <p className="text-white">{nextConfig ? '✓ Found' : '⚠ Default'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📁 App dir:</p>
                      <p className="text-white">{appDir ? '✓ App Router' : '⚠ Pages'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isNextjsBuilding ? (
                    <div className="flex items-center gap-2 text-white">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <div className="space-y-1">
                        <p>Starting Next.js development server...</p>
                        <p className="text-xs text-gray-400">First build may take 30-60 seconds</p>
                      </div>
                    </div>
                  ) : nextjsUrl ? (
                    nextjsUrl.startsWith('http') ? (
                      <div className="h-full flex flex-col">
                        <div className="mb-2 text-green-400 flex items-center justify-between">
                          <span>✓ Ready: <a href={nextjsUrl} target="_blank" rel="noopener noreferrer" className="underline">{nextjsUrl}</a></span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(nextjsUrl, '_blank')}
                            className="text-xs bg-white hover:bg-gray-200 text-black"
                          >
                            Open in New Tab ↗
                          </Button>
                        </div>
                        <iframe 
                          src={nextjsUrl} 
                          className="flex-1 w-full bg-white rounded"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        />
                      </div>
                    ) : (
                      <div className="text-yellow-400">{nextjsUrl}</div>
                    )
                  ) : (
                    <div className="space-y-2 text-gray-400">
                      <p>Click "Dev" to start the Next.js development server.</p>
                      <ul className="text-xs text-gray-500 space-y-1 mt-2">
                        <li>• Hot reload enabled</li>
                        <li>• Server-side rendering (SSR)</li>
                        <li>• API routes support</li>
                        <li>• Image optimization</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // CodeSandbox DevBox - Cloud development environment (fallback for complex apps)
        if (isManualPreviewActive && previewMode === 'codesandbox') {
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json'
          );
          const hasDocker = Object.entries(useStructure.files).some(
            ([path]) => path === 'Dockerfile' || path === 'docker-compose.yml'
          );
          const serverFiles = Object.entries(useStructure.files).filter(
            ([path]) => ['server.js', 'app.js', 'index.js', 'main.py', 'app.py'].includes(path)
          );

          const bootCodeSandbox = async () => {
            setIsCodesandboxLoading(true);
            setCodesandboxUrl(null);

            try {
              log('[CodeSandbox] Creating cloud dev environment...');

              // Call API to create CodeSandbox devbox
              const response = await fetch('/api/sandbox/devbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  files: useStructure.files,
                  template: hasDocker ? 'docker' : 'node',
                }),
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.error || `Failed to create CodeSandbox environment (${response.status})`;
                
                // If error mentions "Unauthorized", suggest clearing sessions
                if (errorMsg.includes('Unauthorized') || errorMsg.includes('not found')) {
                  log('[CodeSandbox] Session may be stale, suggesting cleanup');
                  throw new Error(`SESSION_STALE: ${errorMsg}`);
                }
                throw new Error(errorMsg);
              }

              const data = await response.json();
              const sandboxUrl = data.url || `https://${data.sandboxId}.csb.app`;

              setCodesandboxUrl(sandboxUrl);
              log(`[CodeSandbox] DevBox ready: ${sandboxUrl}`);
              setIsCodesandboxLoading(false);
            } catch (err: any) {
              logError('[CodeSandbox] Boot error:', err);
              
              // Handle stale session errors
              if (err.message.includes('SESSION_STALE')) {
                toast.error('CodeSandbox failed - session may be stale', {
                  description: 'Click the "🗑️ Clear Sessions" button and retry',
                  duration: 6000,
                });
              } else {
                toast.error('CodeSandbox boot failed', {
                  description: err.message,
                  duration: 5000,
                });
              }
              
              setCodesandboxUrl(`Error: ${err.message}`);
              setIsCodesandboxLoading(false);
            }
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-blue-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">🏖️ CodeSandbox</span>
                  <span className="text-blue-300 text-xs">Cloud Dev Environment</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void bootCodeSandbox();
                    }}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={isCodesandboxLoading}
                  >
                    {isCodesandboxLoading ? '⏳ Creating...' : '🚀 Launch'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('webcontainer')}
                    className="text-xs bg-blue-800 hover:bg-blue-700 text-white"
                  >
                    WebContainer
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">📦 package.json:</p>
                      <p className="text-blue-300">{packageJson ? '✓ Found' : '⚠ Not found'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">🐳 Docker:</p>
                      <p className="text-blue-300">{hasDocker ? '✓ Detected' : 'Standard'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">📁 Server files:</p>
                      <p className="text-blue-300">{serverFiles.length} files</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isCodesandboxLoading ? (
                    <div className="flex items-center gap-2 text-blue-300">
                      <div className="w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                      <div className="space-y-1">
                        <p>Creating cloud development environment...</p>
                        <p className="text-xs text-blue-400">This may take 30-60 seconds for complex projects</p>
                      </div>
                    </div>
                  ) : codesandboxUrl ? (
                    codesandboxUrl.startsWith('http') ? (
                      <div className="h-full flex flex-col">
                        <div className="mb-2 text-blue-400 flex items-center justify-between">
                          <span>✓ DevBox ready: <a href={codesandboxUrl} target="_blank" rel="noopener noreferrer" className="underline">{codesandboxUrl}</a></span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(codesandboxUrl, '_blank')}
                            className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            Open in New Tab ↗
                          </Button>
                        </div>
                        <iframe 
                          src={codesandboxUrl} 
                          className="flex-1 w-full bg-white rounded"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        />
                      </div>
                    ) : (
                      <div className="text-yellow-400">{codesandboxUrl}</div>
                    )
                  ) : (
                    <div className="space-y-2 text-gray-400">
                      <p>Click "Launch" to create a cloud development environment.</p>
                      <ul className="text-xs text-gray-500 space-y-1 mt-2">
                        <li>• Full VS Code editor in the cloud</li>
                        <li>• Terminal access with apt/npm/pip</li>
                        <li>• Preview URLs for web servers</li>
                        <li>• Perfect for Docker, databases, complex backends</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Local/Cloud execution mode indicator and runner
        if (isManualPreviewActive && (previewMode === 'local' || previewMode === 'cloud')) {
          const jsFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.jsx') || path.endsWith('.tsx')
          );
          const pythonFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.py')
          );
          const hasCloudRequirement = Object.values(useStructure.files).some((c: any) => 
            typeof c === 'string' && (c.includes('tensorflow') || c.includes('pytorch') || c.includes('OPENAI_API_KEY'))
          );
          
          const runCode = async () => {
            setIsLocalExecuting(true);
            setLocalExecutionOutput('> Starting execution...\n');
            
            try {
              if (executionMode === 'local' || (executionMode === 'hybrid' && !hasCloudRequirement)) {
                // Local execution
                setLocalExecutionOutput(prev => prev + '\n💻 Running locally in browser...\n');
                
                // Execute JavaScript/TypeScript with caching
                if (jsFiles.length > 0) {
                  for (const [path, code] of jsFiles) {
                    try {
                      setLocalExecutionOutput(prev => prev + `\n📄 Running ${path}...\n`);
                      
                      // Check cache first
                      const cachedResult = getCachedResult(code, path);
                      if (cachedResult) {
                        setLocalExecutionOutput(prev => prev + `⚡ Cache hit! (${cachedResult})\n`);
                        continue;
                      }
                      
                      // Simple eval for demo (in production, use proper sandbox)
                      const startTime = Date.now();
                      const result = eval(code);
                      const execTime = Date.now() - startTime;
                      
                      if (result !== undefined) {
                        const resultStr = JSON.stringify(result, null, 2);
                        setLocalExecutionOutput(prev => prev + `→ ${resultStr}\n`);
                        // Cache the result
                        cacheResult(code, path, resultStr);
                      }
                      
                      setLocalExecutionOutput(prev => prev + `⏱️ Executed in ${execTime}ms\n`);
                    } catch (err: any) {
                      setLocalExecutionOutput(prev => prev + `❌ Error in ${path}: ${err.message}\n`);
                    }
                  }
                }
                
                // Python via Pyodide if available with caching
                if (pythonFiles.length > 0 && pyodideRef.current) {
                  setLocalExecutionOutput(prev => prev + '\n🐍 Running Python via Pyodide...\n');
                  for (const [path, code] of pythonFiles) {
                    try {
                      setLocalExecutionOutput(prev => prev + `\n📄 Running ${path}...\n`);
                      
                      // Check cache first
                      const cachedResult = getCachedResult(code, path);
                      if (cachedResult) {
                        setLocalExecutionOutput(prev => prev + `⚡ Cache hit! (${cachedResult})\n`);
                        continue;
                      }
                      
                      const startTime = Date.now();
                      const result = await pyodideRef.current.runPythonAsync(code);
                      const execTime = Date.now() - startTime;
                      
                      if (result) {
                        const resultStr = String(result);
                        setLocalExecutionOutput(prev => prev + `→ ${resultStr}\n`);
                        // Cache the result
                        cacheResult(code, path, resultStr);
                      }
                      
                      setLocalExecutionOutput(prev => prev + `⏱️ Executed in ${execTime}ms\n`);
                    } catch (err: any) {
                      setLocalExecutionOutput(prev => prev + `❌ Error in ${path}: ${err.message}\n`);
                    }
                  }
                }
                
                setLocalExecutionOutput(prev => prev + '\n✅ Local execution complete!\n');
                setLocalExecutionOutput(prev => prev + `\n📊 Cache Stats: ${cacheHits} hits, ${cacheMisses} misses\n`);
              }
              
              if (executionMode === 'cloud' || (executionMode === 'hybrid' && hasCloudRequirement)) {
                // Cloud execution
                setLocalExecutionOutput(prev => prev + '\n☁️  Cloud execution required...\n');
                setLocalExecutionOutput(prev => prev + '⚠️  This code requires cloud resources:\n');
                
                if (hasCloudRequirement) {
                  setLocalExecutionOutput(prev => prev + '  - Heavy computation (GPU/TPU)\n');
                  setLocalExecutionOutput(prev => prev + '  - External API access\n');
                }
                
                setLocalExecutionOutput(prev => prev + '\n💡 To run this code:\n');
                setLocalExecutionOutput(prev => prev + '  1. Connect to sandbox: connect\n');
                setLocalExecutionOutput(prev => prev + '  2. Or use preview:devbox for full runtime\n');
              }
              
            } catch (err: any) {
              setLocalExecutionOutput(prev => prev + `\n❌ Execution failed: ${err.message}\n`);
            } finally {
              setIsLocalExecuting(false);
            }
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className={`px-4 py-2 flex items-center justify-between ${
                executionMode === 'cloud' ? 'bg-purple-900' :
                executionMode === 'hybrid' ? 'bg-orange-900' :
                'bg-green-900'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">
                    {executionMode === 'local' && '💻 Local Execution'}
                    {executionMode === 'cloud' && '☁️  Cloud Execution Required'}
                    {executionMode === 'hybrid' && '🔄 Hybrid Execution'}
                  </span>
                  <span className={`text-xs ${
                    executionMode === 'cloud' ? 'text-purple-300' :
                    executionMode === 'hybrid' ? 'text-orange-300' :
                    'text-green-300'
                  }`}>
                    {executionMode === 'local' && 'Fast, offline-capable'}
                    {executionMode === 'cloud' && 'Needs server/API access'}
                    {executionMode === 'hybrid' && 'Local + cloud fallback'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearExecutionCache}
                    className="text-xs bg-gray-600 hover:bg-gray-700 text-white"
                    title="Clear execution cache"
                  >
                    🗑️ Clear Cache
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCacheEnabled(!cacheEnabled)}
                    className={`text-xs ${cacheEnabled ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 hover:bg-gray-700'} text-white`}
                    title={cacheEnabled ? 'Cache enabled' : 'Cache disabled'}
                  >
                    {cacheEnabled ? '💾 Cache ON' : '⚡ Cache OFF'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runCode}
                    disabled={isLocalExecuting}
                    className={`text-xs ${
                      isLocalExecuting ? 'bg-gray-600' :
                      executionMode === 'cloud' ? 'bg-purple-600 hover:bg-purple-700' :
                      'bg-green-600 hover:bg-green-700'
                    } text-white`}
                  >
                    {isLocalExecuting ? '⏳ Running...' : '▶ Run Code'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewMode('devbox')}
                    className="text-xs bg-blue-800 hover:bg-blue-700 text-white"
                  >
                    DevBox
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col">
                {/* File info */}
                <div className="p-2 bg-gray-900 border-b border-gray-800">
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">📄 JavaScript/TS:</p>
                      <p className="text-green-400">{jsFiles.length} files</p>
                    </div>
                    <div>
                      <p className="text-gray-400">🐍 Python:</p>
                      <p className="text-green-400">{pythonFiles.length} files</p>
                    </div>
                    <div>
                      <p className="text-gray-400">☁️  Cloud Required:</p>
                      <p className={hasCloudRequirement ? 'text-purple-400' : 'text-green-400'}>
                        {hasCloudRequirement ? 'Yes' : 'No'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">💾 Cache:</p>
                      <p className="text-blue-400">
                        {cacheEnabled ? `✓ ${cacheHits} hits / ${cacheMisses} misses` : '✗ Disabled'}
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Execution output */}
                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isLocalExecuting ? (
                    <div className="flex items-center gap-2 text-green-400">
                      <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                      <span>Executing code...</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-gray-500"># Execution Environment</p>
                      <p className="text-gray-500"># Mode: {executionMode}</p>
                      <p className="text-gray-500"># ─────────────────────────────</p>
                      {localExecutionOutput ? (
                        <pre className="text-green-400 whitespace-pre-wrap">{localExecutionOutput}</pre>
                      ) : (
                        <p className="text-gray-600">Click "▶ Run Code" to execute</p>
                      )}
                      <p className="text-blue-400 animate-pulse">▊</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        return (
          <Suspense fallback={
            <div className="h-96 flex items-center justify-center bg-gray-900 rounded-lg">
              <div className="text-center text-gray-400">
                <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                <p>Loading preview...</p>
              </div>
            </div>
          }>
            <div className="h-96">
              <Sandpack
                template={template as any}
                theme="dark"
                options={{
                  showTabs: true,
                  showLineNumbers: true,
                  showNavigator: true,
                  showConsole: true,
                  showRefreshButton: true,
                  autorun: true,
                  recompileMode: "delayed",
                  recompileDelay: 300,
                }}
                files={sandpackFiles}
                customSetup={{
                  dependencies:
                    useStructure.dependencies?.reduce(
                      (acc, dep) => {
                        acc[dep] = "latest";
                        return acc;
                      },
                      {} as Record<string, string>,
                    ) ||
                    getPopularDependencies(
                      Object.values(useStructure.files).join("\n"),
                      useStructure.framework,
                    ),
                  devDependencies:
                    useStructure.devDependencies?.reduce(
                      (acc, dep) => {
                        acc[dep] = "latest";
                        return acc;
                      },
                      {} as Record<string, string>,
                    ) || {},
                }}
              />
            </div>
          </Suspense>
        );
      } catch (error) {
        return (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <div className="text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
              <p className="text-red-400">Failed to render framework preview</p>
              <p className="text-sm text-gray-600 mt-2">
                Framework: {useStructure.framework}
              </p>
              <p className="text-sm text-gray-600">
                Error: {(error as Error).message}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        );
      }
    }

    // Enhanced vanilla HTML/CSS/JS preview with JSBin-style features
    try {
      const normalizedFiles = useStructure
        ? Object.entries(useStructure.files).map(([path, content]) => ({
            path,
            lowerPath: path.toLowerCase(),
            content,
          }))
        : [];

      const htmlFromStructure =
        normalizedFiles.find((file) => file.lowerPath.endsWith(".html"))?.content || null;
      const cssFromStructure =
        normalizedFiles.find((file) => file.lowerPath.endsWith(".css"))?.content || null;
      const jsFromStructure =
        normalizedFiles.find(
          (file) =>
            file.lowerPath.endsWith(".js") ||
            file.lowerPath.endsWith(".mjs") ||
            file.lowerPath.endsWith(".cjs"),
        )?.content || null;
      const tsFromStructure =
        normalizedFiles.find((file) => file.lowerPath.endsWith(".ts"))?.content || null;

      const htmlFile = htmlFromStructure
        ? { code: htmlFromStructure, language: "html" }
        : codeBlocks.find((block) => block.language === "html");
      const cssFile = cssFromStructure
        ? { code: cssFromStructure, language: "css" }
        : codeBlocks.find((block) => block.language === "css");
      const jsFile = jsFromStructure
        ? { code: jsFromStructure, language: "javascript" }
        : codeBlocks.find(
            (block) => block.language === "javascript" || block.language === "js",
          );
      const tsFile = tsFromStructure
        ? { code: tsFromStructure, language: "typescript" }
        : codeBlocks.find(
            (block) => block.language === "typescript" || block.language === "ts",
          );

      // If no HTML but has other web files, create a basic HTML structure
      if (!htmlFile && (cssFile || jsFile || tsFile)) {
        const autoGeneratedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Preview</title>
  ${cssFile ? `<style>${cssFile.code}</style>` : ""}
</head>
<body>
  <div id="app">
    <h1>Auto-generated Preview</h1>
    <p>This preview was automatically generated from your code.</p>
    <div id="content"></div>
  </div>
  ${jsFile ? `<script>${jsFile.code}</script>` : ""}
  ${
    tsFile
      ? `<script type="module">
    // TypeScript code (simplified for preview)
    ${tsFile.code.replace(/import .* from .*/g, "// Import removed for preview")}
  </script>`
      : ""
  }
</body>
</html>`;

        return (
          <div className="relative">
            <div className="absolute top-2 right-2 z-10 flex gap-2">
              <div className="bg-yellow-600 text-white px-2 py-1 rounded text-xs">
                Auto-generated
              </div>
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="bg-gray-800 text-gray-300 p-1 rounded border border-gray-600"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
            <iframe
              ref={iframeRef}
              srcDoc={autoGeneratedHtml}
              className={`w-full bg-white rounded-lg border ${isFullscreen ? "h-screen" : "h-96"}`}
              title="Auto-generated Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        );
      }

      if (!htmlFile) {
        return (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <div className="text-center">
              <CodeIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-400">
                No HTML code found for live preview
              </p>
              <p className="text-sm text-gray-600 mt-2">
                Generate code to enable live preview
              </p>
              {(codeBlocks.length > 0 || normalizedFiles.length > 0) && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500 mb-2">
                    Available source files:
                  </p>
                  <div className="flex flex-wrap gap-1 justify-center">
                    {((normalizedFiles.length > 0
                      ? normalizedFiles.map((file, index) => ({
                          language: file.path.split(".").pop() || "file",
                          filename: file.path,
                          index,
                        }))
                      : codeBlocks) as Array<{ language: string; filename: string; index?: number }>
                    ).map((block, index) => (
                      <span
                        key={`${index}-${block.language}`}
                        className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs"
                      >
                        {block.filename || block.language}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      // Enhanced HTML document with better error handling and console capture
      const combinedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Preview</title>
  <style>
    /* Reset and base styles */
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

    /* Custom styles */
    ${cssFile ? cssFile.code : ""}

    /* Error display styles */
    .preview-error {
      background: #fee;
      border: 1px solid #fcc;
      color: #c33;
      padding: 10px;
      margin: 10px 0;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  ${htmlFile.code}

  <script>
    // Error handling and console capture
    window.addEventListener('error', function(e) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'preview-error';
      errorDiv.innerHTML = '<strong>JavaScript Error:</strong><br>' + e.message + '<br>Line: ' + e.lineno;
      document.body.appendChild(errorDiv);
    });

    // Console capture for debugging
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = function(...args) {
      originalLog.apply(console, args);
      // Could add visual console output here if needed
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'preview-error';
      errorDiv.innerHTML = '<strong>Console Error:</strong><br>' + args.join(' ');
      document.body.appendChild(errorDiv);
    };

    // User JavaScript
    try {
      ${jsFile ? jsFile.code : ""}
    } catch (error) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'preview-error';
      errorDiv.innerHTML = '<strong>Script Error:</strong><br>' + error.message;
      document.body.appendChild(errorDiv);
    }
  </script>
</body>
</html>`;

      return (
        <div className="relative">
          <div className="absolute top-2 right-2 z-10 flex gap-2">
            <button
              onClick={() => {
                if (iframeRef.current) {
                  iframeRef.current.src = iframeRef.current.src; // Refresh iframe
                }
              }}
              className="bg-gray-800 text-gray-300 p-1 rounded border border-gray-600"
              title="Refresh Preview"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="bg-gray-800 text-gray-300 p-1 rounded border border-gray-600"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
          <iframe
            ref={iframeRef}
            srcDoc={combinedHtml}
            className={`w-full bg-white rounded-lg border ${isFullscreen ? "h-screen" : "h-96"}`}
            title="Live Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={(e) => console.error("Iframe error", e)}
          />
        </div>
      );
    } catch (error) {
      return (
        <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
            <p className="text-red-400">Failed to render HTML preview</p>
            <p className="text-sm text-gray-600 mt-2">
              Error: {(error as Error).message}
            </p>
          </div>
        </div>
      );
    }
  };

  useEffect(() => {
    if (isOpen && messages.length > 0) {
      // Extract project structure from messages
      const projectMessages = messages
        .filter((msg) => msg.role === "assistant")
        .filter((msg) => {
          const content = typeof msg.content === "string" ? msg.content : "";
          return content.includes("```json") && content.includes('"files"');
        });

      if (projectMessages.length > 0) {
        const lastProjectMessage = projectMessages[projectMessages.length - 1];
        const content =
          typeof lastProjectMessage.content === "string"
            ? lastProjectMessage.content
            : "";
        const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);

        if (jsonMatch) {
          try {
            const projectData = JSON.parse(jsonMatch[1]);
            setProjectStructure(projectData);
          } catch (error) {
            console.error("Error parsing project structure:", error);
          }
        }
      }

      // Apply diffs from messages
      const diffBlocks = messages
        .filter((msg) => msg.role === "assistant")
        .flatMap((msg) => {
          const content = typeof msg.content === "string" ? msg.content : "";
          const diffMatches = content.match(
            /```diff\s+([^\n]+)\s*\n([\s\S]*?)```/g,
          );
          return (
            diffMatches?.map((match) => {
              const [, path, diff] =
                match.match(/```diff\s+([^\n]+)\s*\n([\s\S]*?)```/) || [];
              return { path, diff };
            }) || []
          );
        })
        .filter(Boolean);

      if (diffBlocks.length > 0 && projectStructure) {
        const newProjectStructure = { ...projectStructure, files: { ...projectStructure.files } };

        for (const { path, diff } of diffBlocks) {
          try {
            // Parse unified diff and apply patch
            const unifiedDiff = `--- ${path}\n+++ ${path}\n${diff}`;
            const parsedDiff = parsePatch(unifiedDiff);

            if (parsedDiff.length > 0) {
              const currentContent = newProjectStructure.files[path] || "";
              const patchedContent = applyPatch(currentContent, parsedDiff[0]);

              if (patchedContent !== false) {
                newProjectStructure.files[path] = patchedContent;
              } else {
                throw new Error(`Failed to apply patch to ${path}`);
              }
            }
          } catch (error) {
            console.error(`Error applying diff to ${path}:`, error);
            setDiffErrors((prev) => [
              ...prev,
              `Failed to apply diff to ${path}: ${(error as Error).message}`,
            ]);
          }
        }

        setProjectStructure(newProjectStructure);
      }
    }
  }, [messages, projectStructure, isOpen]);

  // Clear diff errors when closing
  useEffect(() => {
    if (!isOpen) {
      setDiffErrors([]);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key={isOpen ? "visible" : "hidden"}
          initial={{ opacity: 0, x: "100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: "100%" }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="fixed top-0 h-full bg-black/20 backdrop-blur-2xl border border-white/10 z-[100] overflow-hidden shadow-2xl
                     md:right-0 md:rounded-l-xl md:left-auto
                     left-0 right-0 rounded-none"
          style={{
            width: `min(100vw, ${panelWidth}px)`,
          }}
        >
          {/* Resize Handle - Hidden on mobile */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 bg-white/20 cursor-ew-resize hover:bg-white/30 transition-all duration-200 hidden md:block"
            onMouseDown={handleMouseDown}
          />

          <Card className="h-full bg-transparent border-0 rounded-none">
            <CardHeader className="border-b border-white/10 bg-black/20 px-3 md:px-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-white flex items-center gap-2 text-sm md:text-base">
                    <CodeIcon className="w-4 h-4 md:w-5 md:h-5" />
                    <span className="hidden sm:inline">Code Preview Panel</span>
                    <span className="sm:hidden">Code</span>
                    <span className="bg-gray-700 text-gray-300 rounded-full px-2 py-0.5 text-xs">
                      {codeBlocks.length}
                    </span>
                  </CardTitle>
                  {/* OPFS Status Indicator */}
                  <OPFSStatusIndicator 
                    showDetails={false}
                    enableSync={true}
                    className="ml-2"
                  />
                </div>
                <div className="flex items-center gap-1 md:gap-2">
                  <button
                    onClick={async () => {
                      // Clear stale sandbox sessions
                      try {
                        const response = await fetch('/api/sandbox/clear-sessions', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                        });
                        const data = await response.json();
                        if (data.success) {
                          toast.success('Sessions cleared', {
                            description: `Cleared ${data.clearedCount || 0} stale sessions`,
                            duration: 3000,
                          });
                          // Reset all sandbox states
                          setWebcontainerUrl(null);
                          setCodesandboxUrl(null);
                          setNextjsUrl(null);
                          setIsWebcontainerBooting(false);
                          setIsCodesandboxLoading(false);
                          setIsNextjsBuilding(false);
                        } else {
                          toast.error('Failed to clear sessions', {
                            description: data.error || 'Unknown error',
                            duration: 4000,
                          });
                        }
                      } catch (err: any) {
                        toast.error('Failed to clear sessions', {
                          description: err.message,
                          duration: 4000,
                        });
                      }
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center"
                    title="Clear stale sandbox sessions (fixes 'Unauthorized' and 'not found' errors)"
                  >
                    <Trash2 className="w-3 h-3 md:w-4 md:h-4 mr-1" />
                    <span className="hidden sm:inline">Clear Sessions</span>
                    <span className="sm:hidden">🗑️</span>
                  </button>
                  <button
                    onClick={downloadAsZip}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center"
                  >
                    <Package className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Download ZIP</span>
                    <span className="sm:hidden">ZIP</span>
                  </button>
                  {visualEditorProjectData && (
                    <button
                      onClick={() => {
                        log(`[VisualEditor] opening with bundler="${visualEditorProjectData.bundler}", entryFile="${visualEditorProjectData.entryFile}", previewModeHint="${visualEditorProjectData.previewModeHint}"`);
                        localStorage.setItem(
                          "visualEditorProject",
                          JSON.stringify(visualEditorProjectData),
                        );
                        window.open("/visual-editor", "_blank", "noopener,noreferrer");
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center"
                    >
                      <Edit className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                      <span className="hidden sm:inline">Edit</span>
                      <span className="sm:hidden">Edit</span>
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="border border-gray-300 hover:bg-gray-700 text-gray-300 px-2 md:px-3 py-1.5 rounded text-xs md:text-sm min-w-[44px]"
                  >
                    Close
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 h-full">
              <Tabs
                value={selectedTab}
                onValueChange={setSelectedTab}
                className="h-full"
              >
                <TabsList className="grid w-full grid-cols-3 bg-black/40 border-b border-white/10 px-2 md:px-4">
                  <TabsTrigger
                    value="preview"
                    className="text-white text-xs md:text-sm relative"
                  >
                    <Eye className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Live Preview</span>
                    <span className="sm:hidden">Preview</span>
                    {/* Manual preview indicator + stale state */}
                    {isManualPreviewActive && (
                      <span
                        className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${
                          manualPreviewMayBeStale 
                            ? 'bg-yellow-500 animate-pulse' 
                            : 'bg-green-500'
                        }`}
                        title={manualPreviewMayBeStale 
                          ? 'Files changed while in preview - click refresh to update' 
                          : 'Manual preview active'}
                      />
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="files"
                    className="text-white text-xs md:text-sm"
                  >
                    <FileText className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Files</span>
                    <span className="sm:hidden">Files</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="structure"
                    className="text-white text-xs md:text-sm"
                  >
                    <Package className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Project</span>
                    <span className="sm:hidden">Project</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="preview" className="p-2 md:p-4 h-full relative">
                  {/* Stale indicator with refresh button */}
                  {isManualPreviewActive && manualPreviewMayBeStale && (
                    <div className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-yellow-500/90 text-black px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg animate-pulse">
                      <span>Files changed</span>
                      <button
                        onClick={handleRefreshManualPreview}
                        className="hover:bg-yellow-600 px-2 py-0.5 rounded bg-white/20 transition-colors"
                      >
                        ↻ Refresh
                      </button>
                    </div>
                  )}
                  {renderLivePreview()}
                </TabsContent>

                {detectedFramework !== "vanilla" && (
                  <TabsContent value="sandpack" className="p-0 h-full">
                    {renderLivePreview()}
                  </TabsContent>
                )}

                <TabsContent value="files" className="p-0 h-full">
                  <div className="flex h-full flex-col md:flex-row">
                    <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 bg-black/30 overflow-y-auto max-h-48 md:max-h-none">
                      <div className="p-2 md:p-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-2">
                          Filesystem Explorer
                        </h3>
                        <div className="mb-3 rounded border border-white/10 bg-black/30 p-2">
                          <div className="mb-2 text-[11px] text-gray-400 break-all">
                            {normalizedFilesystemPath}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={openFilesystemParent}
                            >
                              Up
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() =>
                                void listFilesystemDirectory(filesystemCurrentPath)
                              }
                            >
                              Refresh
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setIsCreatingFile(true)}
                            >
                              + File
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => {
                                const name = prompt('New folder name:');
                                if (name?.trim()) {
                                  const fullPath = `${filesystemCurrentPath.replace(/\/+$/, '')}/${name.trim()}/.keep`;
                                  writeFilesystemFile(fullPath, '').then(() => {
                                    void listFilesystemDirectory(filesystemCurrentPath);
                                    toast.success('Folder created');
                                  });
                                }
                              }}
                            >
                              + Folder
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 px-2 text-[11px] bg-purple-600 hover:bg-purple-700"
                              onClick={() => handleManualPreview()}
                              title="Preview current directory in Sandpack"
                            >
                              ▶ Preview
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => handleManualPreview(undefined, 'iframe')}
                              title="Preview as HTML iframe"
                            >
                              📄 HTML
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => handleManualPreview(undefined, 'parcel')}
                              title="Preview with Parcel bundler"
                            >
                              ⚡ Parcel
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => handleManualPreview(undefined, 'devbox')}
                              title="Preview with DevBox runtime"
                            >
                              🔵 DevBox
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => handleManualPreview(undefined, 'pyodide')}
                              title="Preview with Pyodide (Python in browser)"
                            >
                              🐍 Pyodide
                            </Button>
                          </div>
                          {isCreatingFile && (
                            <div className="mt-2 flex items-center gap-1">
                              <input
                                type="text"
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                placeholder="filename.ext"
                                className="flex-1 bg-black/50 border border-white/20 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newFileName.trim()) {
                                    const fullPath = `${filesystemCurrentPath.replace(/\/+$/, '')}/${newFileName.trim()}`;
                                    writeFilesystemFile(fullPath, '').then(() => {
                                      setNewFileName('');
                                      setIsCreatingFile(false);
                                      toast.success(`Created ${newFileName.trim()}`);
                                      void listFilesystemDirectory(filesystemCurrentPath);
                                    }).catch(() => toast.error('Failed to create file'));
                                  } else if (e.key === 'Escape') {
                                    setIsCreatingFile(false);
                                    setNewFileName('');
                                  }
                                }}
                              />
                              <Button size="sm" variant="ghost" className="h-7 px-1 text-[10px]" onClick={() => { setIsCreatingFile(false); setNewFileName(''); }}>✕</Button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          {debouncedIsLoading && (
                            <div className="text-xs text-gray-400 px-2 py-1">
                              Loading filesystem...
                            </div>
                          )}
                          {!debouncedIsLoading && filesystemNodes.length === 0 && (
                            <div className="text-xs text-gray-500 px-2 py-1">
                              No files in current directory.
                            </div>
                          )}
                          {filesystemNodes.map((node) => (
                            <div
                              className={`flex items-center w-full justify-between p-2 group cursor-pointer ${
                                selectedFilesystemPath === node.path
                                  ? "bg-gray-700"
                                  : "hover:bg-gray-800"
                              }`}
                              key={node.path}
                              onClick={() => {
                                if (node.type === "directory") {
                                  openFilesystemDirectory(node.path);
                                } else {
                                  void selectFilesystemFile(node.path);
                                }
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  path: node.path,
                                  type: node.type,
                                });
                              }}
                            >
                              <div className="flex items-center flex-1 min-w-0">
                                {node.type === "directory" ? (
                                  <FolderOpen className="w-4 h-4 mr-2 flex-shrink-0 text-yellow-300" />
                                ) : (
                                  <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                                )}
                                <span className="truncate flex-1">{node.name}</span>
                              </div>
                              <button
                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const label = node.type === 'directory' ? `Delete folder "${node.name}" and all contents?` : `Delete ${node.name}?`;
                                  if (confirm(label)) {
                                    deleteFilesystemPath(node.path).then((deleteResult) => {
                                      toast.success(`Deleted ${node.name}`);
                                      void listFilesystemDirectory(filesystemCurrentPath);
                                      if (selectedFilesystemPath === node.path) {
                                        setSelectedFilesystemPath('');
                                        setSelectedFilesystemContent('');
                                      }
                                      // Dispatch event for cross-panel sync (Terminal, Chat)
                                      emitFilesystemUpdated({
                                        path: node.path,
                                        scopePath: normalizedFilesystemPath,
                                        source: 'code-preview',
                                        type: 'delete',
                                      });
                                    }).catch((err: any) => {
                                      toast.error('Failed to delete: ' + err.message);
                                    });
                                  }
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>

                        {codeBlocks.length > 0 && (
                          <div className="mt-4 border-t border-white/10 pt-3">
                            <h4 className="text-xs font-medium text-gray-400 mb-2">
                              Generated Snippets
                            </h4>
                            <div className="space-y-1">
                              {codeBlocks.map((block, index) => (
                                <button
                                  key={`${block.filename}-${index}`}
                                  type="button"
                                  className={`w-full text-left flex items-center p-2 rounded ${
                                    selectedFileIndex === index
                                      ? "bg-gray-700"
                                      : "hover:bg-gray-800"
                                  }`}
                                  onClick={() => {
                                    setSelectedFileIndex(index);
                                    setSelectedFilesystemPath("");
                                    setSelectedFilesystemContent("");
                                    setSelectedFilesystemLanguage("text");
                                  }}
                                >
                                  <CodeIcon className="w-3 h-3 mr-2 flex-shrink-0" />
                                  <span className="truncate text-xs">
                                    {block.filename}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {pendingFiles.length > 0 && (
                          <div className="mt-4 border-t border-white/10 pt-3">
                            <h4 className="text-xs font-medium text-gray-400 mb-2">
                              Pending Diffs ({pendingFiles.length})
                            </h4>
                            <div className="flex gap-2 mb-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={onApplyAllCommandDiffs}
                                disabled={!onApplyAllCommandDiffs}
                              >
                                Apply All
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={onClearAllCommandDiffs}
                                disabled={!onClearAllCommandDiffs}
                              >
                                Clear All
                              </Button>
                            </div>
                            <div className="space-y-1">
                              {pendingFiles.map((path) => (
                                <div key={path} className="rounded border border-white/10 p-2">
                                  <div className="truncate text-[11px] text-gray-300">{path}</div>
                                  <div className="mt-1 flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1 text-[10px]"
                                      onClick={() => onApplyFileCommandDiffs?.(path)}
                                    >
                                      Apply
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1 text-[10px]"
                                      onClick={() => onSquashFileCommandDiffs?.(path)}
                                    >
                                      Squash
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1 text-[10px]"
                                      onClick={() => onClearFileCommandDiffs?.(path)}
                                    >
                                      Clear
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                      {isFilesystemFileLoading ? (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400">
                          Loading file...
                        </div>
                      ) : selectedFileIndex !== null && codeBlocks[selectedFileIndex] ? (
                        // Render code block from Generated Snippets
                        <div className="h-full flex flex-col">
                          <div className="p-4 border-b border-white/10 bg-black/40 flex justify-between items-center">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="border border-gray-500 text-gray-300 rounded px-2 py-0.5 text-xs">
                                {codeBlocks[selectedFileIndex].language}
                              </span>
                              <span className="text-sm font-mono text-gray-300 truncate">
                                {codeBlocks[selectedFileIndex].filename || `Snippet ${selectedFileIndex + 1}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Run button for shell commands */}
                              {isShellCodeBlock(codeBlocks[selectedFileIndex].language, codeBlocks[selectedFileIndex].code) && (
                                <button
                                  className="flex items-center text-sm text-green-400 hover:bg-green-900/30 px-2 py-1 rounded"
                                  onClick={() => {
                                    handleRunCommand(codeBlocks[selectedFileIndex].code);
                                  }}
                                  title="Run in terminal"
                                >
                                  <Play className="w-3 h-3 mr-1" />
                                  Run
                                </button>
                              )}
                              
                              <button
                                className="flex items-center text-sm hover:bg-gray-200 px-2 py-1 rounded"
                                onClick={() => {
                                  navigator.clipboard.writeText(codeBlocks[selectedFileIndex].code);
                                }}
                              >
                                <CodeIcon className="w-4 h-4 mr-1" />
                                Copy
                              </button>
                            </div>
                          </div>
                          <div className="flex-1 overflow-y-auto bg-black/30">
                            <SyntaxHighlighter
                              style={oneDark as any}
                              language={codeBlocks[selectedFileIndex].language}
                              PreTag="div"
                              className="!m-0 !bg-gray-900 h-full text-sm"
                              showLineNumbers
                            >
                              {codeBlocks[selectedFileIndex].code}
                            </SyntaxHighlighter>
                          </div>
                        </div>
                      ) : selectedFilesystemPath ? (
                        <div className="h-full flex flex-col">
                          <div className="p-4 border-b border-white/10 bg-black/40 flex justify-between items-center">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="border border-gray-500 text-gray-300 rounded px-2 py-0.5 text-xs">
                                {selectedFilesystemLanguage}
                              </span>
                              <span className="text-sm font-mono text-gray-300 truncate">
                                {selectedFilesystemPath.replace(/^project\//, '')}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {isEditingFile ? (
                                <>
                                  <button
                                    className="flex items-center text-sm text-green-400 hover:bg-green-900/30 px-2 py-1 rounded"
                                    onClick={() => {
                                      const filePath = normalizeProjectPath(selectedFilesystemPath);
                                      log(`handleSave: saving file "${filePath}", contentLength=${editableContent.length}`);
                                      
                                      writeFilesystemFile(filePath, editableContent).then(async (fileData) => {
                                        log(`handleSave: write completed, re-reading file to confirm`);
                                        
                                        // Re-read the file to confirm save worked
                                        let contentToSet = editableContent;
                                        try {
                                          const latestFile = await readFilesystemFile(filePath);
                                          log(`handleSave: re-read successful, path="${latestFile.path}", contentLength=${latestFile.content?.length || 0}`);
                                          contentToSet = latestFile.content || editableContent;
                                          setSelectedFilesystemLanguage(latestFile.language || selectedFilesystemLanguage);
                                        } catch (readErr: any) {
                                          logError(`handleSave: failed to re-read file after save`, readErr);
                                          contentToSet = editableContent;
                                        }
                                        setSelectedFilesystemPath(filePath);
                                        setSelectedFilesystemContent(contentToSet);
                                        
                                        // Update scoped preview files for live preview
                                        setScopedPreviewFiles((prev) => ({
                                          ...prev,
                                          [filePath]: contentToSet,
                                        }));
                                        log(`handleSave: updated scopedPreviewFiles`);
                                        
                                        setIsEditingFile(false);
                                        
                                        // Refresh directory listing
                                        await listFilesystemDirectory(normalizedFilesystemPath);
                                        log(`handleSave: refreshed directory`);
                                        
                                        // Dispatch event for cross-panel sync
                                        emitFilesystemUpdated({
                                          path: filePath,
                                          scopePath: normalizedFilesystemPath,
                                          source: 'code-preview',
                                          workspaceVersion: fileData?.workspaceVersion,
                                          commitId: fileData?.commitId,
                                          sessionId: fileData?.sessionId,
                                        });
                                        log(`handleSave: dispatched filesystem-updated event`);
                                        
                                        toast.success('File saved');
                                      }).catch((writeErr: any) => {
                                        logError(`handleSave: write failed for "${filePath}"`, writeErr);
                                        toast.error('Failed to save: ' + writeErr.message);
                                      });
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="flex items-center text-sm hover:bg-gray-700 px-2 py-1 rounded"
                                    onClick={() => {
                                      setIsEditingFile(false);
                                      setEditableContent('');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="flex items-center text-sm hover:bg-gray-200 px-2 py-1 rounded"
                                    onClick={() => {
                                      setEditableContent(selectedFilesystemContent);
                                      setIsEditingFile(true);
                                    }}
                                  >
                                    <Edit className="w-4 h-4 mr-1" />
                                    Edit
                                  </button>
                                  <button
                                    className="flex items-center text-sm hover:bg-gray-200 px-2 py-1 rounded"
                                    onClick={() => {
                                      navigator.clipboard.writeText(selectedFilesystemContent);
                                    }}
                                  >
                                    <CodeIcon className="w-4 h-4 mr-1" />
                                    Copy
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 overflow-y-auto bg-black/30">
                            {isEditingFile ? (
                              <textarea
                                value={editableContent}
                                onChange={(e) => setEditableContent(e.target.value)}
                                className="w-full h-full bg-gray-900 text-gray-100 font-mono text-sm p-4 resize-none outline-none border-none"
                                spellCheck={false}
                                autoFocus
                              />
                            ) : (
                              <SyntaxHighlighter
                                style={oneDark as any}
                                language={selectedFilesystemLanguage}
                                PreTag="div"
                                className="!m-0 !bg-gray-900 h-full text-sm"
                                showLineNumbers
                              >
                                {selectedFilesystemContent}
                              </SyntaxHighlighter>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-500">
                          Select a file or code snippet to preview.
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="structure"
                  className="p-4 h-full overflow-y-auto"
                >
                  {(projectStructureWithScopedFiles || projectStructure) ? (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-2">
                          Project Structure
                        </h3>
                        <div className="bg-black/40 rounded-lg p-4">
                          <pre className="text-sm text-gray-300">
                            {Object.keys((projectStructureWithScopedFiles || projectStructure)!.files).map(
                              (filename) => (
                                <div
                                  key={filename}
                                  className="flex items-center gap-2 mb-1"
                                >
                                  <FileText className="w-4 h-4" />
                                  {filename}
                                </div>
                              ),
                            )}
                          </pre>
                        </div>
                      </div>

                      {(projectStructureWithScopedFiles || projectStructure)?.dependencies && (
                        <div>
                          <h4 className="text-md font-medium text-white mb-2">
                            Dependencies
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {(projectStructureWithScopedFiles || projectStructure)!.dependencies!.map((dep) => (
                              <span
                                key={dep}
                                className="bg-gray-700 text-gray-300 rounded px-2 py-0.5 text-xs"
                              >
                                {dep}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <h4 className="text-md font-medium text-white mb-2">
                          Setup Instructions
                        </h4>
                        <div className="bg-black/40 rounded-lg p-4">
                          <pre className="text-sm text-gray-300">
                            {`1. Download the ZIP file
2. Extract to your desired location
3. Review the README.md file
4. Install dependencies (if any)
5. Run the project according to the language requirements`}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-400">
                      <Package className="w-16 h-16 mx-auto mb-4" />
                      <p>No project structure detected</p>
                      <p className="text-sm mt-2">
                        Add more code files to analyze project structure
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </motion.div>
      )}
      
      {/* Context Menu for File Operations */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              onClick={() => {
                handleCreateFile(contextMenu.type === 'directory' ? contextMenu.path : contextMenu.path.split('/').slice(0, -1).join('/'));
              }}
            >
              <Plus className="w-4 h-4" /> New File
            </button>
            
            <button
              className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              onClick={() => {
                handleCreateFolder(contextMenu.type === 'directory' ? contextMenu.path : contextMenu.path.split('/').slice(0, -1).join('/'));
              }}
            >
              <FolderPlus className="w-4 h-4" /> New Folder
            </button>
            
            {contextMenu.type === 'file' && (
              <>
                <hr className="my-1 border-gray-700" />
                <button
                  className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                  onClick={() => {
                    handleRenameFile(contextMenu.path);
                  }}
                >
                  <Edit className="w-4 h-4" /> Rename
                </button>
              </>
            )}
            
            <hr className="my-1 border-gray-700" />
            
            <button
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"
              onClick={() => {
                const label = contextMenu.type === 'directory'
                  ? `Delete folder "${contextMenu.path.split('/').pop()}" and all contents?`
                  : `Delete ${contextMenu.path.split('/').pop()}?`;
                if (confirm(label)) {
                  deleteFilesystemPath(contextMenu.path).then((deleteResult) => {
                    toast.success('Deleted ' + contextMenu.path.split('/').pop());
                    void listFilesystemDirectory(filesystemCurrentPath);
                    setContextMenu(null);
                    if (selectedFilesystemPath === contextMenu.path) {
                      setSelectedFilesystemPath('');
                      setSelectedFilesystemContent('');
                    }
                    // Dispatch event for cross-panel sync (Terminal, Chat)
                    emitFilesystemUpdated({
                      path: contextMenu.path,
                      scopePath: normalizedFilesystemPath,
                      source: 'code-preview',
                      type: 'delete',
                    });
                  }).catch((err: any) => {
                    toast.error('Failed to delete: ' + err.message);
                  });
                }
              }}
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
