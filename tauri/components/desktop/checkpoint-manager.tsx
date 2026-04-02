'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Clock, Trash2, RotateCcw, Plus, Loader2 } from 'lucide-react';
import { tauriInvoke } from '@/lib/tauri/invoke-bridge';
import { isDesktopMode } from '@/lib/utils/desktop-env';
import { formatDistanceToNow } from 'date-fns';

interface Checkpoint {
  id: string;
  name: string;
  created_at: string;
}

interface CheckpointManagerProps {
  sandboxId: string;
  onCheckpointRestored?: (checkpointId: string) => void;
  className?: string;
}

export function CheckpointManager({
  sandboxId,
  onCheckpointRestored,
  className,
}: CheckpointManagerProps) {
  const [open, setOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [newCheckpointName, setNewCheckpointName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(isDesktopMode());
  }, []);

  // FIX: Track loading state to prevent race conditions (declared before use)
  const [isLoadingCheckpoints, setIsLoadingCheckpoints] = useState(false);

  const loadCheckpoints = async () => {
    if (!isDesktop) {
      setError('Checkpoint manager is only available in desktop mode');
      return;
    }

    // Prevent concurrent loading operations
    if (isLoadingCheckpoints) {
      return;
    }

    setIsLoadingCheckpoints(true);
    setLoading(true);
    setError(null);
    try {
      const list = await tauriInvoke.listCheckpoints(sandboxId);
      setCheckpoints(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load checkpoints');
    } finally {
      setLoading(false);
      setIsLoadingCheckpoints(false);
    }
  };

  const handleCreateCheckpoint = async () => {
    setCreating(true);
    setError(null);
    try {
      const name = newCheckpointName.trim() || undefined;
      // FIX: Validate create result - don't silently ignore failures
      const result = await tauriInvoke.createCheckpoint(sandboxId, name);
      if (!result) {
        setError('Failed to create checkpoint - operation returned null/false');
        return;
      }
      setNewCheckpointName('');
      await loadCheckpoints();
    } catch (err: any) {
      setError(err.message || 'Failed to create checkpoint');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (checkpointId: string) => {
    setRestoring(checkpointId);
    setError(null);
    try {
      const success = await tauriInvoke.restoreCheckpoint(sandboxId, checkpointId);
      if (success) {
        onCheckpointRestored?.(checkpointId);
        // FIX: Refresh checkpoint list after successful restore
        await loadCheckpoints();
        setOpen(false);
      } else {
        setError('Failed to restore checkpoint');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to restore checkpoint');
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (checkpointId: string) => {
    try {
      // FIX: Validate delete result - don't silently ignore failures
      const result = await tauriInvoke.deleteCheckpoint(sandboxId, checkpointId);
      if (!result) {
        setError('Failed to delete checkpoint - operation returned false');
        return;
      }
      setDeleteConfirm(null);
      await loadCheckpoints();
    } catch (err: any) {
      setError(err.message || 'Failed to delete checkpoint');
    }
  };

  const handleOpen = () => {
    setOpen(true);
    loadCheckpoints();
  };

  if (!isDesktop) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpen}
        className={className}
      >
        <Clock className="w-4 h-4 mr-2" />
        Checkpoints
        {checkpoints.length > 0 && (
          <Badge variant="secondary" className="ml-2">
            {checkpoints.length}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Checkpoints</DialogTitle>
            <DialogDescription>
              Create and restore checkpoints to save and revert your workspace state.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Create new checkpoint */}
            <div className="flex gap-2">
              <Input
                placeholder="Checkpoint name (optional)"
                value={newCheckpointName}
                onChange={(e) => setNewCheckpointName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCheckpoint()}
                disabled={creating}
              />
              <Button onClick={handleCreateCheckpoint} disabled={creating}>
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                {error}
              </div>
            )}

            {/* Checkpoint list */}
            <ScrollArea className="h-[300px]">
              {loading ? (
                <div className="flex items-center justify-center h-20">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : checkpoints.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No checkpoints yet. Create one to save your current workspace state.
                </div>
              ) : (
                <div className="space-y-2">
                  {checkpoints.map((checkpoint) => (
                    <div
                      key={checkpoint.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{checkpoint.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(checkpoint.created_at), {
                            addSuffix: true,
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(checkpoint.id)}
                          disabled={restoring === checkpoint.id}
                        >
                          {restoring === checkpoint.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCcw className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(checkpoint.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Checkpoint</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this checkpoint? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CheckpointManager;