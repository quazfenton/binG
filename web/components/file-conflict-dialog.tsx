/**
 * File Conflict Confirmation Dialog
 * 
 * Windows Explorer-style conflict resolution dialog
 */

'use client';

import { AlertTriangle, File, FileX, Folder, FolderX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface FileConflictDialogProps {
  open: boolean;
  type: 'rename' | 'move' | 'copy';
  sourcePath: string;
  targetPath: string;
  onConfirm: (overwrite: boolean) => void;
  onCancel: () => void;
}

export function FileConflictDialog({
  open,
  type,
  sourcePath,
  targetPath,
  onConfirm,
  onCancel,
}: FileConflictDialogProps) {
  const operationText = {
    rename: 'rename',
    move: 'move',
    copy: 'copy',
  }[type];

  const Icon = type === 'copy' ? File : type === 'move' ? Folder : File;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px] bg-gray-900 border-gray-700">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
            <DialogTitle className="text-white">
              {type === 'rename' ? 'Rename Conflict' : type === 'move' ? 'Move Conflict' : 'Copy Conflict'}
            </DialogTitle>
          </div>
          <DialogDescription className="text-gray-400">
            A file or folder with this name already exists.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Source file info */}
          <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
            <Icon className="h-5 w-5 text-blue-400 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {sourcePath.split('/').pop()}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {sourcePath}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {type === 'rename' ? 'Will be renamed to' : type === 'move' ? 'Will be moved to' : 'Will be copied to'}
              </p>
            </div>
          </div>

          {/* Arrow indicator */}
          <div className="flex justify-center">
            <div className="text-gray-500 text-xs">↓</div>
          </div>

          {/* Target file info */}
          <div className="flex items-start gap-3 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
            <FileX className="h-5 w-5 text-red-400 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-300 truncate">
                {targetPath.split('/').pop()}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {targetPath}
              </p>
              <p className="text-xs text-red-400 mt-1 font-medium">
                ⚠️ This will overwrite the existing file
              </p>
            </div>
          </div>

          {/* Warning message */}
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-xs text-yellow-300">
              <strong>Warning:</strong> Overwriting will permanently replace the existing file. 
              This action cannot be undone.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="border border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(true)}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <FileX className="h-4 w-4 mr-2" />
            Overwrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
