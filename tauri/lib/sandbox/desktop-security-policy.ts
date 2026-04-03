/**
 * Desktop Security Policy Engine
 *
 * Configurable security policies for desktop mode execution.
 * Unlike cloud sandboxes, desktop mode is intentionally less restrictive
 * since users have full control over their local machine.
 *
 * Features:
 * - Blocked command patterns (regex)
 * - Allowed directory restrictions
 * - Approval requirements for risky operations
 * - Command audit logging
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('DesktopSecurityPolicy');

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

// Default security policy for desktop mode
export const DEFAULT_DESKTOP_POLICY: SecurityPolicyConfig = {
  blockedPatterns: [
    // Destructive filesystem operations
    'rm\\s+-rf\\s+/$(?!\\w)',           // rm -rf / (root)
    'rm\\s+-rf\\s+/\\s',                // rm -rf / (with space)
    'mkfs\\.',                          // format filesystem
    'dd\\s+if=.*of=/dev/',              // dd to device
    ':\\(\\){ :\\|:& };:',              // fork bomb
    'curl\\s+.*\\|\\s*sh',              // curl | sh
    'wget\\s+.*\\|\\s*sh',              // wget | sh
    // Privilege escalation
    'sudo\\s+rm\\s+-rf',
    'sudo\\s+dd\\s+if=',
    'sudo\\s+mkfs',
    // System modification
    'chmod\\s+777\\s+/',
    'chown\\s+-R\\s+root:',
    // Data destruction
    '>\\s*/etc/passwd',
    '>\\s*/etc/shadow',
    '>\\s*/dev/sd',
  ],
  blockedCommands: [
    'mkfs',
    'fdisk',
    'parted',
    ':(){:|:&};:',
    'fork',
    'shutdown',
    'reboot',
    'init 0',
    'init 6',
  ],
  allowedDirectories: [], // Empty means no restriction (full access)
  maxExecutionTime: 300, // 5 minutes
  approvalRequiredPatterns: [
    'rm\\s+-rf',
    'sudo',
    'chmod\\s+777',
    'npm\\s+install\\s+-g',
    'pip\\s+install\\s+--user',
    'curl.*\\|',
    'wget.*\\|',
  ],
  auditEnabled: true,
  blockNetworkCommands: false, // Allow network commands in desktop mode
};

class DesktopSecurityPolicy {
  private config: SecurityPolicyConfig;
  private auditLog: AuditLogEntry[] = [];
  private maxAuditEntries = 1000;

  constructor(config: Partial<SecurityPolicyConfig> = {}) {
    // FIX: Validate regex patterns at config time and filter out invalid ones
    const validatedConfig = this.validateConfig(config);
    this.config = { ...DEFAULT_DESKTOP_POLICY, ...validatedConfig };
    log.info('DesktopSecurityPolicy initialized', { config: this.config });
  }

  /**
   * Validate config and filter out invalid regex patterns
   */
  private validateConfig(config: Partial<SecurityPolicyConfig>): Partial<SecurityPolicyConfig> {
    const validated: Partial<SecurityPolicyConfig> = { ...config };
    
    // Validate blockedPatterns
    if (config.blockedPatterns) {
      validated.blockedPatterns = config.blockedPatterns.filter(pattern => {
        try {
          new RegExp(pattern, 'i');
          return true;
        } catch (e) {
          log.warn('Invalid regex pattern in blockedPatterns, removing', { pattern });
          return false;
        }
      });
    }
    
    // Validate approvalRequiredPatterns
    if (config.approvalRequiredPatterns) {
      validated.approvalRequiredPatterns = config.approvalRequiredPatterns.filter(pattern => {
        try {
          new RegExp(pattern, 'i');
          return true;
        } catch (e) {
          log.warn('Invalid regex pattern in approvalRequiredPatterns, removing', { pattern });
          return false;
        }
      });
    }
    
    return validated;
  }

