/**
 * Docker Command Utilities
 * 
 * Provides command validation and Docker loading helpers
 * for Docker API routes.
 */

/**
 * Dynamically load dockerode module
 */
export const loadDocker = async () => {
  const mod = await import('dockerode');
  return (mod as any).default || mod;
};

// Whitelist of allowed commands to prevent command injection
// Note: Network utilities (curl, wget) are excluded to prevent data exfiltration
// SECURITY: 'find' removed from whitelist as it can bypass restrictions via -exec flag
const allowedCommands = ['ps', 'ls', 'df', 'top', 'free', 'uptime', 'whoami', 'pwd', 'cat', 'tail', 'head', 'grep', 'du', 'netstat', 'ss', 'ip', 'ifconfig', 'ping'];

/**
 * Validates and sanitizes the command to prevent command injection.
 * Only allows whitelisted base commands without shell metacharacters.
 */
export const validateCommand = (command: string): { valid: boolean; sanitizedCmd?: string[] } => {
  if (!command || typeof command !== 'string') {
    return { valid: false };
  }

  // Block shell metacharacters that could enable injection
  const dangerousChars = /[$`;|&<>(){}[\]\\!#*?~]/;
  if (dangerousChars.test(command)) {
    return { valid: false };
  }

  // Extract base command (first word)
  const parts = command.trim().split(/\s+/);
  const baseCmd = parts[0];

  if (!allowedCommands.includes(baseCmd)) {
    return { valid: false };
  }

  return { valid: true, sanitizedCmd: parts };
};
