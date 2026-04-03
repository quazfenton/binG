/**
 * Sandbox Security Utilities
 *
 * Shared security functions for all sandbox providers.
 * Includes command validation, path validation, and security constants.
 *
 * @see docs/COMPREHENSIVE_REVIEW_FINDINGS.md Security section
 */

import { resolve, relative } from 'path';

/**
 * Blocked command patterns to prevent security issues
 * 
 * These patterns block:
 * - System destruction (rm -rf /)
 * - Permission escalation (chmod 777)
 * - Remote code execution (curl | bash)
 * - Process manipulation (kill, pkill)
 * - Network attacks (nmap, masscan)
 * - Privilege escalation (sudo, su)
 * - Data exfiltration (nc, netcat)
 * - Fork bombs
 */
export const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[rf]+\s+)?\/(\s|$)/,           // rm -rf /
  /\brm\s+(-[rf]+\s+)?\*\s*$/,             // rm -rf *
  /\bchmod\s+(-R\s+)?777/,                 // chmod 777
  /\bcurl\b.*\|\s*(ba)?sh/,                // curl | bash
  /\bwget\b.*\|\s*(ba)?sh/,                // wget | bash
  /\bkill\b\s+-\d/,                        // kill signals
  /\bpkill\b/,                             // pkill
  /\bnmap\b/,                              // nmap
  /\bmasscan\b/,                           // masscan
  /\bsudo\b/,                              // sudo
  /\bsu\s+-/,                              // su -
  /\bnc\s+-[el]/,                          // netcat listener
  /\bnetcat\b.*-[el]/,                     // netcat listener
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/,          // Fork bomb
  /\bmkfs\b/,                              // Format filesystem
  /\bdd\s+if=\/dev\/zero/,                 // dd zero fill
  /\bshutdown\b/,                          // Shutdown
  /\breboot\b/,                            // Reboot
  /\binit\s+\d/,                           // Runlevel change
  /\bmount\s+--bind/,                      // Bind mount (escape chroot)
  /\bchsh\s+/,                             // Change shell
  /\bpwgen\b/,                             // Password generation (mining)
  /\bpython.*-m\s+http\.server/,           // Python HTTP server (data exfil)
  /\bphp.*-S\s+0\.0\.0\.0/,                // PHP server (data exfil)
];

/**
 * Blocked file patterns to prevent security issues
 */
export const BLOCKED_FILE_PATTERNS: RegExp[] = [
  /\/etc\/passwd/,                         // Password file
  /\/etc\/shadow/,                         // Shadow password file
  /\/etc\/ssh\//,                          // SSH config
  /\/root\/\.ssh\//,                       // Root SSH keys
  /\/proc\//,                              // Proc filesystem
  /\/sys\//,                               // Sys filesystem
  /\/dev\/(?!null|zero|random|urandom)/,   // Most /dev files
];

/**
 * Validate command for security issues
 *
 * @param command - Command to validate
 * @returns Validation result with reason if blocked
 *
 * @example
 * const validation = validateCommand('rm -rf /');
 * if (!validation.valid) {
 *   console.error(validation.reason);
 * }
 */
export function validateCommand(command: string): {
  valid: boolean;
  reason?: string;
} {
  // Check for Unicode homoglyph attacks (Cyrillic characters that look Latin)
  const homoglyphPattern = /[\u0400-\u04FF]/; // Cyrillic range
  if (homoglyphPattern.test(command)) {
    return {
      valid: false,
      reason: `Command blocked: Unicode homoglyph character detected - potential security risk`,
    };
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `Command blocked: dangerous operation detected`,
      };
    }
  }

  // Check for shell injection attempts
  const injectionPatterns = [
    /\$\(/,                    // Command substitution
    /`[^`]+`/,                 // Backtick command substitution
    /;\s*\w/,                  // Command chaining
    /\|\|/,                    // OR operator
    /&&/,                      // AND operator (allowed in moderation)
    />\s*\/dev\//,             // Redirect to /dev
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(command)) {
      // Allow && for simple command chaining
      if (pattern.source === /&&/.source) {
        const andCount = (command.match(/&&/g) || []).length;
        if (andCount > 3) {
          return {
            valid: false,
            reason: `Too many command chains (max 3): ${command}`,
          };
        }
        continue;
      }

      return {
        valid: false,
        reason: `Potential shell injection detected: ${command}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate file path for security issues
 * 
 * @param filePath - File path to validate
 * @param workspaceDir - Workspace directory (must stay within)
 * @returns Validation result with reason if blocked
 * 
 * @example
 * const validation = validateFilePath('../../../etc/passwd', '/workspace');
 * if (!validation.valid) {
 *   console.error(validation.reason);
 * }
 */
export function validateFilePath(
  filePath: string,
  workspaceDir: string
): {
  valid: boolean;
  reason?: string;
} {
  // Check for null bytes
  if (filePath.includes('\0')) {
    return {
      valid: false,
      reason: `Null byte in path: ${filePath}`,
    };
  }

  // Check against blocked file patterns
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return {
        valid: false,
        reason: `Access to sensitive path blocked: ${filePath}`,
      };
    }
  }

  // Resolve and validate path stays within workspace
  try {
    const resolved = filePath.startsWith('/')
      ? resolve(filePath)
      : resolve(workspaceDir, filePath);

    const rel = relative(workspaceDir, resolved);
    if (
      rel.startsWith('..') ||
      resolved === '..' ||
      resolve(workspaceDir, rel) !== resolved
    ) {
      return {
        valid: false,
        reason: `Path traversal rejected: ${filePath}`,
      };
    }
  } catch (error: any) {
    return {
      valid: false,
      reason: `Invalid path: ${error.message}`,
    };
  }

  return { valid: true };
}

