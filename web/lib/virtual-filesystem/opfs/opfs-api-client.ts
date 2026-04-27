/**
 * OPFS API Client
 * 
 * Client-side API utilities for OPFS server communication
 * Handles authentication, session management, and error handling
 */

import { buildApiHeaders } from '@/lib/utils';
import { isDesktopMode, isTauriRuntime } from '@bing/platform/env';
import { tauriFetch } from '@/lib/tauri-api-adapter';

/**
 * Get authentication headers for API requests.
 * Delegates to the shared `buildApiHeaders` utility.
 */
export function getAuthHeaders(): Record<string, string> {
  return buildApiHeaders();
}

/**
 * Make authenticated fetch request
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = getAuthHeaders();

  const requestInit: RequestInit = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
    credentials: 'include', // Include cookies for session
  };

  if (isDesktopMode() || isTauriRuntime()) {
    return tauriFetch(url, requestInit);
  }

  return fetch(url, requestInit);
}

/**
 * Fetch file from server via API
 */
export async function fetchFileFromServer(path: string): Promise<{
  path: string;
  content: string;
  version: number;
  language: string;
  size: number;
  lastModified: string;
  createdAt: string;
} | null> {
  try {
    const response = await authenticatedFetch('/api/filesystem/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    if (!result.success) return null;

    // Add createdAt if missing (backward compatibility)
    if (!result.data.createdAt) {
      result.data.createdAt = result.data.lastModified;
    }

    return result.data;
  } catch {
    return null;
  }
}

/**
 * Write file to server via API
 */
export async function writeFileToServer(
  path: string,
  content: string,
  language?: string
): Promise<boolean> {
  try {
    const response = await authenticatedFetch('/api/filesystem/write', {
      method: 'POST',
      body: JSON.stringify({ path, content, language }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get workspace snapshot from server via API
 */
export async function getWorkspaceSnapshot(
  path = 'project'
): Promise<{
  root: string;
  version: number;
  updatedAt: string;
  files: Array<{
    path: string;
    content: string;
    version: number;
    size: number;
    language: string;
    lastModified: string;
  }>;
} | null> {
  try {
    const response = await authenticatedFetch(
      `/api/filesystem/snapshot?path=${encodeURIComponent(path)}`
    );

    if (!response.ok) return null;

    const result = await response.json();
    if (!result.success) return null;

    return result.data;
  } catch {
    return null;
  }
}

/**
 * Delete file from server via API
 */
export async function deleteFileFromServer(path: string): Promise<boolean> {
  try {
    const response = await authenticatedFetch('/api/filesystem/delete', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
