/**
 * Utility functions for parsing HTTP responses
 * Centralizes error handling to reduce code duplication
 */

export async function parseJsonResponse<T = Record<string, unknown>>(
  response: Response
): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

export async function parseJsonResponseOrNull<T = Record<string, unknown>>(
  response: Response
): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function parseJsonResponseOrDefault<T = Record<string, unknown>>(
  response: Response,
  defaultValue: T
): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return defaultValue;
  }
}
