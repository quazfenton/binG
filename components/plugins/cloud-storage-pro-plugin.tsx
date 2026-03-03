"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { 
  Cloud, Folder, File, Upload, Download, Trash2, Share2,
  Eye, Search, RefreshCw, Loader2, XCircle, HardDrive, Info
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface CloudFile {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: string;
  provider: string;
  shared: boolean;
  content?: string;
}

const PROVIDERS = ['Google Drive', 'Dropbox', 'OneDrive', 'S3', 'IPFS'];
const STORAGE_KEY = 'cloud-storage-pro-files';
const MAX_STORED_FILE_SIZE = 1024 * 1024; // 1MB

const DEFAULT_FILES: CloudFile[] = [
  { id: '1', name: 'Documents', type: 'folder', size: 0, modified: '2 days ago', provider: 'Google Drive', shared: false },
  { id: '2', name: 'project.zip', type: 'file', size: 2048000, modified: '1 hour ago', provider: 'Google Drive', shared: true },
  { id: '3', name: 'report.pdf', type: 'file', size: 512000, modified: '3 days ago', provider: 'Google Drive', shared: false }
];

const loadFilesFromStorage = (): CloudFile[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_FILES;
};

const isTextFile = (name: string): boolean => {
  const textExtensions = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.yml', '.yaml', '.log', '.env', '.cfg', '.ini', '.toml'];
  return textExtensions.some(ext => name.toLowerCase().endsWith(ext));
};

