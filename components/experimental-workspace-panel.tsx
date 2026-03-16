"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePanel } from "@/contexts/panel-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  GitHistory,
  RotateCcw,
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
} from "lucide-react";
import { toast } from "sonner";
import { VersionHistoryPanel } from "@/components/version-history-panel";
import { useVirtualFilesystem } from "@/hooks/use-virtual-filesystem";
import type { Message } from "@/types";

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
  const [thinkingNotes, setThinkingNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState("");
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  
  const { filesystem } = useVirtualFilesystem();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Build file tree from filesystem
  const fileTree = React.useMemo(() => {
    const files = filesystem?.files || [];
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
  }, [filesystem?.files]);

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

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage: Message = {
      id: `exp-chat-${Date.now()}`,
      role: "user",
      content: chatInput.trim(),
      timestamp: Date.now(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsChatLoading(true);

    // Simulate agent response (replace with actual API call)
    setTimeout(() => {
      const assistantMessage: Message = {
        id: `exp-chat-${Date.now()}`,
        role: "assistant",
        content: "This is an experimental parallel chat. Integrate with your agent API for real responses.",
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
      setIsChatLoading(false);
    }, 1000);
  }, [chatInput, isChatLoading]);

  const addThinkingNote = useCallback(() => {
    if (!newNote.trim()) return;
    setThinkingNotes((prev) => [...prev, newNote.trim()]);
    setNewNote("");
    toast.success("Note added to thinking area");
  }, [newNote]);

  const removeThinkingNote = useCallback((index: number) => {
    setThinkingNotes((prev) => prev.filter((_, i) => i !== index));
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
    }
  }, [currentSongIndex]);

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

  const renderFileTree = useCallback((node: FileNode, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const indent = depth * 16;

    if (node.type === "directory") {
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleFolder(node.path)}
            className="flex items-center gap-1 w-full px-2 py-1 hover:bg-white/10 rounded text-left text-sm transition-colors"
            style={{ paddingLeft: indent + 8 }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-white/60" />
            ) : (
              <ChevronRight className="h-3 w-3 text-white/60" />
            )}
            <Folder className="h-3 w-3 text-blue-400" />
            <span className="text-white/80">{node.name}</span>
          </button>
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

    return (
      <button
        key={node.path}
        onClick={() => handleFileSelect(node)}
        className={`flex items-center gap-2 w-full px-2 py-1 hover:bg-white/10 rounded text-left text-sm transition-colors ${
          selectedFile?.path === node.path ? "bg-white/20" : ""
        }`}
        style={{ paddingLeft: indent + 24 }}
      >
        <FileCode className="h-3 w-3 text-green-400" />
        <span className="text-white/80 truncate">{node.name}</span>
      </button>
    );
  }, [expandedFolders, selectedFile, toggleFolder, handleFileSelect]);

  return (
    <>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={playlist[currentSongIndex]?.url}
        onEnded={nextSong}
      />

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 z-0 w-[400px] md:w-[450px] pointer-events-auto"
            style={{
              top: "200px", // Below interaction-panel
              bottom: 0,
              left: 0,
            }}
          >
            {/* Glassmorphism background */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-xl border-r border-white/10" />

            {/* Content */}
            <div className="relative h-full flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-400" />
                  <span className="text-sm font-semibold text-white/90">
                    Experimental Workspace
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closePanel}
                  className="h-6 w-6 hover:bg-white/10"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={(v) => setTab(v as PanelTab)} className="flex-1 flex flex-col">
                <TabsList className="grid grid-cols-4 gap-1 mx-4 mt-4 bg-white/5 border border-white/10 p-1">
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
                </TabsList>

                {/* Explorer Tab */}
                <TabsContent value="explorer" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-2">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs text-white/60">File Explorer</span>
                        <Badge variant="secondary" className="text-[10px] bg-white/10">
                          {filesystem?.files?.length || 0} files
                        </Badge>
                      </div>
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
                              <pre className="mt-2 p-2 bg-black/50 rounded text-[10px] text-white/70 overflow-x-auto max-h-48">
                                <code>{selectedFile.content.slice(0, 500)}{selectedFile.content.length > 500 ? "..." : ""}</code>
                              </pre>
                            )}
                          </div>
                        </>
                      )}

                      {/* Version History Integration */}
                      <Separator className="my-4 bg-white/10" />
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                          <GitHistory className="h-3 w-3 text-purple-400" />
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
                            handleSendChat();
                          }
                        }}
                        placeholder="Send message..."
                        className="flex-1 min-h-[60px] bg-white/5 border-white/10 text-white/90 placeholder:text-white/40 text-sm resize-none"
                      />
                      <Button
                        onClick={handleSendChat}
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
                  </div>
                </TabsContent>

                {/* Thinking Area Tab */}
                <TabsContent value="thinking" className="flex-1 mt-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Brain className="h-4 w-4 text-purple-400" />
                        <span className="text-sm font-medium text-white/90">Agent Thinking & State</span>
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
                          className="bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30"
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
                        </div>
                        <Button
                          onClick={addSongToPlaylist}
                          size="sm"
                          variant="ghost"
                          className="h-6 hover:bg-white/10"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add
                        </Button>
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
                              className={`flex items-center justify-between p-2 rounded ${
                                index === currentSongIndex
                                  ? "bg-pink-500/20 border border-pink-500/30"
                                  : "hover:bg-white/10"
                              }`}
                            >
                              <div
                                className="flex-1 cursor-pointer"
                                onClick={() => playSong(index)}
                              >
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
              </Tabs>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
