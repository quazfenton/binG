export const FILESYSTEM_UPDATED_EVENT = 'filesystem-updated';

let filesystemEventSequence = 0;

// BroadcastChannel for cross-tab synchronization
let broadcastChannel: BroadcastChannel | null = null;
let isCleanupRegistered = false;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel('binG-vfs-events');
      
      // Register cleanup on page unload to prevent channel leaks
      if (!isCleanupRegistered) {
        window.addEventListener('beforeunload', () => {
          broadcastChannel?.close();
          broadcastChannel = null;
        });
        isCleanupRegistered = true;
      }
    } catch (err) {
      console.warn('[sync-events] BroadcastChannel not supported:', err);
      return null;
    }
  }
  return broadcastChannel;
}

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

/**
 * Emit filesystem-updated event to all tabs in the same browser session
 * Uses both window CustomEvent (same tab) and BroadcastChannel (other tabs)
 */
export function emitFilesystemUpdated(detail: FilesystemUpdatedDetail = {}): void {
  if (typeof window === 'undefined') return;
  
  try {
    const normalizedDetail = normalizeFilesystemUpdatedDetail(detail);
    
    // Emit to same-tab listeners
    window.dispatchEvent(new CustomEvent(FILESYSTEM_UPDATED_EVENT, { detail: normalizedDetail }));
    
    // Emit to other tabs via BroadcastChannel
    const channel = getBroadcastChannel();
    if (channel) {
      channel.postMessage({
        type: FILESYSTEM_UPDATED_EVENT,
        detail: normalizedDetail,
      });
    }
    
    // Also emit to server-side subscribers via fetch (for other sessions/users)
    // This handles cross-browser-tab and cross-session scenarios
    fetch('/api/filesystem/events/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedDetail),
      credentials: 'include', // Include cookies for auth
    }).catch(() => {
      // Silently fail - local events are sufficient for single-session scenarios
    });
  } catch (err) {
    console.warn('[sync-events] Failed to dispatch filesystem-updated event:', err);
  }
}

/**
 * Subscribe to filesystem-updated events (same-tab and cross-tab)
 * Returns unsubscribe function
 */
export function onFilesystemUpdated(
  handler: (event: CustomEvent<FilesystemUpdatedDetail>) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  
  // Create a stable listener that wraps the handler
  const listener = (event: Event) => handler(event as CustomEvent<FilesystemUpdatedDetail>);
  
  // Add listener for same-tab events
  window.addEventListener(FILESYSTEM_UPDATED_EVENT, listener as EventListener);
  
  // Add listener for cross-tab events via BroadcastChannel
  const channel = getBroadcastChannel();
  const broadcastListener = (event: MessageEvent) => {
    if (event.data?.type === FILESYSTEM_UPDATED_EVENT && event.data?.detail) {
      // Re-emit as a CustomEvent for consistency
      window.dispatchEvent(new CustomEvent(FILESYSTEM_UPDATED_EVENT, { detail: event.data.detail }));
    }
  };
  
  if (channel) {
    channel.addEventListener('message', broadcastListener);
  }
  
  // Return cleanup function that removes ALL listeners
  return () => {
    window.removeEventListener(FILESYSTEM_UPDATED_EVENT, listener as EventListener);
    if (channel) {
      channel.removeEventListener('message', broadcastListener);
    }
  };
}
