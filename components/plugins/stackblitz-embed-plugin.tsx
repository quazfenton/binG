"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  Terminal,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
  Bookmark,
  BookmarkCheck,
  Zap,
  FileCode,
  Folder,
  CloudLightning,
  Cpu,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface BookmarkEntry {
  projectId: string;
  title: string;
  timestamp: number;
}

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'frontend' | 'backend' | 'fullstack' | 'other';
}

const StackBlitzEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [projectId, setProjectId] = useState('');
  const [iframeUrl, setIframeUrl] = useState('https://stackblitz.com');
  const [isLoading, setIsLoading] = useState(true);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'embed' | 'templates' | 'bookmarks'>('embed');
  const [embedMode, setEmbedMode] = useState<'full' | 'editor' | 'preview'>('full');

  const templates: Template[] = [
    { id: 'react', name: 'React', description: 'React with Vite', icon: '⚛️', category: 'frontend' },
    { id: 'react-ts', name: 'React TypeScript', description: 'React + TS + Vite', icon: '🔷', category: 'frontend' },
    { id: 'vue', name: 'Vue.js', description: 'Vue 3 with Vite', icon: '💚', category: 'frontend' },
    { id: 'angular', name: 'Angular', description: 'Angular latest', icon: '🅰️', category: 'frontend' },
    { id: 'svelte', name: 'Svelte', description: 'SvelteKit app', icon: '🧡', category: 'frontend' },
    { id: 'nextjs', name: 'Next.js', description: 'Next.js 14 App Router', icon: '▲', category: 'fullstack' },
    { id: 'remix', name: 'Remix', description: 'Remix framework', icon: '💿', category: 'fullstack' },
    { id: 'node', name: 'Node.js', description: 'Node backend', icon: '📦', category: 'backend' },
    { id: 'express', name: 'Express', description: 'Express API server', icon: '🚂', category: 'backend' },
    { id: 'nest', name: 'NestJS', description: 'NestJS framework', icon: '🏠', category: 'backend' },
    { id: 'python', name: 'Python', description: 'Python Flask', icon: '🐍', category: 'backend' },
    { id: 'deno', name: 'Deno', description: 'Deno runtime', icon: '🦕', category: 'backend' },
    { id: 'astro', name: 'Astro', description: 'Astro static site', icon: '🚀', category: 'frontend' },
    { id: 'solid', name: 'SolidJS', description: 'SolidJS framework', icon: '💎', category: 'frontend' },
    { id: 'qwik', name: 'Qwik', description: 'Qwik framework', icon: '⚡', category: 'frontend' },
    { id: 'rust', name: 'Rust', description: 'Rust WebAssembly', icon: '🦀', category: 'other' },
  ];

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('stackblitz-bookmarks');
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

  const handleLoadProject = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!projectId.trim()) {
      setIframeUrl('https://stackblitz.com');
    } else {
      const embedParam = embedMode === 'full' ? '' : `?embed=1&file=${embedMode === 'editor' ? 'src/index.ts' : ''}`;
      const url = `https://stackblitz.com/edit/${projectId}${embedParam}`;
      setIframeUrl(url);
    }
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleTemplateSelect = (templateId: string) => {
    const url = `https://stackblitz.com/edit/${templateId}?embed=1`;
    setIframeUrl(url);
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleOpenExternal = () => {
    const url = projectId
      ? `https://stackblitz.com/edit/${projectId}`
      : 'https://stackblitz.com';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleBookmark = () => {
    if (!projectId.trim()) {
      toast.error('Load a project first');
      return;
    }

    const existing = bookmarks.find(b => b.projectId === projectId);
    let newBookmarks;
    
    if (existing) {
      newBookmarks = bookmarks.filter(b => b.projectId !== projectId);
      toast.success('Removed from bookmarks');
    } else {
      const title = `StackBlitz: ${projectId}`;
      newBookmarks = [{ projectId, title, timestamp: Date.now() }, ...bookmarks];
      toast.success('Added to bookmarks');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('stackblitz-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    setProjectId(bookmark.projectId);
    const url = `https://stackblitz.com/edit/${bookmark.projectId}?embed=1`;
    setIframeUrl(url);
    setActiveTab('embed');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const isBookmarked = bookmarks.some(b => b.projectId === projectId);

  const categories = ['all', 'frontend', 'backend', 'fullstack', 'other'] as const;
  const [selectedCategory, setSelectedCategory] = useState<typeof categories[number]>('all');

  const filteredTemplates = selectedCategory === 'all' 
    ? templates 
    : templates.filter(t => t.category === selectedCategory);

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-violet-950 via-purple-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-violet-800/50 bg-violet-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
                StackBlitz
              </CardTitle>
              <p className="text-xs text-violet-200/60">Instant Dev Environments</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={embedMode}
              onChange={(e) => setEmbedMode(e.target.value as any)}
              className="px-2 py-1 bg-violet-900/50 border border-violet-700 rounded text-xs text-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="full">Full View</option>
              <option value="editor">Editor</option>
              <option value="preview">Preview</option>
            </select>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-violet-800/50"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-violet-800/50"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-violet-800/50"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-violet-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-violet-800/50">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-violet-800/50 bg-violet-950/50 px-4 py-2">
            <TabsTrigger value="embed" className="data-[state=active]:bg-violet-800/50">
              <Terminal className="w-4 h-4 mr-2" />
              Project
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-violet-800/50">
              <Folder className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-violet-800/50">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="embed" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Project ID Input */}
              <form onSubmit={handleLoadProject} className="p-3 border-b border-violet-800/50 bg-violet-950/30 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400/60" />
                  <Input
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="Enter project ID or template name..."
                    className="bg-violet-900/30 border-violet-700 text-white placeholder:text-violet-400/60 pl-10"
                  />
                </div>
                <Button type="submit" className="bg-violet-600 hover:bg-violet-500">
                  <Terminal className="w-4 h-4" />
                </Button>
                <Button type="button" onClick={handleOpenExternal} variant="outline" className="border-violet-700 hover:bg-violet-800/50">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </form>

              {/* Iframe */}
              <div className="flex-1 relative bg-violet-950">
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-violet-950/80 z-10">
                    <div className="text-center space-y-4">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto text-violet-500" />
                      <p className="text-violet-200/60">Loading StackBlitz...</p>
                    </div>
                  </div>
                )}
                
                {iframeError ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center space-y-4 max-w-md p-6">
                      <Terminal className="w-12 h-12 mx-auto text-violet-500/60" />
                      <p className="text-violet-200/60">{iframeError}</p>
                      <Button onClick={handleReload} className="bg-violet-600 hover:bg-violet-500">
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
                    title="StackBlitz"
                    onLoad={() => setIsLoading(false)}
                    onError={() => {
                      setIframeError('Failed to load StackBlitz. Note: StackBlitz requires valid project URLs.');
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
              <div className="p-2 border-t border-violet-800/50 bg-violet-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-violet-200/60">
                  <CloudLightning className="w-3 h-3" />
                  <span>Instant Boot</span>
                </div>
                <div className="flex items-center gap-2 text-violet-200/60">
                  <Cpu className="w-3 h-3" />
                  <span>WebContainers</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="templates" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Category Filter */}
              <div className="p-3 border-b border-violet-800/50 bg-violet-950/30">
                <div className="flex gap-2 overflow-x-auto">
                  {categories.map((cat) => (
                    <Button
                      key={cat}
                      size="sm"
                      variant={selectedCategory === cat ? 'default' : 'outline'}
                      onClick={() => setSelectedCategory(cat)}
                      className={selectedCategory === cat 
                        ? 'bg-violet-600 hover:bg-violet-500 whitespace-nowrap' 
                        : 'border-violet-700 hover:bg-violet-800/50 whitespace-nowrap'}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              <ScrollArea className="flex-1 p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleTemplateSelect(template.id)}
                      className="p-4 rounded-lg border border-violet-800/50 bg-violet-900/30 hover:bg-violet-900/50 hover:border-violet-500/50 transition-all text-left"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{template.icon}</span>
                        <CheckCircle className="w-4 h-4 text-violet-400 ml-auto" />
                      </div>
                      <h4 className="font-medium text-sm mb-1">{template.name}</h4>
                      <p className="text-xs text-violet-200/40">{template.description}</p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-violet-500/40" />
                    <p className="text-violet-200/60">No bookmarked projects</p>
                    <p className="text-xs text-violet-400/40">Load a project and click bookmark to save</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-violet-800/50 bg-violet-900/30 hover:bg-violet-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileCode className="w-5 h-5 text-violet-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{bookmark.title}</p>
                            <p className="text-xs text-violet-200/40">ID: {bookmark.projectId}</p>
                            <p className="text-xs text-violet-200/30">
                              {new Date(bookmark.timestamp).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadBookmark(bookmark)}
                            className="hover:bg-violet-800/50"
                          >
                            <Terminal className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(`https://stackblitz.com/edit/${bookmark.projectId}`, '_blank', 'noopener,noreferrer')}
                            className="hover:bg-violet-800/50"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                              setBookmarks(newBookmarks);
                              localStorage.setItem('stackblitz-bookmarks', JSON.stringify(newBookmarks));
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

export default StackBlitzEmbedPlugin;
