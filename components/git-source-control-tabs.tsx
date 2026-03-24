/**
 * Git Source Control Component with Tabs
 * 
 * VSCode-like Git source control panel with:
 * - Source Control (staging, commits, push/pull)
 * - Pull Requests (create and view PRs)
 * - Import (clone/import repositories)
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  Plus,
  Minus,
  Check,
  X,
  AlertCircle,
  Loader2,
  ChevronDown,
  ExternalLink,
  Github,
  LogIn,
  LogOut,
  Eye,
  FileDiff,
  Download,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useVirtualFilesystem } from '@/hooks/use-virtual-filesystem';
import CreatePullRequest from './github-create-pr';
import GitHubImport from './github-import';

// File change item component
function FileChangeItem({ change, onToggle }: { change: GitFileChange; onToggle: () => void }) {
  const statusColors = { added: 'text-green-400', modified: 'text-yellow-400', deleted: 'text-red-400', renamed: 'text-blue-400' };
  const statusIcons = { added: <Plus className="w-3 h-3" />, modified: <FileDiff className="w-3 h-3" />, deleted: <Minus className="w-3 h-3" />, renamed: <GitBranch className="w-3 h-3" /> };

  return (
    <div onClick={onToggle} className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-800/50 cursor-pointer group">
      <div className={`w-5 h-5 flex items-center justify-center ${statusColors[change.status]}`}>{statusIcons[change.status]}</div>
      <span className="flex-1 text-sm text-gray-300 truncate">{change.path}</span>
      {(change.additions !== undefined || change.deletions !== undefined) && (
        <div className="flex items-center gap-1 text-xs">
          {change.additions !== undefined && change.additions > 0 && <span className="text-green-400">+{change.additions}</span>}
          {change.deletions !== undefined && change.deletions > 0 && <span className="text-red-400">-{change.deletions}</span>}
        </div>
      )}
      <div className="w-4 h-4 rounded border border-gray-600 group-hover:border-gray-500 flex items-center justify-center">
        {change.staged && <Check className="w-3 h-3 text-green-400" />}
      </div>
    </div>
  );
}

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface GitCommitInfo {
  sha: string;
  message: string;
  author: string;
  email: string;
  date: string;
  url?: string;
  additions?: number;
  deletions?: number;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  sha: string;
}

export interface GitHubConnection {
  isConnected: boolean;
  login?: string;
  avatarUrl?: string;
  repos?: Array<{ name: string; full_name: string }>;
}

interface GitSourceControlProps {
  scopePath: string;
}

export default function GitSourceControl({ scopePath }: GitSourceControlProps) {
  // Git state
  const [isConnected, setIsConnected] = useState(false);
  const [gitHub, setGitHub] = useState<GitHubConnection>({ isConnected: false });
  const [isLoading, setIsLoading] = useState(true);
  
  // Changes state
  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [stagedChanges, setStagedChanges] = useState<GitFileChange[]>([]);
  
  // Commit state
  const [commitMessage, setCommitMessage] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  
  // Branch state
  const [currentBranch, setCurrentBranch] = useState<GitBranchInfo | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  
  // History state
  const [commitHistory, setCommitHistory] = useState<GitCommitInfo[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Push/Pull state
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const vfs = useVirtualFilesystem(scopePath);

  // Check GitHub connection on mount
  useEffect(() => {
    checkGitHubConnection();
  }, []);

  // Load changes when scope changes
  useEffect(() => {
    if (isConnected) {
      loadChanges();
    }
  }, [scopePath, isConnected]);

  const checkGitHubConnection = async () => {
    try {
      setIsLoading(true);

      // Use new /api/integrations/github/oauth/status endpoint
      const statusResponse = await fetch('/api/integrations/github/oauth/status');
      const status = await statusResponse.json();

      if (status.connected) {
        // Map API response to GitHubConnection interface
        setGitHub({
          isConnected: true,
          login: status.login,
          avatarUrl: status.avatarUrl,
          repos: status.repos,
        });
        setIsConnected(true);
        if (status.repos?.[0]) {
          loadBranches(status);  // ✅ Pass full connection object, not single repo
        }
        loadHistory();
      } else {
        setGitHub({ isConnected: false });
        setIsConnected(false);
      }
    } catch (error) {
      console.error('[Git] Failed to check connection:', error);
      setGitHub({ isConnected: false });
    } finally {
      setIsLoading(false);
    }
  };

  const connectGitHub = () => {
    // Use scoped OAuth for full repo access (commits, push, pull, PRs)
    // This is different from basic GitHub login in Settings.tsx
    const scopes = ['repo', 'user', 'workflow'];
    window.location.href = `/auth/login?connection=github&scope=${encodeURIComponent(scopes.join(' '))}`;
  };

  const disconnectGitHub = async () => {
    try {
      const response = await fetch('/api/integrations/github/oauth/disconnect', { method: 'POST' });

      if (response.ok) {
        setGitHub({ isConnected: false });
        setIsConnected(false);
        setChanges([]);
        setStagedChanges([]);
        toast.success('GitHub disconnected');
      }
    } catch (error) {
      toast.error('Failed to disconnect GitHub');
    }
  };

  const loadChanges = async () => {
    try {
      // Use VFS snapshot for local file changes
      // Note: Local git status is not implemented - we track changes via VFS
      const snapshot = await vfs.getSnapshot();

      const fileChanges: GitFileChange[] = snapshot.files.map((f: any) => ({
        path: f.path,
        status: 'modified' as const,
        staged: false,
        additions: 0,
        deletions: 0,
      }));

      setChanges(fileChanges);
      setStagedChanges([]);
    } catch (error) {
      console.error('[Git] Failed to load changes:', error);
      // Don't show error to user - just show empty state
      setChanges([]);
      setStagedChanges([]);
    }
  };

  const loadBranches = async (connection: GitHubConnection) => {
    try {
      if (!connection.repos?.[0]) return;
      
      const [owner, repo] = connection.repos[0].full_name.split('/');
      
      const response = await fetch(`/api/integrations/github/source-control/branches?owner=${owner}&repo=${repo}`);
      const data = await response.json();
      
      if (data.branches) {
        setBranches(data.branches);
        setCurrentBranch(data.branches.find((b: any) => b.current) || data.branches[0]);
      }
    } catch (error) {
      console.error('[Git] Failed to load branches:', error);
    }
  };

  const loadHistory = async () => {
    try {
      setIsLoadingHistory(true);
      
      const statusResponse = await fetch('/api/integrations/github/oauth/status');
      const status = await statusResponse.json();
      
      if (!status.repos?.[0]) return;
      
      const [owner, repo] = status.repos[0].full_name.split('/');
      
      const response = await fetch(`/api/integrations/github/source-control/commits?owner=${owner}&repo=${repo}`);
      const data = await response.json();
      
      if (data.commits) {
        setCommitHistory(data.commits.slice(0, 20));
      }
    } catch (error) {
      console.error('[Git] Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const stageChange = (path: string) => {
    const change = changes.find((c) => c.path === path);
    if (!change) return;

    setChanges((prev) => prev.filter((c) => c.path !== path));
    setStagedChanges((prev) => [...prev, { ...change, staged: true }]);
  };

  const unstageChange = (path: string) => {
    const change = stagedChanges.find((c) => c.path === path);
    if (!change) return;

    setStagedChanges((prev) => prev.filter((c) => c.path !== path));
    setChanges((prev) => [...prev, { ...change, staged: false }]);
  };

  const stageAll = () => {
    setStagedChanges((prev) => [...prev, ...changes.map((c) => ({ ...c, staged: true }))]);
    setChanges([]);
  };

  const unstageAll = () => {
    setChanges((prev) => [...prev, ...stagedChanges.map((c) => ({ ...c, staged: false }))]);
    setStagedChanges([]);
  };

  const commit = async () => {
    if (!commitMessage.trim()) {
      toast.error('Please enter a commit message');
      return;
    }

    if (stagedChanges.length === 0) {
      toast.error('No staged changes');
      return;
    }

    try {
      setIsCommitting(true);

      const statusResponse = await fetch('/api/integrations/github/oauth/status');
      const status = await statusResponse.json();

      if (!status.repos?.[0]) {
        toast.error('No repository selected');
        return;
      }

      const [owner, repo] = status.repos[0].full_name.split('/');

      // Fetch file content for each staged change before committing
      const changesWithContent = await Promise.all(
        stagedChanges.map(async (change) => {
          // For added files, content should already be in VFS
          // For modified/deleted files, fetch from VFS or use current content
          try {
            // Read file content from VFS via API (cannot import server modules in client components)
            const vfsPath = change.path.startsWith('project/') ? change.path : `project/${change.path}`;
            const readRes = await fetch('/api/filesystem/read', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: vfsPath }),
            });
            const readData = await readRes.json();
            const fileContent = readData.success ? (readData.data?.content ?? readData.content ?? '') : '';
            
            return {
              ...change,
              content: fileContent,
            };
          } catch (error) {
            console.warn(`Failed to read content for ${change.path}:`, error);
            // For deleted files or unreadable files, include path but no content
            return {
              ...change,
              content: '',
            };
          }
        })
      );

      const response = await fetch('/api/integrations/github/source-control/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          description: commitDescription,
          changes: changesWithContent,
          branch: currentBranch?.name,
          owner,
          repo,
        }),
      });

      if (response.ok) {
        toast.success('Changes committed');
        setCommitMessage('');
        setCommitDescription('');
        setStagedChanges([]);
        loadChanges();
        loadHistory();
      } else {
        let error;
        try {
          error = await response.json();
        } catch (e) {
          error = { error: 'Unknown error' };
        }
        toast.error(error.error || 'Failed to commit');
      }
    } catch (error) {
      toast.error('Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  const push = async () => {
    try {
      setIsPushing(true);

      const statusResponse = await fetch('/api/integrations/github/oauth/status');
      const status = await statusResponse.json();
      
      if (!status.repos?.[0]) {
        toast.error('No repository selected');
        return;
      }

      const [owner, repo] = status.repos[0].full_name.split('/');

      const response = await fetch('/api/integrations/github/source-control/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: currentBranch?.name,
          owner,
          repo,
        }),
      });

      if (response.ok) {
        toast.success('Changes pushed to GitHub');
        setLastSync(new Date());
      } else {
        let error;
        try {
          error = await response.json();
        } catch (e) {
          error = { error: 'Unknown error' };
        }
        if (error.requiresAuth) {
          toast.error('GitHub authentication required', {
            description: 'Please connect your GitHub account to push changes',
          });
        } else {
          toast.error(error.error || 'Failed to push');
        }
      }
    } catch (error) {
      toast.error('Failed to push changes');
    } finally {
      setIsPushing(false);
    }
  };

  const pull = async () => {
    try {
      setIsPulling(true);

      const statusResponse = await fetch('/api/integrations/github/oauth/status');
      const status = await statusResponse.json();
      
      if (!status.repos?.[0]) {
        toast.error('No repository selected');
        return;
      }

      const [owner, repo] = status.repos[0].full_name.split('/');

      const response = await fetch('/api/integrations/github/source-control/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: currentBranch?.name,
          owner,
          repo,
        }),
      });

      const pullResult = await response.json();

      if (response.ok && pullResult.files) {
        // Write pulled files to VFS
        let writtenCount = 0;
        for (const [path, fileData] of Object.entries(pullResult.files as Record<string, any>)) {
          try {
            await vfs.writeFile(path, fileData.content as string);
            writtenCount++;
          } catch (err) {
            console.error(`Failed to write ${path}:`, err);
          }
        }

        toast.success(`Pulled ${writtenCount} files from GitHub`);
        setLastSync(new Date());
        await loadChanges();
      } else if (response.ok) {
        toast.success('Repository is up to date');
        setLastSync(new Date());
        await loadChanges();
      } else {
        toast.error(pullResult.error || 'Failed to pull');
      }
    } catch (error) {
      toast.error('Failed to pull changes');
    } finally {
      setIsPulling(false);
    }
  };

  const switchBranch = async (branchName: string) => {
    try {
      setIsSwitchingBranch(true);
      
      const statusResponse = await fetch('/api/integrations/github/oauth/status');
      const status = await statusResponse.json();
      
      if (!status.repos?.[0]) return;

      const [owner, repo] = status.repos[0].full_name.split('/');

      const response = await fetch('/api/integrations/github/source-control/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchName, owner, repo }),
      });

      if (response.ok) {
        const branch = branches.find((b) => b.name === branchName);
        setCurrentBranch(branch || null);
        toast.success(`Switched to ${branchName}`);
        loadChanges();
        loadHistory();
        loadBranches(gitHub);
      } else {
        let error;
        try {
          error = await response.json();
        } catch (e) {
          error = { error: 'Unknown error' };
        }
        toast.error(error.error || 'Failed to switch branch');
      }
    } catch (error) {
      toast.error('Failed to switch branch');
    } finally {
      setIsSwitchingBranch(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!gitHub.isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center">
          <Github className="w-8 h-8 text-gray-400" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-white font-medium">Connect GitHub</h3>
          <p className="text-gray-400 text-sm">
            Connect your GitHub account to enable Git source control
          </p>
        </div>
        <Button
          onClick={connectGitHub}
          className="bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white border border-gray-600"
        >
          <LogIn className="w-4 h-4 mr-2" />
          Connect GitHub
        </Button>
      </div>
    );
  }

  return (
    <Tabs defaultValue="source-control" className="flex flex-col h-full">
      <div className="px-4 pt-4 border-b border-gray-800">
        <TabsList className="bg-gray-900/50 border border-gray-800">
          <TabsTrigger value="source-control" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            <GitCommit className="w-4 h-4 mr-2" />
            Source Control
          </TabsTrigger>
          <TabsTrigger value="pull-requests" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            <GitPullRequest className="w-4 h-4 mr-2" />
            PRs
          </TabsTrigger>
          <TabsTrigger value="import" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            <Download className="w-4 h-4 mr-2" />
            Import
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="source-control" className="flex-1 mt-0 flex flex-col overflow-hidden">
        {/* Source Control Content - Same as original implementation */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center">
                <GitCommit className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h3 className="text-white font-medium text-sm">Changes</h3>
                <p className="text-gray-400 text-xs">
                  {gitHub.login && `Connected as ${gitHub.login}`}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={disconnectGitHub} className="text-gray-400 hover:text-red-400">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-gray-400" />
            <select
              value={currentBranch?.name || ''}
              onChange={(e) => switchBranch(e.target.value)}
              disabled={isSwitchingBranch}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500"
            >
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name} className="bg-gray-900">
                  {branch.name} {branch.current && '(current)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {stagedChanges.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Staged ({stagedChanges.length})
                  </span>
                  <Button variant="ghost" size="sm" onClick={unstageAll} className="text-xs text-gray-400 hover:text-white h-6">
                    <Minus className="w-3 h-3 mr-1" /> Unstage All
                  </Button>
                </div>
                <div className="space-y-1">
                  {stagedChanges.map((change) => (
                    <FileChangeItem key={change.path} change={change} onToggle={() => unstageChange(change.path)} />
                  ))}
                </div>
                <Separator className="my-3 bg-gray-800" />
              </div>
            )}

            {changes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Changes ({changes.length})
                  </span>
                  <Button variant="ghost" size="sm" onClick={stageAll} className="text-xs text-gray-400 hover:text-white h-6">
                    <Plus className="w-3 h-3 mr-1" /> Stage All
                  </Button>
                </div>
                <div className="space-y-1">
                  {changes.map((change) => (
                    <FileChangeItem key={change.path} change={change} onToggle={() => stageChange(change.path)} />
                  ))}
                </div>
              </div>
            )}

            {stagedChanges.length === 0 && changes.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No changes detected</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-gray-800 space-y-3">
          <Input placeholder="Commit message" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} className="bg-gray-900 border-gray-700 text-white text-sm" />
          <Textarea placeholder="Description (optional)" value={commitDescription} onChange={(e) => setCommitDescription(e.target.value)} className="bg-gray-900 border-gray-700 text-white text-sm min-h-[60px]" />
          <div className="flex gap-2">
            <Button onClick={commit} disabled={isCommitting || stagedChanges.length === 0 || !commitMessage.trim()} className="flex-1 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 text-white">
              {isCommitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Committing...</> : <><GitCommit className="w-4 h-4 mr-2" /> Commit</>}
            </Button>
          </div>
        </div>

        <div className="p-4 border-t border-gray-800 flex gap-2">
          <Button onClick={pull} disabled={isPulling} variant="outline" className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800">
            {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ArrowDownCircle className="w-4 h-4 mr-2" /> Pull</>}
          </Button>
          <Button onClick={push} disabled={isPushing} className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white">
            {isPushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ArrowUpCircle className="w-4 h-4 mr-2" /> Push</>}
          </Button>
        </div>

        {lastSync && <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-800">Last synced: {lastSync.toLocaleString()}</div>}
      </TabsContent>

      <TabsContent value="pull-requests" className="flex-1 mt-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            <CreatePullRequest onSuccess={() => {}} />
            <Separator className="bg-gray-800" />
            <div>
              <h4 className="text-white font-medium text-sm mb-3">Recent Commits</h4>
              <div className="space-y-2">
                {commitHistory.slice(0, 10).map((commit) => (
                  <div key={commit.sha} className="p-3 bg-black/20 border border-gray-800 rounded-lg hover:border-gray-700 transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{commit.message.split('\n')[0]}</p>
                        <p className="text-gray-400 text-xs mt-1">{commit.author} • {new Date(commit.date).toLocaleDateString()}</p>
                      </div>
                      {commit.url && (
                        <a href={commit.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="import" className="flex-1 mt-0 overflow-hidden">
        <GitHubImport onImportComplete={() => {}} />
      </TabsContent>
    </Tabs>
  );
}
