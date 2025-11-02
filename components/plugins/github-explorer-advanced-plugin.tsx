"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { 
  GitBranch, Search, Star, GitFork, Eye, Code, FileText, 
  Download, ExternalLink, GitCommit, Users, TrendingUp,
  Activity, Package, AlertCircle, CheckCircle, XCircle,
  Play, RefreshCw, Loader2, GitPullRequest, MessageSquare
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface RepoData {
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string;
  topics: string[];
  updated_at: string;
  size: number;
  default_branch: string;
  open_issues: number;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  size?: number;
  children?: FileNode[];
  expanded?: boolean;
}

interface DependencyNode {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface CodeMetrics {
  totalLines: number;
  languages: Record<string, number>;
  fileCount: number;
  avgComplexity: number;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  labels: Array<{ name: string; color: string }>;
  created_at: string;
  comments: number;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  head: { ref: string };
  base: { ref: string };
}

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string;
  created_at: string;
  html_url: string;
}

export default function GitHubExplorerAdvancedPlugin({ onClose }: PluginProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [dependencies, setDependencies] = useState<DependencyNode | null>(null);
  const [metrics, setMetrics] = useState<CodeMetrics | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [readme, setReadme] = useState('');

  const parseRepoUrl = (url: string) => {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) return { owner: match[1], repo: match[2].replace('.git', '') };
    const parts = url.split('/');
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
    return null;
  };

  const fetchWithAuth = async (url: string) => {
    const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
    return res.json();
  };

  const loadRepository = async () => {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      toast.error('Invalid repository URL or format');
      return;
    }

    setLoading(true);
    try {
      const data = await fetchWithAuth(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
      setRepoData({
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        html_url: data.html_url,
        stars: data.stargazers_count,
        forks: data.forks_count,
        watchers: data.watchers_count,
        language: data.language,
        topics: data.topics || [],
        updated_at: data.updated_at,
        size: data.size,
        default_branch: data.default_branch,
        open_issues: data.open_issues_count
      });

      // Load file tree
      const tree = await fetchWithAuth(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${data.default_branch}?recursive=1`
      );
      const buildTree = (items: any[]): FileNode[] => {
        const root: FileNode[] = [];
        const map: Record<string, FileNode> = {};
        
        items.forEach((item: any) => {
          const parts = item.path.split('/');
          const node: FileNode = {
            name: parts[parts.length - 1],
            path: item.path,
            type: item.type === 'tree' ? 'dir' : 'file',
            sha: item.sha,
            size: item.size,
            children: item.type === 'tree' ? [] : undefined
          };
          map[item.path] = node;
          
          if (parts.length === 1) {
            root.push(node);
          } else {
            const parentPath = parts.slice(0, -1).join('/');
            const parent = map[parentPath];
            if (parent?.children) parent.children.push(node);
          }
        });
        
        return root;
      };
      setFileTree(buildTree(tree.tree));

      // Load README
      try {
        const readmeData = await fetchWithAuth(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`
        );
        const content = atob(readmeData.content);
        setReadme(content);
      } catch {}

      // Load package.json for dependencies
      try {
        const pkgData = await fetchWithAuth(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/package.json`
        );
        const pkg = JSON.parse(atob(pkgData.content));
        setDependencies(pkg);
      } catch {}

      // Calculate metrics
      const langs = await fetchWithAuth(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/languages`);
      const totalBytes = Object.values(langs).reduce((a: any, b: any) => a + b, 0) as number;
      setMetrics({
        totalLines: Math.floor(totalBytes / 50), // rough estimate
        languages: langs,
        fileCount: tree.tree.length,
        avgComplexity: 0
      });

      // Load issues
      const issuesData = await fetchWithAuth(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues?state=all&per_page=20`
      );
      setIssues(issuesData.filter((i: any) => !i.pull_request));

      // Load PRs
      const prsData = await fetchWithAuth(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls?state=all&per_page=20`
      );
      setPrs(prsData);

      // Load workflow runs
      try {
        const workflowData = await fetchWithAuth(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/actions/runs?per_page=10`
        );
        setWorkflows(workflowData.workflow_runs);
      } catch {}

      toast.success('Repository loaded successfully');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (path: string) => {
    if (!repoData) return;
    setLoading(true);
    try {
      const parsed = parseRepoUrl(repoData.full_name);
      if (!parsed) return;
      
      const data = await fetchWithAuth(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}`
      );
      const content = atob(data.content);
      setFileContent(content);
      setSelectedFile(path);
    } catch (err: any) {
      toast.error('Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => (
      <div key={node.path} style={{ marginLeft: depth * 16 }}>
        <div
          className={`flex items-center gap-2 p-1 hover:bg-white/10 rounded cursor-pointer text-sm ${
            selectedFile === node.path ? 'bg-white/20' : ''
          }`}
          onClick={() => node.type === 'file' && loadFileContent(node.path)}
        >
          {node.type === 'dir' ? <Code className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
          <span className="truncate">{node.name}</span>
        </div>
        {node.children && node.expanded && renderFileTree(node.children, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-blue-400" />
            GitHub Explorer Pro
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4 space-y-4">
        {/* Search Bar */}
        <div className="flex gap-2">
          <Input
            placeholder="Repository URL or owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="GitHub Token (optional)"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-48"
          />
          <Button onClick={loadRepository} disabled={loading || !repoUrl}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </div>

        {repoData && (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="prs">PRs</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <Card className="bg-white/5">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{repoData.name}</CardTitle>
                    <a href={repoData.html_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open on GitHub
                      </Button>
                    </a>
                  </div>
                  <p className="text-sm text-gray-400">{repoData.description}</p>
                </CardHeader>
                <CardContent className="grid grid-cols-4 gap-4">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-yellow-400" />
                    <span>{repoData.stars.toLocaleString()} stars</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <GitFork className="w-4 h-4 text-blue-400" />
                    <span>{repoData.forks.toLocaleString()} forks</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-green-400" />
                    <span>{repoData.watchers.toLocaleString()} watchers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span>{repoData.open_issues} issues</span>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap gap-2">
                {repoData.topics.map(topic => (
                  <Badge key={topic} variant="secondary">{topic}</Badge>
                ))}
              </div>

              {readme && (
                <Card className="bg-white/5">
                  <CardHeader><CardTitle>README</CardTitle></CardHeader>
                  <CardContent className="prose prose-invert max-w-none">
                    <pre className="whitespace-pre-wrap text-sm">{readme.slice(0, 1000)}...</pre>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="files" className="grid grid-cols-2 gap-4">
              <div className="border border-white/10 rounded p-2 h-96 overflow-auto">
                <h3 className="font-bold mb-2">File Tree</h3>
                {renderFileTree(fileTree.slice(0, 50))}
              </div>
              <div className="border border-white/10 rounded p-2 h-96 overflow-auto">
                <h3 className="font-bold mb-2">{selectedFile || 'Select a file'}</h3>
                <pre className="text-xs whitespace-pre-wrap">{fileContent}</pre>
              </div>
            </TabsContent>

            <TabsContent value="dependencies">
              {dependencies ? (
                <div className="space-y-4">
                  <Card className="bg-white/5">
                    <CardHeader><CardTitle>Dependencies</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(dependencies.dependencies || {}).map(([name, ver]) => (
                        <div key={name} className="flex justify-between">
                          <span>{name}</span>
                          <span className="text-gray-400">{ver}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  {dependencies.devDependencies && (
                    <Card className="bg-white/5">
                      <CardHeader><CardTitle>Dev Dependencies</CardTitle></CardHeader>
                      <CardContent className="grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(dependencies.devDependencies).map(([name, ver]) => (
                          <div key={name} className="flex justify-between">
                            <span>{name}</span>
                            <span className="text-gray-400">{ver}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <p className="text-center text-gray-400">No package.json found</p>
              )}
            </TabsContent>

            <TabsContent value="metrics">
              {metrics && (
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-white/5">
                    <CardHeader><CardTitle>Code Statistics</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <div>Total Lines: ~{metrics.totalLines.toLocaleString()}</div>
                      <div>Total Files: {metrics.fileCount.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-white/5">
                    <CardHeader><CardTitle>Languages</CardTitle></CardHeader>
                    <CardContent>
                      {Object.entries(metrics.languages).map(([lang, bytes]) => {
                        const total = Object.values(metrics.languages).reduce((a, b) => a + b, 0);
                        const percent = ((bytes / total) * 100).toFixed(1);
                        return (
                          <div key={lang} className="flex justify-between text-sm mb-1">
                            <span>{lang}</span>
                            <span>{percent}%</span>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            <TabsContent value="issues" className="space-y-2">
              {issues.map(issue => (
                <Card key={issue.number} className="bg-white/5">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="w-4 h-4" />
                          <span className="font-medium">#{issue.number} {issue.title}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>@{issue.user.login}</span>
                          <span>•</span>
                          <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>{issue.comments} comments</span>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {issue.labels.map(label => (
                            <Badge key={label.name} style={{ backgroundColor: `#${label.color}` }}>
                              {label.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Badge variant={issue.state === 'open' ? 'default' : 'secondary'}>
                        {issue.state}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="prs" className="space-y-2">
              {prs.map(pr => (
                <Card key={pr.number} className="bg-white/5">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <GitPullRequest className="w-4 h-4" />
                          <span className="font-medium">#{pr.number} {pr.title}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>@{pr.user.login}</span>
                          <span>•</span>
                          <span>{pr.head.ref} → {pr.base.ref}</span>
                          <span>•</span>
                          <span>{new Date(pr.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <Badge variant={pr.state === 'open' ? 'default' : 'secondary'}>
                        {pr.state}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="actions" className="space-y-2">
              {workflows.map(run => (
                <Card key={run.id} className="bg-white/5">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {run.conclusion === 'success' ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : run.conclusion === 'failure' ? (
                          <XCircle className="w-4 h-4 text-red-400" />
                        ) : (
                          <Play className="w-4 h-4 text-yellow-400" />
                        )}
                        <span>{run.name}</span>
                        <Badge variant="outline">{run.status}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">
                          {new Date(run.created_at).toLocaleDateString()}
                        </span>
                        <a href={run.html_url} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </div>
  );
}