  /**
   * Analyze a command and determine if it's allowed
   */
  analyzeCommand(command: string, workingDirectory?: string): CommandAnalysis {
    const trimmed = command.trim();
    const riskLevel = this.assessRisk(trimmed);

    // Parse command tokens with shell separators and compare each token's basename to blocked single-word commands
    const lowerTrimmed = trimmed.toLowerCase();
    const pathModule = require('node:path');
    const commandTokens = lowerTrimmed
      .split(/[\s;|&]+/)
      .filter(Boolean)
      .map((token: string) => pathModule.basename(token));

    // Check blocked commands with path-aware matching
    for (const blocked of this.config.blockedCommands) {
      const blockedLower = blocked.toLowerCase();
      // Multi-word commands check as substring anywhere, single-word commands check against token basenames
      const isMultiWord = blockedLower.includes(' ');
      const isBlocked = isMultiWord
        ? lowerTrimmed.includes(blockedLower)  // Contains multi-word command anywhere
        : commandTokens.includes(blockedLower); // Single word matches token basename

      if (isBlocked) {
        log.warn('Blocked command detected (path-aware match)', { command: trimmed, blocked });
        this.logAudit({
          command: trimmed,
          riskLevel,
          allowed: false,
          requiresApproval: false,
          workingDirectory: workingDirectory || '',
        });
        return {
          allowed: false,
          riskLevel,
          reason: `Command '${blocked}' is explicitly blocked`,
          requiresApproval: false,
          matchedRule: `blockedCommand:${blocked}`,
        };
      }
    }

    // Check blocked patterns (regex)
    for (const pattern of this.config.blockedPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(trimmed)) {
          log.warn('Blocked command detected (pattern match)', { command: trimmed, pattern });
          this.logAudit({
            command: trimmed,
            riskLevel,
            allowed: false,
            requiresApproval: false,
            workingDirectory: workingDirectory || '',
          });
          return {
            allowed: false,
            riskLevel,
            reason: `Command matches blocked pattern '${pattern}'`,
            requiresApproval: false,
            matchedRule: `blockedPattern:${pattern}`,
          };
        }
      } catch (e) {
        log.warn('Invalid regex pattern in blocked patterns', { pattern });
      }
    }

    // FIX: Implement blockNetworkCommands - block network-affecting commands if configured
    if (this.config.blockNetworkCommands) {
      const networkPatterns = [
        'curl',
        'wget',
        'ssh',
        'scp',
        'sftp',
        'nc ', // netcat
        'netcat',
        'telnet',
        'ftp',
        'nmap',
      ];
      
      // Use command-boundary regex matching instead of substring matching
      const networkCommandRegex = /(^|[\s;|&])(curl|wget|ssh|scp|sftp|nc|netcat|telnet|ftp|nmap)(?=$|[\s;|&])/i;
      const networkMatch = lowerTrimmed.match(networkCommandRegex);
      
      if (networkMatch) {
        const blockedCommand = networkMatch[2].toLowerCase();
        log.warn('Blocked network command (blockNetworkCommands enabled)', { command: trimmed, pattern: blockedCommand });
        this.logAudit({
          command: trimmed,
          riskLevel,
          allowed: false,
          requiresApproval: false,
          workingDirectory: workingDirectory || '',
        });
        return {
          allowed: false,
          riskLevel: 'high',
          reason: `Network command '${blockedCommand}' is blocked (blockNetworkCommands enabled)`,
          requiresApproval: false,
          matchedRule: `blockNetworkCommand:${blockedCommand}`,
        };
      }
    }

    // Check if approval is required
    let requiresApproval = false;
    let matchedApprovalRule: string | undefined;

    for (const pattern of this.config.approvalRequiredPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(trimmed)) {
          requiresApproval = true;
          matchedApprovalRule = pattern;
          break;
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    // Log the command
    this.logAudit({
      command: trimmed,
      riskLevel,
      allowed: true,
      requiresApproval,
      workingDirectory: workingDirectory || '',
    });

    return {
      allowed: true,
      riskLevel,
      requiresApproval,
      matchedRule: matchedApprovalRule,
    };
  }

  /**
   * Check if a path is within allowed directories
   * FIX: Use path.resolve to handle path traversal and symlinks
   */
  isPathAllowed(filePath: string): { allowed: boolean; reason?: string } {
    if (this.config.allowedDirectories.length === 0) {
      // No restrictions - allow all
      return { allowed: true };
    }

    // Use path.resolve to normalize and resolve the path with proper directory boundary
    const pathModule = require('node:path');
    const fs = require('node:fs');
    
    try {
      // Resolve to canonical path to handle .. and symlink traversal
      const resolvedPath = pathModule.resolve(filePath);
      let canonicalPath: string;
      try {
        // Try realpath first for existing files
        canonicalPath = fs.realpathSync(resolvedPath);
      } catch {
        // For non-existing paths, resolve parent and basename separately
        canonicalPath = pathModule.resolve(
          fs.realpathSync(pathModule.dirname(resolvedPath)),
          pathModule.basename(resolvedPath)
        );
      }
      
      for (const allowed of this.config.allowedDirectories) {
        // Canonicalize allowed directories too
        const canonicalAllowed = fs.realpathSync(pathModule.resolve(allowed));
        // Use path separator to ensure directory boundary - prevents sibling path bypass
        // e.g., /allowed must not match /allowed-file
        const normalizedResolvedPath = canonicalPath.replace(/\\/g, '/');
        const normalizedAllowed = canonicalAllowed.replace(/\\/g, '/');
        // Check that path starts with allowed dir AND is either exactly equal or has a separator after
        if (normalizedResolvedPath === normalizedAllowed || 
            normalizedResolvedPath.startsWith(normalizedAllowed + '/')) {
          return { allowed: true };
        }
      }
    } catch (e) {
      // If resolution fails, path is not valid
      return {
        allowed: false,
        reason: `Invalid path: ${filePath}`,
      };
    }

    return {
      allowed: false,
      reason: `Path '${filePath}' is not within allowed directories: ${this.config.allowedDirectories.join(', ')}`,
    };
  }

  /**
   * Assess the risk level of a command
   */
  private assessRisk(command: string): RiskLevel {
    const lower = command.toLowerCase();

    // Critical risk
    if (
      /rm\s+-rf\s+\/($|\s)/.test(lower) ||
      /mkfs/.test(lower) ||
      /dd\s+if=.*of=\/dev/.test(lower) ||
      /:\(\){ :\|:& };:/.test(lower)
    ) {
      return 'critical';
    }

    // High risk
    if (
      /sudo\s+rm/.test(lower) ||
      /sudo\s+dd/.test(lower) ||
      />\s*\/dev\//.test(lower) ||
      /chmod\s+777\s+\//.test(lower)
    ) {
      return 'high';
    }

    // Medium risk
    if (
      /rm\s+-rf/.test(lower) ||
      /sudo/.test(lower) ||
      /npm\s+install\s+-g/.test(lower) ||
      /pip\s+install/.test(lower) ||
      /curl.*\|/.test(lower) ||
      /wget.*\|/.test(lower)
    ) {
      return 'medium';
    }

    // Low risk - default for safe commands
    return 'low';
  }

  /**
   * Log command to audit trail
   */
  private logAudit(entry: AuditLogEntry): void {
    entry.timestamp = new Date().toISOString();
    this.auditLog.push(entry);

    // Trim old entries
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }

    if (this.config.auditEnabled) {
      log.debug('Command audit', entry);
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit?: number): AuditLogEntry[] {
    if (limit) {
      return this.auditLog.slice(-limit);
    }
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /**
   * Update policy configuration
   */
  updateConfig(newConfig: Partial<SecurityPolicyConfig>): void {
    const validatedConfig = this.validateConfig(newConfig);
    this.config = { ...this.config, ...validatedConfig };
    log.info('Security policy updated', { newConfig: validatedConfig });
  }

  /**
   * Get current configuration
   */
  getConfig(): SecurityPolicyConfig {
    return { ...this.config };
  }
}

// Export singleton instance with default config
export const desktopSecurityPolicy = new DesktopSecurityPolicy();

/**
 * Helper function to analyze a command quickly
 */
export function analyzeDesktopCommand(
  command: string,
  workingDirectory?: string,
  customPolicy?: DesktopSecurityPolicy
): CommandAnalysis {
  const policy = customPolicy || desktopSecurityPolicy;
  return policy.analyzeCommand(command, workingDirectory);
}

/**
 * Get risk level as a display-friendly string
 */
export function getRiskLevelDisplay(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'critical':
      return 'CRITICAL - Blocked';
    case 'high':
      return 'HIGH - Requires Approval';
    case 'medium':
      return 'MEDIUM - May Require Approval';
    case 'low':
      return 'LOW - Safe to Execute';
    default:
      return 'UNKNOWN';
  }
}