/**
 * SECURITY: Port validation utilities to prevent SSRF attacks
 */

// Allowed ports for opencode server proxy
export const ALLOWED_PORTS = [8080, 8081, 8082, 8888, 3000, 3001, 3002, 3003, 3004, 3005];

/**
 * Validate that a port is allowed
 * @param port - Port number to validate
 * @returns true if port is allowed
 */
export function isAllowedPort(port: number): boolean {
  return ALLOWED_PORTS.includes(port);
}

/**
 * Validate port and throw error if invalid
 * @param port - Port number to validate
 * @throws Error if port is invalid or not allowed
 */
export function validatePort(port: number): void {
  if (!port || isNaN(port)) {
    throw new Error("Invalid port");
  }
  
  if (!isAllowedPort(port)) {
    throw new Error(`Port ${port} is not allowed. Allowed ports: ${ALLOWED_PORTS.join(', ')}`);
  }
}
