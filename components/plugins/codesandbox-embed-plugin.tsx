"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  Code,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
  Bookmark,
  BookmarkCheck,
  Play,
  FileCode,
  Folder,
  Terminal,
  Cpu,
} from 'lucide-react';
import { toast } from 'sonner';

interface BookmarkEntry {
  sandboxId: string;
  title: string;
  timestamp: number;
}

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const CodeSandboxEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [sandboxId, setSandboxId] = useState('');
  const [iframeUrl, setIframeUrl] = useState('https://codesandbox.io');
  const [isLoading, setIsLoading] = useState(true);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'embed' | 'templates' | 'bookmarks'>('embed');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const templates: Template[] = [
    { id: 'react', name: 'React', description: 'React JavaScript library', icon: '⚛️' },
    { id: 'react-ts', name: 'React TypeScript', description: 'React with TypeScript', icon: '🔷' },
    { id: 'vanilla', name: 'Vanilla JS', description: 'Plain JavaScript', icon: '📜' },
    { id: 'vue', name: 'Vue.js', description: 'Vue 3 framework', icon: '💚' },
    { id: 'angular', name: 'Angular', description: 'Angular framework', icon: '🅰️' },
    { id: 'svelte', name: 'Svelte', description: 'Svelte compiler', icon: '🧡' },
    { id: 'node', name: 'Node.js', description: 'Node backend', icon: '📦' },
    { id: 'express', name: 'Express', description: 'Express server', icon: '🚂' },
    { id: 'nextjs', name: 'Next.js', description: 'React framework', icon: '▲' },
    { id: 'nuxt', name: 'Nuxt.js', description: 'Vue framework', icon: 'N' },
    { id: 'python', name: 'Python', description: 'Python environment', icon: '🐍' },
    { id: 'rust', name: 'Rust', description: 'Rust programming', icon: '🦀' },
  ];

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('codesandbox-bookmarks');
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const handleLoadSandbox = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sandboxId.trim()) {
      setIframeUrl('https://codesandbox.io');
    } else {
      const url = `https://codesandbox.io/embed/${sandboxId}`;
      setIframeUrl(url);
    }
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleTemplateSelect = (templateId: string) => {
    setIframeUrl(`https://codesandbox.io/embed/${templateId}`);
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    if (autoRefresh) {
      setTimeout(() => setIsReloading(false), 500);
    } else {
      setTimeout(() => setIsReloading(false), 1000);
    }
  };

  const handleOpenExternal = () => {
    const url = sandboxId
      ? `https://codesandbox.io/s/${sandboxId}`
      : 'https://codesandbox.io';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleBookmark = () => {
    if (!sandboxId.trim()) {
      toast.error('Load a sandbox first');
      return;
    }

    const existing = bookmarks.find(b => b.sandboxId === sandboxId);
    let newBookmarks;
    
    if (existing) {
      newBookmarks = bookmarks.filter(b => b.sandboxId !== sandboxId);
      toast.success('Removed from bookmarks');
    } else {
      const title = `CodeSandbox: ${sandboxId}`;
      newBookmarks = [{ sandboxId, title, timestamp: Date.now() }, ...bookmarks];
      toast.success('Added to bookmarks');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('codesandbox-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    setSandboxId(bookmark.sandboxId);
    const url = `https://codesandbox.io/embed/${bookmark.sandboxId}`;
    setIframeUrl(url);
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const isBookmarked = bookmarks.some(b => b.sandboxId === sandboxId);

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-cyan-950 via-blue-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-cyan-800/50 bg-cyan-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500">
              <Code className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                CodeSandbox
              </CardTitle>
              <p className="text-xs text-cyan-200/60">Online Code Editor</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`hover:bg-cyan-800/50 ${autoRefresh ? 'text-cyan-400' : ''}`}
              title="Auto-refresh"
            >
              <Play className={`w-4 h-4 ${autoRefresh ? 'fill-current' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-cyan-800/50"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-cyan-800/50"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-cyan-800/50"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-cyan-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-cyan-800/50">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-cyan-800/50 bg-cyan-950/50 px-4 py-2">
            <TabsTrigger value="embed" className="data-[state=active]:bg-cyan-800/50">
              <Code className="w-4 h-4 mr-2" />
              Embed
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-cyan-800/50">
              <Folder className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-cyan-800/50">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="embed" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Sandbox ID Input */}
              <form onSubmit={handleLoadSandbox} className="p-3 border-b border-cyan-800/50 bg-cyan-950/30 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/60" />
                  <Input
                    value={sandboxId}
                    onChange={(e) => setSandboxId(e.target.value)}
                    placeholder="Enter sandbox ID (e.g., react-typescript)..."
                    className="bg-cyan-900/30 border-cyan-700 text-white placeholder:text-cyan-400/60 pl-10"
                  />
                </div>
                <Button type="submit" className="bg-cyan-600 hover:bg-cyan-500">
                  <Code className="w-4 h-4" />
                </Button>
                <Button type="button" onClick={handleOpenExternal} variant="outline" className="border-cyan-700 hover:bg-cyan-800/50">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </form>

              {/* Iframe */}
              <div className="flex-1 relative bg-cyan-950">
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-cyan-950/80 z-10">
                    <div className="text-center space-y-4">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto text-cyan-500" />
                      <p className="text-cyan-200/60">Loading CodeSandbox...</p>
                    </div>
                  </div>
                )}
                
                {iframeError ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center space-y-4 max-w-md p-6">
                      <Code className="w-12 h-12 mx-auto text-cyan-500/60" />
                      <p className="text-cyan-200/60">{iframeError}</p>
                      <Button onClick={handleReload} className="bg-cyan-600 hover:bg-cyan-500">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : (
                  <iframe
                    key={iframeKey}
                    src={iframeUrl}
                    className="w-full h-full border-0"
                    title="CodeSandbox"
                    onLoad={() => setIsLoading(false)}
                    onError={() => {
                      setIframeError('Failed to load CodeSandbox. Note: CodeSandbox requires valid sandbox IDs.');
                      setIsLoading(false);
                    }}
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-top-navigation allow-top-navigation-by-user-activation"
                    allow="fullscreen; encrypted-media"
                    referrerPolicy="no-referrer"
                    allowTransparency={true}
                  />
                )}
              </div>

              {/* Info Footer */}
              <div className="p-2 border-t border-cyan-800/50 bg-cyan-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-cyan-200/60">
                  <Terminal className="w-3 h-3" />
                  <span>Live Development Environment</span>
                </div>
                <div className="flex items-center gap-2 text-cyan-200/60">
                  <Cpu className="w-3 h-3" />
                  <span>Cloud-Powered</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="templates" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Folder className="w-4 h-4 text-cyan-400" />
                Start from Template
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleTemplateSelect(template.id)}
                    className="p-4 rounded-lg border border-cyan-800/50 bg-cyan-900/30 hover:bg-cyan-900/50 hover:border-cyan-500/50 transition-all text-left"
                  >
                    <div className="text-2xl mb-2">{template.icon}</div>
                    <h4 className="font-medium text-sm mb-1">{template.name}</h4>
                    <p className="text-xs text-cyan-200/40">{template.description}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-cyan-500/40" />
                    <p className="text-cyan-200/60">No bookmarked sandboxes</p>
                    <p className="text-xs text-cyan-400/40">Load a sandbox and click bookmark to save</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-cyan-800/50 bg-cyan-900/30 hover:bg-cyan-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileCode className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{bookmark.title}</p>
                            <p className="text-xs text-cyan-200/40">ID: {bookmark.sandboxId}</p>
                            <p className="text-xs text-cyan-200/30">
                              {new Date(bookmark.timestamp).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadBookmark(bookmark)}
                            className="hover:bg-cyan-800/50"
                          >
                            <Code className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(`https://codesandbox.io/s/${bookmark.sandboxId}`, '_blank', 'noopener,noreferrer')}
                            className="hover:bg-cyan-800/50"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                              setBookmarks(newBookmarks);
                              localStorage.setItem('codesandbox-bookmarks', JSON.stringify(newBookmarks));
                              toast.success('Bookmark removed');
                            }}
                            className="hover:bg-red-900/30 text-red-400"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default CodeSandboxEmbedPlugin;
