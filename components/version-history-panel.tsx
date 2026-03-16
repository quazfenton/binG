'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, Clock, RotateCcw, FileCode, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { buildApiHeaders } from '@/lib/utils';

export interface VersionHistory {
  version: number;
  commitId: string;
  message: string;
  filesChanged: number;
  createdAt: number;
  paths?: string[];
}

export interface VersionHistoryPanelProps {
  sessionId: string;
  currentVersion?: number;
  onVersionSelect?: (version: number) => void;
  compact?: boolean;
}

/**
 * Version History Panel
 * Displays git-backed VFS version history with rollback capability
 */
export function VersionHistoryPanel({
  sessionId,
  currentVersion,
  onVersionSelect,
  compact = false,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<VersionHistory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  const fetchVersions = useCallback(async () => {
    if (!sessionId) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/gateway/git/${sessionId}/versions?limit=20`, {
        headers: buildApiHeaders(),
      });
      
      if (!response.ok) throw new Error('Failed to fetch versions');
      
      const data = await response.json();
      setVersions(data.versions || []);
    } catch (error: any) {
      console.error('Failed to fetch version history:', error);
      toast.error('Failed to load version history');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && isExpanded) {
      fetchVersions();
    }
  }, [sessionId, isExpanded, fetchVersions]);

  const handleRollback = useCallback(async (version: number) => {
    if (!sessionId || isRollingBack) return;
    
    setIsRollingBack(true);
    try {
      const response = await fetch(`/api/gateway/git/${sessionId}/rollback`, {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ version }),
      });
      
      if (!response.ok) throw new Error('Rollback failed');
      
      const result = await response.json();
      
      if (result.success) {
        toast.success('Successfully rolled back', {
          description: `Restored to version ${version}`,
        });
        onVersionSelect?.(version);
        fetchVersions(); // Refresh list
      } else {
        throw new Error(result.error || 'Rollback failed');
      }
    } catch (error: any) {
      console.error('Rollback failed:', error);
      toast.error('Failed to rollback', {
        description: error.message,
      });
    } finally {
      setIsRollingBack(false);
      setSelectedVersion(null);
    }
  }, [sessionId, isRollingBack, onVersionSelect, fetchVersions]);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!sessionId) {
    return null;
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
            Version History
          </span>
          {versions.length > 0 && (
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
              {versions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentVersion !== undefined && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400">
              v{currentVersion}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-3 pb-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                Loading versions...
              </span>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-4 text-center">
              <Clock className="h-8 w-8 mx-auto text-blue-400 mb-2" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                No versions yet
              </p>
              <p className="text-[10px] text-blue-500 dark:text-blue-500 mt-1">
                Versions will appear as files are modified
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {versions.map((version, index) => {
                const isCurrentVersion = currentVersion === version.version;
                const isSelected = selectedVersion === version.version;
                
                return (
                  <div
                    key={version.commitId}
                    className={`rounded border transition-all ${
                      isCurrentVersion
                        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                        : isSelected
                        ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-blue-100 dark:border-blue-900 bg-white/50 dark:bg-blue-950/10 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                    }`}
                  >
                    {/* Version Header */}
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 flex-1">
                        {isCurrentVersion ? (
                          <CheckCircle className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <FileCode className="h-3 w-3 text-blue-500" />
                        )}
                        <span className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-300">
                          v{version.version}
                        </span>
                        <span className="text-[10px] text-blue-500 dark:text-blue-400">
                          {formatTimestamp(version.createdAt)}
                        </span>
                      </div>
                      <span className="text-[10px] text-blue-500 dark:text-blue-400">
                        {version.filesChanged} file{version.filesChanged !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Version Message */}
                    {version.message && (
                      <div className="px-2 pb-1.5">
                        <p className="text-[10px] text-blue-600 dark:text-blue-400 line-clamp-2">
                          {version.message}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    {!isCurrentVersion && (
                      <div className="px-2 pb-1.5 flex items-center gap-2">
                        {isSelected ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] border-blue-300 dark:border-blue-700"
                              onClick={() => setSelectedVersion(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-6 text-[10px] bg-blue-600 hover:bg-blue-700"
                              onClick={() => handleRollback(version.version)}
                              disabled={isRollingBack}
                            >
                              {isRollingBack ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Rolling back...
                                </>
                              ) : (
                                <>
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Restore v{version.version}
                                </>
                              )}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px]"
                            onClick={() => setSelectedVersion(version.version)}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Restore this version
                          </Button>
                        )}
                      </div>
                    )}

                    {/* File Paths (if available) */}
                    {version.paths && version.paths.length > 0 && (
                      <div className="px-2 pb-1.5">
                        <div className="text-[9px] text-blue-500 dark:text-blue-400 mb-1">
                          Files:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {version.paths.slice(0, 5).map((path, i) => (
                            <span
                              key={i}
                              className="text-[9px] font-mono bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded"
                            >
                              {path.split('/').pop()}
                            </span>
                          ))}
                          {version.paths.length > 5 && (
                            <span className="text-[9px] text-blue-500">
                              +{version.paths.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact Version Indicator
 * Shows current version with popover for history
 */
export function VersionIndicator({
  sessionId,
  currentVersion,
}: {
  sessionId: string;
  currentVersion?: number;
}) {
  const [showPopover, setShowPopover] = useState(false);

  if (!currentVersion) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowPopover(!showPopover)}
        className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
      >
        <History className="h-3 w-3" />
        <span className="font-mono">v{currentVersion}</span>
      </button>

      {showPopover && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPopover(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 shadow-lg p-2">
            <VersionHistoryPanel
              sessionId={sessionId}
              currentVersion={currentVersion}
              compact
              onVersionSelect={() => setShowPopover(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
