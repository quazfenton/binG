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


