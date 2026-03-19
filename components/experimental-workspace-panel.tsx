"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { resolveScopedPath } from "@/lib/virtual-filesystem/scope-utils";
import { buildApiHeaders } from "@/lib/utils";

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

export function ExperimentalWorkspacePanel() {
  const { isOpen, activeTab, closePanel, setTab } = usePanel();
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  
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

  // Load chat history from localStorage on mount
  useEffect(() => {
    const savedChat = localStorage.getItem('experimental-chat-history');
    if (savedChat) {
      try {
        setChatMessages(JSON.parse(savedChat));
      } catch (e) {
        console.error('Failed to load chat history:', e);
      }
    }
  }, []);

  // Save chat history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('experimental-chat-history', JSON.stringify(chatMessages));
  }, [chatMessages]);
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
    (window as any).__agentActivity || { agentActivity: undefined, setAgentActivity: undefined };

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

    const userMessage: Message = {
      id: `exp-chat-${Date.now()}`,
      role: "user",
      content: promptToSend,
      timestamp: new Date().toISOString(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    if (!customPrompt) setChatInput("");
    setIsChatLoading(true);

    // Try to call the actual chat API
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

      // Get filesystem scope from the VFS
      const vfsScope = filesystem?.sessionId || 'project/sessions/default';
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesPayload,
          provider: 'openrouter',
          model: 'nvidia/nemotron-3-nano-30b-a3b:free',
          conversationId: `exp-workspace-${vfsScope}`,
          agentMode: 'auto', // Allow agentic behaviors
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

      if (response.ok) {
        const data = await response.json();
        const content = data?.data?.response || data?.data?.content || data?.content || data?.response || "Response received";
        
        const fsData = data?.data?.filesystem || data?.filesystem;
        if (fsData && fsData.applied && fsData.applied.length > 0) {
          console.log('[ExperimentalWorkspace] Filesystem operations applied:', fsData.applied);
          toast.success(`Applied ${fsData.applied.length} file changes`);
          
          const snapshot = await vfs.getSnapshot();
          setVfsSnapshot(snapshot);
          setFilesystem({
            sessionId: vfsScope,
            version: snapshot?.version || 1,
            files: snapshot?.files || [],
          });
        }
        
        if (fsData && fsData.errors && fsData.errors.length > 0) {
          console.warn('[ExperimentalWorkspace] Filesystem errors:', fsData.errors);
          toast.error(`Errors applying some changes: ${fsData.errors[0]}`);
        }
        
        const assistantMessage: Message = {
          id: `exp-chat-${Date.now()}`,
          role: "assistant",
          content: typeof content === 'string' ? content : JSON.stringify(content),
          timestamp: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error('API request failed');
      }
    } catch (error) {
      console.error('[ExperimentalWorkspace] Chat error:', error);
      toast.error('Chat failed. Check console for details.');
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, isChatLoading, chatMessages, filesystem, vfs, attachedFiles]);

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
    setChatMessages([]);
    toast.success("Chat history cleared");
  }, []);

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
    const newPath = `${cleanParentPath}/${newItemName.trim()}`;

    try {
      await writeFile(newPath, '');
      await listDirectory(creatingParentPath);
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
    const folderPath = `${cleanParentPath}/${newItemName.trim()}`;
    const gitkeepPath = `${folderPath}/.gitkeep`;

    try {
      await writeFile(gitkeepPath, '');
      await listDirectory(creatingParentPath);
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

  const handlePasteToFolder = useCallback(async (targetFolderPath: string) => {
    if (!clipboard) return;

    const sourceName = clipboard.sourcePath.split('/').pop() || '';
    const targetPath = targetFolderPath === '/' ? `/${sourceName}` : `${targetFolderPath}/${sourceName}`;

    // Check if target exists
    const exists = vfsSnapshot?.files.some(f => f.path === targetPath);
    if (exists) {
      setConfirmDialogData({
        title: 'File Exists',
        message: `A file named "${sourceName}" already exists in this folder. Overwrite?`,
        onConfirm: async () => {
          await performPaste(targetPath);
          setShowConfirmDialog(false);
          setConfirmDialogData(null);
        },
      });
      setShowConfirmDialog(true);
      return;
    }

    await performPaste(targetPath);
  }, [clipboard, vfsSnapshot?.files]);

  const performPaste = async (targetPath: string) => {
    if (!clipboard) return;

    try {
      // Read source file
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(clipboard.sourcePath, vfs?.currentPath || '/') }),
      });

      if (!readResponse.ok) {
        throw new Error('Failed to read source file');
      }

      const payload = await readResponse.json().catch(() => null);
      const content = payload?.data?.content || '';

      // Write to target
      await writeFile(targetPath, content);

      // If cut, delete source
      if (clipboard.operation === 'cut') {
        await fetch('/api/filesystem/delete', {
          method: 'POST',
          headers: buildApiHeaders(),
          body: JSON.stringify({ path: resolveScopedPath(clipboard.sourcePath, vfs?.currentPath || '/') }),
        });
      }

      await listDirectory(vfs?.currentPath || '/');
      toast.success(`File ${clipboard.operation === 'cut' ? 'moved' : 'copied'} successfully`);
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
    const newPath = parentPath === '/' ? `/${renameValue.trim()}` : `${parentPath}/${renameValue.trim()}`;

    // Check if new name exists
    const exists = vfsSnapshot?.files.some(f => f.path === newPath && f.path !== renamingFile);
    if (exists) {
      setConfirmDialogData({
        title: 'File Exists',
        message: `A file named "${renameValue.trim()}" already exists. Overwrite?`,
        onConfirm: async () => {
          await performRename(newPath);
          setShowConfirmDialog(false);
          setConfirmDialogData(null);
        },
      });
      setShowConfirmDialog(true);
      return;
    }

    await performRename(newPath);
  }, [renamingFile, renameValue, vfsSnapshot?.files]);

  const performRename = async (newPath: string) => {
    if (!renamingFile) return;

    try {
      // Read source
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(renamingFile, vfs?.currentPath || '/') }),
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
    const targetPath = targetFolderPath === '/' ? `/${fileName}` : `${targetFolderPath}/${fileName}`;

    // Check if target exists
    const exists = vfsSnapshot?.files.some(f => f.path === targetPath && f.path !== draggedFile);
    if (exists) {
      setConfirmDialogData({
        title: 'File Exists',
        message: `A file named "${fileName}" already exists in this folder. Overwrite?`,
        onConfirm: async () => {
          await performMove(targetPath);
          setShowConfirmDialog(false);
          setConfirmDialogData(null);
        },
      });
      setShowConfirmDialog(true);
      setDraggedFile(null);
      return;
    }

    await performMove(targetPath);
    setDraggedFile(null);
  }, [draggedFile, vfsSnapshot?.files]);

  const performMove = async (targetPath: string) => {
    if (!draggedFile) return;

    try {
      // Read source
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(draggedFile, vfs?.currentPath || '/') }),
      });

      if (!readResponse.ok) throw new Error('Failed to read file');
      const payload = await readResponse.json().catch(() => null);
      const content = payload?.data?.content || '';

      // Write to target
      await writeFile(targetPath, content);

      // Delete source
      await fetch('/api/filesystem/delete', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: resolveScopedPath(draggedFile, vfs?.currentPath || '/') }),
      });

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
                <TabsList className="grid grid-cols-8 gap-1 mx-4 mt-4 bg-white/5 border border-white/10 p-1">
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
                    <MessageSquare className="h-3 w-3 mr-1" />
                    Chat
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
                    value="agent"
                    className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60 text-xs py-1"
                  >
                    <Cpu className="h-3 w-3 mr-1" />
                    Agent
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
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-blue-400" />
                      <span className="text-sm font-medium text-white/90">Parallel Chat</span>
                      <Badge variant="secondary" className="text-[10px] bg-blue-500/20 text-blue-300">
                        {chatMessages.length} messages
                      </Badge>
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

                {/* Automations Tab */}
                <TabsContent value="automations" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Workflow className="h-4 w-4 text-cyan-400" />
                        <span className="text-sm font-medium text-white/90">Automation Templates</span>
                        <Badge variant="secondary" className="text-[10px] bg-cyan-500/20 text-cyan-300">
                          Coming Soon
                        </Badge>
                      </div>

                      {/* Automation Cards Grid */}
                      <div className="grid grid-cols-1 gap-3">
                        {/* Personal Life Manager */}
                        <Card 
                          className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30 hover:border-purple-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Personal life manager with Telegram, Google services & voice-enabled AI" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Bot className="h-4 w-4 text-purple-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">Personal Life Manager</p>
                                  <p className="text-xs text-white/50">Telegram, Google services & voice-enabled AI</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-purple-500/20">Telegram</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-blue-500/20">Google</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-green-500/20">Voice AI</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Viral Video Generator */}
                        <Card 
                          className="bg-gradient-to-br from-pink-500/10 to-orange-500/10 border-pink-500/30 hover:border-pink-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Generate AI viral videos with VEO 3 and upload to TikTok" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Video className="h-4 w-4 text-pink-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">AI Viral Video Generator</p>
                                  <p className="text-xs text-white/50">VEO 3 → TikTok automation</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-pink-500/20">VEO 3</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-black/40">TikTok</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* JSON Tutorial */}
                        <Card 
                          className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10 border-yellow-500/30 hover:border-yellow-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Learn JSON basics with an interactive step-by-step tutorial" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <GraduationCap className="h-4 w-4 text-yellow-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">Learn JSON Basics</p>
                                  <p className="text-xs text-white/50">Interactive step-by-step tutorial</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-yellow-500/20">Education</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-blue-500/20">JSON</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Code Tutorial */}
                        <Card 
                          className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30 hover:border-green-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Learn Code Node (JavaScript) with an Interactive Hands-On Tutorial" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Code className="h-4 w-4 text-green-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">Learn JavaScript</p>
                                  <p className="text-xs text-white/50">Interactive hands-on tutorial</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-green-500/20">Code</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-yellow-500/20">JavaScript</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Angie AI Assistant */}
                        <Card 
                          className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/30 hover:border-indigo-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Angie, personal AI assistant with Telegram voice and text" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <MessageCircle className="h-4 w-4 text-indigo-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">Angie AI Assistant</p>
                                  <p className="text-xs text-white/50">Telegram voice & text AI</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-indigo-500/20">Telegram</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-purple-500/20">Voice</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-cyan-500/20">AI</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* NanoBanana Video */}
                        <Card 
                          className="bg-gradient-to-br from-red-500/10 to-pink-500/10 border-red-500/30 hover:border-red-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Generate AI viral videos with NanoBanana & VEO3, shared on socials via Blotato" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Share2 className="h-4 w-4 text-red-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">NanoBanana Video Gen</p>
                                  <p className="text-xs text-white/50">Auto-share to socials via Blotato</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-red-500/20">NanoBanana</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-pink-500/20">VEO3</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-blue-500/20">Blotato</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Database Chat */}
                        <Card 
                          className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30 hover:border-cyan-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Chat with a database using AI" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Database className="h-4 w-4 text-cyan-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">Database Chat</p>
                                  <p className="text-xs text-white/50">Natural language database queries</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-cyan-500/20">Database</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-purple-500/20">AI</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* RAG Chatbot */}
                        <Card 
                          className="bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border-orange-500/30 hover:border-orange-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "RAG chatbot for company documents using Google Drive and Gemini" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <BookOpen className="h-4 w-4 text-orange-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">RAG Company Chatbot</p>
                                  <p className="text-xs text-white/50">Google Drive + Gemini</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-orange-500/20">RAG</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-blue-500/20">Drive</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-green-500/20">Gemini</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Gmail Labeling */}
                        <Card 
                          className="bg-gradient-to-br from-red-500/10 to-orange-500/10 border-red-500/30 hover:border-red-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Basic automatic Gmail email labelling with OpenAI and Gmail API" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-red-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">Gmail Auto-Label</p>
                                  <p className="text-xs text-white/50">OpenAI + Gmail API</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-red-500/20">Gmail</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-green-500/20">OpenAI</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* AI Music Generation */}
                        <Card 
                          className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Automated 🤖🎵 AI music generation with ElevenLabs, Google Sheets & Drive" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Music2 className="h-4 w-4 text-purple-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">AI Music Generator</p>
                                  <p className="text-xs text-white/50">ElevenLabs + Sheets + Drive</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-purple-500/20">ElevenLabs</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-green-500/20">Sheets</Badge>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Voice Cloning */}
                        <Card 
                          className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/30 hover:border-blue-500/50 cursor-pointer transition-all duration-300"
                          onClick={() => toast.info("Coming Soon", { description: "Automated AI voice cloning 🤖🎤 from YouTube videos to ElevenLab" })}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Mic className="h-4 w-4 text-blue-400" />
                                <div>
                                  <p className="text-sm font-medium text-white/90">AI Voice Cloning</p>
                                  <p className="text-xs text-white/50">YouTube → ElevenLabs</p>
                                </div>
                              </div>
                              <ExternalLink className="h-3 w-3 text-white/40" />
                            </div>
                            <div className="flex gap-1 mt-2">
                              <Badge variant="secondary" className="text-[9px] bg-red-500/20">YouTube</Badge>
                              <Badge variant="secondary" className="text-[9px] bg-purple-500/20">ElevenLabs</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Info Footer */}
                      <div className="mt-6 p-4 bg-white/5 rounded-lg border border-white/10">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-3 w-3 text-white/40" />
                          <span className="text-xs text-white/60">Coming Soon</span>
                        </div>
                        <p className="text-xs text-white/40">
                          These automation templates are currently in development. Click on any card to learn more about what's coming.
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

                {/* Agent Activity Tab */}
                <TabsContent value="agent" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      {/* Status Banner */}
                      <div className={`p-4 rounded-lg border ${
                        agentActivity.status === 'thinking' ? 'bg-purple-500/10 border-purple-500/30' :
                        agentActivity.status === 'executing' ? 'bg-blue-500/10 border-blue-500/30' :
                        agentActivity.status === 'completed' ? 'bg-green-500/10 border-green-500/30' :
                        'bg-white/5 border-white/10'
                      }`}>
                        <div className="flex items-center gap-3">
                          {agentActivity.status === 'thinking' && <Brain className="h-5 w-5 text-purple-400 animate-pulse" />}
                          {agentActivity.status === 'executing' && <Terminal className="h-5 w-5 text-blue-400" />}
                          {agentActivity.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-green-400" />}
                          {agentActivity.status === 'idle' && <Activity className="h-5 w-5 text-white/40" />}
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white/90">
                              {agentActivity.status === 'thinking' && 'Agent is thinking...'}
                              {agentActivity.status === 'executing' && 'Executing tasks...'}
                              {agentActivity.status === 'completed' && 'Task completed'}
                              {agentActivity.status === 'idle' && 'Agent idle'}
                            </p>
                            {agentActivity.currentAction && (
                              <p className="text-xs text-white/60 mt-1">{agentActivity.currentAction}</p>
                            )}
                          </div>
                          {agentActivity.status === 'executing' && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
                        </div>
                      </div>

                      {/* Processing Steps */}
                      {agentActivity.processingSteps.length > 0 && (
                        <Card className="bg-white/5 border-white/10">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Clock3 className="h-4 w-4 text-blue-400" />
                                <span className="text-sm font-medium text-white/90">Processing Steps</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowSteps(!showSteps)}
                                className="h-6 hover:bg-white/10"
                              >
                                {showSteps ? <ChevronUp className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                              </Button>
                            </div>
                          </CardHeader>
                          {showSteps && (
                            <CardContent>
                              <div className="space-y-2">
                                {agentActivity.processingSteps.map((step) => (
                                  <div key={step.id} className="flex items-center gap-3 text-sm">
                                    {step.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-400" />}
                                    {step.status === 'started' && <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />}
                                    {step.status === 'failed' && <AlertCircle className="h-4 w-4 text-red-400" />}
                                    {step.status === 'pending' && <div className="h-4 w-4 rounded-full border border-white/30" />}
                                    <span className={step.status === 'completed' ? 'text-white/70' : 'text-white/90'}>
                                      {step.step}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          )}
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
                            {agentActivity.toolInvocations.map((tool) => (
                              <div
                                key={tool.id}
                                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                  tool.state === 'result' ? 'bg-green-500/10 border-green-500/30' :
                                  tool.state === 'call' ? 'bg-blue-500/10 border-blue-500/30' :
                                  'bg-white/5 border-white/10'
                                }`}
                                onClick={() => setExpandedToolId(expandedToolId === tool.id ? null : tool.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {tool.state === 'result' && <CheckCircle className="h-4 w-4 text-green-400" />}
                                    {tool.state === 'call' && <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />}
                                    {tool.state === 'partial-call' && <Activity className="h-4 w-4 text-orange-400" />}
                                    <span className="text-sm font-medium text-white/90">{tool.toolName}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-white/60">
                                      {tool.state === 'partial-call' && 'Streaming...'}
                                      {tool.state === 'call' && 'Executing...'}
                                      {tool.state === 'result' && 'Completed'}
                                    </span>
                                    <ChevronDownIcon className={`h-3 w-3 transition-transform ${
                                      expandedToolId === tool.id ? 'rotate-180' : ''
                                    }`} />
                                  </div>
                                </div>
                                
                                {expandedToolId === tool.id && (
                                  <div className="mt-3 space-y-2 text-xs">
                                    {tool.args && (
                                      <div>
                                        <p className="text-white/60 mb-1">Arguments:</p>
                                        <pre className="bg-black/30 rounded p-2 text-white/80 overflow-x-auto">
                                          {JSON.stringify(tool.args, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                    {tool.result && (
                                      <div>
                                        <p className="text-white/60 mb-1">Result:</p>
                                        <pre className="bg-black/30 rounded p-2 text-white/80 overflow-x-auto">
                                          {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      )}

                      {/* Reasoning Chunks */}
                      {agentActivity.reasoningChunks.length > 0 && (
                        <Card className="bg-white/5 border-white/10">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Brain className="h-4 w-4 text-purple-400" />
                                <span className="text-sm font-medium text-white/90">Agent Reasoning</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowReasoning(!showReasoning)}
                                className="h-6 hover:bg-white/10"
                              >
                                {showReasoning ? <ChevronUp className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                              </Button>
                            </div>
                          </CardHeader>
                          {showReasoning && (
                            <CardContent className="space-y-2">
                              {agentActivity.reasoningChunks.map((chunk) => (
                                <div
                                  key={chunk.id}
                                  className={`p-3 rounded-lg border ${
                                    chunk.type === 'thought' ? 'bg-blue-500/10 border-blue-500/30' :
                                    chunk.type === 'plan' ? 'bg-green-500/10 border-green-500/30' :
                                    chunk.type === 'reasoning' ? 'bg-purple-500/10 border-purple-500/30' :
                                    'bg-orange-500/10 border-orange-500/30'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    {chunk.type === 'thought' && <MessageCircle className="h-3 w-3 text-blue-400" />}
                                    {chunk.type === 'plan' && <FileText className="h-3 w-3 text-green-400" />}
                                    {chunk.type === 'reasoning' && <Brain className="h-3 w-3 text-purple-400" />}
                                    {chunk.type === 'reflection' && <RotateCcw className="h-3 w-3 text-orange-400" />}
                                    <span className="text-xs font-medium text-white/70 capitalize">{chunk.type}</span>
                                  </div>
                                  <p className="text-sm text-white/80">{chunk.content}</p>
                                </div>
                              ))}
                            </CardContent>
                          )}
                        </Card>
                      )}

                      {/* Git Commits */}
                      {agentActivity.gitCommits.length > 0 && (
                        <Card className="bg-white/5 border-white/10">
                          <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                              <GitCommit className="h-4 w-4 text-green-400" />
                              <span className="text-sm font-medium text-white/90">Git Commits</span>
                              <Badge variant="secondary" className="text-[10px] bg-green-500/20">
                                {agentActivity.gitCommits.length}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {agentActivity.gitCommits.map((commit) => (
                              <div key={commit.version} className="p-3 rounded-lg border bg-green-500/10 border-green-500/30">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <GitCommit className="h-3 w-3 text-green-400" />
                                    <span className="text-sm font-medium text-white/90">Version {commit.version}</span>
                                  </div>
                                  <span className="text-xs text-white/60">
                                    {new Date(commit.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-xs text-white/70 mb-2">
                                  {commit.filesChanged} file{commit.filesChanged > 1 ? 's' : ''} changed
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {commit.paths.slice(0, 5).map((path, i) => (
                                    <Badge key={i} variant="secondary" className="text-[8px] bg-white/10">
                                      {path.split('/').pop()}
                                    </Badge>
                                  ))}
                                  {commit.paths.length > 5 && (
                                    <Badge variant="secondary" className="text-[8px] bg-white/10">
                                      +{commit.paths.length - 5} more
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      )}

                      {/* Diffs */}
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
                            {agentActivity.diffs.map((diff, i) => (
                              <div key={i} className="p-3 rounded-lg border bg-yellow-500/10 border-yellow-500/30">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <FileCode className="h-3 w-3 text-yellow-400" />
                                    <span className="text-sm font-medium text-white/90">{diff.path}</span>
                                  </div>
                                  <Badge variant="secondary" className="text-[8px] bg-yellow-500/20 capitalize">
                                    {diff.changeType}
                                  </Badge>
                                </div>
                                <pre className="bg-black/30 rounded p-2 text-[10px] text-white/70 overflow-x-auto max-h-32">
                                  {diff.diff}
                                </pre>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      )}

                      {/* Token Usage */}
                      {agentActivity.tokenUsage && (
                        <Card className="bg-white/5 border-white/10">
                          <CardContent className="p-3">
                            <div className="grid grid-cols-3 gap-4 text-center">
                              <div>
                                <p className="text-[10px] text-white/50 mb-1">Prompt</p>
                                <p className="text-sm font-medium text-white/90">{agentActivity.tokenUsage.prompt.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-white/50 mb-1">Completion</p>
                                <p className="text-sm font-medium text-white/90">{agentActivity.tokenUsage.completion.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-white/50 mb-1">Total</p>
                                <p className="text-sm font-medium text-green-400">{agentActivity.tokenUsage.total.toLocaleString()}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Empty State */}
                      {agentActivity.status === 'idle' && agentActivity.toolInvocations.length === 0 && (
                        <div className="text-center text-white/40 text-sm py-12">
                          <Cpu className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No agent activity yet</p>
                          <p className="text-xs mt-1">Start a task to see real-time agent actions</p>
                        </div>
                      )}

                      {/* Demo Controls */}
                      <div className="pt-4 border-t border-white/10">
                        <p className="text-xs text-white/40 mb-2">Demo Controls (for testing)</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAgentActivity(prev => ({
                                ...prev,
                                status: 'thinking',
                                currentAction: 'Analyzing request...',
                                reasoningChunks: [...prev.reasoningChunks, {
                                  id: Date.now().toString(),
                                  type: 'thought',
                                  content: 'Let me analyze this request carefully to understand what the user needs...',
                                  timestamp: Date.now(),
                                }],
                              }));
                              toast.info('Added reasoning chunk');
                            }}
                            className="h-6 text-xs"
                          >
                            Add Thought
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAgentActivity(prev => ({
                                ...prev,
                                status: 'executing',
                                currentAction: 'Writing file...',
                                toolInvocations: [...prev.toolInvocations, {
                                  id: Date.now().toString(),
                                  toolName: 'write_file',
                                  state: 'call',
                                  args: { path: 'src/index.ts', content: 'console.log("Hello")' },
                                  timestamp: Date.now(),
                                }],
                              }));
                              toast.info('Added tool invocation');
                            }}
                            className="h-6 text-xs"
                          >
                            Add Tool
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAgentActivity(prev => ({
                                ...prev,
                                gitCommits: [...prev.gitCommits, {
                                  version: prev.gitCommits.length + 1,
                                  filesChanged: 2,
                                  paths: ['src/index.ts', 'src/utils.ts'],
                                  timestamp: Date.now(),
                                }],
                              }));
                              toast.info('Added git commit');
                            }}
                            className="h-6 text-xs"
                          >
                            Add Commit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAgentActivity(prev => ({
                                ...prev,
                                status: 'completed',
                                currentAction: 'Task completed successfully',
                                tokenUsage: {
                                  prompt: 1250,
                                  completion: 850,
                                  total: 2100,
                                },
                              }));
                              toast.success('Marked as completed');
                            }}
                            className="h-6 text-xs"
                          >
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAgentActivity({
                                status: 'idle',
                                currentAction: '',
                                toolInvocations: [],
                                reasoningChunks: [],
                                processingSteps: [],
                                gitCommits: [],
                                diffs: [],
                              });
                              toast.info('Reset agent activity');
                            }}
                            className="h-6 text-xs"
                          >
                            Reset
                          </Button>
                        </div>
                      </div>
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
    </>
  );
}
