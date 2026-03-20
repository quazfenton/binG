"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePanel, type PanelTab } from "@/contexts/panel-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  FolderOpen,
  FileText,
  MessageSquare,
  Brain,
  Music,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Plus,
  Trash2,
  ExternalLink,
  LucideHistory,
  RotateCcw,
  RefreshCw,
  Code,
  FileCode,
  Folder,
  ChevronRight,
  ChevronDown,
  X,
  CheckCircle,
  Loader2,
  Sparkles,
  Zap,
  Eye,
  Edit,
  Copy,
  Download,
  Bot,
  Workflow,
  Database,
  Mail,
  Video,
  BookOpen,
  GraduationCap,
  MessageCircle,
  FileSpreadsheet,
  Cloud,
  Music2,
  Mic,
  Share2,
  LineChart,
  Search,
  FileText as FileDoc,
  Clock,
  Youtube,
  Paperclip,
  Maximize2,
  Minimize2,
  Users,
  Heart,
  MessageCircle as MessageComment,
  Send,
  User,
  LogIn,
  Cpu,
  Terminal,
  GitCommit,
  FileDiff,
  Activity,
  Clock3,
  CheckCircle2,
  AlertCircle,
  ChevronUp,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { toast } from "sonner";
import { VersionHistoryPanel } from "@/components/version-history-panel";
import { useVirtualFilesystem } from "@/hooks/use-virtual-filesystem";
import { getOrCreateAnonymousSessionId } from "@/lib/utils";
import type { Message } from "@/types";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import MultiModelComparison from "@/components/multi-model-comparison";
import type { LLMProvider } from "@/lib/chat/providers";
import { resolveScopedPath } from "@/lib/virtual-filesystem/scope-utils";
import { buildApiHeaders } from "@/lib/utils";
import { EnhancedDiffViewer } from "@/components/enhanced-diff-viewer";
import IntegrationPanel from "@/components/integrations/IntegrationPanel";
import { PROVIDERS } from "@/lib/chat/providers";

// Helper to normalize paths to relative format (project/...) for API compatibility
// Moved outside component to avoid recreation on every render
const normalizePath = (path: string): string => {
  if (path.startsWith('project/') || path.startsWith('project')) return path;
  if (path === '/') return 'project';
  // Convert absolute paths like /folder/file to relative project/folder/file
  return path.startsWith('/') ? `project${path}` : `project/${path}`;
};

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  content?: string;
  language?: string;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  duration: string;
  url?: string;
  localPath?: string;
}

// Chat Thread Management - For simultaneous multitasked separate LLM threads
export interface ChatThread {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  taskId?: string;
  lastActiveAt?: number;
}

// Automation data - defined outside component
interface AutomationItem {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'productivity' | 'ai' | 'media' | 'learning';
  available: boolean;
  duration?: string;
  tags: string[];
}

const automationData: AutomationItem[] = [
  { id: 'learn-js', name: 'Learn JavaScript', description: 'Interactive hands-on coding tutorial', icon: Code, category: 'learning', available: true, duration: '~15 min', tags: ['Code', 'JavaScript', 'Interactive'] },
  { id: 'learn-json', name: 'Learn JSON Basics', description: 'Step-by-step interactive tutorial', icon: GraduationCap, category: 'learning', available: true, duration: '~10 min', tags: ['Education', 'JSON', 'Beginner'] },
  { id: 'life-manager', name: 'Personal Life Manager', description: 'Telegram, Google & voice AI', icon: Bot, category: 'productivity', available: false, tags: ['Telegram', 'Google', 'Voice AI'] },
  { id: 'video-gen', name: 'AI Viral Video Generator', description: 'VEO 3 → TikTok automation', icon: Video, category: 'media', available: false, tags: ['VEO 3', 'TikTok', 'Automation'] },
  { id: 'db-chat', name: 'Database Chat', description: 'Natural language database queries', icon: Database, category: 'ai', available: false, tags: ['Database', 'AI', 'NLP'] },
  { id: 'rag-chatbot', name: 'RAG Company Chatbot', description: 'Google Drive + Gemini', icon: BookOpen, category: 'ai', available: false, tags: ['RAG', 'Drive', 'Gemini'] },
  { id: 'gmail-label', name: 'Gmail Auto-Label', description: 'OpenAI + Gmail API', icon: Mail, category: 'productivity', available: false, tags: ['Gmail', 'OpenAI'] },
  { id: 'music-gen', name: 'AI Music Generator', description: 'ElevenLabs + Sheets + Drive', icon: Music2, category: 'media', available: false, tags: ['ElevenLabs', 'Sheets'] },
  { id: 'voice-clone', name: 'AI Voice Cloning', description: 'YouTube → ElevenLabs', icon: Mic, category: 'media', available: false, tags: ['YouTube', 'ElevenLabs'] },
  { id: 'angie', name: 'Angie AI Assistant', description: 'Telegram voice & text AI', icon: MessageCircle, category: 'ai', available: false, tags: ['Telegram', 'Voice', 'AI'] },
  { id: 'nanobanana', name: 'NanoBanana Video Gen', description: 'Auto-share to socials via Blotato', icon: Share2, category: 'media', available: false, tags: ['NanoBanana', 'VEO3', 'Blotato'] },
];

