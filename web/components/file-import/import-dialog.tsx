'use client';

/**
 * File Import Dialog
 *
 * UI component for importing files and folders from user's device
 * into the virtual filesystem.
 *
 * Features:
 * - Drag and drop file/folder upload
 * - File browser with folder selection
 * - File preview with size display
 * - Folder structure preservation toggle
 * - Custom import folder naming
 * - Progress indication during import
 */

import { useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, File, Folder, X, Loader2, FileCode, FileText, Image, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { isDesktopMode } from '@bing/platform/env';

interface FileToImport {
  name: string;
  size: number;
  path?: string;
  file: File;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId?: string;
  scopePath?: string;
  onImportComplete?: (result: ImportResult) => void;
}

interface ImportResult {
  success: boolean;
  importedFiles: number;
  destinationPath: string;
  commitId?: string;
}

export function ImportDialog({
  open,
  onOpenChange,
  sessionId,
  scopePath,
  onImportComplete,
}: ImportDialogProps) {
  const [files, setFiles] = useState<FileToImport[]>([]);
  const [importFolderName, setImportFolderName] = useState('');
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle file selection — uses native Tauri dialogs on desktop
   */
  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const newFiles: FileToImport[] = Array.from(selectedFiles).map(file => ({
      name: file.name,
      size: file.size,
      path: file.webkitRelativePath || undefined,
      file,
    }));

    setFiles(prev => {
      const existingPaths = new Set(prev.map(f => f.path || f.name));
      const uniqueNew = newFiles.filter(f => !existingPaths.has(f.path || f.name));
      return [...prev, ...uniqueNew];
    });
  }, []);

  /**
   * Open native file/folder dialog on desktop, fallback to browser input
   */
  const handleOpenFileDialog = useCallback(async (directory = false) => {
    if (isDesktopMode()) {
      try {
        const { tauriDialogProvider } = await import('@/lib/hitl/tauri-dialog-provider');
        if (tauriDialogProvider.isAvailable()) {
          const result = directory
            ? await tauriDialogProvider.openFolder({ title: 'Select Folder to Import' })
            : await tauriDialogProvider.openFile({
                title: 'Select Files to Import',
                multiple: true,
              });

          if (result.success && result.data) {
            const paths = Array.isArray(result.data) ? result.data : [result.data];
            toast.info(`Selected ${paths.length} item(s) from desktop dialog`);
            // On desktop, paths are strings — user needs to drag-drop or use browser input
            // as a bridge until full Tauri file reading is implemented
          }
          return;
        }
      } catch (e) {
        console.warn('[ImportDialog] Tauri dialog failed, falling back to browser input', e);
      }
    }

    // Fallback: trigger hidden browser file input
    if (directory && folderInputRef.current) {
      folderInputRef.current.click();
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearAllFiles = useCallback(() => {
    setFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (files.length === 0) {
      toast.error('No files selected', {
        description: 'Please select at least one file to import',
      });
      return;
    }

    setIsImporting(true);
    try {
      const formData = new FormData();
      
      // Add all files
      for (const file of files) {
        formData.append('files', file.file);
      }

      // Add options
      if (sessionId) {
        formData.append('sessionId', sessionId);
      }
      if (importFolderName) {
        formData.append('importFolderName', importFolderName);
      }
      formData.append('preserveStructure', String(preserveStructure));
      formData.append('autoCommit', 'true');

      const response = await fetch('/api/filesystem/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      // Show success toast
      toast.success('Files imported successfully', {
        description: `Imported ${result.importedFiles} files to ${result.destinationPath}`,
        duration: 4000,
      });

      // Notify parent and close
      onImportComplete?.(result);
      onOpenChange(false);
      clearAllFiles();
      setImportFolderName('');
    } catch (error) {
      toast.error('Import failed', {
        description: error instanceof Error ? error.message : 'An unknown error occurred',
        duration: 5000,
      });
    } finally {
      setIsImporting(false);
    }
  }, [files, sessionId, importFolderName, preserveStructure, onImportComplete, onOpenChange, clearAllFiles]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getFileIcon = (file: FileToImport) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    if (file.path?.includes('/')) {
      return <Folder className="w-5 h-5 text-blue-500" />;
    }
    
    switch (ext) {
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
      case 'py':
      case 'java':
      case 'cpp':
      case 'c':
      case 'go':
      case 'rs':
        return <FileCode className="w-5 h-5 text-yellow-500" />;
      case 'md':
      case 'txt':
      case 'json':
      case 'yaml':
      case 'yml':
        return <FileText className="w-5 h-5 text-gray-500" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return <Image className="w-5 h-5 text-purple-500" />;
      case 'zip':
      case 'tar':
      case 'gz':
      case 'rar':
        return <Archive className="w-5 h-5 text-orange-500" />;
      default:
        return <File className="w-5 h-5 text-gray-400" />;
    }
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const suggestedFolderName = `imports-${new Date().toISOString().slice(0, 10)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Files</DialogTitle>
          <DialogDescription>
            Import files and folders from your device into the workspace.
            Files will be organized in a dedicated import folder.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Drop Zone */}
          <div
            className={`
              border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
              ${isDragging 
                ? 'border-primary bg-primary/5' 
                : 'border-muted-foreground/25 hover:border-primary hover:bg-muted/50'
              }
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => handleOpenFileDialog(false)}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium">Drop files or folders here</p>
            <p className="text-sm text-muted-foreground mt-1">
              or click to browse from your device
            </p>
            <input
              ref={fileInputRef}
              id="file-input"
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              className="hidden"
              onChange={e => handleFileSelect(e.target.files)}
            />
            <input
              ref={folderInputRef}
              id="folder-input"
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              className="hidden"
              onChange={e => handleFileSelect(e.target.files)}
            />
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-muted border-b">
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    Selected Files ({files.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(totalSize)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFiles}
                    className="h-7 text-xs"
                  >
                    Clear All
                  </Button>
                </div>
              </div>
              
              <div className="max-h-48 overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-2 border-b last:border-b-0 hover:bg-muted/50"
                  >
                    {getFileIcon(file)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" title={file.path || file.name}>
                        {file.path || file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(index)}
                      className="h-8 w-8 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium text-sm">Import Options</h4>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="preserve-structure"
                checked={preserveStructure}
                onChange={e => setPreserveStructure(e.target.checked)}
                className="h-4 w-4 rounded border-muted-foreground"
              />
              <label htmlFor="preserve-structure" className="text-sm cursor-pointer">
                Preserve folder structure
              </label>
              <p className="text-xs text-muted-foreground ml-auto">
                {preserveStructure ? 'Maintains original folder hierarchy' : 'All files in single folder'}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="folder-name" className="text-sm font-medium">
                Import folder name
              </label>
              <input
                id="folder-name"
                type="text"
                value={importFolderName}
                onChange={e => setImportFolderName(e.target.value)}
                placeholder={suggestedFolderName}
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Files will be imported to: <code className="bg-muted px-1 rounded">{importFolderName || suggestedFolderName}</code>
              </p>
            </div>
          </div>

          {/* Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Maximum 100 files per import</p>
            <p>• Maximum 10MB per file, 50MB total</p>
            <p>• Supported: Code, config, markdown, images, and more</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={files.length === 0 || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import {files.length > 0 && `(${files.length})`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
