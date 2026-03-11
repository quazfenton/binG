/**
 * OPFS API Client
 * 
 * Client-side API utilities for OPFS server communication
 * Handles authentication, session management, and error handling
 */

/**
 * Get auth token from localStorage
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

/**
 * Get anonymous session ID for unauthenticated users
 */
function getAnonymousSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let sessionId = localStorage.getItem('anonymous_session_id');
    if (!sessionId) {
      // Generate a simple anonymous session ID
      sessionId = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('anonymous_session_id', sessionId);
    }
    return sessionId;
  } catch {
    return null;
  }
}

/**
 * Get authentication headers for API requests
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  const anonymousSessionId = getAnonymousSessionId();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (anonymousSessionId) {
    headers['X-Anonymous-Session-ID'] = anonymousSessionId;
  }
  
  return headers;
}

/**
 * Make authenticated fetch request
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = getAuthHeaders();
  
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
    credentials: 'include', // Include cookies for session
  });
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
} | null> {
  try {
    const response = await authenticatedFetch('/api/filesystem/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    if (!result.success) return null;

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
