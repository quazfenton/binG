export const FILESYSTEM_UPDATED_EVENT = 'filesystem-updated';

export interface FilesystemUpdatedDetail {
  scopePath?: string;
  path?: string;
  source?: string;
  applied?: any;
  errors?: any;
}

export function emitFilesystemUpdated(detail: FilesystemUpdatedDetail = {}): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(FILESYSTEM_UPDATED_EVENT, { detail }));
  } catch (err) {
    console.warn('[sync-events] Failed to dispatch filesystem-updated event:', err);
  }
}

export function onFilesystemUpdated(
  handler: (event: CustomEvent<FilesystemUpdatedDetail>) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => handler(event as CustomEvent<FilesystemUpdatedDetail>);
  window.addEventListener(FILESYSTEM_UPDATED_EVENT, listener as EventListener);
  return () => window.removeEventListener(FILESYSTEM_UPDATED_EVENT, listener as EventListener);
}
