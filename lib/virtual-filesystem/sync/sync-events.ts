export const FILESYSTEM_UPDATED_EVENT = 'filesystem-updated';

let filesystemEventSequence = 0;

export interface FilesystemUpdatedDetail {
  protocolVersion?: 1;
  eventId?: string;
  emittedAt?: number;
  scopePath?: string;
  path?: string;          // Single file path (for single-file operations)
  paths?: string[];       // Multiple file paths (for batch operations like visual editor)
  type?: 'create' | 'update' | 'delete';  // Operation type
  source?: string;
  sessionId?: string;
  commitId?: string;
  workspaceVersion?: number;
  applied?: any;
  errors?: any;
}

function normalizeFilesystemUpdatedDetail(detail: FilesystemUpdatedDetail = {}): FilesystemUpdatedDetail {
  const emittedAt = detail.emittedAt ?? Date.now();
  filesystemEventSequence += 1;

  return {
    protocolVersion: 1,
    eventId: detail.eventId || `fs-${emittedAt}-${filesystemEventSequence}`,
    emittedAt,
    ...detail,
  };
}

export function emitFilesystemUpdated(detail: FilesystemUpdatedDetail = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const normalizedDetail = normalizeFilesystemUpdatedDetail(detail);
    window.dispatchEvent(new CustomEvent(FILESYSTEM_UPDATED_EVENT, { detail: normalizedDetail }));
  } catch (err) {
    console.warn('[sync-events] Failed to dispatch filesystem-updated event:', err);
  }
}

/**
 * Subscribe to filesystem-updated events
 * Returns unsubscribe function
 * 
 * FIX: Store listener reference properly for cleanup
 */
export function onFilesystemUpdated(
  handler: (event: CustomEvent<FilesystemUpdatedDetail>) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  
  // Create a stable listener that wraps the handler
  const listener = (event: Event) => handler(event as CustomEvent<FilesystemUpdatedDetail>);
  
  // Add listener
  window.addEventListener(FILESYSTEM_UPDATED_EVENT, listener as EventListener);
  
  // Return cleanup function that removes THE SAME listener instance
  return () => {
    window.removeEventListener(FILESYSTEM_UPDATED_EVENT, listener as EventListener);
  };
}
