"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { Octokit } from 'octokit';
import { Button } from '../ui/button';
import { CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import {
  GitBranch,
  Star,
  X,
  Folder,
  File,
  AlertCircle,
  Flame,
  GitFork,
  ExternalLink,
  Download,
  Loader2,
  FolderPlus,
  ArrowLeft,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { buildApiHeaders } from '@/lib/utils';

interface GitHubRepo {
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  default_branch?: string;
}

interface PopularRepo {
  id: number;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
}

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
}

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
}

const GitHubExplorerPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoData, setRepoData] = useState<GitHubRepo | null>(null);
  const [tree, setTree] = useState<GitHubFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalTreeCount, setTotalTreeCount] = useState(0);
  const [octokit, setOctokit] = useState<Octokit | null>(null);
  const [token, setToken] = useState('');
  const [popularRepos, setPopularRepos] = useState<PopularRepo[]>([]);
  const [isPopularLoading, setIsPopularLoading] = useState(false);
  const [trendingRepos, setTrendingRepos] = useState<TrendingRepo[]>([]);
  const [isTrendingLoading, setIsTrendingLoading] = useState(false);
  const [cloneRepoUrl, setCloneRepoUrl] = useState('');
  const [clonePath, setClonePath] = useState('repos');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<string | null>(null);

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextToken = e.target.value;
    setToken(nextToken);
    if (nextToken) {
      setOctokit(new Octokit({ auth: nextToken }));
    } else {
      setOctokit(null);
    }
  };

  const parseRepoUrl = (url: string): { owner: string; repo: string } | null => {
    try {
      const cleaned = url.split('#')[0].split('?')[0].replace(/\/+$/, '');
      const urlObject = new URL(cleaned);
      const pathParts = urlObject.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        return { owner: pathParts[0], repo: pathParts[1].replace(/\.git$/, '') };
      }
    } catch (_e) {
      const cleaned = url.split('#')[0].split('?')[0].replace(/\/+$/, '');
      const parts = cleaned.split('/').filter(Boolean);
      if (parts.length === 2) {
        return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
      }
    }
    return null;
  };

  const ghFetch = useCallback(async (url: string) => {
    const headers: HeadersInit = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers.Authorization = `token ${token}`;
    const res = await fetch(url, { headers });
    if (res.status === 403) {
      const retryAfter = res.headers.get('retry-after');
      throw new Error(
        `GitHub API rate limit exceeded.${retryAfter ? ` Try again in ${retryAfter}s.` : ''} ${token ? '' : 'Add a token for higher limits (5000 req/hour).'}`,
      );
    }
    if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
    return res.json();
  }, [token]);

  const fetchPopularRepos = useCallback(async () => {
    setIsPopularLoading(true);
    try {
      const data = await ghFetch(
        'https://api.github.com/search/repositories?q=stars:%3E10000&sort=stars&order=desc&per_page=12',
      );
      setPopularRepos(data.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load popular repositories.');
    } finally {
      setIsPopularLoading(false);
    }
  }, [ghFetch]);

  const fetchTrendingRepos = useCallback(async () => {
    setIsTrendingLoading(true);
    try {
      const response = await fetch('/api/integrations/github?type=trending');
      const result = await response.json();
      if (result.success) {
        setTrendingRepos(result.data.repos || []);
      } else {
        setError(result.error || 'Failed to load trending repositories.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load trending repositories.');
    } finally {
      setIsTrendingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPopularRepos();
    fetchTrendingRepos();
  }, [fetchPopularRepos, fetchTrendingRepos]);

  const fetchRepoData = useCallback(async (inputUrl?: string) => {
    const sourceUrl = (inputUrl ?? repoUrl).trim();
    if (!sourceUrl) {
      setError('Please enter a repository URL.');
      return;
    }
    const parsed = parseRepoUrl(sourceUrl);
    if (!parsed) {
      setError('Invalid repository URL. Please use owner/repo or a full GitHub URL.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setRepoData(null);
    setTree([]);
    setSelectedFile(null);
    setTotalTreeCount(0);

    try {
      const { owner, repo } = parsed;

      if (octokit) {
        const { data: repoDetails } = await octokit.rest.repos.get({ owner, repo });
        setRepoData(repoDetails);
        setCloneRepoUrl(repoDetails.html_url);

        const { data: treeData } = await octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: repoDetails.default_branch,
          recursive: '1',
        });

        const allFiles = treeData.tree.map((item: any) => ({
          name: item.path.split('/').pop(),
          path: item.path,
          type: item.type === 'tree' ? 'dir' : ('file' as 'file' | 'dir'),
          download_url: null,
        }));
        setTotalTreeCount(allFiles.length);
        setTree(allFiles.slice(0, 200));
      } else {
        const repoDetails = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
        setRepoData(repoDetails);
        setCloneRepoUrl(repoDetails.html_url);

        const treeData = await ghFetch(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/${repoDetails.default_branch}?recursive=1`,
        );

        const allFiles = treeData.tree.map((item: any) => ({
          name: item.path.split('/').pop(),
          path: item.path,
          type: item.type === 'tree' ? 'dir' : ('file' as 'file' | 'dir'),
          download_url: null,
        }));
        setTotalTreeCount(allFiles.length);
        setTree(allFiles.slice(0, 200));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch repository data.');
    } finally {
      setIsLoading(false);
    }
  }, [repoUrl, octokit, ghFetch]);

  const fetchFileContent = async (path: string) => {
    if (!repoData) return;
    const parsed = parseRepoUrl(repoData.html_url);
    if (!parsed) return;

    setIsLoading(true);
    setError(null);
    try {
      const { owner, repo } = parsed;
      if (octokit) {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        if (typeof (data as any).content === 'string') {
          const content = atob((data as any).content);
          setSelectedFile({ name: (data as any).name, content });
        }
      } else {
        const data = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
        if (typeof data.content === 'string') {
          const content = atob(data.content);
          setSelectedFile({ name: data.name, content });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch file content.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClone = async () => {
    const source = cloneRepoUrl || repoData?.html_url || repoUrl;
    if (!source.trim()) {
      setCloneResult('Enter or load a repository first.');
      return;
    }

    setIsCloning(true);
    setCloneResult(null);

    // Parse owner/repo from URL (needed for both client and fallback)
    const parsed = parseRepoUrl(source.trim());
    if (!parsed) {
      setCloneResult('Invalid repository URL. Use owner/repo or a full GitHub URL.');
      setIsCloning(false);
      return;
    }

    try {
      // Client clone writes directly to vfsPath — use user-provided clonePath if given,
      // otherwise derive from owner/repo for collision prevention.
      const vfsPath = clonePath.trim() || `project/sessions/${parsed.owner}/${parsed.repo}`;

      // Primary: client-side clone via GitHub API zipball
      const { cloneRepoToVFS } = await import('@/lib/github/client-clone');
      const result = await cloneRepoToVFS(
        parsed.owner,
        parsed.repo,
        vfsPath,
        {
          onProgress: (progress) => {
            if (progress.phase === 'writing') {
              setCloneResult(`Cloning... ${progress.filesWritten} files written, ${progress.filesSkipped || 0} skipped (${progress.filesProcessed}/${progress.totalFiles})`);
            } else if (progress.phase === 'downloading') {
              setCloneResult('Downloading repository...');
            } else if (progress.phase === 'extracting') {
              setCloneResult('Extracting files...');
            }
          },
          githubToken: token || undefined,
        },
      );

      setCloneResult(`Cloned ${result.filesWritten} files to ${result.vfsPath} (${result.filesSkipped} skipped)`);
    } catch (err: any) {
      // Fallback: server-side clone
      try {
        setCloneResult('Client clone failed, trying server-side...');
        const response = await fetch('/api/integrations/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'clone',
            repoUrl: source.trim(),
            // Use same destination as client clone to maintain consistency
            destinationPath: clonePath.trim() || `project/sessions/${parsed.owner}/${parsed.repo}`,
          }),
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Clone failed');
        }

        setCloneResult(`Cloned to ${data.data.vfsPath} (${data.data.filesWritten} files, ${data.data.filesSkipped || 0} skipped)`);

        // Trigger filesystem refresh
        try {
          await fetch('/api/filesystem/list', {
            headers: { ...buildApiHeaders() },
          });
        } catch {
          // Best-effort refresh
        }
      } catch (fallbackErr: any) {
        setCloneResult(`Clone failed: ${fallbackErr.message || err.message}`);
      }
    } finally {
      setIsCloning(false);
    }
  };

  const loadPopularRepo = (fullName: string) => {
    setRepoUrl(fullName);
    setCloneRepoUrl(fullName);
    fetchRepoData(fullName);
  };

  const loadTrendingRepo = (fullName: string) => {
    setRepoUrl(fullName);
    setCloneRepoUrl(fullName);
    fetchRepoData(fullName);
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="p-4 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-emerald-400" />
            <CardTitle className="text-lg">GitHub Explorer</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 bg-black">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-400 mb-2 block">GitHub Token (optional)</label>
            <Input
              type="password"
              value={token}
              onChange={handleTokenChange}
              placeholder="Personal Access Token"
              className="bg-zinc-900 border-zinc-700 text-white"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-400 mb-2 block">Repository URL or owner/repo</label>
            <div className="flex gap-2">
              <Input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="owner/repo or full URL"
                className="bg-zinc-900 border-zinc-700 text-white"
              />
              <Button onClick={() => fetchRepoData()} disabled={!repoUrl || isLoading} className="bg-emerald-600 hover:bg-emerald-500 text-black">
                {isLoading ? <Loader2 className="w-4 h-4 thinking-spinner" /> : 'Explore'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <FolderPlus className="w-4 h-4 text-cyan-400" />
            Clone Repository to Filesystem
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              value={cloneRepoUrl}
              onChange={(e) => setCloneRepoUrl(e.target.value)}
              placeholder="Repository URL"
              className="bg-zinc-900 border-zinc-700 text-white"
            />
            <Input
              value={clonePath}
              onChange={(e) => setClonePath(e.target.value)}
              placeholder="Destination folder (relative to app root)"
              className="bg-zinc-900 border-zinc-700 text-white"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button onClick={handleClone} disabled={isCloning} className="bg-cyan-500 hover:bg-cyan-400 text-black">
              {isCloning ? <Loader2 className="w-4 h-4 thinking-spinner" /> : <Download className="w-4 h-4 mr-2" />} 
              Clone Now
            </Button>
            {cloneResult && <p className="text-xs text-zinc-300 break-all">{cloneResult}</p>}
          </div>
        </div>

        {error && (
          <div className="bg-red-950/70 border border-red-900 text-red-300 p-3 rounded-md flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        {!repoData && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-pink-400" />
              <h3 className="font-semibold">Trending Repositories</h3>
            </div>
            {isTrendingLoading ? (
              <div className="text-zinc-400 text-sm">Loading trending repositories...</div>
            ) : (
              <div className="overflow-y-auto max-h-[500px] pr-2 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {trendingRepos.map((repo) => (
                    <button
                      key={repo.full_name}
                      onClick={() => loadTrendingRepo(repo.full_name)}
                      className="text-left rounded-md border border-zinc-800 p-3 bg-zinc-900/60 hover:bg-zinc-800 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-zinc-500 font-mono">#{repo.rank}</span>
                          <p className="font-medium truncate">{repo.full_name}</p>
                        </div>
                        <ExternalLink className="w-4 h-4 text-zinc-400 shrink-0" />
                      </div>
                      <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{repo.description || 'No description.'}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-zinc-300">
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-400" />
                          {repo.stars.toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <GitFork className="w-3 h-3 text-sky-400" />
                          {repo.forks.toLocaleString()}
                        </span>
                        {repo.language && (
                          <span className="text-zinc-500 truncate">{repo.language}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!repoData && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-orange-400" />
              <h3 className="font-semibold">Popular Repositories</h3>
            </div>
            {isPopularLoading ? (
              <div className="text-zinc-400 text-sm">Loading popular repositories...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {popularRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => loadPopularRepo(repo.full_name)}
                    className="text-left rounded-md border border-zinc-800 p-3 bg-zinc-900/60 hover:bg-zinc-800 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium truncate">{repo.full_name}</p>
                      <ExternalLink className="w-4 h-4 text-zinc-400" />
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{repo.description || 'No description.'}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-zinc-300">
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400" />
                        {repo.stargazers_count.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-3 h-3 text-sky-400" />
                        {repo.forks_count.toLocaleString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {repoData && (
          <div className="border-t border-zinc-800 pt-4 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRepoData(null);
                  setTree([]);
                  setSelectedFile(null);
                  setTotalTreeCount(0);
                }}
                className="text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            </div>
            <div className="flex justify-between items-start mb-4 gap-2">
              <div>
                <h2 className="text-xl font-bold">{repoData.name}</h2>
                <p className="text-zinc-400">{repoData.description}</p>
                <div className="flex gap-4 mt-2">
                  <div className="flex items-center text-sm">
                    <Star className="w-4 h-4 mr-1 text-yellow-400" />
                    {repoData.stargazers_count.toLocaleString()} stars
                  </div>
                  <div className="flex items-center text-sm">
                    <GitFork className="w-4 h-4 mr-1 text-sky-400" />
                    {repoData.forks_count.toLocaleString()} forks
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={() => window.open(repoData.html_url, '_blank', 'noopener,noreferrer')} className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open on GitHub
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[calc(100vh-520px)]">
              <div className="bg-zinc-950 p-4 rounded border border-zinc-800">
                <h3 className="font-medium mb-2">File Explorer</h3>
                {totalTreeCount > 200 && (
                  <p className="text-xs text-zinc-500 mb-2">Showing first {tree.length} of {totalTreeCount} files</p>
                )}
                <ScrollArea className="h-full pr-4">
                  {tree.map((item) => (
                    <div key={item.path} className="flex items-center gap-2 py-1">
                      {item.type === 'dir' ? <Folder className="w-4 h-4 text-blue-400" /> : <File className="w-4 h-4 text-zinc-400" />}
                      <button
                        onClick={() => item.type === 'file' && fetchFileContent(item.path)}
                        className={`text-left ${item.type === 'file' ? 'hover:underline' : 'cursor-default'}`}
                        disabled={item.type === 'dir'}
                      >
                        {item.name}
                      </button>
                    </div>
                  ))}
                </ScrollArea>
              </div>

              <div className="bg-zinc-950 p-4 rounded border border-zinc-800">
                <h3 className="font-medium mb-2">{selectedFile ? selectedFile.name : 'Select a file'}</h3>
                <ScrollArea className="h-full">
                  <pre className="text-xs bg-black p-2 rounded max-h-full overflow-y-auto text-zinc-200">
                    {selectedFile ? selectedFile.content : 'File content will be displayed here.'}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </div>
  );
};

export default GitHubExplorerPlugin;