export default function CloudStorageProPlugin({ onClose }: PluginProps) {
  const [activeProvider, setActiveProvider] = useState('Google Drive');
  const [files, setFiles] = useState<CloudFile[]>(loadFilesFromStorage);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<CloudFile | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState(false);

  const persistFiles = useCallback((newFiles: CloudFile[]) => {
    setFiles(newFiles);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newFiles));
    } catch {
      toast.error('Storage quota exceeded');
    }
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const providerPrefix = activeProvider.toLowerCase().replace(/\s+/g, '-');

  const getToken = (): string | null => {
    return localStorage.getItem('token');
  };

  const refreshFiles = async () => {
    setLoading(true);
    try {
      const token = getToken();
      if (!token) {
        setBackendMode(false);
        // Load local files when not signed in
        const localFiles = loadFilesFromStorage().filter(f => 
          f.provider === activeProvider
        );
        setFiles(localFiles);
        toast.info('Using local mode (not signed in for backend storage)');
        return;
      }
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const res = await fetch(`/api/storage/list?prefix=${encodeURIComponent(providerPrefix + '/')}`, { headers });
      if (!res.ok) {
        setBackendMode(false);
        // Load local files when backend is unavailable
        const localFiles = loadFilesFromStorage().filter(f => 
          f.provider === activeProvider
        );
        setFiles(localFiles);
        toast.info('Using local mode (backend unavailable or unauthorized)');
        return;
      }
      const body = await res.json();
      const listed: string[] = body?.data?.files || [];
      // Storage service returns paths relative to prefix; reconstruct full path for backend operations
      const fullPrefix = providerPrefix + '/';
      const mapped: CloudFile[] = listed.map((relativePath) => {
        const fullPath = fullPrefix + relativePath;
        const name = relativePath.split('/').pop() || relativePath;
        return {
          id: fullPath,
          name,
          type: 'file',
          size: 0,
          modified: 'Synced',
          provider: activeProvider,
          shared: false,
        };
      });
      setFiles(mapped);
      setBackendMode(true);
      toast.success('Files refreshed from backend');
    } catch (err) {
      // Network error or JSON parse error
      setBackendMode(false);
      // Load local files on error
      const localFiles = loadFilesFromStorage().filter(f => 
        f.provider === activeProvider
      );
      setFiles(localFiles);
      toast.info('Using local mode (backend unavailable or unauthorized)');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider]);

  const uploadFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const fallbackLocalUpload = () => {
        const reader = new FileReader();
        reader.onload = () => {
          const content = file.size <= MAX_STORED_FILE_SIZE ? (reader.result as string) : undefined;
          const newFile: CloudFile = {
            id: Date.now().toString(),
            name: file.name,
            type: 'file',
            size: file.size,
            modified: 'Just now',
            provider: activeProvider,
            shared: false,
            content
          };
          const allFiles = loadFilesFromStorage();
          const otherProvidersFiles = allFiles.filter(f => f.provider !== activeProvider);
          persistFiles([...otherProvidersFiles, ...files, newFile]);
          setBackendMode(false);
          toast.success(content ? 'File uploaded in local mode' : 'File metadata saved in local mode');
        };
        if (file.size <= MAX_STORED_FILE_SIZE) {
          reader.readAsDataURL(file);
          setBackendMode(false);
          toast.success(content ? 'File uploaded in local mode' : 'File metadata saved in local mode');
        };
        if (file.size <= MAX_STORED_FILE_SIZE) {
          reader.readAsDataURL(file);
        } else {
          reader.readAsArrayBuffer(file.slice(0, 0));
        }
      };

      (async () => {
        const token = getToken();
        if (!token) {
          fallbackLocalUpload();
          return;
        }
        try {
          const formData = new FormData();
          const path = `${providerPrefix}/${file.name}`;
          formData.append('file', file);
          formData.append('path', path);
          const headers: HeadersInit = { Authorization: `Bearer ${token}` };
          const res = await fetch('/api/storage/upload', { method: 'POST', body: formData, headers });
          if (!res.ok) {
            fallbackLocalUpload();
            return;
          }
          setBackendMode(true);
          await refreshFiles();
          toast.success('File uploaded to backend storage');
        } catch {
          fallbackLocalUpload();
        }
      })();
    };
    input.click();
  };

  const deleteFile = async (id: string) => {
    if (backendMode) {
      try {
        const token = getToken();
        if (!token) {
          throw new Error('No authentication token');
        }
        const res = await fetch(`/api/storage/delete?path=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          await refreshFiles();
          toast.success('File deleted');
          return;
        }
        // Backend delete failed - don't fall through to local deletion
        toast.error('Failed to delete file from backend storage');
        return;
      } catch (err) {
        // Network error or other exception
        toast.error('Failed to delete file (connection error)');
        return;
      }
    }
    // Local mode deletion
    const allFiles = loadFilesFromStorage();
    const remainingCurrentProvider = files.filter(f => f.id !== id);
    persistFiles([
      ...allFiles.filter(f => f.provider !== activeProvider),
      ...remainingCurrentProvider
    ]);
    toast.success('File deleted (local mode)');
  };

  const shareFile = async (file: CloudFile) => {
    try {
      if (backendMode) {
        const token = getToken();
        if (!token) {
          throw new Error('No authentication token');
        }
        const res = await fetch(`/api/storage/signed-url?path=${encodeURIComponent(file.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = await res.json();
          const link = body?.data?.signedUrl;
          if (link) {
            await navigator.clipboard.writeText(link);
            toast.success('Signed share link copied');
            return;
          }
        }
      }
    } catch {}

    const link = `https://${file.provider.toLowerCase().replace(' ', '')}.com/share/${file.id}`;
    navigator.clipboard.writeText(link);
    toast.success('Share link copied (local mode)');
  };

  const downloadFile = async (file: CloudFile) => {
    if (backendMode) {
      try {
        const token = getToken();
        if (!token) {
          throw new Error('No authentication token');
        }
        const res = await fetch(`/api/storage/download?path=${encodeURIComponent(file.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast.success(`Downloaded ${file.name}`);
          return;
        }
      } catch {}
    }

    if (file.content) {
      const a = document.createElement('a');
      a.href = file.content;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`Downloaded ${file.name}`);
    } else {
      toast.info(`No stored content for ${file.name} (metadata only in local mode)`);
    }
  };

  const previewFile = (file: CloudFile) => {
    setSelectedFile(file);
    if (file.content && isTextFile(file.name)) {
      try {
        const base64 = file.content.split(',')[1];
        setPreviewContent(atob(base64));
      } catch {
        setPreviewContent(null);
      }
    } else {
      setPreviewContent(null);
    }
  };

  const filteredFiles = files.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    f.provider === activeProvider
  );

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cloud className="w-5 h-5 text-cyan-400" />
            Cloud Storage Pro
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-4 gap-4 h-full">
          <div className="space-y-2">
            <h3 className="text-sm font-medium mb-3">Providers</h3>
            {PROVIDERS.map(provider => (
              <Button
                key={provider}
                variant={activeProvider === provider ? 'default' : 'ghost'}
                className="w-full justify-start"
                onClick={() => setActiveProvider(provider)}
              >
                <Cloud className="w-4 h-4 mr-2" />
                {provider}
              </Button>
            ))}
          </div>

          <div className="col-span-3 space-y-3">
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${backendMode ? 'border border-green-500/30 bg-green-500/10 text-green-300' : 'border border-blue-500/30 bg-blue-500/10 text-blue-300'}`}>
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>
                {backendMode
                  ? 'Backend storage connected via /api/storage endpoints.'
                  : 'Local fallback mode — files stored in browser. Sign in/configure storage for backend mode.'}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button onClick={refreshFiles} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={uploadFile}>
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </Button>
            </div>

            <Card className="bg-white/5">
              <CardContent className="p-0">
                <div className="divide-y divide-white/10">
                  {filteredFiles.map(file => (
                    <div key={file.id} className="p-3 hover:bg-white/5 flex items-center gap-3">
                      {file.type === 'folder' ? (
                        <Folder className="w-5 h-5 text-yellow-400" />
                      ) : (
                        <File className="w-5 h-5 text-blue-400" />
                      )}
                      
                      <div className="flex-1">
                        <div className="text-sm font-medium">{file.name}</div>
                        <div className="text-xs text-gray-400">
                          {formatSize(file.size)} • {file.modified}
                        </div>
                      </div>

                      {file.shared && (
                        <Badge variant="secondary" className="text-xs">Shared</Badge>
                      )}

                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => previewFile(file)}>
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => downloadFile(file)}>
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => shareFile(file)}>
                          <Share2 className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteFile(file.id)}>
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {filteredFiles.length === 0 && (
                    <div className="p-8 text-center text-gray-400">
                      <HardDrive className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No files found</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedFile && (
              <Card className="bg-white/5">
                <CardHeader className="p-3">
                  <CardTitle className="text-sm">File Preview</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Name:</span>
                      <span>{selectedFile.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Size:</span>
                      <span>{formatSize(selectedFile.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Modified:</span>
                      <span>{selectedFile.modified}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Provider:</span>
                      <span>{selectedFile.provider}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Stored:</span>
                      <span>{selectedFile.content ? 'Yes' : 'Metadata only'}</span>
                    </div>
                  </div>
                  {previewContent && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-400 mb-1">Content Preview</div>
                      <pre className="p-2 bg-black/30 rounded text-xs font-mono max-h-48 overflow-auto whitespace-pre-wrap break-all">
                        {previewContent.slice(0, 5000)}
                        {previewContent.length > 5000 && '\n... (truncated)'}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
}
