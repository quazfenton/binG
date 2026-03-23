/**
 * GitHub Repository Import Component
 * 
 * Import/clone repositories from GitHub.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Github,
  Download,
  Search,
  Star,
  GitFork,
  Code,
  Loader2,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { useVirtualFilesystem } from '@/hooks/use-virtual-filesystem';

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  private: boolean;
  default_branch: string;
}

interface GitHubImportProps {
  onImportComplete?: (filesCount: number) => void;
}

export default function GitHubImport({ onImportComplete }: GitHubImportProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vfs = useVirtualFilesystem('project');

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const response = await fetch('/api/integrations/github/oauth/status');
      const data = await response.json();
      
      if (data.connected) {
        setIsConnected(true);
        setRepos(data.repos || []);
      }
    } catch (error) {
      console.error('[GitHub Import] Failed to check connection:', error);
    }
  };

  const connectGitHub = () => {
    // Use scoped OAuth for full repo access (import files)
    // This is different from basic GitHub login in Settings.tsx
    const scopes = ['repo', 'user'];
    window.location.href = `/auth/login?connection=github&scope=${encodeURIComponent(scopes.join(' '))}`;
  };

  const importRepo = async () => {
    if (!selectedRepo) return;

    try {
      setIsImporting(true);
      setImportProgress({ current: 0, total: 100 });
      setError(null);

      const response = await fetch('/api/integrations/github/source-control/import-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: selectedRepo.full_name.split('/')[0],
          repo: selectedRepo.full_name.split('/')[1],
          branch: selectedRepo.default_branch,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to import repository');
      }

      // Write files to VFS
      setImportProgress({ current: 0, total: Object.keys(data.files).length });
      
      let importedCount = 0;
      for (const [path, content] of Object.entries(data.files)) {
        try {
          await vfs.writeFile(path, content as string);
          importedCount++;
          setImportProgress({ current: importedCount, total: Object.keys(data.files).length });
        } catch (err) {
          console.error(`Failed to write ${path}:`, err);
        }
      }

      // Refresh VFS snapshot
      const snapshot = await vfs.getSnapshot();
      
      toast.success('Repository imported!', {
        description: `${importedCount} files from ${selectedRepo.full_name}`,
      });

      onImportComplete?.(importedCount);
    } catch (error: any) {
      console.error('[GitHub Import] Error:', error);
      setError(error.message || 'Failed to import repository');
      toast.error('Import failed', {
        description: error.message,
      });
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const filteredRepos = repos.filter((repo) =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center">
          <Github className="w-10 h-10 text-gray-400" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-white font-medium text-lg">Import from GitHub</h3>
          <p className="text-gray-400 text-sm max-w-md">
            Connect your GitHub account to import repositories directly into your workspace
          </p>
        </div>
        <Button
          onClick={connectGitHub}
          className="bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white border border-gray-600"
        >
          <Github className="w-4 h-4 mr-2" />
          Connect GitHub
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-700 to-gray-800 border border-gray-600 flex items-center justify-center">
              <Github className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-white font-medium text-sm">Import Repository</h3>
              <p className="text-gray-400 text-xs">{repos.length} repositories available</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search repositories..."
            className="pl-10 bg-gray-900 border-gray-700 text-white text-sm"
          />
        </div>
      </div>

      {/* Repository List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filteredRepos.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No repositories found</p>
              {searchQuery && (
                <p className="text-sm mt-1">Try a different search term</p>
              )}
            </div>
          ) : (
            filteredRepos.map((repo) => (
              <div
                key={repo.full_name}
                onClick={() => setSelectedRepo(repo)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedRepo?.full_name === repo.full_name
                    ? 'bg-purple-500/10 border-purple-500/50'
                    : 'bg-black/20 border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium text-sm truncate">
                        {repo.name}
                      </span>
                      {repo.private && (
                        <Badge variant="secondary" className="text-[10px] bg-gray-700">
                          Private
                        </Badge>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      {repo.language && (
                        <span className="flex items-center gap-1">
                          <Code className="w-3 h-3" />
                          {repo.language}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        {repo.stargazers_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-3 h-3" />
                        {repo.forks_count}
                      </span>
                    </div>
                  </div>
                  {selectedRepo?.full_name === repo.full_name && (
                    <CheckCircle className="w-5 h-5 text-purple-400 flex-shrink-0" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Import Section */}
      {selectedRepo && (
        <div className="p-4 border-t border-gray-800 space-y-3">
          <Separator className="bg-gray-800" />
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium text-sm">{selectedRepo.full_name}</p>
              <p className="text-gray-400 text-xs">
                Default branch: {selectedRepo.default_branch}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(selectedRepo.html_url, '_blank')}
              className="text-gray-400 hover:text-white"
            >
              <ExternalLink className="w-4 h-4 mr-1" />
              View
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {importProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Importing...</span>
                <span>{importProgress.current} / {importProgress.total}</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300"
                  style={{
                    width: importProgress.total > 0 
                      ? `${(importProgress.current / importProgress.total) * 100}%`
                      : '0%'
                  }}
                />
              </div>
            </div>
          )}

          <Button
            onClick={importRepo}
            disabled={isImporting}
            className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 text-white"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Import Repository
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