/**
 * Resolve and validate path (combines resolve + validate)
 * 
 * @param filePath - File path to resolve
 * @param workspaceDir - Workspace directory (must stay within)
 * @returns Resolved path or throws error
 * @throws Error if path is invalid or traversal attempt
 * 
 * @example
 * const resolved = resolveAndValidatePath('../test.txt', '/workspace');
 * // Throws: Path traversal rejected: ../test.txt
 */
export function resolveAndValidatePath(
  filePath: string,
  workspaceDir: string
): string {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');

  // SECURITY: Block path traversal attempts
  if (normalized.includes('..') || normalized.includes('\0')) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }

  // Resolve absolute paths
  if (filePath.startsWith('/')) {
    const resolved = resolve(filePath);

    // SECURITY: Ensure path stays within workspace
    const rel = relative(workspaceDir, resolved);
    if (
      rel.startsWith('..') ||
      resolved === '..' ||
      resolve(workspaceDir, rel) !== resolved
    ) {
      throw new Error(`Path traversal rejected: ${filePath}`);
    }

    return resolved;
  }

  // Resolve relative paths
  const resolved = resolve(workspaceDir, filePath);

  // SECURITY: Double-check path is within workspace
  const rel = relative(workspaceDir, resolved);
  if (
    rel.startsWith('..') ||
    resolved === '..' ||
    resolve(workspaceDir, rel) !== resolved
  ) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }

  return resolved;
}

/**
 * Sanitize command for safe execution
 * 
 * This escapes special characters to prevent shell injection.
 * Use with caution - validation is preferred over sanitization.
 * 
 * @param command - Command to sanitize
 * @returns Sanitized command
 * 
 * @deprecated Use validateCommand() instead - sanitization can hide issues
 */
