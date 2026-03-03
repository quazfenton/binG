import React, { useState, useCallback } from 'react';
import { Octokit } from 'octokit';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { GitBranch, Download, Star, Code, FileText, X, Folder, File, AlertCircle } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

interface GitHubRepo {
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
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

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setToken(e.target.value);
    if (e.target.value) {
      setOctokit(new Octokit({ auth: e.target.value }));
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
    } catch (e) {
      const cleaned = url.split('#')[0].split('?')[0].replace(/\/+$/, '');
      const parts = cleaned.split('/').filter(Boolean);
      if (parts.length === 2) {
        return { owner: parts[0], repo: parts[1] };
      }
    }
    return null;
  };

  const ghFetch = useCallback(async (url: string) => {
    const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(url, { headers });
    if (res.status === 403) {
      const retryAfter = res.headers.get('retry-after');
      throw new Error(
        `GitHub API rate limit exceeded.${retryAfter ? ` Try again in ${retryAfter}s.` : ''} ${token ? '' : 'Add a token for higher limits (5000 req/hour).'}`
      );
    }
    if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
    return res.json();
  }, [token]);

  const fetchRepoData = useCallback(async () => {
    if (!repoUrl) {
      setError('Please enter a repository URL.');
      return;
    }
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      setError('Invalid repository URL. Please use the format "owner/repo" or a full GitHub URL.');
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
        setTree(allFiles.slice(0, 100));
      } else {
        const repoDetails = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
        setRepoData(repoDetails);

        const treeData = await ghFetch(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/${repoDetails.default_branch}?recursive=1`
        );

        const allFiles = treeData.tree.map((item: any) => ({
          name: item.path.split('/').pop(),
          path: item.path,
          type: item.type === 'tree' ? 'dir' : ('file' as 'file' | 'dir'),
          download_url: null,
        }));
        setTotalTreeCount(allFiles.length);
        setTree(allFiles.slice(0, 100));
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
        const data = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
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

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      <CardHeader className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-green-400" />
            <CardTitle className="text-lg">GitHub Explorer</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-4">
        <div className="mb-4">
          <label className="text-sm font-medium mb-2 block">GitHub Personal Access Token (optional)</label>
          <Input
            type="password"
            value={token}
            onChange={handleTokenChange}
            placeholder="Enter your GitHub PAT"
            className="bg-gray-800 border-gray-700"
          />
        </div>
        <div className="mb-4">
          <label className="text-sm font-medium mb-2 block">Repository URL or Name</label>
          <div className="flex gap-2">
            <Input
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="owner/repo or full URL"
              className="bg-gray-800 border-gray-700"
            />
            <Button onClick={fetchRepoData} disabled={!repoUrl || isLoading}>
              {isLoading ? 'Loading...' : 'Fetch'}
            </Button>
          </div>
        </div>
        
        {error && (
          <div className="bg-red-900/50 text-red-300 p-3 rounded-md flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        {repoData && (
          <div className="border-t border-white/10 pt-4 mt-4">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{repoData.name}</h2>
                <p className="text-white/70">{repoData.description}</p>
                <div className="flex gap-4 mt-2">
                  <div className="flex items-center text-sm">
                    <Star className="w-4 h-4 mr-1 text-yellow-400" />
                    {repoData.stargazers_count.toLocaleString()} stars
                  </div>
                  <div className="flex items-center text-sm">
                    <GitBranch className="w-4 h-4 mr-1 text-green-400" />
                    {repoData.forks_count.toLocaleString()} forks
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={() => window.open(repoData.html_url, '_blank')}>
                <Download className="w-4 h-4 mr-2" />
                Clone
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[calc(100vh-450px)]">
              <div className="bg-black/20 p-4 rounded border border-white/10">
                <h3 className="font-medium mb-2">File Explorer</h3>
                {totalTreeCount > 100 && (
                  <p className="text-xs text-white/60 mb-2">Showing first {tree.length} of {totalTreeCount} files</p>
                )}
                <ScrollArea className="h-full pr-4">
                  {tree.map(item => (
                    <div key={item.path} className="flex items-center gap-2 py-1">
                      {item.type === 'dir' ? <Folder className="w-4 h-4 text-blue-400" /> : <File className="w-4 h-4 text-gray-400" />}
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
              
              <div className="bg-black/20 p-4 rounded border border-white/10">
                 <h3 className="font-medium mb-2">{selectedFile ? selectedFile.name : 'Select a file'}</h3>
                <ScrollArea className="h-full">
                  <pre className="text-xs bg-black/30 p-2 rounded max-h-full overflow-y-auto">
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
