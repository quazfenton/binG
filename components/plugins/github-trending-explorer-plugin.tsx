"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  GitBranch,
  Star,
  GitFork,
  Flame,
  Download,
  ExternalLink,
  Loader2,
  X,
  FolderOpen,
  Terminal,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Search,
  Clock,
  TrendingUp,
  Code,
  FileText,
  Eye,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface TrendingRepo {
  rank: number;
  name: string;
  full_name: string;
  owner: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  todayStars: number;
  url: string;
  avatar?: string;
}

interface CloneJob {
  id: string;
  repoUrl: string;
  destinationPath: string;
  status: 'pending' | 'cloning' | 'completed' | 'error';
  message?: string;
  timestamp: number;
}

const GitHubTrendingExplorerPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [trendingRepos, setTrendingRepos] = useState<TrendingRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<TrendingRepo | null>(null);
  const [cloneJobs, setCloneJobs] = useState<CloneJob[]>([]);
  const [clonePath, setClonePath] = useState('repos');
  const [isCloning, setIsCloning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'trending' | 'cloned' | 'bookmarks'>('trending');

  // Fetch trending repos from API
  const fetchTrendingRepos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/integrations/github?type=trending');
      if (!response.ok) {
        throw new Error('Failed to fetch trending repositories');
      }
      const data = await response.json();
      if (data.success) {
        setTrendingRepos(data.data.repos);
      } else {
        throw new Error(data.error || 'Failed to fetch trending repositories');
      }
    } catch (err: any) {
      console.error('Error fetching trending repos:', err);
      setError(err.message || 'Failed to load trending repositories');
      toast.error('Failed to load trending repositories');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load bookmarks from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('github-explorer-bookmarks');
      if (saved) {
        setBookmarks(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load bookmarks:', e);
    }
  }, []);

  // Fetch trending repos on mount
  useEffect(() => {
    fetchTrendingRepos();
  }, [fetchTrendingRepos]);

  // Handle clone request
  const handleClone = async (repoUrl: string, customPath?: string) => {
    const destPath = customPath || clonePath;
    const jobId = `clone-${Date.now()}`;
    
    const newJob: CloneJob = {
      id: jobId,
      repoUrl,
      destinationPath: destPath,
      status: 'pending',
      timestamp: Date.now(),
    };
    
    setCloneJobs(prev => [newJob, ...prev]);
    setIsCloning(true);

    try {
      const response = await fetch('/api/integrations/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clone',
          repoUrl,
          destinationPath: destPath,
        }),
      });

      const data = await response.json();
      
      setCloneJobs(prev => prev.map(job => 
        job.id === jobId 
          ? { 
              ...job, 
              status: data.success ? 'completed' : 'error',
              message: data.success 
                ? `Cloned to ${data.data.destinationPath}` 
                : data.error || 'Clone failed'
            }
          : job
      ));

      if (data.success) {
        toast.success(`Repository cloned to ${data.data.destinationPath}`);
      } else {
        toast.error(data.error || 'Clone failed');
      }
    } catch (err: any) {
      setCloneJobs(prev => prev.map(job => 
        job.id === jobId 
          ? { ...job, status: 'error', message: err.message || 'Clone failed' }
          : job
      ));
      toast.error('Clone failed');
    } finally {
      setIsCloning(false);
    }
  };

  // Toggle bookmark
  const toggleBookmark = (fullName: string) => {
    const newBookmarks = bookmarks.includes(fullName)
      ? bookmarks.filter(b => b !== fullName)
      : [...bookmarks, fullName];
    
    setBookmarks(newBookmarks);
    localStorage.setItem('github-explorer-bookmarks', JSON.stringify(newBookmarks));
    toast.success(bookmarks.includes(fullName) ? 'Removed from bookmarks' : 'Added to bookmarks');
  };

  // Filter repos
  const filteredRepos = trendingRepos.filter(repo => {
    const matchesSearch = repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         repo.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLanguage = languageFilter === 'all' || repo.language === languageFilter;
    return matchesSearch && matchesLanguage;
  });

  // Get unique languages
  const languages = ['all', ...Array.from(new Set(trendingRepos.map(r => r.language).filter(Boolean)))];

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-black via-zinc-950 to-zinc-900 text-white">
      {/* Header */}
      <CardHeader className="p-4 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-pink-500">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-orange-400 to-pink-400 bg-clip-text text-transparent">
                GitHub Trending Explorer
              </CardTitle>
              <p className="text-xs text-zinc-400">Discover hot OSS projects right now</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchTrendingRepos}
              disabled={isLoading}
              className="hover:bg-zinc-800"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-zinc-800">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-zinc-950/50 px-4 py-2">
            <TabsTrigger value="trending" className="data-[state=active]:bg-zinc-800">
              <Flame className="w-4 h-4 mr-2" />
              Trending
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-zinc-800">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
            <TabsTrigger value="cloned" className="data-[state=active]:bg-zinc-800">
              <FolderOpen className="w-4 h-4 mr-2" />
              Cloned
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trending" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Filters */}
              <div className="p-4 border-b border-zinc-800 bg-zinc-950/30 space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search repositories..."
                      className="pl-10 bg-zinc-900/50 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>
                  <select
                    value={languageFilter}
                    onChange={(e) => setLanguageFilter(e.target.value)}
                    className="px-3 py-2 bg-zinc-900/50 border border-zinc-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {languages.map(lang => (
                      <option key={lang} value={lang}>
                        {lang === 'all' ? 'All Languages' : lang}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Repo Grid */}
              <ScrollArea className="flex-1 p-4">
                {isLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center space-y-4">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-orange-500" />
                      <p className="text-zinc-400">Loading trending repositories...</p>
                    </div>
                  </div>
                ) : error ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center space-y-4 max-w-md">
                      <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
                      <p className="text-red-400">{error}</p>
                      <Button onClick={fetchTrendingRepos} className="bg-orange-600 hover:bg-orange-500">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center space-y-4">
                      <Search className="w-12 h-12 mx-auto text-zinc-600" />
                      <p className="text-zinc-400">No repositories found</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredRepos.map((repo, idx) => (
                      <div
                        key={repo.full_name}
                        className="group relative rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/60 hover:border-orange-500/50 transition-all duration-300 overflow-hidden"
                      >
                        {/* Rank Badge */}
                        <div className="absolute top-3 left-3 z-10">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                            {repo.rank}
                          </div>
                        </div>

                        {/* Bookmark Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBookmark(repo.full_name);
                          }}
                          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 transition-colors"
                        >
                          {bookmarks.includes(repo.full_name) ? (
                            <BookmarkCheck className="w-4 h-4 text-orange-400" />
                          ) : (
                            <Bookmark className="w-4 h-4 text-zinc-400" />
                          )}
                        </button>

                        <div className="p-4 pt-12 space-y-3">
                          {/* Header */}
                          <div className="space-y-1">
                            <h3 className="font-bold text-lg text-white group-hover:text-orange-400 transition-colors line-clamp-1">
                              {repo.name}
                            </h3>
                            <p className="text-xs text-zinc-500">@{repo.owner}</p>
                          </div>

                          {/* Description */}
                          <p className="text-sm text-zinc-400 line-clamp-2 min-h-[2.5rem]">
                            {repo.description || 'No description provided'}
                          </p>

                          {/* Language Badge */}
                          {repo.language && (
                            <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 text-xs">
                              <Code className="w-3 h-3 mr-1" />
                              {repo.language}
                            </Badge>
                          )}

                          {/* Stats */}
                          <div className="flex items-center gap-4 pt-2 border-t border-zinc-800">
                            <div className="flex items-center gap-1 text-xs text-zinc-400">
                              <Star className="w-3 h-3 text-yellow-400" />
                              <span>{repo.stars.toLocaleString()}</span>
                              {repo.todayStars > 0 && (
                                <span className="text-green-400">(+{repo.todayStars.toLocaleString()} today)</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-zinc-400">
                              <GitFork className="w-3 h-3 text-sky-400" />
                              <span>{repo.forks.toLocaleString()}</span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2 pt-2">
                            <Button
                              size="sm"
                              onClick={() => handleClone(repo.url)}
                              disabled={isCloning}
                              className="flex-1 bg-gradient-to-r from-orange-600 to-pink-600 hover:from-orange-500 hover:to-pink-500 text-white border-0"
                            >
                              {isCloning ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <Download className="w-4 h-4 mr-1" />
                                  Clone
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(repo.url, '_blank', 'noopener,noreferrer')}
                              className="border-zinc-700 hover:bg-zinc-800"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-zinc-600" />
                    <p className="text-zinc-400">No bookmarked repositories</p>
                    <p className="text-xs text-zinc-500">Click the bookmark icon on any repo to save it here</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map(fullName => {
                    const repo = trendingRepos.find(r => r.full_name === fullName);
                    if (!repo) return null;
                    return (
                      <div
                        key={fullName}
                        className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/60 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center text-white font-bold">
                            {repo.rank}
                          </div>
                          <div>
                            <h4 className="font-medium">{repo.name}</h4>
                            <p className="text-xs text-zinc-400">{repo.description || 'No description'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleClone(repo.url)}
                            className="border-zinc-700 hover:bg-zinc-800"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleBookmark(fullName)}
                            className="hover:bg-red-900/30 text-red-400"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="cloned" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {cloneJobs.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <FolderOpen className="w-12 h-12 mx-auto text-zinc-600" />
                    <p className="text-zinc-400">No cloned repositories yet</p>
                    <p className="text-xs text-zinc-500">Clone a repository to see it here</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {cloneJobs.map(job => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/40"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {job.status === 'completed' ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : job.status === 'error' ? (
                          <AlertCircle className="w-5 h-5 text-red-500" />
                        ) : (
                          <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{job.repoUrl}</p>
                          <p className="text-xs text-zinc-400 truncate">
                            <FolderOpen className="w-3 h-3 inline mr-1" />
                            {job.destinationPath}
                          </p>
                          {job.message && (
                            <p className={`text-xs mt-1 ${job.status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                              {job.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={job.status === 'completed' ? 'default' : job.status === 'error' ? 'destructive' : 'secondary'}>
                          {job.status}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => window.open(`file://${job.destinationPath}`, '_blank', 'noopener,noreferrer')}
                          className="hover:bg-zinc-800"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </Button>
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

export default GitHubTrendingExplorerPlugin;