export function ExperimentalWorkspacePanel() {
  const { isOpen, activeTab, closePanel, setTab } = usePanel();
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
  // Chat Thread Management - Multiple simultaneous chat threads
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  
  // Get active thread and its messages
  const activeThread = useMemo(() => 
    chatThreads.find(t => t.id === activeThreadId) || null, 
    [chatThreads, activeThreadId]
  );
  const chatMessages = activeThread?.messages || [];
  
  // GitHub Import state
  const [showGithubImport, setShowGithubImport] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isGithubAuthenticated, setIsGithubAuthenticated] = useState(false);
  const [githubRepos, setGithubRepos] = useState<Array<{ id: number; name: string; fullName: string; description: string; private: boolean; url: string; defaultBranch: string; stars: number; language: string }>>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string; branch: string } | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  
  // Resizable panel width
  const [panelWidth, setPanelWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(400);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelWidth;
  }, [panelWidth]);
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(300, Math.min(800, resizeStartWidth.current + delta));
      setPanelWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Load chat threads from localStorage on mount
  useEffect(() => {
    const savedThreads = localStorage.getItem('experimental-chat-threads');
    const savedActiveId = localStorage.getItem('experimental-active-thread-id');
    if (savedThreads) {
      try {
        const parsed = JSON.parse(savedThreads);
        setChatThreads(parsed);
        // Set active thread to last active or first thread
        if (parsed.length > 0) {
          const activeId = savedActiveId || parsed[0].id;
          setActiveThreadId(activeId);
        }
      } catch (e) {
        console.error('Failed to load chat threads:', e);
      }
    } else {
      // Create default thread for backward compatibility
      const defaultThread: ChatThread = {
        id: `thread-${Date.now()}`,
        name: 'Default Thread',
        messages: [],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      setChatThreads([defaultThread]);
      setActiveThreadId(defaultThread.id);
    }
  }, []);

  // Save chat threads to localStorage whenever they change
  useEffect(() => {
    if (chatThreads.length > 0) {
      localStorage.setItem('experimental-chat-threads', JSON.stringify(chatThreads));
    }
  }, [chatThreads]);

  // Save active thread ID
  useEffect(() => {
    if (activeThreadId) {
      localStorage.setItem('experimental-active-thread-id', activeThreadId);
    }
  }, [activeThreadId]);

  // Thread management functions
  const createNewThread = useCallback((name?: string) => {
    const newThread: ChatThread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: name || `Thread ${chatThreads.length + 1}`,
      messages: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    setChatThreads(prev => [...prev, newThread]);
    setActiveThreadId(newThread.id);
    return newThread.id;
  }, [chatThreads.length]);

  const switchThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    // Update last active time
    setChatThreads(prev => prev.map(t => 
      t.id === threadId ? { ...t, lastActiveAt: Date.now() } : t
    ));
  }, []);

  const deleteThread = useCallback((threadId: string) => {
    setChatThreads(prev => {
      const filtered = prev.filter(t => t.id !== threadId);
      // If we deleted the active thread, switch to another
      if (threadId === activeThreadId && filtered.length > 0) {
        setActiveThreadId(filtered[0].id);
      }
      return filtered;
    });
  }, [activeThreadId]);

  const renameThread = useCallback((threadId: string, newName: string) => {
    setChatThreads(prev => prev.map(t => 
      t.id === threadId ? { ...t, name: newName } : t
    ));
  }, []);

  // Update messages for active thread
  const setThreadMessages = useCallback((messages: Message[]) => {
    setChatThreads(prev => prev.map(t => 
      t.id === activeThreadId ? { ...t, messages, lastActiveAt: Date.now() } : t
    ));
  }, [activeThreadId]);
  const [thinkingNotes, setThinkingNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState("");

  // Load thinking notes from localStorage on mount
  useEffect(() => {
    const savedNotes = localStorage.getItem('experimental-thinking-notes');
    if (savedNotes) {
      try {
        setThinkingNotes(JSON.parse(savedNotes));
      } catch (e) {
        console.error('Failed to load thinking notes:', e);
      }
    }
  }, []);

  // Save thinking notes to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('experimental-thinking-notes', JSON.stringify(thinkingNotes));
  }, [thinkingNotes]);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);

  // Load playlist from localStorage on mount
  useEffect(() => {
    const savedPlaylist = localStorage.getItem('experimental-music-playlist');
    if (savedPlaylist) {
      try {
        setPlaylist(JSON.parse(savedPlaylist));
      } catch (e) {
        console.error('Failed to load playlist:', e);
      }
    }
  }, []);

  // Save playlist to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('experimental-music-playlist', JSON.stringify(playlist));
  }, [playlist]);
  
  // YouTube state - Default: Lofi Hip Hop Radio
  const [youtubeVideoId, setYoutubeVideoId] = useState("jfKfPfyJRdk");
  const [isYoutubeFullscreen, setIsYoutubeFullscreen] = useState(true);

  // Load YouTube video ID from localStorage
  useEffect(() => {
    const savedVideoId = localStorage.getItem('experimental-youtube-video');
    if (savedVideoId) {
      setYoutubeVideoId(savedVideoId);
    }
  }, []);

  // Save YouTube video ID to localStorage
  useEffect(() => {
    localStorage.setItem('experimental-youtube-video', youtubeVideoId);
  }, [youtubeVideoId]);
  
  // Agent status display state
  const [showAgentStatus, setShowAgentStatus] = useState(false);
  
  // Forum state
  interface ForumPost {
    id: string;
    author: string;
    content: string;
    timestamp: number;
    likes: number;
    comments: ForumComment[];
    isAnonymous: boolean;
  }
  
  interface ForumComment {
    id: string;
    author: string;
    content: string;
    timestamp: number;
    isAnonymous: boolean;
  }
  
  const [forumPosts, setForumPosts] = useState<ForumPost[]>([
    {
      id: "1",
      author: "TechEnthusiast",
      content: "Welcome to the global forum! Share your thoughts, ideas, and notes here.",
      timestamp: Date.now() - 3600000,
      likes: 5,
      comments: [
        {
          id: "c1",
          author: "Anonymous",
          content: "Great idea! Love this feature.",
          timestamp: Date.now() - 1800000,
          isAnonymous: true,
        },
      ],
      isAnonymous: false,
    },
  ]);
  const [newPostContent, setNewPostContent] = useState("");
  const [isAnonymousPost, setIsAnonymousPost] = useState(true);

  // Automation tab state
  const [automationCategory, setAutomationCategory] = useState('all');
  const [automationSearch, setAutomationSearch] = useState('');

  // Filter automations based on category and search
  const filteredAutomations = React.useMemo(() => {
    return automationData.filter(automation => {
      const matchesCategory = automationCategory === 'all' || automation.category === automationCategory;
      const matchesSearch = !automationSearch || 
        automation.name.toLowerCase().includes(automationSearch.toLowerCase()) ||
        automation.description.toLowerCase().includes(automationSearch.toLowerCase()) ||
        automation.tags.some(tag => tag.toLowerCase().includes(automationSearch.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [automationCategory, automationSearch]);

  // Separate available and coming soon
  const availableAutomations = filteredAutomations.filter(a => a.available);
  const comingSoonAutomations = filteredAutomations.filter(a => !a.available);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [newCommentContent, setNewCommentContent] = useState<{[key: string]: string}>({});

  // Load forum posts from localStorage on mount
  useEffect(() => {
    const savedPosts = localStorage.getItem('experimental-forum-posts');
    if (savedPosts) {
      try {
        const parsed = JSON.parse(savedPosts);
        setForumPosts(parsed);
      } catch (e) {
        console.error('Failed to load forum posts:', e);
      }
    }
  }, []);

  // Save forum posts to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('experimental-forum-posts', JSON.stringify(forumPosts));
  }, [forumPosts]);
  
  // Agent Activity state
  interface ToolInvocation {
    id: string;
    toolName: string;
    state: 'partial-call' | 'call' | 'result';
    args?: Record<string, any>;
    result?: any;
    timestamp: number;
  }
  
  interface ReasoningChunk {
    id: string;
    type: 'thought' | 'plan' | 'reasoning' | 'reflection';
    content: string;
    timestamp: number;
  }
  
  interface ProcessingStep {
    id: string;
    step: string;
    status: 'pending' | 'started' | 'completed' | 'failed';
    stepIndex: number;
    timestamp: number;
  }
  
  interface GitCommit {
    version: number;
    filesChanged: number;
    paths: string[];
    timestamp: number;
  }
  
  interface AgentActivity {
    status: 'idle' | 'thinking' | 'executing' | 'completed';
    currentAction: string;
    toolInvocations: ToolInvocation[];
    reasoningChunks: ReasoningChunk[];
    processingSteps: ProcessingStep[];
    gitCommits: GitCommit[];
    diffs: Array<{ path: string; diff: string; changeType: string }>;
    tokenUsage?: { prompt: number; completion: number; total: number };
  }
  
  const [agentActivity, setAgentActivity] = useState<AgentActivity>({
    status: 'idle',
    currentAction: '',
    toolInvocations: [],
    reasoningChunks: [],
    processingSteps: [],
    gitCommits: [],
    diffs: [],
  });
  
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(true);
  const [showSteps, setShowSteps] = useState(true);
  
  // Get agent activity from hook (will be wired later)
  // For now, using local state that can be updated by parent component via props
  const { agentActivity: externalAgentActivity, setAgentActivity: setExternalAgentActivity } =
    typeof window !== 'undefined' 
      ? (window as any).__agentActivity || { agentActivity: undefined, setAgentActivity: undefined }
      : { agentActivity: undefined, setAgentActivity: undefined };

  const vfs = useVirtualFilesystem();
  const {
    currentPath,
    nodes,
    writeFile,
    listDirectory,
  } = vfs;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // File creation state
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [creatingParentPath, setCreatingParentPath] = useState("/");

  // File operations state (cut/copy/paste, rename, drag-drop)
  const [clipboard, setClipboard] = useState<{ sourcePath: string; operation: 'cut' | 'copy' } | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggedFile, setDraggedFile] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmDialogData, setConfirmDialogData] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // VFS snapshot state
  const [vfsSnapshot, setVfsSnapshot] = useState<{ files: Array<{ path: string; content: string; language: string }> } | null>(null);

  // Filesystem state (alias for vfsSnapshot with additional metadata)
  const [filesystem, setFilesystem] = useState<{
    sessionId: string;
    version: number;
    files: Array<{ path: string; content: string; language: string }>
  } | null>(null);

  // Available LLM providers for comparison
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>([]);

  // Load available LLM providers
  useEffect(() => {
    try {
      // Convert PROVIDERS object to array
      const providers = Object.values(PROVIDERS);
      setAvailableProviders(providers);
    } catch (error) {
      console.error('Failed to load LLM providers:', error);
    }
  }, []);

  // Fetch VFS snapshot on mount
  useEffect(() => {
    const fetchSnapshot = async () => {
      try {
        const snapshot = await vfs.getSnapshot();
        setVfsSnapshot(snapshot);
        
        // Auto-expand all folders on initial load
        if (snapshot?.files) {
          const folders = new Set<string>();
          snapshot.files.forEach((file: { path: string }) => {
            const parts = file.path.split("/").filter(Boolean);
            // Add each folder path to expanded set
            for (let i = 1; i < parts.length; i++) {
              const folderPath = "/" + parts.slice(0, i).join("/");
              folders.add(folderPath);
            }
          });
          setExpandedFolders(folders);
        }
        
        // Initialize filesystem state with snapshot data
        // Use stable session ID from user session (not Date.now() which changes on refresh)
        const stableSessionId = `session-${getOrCreateAnonymousSessionId()}`;
        setFilesystem({
          sessionId: stableSessionId,
          version: snapshot?.version || 1,
          files: snapshot?.files || [],
        });
      } catch (error) {
        console.error('Failed to fetch VFS snapshot:', error);
      }
    };
    fetchSnapshot();
  }, [vfs.getSnapshot]);

  // Build file tree from filesystem
  const fileTree = React.useMemo(() => {
    const files = vfsSnapshot?.files || [];
    const root: FileNode = {
      name: "workspace",
      path: "/",
      type: "directory",
      children: [],
    };

    files.forEach((file) => {
      const parts = file.path.split("/").filter(Boolean);
      let current = root;

      parts.forEach((part, index) => {
        const isFile = index === parts.length - 1;
        const existing = current.children?.find((child) => child.name === part);

        if (existing) {
          current = existing;
        } else {
          const newNode: FileNode = {
            name: part,
            path: "/" + parts.slice(0, index + 1).join("/"),
            type: isFile ? "file" : "directory",
            children: isFile ? undefined : [],
            content: isFile ? file.content : undefined,
            language: isFile ? file.language : undefined,
          };

          current.children?.push(newNode);
          current = newNode;
        }
      });
    });

    return root;
  }, [vfsSnapshot?.files]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Handle audio playback
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (audioRef.current && isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else if (audioRef.current && !isPlaying) {
      audioRef.current.pause();
    }
  }, [isPlaying, currentSongIndex, playlist]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileSelect = useCallback((file: FileNode) => {
    setSelectedFile(file);
    toast.success("File selected", {
      description: file.path,
    });
  }, []);

  const handleSendChat = useCallback(async (customPrompt?: string) => {
    const promptToSend = customPrompt || chatInput.trim();
    if (!promptToSend && !isChatLoading) return;
    if (isChatLoading) return;
    if (!activeThreadId) {
      // Create a new thread if none exists
      createNewThread();
    }

    const userMessage: Message = {
      id: `exp-chat-${Date.now()}`,
      role: "user",
      content: promptToSend,
      timestamp: new Date().toISOString(),
    };

    setThreadMessages([...chatMessages, userMessage]);
    if (!customPrompt) setChatInput("");
    setIsChatLoading(true);

    // Streaming state
    let streamedContent = '';
    let assistantMessageId = `exp-chat-${Date.now()}`;
    const vfsScope = filesystem?.sessionId || 'project/sessions/default';

    // Add placeholder assistant message for streaming updates
    const placeholderMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
    setThreadMessages([...chatMessages, userMessage, placeholderMessage]);

    // SSE Event type constants (matching backend)
    const SSE_EVENT_TYPES = {
      TOKEN: 'token',
      TOOL_INVOCATION: 'tool_invocation',
      STEP: 'step',
      FILESYSTEM: 'filesystem',
      DIFFS: 'diffs',
      REASONING: 'reasoning',
      SANDBOX_OUTPUT: 'sandbox_output',
      DONE: 'done',
      ERROR: 'error',
      HEARTBEAT: 'heartbeat',
    } as const;

    try {
      // Get the current chat messages as the messages array
      const messagesPayload = [
        ...chatMessages.map(m => ({ role: m.role, content: m.content })),
        {
          role: 'user' as const,
          content: attachedFiles.length > 0
            ? `${promptToSend}\n\n--- Attached Files for Context ---\n${attachedFiles.map(f => `File: ${f.path}\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``).join('\n\n')}`
            : promptToSend
        }
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesPayload,
          provider: 'openrouter',
          model: 'nvidia/nemotron-3-nano-30b-a3b:free',
          stream: true, // Enable SSE streaming
          conversationId: `exp-workspace-thread-${activeThreadId}`,
          agentMode: 'auto',
          filesystemContext: {
            scopePath: vfsScope,
            attachedFiles: attachedFiles.map(f => ({
              path: f.path,
              content: f.content,
            })),
            applyFileEdits: true,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      // Process SSE stream
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE events in buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          // Parse SSE format: "event: type\ndata: {json}"
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            continue;
          }
          
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            
            try {
              const data = JSON.parse(dataStr);
              
              switch (data.type) {
                case SSE_EVENT_TYPES.TOKEN:
                  // Streaming token - update message in real-time
                  if (data.data?.content) {
                    streamedContent += data.data.content;
                    setThreadMessages(chatMessages.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: streamedContent }
                        : msg
                    ));
                  }
                  break;

                case SSE_EVENT_TYPES.STEP:
                  // Update processing steps
                  if (data.data) {
                    setAgentActivity((prev) => ({
                      ...prev,
                      status: data.data.status === 'started' ? 'thinking' : prev.status,
                      currentAction: data.data.step || prev.currentAction,
                    }));
                  }
                  break;

                case SSE_EVENT_TYPES.TOOL_INVOCATION:
                  // Track tool calls
                  if (data.data) {
                    setAgentActivity((prev) => ({
                      ...prev,
                      status: 'executing',
                      toolInvocations: [...prev.toolInvocations, data.data],
                    }));
                  }
                  break;

                case SSE_EVENT_TYPES.FILESYSTEM:
                  // Handle filesystem operations
                  if (data.data?.applied && data.data.applied.length > 0) {
                    console.log('[ExperimentalWorkspace] Filesystem operations:', data.data.applied);

                    // Refresh VFS snapshot
                    const snapshot = await vfs.getSnapshot();
                    setVfsSnapshot(snapshot);
                    setFilesystem({
                      sessionId: vfsScope,
                      version: snapshot?.version || 1,
                      files: snapshot?.files || [],
                    });

                    toast.success(`Applied ${data.data.applied.length} file changes`);
                  }
                  if (data.data?.errors?.length > 0) {
                    console.warn('[ExperimentalWorkspace] Filesystem errors:', data.data.errors);
                    toast.error(`Errors: ${data.data.errors[0]}`);
                  }
                  break;

                case SSE_EVENT_TYPES.DIFFS:
                  // Handle diffs
                  if (data.data?.diffs) {
                    setAgentActivity((prev) => ({
                      ...prev,
                      status: 'completed',
                      diffs: [...prev.diffs, ...data.data.diffs],
                    }));
                  }
                  break;

                case SSE_EVENT_TYPES.REASONING:
                  // Handle reasoning/thinking
                  if (data.data?.content) {
                    setAgentActivity((prev) => ({
                      ...prev,
                      status: 'thinking',
                      reasoningChunks: [...prev.reasoningChunks, {
                        id: `reason-${Date.now()}`,
                        type: 'thought',
                        content: data.data.content,
                        timestamp: Date.now(),
                      }],
                    }));
                  }
                  break;

                case SSE_EVENT_TYPES.ERROR:
                  // Handle errors
                  console.error('[ExperimentalWorkspace] Stream error:', data.data);
                  toast.error(data.data?.message || 'Stream error occurred');
                  break;

                case SSE_EVENT_TYPES.DONE:
                  // Stream completed
                  setAgentActivity((prev) => ({
                    ...prev,
                    status: 'completed',
                    currentAction: 'Completed',
                  }));

                  // Finalize the message
                  setThreadMessages(chatMessages.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: streamedContent || data.data?.content || "Response completed",
                          timestamp: new Date().toISOString(),
                        }
                      : msg
                  ));
                  break;
              }
            } catch (parseError) {
              // Skip malformed JSON
              console.warn('[ExperimentalWorkspace] Failed to parse SSE data:', dataStr);
            }
          }
        }
      }

      // If no done event, ensure message is finalized
      setThreadMessages(chatMessages.map((msg) =>
        msg.id === assistantMessageId && !msg.content
          ? { ...msg, content: streamedContent || "Response completed" }
          : msg
      ));

    } catch (error) {
      console.error('[ExperimentalWorkspace] Chat error:', error);
      toast.error('Chat failed. Check console for details.');

      // Remove placeholder message on error
      setThreadMessages(chatMessages.filter((msg) => msg.id !== assistantMessageId));
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, isChatLoading, chatMessages, filesystem, vfs, attachedFiles, activeThreadId, setThreadMessages, createNewThread]);

  // YouTube helper functions
  const getYouTubeEmbedUrl = useCallback((urlOrId: string): string => {
    const playlistMatch = urlOrId.match(/[&?]list=([a-zA-Z0-9_-]+)/) || urlOrId.match(/playlist\?list=([a-zA-Z0-9_-]+)/);
    if (playlistMatch) {
      return `https://www.youtube.com/embed?listType=playlist&list=${playlistMatch[1]}&autoplay=1`;
    }

    let videoId = urlOrId;
    if (urlOrId.includes('youtube.com') || urlOrId.includes('youtu.be')) {
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      ];
      for (const pattern of patterns) {
        const match = urlOrId.match(pattern);
        if (match) {
          videoId = match[1];
          break;
        }
      }
    }
    
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      videoId = 'jfKfPfyJRdk';
    }
    
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}`;
  }, []);

  const extractYouTubeId = useCallback((urlOrId: string): string | null => {
    if (!urlOrId) return null;
    
    // If it's already just an ID (11 characters, alphanumeric with - and _)
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
      return urlOrId;
    }
    
    // Standard YouTube URL: https://www.youtube.com/watch?v=VIDEO_ID
    const watchMatch = urlOrId.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) {
      return watchMatch[1];
    }
    
    // Shortened URL: https://youtu.be/VIDEO_ID
    const shortMatch = urlOrId.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) {
      return shortMatch[1];
    }
    
    // Embed URL: https://www.youtube.com/embed/VIDEO_ID
    const embedMatch = urlOrId.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      return embedMatch[1];
    }
    
    return null;
  }, []);

  const clearChatHistory = useCallback(() => {
    if (!activeThreadId) return;
    setThreadMessages([]);
    toast.success("Chat history cleared");
  }, [activeThreadId, setThreadMessages]);

  const exportChatHistory = useCallback(() => {
    const chatText = chatMessages.map((msg) => 
      `[${new Date(msg.timestamp).toLocaleString()}] ${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`
    ).join('\n\n');
    navigator.clipboard.writeText(chatText);
    toast.success("Chat history copied to clipboard");
  }, [chatMessages]);

  const addThinkingNote = useCallback(() => {
    if (!newNote.trim()) return;
    setThinkingNotes((prev) => [...prev, newNote.trim()]);
    setNewNote("");
    toast.success("Note added to thinking area");
  }, [newNote]);

  const removeThinkingNote = useCallback((index: number) => {
    setThinkingNotes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAllNotes = useCallback(() => {
    setThinkingNotes([]);
    toast.success("All notes cleared");
  }, []);

  const exportNotes = useCallback(() => {
    const notesText = thinkingNotes.map((note, i) => `${i + 1}. ${note}`).join('\n\n');
    navigator.clipboard.writeText(notesText);
    toast.success("Notes copied to clipboard");
  }, [thinkingNotes]);

  // Forum actions
  const handleCreatePost = useCallback(() => {
    if (!newPostContent.trim()) return;
    
    const newPost: ForumPost = {
      id: Date.now().toString(),
      author: isAnonymousPost ? "Anonymous" : "You",
      content: newPostContent.trim(),
      timestamp: Date.now(),
      likes: 0,
      comments: [],
      isAnonymous: isAnonymousPost,
    };
    
    setForumPosts((prev) => [newPost, ...prev]);
    setNewPostContent("");
    toast.success("Post published", { description: "Your post is now visible to everyone" });
  }, [newPostContent, isAnonymousPost]);

  const handleLikePost = useCallback((postId: string) => {
    setForumPosts((prev) => prev.map(p =>
      p.id === postId ? { ...p, likes: p.likes + 1 } : p
    ));
  }, []);

  const handleAddComment = useCallback((postId: string, content: string) => {
    if (!content.trim()) return;
    
    const newComment: ForumComment = {
      id: Date.now().toString(),
      author: "Anonymous",
      content: content.trim(),
      timestamp: Date.now(),
      isAnonymous: true,
    };
    
    setForumPosts((prev) => prev.map(p =>
      p.id === postId ? { ...p, comments: [...p.comments, newComment] } : p
    ));
    
    // Clear the comment input for this post
    setNewCommentContent((prev) => ({
      ...prev,
      [postId]: "",
    }));
    
    toast.success("Comment added");
  }, []);

  const handleToggleComments = useCallback((postId: string) => {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);

  const addSongToPlaylist = useCallback(() => {
    const newSong: Song = {
      id: `song-${Date.now()}`,
      title: "New Song",
      artist: "Unknown Artist",
      duration: "0:00",
    };
    setPlaylist((prev) => [...prev, newSong]);
    toast.success("Song added to playlist");
  }, []);

  const removeSong = useCallback((index: number) => {
    setPlaylist((prev) => prev.filter((_, i) => i !== index));
    if (index === currentSongIndex) {
      setIsPlaying(false);
      setCurrentSongIndex(0);
    } else if (index < currentSongIndex) {
      setCurrentSongIndex((prev) => prev - 1);
    }
  }, [currentSongIndex]);

  const clearPlaylist = useCallback(() => {
    setPlaylist([]);
    setIsPlaying(false);
    setCurrentSongIndex(0);
    toast.success("Playlist cleared");
  }, []);

  const playSong = useCallback((index: number) => {
    setCurrentSongIndex(index);
    setIsPlaying(true);
  }, []);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const nextSong = useCallback(() => {
    setCurrentSongIndex((prev) => (prev + 1) % playlist.length);
    setIsPlaying(true);
  }, [playlist.length]);

  const prevSong = useCallback(() => {
    setCurrentSongIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
    setIsPlaying(true);
  }, [playlist.length]);

  const moveSongUp = useCallback((index: number) => {
    if (index === 0) return;
    setPlaylist((prev) => {
      const newList = [...prev];
      [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
      return newList;
    });
    if (index === currentSongIndex) {
      setCurrentSongIndex(index - 1);
    } else if (index - 1 === currentSongIndex) {
      setCurrentSongIndex(index);
    }
  }, [currentSongIndex]);

  const moveSongDown = useCallback((index: number) => {
    setPlaylist((prev) => {
      if (index >= prev.length - 1) return prev;
      const newList = [...prev];
      [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
      return newList;
    });
    if (index === currentSongIndex) {
      setCurrentSongIndex(index + 1);
    } else if (index + 1 === currentSongIndex) {
      setCurrentSongIndex(index);
    }
  }, [currentSongIndex]);

  // File creation handlers
  const handleCreateFile = useCallback(async (parentPath: string) => {
    setIsCreatingFile(true);
    setCreatingParentPath(parentPath);
    setNewItemName("");
  }, []);

  const handleCreateFolder = useCallback(async (parentPath: string) => {
    setIsCreatingFolder(true);
    setCreatingParentPath(parentPath);
    setNewItemName("");
  }, []);

  const confirmCreateFile = useCallback(async () => {
    if (!newItemName.trim()) {
      setIsCreatingFile(false);
      return;
    }

    const cleanParentPath = creatingParentPath.replace(/\/+$/, '');
    // Use shared normalizePath helper for API compatibility
    const normalizedParentPath = normalizePath(cleanParentPath);
    const newPath = `${normalizedParentPath}/${newItemName.trim()}`;

    try {
      await writeFile(newPath, '');
      await listDirectory(normalizedParentPath);
      toast.success(`File created: ${newItemName.trim()}`);
      setIsCreatingFile(false);
      setNewItemName("");
    } catch (err: any) {
      toast.error(`Failed to create file: ${err.message}`);
      setIsCreatingFile(false);
    }
  }, [newItemName, creatingParentPath, writeFile, listDirectory]);

  const confirmCreateFolder = useCallback(async () => {
    if (!newItemName.trim()) {
      setIsCreatingFolder(false);
      return;
    }

    const cleanParentPath = creatingParentPath.replace(/\/+$/, '');
    // Use shared normalizePath helper for API compatibility
    const normalizedParentPath = normalizePath(cleanParentPath);
    const folderPath = `${normalizedParentPath}/${newItemName.trim()}`;
    const gitkeepPath = `${folderPath}/.gitkeep`;

    try {
      await writeFile(gitkeepPath, '');
      await listDirectory(normalizedParentPath);
      toast.success(`Folder created: ${newItemName.trim()}`);
      setIsCreatingFolder(false);
      setNewItemName("");
    } catch (err: any) {
      toast.error(`Failed to create folder: ${err.message}`);
      setIsCreatingFolder(false);
    }
  }, [newItemName, creatingParentPath, writeFile, listDirectory]);

  const cancelCreate = useCallback(() => {
    setIsCreatingFile(false);
    setIsCreatingFolder(false);
    setNewItemName("");
  }, []);

  // File operation handlers
  const handleCutFile = useCallback((path: string) => {
    setClipboard({ sourcePath: path, operation: 'cut' });
    toast.info('File cut - click paste in a folder');
  }, []);

  const handleCopyFile = useCallback((path: string) => {
    setClipboard({ sourcePath: path, operation: 'copy' });
    toast.info('File copied - click paste in a folder');
  }, []);

  const handlePasteToFolder = useCallback(async (targetFolderPath: string, currentClipboard?: typeof clipboard) => {
    const activeClipboard = currentClipboard || clipboard;
    if (!activeClipboard) return;

    const sourceName = activeClipboard.sourcePath.split('/').pop() || '';
    // Normalize target path to relative format (fixes 400 error)
    const normalizedTargetFolder = normalizePath(targetFolderPath);
    const targetPath = `${normalizedTargetFolder}/${sourceName}`;

    // Bail out when the target path equals the source path (normalize source for comparison)
    const normalizedSource = normalizePath(activeClipboard.sourcePath);
    if (targetPath === normalizedSource) {
      toast.info('Cannot paste file into itself');
      return;
    }

    // Check if target exists
    const exists = vfsSnapshot?.files.some(f => f.path === targetPath);
    if (exists) {
      setConfirmDialogData({
        title: 'File Exists',
        message: `A file named "${sourceName}" already exists in this folder. Overwrite?`,
        onConfirm: async () => {
          await performPaste(targetPath, activeClipboard);
          setShowConfirmDialog(false);
          setConfirmDialogData(null);
        },
      });
      setShowConfirmDialog(true);
      return;
    }

    await performPaste(targetPath, activeClipboard);
  }, [clipboard, vfsSnapshot?.files]);

  const performPaste = async (targetPath: string, currentClipboard?: typeof clipboard) => {
    const activeClipboard = currentClipboard || clipboard;
    if (!activeClipboard) return;

    try {
      // Read source file
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(activeClipboard.sourcePath, vfs?.currentPath || '/') }),
      });

      if (!readResponse.ok) {
        throw new Error('Failed to read source file');
      }

      const payload = await readResponse.json().catch(() => null);
      const content = payload?.data?.content || '';

      // Write to target
      await writeFile(targetPath, content);

      // If cut, delete source
      if (activeClipboard.operation === 'cut') {
        const deleteResponse = await fetch('/api/filesystem/delete', {
          method: 'POST',
          headers: buildApiHeaders(),
          body: JSON.stringify({ path: resolveScopedPath(activeClipboard.sourcePath, vfs?.currentPath || '/') }),
        });
        if (!deleteResponse.ok) {
          throw new Error('Failed to delete source file');
        }
      }

      await listDirectory(vfs?.currentPath || '/');
      toast.success(`File ${activeClipboard.operation === 'cut' ? 'moved' : 'copied'} successfully`);
      setClipboard(null);
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
    }
  };

  const handleRenameFile = useCallback((path: string, currentName: string) => {
    setRenamingFile(path);
    setRenameValue(currentName);
  }, []);

  const confirmRename = useCallback(async () => {
    if (!renamingFile || !renameValue.trim()) {
      setRenamingFile(null);
      return;
    }

    const oldName = renamingFile.split('/').pop() || '';
    if (renameValue.trim() === oldName) {
      setRenamingFile(null);
      return;
    }

    const parentPath = renamingFile.substring(0, renamingFile.lastIndexOf('/')) || '/';
    // Normalize path to relative format (fixes 400 error)
    const normalizedParentPath = normalizePath(parentPath);
    const newPath = `${normalizedParentPath}/${renameValue.trim()}`;

    // Check if new name exists
    const exists = vfsSnapshot?.files.some(f => f.path === newPath && f.path !== renamingFile);
    if (exists) {
      setConfirmDialogData({
        title: 'File Exists',
        message: `A file named "${renameValue.trim()}" already exists. Overwrite?`,
        onConfirm: async () => {
          await performRename(newPath, renamingFile);
          setShowConfirmDialog(false);
          setConfirmDialogData(null);
        },
      });
      setShowConfirmDialog(true);
      return;
    }

    await performRename(newPath, renamingFile);
  }, [renamingFile, renameValue, vfsSnapshot?.files]);

  const performRename = async (newPath: string, oldPath: string) => {
    if (!oldPath) return;

    try {
      // Read source
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(oldPath, vfs?.currentPath || '/') }),
      });

      if (!readResponse.ok) throw new Error('Failed to read file');
      const payload = await readResponse.json().catch(() => null);
      const content = payload?.data?.content || '';

      // Write to new path
      await writeFile(newPath, content);

      // Delete old
      await fetch('/api/filesystem/delete', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(renamingFile, vfs?.currentPath || '/') }),
      });

      await listDirectory(vfs?.currentPath || '/');
      toast.success('File renamed successfully');
      setRenamingFile(null);
      setRenameValue("");
    } catch (err: any) {
      toast.error(`Rename failed: ${err.message}`);
      setRenamingFile(null);
    }
  };

  const cancelRename = useCallback(() => {
    setRenamingFile(null);
    setRenameValue("");
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((path: string) => {
    setDraggedFile(path);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    setDragOverFolder(folderPath);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverFolder(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderPath: string) => {
    e.preventDefault();
    setDragOverFolder(null);

    if (!draggedFile || draggedFile === targetFolderPath) {
      setDraggedFile(null);
      return;
    }

    const fileName = draggedFile.split('/').pop() || '';
    // Normalize target path to relative format (fixes 400 error)
    const normalizedTargetFolder = normalizePath(targetFolderPath);
    const targetPath = `${normalizedTargetFolder}/${fileName}`;

    // Check if target exists
    const exists = vfsSnapshot?.files.some(f => f.path === targetPath && f.path !== draggedFile);
    if (exists) {
      setConfirmDialogData({
        title: 'File Exists',
        message: `A file named "${fileName}" already exists in this folder. Overwrite?`,
        onConfirm: async () => {
          await performMove(targetPath, draggedFile);
          setShowConfirmDialog(false);
          setConfirmDialogData(null);
        },
      });
      setShowConfirmDialog(true);
      setDraggedFile(null);
      return;
    }

    // Normalize source path for proper self-move check
    await performMove(targetPath, normalizePath(draggedFile));
    setDraggedFile(null);
  }, [draggedFile, vfsSnapshot?.files]);

  const performMove = async (targetPath: string, sourcePath: string) => {
    if (!sourcePath) return;

    // Bail out when the target path equals the source path
    if (targetPath === sourcePath) {
      return;
    }

    try {
      // Read source
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(sourcePath, vfs?.currentPath || '/') }),
      });

      if (!readResponse.ok) throw new Error('Failed to read file');
      const payload = await readResponse.json().catch(() => null);
      const content = payload?.data?.content || '';

      // Write to target
      await writeFile(targetPath, content);

      // Delete source
      const deleteResponse = await fetch('/api/filesystem/delete', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(sourcePath, vfs?.currentPath || '/') }),
      });
      if (!deleteResponse.ok) throw new Error('Failed to delete source file');

      await listDirectory(vfs?.currentPath || '/');
      toast.success('File moved successfully');
    } catch (err: any) {
      toast.error(`Move failed: ${err.message}`);
    }
  };

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isDirectory: boolean } | null>(null);

  const renderFileTree = useCallback((node: FileNode, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const indent = depth * 16;

    if (node.type === "directory") {
      // Check if this folder is drag target
      const isDragTarget = dragOverFolder === node.path;

      return (
        <div 
          key={node.path} 
          className="group"
          onDragOver={(e) => handleDragOver(e, node.path)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.path)}
        >
          <div className={`flex items-center rounded ${isDragTarget ? 'bg-cyan-500/30 border border-cyan-500/50' : ''}`}>
            <button
              onClick={() => toggleFolder(node.path)}
              onDoubleClick={() => handleRenameFile(node.path, node.name)}
              className="flex items-center gap-1 w-full px-2 py-1 hover:bg-white/10 rounded text-left text-sm transition-colors"
              style={{ paddingLeft: indent + 8 }}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-white/60" />
              ) : (
                <ChevronRight className="h-3 w-3 text-white/60" />
              )}
              <Folder className="h-3 w-3 text-blue-400" />
              {renamingFile === node.path ? (
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  onBlur={confirmRename}
                  className="h-5 text-xs bg-black/50 border-white/30"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="text-white/80">{node.name}</span>
              )}
            </button>
            {/* Paste button when clipboard has content */}
            {clipboard && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePasteToFolder(node.path);
                }}
                className="p-1 hover:bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity text-green-400"
                title="Paste file here"
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
            {/* Add file button for folders */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCreateFile(node.path);
              }}
              className="p-1 hover:bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="New File in Folder"
            >
              <Plus className="h-3 w-3 text-white/60" />
            </button>
          </div>
          <AnimatePresence>
            {isExpanded && node.children && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {node.children.map((child) => renderFileTree(child, depth + 1))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    // File node
    return (
      <div
        key={node.path}
        draggable
        onDragStart={() => handleDragStart(node.path)}
        onClick={() => handleFileSelect(node)}
        onDoubleClick={() => handleRenameFile(node.path, node.name)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, path: node.path, isDirectory: false });
        }}
        className={`flex items-center gap-2 w-full px-2 py-1 hover:bg-white/10 rounded text-left text-sm transition-colors cursor-pointer ${
          selectedFile?.path === node.path ? "bg-white/20" : ""
        }`}
        style={{ paddingLeft: indent + 24 }}
      >
        <FileCode className="h-3 w-3 text-green-400 flex-shrink-0" />
        {renamingFile === node.path ? (
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
              if (e.key === 'Escape') cancelRename();
            }}
            onBlur={confirmRename}
            className="h-5 text-xs bg-black/50 border-white/30 flex-1 min-w-0"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-white/80 truncate">{node.name}</span>
        )}
        {/* Hover actions */}
        <div className="hidden group-hover:flex gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCutFile(node.path);
            }}
            className="p-0.5 hover:bg-white/10 rounded"
            title="Cut"
          >
            <Edit className="h-3 w-3 text-yellow-400" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopyFile(node.path);
            }}
            className="p-0.5 hover:bg-white/10 rounded"
            title="Copy"
          >
            <Copy className="h-3 w-3 text-blue-400" />
          </button>
        </div>
      </div>
    );
  }, [expandedFolders, selectedFile, toggleFolder, handleFileSelect, handleCreateFile, handleRenameFile, renamingFile, renameValue, confirmRename, cancelRename, clipboard, handlePasteToFolder, dragOverFolder, handleDragOver, handleDragLeave, handleDrop, handleDragStart, handleCutFile, handleCopyFile]);

  // Check GitHub auth status and fetch repos when modal opens
  useEffect(() => {
    if (!showGithubImport) return;

    const checkAuth = async () => {
      try {
        // Call the integrations endpoint to check auth status
        const response = await fetch('/api/integrations/github');
        if (response.ok) {
          const data = await response.json();
          setIsGithubAuthenticated(true);
          if (data.repos) {
            setGithubRepos(data.repos);
          }
        } else if (response.status === 401) {
          // 401 means GitHub is not connected via Auth0
          setIsGithubAuthenticated(false);
        }
      } catch {
        setIsGithubAuthenticated(false);
      }
    };

    checkAuth();
  }, [showGithubImport]);

  const handleSignInWithGithub = () => {
    // Use Auth0 Connected Accounts endpoint for GitHub OAuth
    window.location.href = '/auth/connect?connection=github';
  };

  const handleFetchRepos = async () => {
    setIsLoadingRepos(true);
    try {
      const response = await fetch('/api/integrations/github');
      const data = await response.json();
      if (data.repos) {
        setGithubRepos(data.repos);
      }
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const handleImportFromRepo = async (repo: { owner: string; repo: string; branch: string }) => {
    const { owner, repo: repoName, branch } = repo;
    setIsImporting(true);
    setImportError(null);

    try {
      const response = await fetch('/api/integrations/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', owner, repo: repoName, branch }),
      });

      const data = await response.json();

      if (!response.ok) {
        setImportError(data.error || 'Failed to import from GitHub');
        setIsImporting(false);
        return;
      }

      // Write imported files to VFS
      const files = data.files;
      let importedCount = 0;

      for (const [path, content] of Object.entries(files)) {
        try {
          // Normalize path for API compatibility (fixes 400 error)
          const normalizedPath = normalizePath(path);
          await vfs.writeFile(normalizedPath, content as string);
          importedCount++;
        } catch (err) {
          console.error(`Failed to write ${path}:`, err);
        }
      }

      // Refresh the filesystem state
      const snapshot = await vfs.getSnapshot();
      setVfsSnapshot(snapshot);
      setFilesystem({
        sessionId: filesystem?.sessionId || "default",
        version: snapshot?.version || 1,
        files: snapshot?.files || [],
      });

      toast.success(`Imported ${importedCount} files from ${data.repo.fullName}`);
      setShowGithubImport(false);
      setGithubUrl('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import from GitHub');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={playlist[currentSongIndex]?.url}
        onEnded={nextSong}
      />

      <div className="pointer-events-auto">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-[60] pointer-events-auto flex flex-col"
              style={{
                top: "60px",
                bottom: 0,
                left: 0,
                width: panelWidth,
              }}
            >
              {/* Resize handle on right edge */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-400/50 transition-colors z-10"
                onMouseDown={handleMouseDown}
              />
              
              {/* Glassmorphism background */}
              <div className="absolute inset-0 bg-black/60 backdrop-blur-xl border-r border-white/10" />

              {/* Content - full height with proper overflow */}
              <div className="relative flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-400" />
                  <span className="text-sm font-semibold text-white/90">
                    Experimental Workspace
                  </span>
                </div>
                <div className="flex gap-2">
                  {/* Agent Status Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAgentStatus(!showAgentStatus)}
                    className={`h-6 w-6 p-0 hover:bg-white/10 transition-all duration-300 ${
                      showAgentStatus ? "text-cyan-400 bg-cyan-500/20" : "text-white/60"
                    }`}
                    title="Toggle agent status display"
                  >
                    <Brain className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={closePanel}
                    className="h-6 w-6 hover:bg-white/10"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Agent Status Display - Slides in from left */}
              <AnimatePresence>
                {showAgentStatus && (
                  <motion.div
                    initial={{ x: "-100%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "-100%", opacity: 0 }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className="absolute left-0 top-0 bottom-0 w-64 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 backdrop-blur-xl border-r border-cyan-500/30 z-20 overflow-hidden"
                  >
                    <div className="p-4 h-full overflow-y-auto">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-cyan-400" />
                          <span className="text-sm font-semibold text-white/90">Agent Status</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowAgentStatus(false)}
                          className="h-6 w-6 hover:bg-white/10"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Status Cards */}
                      <div className="space-y-3">
                        {/* Current State */}
                        <Card className="bg-cyan-500/10 border-cyan-500/30">
                          <CardContent className="p-3">
                            <p className="text-[10px] text-cyan-300 mb-1">Current State</p>
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                              <p className="text-sm text-white/90">Active</p>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Session Info */}
                        <Card className="bg-blue-500/10 border-blue-500/30">
                          <CardContent className="p-3">
                            <p className="text-[10px] text-blue-300 mb-1">Session</p>
                            <p className="text-xs text-white/80 font-mono">
                              #{filesystem?.sessionId?.slice(0, 8) || "N/A"}
                            </p>
                          </CardContent>
                        </Card>

                        {/* Progress */}
                        <Card className="bg-purple-500/10 border-purple-500/30">
                          <CardContent className="p-3">
                            <p className="text-[10px] text-purple-300 mb-2">Current Task</p>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-3 w-3 text-green-400" />
                                <span className="text-xs text-white/70">Initialize</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-3 w-3 text-cyan-400 animate-spin" />
                                <span className="text-xs text-white/90">Processing</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full border border-white/30" />
                                <span className="text-xs text-white/40">Complete</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Metrics */}
                        <Card className="bg-green-500/10 border-green-500/30">
                          <CardContent className="p-3">
                            <p className="text-[10px] text-green-300 mb-2">Metrics</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <p className="text-[9px] text-white/50">Steps</p>
                                <p className="text-sm text-white/90">{filesystem?.version || 0}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-white/50">Files</p>
                                <p className="text-sm text-white/90">{filesystem?.files?.length || 0}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Thinking Notes Preview */}
                        {thinkingNotes.length > 0 && (
                          <Card className="bg-purple-500/10 border-purple-500/30">
                            <CardContent className="p-3">
                              <p className="text-[10px] text-purple-300 mb-2">Recent Thoughts</p>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {thinkingNotes.slice(-3).map((note, i) => (
                                  <div key={i} className="text-xs text-white/70 bg-purple-500/20 p-1.5 rounded">
                                    {note.slice(0, 50)}{note.length > 50 ? '...' : ''}
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <p className="text-[10px] text-white/40 text-center">
                          Real-time agent monitoring
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={(v) => setTab(v as PanelTab)} className="flex-1 flex flex-col">
                <TabsList className="grid grid-cols-10 gap-1 mx-4 mt-4 bg-white/5 border border-white/10 p-1">
                  <TabsTrigger
                    value="explorer"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    Files
                  </TabsTrigger>
                  <TabsTrigger
                    value="chat"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Cpu className="h-3 w-3 mr-1" />
                    Agent
                  </TabsTrigger>
                  <TabsTrigger
                    value="thinking"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Brain className="h-3 w-3 mr-1" />
                    Think
                  </TabsTrigger>
                  <TabsTrigger
                    value="music"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Music className="h-3 w-3 mr-1" />
                    Music
                  </TabsTrigger>
                  <TabsTrigger
                    value="automations"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Workflow className="h-3 w-3 mr-1" />
                    Automate
                  </TabsTrigger>
                  <TabsTrigger
                    value="youtube"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Youtube className="h-3 w-3 mr-1" />
                    Videos
                  </TabsTrigger>
                  <TabsTrigger
                    value="forum"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Users className="h-3 w-3 mr-1" />
                    Forum
                  </TabsTrigger>
                  <TabsTrigger
                    value="compare"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    Compare
                  </TabsTrigger>
                  <TabsTrigger
                    value="integrations"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Database className="h-3 w-3 mr-1" />
                    Integrations
                  </TabsTrigger>
                </TabsList>

                {/* Explorer Tab */}
                <TabsContent value="explorer" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-2">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs text-white/60">File Explorer</span>
                        <div className="flex gap-1">
                          <Badge variant="secondary" className="text-[10px] bg-white/10">
                            {filesystem?.files?.length || 0} files
                          </Badge>
                          {/* Paste button when clipboard has content */}
                          {clipboard && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handlePasteToFolder("/")}
                              className="h-6 w-6 hover:bg-white/10 text-green-400"
                              title={`Paste ${clipboard.sourcePath.split('/').pop()}`}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCreateFile("/")}
                            className="h-6 w-6 hover:bg-white/10"
                            title="New File"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              const snapshot = await vfs.getSnapshot();
                              setVfsSnapshot(snapshot);
                              // Also refresh the filesystem state
                              setFilesystem({
                                sessionId: filesystem?.sessionId || "default",
                                version: snapshot?.version || 1,
                                files: snapshot?.files || [],
                              });
                            }}
                            className="h-6 w-6 hover:bg-white/10"
                            title="Refresh Files"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowGithubImport(true)}
                            className="h-6 w-6 hover:bg-white/10"
                            title="Import from GitHub"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                            </svg>
                          </Button>
                        </div>
                      </div>
                      
                      {/* File creation input */}
                      {(isCreatingFile || isCreatingFolder) && (
                        <div className="mb-2 p-2 bg-white/10 rounded border border-white/20">
                          <Input
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (isCreatingFile) {
                                  confirmCreateFile();
                                } else {
                                  confirmCreateFolder();
                                }
                              } else if (e.key === 'Escape') {
                                cancelCreate();
                              }
                            }}
                            placeholder={isCreatingFile ? "filename.js" : "folder-name"}
                            className="h-7 text-xs bg-black/50 border-white/20 mb-2"
                            autoFocus
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              onClick={isCreatingFile ? confirmCreateFile : confirmCreateFolder}
                              className="h-6 text-xs bg-green-600/20 hover:bg-green-600/30 border border-green-500/30"
                            >
                              Create
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelCreate}
                              className="h-6 text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {renderFileTree(fileTree)}
                      
                      {selectedFile && (
                        <>
                          <Separator className="my-4 bg-white/10" />
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-white/90 truncate">
                                {selectedFile.name}
                              </span>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/10">
                                  <Eye className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/10">
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            <p className="text-[10px] text-white/50">{selectedFile.path}</p>
                            {selectedFile.content && (
                              <div className="w-full overflow-x-auto">
                                <pre className="mt-2 p-2 bg-black/50 rounded text-[10px] text-white/70 whitespace-pre-wrap break-all min-h-[200px] max-h-[60vh] overflow-y-auto">
                                  <code>{selectedFile.content}</code>
                                </pre>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {/* Clipboard indicator */}
                      {clipboard && (
                        <div className="mb-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded flex items-center justify-between">
                          <span className="text-xs text-yellow-300">
                            {clipboard.operation === 'cut' ? '✂️ Cut' : '📋 Copied'}: {clipboard.sourcePath.split('/').pop()}
                          </span>
                          <button
                            onClick={() => setClipboard(null)}
                            className="text-white/60 hover:text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {/* Version History Integration */}
                      <Separator className="my-4 bg-white/10" />
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                          <LucideHistory className="h-3 w-3 text-purple-400" />
                          <span className="text-xs font-medium text-white/90">Version History</span>
                        </div>
                        <VersionHistoryPanel
                          sessionId={filesystem?.sessionId || "default"}
                          currentVersion={filesystem?.version}
                          compact
                        />
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Parallel Chat Tab */}
                <TabsContent value="chat" className="flex-1 mt-0 flex flex-col overflow-hidden">
                  {/* Chat Header */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/20">
                    <div className="flex items-center gap-2 flex-1">
                      <MessageSquare className="h-4 w-4 text-blue-400" />
                      <span className="text-sm font-medium text-white/90">Parallel Chat</span>
                      <Badge variant="secondary" className="text-[10px] bg-blue-500/20 text-blue-300">
                        {chatMessages.length} messages
                      </Badge>
                      
                      {/* Thread Selector */}
                      <div className="flex items-center gap-1 ml-4">
                        <select
                          value={activeThreadId || ''}
                          onChange={(e) => switchThread(e.target.value)}
                          className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-white/80 focus:outline-none focus:border-blue-500/50"
                          title="Select chat thread"
                        >
                          {chatThreads.map(thread => (
                            <option key={thread.id} value={thread.id} className="bg-gray-900">
                              {thread.name} ({thread.messages.length})
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => createNewThread()}
                          className="h-6 w-6 p-0 hover:bg-green-500/20 text-green-400"
                          title="Create new thread"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        {chatThreads.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteThread(activeThreadId!)}
                            className="h-6 w-6 p-0 hover:bg-red-500/20 text-red-400"
                            title="Delete current thread"
                            disabled={!activeThreadId}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSendChat("Please continue the work. If there are more files to edit or improvements to make, proceed with them.")}
                        disabled={chatMessages.length === 0 || isChatLoading}
                        className="h-6 text-[10px] bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20"
                        title="Request AI to continue its previous task"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Continue
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={exportChatHistory}
                        disabled={chatMessages.length === 0}
                        className="h-6 text-xs hover:bg-blue-500/20 disabled:opacity-50"
                        title="Copy chat to clipboard"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearChatHistory}
                        disabled={chatMessages.length === 0}
                        className="h-6 text-xs hover:bg-red-500/20 disabled:opacity-50"
                        title="Clear chat history"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                   
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Agent Status Banner */}
                    {agentActivity.status !== 'idle' && (
                      <div className={`p-3 rounded-lg border ${
                        agentActivity.status === 'thinking' ? 'bg-purple-500/10 border-purple-500/30' :
                        agentActivity.status === 'executing' ? 'bg-blue-500/10 border-blue-500/30' :
                        agentActivity.status === 'completed' ? 'bg-green-500/10 border-green-500/30' :
                        'bg-white/5 border-white/10'
                      }`}>
                        <div className="flex items-center gap-3">
                          {agentActivity.status === 'thinking' && <Brain className="h-5 w-5 text-purple-400 animate-pulse" />}
                          {agentActivity.status === 'executing' && <Terminal className="h-5 w-5 text-blue-400" />}
                          {agentActivity.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-green-400" />}
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white/90">
                              {agentActivity.status === 'thinking' && 'Agent thinking...'}
                              {agentActivity.status === 'executing' && 'Executing tasks...'}
                              {agentActivity.status === 'completed' && 'Task completed'}
                            </p>
                            {agentActivity.currentAction && (
                              <p className="text-xs text-white/60 mt-1">{agentActivity.currentAction}</p>
                            )}
                          </div>
                          {agentActivity.status === 'executing' && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
                        </div>
                      </div>
                    )}

                    {/* Processing Steps */}
                    {agentActivity.processingSteps.length > 0 && (
                      <Card className="bg-white/5 border-white/10">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <Clock3 className="h-4 w-4 text-blue-400" />
                            <span className="text-sm font-medium text-white/90">Processing Steps</span>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-1">
                            {agentActivity.processingSteps.map((step) => (
                              <div key={step.id} className="flex items-center gap-2 text-xs">
                                {step.status === 'completed' && <CheckCircle className="h-3 w-3 text-green-400" />}
                                {step.status === 'started' && <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />}
                                {step.status === 'failed' && <AlertCircle className="h-3 w-3 text-red-400" />}
                                {step.status === 'pending' && <div className="h-3 w-3 rounded-full border border-white/30" />}
                                <span className={step.status === 'completed' ? 'text-white/50' : 'text-white/80'}>
                                  {step.step}
                                </span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Tool Invocations */}
                    {agentActivity.toolInvocations.length > 0 && (
                      <Card className="bg-white/5 border-white/10">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-orange-400" />
                            <span className="text-sm font-medium text-white/90">Tool Invocations</span>
                            <Badge variant="secondary" className="text-[10px] bg-orange-500/20">
                              {agentActivity.toolInvocations.length}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {agentActivity.toolInvocations.slice(-3).map((tool) => (
                            <div
                              key={tool.id}
                              className={`p-2 rounded border text-xs ${
                                tool.state === 'result' ? 'bg-green-500/10 border-green-500/30' :
                                tool.state === 'call' ? 'bg-blue-500/10 border-blue-500/30' :
                                'bg-white/5 border-white/10'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {tool.state === 'result' && <CheckCircle2 className="h-3 w-3 text-green-400" />}
                                  {tool.state === 'call' && <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />}
                                  <span className="font-mono text-white/90">{tool.toolName}</span>
                                </div>
                                <span className="text-white/50">
                                  {tool.state === 'partial-call' ? 'Streaming' :
                                   tool.state === 'call' ? 'Executing' : 'Done'}
                                </span>
                              </div>
                              {tool.result && (
                                <pre className="mt-1 max-h-16 overflow-auto bg-black/30 rounded p-1 text-[10px] text-white/70">
                                  {typeof tool.result === 'string' ? tool.result.slice(0, 200) : JSON.stringify(tool.result).slice(0, 200)}
                                </pre>
                              )}
                            </div>
                          ))}
                          {agentActivity.toolInvocations.length > 3 && (
                            <p className="text-xs text-white/50 text-center">+{agentActivity.toolInvocations.length - 3} more</p>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* File Changes */}
                    {agentActivity.diffs.length > 0 && (
                      <Card className="bg-white/5 border-white/10">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <FileDiff className="h-4 w-4 text-yellow-400" />
                            <span className="text-sm font-medium text-white/90">File Changes</span>
                            <Badge variant="secondary" className="text-[10px] bg-yellow-500/20">
                              {agentActivity.diffs.length}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {agentActivity.diffs.slice(-2).map((diff, i) => (
                            <div key={i} className="p-2 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs">
                              <span className="font-mono text-yellow-300">{diff.path}</span>
                              <span className="ml-2 text-white/50">{diff.changeType}</span>
                            </div>
                          ))}
                          {agentActivity.diffs.length > 2 && (
                            <p className="text-xs text-white/50 text-center">+{agentActivity.diffs.length - 2} more changes</p>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {chatMessages.length === 0 ? (
                      <div className="text-center text-white/40 text-sm mt-8">
                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Parallel chat isolated from main thread</p>
                        <p className="text-xs mt-1">Start a new conversation</p>
                      </div>
                    ) : (
                      chatMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] p-3 rounded-lg text-sm ${
                              msg.role === "user"
                                ? "bg-blue-500/20 border border-blue-500/30 text-white/90"
                                : "bg-white/10 border border-white/20 text-white/80"
                            }`}
                          >
                            <p>{msg.content}</p>
                            <p className="text-[10px] text-white/40 mt-1">
                              {new Date(msg.timestamp || Date.now()).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                    {isChatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white/10 border border-white/20 rounded-lg p-3">
                          <Loader2 className="h-4 w-4 animate-spin text-white/60" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="p-4 border-t border-white/10">
                    <div className="flex gap-2">
                      <Textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSendChat();
                          }
                        }}
                        placeholder="Send message... (with attached files for context)"
                        className="flex-1 min-h-[60px] bg-white/5 border-white/10 text-white/90 placeholder:text-white/40 text-sm resize-none"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowFilePicker(!showFilePicker)}
                        className="h-[60px] w-10 text-white/60 hover:text-white hover:bg-white/10"
                        title="Attach files from VFS"
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => void handleSendChat()}
                        disabled={!chatInput.trim() || isChatLoading}
                        className="h-[60px] w-[60px] bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30"
                      >
                        {isChatLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    
                    {/* Attached Files Display */}
                    {attachedFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2 p-2 border-t border-white/10">
                        {attachedFiles.map((file, idx) => (
                          <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 border border-blue-500/30 rounded text-xs text-white/80">
                            <FileCode className="h-3 w-3" />
                            <span className="max-w-[100px] truncate">{file.path.split('/').pop()}</span>
                            <button
                              onClick={() => setAttachedFiles(attachedFiles.filter((_, i) => i !== idx))}
                              className="ml-1 hover:text-red-400"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* File Picker Dropdown */}
                    {showFilePicker && (
                      <div className="border-t border-white/10 p-2 max-h-48 overflow-y-auto bg-black/60">
                        <div className="text-xs text-white/60 mb-2">Click files to attach (they'll be sent as context):</div>
                        {vfsSnapshot?.files?.slice(0, 20).map((file: { path: string; content?: string }, idx: number) => (
                          <button
                            key={idx}
                            onClick={() => {
                              const isAttached = attachedFiles.some(f => f.path === file.path);
                              if (isAttached) {
                                setAttachedFiles(attachedFiles.filter(f => f.path !== file.path));
                              } else {
                                setAttachedFiles([...attachedFiles, { path: file.path, content: file.content || '' }]);
                              }
                            }}
                            className={`flex items-center gap-2 w-full px-2 py-1 text-left text-xs rounded ${
                              attachedFiles.some(f => f.path === file.path)
                                ? 'bg-blue-500/30 text-blue-300'
                                : 'hover:bg-white/10 text-white/70'
                            }`}
                          >
                            {attachedFiles.some(f => f.path === file.path) && <CheckCircle className="h-3 w-3" />}
                            <FileCode className="h-3 w-3 text-blue-400" />
                            <span className="truncate">{file.path}</span>
                          </button>
                        ))}
                        <button
                          onClick={() => setShowFilePicker(false)}
                          className="mt-2 w-full text-center text-xs text-white/40 hover:text-white"
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Thinking Area Tab */}
                <TabsContent value="thinking" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-purple-400" />
                          <span className="text-sm font-medium text-white/90">Agent Thinking & State</span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={exportNotes}
                            disabled={thinkingNotes.length === 0}
                            className="h-6 text-xs hover:bg-purple-500/20 disabled:opacity-50"
                            title="Copy all notes to clipboard"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearAllNotes}
                            disabled={thinkingNotes.length === 0}
                            className="h-6 text-xs hover:bg-red-500/20 disabled:opacity-50"
                            title="Clear all notes"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Add Note */}
                      <div className="flex gap-2">
                        <Input
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          placeholder="Add thinking note..."
                          className="flex-1 bg-white/5 border-white/10 text-white/90 placeholder:text-white/40 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              addThinkingNote();
                            }
                          }}
                        />
                        <Button
                          onClick={addThinkingNote}
                          size="sm"
                          disabled={!newNote.trim()}
                          className="bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 disabled:opacity-50"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Notes List */}
                      <div className="space-y-2">
                        {thinkingNotes.length === 0 ? (
                          <p className="text-white/40 text-sm text-center py-8">
                            No thinking notes yet
                          </p>
                        ) : (
                          thinkingNotes.map((note, index) => (
                            <motion.div
                              key={index}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm text-white/80 flex-1">{note}</p>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeThinkingNote(index)}
                                  className="h-6 w-6 hover:bg-purple-500/20"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                              <p className="text-[10px] text-white/40 mt-1">
                                Note {index + 1}
                              </p>
                            </motion.div>
                          ))
                        )}
                      </div>

                      {/* State Components */}
                      <Separator className="my-4 bg-white/10" />
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="h-3 w-3 text-yellow-400" />
                          <span className="text-xs font-medium text-white/90">Agent State</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 bg-white/5 rounded border border-white/10">
                            <p className="text-[10px] text-white/50">Status</p>
                            <p className="text-xs text-white/80">Active</p>
                          </div>
                          <div className="p-2 bg-white/5 rounded border border-white/10">
                            <p className="text-[10px] text-white/50">Session</p>
                            <p className="text-xs text-white/80">#{filesystem?.sessionId?.slice(0, 8) || "N/A"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Music Playlist Tab */}
                <TabsContent value="music" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Music className="h-4 w-4 text-pink-400" />
                          <span className="text-sm font-medium text-white/90">Playlist</span>
                          <Badge variant="secondary" className="text-[10px] bg-pink-500/20 text-pink-300">
                            {playlist.length} songs
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            onClick={clearPlaylist}
                            size="sm"
                            variant="ghost"
                            disabled={playlist.length === 0}
                            className="h-6 text-xs hover:bg-red-500/20 disabled:opacity-50"
                            title="Clear playlist"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                          <Button
                            onClick={addSongToPlaylist}
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs hover:bg-white/10"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        </div>
                      </div>

                      {/* Current Song */}
                      {playlist.length > 0 && (
                        <div className="p-4 bg-pink-500/10 border border-pink-500/20 rounded-lg mb-4">
                          <p className="text-xs text-white/50 mb-1">Now Playing</p>
                          <p className="text-sm font-medium text-white/90 truncate">
                            {playlist[currentSongIndex]?.title || "No song"}
                          </p>
                          <p className="text-xs text-white/60 truncate">
                            {playlist[currentSongIndex]?.artist || "Unknown"}
                          </p>
                          
                          {/* Controls */}
                          <div className="flex items-center justify-center gap-4 mt-4">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={prevSong}
                              className="h-8 w-8 hover:bg-white/10"
                            >
                              <SkipBack className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={togglePlayPause}
                              className="h-10 w-10 bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/30"
                            >
                              {isPlaying ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={nextSong}
                              className="h-8 w-8 hover:bg-white/10"
                            >
                              <SkipForward className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Volume */}
                          <div className="flex items-center gap-2 mt-4">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setIsMuted(!isMuted)}
                              className="h-6 w-6 hover:bg-white/10"
                            >
                              {isMuted ? (
                                <VolumeX className="h-3 w-3" />
                              ) : (
                                <Volume2 className="h-3 w-3" />
                              )}
                            </Button>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={volume}
                              onChange={(e) => setVolume(parseFloat(e.target.value))}
                              className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>
                      )}

                      {/* Playlist */}
                      <div className="space-y-1">
                        {playlist.length === 0 ? (
                          <p className="text-white/40 text-sm text-center py-8">
                            No songs in playlist
                          </p>
                        ) : (
                          playlist.map((song, index) => (
                            <div
                              key={song.id}
                              className={`flex items-center gap-2 p-2 rounded ${
                                index === currentSongIndex
                                  ? "bg-pink-500/20 border border-pink-500/30"
                                  : "hover:bg-white/10"
                              }`}
                            >
                              {/* Reorder buttons */}
                              <div className="flex flex-col gap-0.5">
                                <button
                                  onClick={() => moveSongUp(index)}
                                  disabled={index === 0}
                                  className="p-0.5 hover:bg-white/10 rounded disabled:opacity-30"
                                >
                                  <ChevronUp className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => moveSongDown(index)}
                                  disabled={index === playlist.length - 1}
                                  className="p-0.5 hover:bg-white/10 rounded disabled:opacity-30"
                                >
                                  <ChevronDown className="h-3 w-3" />
                                </button>
                              </div>
                              
                              <div
                                className="flex-1 cursor-pointer flex items-center gap-2"
                                onClick={() => playSong(index)}
                              >
                                {index === currentSongIndex && isPlaying && (
                                  <div className="flex gap-0.5 items-end h-4">
                                    <div className="w-0.5 bg-pink-400 animate-pulse" style={{ height: '60%' }} />
                                    <div className="w-0.5 bg-pink-400 animate-pulse" style={{ height: '100%' }} />
                                    <div className="w-0.5 bg-pink-400 animate-pulse" style={{ height: '40%' }} />
                                  </div>
                                )}
                                <p className="text-sm text-white/90 truncate">{song.title}</p>
                                <p className="text-xs text-white/50">{song.artist}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeSong(index)}
                                className="h-6 w-6 hover:bg-white/10"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Automations Tab - Redesigned */}
                <TabsContent value="automations" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      {/* Header with Stats */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-lg border border-cyan-500/30">
                            <Workflow className="h-5 w-5 text-cyan-400" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white/90">Automation Hub</h3>
                            <p className="text-[10px] text-white/50">Build powerful workflows with AI</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-300 border border-green-500/30">
                            <Zap className="h-2 w-2 mr-1" />
                            {availableAutomations.length} Available
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                            {comingSoonAutomations.length} Coming
                          </Badge>
                        </div>
                      </div>

                      {/* Category Filter Tabs */}
                      <div className="flex gap-2 pb-3 border-b border-white/10 overflow-x-auto">
                        {[
                          { id: 'all', label: 'All', icon: null },
                          { id: 'productivity', label: 'Productivity', icon: Zap },
                          { id: 'ai', label: 'AI & ML', icon: Bot },
                          { id: 'media', label: 'Media', icon: Video },
                          { id: 'learning', label: 'Learning', icon: GraduationCap },
                        ].map((cat) => (
                          <Button
                            key={cat.id}
                            variant="ghost"
                            size="sm"
                            className={`text-xs whitespace-nowrap ${automationCategory === cat.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
                            onClick={() => setAutomationCategory(cat.id)}
                          >
                            {cat.icon && <cat.icon className="h-3 w-3 mr-1" />}
                            {cat.label}
                          </Button>
                        ))}
                      </div>

                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-white/40" />
                        <Input
                          value={automationSearch}
                          onChange={(e) => setAutomationSearch(e.target.value)}
                          placeholder="Search automations..."
                          className="pl-9 h-9 bg-white/5 border-white/10 text-white/90 placeholder:text-white/40 text-sm"
                        />
                      </div>

                      {/* Automation Cards - Dynamic from filtered data */}
                      <div className="grid grid-cols-1 gap-4">
                        {/* Available Automations */}
                        {availableAutomations.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1 w-1 rounded-full bg-green-400 animate-pulse" />
                              <span className="text-xs font-medium text-green-400">Available Now</span>
                            </div>
                            {availableAutomations.map((automation) => (
                              <Card 
                                key={automation.id}
                                className="bg-gradient-to-br from-green-500/20 to-emerald-500/10 border-green-500/40 hover:border-green-500/60 cursor-pointer transition-all duration-300 group"
                                onClick={() => toast.success(`Launching ${automation.name}`, { description: `Starting ${automation.description.toLowerCase()}...` })}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="p-2 bg-green-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                        <automation.icon className="h-5 w-5 text-green-400" />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <p className="text-sm font-semibold text-white/90">{automation.name}</p>
                                          <Badge className="text-[9px] bg-green-500/30 text-green-300 border-0">Live</Badge>
                                        </div>
                                        <p className="text-xs text-white/50 mt-1">{automation.description}</p>
                                        <div className="flex gap-1 mt-2">
                                          {automation.tags.map((tag, idx) => (
                                            <Badge key={idx} variant="secondary" className="text-[9px] bg-green-500/20">{tag}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                      <Button className="h-7 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-300 text-xs">
                                        <Play className="h-3 w-3 mr-1" />
                                        Start
                                      </Button>
                                      {automation.duration && <p className="text-[9px] text-white/40">{automation.duration}</p>}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {/* Coming Soon Automations */}
                        {comingSoonAutomations.length > 0 && (
                          <div className="space-y-2 mt-4">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3 w-3 text-white/40" />
                              <span className="text-xs font-medium text-white/50">Coming Soon</span>
                            </div>
                            {comingSoonAutomations.map((automation) => (
                              <Card 
                                key={automation.id}
                                className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30 hover:border-purple-500/50 cursor-pointer transition-all duration-300 group"
                                onClick={() => toast.info("Coming Soon", { description: automation.description })}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="p-2 bg-purple-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                        <automation.icon className="h-5 w-5 text-purple-400" />
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-white/90">{automation.name}</p>
                                        <p className="text-xs text-white/50 mt-1">{automation.description}</p>
                                        <div className="flex gap-1 mt-2">
                                          {automation.tags.map((tag, idx) => (
                                            <Badge key={idx} variant="secondary" className="text-[9px] bg-purple-500/20">{tag}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                    <ExternalLink className="h-4 w-4 text-white/30 group-hover:text-white/60 transition-colors" />
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {/* Empty state when no matches */}
                        {filteredAutomations.length === 0 && (
                          <div className="text-center py-8">
                            <Search className="h-8 w-8 mx-auto mb-2 text-white/30" />
                            <p className="text-white/50 text-sm">No automations match your search</p>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => { setAutomationSearch(''); setAutomationCategory('all'); }}
                              className="mt-2 text-cyan-400"
                            >
                              Clear filters
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Info Footer */}
                      <div className="mt-6 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="h-4 w-4 text-cyan-400" />
                          <span className="text-sm font-medium text-white/80">Powerful AI Automations</span>
                        </div>
                        <p className="text-xs text-white/50">
                          Click on any available automation to start. More coming soon - request new automations via chat!
                        </p>
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* YouTube Playlist Tab - Auto fullscreen with faded background */}
                <TabsContent value="youtube" className="flex-1 mt-0 overflow-hidden relative bg-black">
                  <div className="absolute inset-0 flex flex-col">
                    {/* Video Container - Always fullscreen style with faded overlay */}
                    <div className="flex-1 relative w-full h-full bg-black">
                      {/* Faded background overlay */}
                      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-black/80 pointer-events-none z-10" />
                      
                      {/* YouTube Iframe */}
                      <iframe
                        className="absolute inset-0 w-full h-full"
                        src={getYouTubeEmbedUrl(youtubeVideoId)}
                        title="YouTube video player"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                        style={{ zIndex: 0 }}
                      />

                      {/* Fullscreen exit button - Always visible */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newId = prompt("Enter YouTube Video ID or URL:", youtubeVideoId);
                          if (newId) {
                            const extractedId = extractYouTubeId(newId);
                            if (extractedId) {
                              setYoutubeVideoId(extractedId);
                              toast.success("Video changed");
                            } else {
                              toast.error("Invalid YouTube URL or ID");
                            }
                          }
                        }}
                        className="absolute top-4 right-4 h-8 w-8 bg-black/70 hover:bg-black/90 text-white z-20 border border-white/20"
                        title="Change video"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      
                      {/* Minimize button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTab('explorer')}
                        className="absolute top-4 left-4 h-8 w-8 bg-black/70 hover:bg-black/90 text-white z-20 border border-white/20"
                        title="Close video"
                      >
                        <X className="h-4 w-4" />
                      </Button>

                      {/* Now playing indicator */}
                      <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white/80 text-xs z-20 pointer-events-none">
                        <div className="flex gap-0.5 items-end h-4">
                          <div className="w-1 bg-red-500 animate-pulse" style={{ height: '60%' }} />
                          <div className="w-1 bg-red-500 animate-pulse" style={{ height: '100%' }} />
                          <div className="w-1 bg-red-500 animate-pulse" style={{ height: '40%' }} />
                        </div>
                        <span>Now Playing</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Forum Tab */}
                <TabsContent value="forum" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-orange-400" />
                          <span className="text-sm font-medium text-white/90">Global Forum</span>
                          <Badge variant="secondary" className="text-[10px] bg-orange-500/20 text-orange-300">
                            {forumPosts.length} posts
                          </Badge>
                        </div>
                      </div>

                      {/* New Post Form */}
                      <Card className="bg-white/5 border-white/10">
                        <CardContent className="p-3 space-y-2">
                          <Textarea
                            value={newPostContent}
                            onChange={(e) => setNewPostContent(e.target.value)}
                            placeholder="Share your thoughts, ideas, or notes..."
                            className="min-h-[80px] bg-black/30 border-white/10 text-white/90 placeholder:text-white/40 text-sm resize-none"
                          />
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Button
                                variant={isAnonymousPost ? "default" : "ghost"}
                                size="sm"
                                onClick={() => setIsAnonymousPost(!isAnonymousPost)}
                                className={`h-6 text-xs ${isAnonymousPost ? 'bg-orange-500/20 hover:bg-orange-500/30' : ''}`}
                              >
                                <User className="h-3 w-3 mr-1" />
                                Anonymous
                              </Button>
                            </div>
                            <Button
                              size="sm"
                              onClick={handleCreatePost}
                              disabled={!newPostContent.trim()}
                              className="h-6 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 disabled:opacity-50"
                            >
                              <Send className="h-3 w-3 mr-1" />
                              Post
                            </Button>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Posts List */}
                      <div className="space-y-3">
                        {forumPosts.length === 0 ? (
                          <div className="text-center text-white/40 text-sm py-8">
                            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No posts yet</p>
                            <p className="text-xs mt-1">Be the first to share something!</p>
                          </div>
                        ) : (
                          forumPosts.map((post) => (
                            <Card key={post.id} className="bg-white/5 border-white/10">
                              <CardContent className="p-3 space-y-2">
                                {/* Post Header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div className={`h-6 w-6 rounded-full flex items-center justify-center ${
                                      post.isAnonymous ? 'bg-gray-500/20' : 'bg-orange-500/20'
                                    }`}>
                                      <User className="h-3 w-3 text-white/60" />
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-white/80">{post.author}</p>
                                      <p className="text-[9px] text-white/40">
                                        {new Date(post.timestamp).toLocaleString()}
                                      </p>
                                    </div>
                                  </div>
                                  {post.isAnonymous && (
                                    <Badge variant="secondary" className="text-[8px] bg-gray-500/20">
                                      Anonymous
                                    </Badge>
                                  )}
                                </div>

                                {/* Post Content */}
                                <p className="text-sm text-white/80 whitespace-pre-wrap">{post.content}</p>

                                {/* Post Actions */}
                                <div className="flex items-center gap-4 pt-2 border-t border-white/10">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleLikePost(post.id)}
                                    className="h-6 text-xs hover:bg-red-500/20 hover:text-red-400"
                                  >
                                    <Heart className="h-3 w-3 mr-1" />
                                    {post.likes}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleToggleComments(post.id)}
                                    className="h-6 text-xs hover:bg-blue-500/20 hover:text-blue-400"
                                  >
                                    <MessageComment className="h-3 w-3 mr-1" />
                                    {post.comments.length}
                                  </Button>
                                </div>

                                {/* Comments Section */}
                                {expandedComments.has(post.id) && (
                                  <div className="space-y-2 pt-2 border-t border-white/10">
                                    {/* Existing Comments */}
                                    {post.comments.map((comment) => (
                                      <div key={comment.id} className="flex gap-2 text-xs">
                                        <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                                          comment.isAnonymous ? 'bg-gray-500/20' : 'bg-blue-500/20'
                                        }`}>
                                          <User className="h-2 w-2 text-white/60" />
                                        </div>
                                        <div className="flex-1 bg-white/5 rounded p-2">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="text-white/70">{comment.author}</span>
                                            <span className="text-white/40 text-[9px]">
                                              {new Date(comment.timestamp).toLocaleString()}
                                            </span>
                                          </div>
                                          <p className="text-white/80">{comment.content}</p>
                                        </div>
                                      </div>
                                    ))}

                                    {/* Add Comment */}
                                    <div className="flex gap-2">
                                      <Input
                                        value={newCommentContent[post.id] || ""}
                                        onChange={(e) => setNewCommentContent({
                                          ...newCommentContent,
                                          [post.id]: e.target.value,
                                        })}
                                        placeholder="Write a comment..."
                                        className="flex-1 h-7 bg-black/30 border-white/10 text-white/90 placeholder:text-white/40 text-xs"
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleAddComment(post.id, newCommentContent[post.id] || "");
                                          }
                                        }}
                                      />
                                      <Button
                                        size="sm"
                                        onClick={() => handleAddComment(post.id, newCommentContent[post.id] || "")}
                                        disabled={!newCommentContent[post.id]?.trim()}
                                        className="h-7 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 disabled:opacity-50"
                                      >
                                        <Send className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Compare Tab - Multi-Model Comparison */}
                <TabsContent value="compare" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4">
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-white/80 mb-2 flex items-center gap-2">
                          <Zap className="h-4 w-4 text-yellow-400" />
                          Multi-Model Comparison
                        </h3>
                        <p className="text-xs text-white/50">
                          Compare responses from multiple AI models. Direct API calls (not OpenCode Agent).
                        </p>
                      </div>
                      <MultiModelComparison
                        isOpen={true}
                        onClose={() => setTab("explorer")}
                        availableProviders={availableProviders}
                        currentProvider=""
                        currentModel=""
                      />
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Integrations Tab - OAuth Connections */}
                <TabsContent value="integrations" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4">
                      <IntegrationPanel 
                        userId={getOrCreateAnonymousSessionId()}
                        onClose={() => setTab("explorer")}
                      />
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && confirmDialogData && (
        <ConfirmationDialog
          isOpen={showConfirmDialog}
          title={confirmDialogData.title}
          message={confirmDialogData.message}
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={confirmDialogData.onConfirm}
          onCancel={() => {
            setShowConfirmDialog(false);
            setConfirmDialogData(null);
          }}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-black/90 border border-white/20 rounded-lg shadow-xl py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {!contextMenu.isDirectory && (
              <>
                <button
                  onClick={() => {
                    handleCutFile(contextMenu.path);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-white/80 hover:bg-white/10 flex items-center gap-2"
                >
                  <Edit className="h-3 w-3 text-yellow-400" /> Cut
                </button>
                <button
                  onClick={() => {
                    handleCopyFile(contextMenu.path);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-white/80 hover:bg-white/10 flex items-center gap-2"
                >
                  <Copy className="h-3 w-3 text-blue-400" /> Copy
                </button>
              </>
            )}
            <button
              onClick={() => {
                const name = contextMenu.path.split('/').pop() || '';
                handleRenameFile(contextMenu.path, name);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-white/80 hover:bg-white/10 flex items-center gap-2"
            >
              <FileText className="h-3 w-3 text-purple-400" /> Rename
            </button>
          </div>
        </>
      )}

      {/* GitHub Import Modal */}
      {showGithubImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/20 rounded-lg shadow-2xl w-full max-w-lg p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <h2 className="text-lg font-semibold text-white">Import from GitHub</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowGithubImport(false);
                  setGithubUrl('');
                  setImportError(null);
                  setSelectedRepo(null);
                }}
                className="h-8 w-8 text-white/70 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {!isGithubAuthenticated ? (
              <>
                <p className="text-sm text-white/60 mb-4">
                  Sign in with GitHub to browse and import your repositories.
                </p>
                <Button
                  onClick={handleSignInWithGithub}
                  className="bg-[#24292f] hover:bg-[#363b42] text-white"
                >
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  Sign in with GitHub
                </Button>
                <div className="mt-6 pt-4 border-t border-white/10">
                  <p className="text-xs text-white/40 mb-2">Or import from a public repository:</p>
                  <Input
                    value={githubUrl}
                    onChange={(e) => {
                      setGithubUrl(e.target.value);
                      setImportError(null);
                    }}
                    placeholder="https://github.com/owner/repo"
                    className="mb-3 bg-black/40 border-white/20 text-white"
                    disabled={isImporting}
                  />
                  <div className="flex gap-3 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setShowGithubImport(false)}
                      disabled={isImporting}
                      className="border-white/20 text-white/70"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={async () => {
                        if (!githubUrl.trim()) {
                          setImportError('Please enter a GitHub URL');
                          return;
                        }
                        setIsImporting(true);
                        setImportError(null);
                        try {
                          const response = await fetch('/api/integrations/github', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: githubUrl }),
                          });
                          const data = await response.json();
                          if (!response.ok) {
                            setImportError(data.error || 'Failed to import from GitHub');
                            setIsImporting(false);
                            return;
                          }
                          const files = data.files;
                          let importedCount = 0;
                          for (const [path, content] of Object.entries(files)) {
                            try {
                              // Normalize path for API compatibility (fixes 400 error)
                              const normalizedPath = normalizePath(path);
                              await vfs.writeFile(normalizedPath, content as string);
                              importedCount++;
                            } catch (err) {
                              console.error(`Failed to write ${path}:`, err);
                            }
                          }
                          const snapshot = await vfs.getSnapshot();
                          setVfsSnapshot(snapshot);
                          setFilesystem({
                            sessionId: filesystem?.sessionId || "default",
                            version: snapshot?.version || 1,
                            files: snapshot?.files || [],
                          });
                          toast.success(`Imported ${importedCount} files from ${data.repo.fullName}`);
                          setShowGithubImport(false);
                          setGithubUrl('');
                        } catch (err) {
                          setImportError(err instanceof Error ? err.message : 'Failed to import from GitHub');
                        } finally {
                          setIsImporting(false);
                        }
                      }}
                      disabled={isImporting || !githubUrl.trim()}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        'Import Public Repo'
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-white/60">
                    {githubRepos.length} repositories found
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFetchRepos}
                    disabled={isLoadingRepos}
                    className="text-white/70 hover:text-white"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingRepos ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                
                {isLoadingRepos ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-white/60" />
                  </div>
                ) : (
                  <ScrollArea className="flex-1 max-h-64 mb-4">
                    <div className="space-y-2 pr-4">
                      {githubRepos.map((repo) => (
                        <div
                          key={repo.id}
                          onClick={() => setSelectedRepo({ owner: repo.fullName.split('/')[0], repo: repo.name, branch: repo.defaultBranch })}
                          className={`p-3 rounded cursor-pointer transition-colors ${
                            selectedRepo?.repo === repo.name
                              ? 'bg-green-600/30 border border-green-500/50'
                              : 'bg-white/5 hover:bg-white/10 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Folder className="h-4 w-4 text-blue-400" />
                              <span className="text-sm font-medium text-white">{repo.name}</span>
                              {repo.private && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 border-white/20 text-white/50">
                                  Private
                                </Badge>
                              )}
                            </div>
                            {repo.stars > 0 && (
                              <span className="text-xs text-yellow-400 flex items-center gap-1">
                                ★ {repo.stars}
                              </span>
                            )}
                          </div>
                          {repo.description && (
                            <p className="text-xs text-white/50 mt-1 truncate">{repo.description}</p>
                          )}
                          {repo.language && (
                            <p className="text-xs text-white/30 mt-1">{repo.language}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {importError && (
                  <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-sm">
                    {importError}
                  </div>
                )}

                <div className="flex gap-3 justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setShowUrlInput(!showUrlInput)}
                    disabled={isImporting}
                    className="border-white/20 text-white/70"
                  >
                    {showUrlInput ? 'Hide URL Input' : 'Import via URL'}
                  </Button>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setShowGithubImport(false)}
                      disabled={isImporting}
                      className="border-white/20 text-white/70"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => selectedRepo && handleImportFromRepo(selectedRepo)}
                      disabled={isImporting || !selectedRepo}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        'Import Selected'
                      )}
                    </Button>
                  </div>
                </div>

                {showUrlInput && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-xs text-white/40 mb-2">Or enter a GitHub URL:</p>
                    <div className="flex gap-2">
                      <Input
                        value={githubUrl}
                        onChange={(e) => {
                          setGithubUrl(e.target.value);
                          setImportError(null);
                        }}
                        placeholder="https://github.com/owner/repo"
                        className="flex-1 bg-black/40 border-white/20 text-white"
                        disabled={isImporting}
                      />
                      <Button
                        onClick={async () => {
                          if (!githubUrl.trim()) {
                            setImportError('Please enter a GitHub URL');
                            return;
                          }
                          setIsImporting(true);
                          setImportError(null);
                          try {
                            const response = await fetch('/api/integrations/github', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ url: githubUrl }),
                            });
                            const data = await response.json();
                            if (!response.ok) {
                              setImportError(data.error || 'Failed to import from GitHub');
                              setIsImporting(false);
                              return;
                            }
                            const files = data.files;
                            let importedCount = 0;
                            for (const [path, content] of Object.entries(files)) {
                              try {
                                // Normalize path for API compatibility (fixes 400 error)
                                const normalizedPath = normalizePath(path);
                                await vfs.writeFile(normalizedPath, content as string);
                                importedCount++;
                              } catch (err) {
                                console.error(`Failed to write ${path}:`, err);
                              }
                            }
                            const snapshot = await vfs.getSnapshot();
                            setVfsSnapshot(snapshot);
                            setFilesystem({
                              sessionId: filesystem?.sessionId || "default",
                              version: snapshot?.version || 1,
                              files: snapshot?.files || [],
                            });
                            toast.success(`Imported ${importedCount} files from ${data.repo.fullName}`);
                            setShowGithubImport(false);
                            setGithubUrl('');
                          } catch (err) {
                            setImportError(err instanceof Error ? err.message : 'Failed to import from GitHub');
                          } finally {
                            setIsImporting(false);
                          }
                        }}
                        disabled={isImporting || !githubUrl.trim()}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
