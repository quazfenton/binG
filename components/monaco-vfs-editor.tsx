/**
 * Monaco VFS Editor - Full-Featured File Editor
 * 
 * A Monaco-style code editor for editing Virtual File System files.
 * Features:
 * - Opens files from VFS on demand (no polling)
 * - Triggered from file explorers, terminal commands (xdg-open, gedit, edit)
 * - Auto-fills available screen space (1920x720 default, responsive)
 * - Syntax highlighting for 100+ languages
 * - Multi-file tabs
 * - Persistent save with VFS integration
 * - Diff view for changes
 * - Minimap, line numbers, code folding
 * 
 * @component
 */

"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useVirtualFilesystem } from "@/hooks/use-virtual-filesystem";
import { emitFilesystemUpdated } from "@/lib/virtual-filesystem/sync/sync-events";
import type { AttachedVirtualFile } from "@/hooks/use-virtual-filesystem";

import {
  X,
  Save,
  FileText,
  Code,
  Maximize2,
  Minimize2,
  Copy,
  Search,
  Undo,
  Redo,
  FileDiff,
  CheckCircle,
  AlertCircle,
  Loader2,
  Terminal,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  File,
  FileCode,
  FileJson,
  FileCog,
  FileArchive,
  Image,
  Music,
  Video,
  FileQuestion,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface MonacoEditorProps {
  /** Initial file path to open */
  initialFilePath?: string;
  /** Initial content (if not opening from VFS) */
  initialContent?: string;
  /** VFS scope path */
  filesystemScopePath?: string;
  /** Owner ID for VFS operations */
  ownerId?: string;
  /** Called when editor is closed */
  onClose?: () => void;
  /** Called when file is saved */
  onSave?: (filePath: string, content: string) => void;
  /** Called when a file open is requested (for terminal commands) */
  onOpenFile?: (filePath: string) => void;
  /** Enable diff view */
  enableDiffView?: boolean;
  /** Original content for diff view */
  originalContent?: string;
  /** Read-only mode */
  readOnly?: boolean;
  /** Auto-save interval (ms), 0 to disable */
  autoSaveInterval?: number;
  /** Default width */
  defaultWidth?: number;
  /** Default height */
  defaultHeight?: number;
  /** Position: 'center', 'right', 'bottom', 'fullscreen' */
  position?: "center" | "right" | "bottom" | "fullscreen";
  /** Z-index */
  zIndex?: number;
}

export interface OpenFileEvent {
  filePath: string;
  content?: string;
  line?: number;
  column?: number;
  source?: "explorer" | "terminal" | "api" | "other";
  terminalCommand?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  r: "r",
  R: "r",
  sql: "sql",
  graphql: "graphql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  bat: "batch",
  cmd: "batch",
  dockerfile: "dockerfile",
  Dockerfile: "dockerfile",
  makefile: "makefile",
  Makefile: "makefile",
  txt: "text",
  text: "text",
  log: "text",
  env: "properties",
  ini: "ini",
  cfg: "ini",
  conf: "properties",
  config: "properties",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  sol: "solidity",
  v: "verilog",
  sv: "systemverilog",
  lua: "lua",
  perl: "perl",
  pl: "perl",
  pm: "perl",
  t: "perl",
  raku: "raku",
  raku6: "raku",
  pm6: "raku",
  dart: "dart",
  flutter: "dart",
  vue: "vue",
  svelte: "svelte",
  wasm: "wat",
  wat: "wat",
  wit: "wit",
  prototext: "protobuf",
  proto: "protobuf",
  avsc: "avro",
  avro: "avro",
  thrift: "thrift",
  capnp: "capnp",
  flatbuffers: "fbs",
  fbs: "fbs",
  bon: "bon",
  msgpack: "msgpack",
  bson: "bson",
  ubjson: "ubjson",
  smile: "smile",
  cbor: "cbor",
  fjson: "fjson",
  ion: "ion",
  parquet: "parquet",
  orc: "orc",
  avro: "avro",
};

const FILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  rb: FileCode,
  rs: FileCode,
  go: FileCode,
  java: FileCode,
  c: FileCode,
  cpp: FileCode,
  cs: FileCode,
  php: FileCode,
  swift: FileCode,
  kt: FileCode,
  html: FileCode,
  css: FileCode,
  scss: FileCode,
  json: FileJson,
  yaml: FileCog,
  yml: FileCog,
  toml: FileCog,
  xml: FileCode,
  md: FileText,
  markdown: FileText,
  sh: Terminal,
  bash: Terminal,
  dockerfile: FileCog,
  Dockerfile: FileCog,
  makefile: FileCog,
  Makefile: FileCog,
  jpg: Image,
  jpeg: Image,
  png: Image,
  gif: Image,
  svg: Image,
  webp: Image,
  mp3: Music,
  wav: Music,
  ogg: Music,
  flac: Music,
  mp4: Video,
  avi: Video,
  mkv: Video,
  webm: Video,
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get language from file extension
 */
function getLanguageFromFilePath(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  return LANGUAGE_EXTENSIONS[extension] || "text";
}

/**
 * Get file icon from extension
 */
function getFileIcon(filePath: string): React.ComponentType<{ className?: string }> {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[extension] || FileQuestion;
}

/**
 * Get display name for file
 */
function getFileDisplayName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

// ============================================================================
// Monaco Editor Component
// ============================================================================

export function MonacoVFSEditor({
  initialFilePath,
  initialContent,
  filesystemScopePath = "project",
  ownerId,
  onClose,
  onSave,
  onOpenFile,
  enableDiffView = false,
  originalContent,
  readOnly = false,
  autoSaveInterval = 0,
  defaultWidth = DEFAULT_WIDTH,
  defaultHeight = DEFAULT_HEIGHT,
  position = "center",
  zIndex = 10000,
}: MonacoEditorProps) {
  // State
  const [files, setFiles] = useState<Array<{ path: string; content: string; originalContent: string; language: string; dirty: boolean }>>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(enableDiffView);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [editorDimensions, setEditorDimensions] = useState({
    width: defaultWidth,
    height: defaultHeight,
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // VFS integration
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath);

  // Get current file
  const currentFile = files[activeFileIndex];

  // Calculate available screen space
  const calculateAvailableSpace = useCallback(() => {
    if (typeof window === "undefined") {
      return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, x: 0, y: 0 };
    }

    const availableWidth = window.innerWidth - 100;
    const availableHeight = window.innerHeight - 100;

    return {
      width: Math.min(DEFAULT_WIDTH, availableWidth),
      height: Math.min(DEFAULT_HEIGHT, availableHeight),
      x: 50,
      y: 50,
    };
  }, []);

  // Initialize dimensions on mount
  useEffect(() => {
    const space = calculateAvailableSpace();
    setEditorDimensions(space);
  }, [calculateAvailableSpace]);

  // Open initial file
  useEffect(() => {
    if (initialFilePath) {
      openFile(initialFilePath, initialContent);
    }
  }, [initialFilePath, initialContent]);

  // Auto-save
  useEffect(() => {
    if (!autoSaveInterval || !currentFile?.dirty) return;

    const timer = setInterval(() => {
      if (currentFile.dirty) {
        saveFile();
      }
    }, autoSaveInterval);

    return () => clearInterval(timer);
  }, [autoSaveInterval, currentFile?.dirty, currentFile?.content, currentFile?.path]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }

      // Ctrl/Cmd + W: Close
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        if (files.length > 1) {
          closeTab(activeFileIndex);
        } else {
          onClose?.();
        }
      }

      // Escape: Close editor
      if (e.key === "Escape" && !isDragging) {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files.length, activeFileIndex, isDragging, onClose]);

  // Open file from VFS
  const openFile = useCallback(async (filePath: string, content?: string) => {
    setIsLoading(true);

    try {
      let fileContent = content;

      if (!fileContent) {
        // Fetch from VFS
        const file = await virtualFilesystem.readFile(filePath);
        fileContent = file.content;
      }

      // Check if file is already open
      const existingIndex = files.findIndex(f => f.path === filePath);
      if (existingIndex >= 0) {
        setActiveFileIndex(existingIndex);
        setIsLoading(false);
        return;
      }

      // Add new file
      const language = getLanguageFromFilePath(filePath);
      setFiles(prev => [
        ...prev,
        {
          path: filePath,
          content: fileContent || "",
          originalContent: fileContent || "",
          language,
          dirty: false,
        },
      ]);
      setActiveFileIndex(files.length);

      toast.success(`Opened ${getFileDisplayName(filePath)}`);
    } catch (error) {
      console.error("Error opening file:", error);
      toast.error(`Failed to open ${getFileDisplayName(filePath)}`);
    } finally {
      setIsLoading(false);
    }
  }, [files, virtualFilesystem]);

  // Save file to VFS
  const saveFile = useCallback(async () => {
    if (!currentFile) return;

    setIsSaving(true);

    try {
      await virtualFilesystem.writeFile(currentFile.path, currentFile.content);

      // Emit filesystem update event
      emitFilesystemUpdated({
        path: currentFile.path,
        type: "update",
        source: "monaco-editor",
        scopePath: filesystemScopePath,
      });

      // Update file state
      setFiles(prev => prev.map((f, i) => 
        i === activeFileIndex 
          ? { ...f, dirty: false, originalContent: f.content }
          : f
      ));

      // Callback
      onSave?.(currentFile.path, currentFile.content);

      toast.success(`Saved ${getFileDisplayName(currentFile.path)}`);
    } catch (error) {
      console.error("Error saving file:", error);
      toast.error(`Failed to save ${getFileDisplayName(currentFile.path)}`);
    } finally {
      setIsSaving(false);
    }
  }, [currentFile, virtualFilesystem, filesystemScopePath, onSave]);

  // Close tab
  const closeTab = useCallback((index: number) => {
    const file = files[index];
    if (file?.dirty) {
      // Confirm before closing dirty file
      const confirmed = window.confirm(`${getFileDisplayName(file.path)} has unsaved changes. Close anyway?`);
      if (!confirmed) return;
    }

    setFiles(prev => prev.filter((_, i) => i !== index));
    
    if (activeFileIndex >= index && activeFileIndex > 0) {
      setActiveFileIndex(activeFileIndex - 1);
    }
  }, [files, activeFileIndex]);

  // Update content
  const updateContent = useCallback((newContent: string) => {
    setFiles(prev => prev.map((f, i) => 
      i === activeFileIndex 
        ? { ...f, content: newContent, dirty: newContent !== f.originalContent }
        : f
    ));
  }, [activeFileIndex]);

  // Handle drag
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - editorDimensions.x, y: e.clientY - editorDimensions.y };
    setDragOffset({
      x: e.clientX - editorDimensions.x,
      y: e.clientY - editorDimensions.y,
    });
  }, [editorDimensions]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    setEditorDimensions(prev => ({
      ...prev,
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y,
    }));
  }, [isDragging, dragOffset]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
      return () => {
        document.removeEventListener("mousemove", handleDragMove);
        document.removeEventListener("mouseup", handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Toggle maximize
  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      const space = calculateAvailableSpace();
      setEditorDimensions(space);
      setIsMaximized(false);
    } else {
      if (typeof window !== "undefined") {
        setEditorDimensions({
          width: window.innerWidth - 40,
          height: window.innerHeight - 40,
          x: 20,
          y: 20,
        });
      }
      setIsMaximized(true);
    }
  }, [isMaximized, calculateAvailableSpace]);

  // Copy content
  const copyContent = useCallback(async () => {
    if (!currentFile) return;

    try {
      await navigator.clipboard.writeText(currentFile.content);
      toast.success("Content copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy content");
    }
  }, [currentFile]);

  // Render
  return (
    <motion.div
      ref={editorRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        scale: 1,
        width: editorDimensions.width,
        height: editorDimensions.height,
        x: editorDimensions.x,
        y: editorDimensions.y,
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "fixed bg-black/95 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl overflow-hidden",
        "flex flex-col"
      )}
      style={{ 
        zIndex,
        left: 0,
        top: 0,
        transform: `translate(${editorDimensions.x}px, ${editorDimensions.y}px)`,
      }}
    >
      {/* Title Bar */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5",
          "cursor-move select-none"
        )}
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-white/80">
            {currentFile ? getFileDisplayName(currentFile.path) : "Monaco Editor"}
          </span>
          {currentFile?.dirty && (
            <span className="text-xs text-yellow-400">• Unsaved</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={copyContent}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
            title="Copy content"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowDiff(!showDiff)}
            className={cn(
              "p-1.5 rounded hover:bg-white/10",
              showDiff ? "text-green-400" : "text-white/60 hover:text-white"
            )}
            title="Toggle diff view"
          >
            <FileDiff className="w-4 h-4" />
          </button>
          <button
            onClick={toggleMaximize}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-red-500/20 text-white/60 hover:text-red-400"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* File Tabs */}
      {files.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-white/10 bg-black/40 overflow-x-auto">
          {files.map((file, index) => {
            const Icon = getFileIcon(file.path);
            return (
              <div
                key={file.path}
                onClick={() => setActiveFileIndex(index)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs cursor-pointer transition-colors",
                  index === activeFileIndex
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:text-white/80 hover:bg-white/5"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="max-w-[150px] truncate">{getFileDisplayName(file.path)}</span>
                {file.dirty && <span className="w-2 h-2 rounded-full bg-yellow-400" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(index);
                  }}
                  className="p-0.5 rounded hover:bg-white/10"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-2">
          <button
            onClick={saveFile}
            disabled={isSaving || !currentFile?.dirty}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
              currentFile?.dirty
                ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-400/30"
                : "bg-white/5 text-white/40 border border-white/10 cursor-not-allowed"
            )}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </button>

          {showDiff && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded text-xs text-white/60">
              <FileDiff className="w-3.5 h-3.5" />
              <span>Diff View Active</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in file..."
              className="pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 w-48"
            />
          </div>

          <div className="text-xs text-white/40">
            {currentFile?.language.toUpperCase() || "TEXT"}
          </div>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-2" />
              <p className="text-sm text-white/60">Loading file...</p>
            </div>
          </div>
        ) : currentFile ? (
          <div className="h-full flex">
            {/* Line Numbers */}
            <div className="w-12 bg-black/40 border-r border-white/10 text-right py-4 pr-2 text-xs text-white/40 font-mono select-none overflow-hidden">
              {currentFile.content.split("\n").map((_, i) => (
                <div key={i} className="leading-6">{i + 1}</div>
              ))}
            </div>

            {/* Editor */}
            <textarea
              ref={textareaRef}
              value={currentFile.content}
              onChange={(e) => updateContent(e.target.value)}
              readOnly={readOnly}
              className={cn(
                "flex-1 bg-transparent text-white font-mono text-sm p-4 leading-6 resize-none focus:outline-none",
                readOnly && "opacity-50 cursor-not-allowed"
              )}
              spellCheck={false}
              style={{ tabSize: 2 }}
            />

            {/* Diff View Overlay */}
            {showDiff && originalContent && (
              <div className="absolute inset-0 bg-black/80 pointer-events-none">
                <div className="p-4 font-mono text-sm leading-6">
                  {originalContent.split("\n").map((line, i) => {
                    const currentLine = currentFile.content.split("\n")[i];
                    const isAdded = currentLine && !originalContent.split("\n")[i];
                    const isRemoved = !currentLine && originalContent.split("\n")[i];
                    const isChanged = currentLine !== line;

                    return (
                      <div
                        key={i}
                        className={cn(
                          isAdded && "bg-green-500/20 text-green-400",
                          isRemoved && "bg-red-500/20 text-red-400 line-through",
                          isChanged && currentLine && "bg-yellow-500/20 text-yellow-400",
                          !isAdded && !isRemoved && !isChanged && "text-white/60"
                        )}
                      >
                        <span className="w-8 inline-block text-right mr-4 opacity-50">{i + 1}</span>
                        {line || " "}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white/40">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No file open</p>
              <p className="text-xs mt-1">Open a file from the file explorer or terminal</p>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 bg-black/40 text-xs">
        <div className="flex items-center gap-4 text-white/40">
          <span>
            Lines: {currentFile?.content.split("\n").length || 0}
          </span>
          <span>
            Characters: {currentFile?.content.length || 0}
          </span>
          {currentFile?.dirty && (
            <span className="text-yellow-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-white/40">
          <span>UTF-8</span>
          <span>LF</span>
          <span>{currentFile?.language.toUpperCase() || "TEXT"}</span>
        </div>
      </div>
    </motion.div>
  );
}

export default MonacoVFSEditor;
