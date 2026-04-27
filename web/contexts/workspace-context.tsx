"use client";

import {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { isDesktopMode } from '@bing/platform/env';
import { tauriInvoke, loadSettings as loadTauriSettings } from '@/lib/tauri/invoke-bridge';
import { getDesktopWorkspaceDir } from '@/lib/utils/desktop-env';
import { createLogger } from '@/lib/utils/logger';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';

const log = createLogger('WorkspaceContext');

interface WorkspaceContextValue {
  /** Current workspace root path (absolute) */
  workspaceRoot: string;
  /** Whether the workspace root is being changed */
  isChanging: boolean;
  /** Open a native folder-picker dialog and set the selected path as workspace root */
  openProjectFolder: () => Promise<void>;
  /** Set the workspace root to a specific path (no dialog) */
  setWorkspaceRoot: (path: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Guard: only activate on the client side so SSG/SSR prerendering doesn't
  // fail with "Cannot read properties of null (reading 'useContext')".
  const [mounted, setMounted] = useState(false);
  const [workspaceRoot, setWorkspaceRootState] = useState<string>('');
  const [isChanging, setIsChanging] = useState(false);

  // Only initialize on the client after hydration
  useEffect(() => {
    setMounted(true);
    setWorkspaceRootState(() => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('desktop_workspace_root');
        if (saved) return saved;
      }
      return getDesktopWorkspaceDir() || '';
    });

    if (!isDesktopMode()) return;
    (async () => {
      try {
        const settings = await loadTauriSettings();
        if (settings && typeof settings === 'object' && settings.workspaceRoot && typeof settings.workspaceRoot === 'string') {
          setWorkspaceRootState(settings.workspaceRoot);
          localStorage.setItem('desktop_workspace_root', settings.workspaceRoot);
        }
      } catch {
        // Settings not available yet — that's fine
      }
    })();
  }, []);

  const applyWorkspaceChange = useCallback(async (newPath: string) => {
    setIsChanging(true);
    try {
      const result = await tauriInvoke.setWorkspaceRoot(newPath);
      if (result.success && result.path) {
        setWorkspaceRootState(result.path);
        localStorage.setItem('desktop_workspace_root', result.path);
        log.info('Workspace root changed', { path: result.path });

        // Notify VFS and file explorer to refresh with the new workspace
        emitFilesystemUpdated({
          path: result.path,
          type: 'update',
          source: 'workspace-change',
          sessionId: '',
        });

        // The running Next.js sidecar doesn't pick up env var changes
        // dynamically — let the user know a restart may be needed.
        // Lazy-import sonner's toast to keep SSR/SSG clean (toast uses useContext internally)
        import('sonner').then(({ toast }) => {
          toast.info('Workspace changed. Restart the app for full effect on running services.', {
            duration: 6000,
          });
        });
      } else {
        log.error('Failed to set workspace root', { error: result.error });
      }
    } catch (err: any) {
      log.error('Failed to set workspace root', err);
    } finally {
      setIsChanging(false);
    }
  }, []);

  const openProjectFolder = useCallback(async () => {
    try {
      const result = await tauriInvoke.openDirectoryDialog({
        title: 'Open Project Folder',
        defaultPath: workspaceRoot || getDesktopWorkspaceDir() || undefined,
      });
      if (result && result.path) {
        await applyWorkspaceChange(result.path);
      }
    } catch (err: any) {
      log.error('Failed to open directory dialog', err);
    }
  }, [workspaceRoot, applyWorkspaceChange]);

  const setWorkspaceRootFn = useCallback(async (path: string) => {
    await applyWorkspaceChange(path);
  }, [applyWorkspaceChange]);

  // Don't render the context at all during SSR — desktop-only feature
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceRoot,
        isChanging,
        openProjectFolder,
        setWorkspaceRoot: setWorkspaceRootFn,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    // Return a no-op fallback when not inside the provider (e.g. web mode)
    return {
      workspaceRoot: '',
      isChanging: false,
      openProjectFolder: async () => {},
      setWorkspaceRoot: async () => {},
    };
  }
  return ctx;
}