export function sanitizeCommand(command: string): string {
  // Escape single quotes
  return command.replace(/'/g, "'\\''");
}

/**
 * Security configuration for sandbox providers
 */
export interface SandboxSecurityConfig {
  /** Enable command validation (default: true) */
  enableCommandValidation?: boolean;
  /** Enable path validation (default: true) */
  enablePathValidation?: boolean;
  /** Enable file pattern blocking (default: true) */
  enableFileBlocking?: boolean;
  /** Additional blocked patterns */
  additionalBlockedPatterns?: RegExp[];
  /** Workspace directory */
  workspaceDir: string;
}

/**
 * Create security validator for sandbox provider
 * 
 * @param config - Security configuration
 * @returns Validator functions
 * 
 * @example
 * const security = createSandboxSecurity({ workspaceDir: '/workspace' });
 * 
 * // Validate before executing
 * const cmdValidation = security.validateCommand('rm -rf /');
 * if (!cmdValidation.valid) {
 *   throw new Error(cmdValidation.reason);
 * }
 */
export function createSandboxSecurity(config: SandboxSecurityConfig) {
  const {
    enableCommandValidation = true,
    enablePathValidation = true,
    enableFileBlocking = true,
    additionalBlockedPatterns = [],
    workspaceDir,
  } = config;

  // Add custom blocked patterns
  const allBlockedPatterns = [
    ...BLOCKED_COMMAND_PATTERNS,
    ...additionalBlockedPatterns,
  ];

  return {
    /**
     * Validate command
     */
    validateCommand(command: string) {
      if (!enableCommandValidation) {
        return { valid: true };
      }

      for (const pattern of allBlockedPatterns) {
        if (pattern.test(command)) {
          return {
            valid: false,
            reason: `Command blocked by security policy: ${command}`,
          };
        }
      }

      return { valid: true };
    },

    /**
     * Validate file path
     */
    validateFilePath(filePath: string) {
      if (!enablePathValidation && !enableFileBlocking) {
        return { valid: true };
      }

      return validateFilePath(filePath, workspaceDir);
    },

    /**
     * Resolve and validate path
     */
    resolvePath(filePath: string): string {
      return resolveAndValidatePath(filePath, workspaceDir);
    },
  };
}

/**
 * Default security configuration
 * 
 * Use this as a base for provider-specific configurations
 */
export const DEFAULT_SECURITY_CONFIG: SandboxSecurityConfig = {
  enableCommandValidation: true,
  enablePathValidation: true,
  enableFileBlocking: true,
  workspaceDir: '/workspace',
};

// ============================================================================
// Desktop Security Policy Engine
//
// Configurable security policies for desktop mode execution.
// Unlike cloud sandboxes, desktop mode is intentionally less restrictive
// since users have full control over their local machine.
// ============================================================================

const desktopLog = createLogger('DesktopSecurityPolicy');

export interface SecurityPolicyConfig {
  /** Blocked command patterns (regex strings) */
  blockedPatterns: string[];
  /** Blocked exact commands */
  blockedCommands: string[];
  /** Allowed base directories for file operations */
  allowedDirectories: string[];
  /** Maximum command execution time in seconds */
  maxExecutionTime: number;
  /** Require approval for commands matching these patterns */
  approvalRequiredPatterns: string[];
  /** Enable command audit logging */
  auditEnabled: boolean;
  /** Block network-affecting commands */
  blockNetworkCommands: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CommandAnalysis {
  allowed: boolean;
  riskLevel: RiskLevel;
  reason?: string;
  requiresApproval: boolean;
  matchedRule?: string;
}

export interface AuditLogEntry {
  timestamp: string;
  command: string;
  riskLevel: RiskLevel;
  allowed: boolean;
  requiresApproval: boolean;
  approved?: boolean;
  userFeedback?: string;
  workingDirectory: string;
}

export const DEFAULT_DESKTOP_POLICY: SecurityPolicyConfig = {
  blockedPatterns: [
    'rm\\s+-rf\\s+/$(?!\\w)',
    'rm\\s+-rf\\s+/\\s',
    'mkfs\\.',
    'dd\\s+if=.*of=/dev/',
    ':\\(\\){ :\\|:& };:',
    'curl\\s+.*\\|\\s*sh',
    'wget\\s+.*\\|\\s*sh',
    'sudo\\s+rm\\s+-rf',
    'sudo\\s+dd\\s+if=',
    'sudo\\s+mkfs',
    'chmod\\s+777\\s+/',
    'chown\\s+-R\\s+root:',
    '>\\s*/etc/passwd',
    '>\\s*/etc/shadow',
    '>\\s*/dev/sd',
  ],
  blockedCommands: [
    'mkfs', 'fdisk', 'parted', ':(){:|:&};:', 'fork',
    'shutdown', 'reboot', 'init 0', 'init 6',
  ],
  allowedDirectories: [],
  maxExecutionTime: 300,
  approvalRequiredPatterns: [
    'rm\\s+-rf', 'sudo', 'chmod\\s+777',
    'npm\\s+install\\s+-g', 'pip\\s+install\\s+--user',
    'curl.*\\|', 'wget.*\\|',
  ],
  auditEnabled: true,
  blockNetworkCommands: false,
};

class DesktopSecurityPolicy {
  private config: SecurityPolicyConfig;
  private auditLog: AuditLogEntry[] = [];
  private maxAuditEntries = 1000;

  constructor(config: Partial<SecurityPolicyConfig> = {}) {
    const validatedConfig = this.validateConfig(config);
    this.config = { ...DEFAULT_DESKTOP_POLICY, ...validatedConfig };
    desktopLog.info('DesktopSecurityPolicy initialized', { config: this.config });
  }

  private validateConfig(config: Partial<SecurityPolicyConfig>): Partial<SecurityPolicyConfig> {
    const validated: Partial<SecurityPolicyConfig> = { ...config };
    if (config.blockedPatterns) {
      validated.blockedPatterns = config.blockedPatterns.filter(p => { try { new RegExp(p, 'i'); return true; } catch { desktopLog.warn('Invalid regex in blockedPatterns', { pattern: p }); return false; } });
    }
    if (config.approvalRequiredPatterns) {
      validated.approvalRequiredPatterns = config.approvalRequiredPatterns.filter(p => { try { new RegExp(p, 'i'); return true; } catch { desktopLog.warn('Invalid regex in approvalRequiredPatterns', { pattern: p }); return false; } });
    }
    return validated;
  }

  analyzeCommand(command: string, workingDirectory?: string): CommandAnalysis {
    const trimmed = command.trim();
    const riskLevel = this.assessRisk(trimmed);
    const lowerTrimmed = trimmed.toLowerCase();
    const pathModule = require('node:path');
    const commandTokens = lowerTrimmed.split(/[\s;|&]+/).filter(Boolean).map((t: string) => pathModule.basename(t));

    for (const blocked of this.config.blockedCommands) {
      const blockedLower = blocked.toLowerCase();
      const isMultiWord = blockedLower.includes(' ');
      const isBlocked = isMultiWord ? lowerTrimmed.includes(blockedLower) : commandTokens.includes(blockedLower);
      if (isBlocked) {
        this.logAudit({ command: trimmed, riskLevel, allowed: false, requiresApproval: false, workingDirectory: workingDirectory || '' });
        return { allowed: false, riskLevel, reason: `Command '${blocked}' is explicitly blocked`, requiresApproval: false, matchedRule: `blockedCommand:${blocked}` };
      }
    }

    for (const pattern of this.config.blockedPatterns) {
      try { if (new RegExp(pattern, 'i').test(trimmed)) { this.logAudit({ command: trimmed, riskLevel, allowed: false, requiresApproval: false, workingDirectory: workingDirectory || '' }); return { allowed: false, riskLevel, reason: `Matches blocked pattern`, requiresApproval: false, matchedRule: `blockedPattern:${pattern}` }; } } catch { /* skip */ }
    }

    if (this.config.blockNetworkCommands) {
      const netCmds = ['curl', 'wget', 'ssh', 'scp', 'sftp', 'nc', 'netcat', 'telnet', 'ftp', 'nmap'];
      const blocked = commandTokens.find(t => netCmds.includes(t));
      if (blocked) { this.logAudit({ command: trimmed, riskLevel: 'high', allowed: false, requiresApproval: false, workingDirectory: workingDirectory || '' }); return { allowed: false, riskLevel: 'high', reason: `Network command '${blocked}' blocked`, requiresApproval: false, matchedRule: `blockNetworkCommand:${blocked}` }; }
    }

    let requiresApproval = false;
    let matchedApprovalRule: string | undefined;
    for (const pattern of this.config.approvalRequiredPatterns) {
      try { if (new RegExp(pattern, 'i').test(trimmed)) { requiresApproval = true; matchedApprovalRule = pattern; break; } } catch { /* skip */ }
    }

    this.logAudit({ command: trimmed, riskLevel, allowed: true, requiresApproval, workingDirectory: workingDirectory || '' });
    return { allowed: true, riskLevel, requiresApproval, matchedRule: matchedApprovalRule };
  }

  private assessRisk(command: string): RiskLevel {
    const lower = command.toLowerCase();
    if (/rm\s+-rf\s+\/($|\s)/.test(lower) || /mkfs/.test(lower) || /dd\s+if=.*of=\/dev/.test(lower) || /:\(\){ :\|:& };:/.test(lower)) return 'critical';
    if (/sudo\s+rm/.test(lower) || /sudo\s+dd/.test(lower) || />\s*\/dev\//.test(lower) || /chmod\s+777\s+\//.test(lower)) return 'high';
    if (/rm\s+-rf/.test(lower) || /sudo/.test(lower) || /npm\s+install\s+-g/.test(lower) || /pip\s+install/.test(lower) || /curl.*\|/.test(lower) || /wget.*\|/.test(lower)) return 'medium';
    return 'low';
  }

  private logAudit(entry: AuditLogEntry): void {
    entry.timestamp = new Date().toISOString();
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    if (this.config.auditEnabled) desktopLog.debug('Command audit', entry);
  }

  getAuditLog(limit?: number): AuditLogEntry[] { return limit ? this.auditLog.slice(-limit) : [...this.auditLog]; }
  clearAuditLog(): void { this.auditLog = []; }
  updateConfig(newConfig: Partial<SecurityPolicyConfig>): void { this.config = { ...this.config, ...this.validateConfig(newConfig) }; }
  getConfig(): SecurityPolicyConfig { return { ...this.config }; }
}

export const desktopSecurityPolicy = new DesktopSecurityPolicy();

export function analyzeDesktopCommand(command: string, workingDirectory?: string, customPolicy?: DesktopSecurityPolicy): CommandAnalysis {
  return (customPolicy || desktopSecurityPolicy).analyzeCommand(command, workingDirectory);
}

export function getRiskLevelDisplay(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'critical': return 'CRITICAL - Blocked';
    case 'high': return 'HIGH - Requires Approval';
    case 'medium': return 'MEDIUM - May Require Approval';
    case 'low': return 'LOW - Safe to Execute';
    default: return 'UNKNOWN';
  }
}
