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
  Zap,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import JSZip from "jszip";
import type { Message } from "../types/index";
import { useVirtualFilesystem } from "../hooks/use-virtual-filesystem";
import { normalizeScopePath, resolveScopedPath, stripWorkspacePrefixes } from "@/lib/virtual-filesystem/scope-utils";
import { emitFilesystemUpdated, onFilesystemUpdated } from "@/lib/virtual-filesystem/sync/sync-events";
import { createRefreshScheduler } from "@/lib/virtual-filesystem/refresh-scheduler";
import {
  parseCodeBlocksFromMessages,
  type CodeBlock as ParsedCodeBlock,
} from "../lib/code-parser";
import { createDebugLogger } from "@/config/features";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { checkFileConflicts } from "@/lib/session-naming";
import { buildApiHeaders } from "@/lib/utils";
import { usePanel } from "@/contexts/panel-context";

// Import live preview offloading functions
import {
  detectProject,
  getSandpackConfig,
  livePreviewOffloading,
  type ProjectDetection,
  type PreviewMode,
  type AppFramework,
} from "@/lib/previews/live-preview-offloading";

// Import Preview Error Boundary
import { PreviewErrorBoundary } from "./preview-error-boundary";

// Lazy load Sandpack to avoid SSR issues
// React.lazy requires default export, so we remap the named export
// NOTE: Sandpack uses iframes with allow-scripts + allow-same-origin which triggers
// browser security warnings ("An iframe which has both allow-scripts and allow-same-origin...").
// This is expected behavior - Sandpack requires both permissions to execute user code in an
// isolated environment while maintaining access to bundled resources. The warning can be safely ignored.
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
  // Polled diffs from useDiffsPoller hook
  polledDiffs?: Array<{
    id: string;
    path: string;
    diff: string;
    changeType: 'create' | 'update' | 'delete';
    timestamp: number;
    source: 'poll';
  }>;
  onApplyPolledDiffs?: (pathsToApply?: string[]) => Promise<void>;
  onClearPolledDiffs?: () => void;
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
  polledDiffs = [],
  onApplyPolledDiffs,
  onClearPolledDiffs,
}: CodePreviewPanelProps) {
  const { openMonacoEditor } = usePanel();
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
  const pendingFiles = useMemo(
    () => Object.keys(commandsByFile || {}),
    [commandsByFile],
  );
  
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath || 'project', { useOPFS: true });
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
  const [projectDetection, setProjectDetection] = useState<ReturnType<typeof detectProject> | null>(null);
  const [isManualPreviewActive, setIsManualPreviewActive] = useState(false);
  const [manualPreviewMayBeStale, setManualPreviewMayBeStale] = useState(false); // Track if VFS changed while in manual preview
  const [previewMode, setPreviewMode] = useState<'sandpack' | 'iframe' | 'raw' | 'parcel' | 'devbox' | 'pyodide' | 'vite' | 'webpack' | 'webcontainer' | 'nextjs' | 'codesandbox' | 'opensandbox' | 'node' | 'local' | 'cloud'>('sandpack');
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
  const [opensandboxUrl, setOpensandboxUrl] = useState<string | null>(null);
  const [opensandboxId, setOpensandboxId] = useState<string | null>(null);
  const [isOpensandboxDeploying, setIsOpensandboxDeploying] = useState(false);
  const [opensandboxLogs, setOpensandboxLogs] = useState<string[]>([]);
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
  const opensandboxScopeRef = useRef<string | null>(null);

  // WebContainer refs (top-level to satisfy Rules of Hooks)
  const webcontainerInstanceRef = useRef<any>(null);
  const webcontainerProcessRef = useRef<any>(null);
  const webcontainerUrlRef = useRef<string | null>(null);

  // Open WebContainer preview in isolated route with COEP/COOP headers
  const openWebContainerPreview = useCallback((files: Record<string, string>) => {
    if (!files || Object.keys(files).length === 0) {
      toast.error('No files to preview');
      return;
    }
    try {
      // Encode files as base64 JSON for URL transport
      const json = JSON.stringify(files);
      const encoded = btoa(encodeURIComponent(json));
      // Truncate warning if too large for URL
      if (encoded.length > 2000000) {
        toast.warning('Project is large for WebContainer. Try Sandpack or OpenSandbox preview instead.');
        return;
      }
      const url = `/webcontainer?files=${encodeURIComponent(encoded)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast.error('Failed to open WebContainer preview: ' + err.message);
    }
  }, []);

  // Track Sandpack normalization to avoid logging on every render
  const lastNormalizationRef = useRef<string>('');

  // Context menu state for file operations
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: 'file' | 'directory';
  } | null>(null);

  // Double-click rename state
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [editingFileName, setEditingFileName] = useState("");
  
  // Clipboard state for cut/copy/paste
  const [clipboard, setClipboard] = useState<{
    path: string;
    operation: 'cut' | 'copy';
    sourcePath: string;
  } | null>(null);
  
  // Drag and drop state
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [draggedFile, setDraggedFile] = useState<{ path: string; name: string } | null>(null);
  
  // Confirmation dialog state for file operations
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'warning' | 'danger';
    onConfirm: () => void;
    onCancel: () => void;
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
    // Removed verbose logging - called too frequently
    return normalized;
  }, []);

  // Use ref for debounced function to avoid forward reference issues
  const debouncedListDirectoryRef = useRef<(path: string) => Promise<void> | null>(null);
  
  const openFilesystemDirectory = useCallback((path: string) => {
    const cleanPath = normalizeProjectPath(path);
    log(`openFilesystemDirectory: "${path}" -> "${cleanPath}"`);
    setFilesystemCurrentPath(cleanPath);
    // Use ref to avoid forward reference
    debouncedListDirectoryRef.current?.(cleanPath);
  }, [normalizeProjectPath, setFilesystemCurrentPath, log]);

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
      
      await debouncedListDirectory(cleanParentPath);
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
      await debouncedListDirectory(cleanParentPath);
      
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

  const handleRenameFile = useCallback(async (oldPath: string) => {
    const oldName = oldPath.split('/').pop() || '';
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;

    const parentPath = oldPath.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    try {
      // Use new rename API with conflict detection
      const response = await fetch('/api/filesystem/rename', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({
          oldPath: resolveScopedPath(oldPath, normalizedFilesystemPath),
          newPath: resolveScopedPath(newPath, normalizedFilesystemPath),
          overwrite: false,
        }),
      });

      if (response.status === 409) {
        // Conflict detected - show confirmation dialog
        setContextMenu(null); // Clear context menu before showing dialog
        setConfirmDialog({
          isOpen: true,
          title: 'File Already Exists',
          message: `A file named "${newName}" already exists. Overwrite?`,
          confirmLabel: 'Overwrite',
          cancelLabel: 'Cancel',
          variant: 'warning',
          onConfirm: async () => {
            setConfirmDialog(null);
            // Retry with overwrite=true
            const retryResponse = await fetch('/api/filesystem/rename', {
              method: 'POST',
              headers: buildApiHeaders(),
              body: JSON.stringify({
                oldPath: resolveScopedPath(oldPath, normalizedFilesystemPath),
                newPath: resolveScopedPath(newPath, normalizedFilesystemPath),
                overwrite: true,
              }),
            });

            if (retryResponse.ok) {
              toast.success('Renamed to: ' + newName);
              void debouncedListDirectory(filesystemCurrentPath);
              
              // Emit filesystem SSE event for rename operation
              emitFilesystemUpdated({
                path: newPath,
                scopePath: normalizedFilesystemPath,
                source: 'code-preview-rename',
                type: 'update',
              });
            } else {
              const errorData = await retryResponse.json().catch(() => null);
              toast.error('Failed to rename: ' + (errorData?.error || 'Unknown error'));
            }
            setContextMenu(null);
            if (selectedFilesystemPath === oldPath) {
              setSelectedFilesystemPath('');
              setSelectedFilesystemContent('');
            }
          },
          onCancel: () => {
            setConfirmDialog(null);
          },
        });
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Rename failed');
      }

      toast.success('Renamed to: ' + newName);
      void debouncedListDirectory(filesystemCurrentPath);
      setContextMenu(null);
      if (selectedFilesystemPath === oldPath) {
        setSelectedFilesystemPath('');
        setSelectedFilesystemContent('');
      }

      // Emit filesystem SSE event for rename operation
      emitFilesystemUpdated({
        path: newPath,
        scopePath: normalizedFilesystemPath,
        source: 'code-preview-rename',
        type: 'update',
      });
    } catch (err: any) {
      toast.error('Failed to rename: ' + err.message);
    }
  }, [filesystemCurrentPath, normalizedFilesystemPath, selectedFilesystemPath, emitFilesystemUpdated]);

  // Handle double-click to rename file
  const handleDoubleClickFile = useCallback((node: { path: string; name: string; type: string }) => {
    if (node.type === 'file') {
      setEditingFilePath(node.path);
      setEditingFileName(node.name);
    }
  }, []);

  // Confirm rename from double-click editing
  const confirmRenameFromEdit = useCallback(async () => {
    if (!editingFilePath || !editingFileName.trim()) {
      setEditingFilePath(null);
      setEditingFileName("");
      return;
    }
    
    const oldPath = editingFilePath;
    const oldName = oldPath.split('/').pop() || '';
    const newName = editingFileName.trim();
    
    if (newName === oldName) {
      setEditingFilePath(null);
      setEditingFileName("");
      return;
    }
    
    const parentPath = oldPath.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    
    // Check if target already exists
    try {
      const targetExists = await readFilesystemFile(newPath).then(() => true).catch(() => false);
      
      if (targetExists && oldPath !== newPath) {
        setConfirmDialog({
          isOpen: true,
          title: 'File Already Exists',
          message: `A file named "${newName}" already exists. Do you want to overwrite it?`,
          confirmLabel: 'Overwrite',
          cancelLabel: 'Cancel',
          variant: 'warning',
          onConfirm: async () => {
            setConfirmDialog(null);
            await performRename(oldPath, newPath);
            setEditingFilePath(null);
            setEditingFileName("");
          },
          onCancel: () => {
            setConfirmDialog(null);
            setEditingFilePath(null);
            setEditingFileName("");
          },
        });
        return;
      }
      
      await performRename(oldPath, newPath);
    } catch (err: any) {
      toast.error('Failed to rename: ' + err.message);
    }
    
    setEditingFilePath(null);
    setEditingFileName("");
    
    async function performRename(sourcePath: string, targetPath: string) {
      try {
        const file = await readFilesystemFile(sourcePath);
        await writeFilesystemFile(targetPath, file.content);
        await deleteFilesystemPath(sourcePath);
        toast.success('Renamed to: ' + newName);
        void debouncedListDirectory(filesystemCurrentPath);
        if (selectedFilesystemPath === sourcePath) {
          setSelectedFilesystemPath(targetPath);
        }
        
        // Emit filesystem SSE event for rename operation
        emitFilesystemUpdated({
          path: targetPath,
          scopePath: normalizedFilesystemPath,
          source: 'code-preview-rename',
          type: 'update',
        });
      } catch (err: any) {
        toast.error('Failed to rename: ' + err.message);
      }
    }
  }, [editingFilePath, editingFileName, readFilesystemFile, writeFilesystemFile, deleteFilesystemPath, filesystemCurrentPath, listFilesystemDirectory, selectedFilesystemPath, normalizedFilesystemPath, emitFilesystemUpdated]);

  // Cancel rename editing
  const cancelRenameEdit = useCallback(() => {
    setEditingFilePath(null);
    setEditingFileName("");
  }, []);

  // Handle cut operation
  const handleCutFile = useCallback((path: string, name: string, sourcePath: string) => {
    setClipboard({ path, operation: 'cut', sourcePath });
    setContextMenu(null);
    toast.info('File cut. Click a folder and paste to move.');
  }, []);

  // Handle copy operation
  const handleCopyFile = useCallback((path: string, name: string, sourcePath: string) => {
    setClipboard({ path, operation: 'copy', sourcePath });
    setContextMenu(null);
    toast.info('File copied. Click a folder and paste to copy.');
  }, []);

  // Handle paste operation
  const handlePasteFile = useCallback(async (targetPath: string, isDirectory: boolean) => {
    if (!clipboard) {
      toast.error('No file in clipboard');
      return;
    }
    
    const targetDir = isDirectory ? targetPath : targetPath.split('/').slice(0, -1).join('/');
    const fileName = clipboard.path.split('/').pop() || '';
    const newPath = `${targetDir.replace(/\/+$/, '')}/${fileName}`;
    
    try {
      // Check if target already exists
      const targetExists = await readFilesystemFile(newPath).then(() => true).catch(() => false);
      
      if (targetExists && clipboard.path !== newPath) {
        // Generate unique name
        const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        const baseName = fileName.replace(ext, '');
        let counter = 1;
        let uniquePath = newPath;
        while (await readFilesystemFile(uniquePath).then(() => true).catch(() => false)) {
          uniquePath = `${targetDir.replace(/\/+$/, '')}/${baseName}-${counter}${ext}`;
          counter++;
        }
        
        await performPaste(clipboard.path, uniquePath, targetDir);
      } else {
        await performPaste(clipboard.path, newPath, targetDir);
      }
    } catch (err: any) {
      toast.error('Failed to paste: ' + err.message);
    }
    
    async function performPaste(sourcePath: string, destPath: string, targetDir: string) {
      // Bail out when the target path equals the source path
      if (sourcePath === destPath) {
        toast.info('Cannot paste file into itself');
        return;
      }

      try {
        const file = await readFilesystemFile(sourcePath);
        await writeFilesystemFile(destPath, file.content);
        
        // If cut, delete original
        if (clipboard.operation === 'cut') {
          await deleteFilesystemPath(sourcePath);
          setClipboard(null);
        }
        
        toast.success(clipboard.operation === 'cut' ? 'File moved' : 'File copied');
        await debouncedListDirectory(filesystemCurrentPath);
        await debouncedListDirectory(targetDir);
        
        // Emit filesystem SSE event for paste operation
        emitFilesystemUpdated({
          path: destPath,
          scopePath: normalizedFilesystemPath,
          source: 'code-preview-paste',
          type: 'update',
        });
      } catch (err: any) {
        toast.error('Failed to paste: ' + err.message);
      }
    }
  }, [clipboard, readFilesystemFile, writeFilesystemFile, deleteFilesystemPath, filesystemCurrentPath, listFilesystemDirectory, normalizedFilesystemPath, emitFilesystemUpdated]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.DragEvent, node: { path: string; name: string }) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ path: node.path, name: node.name }));
    setDraggedFile({ path: node.path, name: node.name });
  }, []);

  // Handle drag over (for drop target)
  const handleDragOver = useCallback((e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(path);
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback(() => {
    setDragOverPath(null);
  }, []);

  // Handle drop
  const handleDrop = useCallback(async (e: React.DragEvent, targetPath: string, isDirectory: boolean) => {
    e.preventDefault();
    setDragOverPath(null);

    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;

    try {
      const { path: sourcePath, name } = JSON.parse(data);

      if (sourcePath === targetPath || sourcePath.split('/').slice(0, -1).join('/') === targetPath) {
        toast.info('File is already in this location');
        return;
      }

      const targetDir = isDirectory ? targetPath : targetPath.split('/').slice(0, -1).join('/');
      const newPath = `${targetDir.replace(/\/+$/, '')}/${name}`;

      // Use new move API with conflict detection
      const response = await fetch('/api/filesystem/move', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({
          sourcePath: resolveScopedPath(sourcePath, normalizedFilesystemPath),
          targetPath: resolveScopedPath(newPath, normalizedFilesystemPath),
          overwrite: false,
        }),
      });

      if (response.status === 409) {
        // Conflict detected - show confirmation dialog
        setContextMenu(null); // Clear context menu before showing dialog
        setConfirmDialog({
          isOpen: true,
          title: 'File Already Exists',
          message: `A file named "${name}" already exists. Overwrite?`,
          confirmLabel: 'Overwrite',
          cancelLabel: 'Cancel',
          variant: 'warning',
          onConfirm: async () => {
            setConfirmDialog(null);
            // Retry with overwrite=true
            const retryResponse = await fetch('/api/filesystem/move', {
              method: 'POST',
              headers: buildApiHeaders(),
              body: JSON.stringify({
                sourcePath: resolveScopedPath(sourcePath, normalizedFilesystemPath),
                targetPath: resolveScopedPath(newPath, normalizedFilesystemPath),
                overwrite: true,
              }),
            });

            if (retryResponse.ok) {
              toast.success(`Moved "${name}" to new location`);
              await debouncedListDirectory(filesystemCurrentPath);
              await debouncedListDirectory(targetDir);
              
              // Emit filesystem SSE event for move operation
              emitFilesystemUpdated({
                path: newPath,
                scopePath: normalizedFilesystemPath,
                source: 'code-preview-move',
                type: 'update',
              });
            } else {
              const errorData = await retryResponse.json().catch(() => null);
              toast.error('Failed to move: ' + (errorData?.error || 'Unknown error'));
            }
          },
          onCancel: () => {
            setConfirmDialog(null);
          },
        });
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Move failed');
      }

      toast.success(`Moved "${name}" to new location`);
      await debouncedListDirectory(filesystemCurrentPath);
      await debouncedListDirectory(targetDir);
      
      // Emit filesystem SSE event for move operation
      emitFilesystemUpdated({
        path: newPath,
        scopePath: normalizedFilesystemPath,
        source: 'code-preview-move',
        type: 'update',
      });
    } catch (err: any) {
      toast.error('Failed to move file: ' + err.message);
    }

    setDraggedFile(null);
  }, [filesystemCurrentPath, normalizedFilesystemPath, listFilesystemDirectory, emitFilesystemUpdated]);

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
  const lastManualPreviewTime = useRef<number>(0);
  const MANUAL_PREVIEW_COOLDOWN_MS = 2000; // Minimum 2 seconds between calls

  const handleManualPreview = useCallback(async (
    directoryPath?: string,
    mode?: 'sandpack' | 'iframe' | 'raw' | 'parcel' | 'devbox' | 'pyodide' | 'vite' | 'webpack' | 'webcontainer' | 'nextjs' | 'codesandbox' | 'opensandbox' | 'local' | 'cloud',
    options?: { silent?: boolean; preserveTab?: boolean },
  ) => {
    const now = Date.now();
    
    // Prevent multiple concurrent calls
    if (handleManualPreviewRef.current) {
      log('[handleManualPreview] already running, skipping duplicate call');
      return;
    }
    
    // Prevent calls too frequently (cooldown period)
    if (now - lastManualPreviewTime.current < MANUAL_PREVIEW_COOLDOWN_MS) {
      log(`[handleManualPreview] called too soon (${now - lastManualPreviewTime.current}ms < ${MANUAL_PREVIEW_COOLDOWN_MS}ms), skipping`);
      return;
    }
    
    handleManualPreviewRef.current = true;
    lastManualPreviewTime.current = now;
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
          // Build relative path from the targetPath (session root)
          const relativePath = basePath ? `${basePath}/${node.name}` : node.name;
          if (node.type === 'directory') {
            await loadFiles(node.path, relativePath);
          } else {
            try {
              const file = await readFilesystemFile(node.path);
              // Store file even if empty (zero-byte files are valid modules/assets)
              files[relativePath] = file.content ?? '';
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
        if (fileName === 'package.json') {
          // package.json at root level - project root is ''
          if (dir === '') addRootScore('', 8);
          // package.json in subdirectory - that dir is a potential root
          else addRootScore(dir, 8);
        }
        if (fileName === 'index.html') {
          if (dir === '') addRootScore('', 6);
          else addRootScore(dir, 6);
        }
        if (fileName === 'vite.config.ts' || fileName === 'vite.config.js' || fileName === 'webpack.config.js' || fileName === '.parcelrc') {
          if (dir === '') addRootScore('', 6);
          else addRootScore(dir, 6);
        }
        if (/^main\.(js|jsx|ts|tsx)$/.test(fileName)) {
          // main.js in src/ means project root is parent of src (i.e., '')
          if (dir === 'src') addRootScore('', 5);
          // Also score the src directory itself
          addRootScore(dir, 2);
        }
        // Additional entry point patterns
        if (/^index\.(js|jsx|ts|tsx)$/.test(fileName)) {
          if (dir === 'src') addRootScore('', 3);
          addRootScore(dir, 1);
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

      log(`[handleManualPreview] detected root="${selectedRoot}", file count: ${Object.keys(files).length}`);

      // Auto-detect best preview mode AND execution mode using centralized logic
      let selectedMode: PreviewMode = mode as PreviewMode || 'sandpack';
      let detectedExecutionMode: 'local' | 'cloud' | 'hybrid' = 'local';

      // Use centralized live preview offloading detection for framework/bundler detection only
      // IMPORTANT: Pass the ORIGINAL files (before root normalization) to preserve directory structure
      const detection = livePreviewOffloading.detectProject({
        files: files,  // Use original 'files' with full directory structure preserved
        scopePath: normalizeProjectPath(targetPath),
      });
      
      if (!mode) {
        selectedMode = detection.previewMode;

        // Determine execution mode based on project requirements
        if (detection.hasHeavyComputation || detection.hasAPIKeys) {
          detectedExecutionMode = 'cloud';
        } else if (detection.hasPython || detection.hasNodeServer) {
          detectedExecutionMode = detection.hasPython && !detection.hasBackend ? 'local' : 'hybrid';
        } else {
          detectedExecutionMode = 'local';
        }

        log(`[handleManualPreview] Detected via live-preview-offloading: framework=${detection.framework}, bundler=${detection.bundler}, mode=${selectedMode}, root="${detection.selectedRoot}"`);
      }

      log(`[handleManualPreview] mode="${selectedMode}", execution="${detectedExecutionMode}", root="${detection.selectedRoot}"`);

      // Store detection result for use in renderLivePreview (for framework info only)
      setProjectDetection(detection);

      // Set execution mode
      setExecutionMode(detectedExecutionMode);

      // Strip the detected project root from file paths for Sandpack
      // Sandpack runners expect files relative to project root (e.g., src/App.tsx not my-app/src/App.tsx)
      const previewRoot = detection.selectedRoot || selectedRoot;
      const previewFiles = previewRoot
        ? Object.fromEntries(
            Object.entries(files)
              .filter(([path]) => path.startsWith(`${previewRoot}/`) || path === previewRoot)
              .map(([path, content]) => {
                // Strip the root prefix: my-app/src/App.tsx -> src/App.tsx
                const relativePath = path === previewRoot ? path : path.slice(previewRoot.length + 1);
                return [relativePath, content];
              }),
          )
        : files;

      log(`[handleManualPreview] Storing ${Object.keys(previewFiles).length} files (root: "${previewRoot || 'project root'}")`);

      // Store files with root-relative paths for Sandpack runners
      setManualPreviewFiles(previewFiles);
      setIsManualPreviewActive(true);
      setPreviewMode(selectedMode);
      if (!preserveTab) {
        setSelectedTab('preview');  // Always switch to preview tab
      }

      const modeLabel = {
        sandpack: 'Live Preview',
        iframe: 'HTML Preview',
        raw: 'Source View',
        parcel: 'Parcel Build',
        devbox: 'Cloud DevBox',
        pyodide: 'Python Runtime',
        vite: 'Vite Build',
        webpack: 'Webpack Build',
        webcontainer: 'WebContainer',
        nextjs: 'Next.js Preview',
        codesandbox: 'CodeSandbox',
        opensandbox: 'OpenSandbox',
        node: 'Node.js Runtime',
        local: 'Local Execution',
        cloud: 'Cloud Execution',
      }[selectedMode] || 'Preview';

      const execLabel = { 
        local: 'Local', 
        cloud: 'Cloud', 
        hybrid: 'Hybrid' 
      }[detectedExecutionMode] || 'Local';

      if (!silent) {
        toast.success(`Preview ready`, {
          description: `${modeLabel} • ${execLabel} • ${Object.keys(files).length} files`,
          duration: 2000,
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

  // WebContainer URL tracking (top-level to satisfy Rules of Hooks)
  useEffect(() => {
    webcontainerUrlRef.current = webcontainerUrl;
  }, [webcontainerUrl]);

  // WebContainer cleanup on unmount (top-level to satisfy Rules of Hooks)
  useEffect(() => {
    return () => {
      if (webcontainerProcessRef.current) {
        webcontainerProcessRef.current.kill();
      }
      if (webcontainerInstanceRef.current) {
        webcontainerInstanceRef.current.destroy?.();
      }
    };
  }, []);

  // Pyodide cleanup on unmount (top-level to satisfy Rules of Hooks)
  useEffect(() => {
    return () => {
      if (pyodideRef.current) {
        pyodideRef.current = null;
      }
    };
  }, []);

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

  // Listen for open-code-preview events from message bubbles
  useEffect(() => {
    const handleOpenCodePreview = (e: CustomEvent) => {
      const { code, language } = e.detail || {};
      
      // Open the panel if not already open
      if (!isOpen) {
        toast.info('Opening code preview panel');
      }
      
      // Switch to preview tab
      setSelectedTab('preview');
      
      // For now, just show a toast - the code is available in the message
      if (code) {
        log(`[open-code-preview] Received code (${language || 'unknown'}): ${code.length} chars`);
      }
    };

    window.addEventListener('open-code-preview' as any, handleOpenCodePreview);
    return () => window.removeEventListener('open-code-preview' as any, handleOpenCodePreview);
  }, [isOpen]);

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
        await debouncedListDirectory(normalizedScope);
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

  const parsedCodeData = useMemo(() => parseCodeBlocksFromMessages(messages), [messages]);

  // Extract code blocks from messages using centralized parser
  const codeBlocks = parsedCodeData.codeBlocks;

  // Reset selectedFileIndex when codeBlocks change
  useEffect(() => {
    if (codeBlocks.length === 0) {
      setSelectedFileIndex(0);
    } else if (selectedFileIndex >= codeBlocks.length) {
      setSelectedFileIndex(0);
    }
  }, [codeBlocks.length, selectedFileIndex]);

  // Auto-load preview when user EXPLICITLY opens the panel (not on mount)
  // This prevents rate limit errors from multiple components calling listDirectory on app load
  const wasOpenRef = useRef(false);

  useEffect(() => {
    // Only trigger when panel transitions from closed → open (user action)
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      
      const autoLoadPreview = async () => {
        log('[autoLoadPreview] user opened panel, checking if files exist');

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
          } else {
            log('[autoLoadPreview] no files detected, skipping preview');
          }
        } catch (err) {
          // Silently ignore rate limit errors - user can manually refresh
          if (err instanceof Error && err.message.includes('rate limit')) {
            log('[autoLoadPreview] rate limited, skipping preview check');
          } else {
            logError('[autoLoadPreview] failed to check for files', err);
          }
        }
      };

      autoLoadPreview();
    } else if (!isOpen) {
      // Reset when panel closes so it can auto-load again on next open
      wasOpenRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Only trigger on open/close transitions

  // Files explorer - run regardless of isOpen to keep VFS synced
  useEffect(() => {
    if (selectedTab !== "files") {
      return;
    }
    // Always sync VFS regardless of isOpen - needed for shell on-demand commands
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

  // Load scoped preview files - sync VFS regardless of isOpen state
  useEffect(() => {
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
  const pendingRefreshRef = useRef(false);

  useEffect(() => {
    filesystemCurrentPathRef.current = filesystemCurrentPath;
  }, [filesystemCurrentPath]);

  useEffect(() => {
    filesystemScopePathRef.current = filesystemScopePath;
  }, [filesystemScopePath]);

  // Debounce ref for directory listing to prevent polling storms
  const lastDirectoryListRef = useRef<{ path: string; timestamp: number } | null>(null);
  const DIRECTORY_LIST_DEBOUNCE_MS = 1000;

  // Debounced list directory function to prevent excessive API calls
  const debouncedListDirectory = useCallback(async (path: string) => {
    const now = Date.now();
    const last = lastDirectoryListRef.current;

    if (last && last.path === path && (now - last.timestamp) < DIRECTORY_LIST_DEBOUNCE_MS) {
      log(`[debouncedListDirectory] skipping duplicate call for "${path}" (${now - last.timestamp}ms since last)`);
      return;
    }

    lastDirectoryListRef.current = { path, timestamp: now };
    await listFilesystemDirectory(path);
  }, [listFilesystemDirectory, log]);

  // Assign to ref so openFilesystemDirectory can access it
  // NOTE: Don't add debouncedListDirectory to deps - causes infinite loop
  useEffect(() => {
    debouncedListDirectoryRef.current = debouncedListDirectory;
  }, []); // Empty deps - ref assignment doesn't need to re-run

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
      
      // Reset debounce on navigation
      lastDirectoryListRef.current = null;
      
      previousScopePathRef.current = filesystemScopePath;
    }
  }, [filesystemScopePath, log]);

  // Bidirectional sync: Event-driven refresh from terminal/editor updates
  // Always register listener regardless of isOpen - needed for on-demand shell commands
  useEffect(() => {
    const refresh = async (detail?: any) => {
      log(`[filesystem-updated event] received`, detail);

      // Skip expensive network fetches when panel is closed — defer until re-open
      if (!isOpen) {
        pendingRefreshRef.current = true;
        log(`[filesystem-updated] panel closed, deferring refresh`);
        return;
      }

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
        await debouncedListDirectory(normalizedScopePath);
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
          // Only update if content actually changed to prevent infinite loops
          setScopedPreviewFiles((prev) => {
            const prevKeys = Object.keys(prev);
            const newKeys = Object.keys(files);
            if (prevKeys.length !== newKeys.length) return files;
            const hasChanges = newKeys.some(key => prev[key] !== files[key]);
            return hasChanges ? files : prev;
          });
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

    const scheduler = createRefreshScheduler(refresh, { minIntervalMs: 5000, maxDelayMs: 10000 });
    const unsubscribe = onFilesystemUpdated((event) => scheduler.schedule(event.detail));
    log('[CodePreviewPanel] registered filesystem-updated event listener');
    return () => {
      unsubscribe();
      scheduler.dispose();
      log('[CodePreviewPanel] removed filesystem-updated event listener');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Only depend on isOpen - listener stays stable

  // Flush deferred refresh when panel re-opens
  useEffect(() => {
    if (isOpen && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      log('[CodePreviewPanel] panel opened with pending refresh, triggering now');
      const currentPath = filesystemCurrentPathRef.current || filesystemScopePathRef.current || 'project';
      void debouncedListDirectory(normalizeProjectPath(currentPath));
    }
  }, [isOpen]);

  // Generate project structure for complex projects
  // Also merge virtual filesystem files for live preview
  // NOTE: Commented out legacy codeBlock parsing - use VFS (scopedPreviewFiles) as primary source instead
  useEffect(() => {
    // Use scopedPreviewFiles from VFS as the primary source - this has real project files
    // Legacy codeBlocks parsing creates file-0.sh, file-1.js etc which pollutes the project
    /*
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
    } else if (projectFiles && Object.keys(projectFiles).length > 0) {
    */
    if (projectFiles && Object.keys(projectFiles).length > 0) {
      const structure: ProjectStructure = {
        name: 'filesystem-project',
        files: projectFiles,
        framework: 'react',
        bundler: 'vite',
        packageManager: 'npm'
      };
      setProjectStructure(structure);
    }
  }, [codeBlocks, projectFiles]);

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

    // VFS files should take priority over legacy projectStructure
    // Only use projectStructure as fallback if VFS is empty
    if (Object.keys(scopedRelativeFiles).length > 0) {
      return {
        name: 'filesystem-project',
        files: scopedRelativeFiles,
        framework: 'react',
        bundler: 'vite',
        packageManager: 'npm',
        filesystemScopePath: normalizeProjectPath(filesystemScopePath || normalizedFilesystemPath),
        dependencies: [],
        devDependencies: [],
      } as ProjectStructure;
    }

    if (projectStructure) {
      return projectStructure;
    }

    return null;
  }, [filesystemScopePath, normalizedFilesystemPath, scopedPreviewFiles, projectStructure, normalizeProjectPath]);

  // Enhanced entry point detection with framework-specific patterns
  const detectEntryFile = useCallback((filePaths: string[], framework?: string): string | null => {
    // Framework-specific entry file patterns with higher priority
    const frameworkEntryPatterns: Record<string, RegExp[]> = {
      nuxt: [/\/app\.vue$/, /\/src\/main\.(ts|js)$/, /\/pages\/index\.(vue|ts|js)$/, /\/nuxt\.config\.ts$/],
      vue: [/\/src\/main\.(ts|js)$/, /\/src\/App\.vue$/, /\/main\.(ts|js)$/, /\/App\.vue$/],
      next: [/\/src\/app\/page\.(tsx|jsx|ts|js)$/, /\/src\/app\/layout\.(tsx|jsx|ts|js)$/, /\/pages\/index\.(tsx|jsx|ts|js)$/, /\/src\/pages\/index\.(tsx|jsx|ts|js)$/],
      react: [/\/src\/index\.(tsx|jsx|ts|js)$/, /\/src\/main\.(tsx|jsx|ts|js)$/, /\/src\/App\.(tsx|jsx)$/, /\/index\.(tsx|jsx|ts|js)$/],
      svelte: [/\/src\/main\.(ts|js)$/, /\/src\/App\.svelte$/, /\/main\.(ts|js)$/],
      angular: [/\/src\/main\.(ts|js)$/, /\/src\/app\/app\.component\.(ts|js)$/],
      solid: [/\/src\/index\.(tsx|jsx)$/, /\/src\/App\.(tsx|jsx)$/],
      astro: [/\/src\/pages\/index\.astro$/, /\/pages\/index\.astro$/],
      vanilla: [/\/index\.html$/, /\/src\/index\.(js|ts)$/, /\/main\.(js|ts)$/],
    };

    const patterns = framework ? frameworkEntryPatterns[framework] : null;
    
    // Try framework-specific patterns first
    if (patterns) {
      for (const pattern of patterns) {
        const match = filePaths.find(path => pattern.test(path));
        if (match) return match;
      }
    }

    // Fallback to common entry patterns (in priority order)
    const commonPatterns = [
      /\/src\/index\.(tsx|jsx|ts|js|vue)$/,
      /\/src\/main\.(tsx|jsx|ts|js|vue)$/,
      /\/app\.vue$/,
      /\/App\.vue$/,
      /\/src\/App\.(tsx|jsx|vue)$/,
      /\/index\.(tsx|jsx|ts|js|html)$/,
      /\/main\.(tsx|jsx|ts|js)$/,
      /\/pages\/index\.(tsx|jsx|ts|js|vue)$/,
      /\/src\/pages\/index\.(tsx|jsx|ts|js|vue)$/,
      /\/src\/app\/page\.(tsx|jsx|ts|js)$/,
      /.*\.html$/,
    ];

    for (const pattern of commonPatterns) {
      const match = filePaths.find(path => pattern.test(path));
      if (match) return match;
    }

    // Last resort: return first file or null
    return filePaths[0] || null;
  }, []);

  // Detect framework from files
  const detectFrameworkFromFiles = useCallback((filePaths: string[], files: Record<string, string>): string => {
    const hasNuxtConfig = filePaths.some(p => p.includes('nuxt.config'));
    const hasNextConfig = filePaths.some(p => p.includes('next.config'));
    const hasVue = filePaths.some(p => p.endsWith('.vue'));
    const hasSvelte = filePaths.some(p => p.endsWith('.svelte'));
    const hasReact = filePaths.some(p => p.endsWith('.tsx') || p.endsWith('.jsx'));
    const hasAngular = filePaths.some(p => p.includes('.component.') || p.includes('.module.'));
    const hasAstro = filePaths.some(p => p.endsWith('.astro'));
    const hasPython = filePaths.some(p => p.endsWith('.py'));

    // Check package.json for framework detection
    const packageJsonPath = filePaths.find(p => p === 'package.json' || p.endsWith('/package.json'));
    const packageJson = packageJsonPath ? files[packageJsonPath] : '';
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next || deps['next']) return 'next';
        if (deps.nuxt || deps['@nuxt/core']) return 'nuxt';
        if (deps.vue || deps['@vue/core']) return 'vue';
        if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
        if (deps.react) return 'react';
        if (deps['@angular/core']) return 'angular';
        if (deps.astro) return 'astro';
      } catch {}
    }

    if (hasNuxtConfig) return 'nuxt';
    if (hasNextConfig) return 'next';
    if (hasAstro) return 'astro';
    if (hasAngular) return 'angular';
    if (hasSvelte) return 'svelte';
    if (hasVue) return 'vue';
    if (hasReact) return 'react';
    if (hasPython) return 'python';

    return 'vanilla';
  }, []);

  // Memoize scopedPreviewFiles serialization to prevent visualEditorProjectData recalculation
  const scopedPreviewFilesSerialized = useMemo(() => {
    return JSON.stringify(
      Object.entries(scopedPreviewFiles || {}).sort(([a], [b]) => a.localeCompare(b))
    );
  }, [scopedPreviewFiles]);

  // Track last logged visualEditorProjectData to prevent spam
  const lastLoggedProjectDataRef = useRef<string>('');

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

    // Detect framework from files
    const detectedFramework = detectFrameworkFromFiles(filePaths, files);

    // Infer bundler from config files or package.json
    const inferredBundler = structure.bundler
      || (filePaths.some((p) => p.includes('vite.config')) || packageJsonContent.includes('"vite"') ? 'vite'
        : filePaths.some((p) => p.includes('webpack.config')) || packageJsonContent.includes('"webpack"') ? 'webpack'
          : filePaths.some((p) => p.includes('parcel') || p.endsWith('.parcelrc')) || packageJsonContent.includes('"parcel"') ? 'parcel'
            : filePaths.some((p) => p.includes('next.config')) || packageJsonContent.includes('"next"') || filePaths.some((p) => p.startsWith('pages/') || p.startsWith('app/')) ? 'nextjs'
              : undefined);

    // Use enhanced entry file detection with framework awareness
    const entryFile = detectEntryFile(filePaths, detectedFramework);

    // Infer preview mode hint
    const nextJsInPackageJson = packageJsonContent && packageJsonContent.includes('"next"');
    const nextJsConfig = filePaths.some((p) => p.includes('next.config'));
    const nextJsPagesOrApp = filePaths.some((p) => p.startsWith('pages/') || p.startsWith('app/'));

    const previewModeHint =
      inferredBundler === 'vite' ? 'vite'
      : inferredBundler === 'webpack' ? 'webpack'
      : inferredBundler === 'parcel' ? 'parcel'
      : nextJsConfig || nextJsInPackageJson || nextJsPagesOrApp ? 'nextjs'
      : filePaths.some((p) => ['server.js', 'app.js', 'index.js'].includes(p) && packageJsonContent) ? 'webcontainer'
      : filePaths.some((p) => p === 'Dockerfile' || p === 'docker-compose.yml') ? 'codesandbox'
      : filePaths.some((p) => p.endsWith('.html')) ? 'iframe'
      : filePaths.some((p) => p.endsWith('.py')) ? 'pyodide'
      : 'sandpack';

    const result = {
      ...structure,
      filesystemScopePath: normalizeProjectPath(filesystemScopePath || normalizedFilesystemPath),
      bundler: inferredBundler,
      entryFile,
      previewModeHint,
    };

    // Log only when project data changes (prevent spam)
    const logKey = `${inferredBundler}-${entryFile}-${previewModeHint}`;
    if (lastLoggedProjectDataRef.current !== logKey) {
      lastLoggedProjectDataRef.current = logKey;
      log(`[visualEditorProjectData] bundler="${inferredBundler}", entryFile="${entryFile}", previewModeHint="${previewModeHint}"`);
    }

    return result;
  }, [
    filesystemScopePath, 
    normalizeProjectPath, 
    normalizedFilesystemPath, 
    projectFiles, 
    projectStructure, 
    projectStructureWithScopedFiles,
    scopedPreviewFilesSerialized,
    detectEntryFile,
    detectFrameworkFromFiles
  ]);

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

  // ============================================================================
  // Auto-redirect for Vite/Webpack modes to Sandpack
  // ============================================================================
  useEffect(() => {
    if (previewMode === 'vite' || previewMode === 'webpack') {
      const timer = setTimeout(() => {
        setPreviewMode('sandpack');
        toast.info(`Redirected to Sandpack for instant ${previewMode === 'vite' ? 'Vite-compatible' : 'bundling'} preview`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [previewMode]);

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

  // Refs for preventing log spam in renderLivePreview
  const sandpackLogKeyRef = useRef<string>('');

  const renderLivePreview = () => {
    // Use manual preview files if active, otherwise use auto-detected structure (must be defined FIRST)
    // CRITICAL: For manual preview, use projectDetection.normalizedFiles which are already properly normalized
    // Do NOT use manualPreviewFiles directly - those are pre-normalization and will be double-normalized
    const useStructure = isManualPreviewActive && projectDetection?.normalizedFiles
      ? {
          name: 'Manual Preview',
          files: projectDetection.normalizedFiles,
          framework: projectDetection.framework as AppFramework,
        }
      : (isManualPreviewActive && manualPreviewFiles
        ? {
            name: 'Manual Preview',
            files: manualPreviewFiles,
            framework: 'react' as AppFramework,
          }
        : (projectStructureWithScopedFiles || projectStructure));

    // Use centralized framework detection from live-preview-offloading
    // If projectDetection exists (from handleManualPreview), use it; otherwise compute from structure
    // CRITICAL: Only use projectDetection when manual preview is active to avoid stale framework detection
    const effectiveFramework = isManualPreviewActive && projectDetection?.framework
      ? projectDetection.framework
      : useStructure?.framework || 'vanilla';
    
    // Get template using centralized mapping
    const getSandpackTemplate = (framework: string) => {
      const config = getSandpackConfig({ framework: framework as any, bundler: 'unknown', normalizedFiles: {} } as any);
      return config.template;
    };

    // ============================================================================
    // Improved Dependency Detection - Parse package.json properly
    // ============================================================================
    const getDependencies = (): Record<string, string> => {
      // PRIORITY 1: Parse package.json if available
      const packageJsonPath = useStructure?.files && Object.keys(useStructure.files).find(
        path => path.endsWith('package.json')
      );

      if (packageJsonPath && useStructure?.files) {
        try {
          const pkgContent = useStructure.files[packageJsonPath];
          if (typeof pkgContent === 'string' && pkgContent.trim()) {
            const pkg = JSON.parse(pkgContent);
            const deps: Record<string, string> = {};

            // Add all dependencies with 'latest' version
            if (pkg.dependencies && typeof pkg.dependencies === 'object') {
              Object.keys(pkg.dependencies).forEach(dep => {
                if (dep && typeof dep === 'string') {
                  deps[dep] = 'latest';
                }
              });
            }
            if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
              Object.keys(pkg.devDependencies).forEach(dep => {
                if (dep && typeof dep === 'string' && !deps[dep]) {
                  deps[dep] = 'latest';
                }
              });
            }

            // Return parsed dependencies if we found any
            if (Object.keys(deps).length > 0) {
              return deps;
            }
          }
        } catch (parseError) {
          console.warn('[CodePreview] Failed to parse package.json:', parseError);
          // Fall through to regex detection
        }
      }

      // PRIORITY 2: Fallback to regex-based detection from code content
      const deps = (useStructure as any)?.dependencies?.reduce(
        (acc: Record<string, string>, dep: string) => {
          if (dep && typeof dep === 'string') {
            acc[dep] = "latest";
          }
          return acc;
        },
        {} as Record<string, string>,
      ) || getPopularDependencies(
        Object.values(useStructure?.files || {}).filter(Boolean).join("\n"),
        useStructure?.framework || 'vanilla',
      );

      // Add vue-router if project has router files but doesn't include it
      const hasVueRouter = useStructure?.files && Object.keys(useStructure.files).some(path => {
        const lowerPath = path.toLowerCase();
        return lowerPath.includes('router/') ||
               lowerPath.includes('router.') ||
               lowerPath.endsWith('router.js') ||
               lowerPath.endsWith('router.ts') ||
               lowerPath.endsWith('router/index.js') ||
               lowerPath.endsWith('router/index.ts');
      });

      if (hasVueRouter && !deps['vue-router']) {
        deps['vue-router'] = 'latest';
      }

      return deps;
    };
    
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
      ].includes(effectiveFramework)
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

            // Remove leading slash - Sandpack expects relative paths
            const sandpackPath = path.replace(/^\/+/, '');

            acc[sandpackPath] = { code: transformedContent };
            return acc;
          },
          {} as Record<string, { code: string }>,
        );

        // Framework-specific entry file detection and handling
        const addEntryFileIfMissing = () => {
          // Define framework-specific entry file priorities (relative paths without leading slash)
          const entryPriorityMap: Record<string, string[]> = {
            react: ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'src/App.tsx', 'src/App.jsx', 'index.tsx', 'index.jsx', 'App.tsx', 'App.jsx'],
            next: ['src/app/page.tsx', 'src/app/page.jsx', 'pages/index.tsx', 'pages/index.jsx', 'src/pages/index.tsx', 'src/pages/index.jsx', 'src/index.tsx'],
            vue: ['src/main.ts', 'src/main.js', 'src/App.vue', 'main.ts', 'main.js', 'index.ts', 'index.js'],
            nuxt: ['src/main.ts', 'src/main.js', 'src/App.vue', 'app.vue', 'pages/index.ts', 'pages/index.js'],
            svelte: ['src/main.ts', 'src/main.js', 'src/App.svelte', 'App.svelte', 'main.ts', 'main.js'],
            angular: ['src/main.ts', 'src/main.js', 'src/app/app.component.ts', 'src/app/app.component.js'],
            solid: ['src/index.tsx', 'src/index.jsx', 'src/App.tsx', 'src/App.jsx', 'index.tsx', 'index.jsx'],
            astro: ['src/pages/index.astro', 'pages/index.astro', 'index.astro'],
            remix: ['app/routes/_index.tsx', 'app/routes/_index.jsx', 'app/root.tsx', 'app/root.jsx'],
            gatsby: ['src/pages/index.js', 'src/pages/index.tsx', 'pages/index.js'],
          };

          const framework = effectiveFramework;
          const priorities = entryPriorityMap[framework] || [];
          
          // Check if any of the priority entry files exist
          const existingEntryFile = priorities.find(p => 
            Object.keys(sandpackFiles).some(path => path === p || path.endsWith(p))
          );

          if (existingEntryFile) {
            log(`[addEntryFileIfMissing] Found existing entry file: ${existingEntryFile}`);
            return; // Entry file exists, don't add stub
          }

          // Check for any existing entry-like files (more permissive for user projects)
          const hasRealEntryFile = Object.keys(sandpackFiles).some(path => {
            const fileName = path.split('/').pop() || '';
            return /^index\.(js|jsx|ts|tsx|mjs|cjs)$/.test(fileName) ||
                   /^main\.(js|jsx|ts|tsx|mjs|cjs)$/.test(fileName) ||
                   /^App\.(js|jsx|ts|tsx)$/.test(fileName) ||
                   /^page\.(js|jsx|ts|tsx)$/.test(fileName);
          });

          if (hasRealEntryFile) {
            log(`[addEntryFileIfMissing] Found entry-like file, not adding stub`);
            return;
          }

          // No entry file found - add framework-specific stub
          log(`[addEntryFileIfMissing] No entry file found, adding stub for ${framework}`);

          switch (framework) {
            case "react":
            case "next":
            case "gatsby":
              // Use index.tsx as entry for React/Next.js projects
              sandpackFiles["src/index.tsx"] = {
                code: `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div className="App">
      <h1>Hello React!</h1>
      <p>This is a generated React application.</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`,
              };
              sandpackFiles["index.html"] = {
                code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="src/index.tsx"></script>
  </body>
</html>`,
              };
              break;
            case "vue":
            case "nuxt":
              sandpackFiles["src/App.vue"] = {
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
              sandpackFiles["src/main.ts"] = {
                code: `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');`,
              };
              sandpackFiles["index.html"] = {
                code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="src/main.ts"></script>
  </body>
</html>`,
              };
              break;
            case "svelte":
              sandpackFiles["src/App.svelte"] = {
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
              sandpackFiles["src/main.ts"] = {
                code: `import App from './App.svelte';
const app = new App({ target: document.getElementById('app') });
export default app;`,
              };
              sandpackFiles["index.html"] = {
                code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="src/main.ts"></script>
  </body>
</html>`,
              };
              break;
            default:
              // vanilla or unknown framework - use index.js
              sandpackFiles["src/index.js"] = {
                code: `console.log('Hello from ${framework}!');`,
              };
              sandpackFiles["index.html"] = {
                code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="src/index.js"></script>
  </body>
</html>`,
              };
          }
        };

        // Handle build output directories (dist, build, .next, etc.)
        const normalizeFilesForSandpack = (files: Record<string, { code: string }>) => {
          const normalized: Record<string, { code: string }> = {};
          const buildDirs = ['dist', 'build', '.next', '.nuxt', '.output', 'public'];
          
          for (const [path, fileObj] of Object.entries(files)) {
            let content = fileObj?.code || '';
            
            // Skip build output files - they shouldn't be in source
            const isBuildOutput = buildDirs.some(dir => path.startsWith(dir + '/') || path.startsWith('/' + dir + '/'));
            if (isBuildOutput) continue;
            
            // Skip node_modules
            if (path.includes('node_modules/')) continue;
            
            // Skip map files and source maps
            if (path.endsWith('.map') || path.includes('.map')) continue;
            
            // Skip cache directories
            if (path.includes('.cache/') || path.includes('__pycache__/')) continue;
            
            if (typeof content === 'string' && content.trim()) {
              // Strip leaked heredoc markers (<<<, >>>) from WRITE command artifacts
              content = content.replace(/^\s*<<<\s*\n?/, '').replace(/\n?\s*>>>\s*$/, '');
              
              // For JSON files, validate and fix content to prevent Sandpack parse errors
              if (path.endsWith('.json') || path.endsWith('.json5')) {
                try {
                  JSON.parse(content);
                } catch {
                  // Try to extract valid JSON from corrupted content
                  const jsonStart = content.indexOf('{');
                  const jsonEnd = content.lastIndexOf('}');
                  if (jsonStart >= 0 && jsonEnd > jsonStart) {
                    const extracted = content.slice(jsonStart, jsonEnd + 1);
                    try {
                      JSON.parse(extracted);
                      content = extracted;
                    } catch {
                      // Still invalid — skip this file to prevent Sandpack crash
                      continue;
                    }
                  } else {
                    continue;
                  }
                }
              }

              // Remove leading slash - Sandpack expects relative paths
              const sandpackPath = path.replace(/^\/+/, '');
              normalized[sandpackPath] = { code: content };
            }
          }
          return normalized;
        };

        // Enhanced entry file detection with comprehensive patterns
        const detectBestEntryFile = (
          files: Record<string, { code: string }>,
          framework: string
        ): string | null => {
          // Framework-specific entry file patterns (paths are now relative without leading slash)
          const entryPatterns: Record<string, RegExp[]> = {
            react: [
              /^src\/index\.(tsx|jsx|ts|js)$/,
              /^src\/main\.(tsx|jsx|ts|js)$/,
              /^src\/App\.(tsx|jsx)$/,
              /^index\.(tsx|jsx)$/,
              /^main\.(tsx|jsx)$/,
            ],
            next: [
              /^src\/app\/page\.(tsx|jsx|ts|js)$/,
              /^src\/app\/layout\.(tsx|jsx|ts|js)$/,
              /^pages\/index\.(tsx|jsx|ts|js)$/,
              /^src\/pages\/index\.(tsx|jsx|ts|js)$/,
            ],
            vue: [
              /^src\/main\.(ts|js)$/,
              /^src\/App\.vue$/,
              /^main\.(ts|js)$/,
              /^App\.vue$/,
            ],
            nuxt: [
              /^src\/main\.(ts|js)$/,
              /^app\.vue$/,
              /^pages\/index\.(ts|js)$/,
            ],
            svelte: [
              /^src\/main\.(ts|js)$/,
              /^src\/App\.svelte$/,
              /^main\.(ts|js)$/,
            ],
            angular: [
              /^src\/main\.(ts|js)$/,
              /^src\/app\/app\.component\.(ts|js)$/,
            ],
            solid: [
              /^src\/index\.(tsx|jsx)$/,
              /^src\/App\.(tsx|jsx)$/,
            ],
            astro: [
              /^src\/pages\/index\.astro$/,
              /^pages\/index\.astro$/,
              /^index\.astro$/,
            ],
            vite: [
              /^src\/main\.(ts|js|tsx|jsx)$/,
              /^src\/index\.(ts|js|tsx|jsx)$/,
              /^main\.(ts|js)$/,
            ],
          };

          const patterns = entryPatterns[framework] || entryPatterns.react;
          
          for (const pattern of patterns) {
            const match = Object.keys(files).find(path => pattern.test(path));
            if (match) return match;
          }
          
          return null;
        };

        // Apply normalization to filter build outputs and cache files
        const normalizedSandpackFiles = normalizeFilesForSandpack(sandpackFiles);

        // Detect best entry file (log only when changed to prevent spam)
        const detectedEntryFile = detectBestEntryFile(normalizedSandpackFiles, effectiveFramework);
        if (detectedEntryFile && sandpackLogKeyRef.current !== detectedEntryFile) {
          sandpackLogKeyRef.current = detectedEntryFile;
          log(`[Sandpack] Detected entry file: ${detectedEntryFile}`);
        }

        // Build sandpackFiles based on whether this is manual preview or auto-detected
        let baseSandpackFiles: Record<string, { code: string }>;

        if (isManualPreviewActive && projectDetection?.normalizedFiles) {
          // For manual preview, use pre-normalized files from detectProject
          // These are already properly formatted for Sandpack - no need to re-process
          baseSandpackFiles = {};
          for (const [path, content] of Object.entries(projectDetection.normalizedFiles)) {
            if (typeof content === 'string' && content.trim()) {
              // Remove leading slash - Sandpack expects relative paths
              const sandpackPath = path.replace(/^\/+/, '');
              baseSandpackFiles[sandpackPath] = { code: content };
            }
          }
          log(`[Sandpack] Using pre-normalized files from detectProject:`, Object.keys(baseSandpackFiles).slice(0, 10));
        } else if (isManualPreviewActive && manualPreviewFiles) {
          // For manual preview without normalizedFiles, use manualPreviewFiles (already root-relative)
          baseSandpackFiles = {};
          for (const [path, content] of Object.entries(manualPreviewFiles)) {
            if (typeof content === 'string' && content.trim()) {
              // Remove leading slash - Sandpack expects relative paths
              const sandpackPath = path.replace(/^\/+/, '');
              baseSandpackFiles[sandpackPath] = { code: content };
            }
          }
          log(`[Sandpack] Using manual preview files (root-relative):`, Object.keys(baseSandpackFiles).slice(0, 10));
        } else {
          // For auto-detected projects, use the normalized sandpackFiles from earlier
          baseSandpackFiles = normalizedSandpackFiles;
        }

        // CRITICAL FIX: Normalize file paths to be relative to project root for Sandpack
        // The VFS paths are like "/project/sessions/draft-chat_xxx/src/main.js" but Sandpack needs "/src/main.js"
        // We need to strip the filesystem scope prefix from all file paths
        const finalSandpackFiles = (() => {
          // Create a copy of baseSandpackFiles to work with
          const filesCopy = { ...baseSandpackFiles };

          // Add entry file stub if missing (using same logic as addEntryFileIfMissing but as pure function)
          const existingEntryFile = Object.keys(filesCopy).some(path => {
            const fileName = path.split('/').pop() || '';
            return /^index\.(js|jsx|ts|tsx|mjs|cjs|vue)$/.test(fileName) ||
                   /^main\.(js|jsx|ts|tsx|mjs|cjs|vue)$/.test(fileName) ||
                   /^App\.(js|jsx|ts|tsx|vue)$/.test(fileName) ||
                   /^page\.(js|jsx|ts|tsx)$/.test(fileName);
          });

          if (!existingEntryFile) {
            // Add framework-specific stub files
            const framework = effectiveFramework;
            switch (framework) {
              case "vue":
              case "nuxt":
                filesCopy["src/App.vue"] = { code: `<template>
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
</style>` };
                filesCopy["src/main.js"] = { code: `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');` };
                filesCopy["index.html"] = { code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="src/main.js"></script>
  </body>
</html>` };
                break;
              case "react":
              case "next":
              case "vite-react":
              default:
                filesCopy["src/index.jsx"] = { code: `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div className="App">
      <h1>Hello React!</h1>
      <p>This is a generated React application.</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);` };
                filesCopy["index.html"] = { code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="src/index.jsx"></script>
  </body>
</html>` };
                break;
            }
          }

          // For auto-detected projects (not manual preview), strip scope prefix and project subfolders
          // Manual preview files are already normalized, so skip this step
          if (!isManualPreviewActive) {
            // Step 1: Normalize (filter build outputs, cache files, etc.)
            const normalized = normalizeFilesForSandpack(filesCopy);

            // Step 2: Strip any leading project folder to get paths relative to project root
            // Files at this point are like: "/my-vue-app/src/main.js" or "/src/main.js" or "/index.html"
            // We need them to be: "/src/main.js" or "/index.html" (relative to project root for Sandpack)
            const stripped: Record<string, { code: string }> = {};

            // Common project subfolder names that indicate the preceding folder is a project root
            const projectSubfolderPatterns = [
              /^\/([^/]+)\/src\//,      // /my-app/src/...
              /^\/([^/]+)\/pages\//,    // /my-app/pages/...
              /^\/([^/]+)\/app\//,      // /my-app/app/...
              /^\/([^/]+)\/public\//,   // /my-app/public/...
              /^\/([^/]+)\/lib\//,      // /my-app/lib/...
              /^\/([^/]+)\/components\//, // /my-app/components/...
              /^\/([^/]+)\/styles\//,   // /my-app/styles/...
              /^\/([^/]+)\/assets\//,   // /my-app/assets/...
            ];

            // Strip VFS scope prefix (e.g. /project/sessions/draft-chat_xxx/)
            const scopePrefix = normalizeProjectPath(filesystemScopePath || normalizedFilesystemPath);

            for (const [path, fileObj] of Object.entries(normalized)) {
              let relativePath = path;

              // First, ensure path has leading slash for consistent handling
              if (!relativePath.startsWith('/')) {
                relativePath = '/' + relativePath;
              }

              // Strip VFS scope prefix first (e.g. /project/sessions/draft-chat_xxx/my-vue-app/src/main.js -> /my-vue-app/src/main.js)
              // Try both with and without leading slash variants
              const prefixVariants = [
                `/${scopePrefix}/`,
                `${scopePrefix}/`,
                `/project/sessions/`,
              ];
              for (const prefix of prefixVariants) {
                if (relativePath.startsWith(prefix)) {
                  relativePath = relativePath.slice(prefix.length);
                  // If we stripped a sessions prefix, also strip the session ID folder
                  if (prefix === '/project/sessions/' || prefix === 'project/sessions/') {
                    const slashIdx = relativePath.indexOf('/');
                    if (slashIdx > 0) {
                      relativePath = relativePath.slice(slashIdx);
                    }
                  }
                  break;
                }
              }

              // Try to strip leading project folder if path contains a known subfolder pattern
              // e.g., /my-vue-app/src/main.js -> /src/main.js
              for (const pattern of projectSubfolderPatterns) {
                const match = relativePath.match(pattern);
                if (match) {
                  const projectFolder = match[1];
                  // Don't strip if the "project folder" is actually a standard folder name
                  if (!['src', 'pages', 'app', 'public', 'lib', 'components', 'styles', 'assets'].includes(projectFolder)) {
                    relativePath = relativePath.replace(`/${projectFolder}/`, '/');
                    break;
                  }
                }
              }

              // Ensure path starts with /
              if (!relativePath.startsWith('/')) {
                relativePath = '/' + relativePath;
              }

              stripped[relativePath] = fileObj;
            }

            // Log normalization results
            const resultKey = `${Object.keys(stripped).length}-${Object.keys(stripped).sort().join('|').slice(0, 50)}`;
            if (resultKey !== lastNormalizationRef.current) {
              log(`[Sandpack] Normalized ${Object.keys(filesCopy).length} -> ${Object.keys(normalized).length} (filtered) -> ${Object.keys(stripped).length} (scope strip)`);
              lastNormalizationRef.current = resultKey;
            }

            return stripped;
          }

          // For manual preview, files are already root-relative (stripped in handleManualPreview)
          // Just apply normalizeFilesForSandpack filtering (removes build outputs, cache files, etc.)
          const normalized = normalizeFilesForSandpack(filesCopy);
          const resultKey = `${Object.keys(normalized).length}-${Object.keys(normalized).sort().join('|').slice(0, 50)}`;
          if (resultKey !== lastNormalizationRef.current) {
            log(`[Sandpack] Manual preview: ${Object.keys(normalized).length} files (root-relative, no scope stripping)`);
            lastNormalizationRef.current = resultKey;
          }
          return normalized;
        })();

        const template = getSandpackTemplate(effectiveFramework) as any;

        // Sandpack preview mode - for BOTH manual and auto-detected projects
        // This is the primary preview mode for framework-based projects
        if (previewMode === 'sandpack') {
          const sandpackFiles: Record<string, { code: string }> = {};

          // Add all files to Sandpack - useStructure.files is already normalized
          // (paths are relative to project root, e.g., /src/App.tsx)
          Object.entries(useStructure.files).forEach(([path, content]) => {
            if (typeof content === "string" && content.trim()) {
              // Ensure path starts with / (normalization should already do this)
              const normalizedPath = path.startsWith("/") ? path : `/${path}`;
              sandpackFiles[normalizedPath] = { code: content };
            }
          });

          // Get template from project detection (uses FRAMEWORK_TO_TEMPLATE mapping)
          const activeTemplate = isManualPreviewActive && projectDetection?.framework
            ? getSandpackTemplate(projectDetection.framework)
            : template;

          // Debug: Log if no files detected
          if (Object.keys(sandpackFiles).length === 0) {
            log('[Sandpack] WARNING: No files to render - useStructure.files is empty or all files are empty strings');
            log('[Sandpack] useStructure:', {
              hasUseStructure: !!useStructure,
              filesCount: Object.keys(useStructure?.files || {}).length,
              framework: useStructure?.framework,
              isManualPreviewActive
            });
          }

          return (
            <Suspense fallback={
              <div className="h-full flex items-center justify-center bg-gray-900 rounded-lg">
                <div className="text-center text-gray-400">
                  <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  <p>Loading {effectiveFramework} preview...</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Template: {activeTemplate} • {Object.keys(sandpackFiles).length} files
                  </p>
                </div>
              </div>
            }>
              <PreviewErrorBoundary framework={effectiveFramework}>
                <div className="h-full bg-gray-900 rounded-lg overflow-hidden flex flex-col">
                  <div className="bg-purple-900 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">⚛️ {effectiveFramework.toUpperCase()} Preview</span>
                      <span className="text-purple-300 text-xs">{Object.keys(sandpackFiles).length} files • {activeTemplate}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewMode('raw')}
                        className="text-xs bg-purple-800 hover:bg-purple-700 text-white"
                      >
                        View Raw
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
                  <div className="flex-1 overflow-hidden">
                    {Object.keys(sandpackFiles).length > 0 ? (
                      <Sandpack
                        template={activeTemplate as any}
                        theme="dark"
                        options={{
                          showTabs: true,
                          showLineNumbers: false,
                          showNavigator: true,
                          showConsole: true,
                          showRefreshButton: true,
                          autorun: true,
                          recompileMode: "delayed",
                          recompileDelay: 500,
                          // CORS fix: Use configurable CDN source for bundler resources
                          // Sandpack loads bundler from CDN, which may be blocked by CORS/firewalls
                          // Can be overridden via NEXT_PUBLIC_SANDBPACK_BUNDLER_URL env variable
                          bundlerURL: process.env.NEXT_PUBLIC_SANDBPACK_BUNDLER_URL || 'https://sandpack-bundler.codeSandbox.io',
                        }}
                        files={sandpackFiles}
                        customSetup={{
                          dependencies: (projectDetection as any)?.dependencies?.reduce(
                            (acc: Record<string, string>, dep: string) => { acc[dep] = "latest"; return acc; },
                            {} as Record<string, string>
                          ) || {},
                        }}

                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400">
                        <div className="text-center">
                          <p className="text-sm mb-2">No files to preview</p>
                          <p className="text-xs text-gray-500">
                            Framework: {effectiveFramework} • Template: {activeTemplate}
                          </p>
                          <p className="text-xs text-yellow-500 mt-2">
                            {isManualPreviewActive ? 'Manual preview active but empty' : 'Auto-detect found no files'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </PreviewErrorBoundary>
            </Suspense>
          );
        }

        // Manual preview with HTML files - use Sandpack for proper bundling
        if (isManualPreviewActive && previewMode === 'iframe') {
          const htmlFileEntry = Object.entries(useStructure.files).find(
            ([path]) => path.endsWith('.html')
          );

          if (htmlFileEntry) {
            // Use Sandpack with vanilla template for proper HTML/CSS/JS bundling
            const sandpackFiles: Record<string, { code: string }> = {};

            // Add all files to Sandpack
            Object.entries(useStructure.files).forEach(([path, content]) => {
              if (typeof content === "string" && content.trim()) {
                // Remove leading slash - Sandpack expects relative paths
                const sandpackPath = path.replace(/^\/+/, '');
                sandpackFiles[sandpackPath] = { code: content };
              }
            });

            return (
              <Suspense fallback={
                <div className="h-full flex items-center justify-center bg-gray-900 rounded-lg">
                  <div className="text-center text-gray-400">
                    <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                    <p>Loading HTML preview...</p>
                  </div>
                </div>
              }>
                <div className="h-full bg-black/40 backdrop-blur-xl rounded-xl overflow-hidden flex flex-col border border-white/10">
                  <div className="bg-gradient-to-r from-black/80 via-black/60 to-black/80 backdrop-blur-sm px-4 py-2.5 flex items-center justify-between border-b border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-white/90 text-sm font-medium tracking-wide">HTML Preview</span>
                      <span className="text-white/40 text-xs">•</span>
                      <span className="text-white/50 text-xs">Bundled</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPreviewMode('raw')}
                        className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all duration-200 backdrop-blur-sm"
                      >
                        View Source
                      </button>
                      <button
                        onClick={() => setPreviewMode('sandpack')}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-emerald-500/80 to-teal-500/80 hover:from-emerald-400 hover:to-teal-400 rounded-lg transition-all duration-200 shadow-lg shadow-emerald-500/20 border border-emerald-500/30"
                      >
                        Live Preview
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Sandpack
                      template="vanilla"
                      theme="dark"
                      options={{
                        showTabs: true,
                        showLineNumbers: false,
                        showNavigator: true,
                        showConsole: false,
                        showRefreshButton: true,
                        autorun: true,
                        recompileMode: "delayed",
                        recompileDelay: 300,
                      }}
                files={sandpackFiles}
                      customSetup={{ dependencies: {} }}
                    />
                  </div>
                </div>
              </Suspense>
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
                      Preview
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
                sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups allow-downloads"
                referrerPolicy="no-referrer"
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
          if (pythonFiles.length > 0) {
            runtime = 'python';
          }

          // Function to create DevBox
          const startDevBox = async () => {
            setIsCodesandboxLoading(true);
            setCodesandboxUrl(null);

            try {
              log('[DevBox] Creating cloud dev environment...');

              // Call API to create CodeSandbox devbox
              const response = await fetch('/api/sandbox/devbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  files: useStructure.files,
                  template: runtime === 'python' ? 'python' : 'node',
                }),
              });

              // Check content type before parsing JSON
              const contentType = response.headers.get('content-type');
              if (!contentType?.includes('application/json')) {
                // Response is likely HTML error page
                const text = await response.text();
                throw new Error(
                  `Server returned ${response.status} ${response.statusText} (not JSON). ` +
                  `This may indicate a server error or maintenance.`
                );
              }

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.error || `Failed to create CodeSandbox environment (${response.status})`;
                throw new Error(errorMsg);
              }

              const data = await response.json();
              const sandboxUrl = data.url || `https://${data.sandboxId}.csb.app`;

              setCodesandboxUrl(sandboxUrl);
              log(`[DevBox] DevBox ready: ${sandboxUrl}`);
              toast.success('DevBox environment created successfully');
            } catch (err: any) {
              logError('[DevBox] Error:', err);
              toast.error('DevBox creation failed', {
                description: err.message,
                duration: 5000,
              });
              setCodesandboxUrl(`Error: ${err.message}`);
            } finally {
              setIsCodesandboxLoading(false);
            }
          };

          return (
            <div className="h-full bg-black/40 backdrop-blur-xl rounded-xl overflow-hidden flex flex-col border border-white/10">
              <div className="bg-gradient-to-r from-black/80 via-black/60 to-black/80 backdrop-blur-sm px-4 py-2.5 flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${isCodesandboxLoading ? 'bg-amber-500 animate-pulse' : 'bg-cyan-500'}`} />
                  <span className="text-white/90 text-sm font-medium tracking-wide">Cloud DevBox</span>
                  <span className="text-white/40 text-xs">•</span>
                  <span className="text-white/50 text-xs">{runtime || 'Auto'}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={startDevBox}
                    disabled={isCodesandboxLoading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-cyan-500/80 to-blue-500/80 hover:from-cyan-400 hover:to-blue-400 disabled:from-gray-600 disabled:to-gray-700 rounded-lg transition-all duration-200 shadow-lg shadow-cyan-500/20 border border-cyan-500/30 disabled:cursor-not-allowed"
                  >
                    {isCodesandboxLoading ? 'Starting...' : 'Start DevBox'}
                  </button>
                  <button
                    onClick={() => setPreviewMode('sandpack')}
                    className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all duration-200 backdrop-blur-sm"
                  >
                    Local Preview
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="p-3 bg-black/60 border-b border-white/10">
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-white/40 uppercase tracking-wider text-[10px]">Runtime</span>
                      <span className="text-white/80 font-medium">{runtime || 'Auto-detect'}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-white/40 uppercase tracking-wider text-[10px]">Files</span>
                      <span className="text-white/80 font-medium">{Object.keys(useStructure.files).length}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-white/40 uppercase tracking-wider text-[10px]">Python</span>
                      <span className="text-white/80 font-medium">{pythonFiles.length} files</span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex items-center justify-center p-8">
                  {isCodesandboxLoading ? (
                    <div className="text-center space-y-6">
                      <div className="w-20 h-20 mx-auto bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-cyan-500/30">
                        <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-white text-lg font-medium">Starting DevBox</h3>
                        <p className="text-white/60 text-sm max-w-md">
                          Setting up cloud development environment...
                        </p>
                        <p className="text-white/40 text-xs">
                          This may take 30-60 seconds
                        </p>
                      </div>
                    </div>
                  ) : codesandboxUrl ? (
                    codesandboxUrl.startsWith('http') ? (
                      <div className="w-full h-full flex flex-col">
                        <div className="mb-2 text-blue-400 flex items-center justify-between px-4">
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
                      <div className="text-center space-y-4">
                        <AlertCircle className="w-12 h-12 mx-auto text-red-400" />
                        <p className="text-red-400">{codesandboxUrl}</p>
                        <Button onClick={startDevBox} variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800">
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Retry
                        </Button>
                      </div>
                    )
                  ) : (
                    <div className="text-center space-y-4">
                      <div className="w-20 h-20 mx-auto bg-blue-500/20 rounded-full flex items-center justify-center">
                        <Zap className="w-10 h-10 text-blue-400" />
                      </div>
                      <h3 className="text-white text-xl font-medium">DevBox Environment</h3>
                      <p className="text-gray-400 text-sm max-w-md">
                        Full-stack {runtime} environment for backend applications
                      </p>
                      <p className="text-gray-500 text-xs max-w-md">
                        Starts a cloud development container with your project files, including a full VS Code editor
                      </p>
                      <Button onClick={startDevBox} className="bg-blue-600 hover:bg-blue-700 text-white px-6">
                        <Play className="w-4 h-4 mr-2" />
                        Start DevBox
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // OpenSandbox container preview (full-stack, isolated)
        if (isManualPreviewActive && previewMode === 'opensandbox') {
          const deployToOpenSandbox = async () => {
            if (!useStructure?.files || isOpensandboxDeploying) return;

            setIsOpensandboxDeploying(true);
            setOpensandboxLogs(['Deploying to OpenSandbox container...']);
            setOpensandboxUrl(null);

            try {
              const reusableSandboxId =
                opensandboxId && opensandboxScopeRef.current === manualPreviewPathRef.current
                  ? opensandboxId
                  : undefined;

              const resp = await fetch('/api/preview/sandbox', {
                method: reusableSandboxId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  files: useStructure.files,
                  framework: effectiveFramework,
                  sandboxId: reusableSandboxId,
                }),
              });

              const result = await resp.json();

              if (result.success && result.previewUrl) {
                setOpensandboxUrl(result.previewUrl);
                setOpensandboxId(result.sandboxId);
                opensandboxScopeRef.current = manualPreviewPathRef.current;
                setOpensandboxLogs(result.logs || ['Deployed successfully']);
              } else {
                setOpensandboxLogs(prev => [
                  ...prev,
                  ...(result.logs || []),
                  `Error: ${result.error || 'Deployment failed'}`,
                ]);
              }
            } catch (err: any) {
              setOpensandboxLogs(prev => [...prev, `Network error: ${err.message}`]);
            } finally {
              setIsOpensandboxDeploying(false);
            }
          };

          // If we already have a URL, show iframe; otherwise show deploy UI
          if (opensandboxUrl) {
            return (
              <div className="h-full flex flex-col bg-gray-950 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">📦 OpenSandbox Preview</span>
                    <span className="text-emerald-300 text-xs">{effectiveFramework}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={deployToOpenSandbox}
                      disabled={isOpensandboxDeploying}
                      className="text-emerald-200 hover:text-white h-6 px-2 text-xs"
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${isOpensandboxDeploying ? 'animate-spin' : ''}`} />
                      {isOpensandboxDeploying ? 'Syncing...' : 'Sync Files'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewMode('sandpack')}
                      className="text-emerald-200 hover:text-white h-6 px-2 text-xs"
                    >
                      Use Sandpack
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (opensandboxId) {
                          fetch(`/api/preview/sandbox?sandboxId=${opensandboxId}`, { method: 'DELETE' }).catch(() => {});
                        }
                        setOpensandboxUrl(null);
                        setOpensandboxId(null);
                        setOpensandboxLogs([]);
                        opensandboxScopeRef.current = null;
                      }}
                      className="text-red-300 hover:text-red-100 h-6 px-2 text-xs"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <iframe
                  ref={iframeRef}
                  src={opensandboxUrl}
                  className="flex-1 w-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                  allow="cross-origin-isolated"
                  title="OpenSandbox Preview"
                />
              </div>
            );
          }

          // Deploy UI (no URL yet)
          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                  <div className="w-20 h-20 mx-auto mb-6 bg-emerald-500/20 rounded-full flex items-center justify-center">
                    <Package className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-white text-xl font-medium mb-2">OpenSandbox Preview</h3>
                  <p className="text-gray-400 text-sm mb-2">
                    Full-stack isolated container for {effectiveFramework} applications
                  </p>
                  <p className="text-gray-500 text-xs mb-6">
                    Deploys your {Object.keys(useStructure?.files || {}).length} files into a Docker container with dependencies
                  </p>
                  <div className="flex gap-3 justify-center">
                    <Button
                      onClick={deployToOpenSandbox}
                      disabled={isOpensandboxDeploying}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-6"
                    >
                      {isOpensandboxDeploying ? (
                        <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Deploying...</>
                      ) : (
                        <>▶ Deploy to Sandbox</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setPreviewMode('sandpack')}
                      className="border-gray-600 text-gray-300 hover:bg-gray-800"
                    >
                      Use Sandpack
                    </Button>
                  </div>
                  {opensandboxLogs.length > 0 && (
                    <div className="mt-6 text-left bg-gray-900 rounded-lg p-3 max-h-40 overflow-y-auto">
                      {opensandboxLogs.map((line, i) => (
                        <div key={i} className="text-xs text-gray-400 font-mono">{line}</div>
                      ))}
                    </div>
                  )}
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
          
          // Pyodide loading function (regular function, NOT a hook)
          const loadPyodideRuntime = async () => {
            setIsPyodideLoading(true);
            setPyodideOutput('');

            try {
              const CDN_SOURCES = [
                'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/',
                'https://unpkg.com/pyodide@0.23.4/',
              ];
              
              let pyodide: any = null;
              let lastError: any = null;

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
                      packageCacheDir: '/lib/python3.11/site-packages',
                    });
                    break;
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

              pyodide.setStdout({
                batched: (msg: string) => {
                  setPyodideOutput(prev => prev + msg);
                },
                write: (msg: string) => {
                  setPyodideOutput(prev => prev + msg);
                },
                isatty: () => false,
              });

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
                      if (pyodideRef.current && mainFile) {
                        setPyodideOutput('');
                        pyodideRef.current.runPythonAsync(mainFile[1]).catch((err: any) => {
                          setPyodideOutput(prev => prev + `\nError: ${err.message}\n`);
                        });
                      } else {
                        void loadPyodideRuntime();
                      }
                    }}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white"
                    disabled={isPyodideLoading}
                  >
                    {isPyodideLoading ? '⏳ Loading...' : pyodideRef.current ? '▶ Re-run' : '▶ Load & Run'}
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
                  ) : pyodideRef.current ? (
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
                  ) : (
                    <div className="space-y-2 text-gray-400">
                      <p>Click "▶ Load & Run" to start the Python runtime.</p>
                      <p className="text-xs text-gray-500">Pyodide runs Python natively in the browser — no server needed!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // Vite build preview mode - Auto-redirect to Sandpack after brief delay
        if (isManualPreviewActive && previewMode === 'vite') {
          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 mx-auto mb-4 bg-cyan-500/20 rounded-full flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                </div>
                <h3 className="text-white text-lg font-medium mb-2">Vite Preview</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Redirecting to Sandpack for instant Vite-compatible preview...
                </p>
                <Button
                  onClick={() => setPreviewMode('sandpack')}
                  className="bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  Go Now
                </Button>
              </div>
            </div>
          );
        }

        // Webpack build preview mode - Auto-redirect to Sandpack after brief delay
        if (isManualPreviewActive && previewMode === 'webpack') {
          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 mx-auto mb-4 bg-indigo-500/20 rounded-full flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                </div>
                <h3 className="text-white text-lg font-medium mb-2">Webpack Preview</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Redirecting to Sandpack for instant bundling preview...
                </p>
                <Button
                  onClick={() => setPreviewMode('sandpack')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Go Now
                </Button>
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
            webcontainerUrlRef.current = null;

            try {
              log('[WebContainer] Bootstrapping in browser...');
              
              // Dynamically import WebContainer API (browser-only)
              const { WebContainer } = await import('@webcontainer/api');
              
              // Boot the WebContainer instance
              const webcontainer = await WebContainer.boot();
              webcontainerInstanceRef.current = webcontainer;
              
              log('[WebContainer] Instance booted, writing files...');
              
              // Write all files to the virtual filesystem
              const files = useStructure.files;
              
              // Collect unique parent directories and create them first
              const dirs = new Set<string>();
              for (const filePath of Object.keys(files)) {
                const parts = filePath.split('/').filter(Boolean);
                for (let i = 1; i < parts.length; i++) {
                  dirs.add('/' + parts.slice(0, i).join('/'));
                }
              }
              // Create directories shallowest-first
              const sortedDirs = Array.from(dirs).sort((a, b) => a.split('/').length - b.split('/').length);
              for (const dir of sortedDirs) {
                try {
                  await webcontainer.fs.mkdir(dir, { recursive: true });
                } catch {
                  // Directory may already exist
                }
              }
              
              // Now write files
              for (const [filePath, content] of Object.entries(files)) {
                try {
                  await webcontainer.fs.writeFile(filePath, content);
                } catch (writeErr: any) {
                  logWarn(`[WebContainer] Failed to write ${filePath}:`, writeErr.message);
                }
              }
              
              log('[WebContainer] Files written, installing dependencies...');
              
              // Install dependencies if package.json exists
              const hasPackageJson = files['package.json'] !== undefined;
              if (hasPackageJson) {
                try {
                  const installProcess = await webcontainer.spawn('npm', ['install']);
                  await installProcess.exit;
                  log('[WebContainer] Dependencies installed');
                } catch (installErr: any) {
                  logWarn('[WebContainer] npm install failed:', installErr.message);
                  // Continue anyway - some projects don't need deps
                }
              }
              
              log('[WebContainer] Starting server...');

              // Determine start command - check for Next.js first
              const packageJsonContent = hasPackageJson ? files['package.json'] : '';
              const hasNextJs = packageJsonContent.includes('next') || files['next.config.js'] || files['next.config.ts'];
              const hasStartScript = hasPackageJson && packageJsonContent.includes('"start"');
              const hasDevScript = hasPackageJson && packageJsonContent.includes('"dev"');
              
              // Find the entry file location to determine working directory
              const serverFileCandidates = ['server.js', 'app.js', 'index.js', 'main.js'];
              const entryFile = Object.keys(files).find(f => serverFileCandidates.includes(f)) || 'server.js';
              const entryDir = entryFile.includes('/') ? entryFile.substring(0, entryFile.lastIndexOf('/')) : '.';
              
              // Next.js should use 'npm run dev', otherwise use start script or node with correct path
              // cdPrefix is empty when entryDir is '.' so we don't emit a bare 'cd <command>'
              const cdPrefix = entryDir !== '.' ? `cd ${entryDir} && ` : '';
              const startCommand = hasNextJs && hasDevScript 
                ? cdPrefix + 'npm run dev' 
                : hasStartScript 
                  ? cdPrefix + 'npm start' 
                  : cdPrefix + 'node ' + entryFile.split('/').pop();

              log(`[WebContainer] Using start command: ${startCommand} (entry dir: ${entryDir})`);

              // Start the development server with correct working directory
              const process = await webcontainer.spawn('sh', ['-c', startCommand]);
              webcontainerProcessRef.current = process;

              // Monitor process exit
              const exitPromise = process.exit.then((exitCode: number) => {
                logError(`[WebContainer] Process exited with code ${exitCode}`);
                if (exitCode !== 0 && !webcontainerUrlRef.current) {
                  setWebcontainerUrl(`Error: Server exited with code ${exitCode}. Check output for details.`);
                  setIsWebcontainerBooting(false);
                }
              });
              
              // Listen for server-ready event
              let serverReadyCalled = false;
              webcontainer.on('server-ready', (port: number, url: string) => {
                serverReadyCalled = true;
                log(`[WebContainer] Server ready: ${url} (port ${port})`);
                setWebcontainerUrl(url);
                setIsWebcontainerBooting(false);
              });
              
              // Also watch for output to detect server start
              let serverOutput = '';
              let outputWithoutAnsi = '';
              
              // ANSI escape code regex for stripping terminal formatting
              const ansiRegex = /\x1b\[[0-9;]*[a-zA-Z]/g;
              
              process.output.pipeTo(new WritableStream({
                write(data) {
                  serverOutput += data;
                  // Strip ANSI codes for readable output and pattern matching
                  const cleanData = data.replace(ansiRegex, '');
                  outputWithoutAnsi += cleanData;
                  log(`[WebContainer] Server output: ${cleanData.trim()}`);
                  
                  // Look for port in output - multiple patterns
                  const patterns = [
                    /listening on.*?:(\d+)/i,
                    /server.*?running.*?:(\d+)/i,
                    /port.*?(\d+)/i,
                    /http:\/\/localhost:(\d+)/i,
                    /http:\/\/0\.0\.0\.0:(\d+)/i,
                    /ready in.*?(\d+)/i,  // Next.js pattern
                    /:(\d{4,5})/  // generic 4-5 digit port
                  ];
                  
                  for (const pattern of patterns) {
                    const portMatch = outputWithoutAnsi.match(pattern);
                    if (portMatch && !webcontainerUrlRef.current) {
                      const port = parseInt(portMatch[1], 10);
                      if (port > 0 && port < 65536) {
                        log(`[WebContainer] Detected port ${port} from output`);
                        setWebcontainerUrl(`http://localhost:${port}`);
                        break;
                      }
                    }
                  }
                }
              }));

              // Set a fallback URL after timeout if no server-ready event
              // Increased timeout to 45s for slower boots, only set URL if we have a valid one
              setTimeout(() => {
                // Only show timeout message if server-ready wasn't called and we don't have a URL
                if (!serverReadyCalled && !webcontainerUrlRef.current) {
                  log('[WebContainer] Timeout waiting for server-ready event, checking output...');
                  // Try to extract port from server output as last resort (use ANSI-stripped output)
                  const portMatch = outputWithoutAnsi.match(/listening on.*?:(\d+)/i) || outputWithoutAnsi.match(/port.*?(\d+)/i) || outputWithoutAnsi.match(/http:\/\/localhost:(\d+)/i) || outputWithoutAnsi.match(/ready in.*?(\d+)/i);
                  if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    log(`[WebContainer] Extracted port ${port} from output after timeout`);
                    setWebcontainerUrl(`http://localhost:${port}`);
                  } else {
                    // Check if this might be a Next.js project (known WebContainer limitation)
                    const cleanOutput = outputWithoutAnsi.slice(-300).replace(/\n/g, ' ').trim();
                    const isNextJs = files['next.config.js'] || files['next.config.ts'] || (files['package.json'] && files['package.json'].includes('next'));
                    const nextJsHint = isNextJs 
                      ? ' Note: Next.js dev server has limited WebContainer support. Try Sandpack mode for frontend preview instead.' 
                      : '';
                    setWebcontainerUrl(`Timeout: Server did not start.${nextJsHint} Output: "${cleanOutput || 'None'}"`);
                  }
                } else if (!webcontainerUrlRef.current && serverReadyCalled) {
                  // server-ready was called but URL wasn't set (shouldn't happen, but handle it)
                  log('[WebContainer] server-ready event fired but URL not set - using fallback');
                  setWebcontainerUrl('http://localhost:3000');
                }
                setIsWebcontainerBooting(false);
              }, 45000);
              
            } catch (err: any) {
              logError('[WebContainer] Boot error:', err);
              
              if (err.message.includes('SharedArrayBuffer') || err.message.includes('cross-origin')) {
                toast.error('WebContainer requires cross-origin isolation', {
                  description: 'Your browser may not support SharedArrayBuffer. Try Chrome or Edge.',
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
        // Uses WebContainer directly in browser (same as webcontainer mode but with Next.js-specific config)
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
            webcontainerUrlRef.current = null;

            try {
              log('[Next.js] Booting WebContainer for Next.js...');

              // Dynamically import WebContainer API (browser-only)
              const { WebContainer } = await import('@webcontainer/api');

              // Boot the WebContainer instance
              const webcontainer = await WebContainer.boot();
              webcontainerInstanceRef.current = webcontainer;

              log('[Next.js] Writing files to virtual filesystem...');

              // Write all files
              const files = useStructure.files;
              for (const [filePath, content] of Object.entries(files)) {
                try {
                  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                  if (dir) {
                    await webcontainer.fs.mkdir(dir, { recursive: true });
                  }
                  await webcontainer.fs.writeFile(filePath, content);
                } catch (writeErr: any) {
                  logWarn(`[Next.js] Failed to write ${filePath}:`, writeErr.message);
                }
              }

              log('[Next.js] Installing dependencies...');
              await webcontainer.spawn('npm', ['install']);

              log('[Next.js] Starting Next.js dev server...');
              const process = await webcontainer.spawn('npm', ['run', 'dev']);
              webcontainerProcessRef.current = process;

              let serverOutput = '';
              let outputWithoutAnsi = '';
              const ansiRegex = /\x1b\[[0-9;]*[a-zA-Z]/g;
              
              process.output.pipeTo(new WritableStream({
                write(data) {
                  serverOutput += data;
                  const cleanData = data.replace(ansiRegex, '');
                  outputWithoutAnsi += cleanData;
                  log(`[Next.js] Output: ${cleanData.trim()}`);
                  
                  // Next.js typically outputs "Ready in X.Xs" or "started on port"
                  const patterns = [
                    /ready in.*?(\d+)/i,
                    /started on.*?:(\d+)/i,
                    /localhost:(\d+)/i,
                    /:(\d{4,5})/
                  ];
                  
                  for (const pattern of patterns) {
                    const match = outputWithoutAnsi.match(pattern);
                    if (match && !webcontainerUrlRef.current) {
                      const port = parseInt(match[1], 10);
                      if (port > 0 && port < 65536) {
                        const url = `http://localhost:${port}`;
                        log(`[Next.js] Server ready: ${url}`);
                        setNextjsUrl(url);
                        setIsNextjsBuilding(false);
                        break;
                      }
                    }
                  }
                }
              }));

              // Fallback timeout
              setTimeout(() => {
                if (!webcontainerUrlRef.current) {
                  const portMatch = outputWithoutAnsi.match(/:(\d{4,5})/);
                  if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    setNextjsUrl(`http://localhost:${port}`);
                  } else {
                    const cleanOutput = outputWithoutAnsi.slice(-300).replace(/\n/g, ' ').trim();
                    setNextjsUrl(`Timeout: "${cleanOutput || 'No output'}"`);
                  }
                }
                setIsNextjsBuilding(false);
              }, 45000);

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
                    onClick={() => openWebContainerPreview(
                      manualPreviewFiles || scopedPreviewFiles || projectStructure?.files || {}
                    )}
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

              // Check content type before parsing JSON
              const contentType = response.headers.get('content-type');
              if (!contentType?.includes('application/json')) {
                // Response is likely HTML error page
                const text = await response.text();
                throw new Error(
                  `Server returned ${response.status} ${response.statusText} (not JSON). ` +
                  `This may indicate a server error or maintenance.`
                );
              }

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
            <div className="h-full bg-black/40 backdrop-blur-xl rounded-xl overflow-hidden flex flex-col border border-white/10">
              <div className="bg-gradient-to-r from-black/80 via-black/60 to-black/80 backdrop-blur-sm px-4 py-2.5 flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${isCodesandboxLoading ? 'bg-amber-500 animate-pulse' : 'bg-violet-500'}`} />
                  <span className="text-white/90 text-sm font-medium tracking-wide">CodeSandbox</span>
                  <span className="text-white/40 text-xs">•</span>
                  <span className="text-white/50 text-xs">Cloud IDE</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      void bootCodeSandbox();
                    }}
                    disabled={isCodesandboxLoading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-violet-500/80 to-purple-500/80 hover:from-violet-400 hover:to-purple-400 disabled:from-gray-600 disabled:to-gray-700 rounded-lg transition-all duration-200 shadow-lg shadow-violet-500/20 border border-violet-500/30 disabled:cursor-not-allowed"
                  >
                    {isCodesandboxLoading ? 'Starting...' : 'Launch Cloud IDE'}
                  </button>
                  <button
                    onClick={() => openWebContainerPreview(
                      manualPreviewFiles || scopedPreviewFiles || projectStructure?.files || {}
                    )}
                    className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all duration-200 backdrop-blur-sm"
                  >
                    WebContainer
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="p-3 bg-black/60 border-b border-white/10">
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-white/40 uppercase tracking-wider text-[10px]">Package</span>
                      <span className={`${packageJson ? 'text-emerald-400' : 'text-amber-400'} font-medium`}>
                        {packageJson ? 'Found' : 'Not found'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-white/40 uppercase tracking-wider text-[10px]">Docker</span>
                      <span className={`${hasDocker ? 'text-cyan-400' : 'text-white/60'} font-medium`}>
                        {hasDocker ? 'Detected' : 'Standard'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-white/40 uppercase tracking-wider text-[10px]">Server Files</span>
                      <span className="text-white/80 font-medium">{serverFiles.length}</span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                  {isCodesandboxLoading ? (
                    <div className="flex items-center gap-3 text-violet-300">
                      <div className="w-5 h-5 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
                      <div className="space-y-1">
                        <p className="text-white/80">Starting cloud environment...</p>
                        <p className="text-xs text-white/50">This may take 30-60 seconds</p>
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

        // Node.js preview mode - CLI output in browser via WebContainer
        if (isManualPreviewActive && previewMode === 'node') {
          const packageJson = Object.entries(useStructure.files).find(
            ([path]) => path === 'package.json'
          );
          const jsFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.js') || path.endsWith('.ts')
          );
          const entryFile = jsFiles.find(([path]) =>
            path === 'index.js' || path === 'index.ts' || path === 'main.js' || path === 'main.ts' ||
            path === 'app.js' || path === 'app.ts' || path === 'server.js' || path === 'server.ts'
          ) || jsFiles[0];

          const runNodeScript = async () => {
            if (!entryFile) {
              setNodeOutput('❌ No entry file found. Expected index.js, main.js, app.js, or server.js\n');
              return;
            }

            setIsNodeRunning(true);
            setNodeOutput('> Starting Node.js runtime...\n');

            try {
              const { WebContainer } = await import('@webcontainer/api');
              const webcontainer = await WebContainer.boot();

              // Write files
              setNodeOutput(prev => prev + '📁 Writing files...\n');
              for (const [path, content] of Object.entries(useStructure.files)) {
                if (typeof content === 'string' && content.trim()) {
                  const dir = path.substring(0, path.lastIndexOf('/'));
                  if (dir) {
                    await webcontainer.fs.mkdir(dir, { recursive: true });
                  }
                  await webcontainer.fs.writeFile(path, content);
                }
              }

              // Install dependencies
              if (packageJson) {
                setNodeOutput(prev => prev + '\n📦 Installing dependencies...\n');
                const install = await webcontainer.spawn('npm', ['install']);
                install.output.pipeTo(new WritableStream({
                  write(data) {
                    setNodeOutput(prev => prev + data);
                  }
                }));
                const exitCode = await install.exit;
                if (exitCode !== 0) {
                  setNodeOutput(prev => prev + `\n⚠️ npm install exited with code ${exitCode}\n`);
                }
              }

              // Run the entry file
              setNodeOutput(prev => prev + `\n▶ Running ${entryFile[0]}...\n\n`);
              const process = await webcontainer.spawn('node', [entryFile[0]]);

              process.output.pipeTo(new WritableStream({
                write(data) {
                  setNodeOutput(prev => prev + data);
                }
              }));

              const exitCode = await process.exit;
              if (exitCode === 0) {
                setNodeOutput(prev => prev + '\n✅ Process completed successfully\n');
              } else {
                setNodeOutput(prev => prev + `\n❌ Process exited with code ${exitCode}\n`);
              }

            } catch (err: any) {
              setNodeOutput(prev => prev + `\n❌ Error: ${err.message || 'Failed to run Node.js'}\n`);
            } finally {
              setIsNodeRunning(false);
            }
          };

          return (
            <div className="h-full bg-gray-950 rounded-lg overflow-hidden flex flex-col">
              <div className="bg-green-900 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">🟢 Node.js Runtime</span>
                  <span className="text-green-300 text-xs">CLI Output</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runNodeScript}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white"
                    disabled={isNodeRunning}
                  >
                    {isNodeRunning ? '⏳ Running...' : '▶ Run'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openWebContainerPreview(
                      manualPreviewFiles || scopedPreviewFiles || projectStructure?.files || {}
                    )}
                    className="text-xs bg-green-800 hover:bg-green-700 text-white"
                  >
                    Full WebContainer
                  </Button>
                </div>
              </div>

              <div className="flex-1 p-4 font-mono text-sm overflow-auto bg-black/50">
                {isNodeRunning ? (
                  <div className="flex items-center gap-2 text-green-400">
                    <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                    <span>Running Node.js...</span>
                  </div>
                ) : nodeOutput ? (
                  <pre className="text-green-400 whitespace-pre-wrap">{nodeOutput}</pre>
                ) : (
                  <div className="text-gray-500 space-y-2">
                    <p># Node.js CLI Runtime</p>
                    <p>{entryFile ? `Entry: ${entryFile[0]}` : 'No entry file found'}</p>
                    <p className="text-gray-600">Click "▶ Run" to execute</p>
                  </div>
                )}
                <p className="text-blue-400 animate-pulse">▊</p>
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
                  externalResources: [],
                }}
                files={finalSandpackFiles}
                customSetup={{
                  dependencies: getDependencies(),
                  devDependencies: (useStructure as any).devDependencies?.reduce(
                    (acc: Record<string, string>, dep: string) => {
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
                Framework: {effectiveFramework}
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

    // Enhanced vanilla HTML/CSS/JS preview with Sandpack bundling
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

      // Use Sandpack for HTML/CSS/JS bundling (preferred over iframe)
      const hasWebFiles = htmlFile || cssFile || jsFile || tsFile;
      const shouldUseSandpackForVanilla = hasWebFiles && !useStructure?.framework;

      if (shouldUseSandpackForVanilla) {
        // Build Sandpack files with proper path resolution
        const sandpackFiles: Record<string, { code: string }> = {};

        // Process all files and add to Sandpack
        if (useStructure) {
          Object.entries(useStructure.files).forEach(([path, content]) => {
            if (typeof content === "string" && content.trim()) {
              // Remove leading slash - Sandpack expects relative paths
              const sandpackPath = path.replace(/^\/+/, '');
              sandpackFiles[sandpackPath] = { code: content };
            }
          });
        }

        // If HTML file found via codeBlocks (not structure), add it
        if (htmlFile && !sandpackFiles["index.html"]) {
          sandpackFiles["index.html"] = { code: htmlFile.code };
        }

        // Add CSS file if found
        if (cssFile && !Object.keys(sandpackFiles).some(p => p.endsWith(".css"))) {
          sandpackFiles["style.css"] = { code: cssFile.code };
        }

        // Add JS file if found
        if (jsFile && !Object.keys(sandpackFiles).some(p => p.endsWith(".js"))) {
          sandpackFiles["index.js"] = { code: jsFile.code };
        }

        // Ensure we have an entry point
        if (!sandpackFiles["index.html"] && (cssFile || jsFile)) {
          sandpackFiles["index.html"] = {
            code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  ${cssFile ? '<link rel="stylesheet" href="style.css">' : ''}
</head>
<body>
  <div id="app">
    <h1>Preview</h1>
    <p>Generated from your code</p>
  </div>
  ${jsFile ? '<script src="index.js"></script>' : ''}
</body>
</html>`,
          };
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
                template="vanilla"
                theme="dark"
                options={{
                  showTabs: true,
                  showLineNumbers: false,
                  showNavigator: true,
                  showConsole: false,
                  showRefreshButton: true,
                  autorun: true,
                  recompileMode: "delayed",
                  recompileDelay: 300,
                }}
                files={sandpackFiles}
                customSetup={{
                  dependencies: {},
                }}
              />
            </div>
          </Suspense>
        );
      }

      // Fallback: If no HTML but has other web files, create a basic HTML structure with inlined assets
      if (!htmlFile && (cssFile || jsFile || tsFile)) {
        // Process TypeScript/JavaScript to remove ES6 imports for inline preview
        const processScriptForInline = (code: string): string => {
          if (!code) return '';
          return code
            // Remove ES6 imports
            .replace(/import\s+.*?from\s+['"].*?['"];?/g, '// Import removed - external modules not available in inline preview')
            .replace(/import\s+['"].*?['"];?/g, '// Side-effect import removed')
            // Remove export statements
            .replace(/export\s+(default|const|let|var|function|class|interface|type)\s+/g, '$1 ')
            .replace(/export\s*\{[^}]*\}\s*(from\s+['"].*?['"];?)?/g, '// Export removed');
        };

        const autoGeneratedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Preview</title>
  ${cssFile ? `<style>${cssFile.code}</style>` : ""}
  <!-- Babel for TypeScript/JSX transpilation -->
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="app">
    <h1>Auto-generated Preview</h1>
    <p>This preview was automatically generated from your code.</p>
    <div id="content"></div>
  </div>
  ${
    jsFile
      ? `<script>
    try {
      ${processScriptForInline(jsFile.code)}
    } catch (e) {
      console.error('Error executing JavaScript:', e);
      document.getElementById('content').innerHTML = '<p style="color: red;">Error: ' + e.message + '</p>';
    }
  </script>`
      : ""
  }
  ${
    tsFile
      ? `<script type="text/babel" data-presets="typescript,react">
    try {
      ${processScriptForInline(tsFile.code)}
    } catch (e) {
      console.error('Error executing TypeScript:', e);
    }
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
              sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups allow-downloads"
              referrerPolicy="no-referrer"
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
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups allow-downloads"
            referrerPolicy="no-referrer"
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

    }
  }, [messages, projectStructure, isOpen]);
  // NOTE: Keep component mounted even when closed to allow VFS sync for on-demand shell commands
  // The component will render nothing when isOpen is false, but effects will still run
  return (
    <AnimatePresence>
      {/* Always render the component but hide when isOpen is false - allows VFS sync effects to continue */}
      {isOpen ? (
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
                </div>
                <div className="flex items-center gap-1 md:gap-2">
                  <button
                    onClick={downloadAsZip}
                    className="bg-blue-600/50 hover:bg-blue-500/60 backdrop-blur-sm text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center transition-all duration-200"
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
                      className="bg-purple-600/50 hover:bg-purple-500/60 backdrop-blur-sm text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center transition-all duration-200"
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
                  <PreviewErrorBoundary
                    previewMode={previewMode}
                    onReset={() => {
                      log('[PreviewErrorBoundary] Reset triggered, clearing preview state');
                      handleClearManualPreview();
                      if (manualPreviewPathRef.current) {
                        handleManualPreview(manualPreviewPathRef.current);
                      }
                    }}
                  >
                    {renderLivePreview()}
                  </PreviewErrorBoundary>
                </TabsContent>

                {detectedFramework !== "vanilla" && (
                  <TabsContent value="sandpack" className="p-0 h-full">
                    {renderLivePreview()}
                  </TabsContent>
                )}

                <TabsContent value="files" className="p-0 h-full">
                  <div className="flex h-full flex-col md:flex-row">
                    <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 bg-black/30 overflow-y-auto max-h-48 md:max-h-none [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.3)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-black/30 [&::-webkit-scrollbar-thumb:hover]:bg-black">
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
                                    void debouncedListDirectory(filesystemCurrentPath);
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
                                      void debouncedListDirectory(filesystemCurrentPath);
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
                              } ${dragOverPath === node.path ? 'bg-blue-500/30 border border-blue-500/50' : ''}`}
                              key={node.path}
                              onClick={() => {
                                if (node.type === "directory") {
                                  openFilesystemDirectory(node.path);
                                } else {
                                  void selectFilesystemFile(node.path);
                                }
                              }}
                              onDoubleClick={() => handleDoubleClickFile(node)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  path: node.path,
                                  type: node.type,
                                });
                                return false;
                              }}
                              draggable={node.type === 'file'}
                              onDragStart={(e) => handleDragStart(e, { path: node.path, name: node.name })}
                              onDragOver={(e) => node.type === 'directory' && handleDragOver(e, node.path)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => node.type === 'directory' && handleDrop(e, node.path, true)}
                            >
                              <div className="flex items-center flex-1 min-w-0">
                                {node.type === "directory" ? (
                                  <FolderOpen className="w-4 h-4 mr-2 flex-shrink-0 text-yellow-300" />
                                ) : (
                                  <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                                )}
                                {editingFilePath === node.path ? (
                                  <input
                                    type="text"
                                    value={editingFileName}
                                    onChange={(e) => setEditingFileName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        confirmRenameFromEdit();
                                      } else if (e.key === 'Escape') {
                                        cancelRenameEdit();
                                      }
                                    }}
                                    onBlur={confirmRenameFromEdit}
                                    className="bg-black/50 border border-blue-500 rounded px-1 py-0.5 text-xs text-white outline-none flex-1 min-w-0"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <span className="truncate flex-1">{node.name}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                {clipboard && node.type === 'directory' && (
                                  <button
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-blue-400 transition-all text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePasteFile(node.path, true);
                                    }}
                                    title="Paste file here"
                                  >
                                    📋
                                  </button>
                                )}
                                <button
                                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const label = node.type === 'directory' ? `Delete folder "${node.name}" and all contents?` : `Delete ${node.name}?`;
                                    if (confirm(label)) {
                                      deleteFilesystemPath(node.path).then((deleteResult) => {
                                        toast.success(`Deleted ${node.name}`);
                                        void debouncedListDirectory(filesystemCurrentPath);
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

                        {/* Polled Diffs Section - from useDiffsPoller */}
                        {polledDiffs && polledDiffs.length > 0 && (
                          <div className="mt-4 border-t border-white/10 pt-3">
                            <h4 className="text-xs font-medium text-cyan-400 mb-2">
                              Polled Changes ({polledDiffs.length}) 🔄
                            </h4>
                            <div className="flex gap-2 mb-2">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 px-2 text-[11px] bg-cyan-600 hover:bg-cyan-700"
                                onClick={() => onApplyPolledDiffs?.()}
                                disabled={!onApplyPolledDiffs}
                              >
                                Apply All
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => {
                                  // Show path selection - for now apply all
                                  onApplyPolledDiffs?.();
                                }}
                                disabled={!onApplyPolledDiffs}
                              >
                                Select...
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={onClearPolledDiffs}
                                disabled={!onClearPolledDiffs}
                              >
                                Clear
                              </Button>
                            </div>
                            <div className="space-y-1">
                              {polledDiffs.map((diff, idx) => (
                                <div key={diff.id || idx} className="rounded border border-cyan-500/20 p-2 bg-cyan-900/10">
                                  <div className="flex items-center justify-between">
                                    <div className="truncate text-[11px] text-cyan-300">{diff.path}</div>
                                    <span className={`text-[10px] px-1.5 rounded ${
                                      diff.changeType === 'create' ? 'bg-green-500/20 text-green-400' :
                                      diff.changeType === 'delete' ? 'bg-red-500/20 text-red-400' :
                                      'bg-yellow-500/20 text-yellow-400'
                                    }`}>
                                      {diff.changeType}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1 text-[10px]"
                                      onClick={() => onApplyPolledDiffs?.([diff.path])}
                                    >
                                      Apply
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1 text-[10px]"
                                      onClick={() => {
                                        // View diff details - could show modal
                                        console.log('Diff details:', diff.diff);
                                      }}
                                    >
                                      View
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0">
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
                                        await debouncedListDirectory(normalizedFilesystemPath);
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
                        <div className="h-full flex flex-col items-center justify-center text-sm">
                          <div className="w-16 h-16 mb-4 rounded-2xl bg-gradient-to-br from-white/5 to-white/10 border border-white/10 flex items-center justify-center backdrop-blur-sm">
                            <Eye className="w-8 h-8 text-white/30" />
                          </div>
                          <p className="text-white/50 font-medium">No preview selected</p>
                          <p className="text-white/30 text-xs mt-1">Select a file to preview</p>
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
      ) : (
        // Hidden but mounted - allows VFS sync effects to continue running for shell on-demand commands
        <div data-code-preview-hidden style={{ display: 'none' }} />
      )}
      
      {/* Context Menu for File Operations */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="fixed z-[101] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {/* Paste option if clipboard has content and it's a directory */}
            {clipboard && contextMenu.type === 'directory' && (
              <>
                <button
                  className="w-full px-4 py-2 text-left text-sm text-blue-400 hover:bg-gray-800 flex items-center gap-2"
                  onClick={() => {
                    handlePasteFile(contextMenu.path, true);
                  }}
                >
                  <span className="w-4">📋</span> Paste {clipboard.operation === 'cut' ? '(Move)' : '(Copy)'}
                </button>
                <hr className="my-1 border-gray-700" />
              </>
            )}
            
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
                    const name = contextMenu.path.split('/').pop() || '';
                    const parentPath = contextMenu.path.split('/').slice(0, -1).join('/');
                    handleCutFile(contextMenu.path, name, parentPath);
                  }}
                >
                  <span className="w-4">✂️</span> Cut
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                  onClick={() => {
                    const name = contextMenu.path.split('/').pop() || '';
                    const parentPath = contextMenu.path.split('/').slice(0, -1).join('/');
                    handleCopyFile(contextMenu.path, name, parentPath);
                  }}
                >
                  <span className="w-4">📄</span> Copy
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                  onClick={() => {
                    handleRenameFile(contextMenu.path);
                  }}
                >
                  <Edit className="w-4 h-4" /> Rename
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm text-cyan-400 hover:bg-cyan-500/10 flex items-center gap-2"
                  onClick={() => {
                    openMonacoEditor(contextMenu.path);
                    setContextMenu(null);
                  }}
                >
                  <CodeIcon className="w-4 h-4" /> Open in Editor
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
                    void debouncedListDirectory(filesystemCurrentPath);
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
      
      {/* Confirmation Dialog for File Operations */}
      {confirmDialog && (
        <ConfirmationDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          variant={confirmDialog.variant}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      )}
    </AnimatePresence>
  );
}
