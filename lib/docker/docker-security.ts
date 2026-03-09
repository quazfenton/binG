/**
 * Docker Security Utilities
 * 
 * Provides security helpers for Docker API routes including
 * container ownership verification and access control.
 */

import { Dockerode } from 'dockerode';

/**
 * Verify that a container is owned by the authenticated user
 * Uses Docker labels to track ownership (bing.user-id label)
 * 
 * @param container - Docker container object
 * @param userId - Authenticated user ID
 * @returns Object with authorized boolean and optional error message
 */
export async function verifyContainerOwnership(
  container: Dockerode.Container,
  userId: string
): Promise<{ authorized: boolean; error?: string; containerOwnerId?: string }> {
  try {
    const containerInfo = await container.inspect();
    const containerOwnerId = containerInfo.Config?.Labels?.['bing.user-id'];
    
    // If container has ownership label, verify it matches the authenticated user
    if (containerOwnerId) {
      if (containerOwnerId !== userId) {
        console.warn(`[Docker] User ${userId} attempted to access container owned by ${containerOwnerId}`);
        return { 
          authorized: false, 
          error: 'Unauthorized: You do not own this container',
          containerOwnerId 
        };
      }
      return { authorized: true, containerOwnerId };
    }
    
    // If no ownership label, only allow in development
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[Docker] Production: Container has no ownership label`);
      return { 
        authorized: false, 
        error: 'Container ownership not established. Container must have "bing.user-id" label.' 
      };
    }
    
    // Development: allow unlabeled containers (legacy)
    return { authorized: true };
  } catch (inspectError: any) {
    if (inspectError.statusCode === 404) {
      return { authorized: false, error: 'Container not found' };
    }
    throw inspectError;
  }
}

/**
 * Validate container ID format
 * Docker container IDs are 64-character hex strings (often truncated to 12)
 */
export function validateContainerId(id: string): boolean {
  return /^[a-f0-9]{12,64}$/.test(id.toLowerCase());
}
