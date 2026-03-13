/**
 * Terminal Input Sanitizer
 *
 * Sanitizes terminal input to prevent injection attacks and malicious commands.
 * 
 * Features:
 * - Remove dangerous control characters
 * - Prevent null byte injection
 * - Validate encoding
 * - Detect and block escape sequences
 *
 * @example
 * ```typescript
 * const sanitized = sanitizeTerminalInput('ls -la\r\n')
 * const encoded = encodeTerminalOutput('<script>alert("xss")</script>')
 * ```
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('TerminalSanitizer')

/**
 * Dangerous control characters to remove or escape
 */
const DANGEROUS_CONTROL_CHARS = [
  '\u0000', // Null byte
  '\u001b', // Escape (handled separately for ANSI)
  '\u0080', // Control character
  '\u0099', // Control character
]

/**
 * Allowed escape sequences (ANSI color codes, etc.)
 */
const ALLOWED_ESCAPE_PATTERNS = [
  /\x1b\[[0-9;]*m/g, // ANSI color codes
  /\x1b\[[0-9;]*[A-Z]/g, // ANSI cursor movement
  /\x1b\][0-9];[^\x07]*\x07/g, // OSC sequences
]

/**
 * Sanitize terminal input
 *
 * Removes dangerous characters and validates encoding.
 * Preserves legitimate escape sequences (ANSI colors, cursor movement).
 */
export function sanitizeTerminalInput(input: string): string {
  if (!input) {
    return ''
  }

  let sanitized = input

  // Remove null bytes
  sanitized = sanitized.replace(/\u0000/g, '')

  // Remove other dangerous control characters (except common ones like \r, \n, \t)
  for (const char of DANGEROUS_CONTROL_CHARS) {
    if (char !== '\u001b') { // Keep escape for ANSI
      sanitized = sanitized.replace(new RegExp(char, 'g'), '')
    }
  }

  // Validate UTF-8 encoding
  try {
    // Encode and decode to validate
    const encoder = new TextEncoder()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const encoded = encoder.encode(sanitized)
    sanitized = decoder.decode(encoded)
  } catch (error) {
    logger.warn('Invalid UTF-8 encoding detected, cleaning input', error)
    // Fallback: remove non-ASCII characters
    sanitized = sanitized.replace(/[^\x20-\x7E\r\n\t]/g, '')
  }

  // Detect and log suspicious patterns
  const suspiciousPatterns = [
    /\x1b\]0;.*\x07/, // OSC title change (can be used for injection)
    /\x1bP.*\x1b\\/, // DCS sequences (device control)
    /\x1b\[.*[@-~]/, // CSI sequences (check for malicious params)
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      logger.warn('Suspicious escape sequence detected', {
        input: sanitized.substring(0, 100),
        pattern: pattern.toString(),
      })
      // Remove the suspicious sequence
      sanitized = sanitized.replace(pattern, '')
    }
  }

  return sanitized
}

/**
 * Encode terminal output for safe display
 *
 * Prevents XSS attacks by encoding HTML special characters.
 * Preserves ANSI escape sequences for colors and formatting.
 */
export function encodeTerminalOutput(output: string): string {
  if (!output) {
    return ''
  }

  // Extract and preserve ANSI escape sequences
  const ansiSequences: string[] = []
  let processedOutput = output

  // Store ANSI sequences
  for (const pattern of ALLOWED_ESCAPE_PATTERNS) {
    const matches = output.match(pattern)
    if (matches) {
      for (const match of matches) {
        ansiSequences.push(match)
        processedOutput = processedOutput.replace(match, `\u0000ANSI${ansiSequences.length - 1}\u0000`)
      }
    }
  }

  // HTML encode the rest
  let encoded = processedOutput
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  // Restore ANSI sequences
  for (let i = 0; i < ansiSequences.length; i++) {
    encoded = encoded.replace(`\u0000ANSI${i}\u0000`, ansiSequences[i])
  }

  return encoded
}

/**
 * Verify sandbox ownership
 *
 * Ensures user can only access their own sandboxes.
 */
export async function verifySandboxOwnership(
  userId: string,
  sandboxId: string,
  getSessionBySandboxId: (sandboxId: string) => Promise<{ userId: string } | null>
): Promise<boolean> {
  try {
    const session = await getSessionBySandboxId(sandboxId)
    
    if (!session) {
      logger.warn('Sandbox session not found', { sandboxId })
      return false
    }

    const isOwner = session.userId === userId
    
    if (!isOwner) {
      logger.warn('Sandbox ownership verification failed', {
        sandboxId,
        sessionUserId: session.userId,
        requestingUserId: userId,
      })
    }

    return isOwner
  } catch (error) {
    logger.error('Sandbox ownership verification error', error)
    return false
  }
}

/**
 * Rate limit check for terminal commands
 */
export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number
}

export function checkCommandRateLimit(
  userId: string,
  commandCount: number,
  windowMs: number = 60000, // 1 minute
  maxCommands: number = 100
): RateLimitResult {
  // Simple in-memory rate limiting
  // In production, use Redis or similar for distributed rate limiting
  
  const now = Date.now()
  const windowStart = now - windowMs
  
  // Track commands in a sliding window
  const userCommands = getUserCommandHistory(userId)
  const recentCommands = userCommands.filter(timestamp => timestamp > windowStart)
  
  const remaining = Math.max(0, maxCommands - recentCommands.length)
  const resetAt = windowStart + windowMs
  
  if (recentCommands.length >= maxCommands) {
    const oldestCommand = Math.min(...recentCommands)
    const retryAfter = Math.ceil((oldestCommand + windowMs - now) / 1000)
    
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter,
    }
  }
  
  // Record this command
  recordCommand(userId, now)
  
  return {
    allowed: true,
    remaining,
    resetAt,
  }
}

// In-memory storage for rate limiting (use Redis in production)
const commandHistory = new Map<string, number[]>()

function getUserCommandHistory(userId: string): number[] {
  return commandHistory.get(userId) || []
}

function recordCommand(userId: string, timestamp: number): void {
  const history = getUserCommandHistory(userId)
  history.push(timestamp)
  
  // Keep only last 1000 timestamps to prevent memory bloat
  if (history.length > 1000) {
    history.shift()
  }
  
  commandHistory.set(userId, history)
}

/**
 * Clean up old command history (call periodically)
 */
export function cleanupCommandHistory(windowMs: number = 60000): void {
  const now = Date.now()
  const windowStart = now - windowMs
  
  for (const [userId, history] of commandHistory.entries()) {
    const recentHistory = history.filter(timestamp => timestamp > windowStart)
    
    if (recentHistory.length === 0) {
      commandHistory.delete(userId)
    } else {
      commandHistory.set(userId, recentHistory)
    }
  }
}

// Clean up every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => cleanupCommandHistory(), 5 * 60 * 1000)
}
