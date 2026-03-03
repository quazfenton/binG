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
import {
  parseCodeBlocksFromMessages,
  type CodeBlock as ParsedCodeBlock,
} from "../lib/code-parser";

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
  
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath);
  const {
    currentPath: filesystemCurrentPath,
    nodes: filesystemRawNodes,
    setCurrentPath: setFilesystemCurrentPath,
    listDirectory: listFilesystemDirectory,
    readFile: readFilesystemFile,
    writeFile: writeFilesystemFile,
    deletePath: deleteFilesystemPath,
    isLoading: isFilesystemLoading,
  } = virtualFilesystem;
  const [selectedFilesystemPath, setSelectedFilesystemPath] = useState<string>("");
  const [selectedFilesystemLanguage, setSelectedFilesystemLanguage] = useState<string>("text");
  const [selectedFilesystemContent, setSelectedFilesystemContent] = useState<string>("");
  const [isFilesystemFileLoading, setIsFilesystemFileLoading] = useState(false);
  const [scopedPreviewFiles, setScopedPreviewFiles] = useState<Record<string, string>>({});
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editableContent, setEditableContent] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  
  // Manual Sandpack preview state
  const [manualPreviewFiles, setManualPreviewFiles] = useState<Record<string, string> | null>(null);
  const [isManualPreviewActive, setIsManualPreviewActive] = useState(false);
  const [previewMode, setPreviewMode] = useState<'sandpack' | 'iframe' | 'raw' | 'parcel' | 'devbox' | 'pyodide' | 'vite' | 'local' | 'cloud'>('sandpack');
  const [devBoxOutput, setDevBoxOutput] = useState<string[]>([]);
  const [isDevBoxRunning, setIsDevBoxRunning] = useState(false);
  const [pyodideOutput, setPyodideOutput] = useState<string>('');
  const [isPyodideLoading, setIsPyodideLoading] = useState(false);
  const [viteOutput, setViteOutput] = useState<string>('');
  const [isViteBuilding, setIsViteBuilding] = useState(false);
  const [localExecutionOutput, setLocalExecutionOutput] = useState<string>('');
  const [isLocalExecuting, setIsLocalExecuting] = useState(false);
  const [executionMode, setExecutionMode] = useState<'local' | 'cloud' | 'hybrid'>('local');
  const pyodideRef = useRef<any>(null);
  
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

  const openFilesystemDirectory = useCallback((path: string) => {
    // Ensure path doesn't get duplicated "project/project/" prefix
    const cleanPath = path.replace(/^project\/project\//, 'project/');
    setFilesystemCurrentPath(cleanPath);
    void listFilesystemDirectory(cleanPath);
  }, [listFilesystemDirectory, setFilesystemCurrentPath]);

  const openFilesystemParent = useCallback(() => {
    const current = filesystemCurrentPath.replace(/\/+$/, "");
    const parts = current.split("/").filter(Boolean);
    if (parts.length <= 1 || (parts.length === 1 && parts[0] === 'project')) {
      openFilesystemDirectory("project");
      return;
    }
    const parentPath = parts.slice(0, -1).join("/");
    openFilesystemDirectory(parentPath || "project");
  }, [filesystemCurrentPath, openFilesystemDirectory]);

  const selectFilesystemFile = useCallback(async (path: string) => {
    setIsEditingFile(false);
    setIsFilesystemFileLoading(true);
    try {
      // Ensure path doesn't get duplicated prefix
      const cleanPath = path.replace(/^project\/project\//, 'project/');
      const file = await readFilesystemFile(cleanPath);
      setSelectedFilesystemPath(file.path);
      setSelectedFilesystemLanguage(file.language || "text");
      setSelectedFilesystemContent(file.content || "");
    } finally {
      setIsFilesystemFileLoading(false);
    }
  }, [readFilesystemFile]);

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
    if (!name) return;
    
    const newPath = parentPath ? `${parentPath}/${name}` : name;
    writeFilesystemFile(newPath, '').then(() => {
      toast.success('File created: ' + name);
      void listFilesystemDirectory(filesystemCurrentPath);
      setContextMenu(null);
    }).catch((err: any) => {
      toast.error('Failed to create file: ' + err.message);
    });
  }, [filesystemCurrentPath, writeFilesystemFile, listFilesystemDirectory]);

  const handleCreateFolder = useCallback((parentPath: string) => {
    const name = prompt('New folder name:');
    if (!name) return;
    
    // Create a dummy file in the folder to create the directory
    const newPath = parentPath ? `${parentPath}/${name}/.gitkeep` : `${name}/.gitkeep`;
    writeFilesystemFile(newPath, '').then(() => {
      toast.success('Folder created: ' + name);
      void listFilesystemDirectory(filesystemCurrentPath);
      setContextMenu(null);
    }).catch((err: any) => {
      toast.error('Failed to create folder: ' + err.message);
    });
  }, [filesystemCurrentPath, writeFilesystemFile, listFilesystemDirectory]);

  const handleRenameFile = useCallback((oldPath: string) => {
    const oldName = oldPath.split('/').pop() || '';
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;
    
    const parentPath = oldPath.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    
    // Read old file, write new file, delete old file
    readFilesystemFile(oldPath).then((file: any) => {
      return writeFilefilesystemFile(newPath, file.content).then(() => {
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
  }, [filesystemCurrentPath, readFilesystemFile, writeFilefilesystemFile, deleteFilesystemPath, listFilesystemDirectory, selectedFilesystemPath]);

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

  // Manual Sandpack preview handler
  const handleManualPreview = useCallback(async (directoryPath?: string, mode?: 'sandpack' | 'iframe' | 'raw' | 'parcel' | 'devbox' | 'pyodide' | 'vite' | 'local' | 'cloud') => {
    try {
      const targetPath = directoryPath || filesystemCurrentPath;
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
        toast.error('No files found in directory');
        return;
      }
      
      // Auto-detect best preview mode AND execution mode
      let selectedMode = mode || 'sandpack';
      let detectedExecutionMode: 'local' | 'cloud' | 'hybrid' = 'local';
      
      if (!mode) {
        // Detection flags
        const hasHtml = Object.keys(files).some(f => f.endsWith('.html'));
        const hasJsx = Object.keys(files).some(f => f.endsWith('.jsx') || f.endsWith('.tsx'));
        const hasVue = Object.keys(files).some(f => f.endsWith('.vue'));
        const hasSvelte = Object.keys(files).some(f => f.endsWith('.svelte'));
        const hasParcelConfig = Object.keys(files).some(f => f.includes('parcel') || f.endsWith('.parcelrc'));
        const hasPython = Object.keys(files).some(f => f.endsWith('.py'));
        const hasNodeServer = Object.keys(files).some(f => f === 'server.js' || f === 'app.js' || f === 'index.js');
        const hasPackageJson = Object.keys(files).some(f => f === 'package.json');
        const hasSimplePython = hasPython && !Object.keys(files).some(f => f.includes('flask') || f.includes('django'));
        const hasViteConfig = Object.keys(files).some(f => f.includes('vite.config'));
        const hasViteProject = hasViteConfig || (hasPackageJson && Object.values(files).find((c: any) => typeof c === 'string' && c.includes('"vite"')));
        const hasHeavyComputation = Object.values(files).some((c: any) => {
          if (typeof c !== 'string') return false;
          return c.includes('tensorflow') || c.includes('pytorch') || c.includes('cuda') || c.includes('gpu');
        });
        const hasAPIKeys = Object.values(files).some((c: any) => 
          typeof c === 'string' && (c.includes('OPENAI_API_KEY') || c.includes('process.env'))
        );
        
        // Determine execution mode based on requirements
        if (hasHeavyComputation || hasAPIKeys) {
          detectedExecutionMode = 'cloud'; // Needs cloud resources or API access
        } else if (hasSimplePython || hasJsx || hasVue || hasSvelte || hasHtml) {
          detectedExecutionMode = 'local'; // Can run in browser
        } else if (hasPython || hasNodeServer) {
          detectedExecutionMode = 'hybrid'; // Try local first, fallback to cloud
        }
        
        // Select preview mode
        if (hasViteProject) {
          selectedMode = 'vite';
        } else if (hasSimplePython && !hasPackageJson) {
          selectedMode = 'pyodide';
        } else if (hasParcelConfig) {
          selectedMode = 'parcel';
        } else if (hasPython || (hasNodeServer && hasPackageJson)) {
          selectedMode = detectedExecutionMode === 'local' ? 'local' : 'devbox';
        } else if (hasHtml && !hasJsx && !hasVue && !hasSvelte) {
          selectedMode = 'iframe';
        } else if (hasJsx || hasVue || hasSvelte) {
          selectedMode = 'sandpack';
        }
      }
      
      // Set execution mode
      setExecutionMode(detectedExecutionMode);
      
      // Set manual preview files and activate
      setManualPreviewFiles(files);
      setIsManualPreviewActive(true);
      setPreviewMode(selectedMode);
      setSelectedTab('preview');
      
      const modeIcon = {
        sandpack: '▶', iframe: '📄', raw: '📝', parcel: '⚡',
        devbox: '🔵', pyodide: '🐍', vite: '⚡', local: '💻', cloud: '☁️'
      }[selectedMode] || '▶';
      
      const execIcon = { local: '💻', cloud: '☁️', hybrid: '🔄' }[detectedExecutionMode];
      
      toast.success(`${modeIcon} Preview loaded (${selectedMode}) - ${execIcon} ${detectedExecutionMode} execution`, {
        description: `${Object.keys(files).length} files detected`
      });
    } catch (error: any) {
      console.error('[Manual Preview] Error:', error);
      toast.error('Failed to load preview: ' + error.message);
    }
  }, [filesystemCurrentPath, listFilesystemDirectory, readFilesystemFile]);

  // Clear manual preview
  const handleClearManualPreview = useCallback(() => {
    setManualPreviewFiles(null);
    setIsManualPreviewActive(false);
    toast.info('Manual preview cleared');
  }, []);

  // Listen for terminal preview commands
  useEffect(() => {
    const handleTerminalPreview = (e: CustomEvent) => {
      const { directory } = e.detail || {};
      handleManualPreview(directory);
    };
    
    window.addEventListener('code-preview-manual' as any, handleTerminalPreview);
    return () => window.removeEventListener('code-preview-manual' as any, handleTerminalPreview);
  }, [handleManualPreview]);

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

  useEffect(() => {
    if (!isOpen || selectedTab !== "files") {
      return;
    }
    const initializeExplorer = async () => {
      setSelectedFilesystemPath("");
      setSelectedFilesystemContent("");
      setSelectedFilesystemLanguage("text");

      const initialNodes = await listFilesystemDirectory(filesystemScopePath);
      setFilesystemCurrentPath(filesystemScopePath);
      if (initialNodes.length > 0) return;

      const sessionsRoot = "project/sessions";
      const sessionDirectories = (await listFilesystemDirectory(sessionsRoot))
        .filter((node) => node.type === "directory");
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
        if (nodes.length > 0) {
          setFilesystemCurrentPath(directory.path);
          return;
        }
      }
    };

    void initializeExplorer();
  }, [filesystemScopePath, isOpen, listFilesystemDirectory, selectedTab, setFilesystemCurrentPath]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    const loadScopedFiles = async () => {
      try {
        const snapshot = await virtualFilesystem.getSnapshot(filesystemScopePath);
        if (cancelled) return;
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
      }
    };

    void loadScopedFiles();
    return () => { cancelled = true; };
  }, [filesystemScopePath, isOpen, virtualFilesystem.getSnapshot]);

  // Bidirectional sync: Poll VFS for changes from terminal/editor
  useEffect(() => {
    if (!isOpen || selectedTab !== 'files') return;
    
    const pollInterval = setInterval(async () => {
      try {
        const snapshot = await virtualFilesystem.getSnapshot(filesystemScopePath);
        const currentFileCount = filesystemNodes.length;
        const vfsFileCount = snapshot?.files?.length || 0;
        
        // Refresh if file count changed
        if (currentFileCount !== vfsFileCount) {
          console.log('[CodePreview] VFS changed, refreshing file list...');
          await listFilesystemDirectory(filesystemCurrentPath);
        }
      } catch (error) {
        console.error('[CodePreview] Poll error:', error);
      }
    }, 2000);
    
    return () => clearInterval(pollInterval);
  }, [isOpen, selectedTab, filesystemCurrentPath, filesystemNodes.length, listFilesystemDirectory, virtualFilesystem.getSnapshot]);

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

    const structure: ProjectStructure = {
      name: "Generated Project",
      files,
      dependencies: dependencies.length > 0 ? dependencies : undefined,
      devDependencies: devDependencies.length > 0 ? devDependencies : undefined,
      scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
      framework,
      bundler,
      packageManager,
    };
    return structure;
  };

  const downloadAsZip = async () => {
    const zip = new JSZip();

    // Try to get files from VFS first (most up-to-date)
    try {
      const snapshot = await virtualFilesystem.getSnapshot(filesystemScopePath);
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
        const content = typeof fileData === 'string' ? fileData : (fileData.content || '');
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

            // The path should already be correctly formatted by cleanFilename.
            // We just need to ensure it's prefixed with '/' for Sandpack.
            const sandpackPath = path.startsWith("/") ? path : `/${path}`;

            acc[sandpackPath] = { code: content };
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

        // Pyodide Python in-browser execution
        if (isManualPreviewActive && previewMode === 'pyodide') {
          const pythonFiles = Object.entries(useStructure.files).filter(
            ([path]) => path.endsWith('.py')
          );
          const mainFile = pythonFiles.find(([path]) => path === 'main.py' || path === 'app.py') || pythonFiles[0];
          
          // Load Pyodide dynamically
          React.useEffect(() => {
            const loadPyodide = async () => {
              setIsPyodideLoading(true);
              try {
                // Load Pyodide from CDN
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js';
                script.async = true;
                script.onload = async () => {
                  if ((window as any).loadPyodide) {
                    const pyodide = await (window as any).loadPyodide({
                      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/',
                    });
                    pyodideRef.current = pyodide;
                    
                    // Capture stdout
                    pyodide.setStdout({
                      batched: (msg: string) => {
                        setPyodideOutput(prev => prev + msg + '\n');
                      }
                    });
                    
                    // Execute main Python file
                    if (mainFile) {
                      try {
                        await pyodide.runPythonAsync(mainFile[1]);
                      } catch (err: any) {
                        setPyodideOutput(prev => prev + `\nError: ${err.message}\n`);
                      }
                    }
                    
                    setIsPyodideLoading(false);
                  }
                };
                document.head.appendChild(script);
              } catch (err: any) {
                console.error('Failed to load Pyodide:', err);
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
          }, [mainFile]);

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
                  <p className="text-gray-400 text-xs mb-1">📁 Python Files:</p>
                  <div className="flex flex-wrap gap-1">
                    {pythonFiles.map(([path]) => (
                      <span key={path} className="text-xs bg-gray-800 text-blue-400 px-2 py-0.5 rounded">
                        {path}
                      </span>
                    ))}
                  </div>
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
          
          // Simulate Vite build
          React.useEffect(() => {
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
            
            runViteBuild();
          }, [srcFiles]);

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
                      setViteOutput('');
                      setIsViteBuilding(true);
                      setTimeout(() => setIsViteBuilding(false), 1500);
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
                
                // Execute JavaScript/TypeScript
                if (jsFiles.length > 0) {
                  for (const [path, code] of jsFiles) {
                    try {
                      setLocalExecutionOutput(prev => prev + `\n📄 Running ${path}...\n`);
                      // Simple eval for demo (in production, use proper sandbox)
                      const result = eval(code);
                      if (result !== undefined) {
                        setLocalExecutionOutput(prev => prev + `→ ${JSON.stringify(result, null, 2)}\n`);
                      }
                    } catch (err: any) {
                      setLocalExecutionOutput(prev => prev + `❌ Error in ${path}: ${err.message}\n`);
                    }
                  }
                }
                
                // Python via Pyodide if available
                if (pythonFiles.length > 0 && pyodideRef.current) {
                  setLocalExecutionOutput(prev => prev + '\n🐍 Running Python via Pyodide...\n');
                  for (const [path, code] of pythonFiles) {
                    try {
                      setLocalExecutionOutput(prev => prev + `\n📄 Running ${path}...\n`);
                      const result = await pyodideRef.current.runPythonAsync(code);
                      if (result) {
                        setLocalExecutionOutput(prev => prev + `→ ${result}\n`);
                      }
                    } catch (err: any) {
                      setLocalExecutionOutput(prev => prev + `❌ Error in ${path}: ${err.message}\n`);
                    }
                  }
                }
                
                setLocalExecutionOutput(prev => prev + '\n✅ Local execution complete!\n');
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
                  <div className="grid grid-cols-3 gap-2 text-xs">
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
                <CardTitle className="text-white flex items-center gap-2 text-sm md:text-base">
                  <CodeIcon className="w-4 h-4 md:w-5 md:h-5" />
                  <span className="hidden sm:inline">Code Preview Panel</span>
                  <span className="sm:hidden">Code</span>
                  <span className="bg-gray-700 text-gray-300 rounded-full px-2 py-0.5 text-xs">
                    {codeBlocks.length}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-1 md:gap-2">
                  <button
                    onClick={downloadAsZip}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center"
                  >
                    <Package className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Download ZIP</span>
                    <span className="sm:hidden">ZIP</span>
                  </button>
                  {(projectStructureWithScopedFiles || projectStructure) && (
                    <button
                      onClick={() => {
                        localStorage.setItem(
                          "visualEditorProject",
                          JSON.stringify(projectStructureWithScopedFiles || projectStructure),
                        );
                        window.open("/visual-editor", "_blank");
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
                    className="text-white text-xs md:text-sm"
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

                <TabsContent value="preview" className="p-2 md:p-4 h-full">
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
                            /{filesystemCurrentPath.replace(/^project\/?/, '') || 'project'}
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
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => handleManualPreview(undefined, 'vite')}
                              title="Preview with Vite build"
                            >
                              ⚡ Vite
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
                          {isFilesystemLoading && (
                            <div className="text-xs text-gray-400 px-2 py-1">
                              Loading filesystem...
                            </div>
                          )}
                          {!isFilesystemLoading && filesystemNodes.length === 0 && (
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
                                    deleteFilesystemPath(node.path).then(() => {
                                      toast.success(`Deleted ${node.name}`);
                                      void listFilesystemDirectory(filesystemCurrentPath);
                                      if (selectedFilesystemPath === node.path) {
                                        setSelectedFilesystemPath('');
                                        setSelectedFilesystemContent('');
                                      }
                                    }).catch(() => toast.error('Failed to delete'));
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
                                      writeFilesystemFile(selectedFilesystemPath, editableContent).then(() => {
                                        setSelectedFilesystemContent(editableContent);
                                        setIsEditingFile(false);
                                        toast.success('File saved');
                                      }).catch(() => toast.error('Failed to save'));
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
                  deleteFilesystemPath(contextMenu.path).then(() => {
                    toast.success('Deleted ' + contextMenu.path.split('/').pop());
                    void listFilesystemDirectory(filesystemCurrentPath);
                    setContextMenu(null);
                    if (selectedFilesystemPath === contextMenu.path) {
                      setSelectedFilesystemPath('');
                      setSelectedFilesystemContent('');
                    }
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
