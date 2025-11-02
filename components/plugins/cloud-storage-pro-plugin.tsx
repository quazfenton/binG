"use client";

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { 
  Cloud, Folder, File, Upload, Download, Trash2, Share2,
  Eye, Search, RefreshCw, Loader2, XCircle, HardDrive
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
}

const PROVIDERS = ['Google Drive', 'Dropbox', 'OneDrive', 'S3', 'IPFS'];

export default function CloudStorageProPlugin({ onClose }: PluginProps) {
  const [activeProvider, setActiveProvider] = useState('Google Drive');
  const [files, setFiles] = useState<CloudFile[]>([
    { id: '1', name: 'Documents', type: 'folder', size: 0, modified: '2 days ago', provider: 'Google Drive', shared: false },
    { id: '2', name: 'project.zip', type: 'file', size: 2048000, modified: '1 hour ago', provider: 'Google Drive', shared: true },
    { id: '3', name: 'report.pdf', type: 'file', size: 512000, modified: '3 days ago', provider: 'Google Drive', shared: false }
  ]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<CloudFile | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const refreshFiles = async () => {
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success('Files refreshed');
    } finally {
      setLoading(false);
    }
  };

  const uploadFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const newFile: CloudFile = {
        id: Date.now().toString(),
        name: file.name,
        type: 'file',
        size: file.size,
        modified: 'Just now',
        provider: activeProvider,
        shared: false
      };
      setFiles([...files, newFile]);
      toast.success('File uploaded');
    };
    input.click();
  };

  const deleteFile = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
    toast.success('File deleted');
  };

  const shareFile = (file: CloudFile) => {
    const link = `https://${file.provider.toLowerCase().replace(' ', '')}.com/share/${file.id}`;
    navigator.clipboard.writeText(link);
    toast.success('Share link copied');
  };

  const downloadFile = (file: CloudFile) => {
    toast.success(`Downloading ${file.name}`);
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
                        <Button size="icon" variant="ghost" onClick={() => setSelectedFile(file)}>
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
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
}
