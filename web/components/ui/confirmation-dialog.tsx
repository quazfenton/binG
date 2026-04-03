'use client';

import React from 'react';
import { AlertTriangle, X, Check } from 'lucide-react';
import { Button } from './button';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'warning' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!isOpen) return null;

  const variantStyles = {
    default: 'bg-blue-600 hover:bg-blue-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700',
    danger: 'bg-red-600 hover:bg-red-700',
  };

  const iconColors = {
    default: 'text-blue-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={onCancel}
      />
      
      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md">
        <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-3">
            <AlertTriangle className={`w-5 h-5 ${iconColors[variant]}`} />
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          
          {/* Content */}
          <div className="px-6 py-4">
            <p className="text-gray-300 text-sm leading-relaxed">{message}</p>
          </div>
          
          {/* Actions */}
          <div className="px-6 py-4 bg-gray-800/50 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={onCancel}
              className="border-gray-600 text-gray-300 hover:bg-gray-700"
            >
              <X className="w-4 h-4 mr-1.5" />
              {cancelLabel}
            </Button>
            <Button
              onClick={onConfirm}
              className={variantStyles[variant]}
            >
              <Check className="w-4 h-4 mr-1.5" />
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

interface FileOperationConfirmState {
  type: 'rename' | 'copy' | 'move' | 'extract' | null;
  sourcePath: string;
  targetPath: string;
  existingFiles: string[];
  resolveFn?: (value: boolean) => void;
}

export function useFileOperationConfirmation() {
  const [confirmState, setConfirmState] = React.useState<FileOperationConfirmState>({
    type: null,
    sourcePath: '',
    targetPath: '',
    existingFiles: [],
  });

  const requestConfirmation = (
    type: FileOperationConfirmState['type'],
    sourcePath: string,
    targetPath: string,
    existingFiles: string[] = []
  ) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        type,
        sourcePath,
        targetPath,
        existingFiles,
        resolveFn: resolve,
      });
    });
  };

  const handleConfirm = () => {
    if (confirmState.resolveFn) {
      confirmState.resolveFn(true);
    }
    setConfirmState({ type: null, sourcePath: '', targetPath: '', existingFiles: [] });
  };

  const handleCancel = () => {
    if (confirmState.resolveFn) {
      confirmState.resolveFn(false);
    }
    setConfirmState({ type: null, sourcePath: '', targetPath: '', existingFiles: [] });
  };

  return {
    confirmState,
    requestConfirmation,
    handleConfirm,
    handleCancel,
  };
}