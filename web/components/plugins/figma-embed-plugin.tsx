"use client";

/**
 * Figma Embed Plugin
 * 
 * Connect to Figma, browse files, and import designs to the visual editor.
 * 
 * Features:
 * - OAuth 2.0 connection with PKCE
 * - Browse user's Figma files
 * - Preview frames/components
 * - Export as SVG/PNG
 * - Import to visual editor
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import {
  Palette,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Download,
  Upload,
  FileImage,
  Layers,
  Component,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  Copy,
  Search,
  Grid,
  List,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

interface FigmaFile {
  key: string;
  name: string;
  thumbnailUrl: string | null;
  lastModified: string;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
}

interface FigmaComponent {
  key: string;
  name: string;
  description?: string;
  nodeId?: string;
}

interface SelectedNode {
  nodeId: string;
  name: string;
  fileKey: string;
  fileName: string;
}

// ============================================================================
// Component
// ============================================================================

const FigmaEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'components' | 'import'>('files');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [files, setFiles] = useState<FigmaFile[]>([]);
  const [components, setComponents] = useState<FigmaComponent[]>([]);
  const [selectedFile, setSelectedFile] = useState<FigmaFile | null>(null);
  const [fileNodes, setFileNodes] = useState<FigmaNode | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<SelectedNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Export state
  const [exportFormat, setExportFormat] = useState<'svg' | 'png' | 'jpg'>('svg');
  const [exportScale, setExportScale] = useState(1);
  const [exportedImages, setExportedImages] = useState<Record<string, string>>({});

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    // Check for OAuth callback success
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('figmaConnected') === 'success') {
      setIsConnected(true);
      loadFiles();
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      toast.success('Figma connected successfully');
    }
    
    const error = urlParams.get('figmaError');
    if (error) {
      setConnectionError(decodeURIComponent(error));
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ============================================================================
  // Connection Handlers
  // ============================================================================

  const checkConnection = async () => {
    try {
      const response = await fetch('/api/integrations/figma');
      const data = await response.json();
      
      if (response.ok && data.success) {
        setIsConnected(true);
        setFiles(data.files || []);
      } else if (data.requiresAuth) {
        setIsConnected(false);
      }
    } catch (error) {
      console.error('[Figma Plugin] Connection check failed:', error);
      setIsConnected(false);
    }
  };

  const handleConnect = useCallback(() => {
    setIsConnecting(true);
    setConnectionError(null);
    
    // Open OAuth popup
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
      '/api/integrations/figma?action=authorize',
      'figma-oauth',
      `width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`
    );

    // Listen for OAuth completion
    const checkPopupClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkPopupClosed);
        setIsConnecting(false);
        checkConnection();
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      if (popup && !popup.closed) {
        popup.close();
      }
      clearInterval(checkPopupClosed);
      setIsConnecting(false);
      setConnectionError('Authorization timed out. Please try again.');
    }, 5 * 60 * 1000);
  }, []);

  const handleDisconnect = async () => {
    try {
      // Note: You may want to add a disconnect endpoint
      setIsConnected(false);
      setFiles([]);
      setSelectedFile(null);
      setFileNodes(null);
      toast.success('Figma disconnected');
    } catch (error) {
      console.error('[Figma Plugin] Disconnect failed:', error);
    }
  };

  // ============================================================================
  // Data Loading
  // ============================================================================

  const loadFiles = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/integrations/figma');
      const data = await response.json();
      
      if (data.success) {
        setFiles(data.files || []);
      } else {
        toast.error('Failed to load Figma files');
      }
    } catch (error) {
      console.error('[Figma Plugin] Load files failed:', error);
      toast.error('Failed to load Figma files');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFileNodes = async (fileKey: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/integrations/figma?fileKey=${fileKey}`);
      const data = await response.json();
      
      if (data.success) {
        setFileNodes(data.file?.root || null);
        setSelectedFile(files.find(f => f.key === fileKey) || null);
      } else {
        toast.error('Failed to load file structure');
      }
    } catch (error) {
      console.error('[Figma Plugin] Load file nodes failed:', error);
      toast.error('Failed to load file structure');
    } finally {
      setIsLoading(false);
    }
  };

  const loadComponents = async (fileKey: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/integrations/figma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'components', fileKey }),
      });
      const data = await response.json();
      
      if (data.success) {
        setComponents(data.components || []);
      } else {
        toast.error('Failed to load components');
      }
    } catch (error) {
      console.error('[Figma Plugin] Load components failed:', error);
      toast.error('Failed to load components');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // Node Selection
  // ============================================================================

  const toggleNodeSelection = (node: FigmaNode, file: FigmaFile) => {
    setSelectedNodes(prev => {
      const exists = prev.find(n => n.nodeId === node.id);
      if (exists) {
        return prev.filter(n => n.nodeId !== node.id);
      }
      return [...prev, { nodeId: node.id, name: node.name, fileKey: file.key, fileName: file.name }];
    });
  };

  const clearSelection = () => {
    setSelectedNodes([]);
    setExportedImages({});
  };

  // ============================================================================
  // Export Handlers
  // ============================================================================

  const handleExport = async () => {
    if (selectedNodes.length === 0 || !selectedFile) {
      toast.error('Please select nodes to export');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/integrations/figma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'export',
          fileKey: selectedFile.key,
          nodeIds: selectedNodes.map(n => n.nodeId),
          format: exportFormat,
          scale: exportScale,
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        setExportedImages(data.images);
        toast.success(`Exported ${Object.keys(data.images).length} nodes as ${exportFormat.toUpperCase()}`);
      } else {
        toast.error(data.error || 'Export failed');
      }
    } catch (error) {
      console.error('[Figma Plugin] Export failed:', error);
      toast.error('Export failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadImage = (imageUrl: string, nodeId: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `figma-${nodeId}.${exportFormat}`;
    link.target = '_blank';
    link.click();
  };

  // ============================================================================
  // Import to Visual Editor
  // ============================================================================

  const handleImportToEditor = async () => {
    if (selectedNodes.length === 0 || !selectedFile) {
      toast.error('Please select nodes to import');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/integrations/figma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          fileKey: selectedFile.key,
          nodeIds: selectedNodes.map(n => n.nodeId),
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        // Store in localStorage for visual editor to pick up
        const importData = {
          file: data.file,
          nodes: data.nodes,
          timestamp: Date.now(),
        };
        localStorage.setItem('figmaImportData', JSON.stringify(importData));
        
        // Open visual editor
        window.open('/visual-editor', '_blank');
        toast.success('Nodes imported! Opening visual editor...');
      } else {
        toast.error(data.error || 'Import failed');
      }
    } catch (error) {
      console.error('[Figma Plugin] Import failed:', error);
      toast.error('Import failed');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderFileCard = (file: FigmaFile) => (
    <Card
      key={file.key}
      className={`cursor-pointer transition-all hover:border-blue-500 ${
        selectedFile?.key === file.key ? 'border-blue-500 ring-2 ring-blue-500/20' : ''
      }`}
      onClick={() => loadFileNodes(file.key)}
    >
      <CardContent className="p-4">
        {file.thumbnailUrl ? (
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            className="w-full h-32 object-cover rounded-md mb-3"
          />
        ) : (
          <div className="w-full h-32 bg-muted rounded-md mb-3 flex items-center justify-center">
            <FileImage className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        <h3 className="font-medium text-sm truncate">{file.name}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(file.lastModified).toLocaleDateString()}
        </p>
      </CardContent>
    </Card>
  );

  const renderFileList = (file: FigmaFile) => (
    <div
      key={file.key}
      className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors ${
        selectedFile?.key === file.key
          ? 'bg-blue-500/10 border border-blue-500/20'
          : 'hover:bg-muted'
      }`}
      onClick={() => loadFileNodes(file.key)}
    >
      {file.thumbnailUrl ? (
        <img
          src={file.thumbnailUrl}
          alt={file.name}
          className="w-12 h-12 object-cover rounded"
        />
      ) : (
        <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
          <FileImage className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm truncate">{file.name}</h3>
        <p className="text-xs text-muted-foreground">
          {new Date(file.lastModified).toLocaleDateString()}
        </p>
      </div>
    </div>
  );

  const renderNodeTree = (node: FigmaNode, depth: number = 0) => {
    const isSelected = selectedNodes.some(n => n.nodeId === node.id);
    const isFrame = node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION';
    
    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
            isSelected ? 'bg-blue-500/20 border border-blue-500/30' : 'hover:bg-muted'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => selectedFile && toggleNodeSelection(node, selectedFile)}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => selectedFile && toggleNodeSelection(node, selectedFile)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-muted-foreground"
          />
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm flex-1 truncate">{node.name}</span>
          <Badge variant="secondary" className="text-xs">
            {node.type}
          </Badge>
        </div>
        {node.children?.map(child => renderNodeTree(child, depth + 1))}
      </div>
    );
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={`flex flex-col h-full bg-background ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Palette className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Figma</h2>
            <p className="text-xs text-muted-foreground">
              {isConnected ? 'Connected' : 'Not connected'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isConnected ? (
          // Connection Screen
          <div className="flex-1 flex items-center justify-center p-8">
            <Card className="max-w-md w-full">
              <CardHeader className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4">
                  <Palette className="w-8 h-8 text-white" />
                </div>
                <CardTitle className="text-xl">Connect to Figma</CardTitle>
                <p className="text-muted-foreground">
                  Import designs, frames, and components from your Figma files
                </p>
              </CardHeader>
              <CardContent>
                {connectionError && (
                  <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    {connectionError}
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={handleConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Connect with Figma
                    </>
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-4">
                  You'll be redirected to Figma to authorize access
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          // Main Interface
          <>
            {/* Tabs */}
            <div className="p-4 border-b">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="files">Files</TabsTrigger>
                  <TabsTrigger value="components">Components</TabsTrigger>
                  <TabsTrigger value="import">Import</TabsTrigger>
                </TabsList>

                {/* Files Tab */}
                <TabsContent value="files" className="mt-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={viewMode === 'grid' ? 'default' : 'outline'}
                        size="icon"
                        onClick={() => setViewMode('grid')}
                      >
                        <Grid className="w-4 h-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'list' ? 'default' : 'outline'}
                        size="icon"
                        onClick={() => setViewMode('list')}
                      >
                        <List className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="icon" onClick={loadFiles}>
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>

                  <ScrollArea className="h-[400px]">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : viewMode === 'grid' ? (
                      <div className="grid grid-cols-2 gap-4">
                        {files
                          .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
                          .map(renderFileCard)}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {files
                          .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
                          .map(renderFileList)}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* Components Tab */}
                <TabsContent value="components" className="mt-4">
                  <div className="text-center py-12 text-muted-foreground">
                    <Component className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Select a file to view its components</p>
                    <Button
                      variant="link"
                      onClick={() => setActiveTab('files')}
                    >
                      Browse Files
                    </Button>
                  </div>
                </TabsContent>

                {/* Import Tab */}
                <TabsContent value="import" className="mt-4">
                  {selectedFile && fileNodes ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{selectedFile.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {selectedNodes.length} node(s) selected
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={clearSelection}>
                          Clear Selection
                        </Button>
                      </div>

                      <ScrollArea className="h-[200px] border rounded-md p-2">
                        {renderNodeTree(fileNodes)}
                      </ScrollArea>

                      {selectedNodes.length > 0 && (
                        <Card>
                          <CardContent className="p-4 space-y-4">
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <label className="text-sm font-medium mb-1 block">
                                  Export Format
                                </label>
                                <select
                                  value={exportFormat}
                                  onChange={(e) => setExportFormat(e.target.value as any)}
                                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                >
                                  <option value="svg">SVG</option>
                                  <option value="png">PNG</option>
                                  <option value="jpg">JPG</option>
                                </select>
                              </div>
                              <div className="flex-1">
                                <label className="text-sm font-medium mb-1 block">
                                  Scale
                                </label>
                                <select
                                  value={exportScale}
                                  onChange={(e) => setExportScale(Number(e.target.value))}
                                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                >
                                  <option value={0.5}>0.5x</option>
                                  <option value={1}>1x</option>
                                  <option value={2}>2x</option>
                                  <option value={3}>3x</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                onClick={handleExport}
                                disabled={isLoading}
                                className="flex-1"
                              >
                                <Download className="w-4 h-4 mr-2" />
                                Export {exportFormat.toUpperCase()}
                              </Button>
                              <Button
                                onClick={handleImportToEditor}
                                disabled={isLoading}
                                className="flex-1"
                                variant="default"
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                Import to Editor
                              </Button>
                            </div>

                            {exportedImages && Object.keys(exportedImages).length > 0 && (
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Exported Images:</h4>
                                <ScrollArea className="h-[100px]">
                                  {Object.entries(exportedImages).map(([nodeId, url]) => (
                                    <div
                                      key={nodeId}
                                      className="flex items-center justify-between p-2 bg-muted rounded"
                                    >
                                      <span className="text-xs truncate flex-1">
                                        {selectedNodes.find(n => n.nodeId === nodeId)?.name}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDownloadImage(url, nodeId)}
                                      >
                                        <Download className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </ScrollArea>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Select a file from the Files tab to import nodes</p>
                      <Button
                        variant="link"
                        onClick={() => setActiveTab('files')}
                      >
                        Browse Files
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {isConnected && (
        <div className="p-3 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>Connected to Figma</span>
          <Button variant="ghost" size="sm" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
};

export default FigmaEmbedPlugin;
