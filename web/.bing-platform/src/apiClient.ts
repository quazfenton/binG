/**
 * API Client Abstraction
 *
 * Provides a unified fetch interface for both web and desktop:
 * - Desktop: Can use Tauri's HTTP client or standard fetch
 * - Web: Standard fetch API
 *
 * This abstraction allows easy switching between:
 * - Cloud APIs (OpenAI, Anthropic, etc.)
 * - Local models (localhost:11434, Ollama, etc.)
 * - Rust-side inference (desktop-only)
 *
 * Usage:
 * ```ts
 * import { apiFetch } from '@/lib/platform/apiClient';
 *
 * // Standard API call
 * const res = await apiFetch('https://api.openai.com/v1/chat/completions', {
 *   method: 'POST',
 *   headers: { 'Authorization': 'Bearer ...' },
 *   body: JSON.stringify({ model: 'gpt-4', messages: [...] }),
 * });
 *
 * // Local model
 * const res = await apiFetch('http://localhost:11434/api/generate', {
 *   method: 'POST',
 *   body: JSON.stringify({ model: 'llama2', prompt: 'Hello' }),
 * });
 * ```
 */

import { isDesktopMode } from './env';

export interface ApiFetchOptions extends RequestInit {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Whether to parse response as JSON */
  parseJson?: boolean;
  /** Base URL to prepend to path */
  baseUrl?: string;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  statusText: string;
  data?: T;
  error?: string;
  headers: Record<string, string>;
}

/**
 * Unified API fetch function
 */
export async function apiFetch<T = any>(
  url: string,
  options?: ApiFetchOptions
): Promise<ApiResponse<T>> {
  const {
    timeout = 30000,
    parseJson = true,
    baseUrl,
    ...fetchOptions
  } = options || {};

  // Prepend base URL if provided
  const fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}` : url;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Merge signals if a user-provided signal exists
  let combinedSignal: AbortSignal = controller.signal;
  let onAbort: (() => void) | undefined;

  if (fetchOptions.signal) {
    const c = new AbortController();
    onAbort = () => {
      controller.abort();
      c.abort();
    };
    fetchOptions.signal.addEventListener('abort', onAbort);
    controller.signal.addEventListener('abort', onAbort);
    combinedSignal = c.signal;
  }

  try {
    return await executeFetch<T>(fullUrl, { ...fetchOptions, signal: combinedSignal }, parseJson);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        ok: false,
        status: 408,
        statusText: 'Request Timeout',
        error: `Request timed out after ${timeout}ms`,
        headers: {},
      };
    }

    return {
      ok: false,
      status: 0,
      statusText: 'Network Error',
      error: error.message || String(error),
      headers: {},
    };
  } finally {
    if (onAbort) {
      fetchOptions.signal?.removeEventListener('abort', onAbort);
      controller.signal.removeEventListener('abort', onAbort);
    }
    clearTimeout(timeoutId);
  }
}

/**
 * Execute the actual fetch and parse response
 */
async function executeFetch<T>(
  url: string,
  options: RequestInit,
  parseJson: boolean
): Promise<ApiResponse<T>> {
  const response = await fetch(url, options);

  // Parse headers
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Parse body
  let data: T | undefined;
  let error: string | undefined;

  if (parseJson && response.ok) {
    try {
      data = await response.json();
    } catch (e: any) {
      error = `Failed to parse JSON response: ${e.message}`;
    }
  } else if (response.ok) {
    // parseJson is false, but response is successful — return text
    data = (await response.text()) as T;
  } else if (!response.ok) {
    try {
      const errorBody = await response.text();
      try {
        const errorJson = JSON.parse(errorBody);
        error = errorJson.error?.message || JSON.stringify(errorJson);
      } catch {
        error = errorBody || `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch {
      error = `HTTP ${response.status}: ${response.statusText}`;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data,
    error,
    headers,
  };
}

/**
 * Create a pre-configured API client with default options
 */
export function createApiClient(defaults: { baseUrl: string; headers?: Record<string, string> }) {
  return async function client<T = any>(
    url: string,
    options?: ApiFetchOptions
  ): Promise<ApiResponse<T>> {
    return apiFetch<T>(url, {
      ...options,
      baseUrl: defaults.baseUrl,
      headers: {
        ...defaults.headers,
        ...options?.headers,
      },
    });
  };
}

export default apiFetch;
