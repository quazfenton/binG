'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, FileWarning, CheckCircle, XCircle, Loader2 } from 'lucide-react';

export interface ApprovalRequest {
  id: string;
  action: 'delete' | 'overwrite' | 'execute_destructive' | 'create_secret' | 'outside_workspace';
  target: string;
  reason: string;
  diff?: string;
  requested_at: string;
}

interface ApprovalDialogProps {
  request: ApprovalRequest;
  onApprove: (modifiedValue?: string) => void;
  onReject: (feedback?: string) => void;
  autoApproveTimeout?: number;
}

const actionLabels: Record<string, string> = {
  delete: 'Delete File',
  overwrite: 'Overwrite File',
  execute_destructive: 'Run Destructive Command',
  create_secret: 'Create Secret File',
  outside_workspace: 'Modify Outside Workspace',
};

const actionColors: Record<string, string> = {
  delete: 'bg-red-500',
  overwrite: 'bg-orange-500',
  execute_destructive: 'bg-red-600',
  create_secret: 'bg-yellow-500',
  outside_workspace: 'bg-amber-600',
};

export function ApprovalDialog({ 
  request, 
  onApprove, 
  onReject,
  autoApproveTimeout = 300000 
}: ApprovalDialogProps) {
  const [feedback, setFeedback] = useState('');
  const [countdown, setCountdown] = useState(autoApproveTimeout / 1000);
  const [isAutoApproving, setIsAutoApproving] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsAutoApproving(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoApproveTimeout]);

  const handleApprove = useCallback(() => {
    onApprove(feedback || undefined);
  }, [feedback, onApprove]);

  const handleReject = useCallback(() => {
    onReject(feedback || 'Rejected by user');
  }, [feedback, onReject]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        <div className={`${actionColors[request.action] || 'bg-gray-500'} px-6 py-4 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-white" />
            <h2 className="text-xl font-bold text-white">
              Action Requires Approval
            </h2>
          </div>
          <button 
            onClick={() => onReject('Dialog closed')}
            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Action:</span>
            <span className={`font-semibold px-2 py-1 rounded inline-block ${actionColors[request.action]} text-white`}>
              {actionLabels[request.action] || request.action}
            </span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Target:</span>
            <code className="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded font-mono text-sm break-all">
              {request.target}
            </code>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Reason:</span>
            <p className="text-gray-700 dark:text-gray-300">{request.reason}</p>
          </div>

          {request.diff && (
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Proposed Changes:</span>
              <pre className="mt-2 bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-auto max-h-40 font-mono">
                {request.diff}
              </pre>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Feedback (optional)
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Add any feedback or modifications..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-500">
              {!isAutoApproving ? (
                <span>Auto-approve in {countdown}s</span>
              ) : (
                <span className="text-green-600 flex items-center gap-1">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Auto-approving...
                </span>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleReject}
                disabled={isAutoApproving}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4 text-red-500" />
                Reject
              </button>
              <button
                onClick={handleApprove}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ApprovalBanner({ 
  pendingCount, 
  onClick 
}: { 
  pendingCount: number; 
  onClick: () => void;
}) {
  if (pendingCount === 0) return null;

  return (
    <button
      onClick={onClick}
      className="fixed top-4 right-4 z-40 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse"
    >
      <FileWarning className="w-4 h-4" />
      <span className="font-medium">{pendingCount} pending approval{pendingCount > 1 ? 's' : ''}</span>
    </button>
  );
}
