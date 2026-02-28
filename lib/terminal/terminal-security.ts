/**
 * Terminal Security Module
 * First line of defense against malicious commands in local shell simulation
 * 
 * Note: These blocks are NOT foolproof - a sophisticated attacker can bypass them.
 * The real security comes from OS-level isolation (E2B, Firecracker, etc.)
 * This is just a UX layer to discourage and detect obviously malicious behavior.
 */

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  blockedPattern?: string;
}

/**
 * Patterns that indicate potentially dangerous operations
 */
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface DangerPattern {
  pattern: RegExp;
  reason: string;
  severity: Severity;
}

const DANGEROUS_PATTERNS: DangerPattern[] = [
  // File destruction
  { pattern: /rm\s+-rf\s+\//, reason: 'Attempt to delete root filesystem', severity: 'critical' },
  { pattern: /rm\s+-rf\s+\s*\*|rm\s+-rf\s+\./, reason: 'Recursive delete pattern', severity: 'high' },
  { pattern: /del\s+\/[sfq]\s+\//i, reason: 'Windows delete system files', severity: 'critical' },
  { pattern: /format\s+[a-z]:/i, reason: 'Drive format attempt', severity: 'critical' },
  
  // System compromise
  { pattern: /chmod\s+777\s+/, reason: 'Overly permissive file permissions', severity: 'medium' },
  { pattern: /chown\s+root:/, reason: 'Ownership change to root', severity: 'high' },
  { pattern: /sudo\s+/, reason: 'Privilege escalation attempt', severity: 'high' },
  { pattern: /su\s+-|su\s+root/, reason: 'Switch to root user', severity: 'high' },
  
  // Network exfiltration
  { pattern: /nc\s+-[elvp]/, reason: 'Netcat with execute/listen mode', severity: 'critical' },
  { pattern: /ncat\s+-[el]/, reason: 'Ncat network tool', severity: 'critical' },
  { pattern: /\/dev\/tcp\//, reason: 'Raw TCP device access', severity: 'critical' },
  { pattern: /curl.+(http|https).+--data|curl.+\|/, reason: 'Data exfiltration via curl', severity: 'critical' },
  { pattern: /wget.+(http|https).+--post-data/, reason: 'Data exfiltration via wget', severity: 'critical' },
  
  // Credentials theft
  { pattern: /cat\s+\/etc\/passwd/, reason: 'Reading password file', severity: 'high' },
  { pattern: /cat\s+\/etc\/shadow/, reason: 'Reading shadow passwords', severity: 'critical' },
  { pattern: /\.ssh\/id_rsa|\.ssh\/id_ed25519/, reason: 'SSH key access', severity: 'critical' },
  { pattern: /printenv|env\s*$/, reason: 'Environment variable dump', severity: 'medium' },
  { pattern: /history\s*$|!\d+/, reason: 'Shell history access', severity: 'medium' },
  
  // Persistence
  { pattern: /crontab\s+-r|cron\s+delete/, reason: 'Delete scheduled tasks', severity: 'high' },
  { pattern: /systemctl\s+disable|systemctl\s+stop/, reason: 'Disable system services', severity: 'high' },
  { pattern: /launchctl\s+unload/, reason: 'Unload macOS launchd', severity: 'high' },
  
  // Shell escapes
  { pattern: /vim\s+-[cxe!]|vi\s+-[cxe!]/, reason: 'Vim shell escape', severity: 'high' },
  { pattern: /less\s+!/, reason: 'Less shell escape', severity: 'high' },
  { pattern: /awk\s+'system|awk\s+'\!/, reason: 'Awk shell execution', severity: 'high' },
  { pattern: /sed\s+-n\s+['"]p.*e|sed\s+'.*\/bin\//, reason: 'Sed shell execution', severity: 'high' },
  { pattern: /find\s+.*-exec\s+;|find\s+.*\{\}/, reason: 'Find with exec', severity: 'medium' },
  
  // Process manipulation
  { pattern: /kill\s+-9\s+1|kill\s+-9\s+0/, reason: 'Kill init/system processes', severity: 'critical' },
  { pattern: /killall\s+-9/, reason: 'Kill all processes', severity: 'high' },
  { pattern: /pkill\s+-9/, reason: 'Force kill by name', severity: 'high' },
  
  // Downloading/executing malicious code
  { pattern: /curl.+\|bash|curl.+\|sh/, reason: 'Download and execute', severity: 'critical' },
  { pattern: /wget.+\|bash|wget.+\|sh/, reason: 'Download and execute', severity: 'critical' },
  { pattern: /python.*http.*\|/i, reason: 'Python piped execution', severity: 'critical' },
  { pattern: /bash\s+<.*http|sh\s+<.*http/, reason: 'Shell redirect from network', severity: 'critical' },
];

/**
 * Python-specific dangerous patterns for simulated Python execution
 */
const PYTHON_DANGEROUS_PATTERNS: DangerPattern[] = [
  // Code execution
  { pattern: /\beval\s*\(/, reason: 'eval() allows arbitrary code execution', severity: 'critical' },
  { pattern: /\bexec\s*\(/, reason: 'exec() allows arbitrary code execution', severity: 'critical' },
  { pattern: /\bcompile\s*\(/, reason: 'compile() can create executable code', severity: 'high' },
  { pattern: /\binput\s*\(/, reason: 'input() can execute code in Python 2', severity: 'high' },
  
  // OS access
  { pattern: /import\s+os|from\s+os\s+import/, reason: 'OS module access', severity: 'medium' },
  { pattern: /import\s+subprocess|from\s+subprocess\s+import/, reason: 'Subprocess module', severity: 'medium' },
  { pattern: /import\s+pty|from\s+pty\s+import/, reason: 'PTY module for pseudo-terminals', severity: 'high' },
  { pattern: /import\s+sys|from\s+sys\s+import/, reason: 'System module access', severity: 'medium' },
  { pattern: /__import__\s*\(\s*['"]os['"]\)/, reason: 'Dynamic os import', severity: 'high' },
  
  // Environment/secrets
  { pattern: /os\.environ|os\.getenv|os\.environ\.get/, reason: 'Environment variable access', severity: 'medium' },
  { pattern: /getattr\s*\(\s*os\s*,/, reason: 'os attribute access via getattr', severity: 'high' },
  
  // File access
  { pattern: /open\s*\([^)]+\s*\)|with\s+open\s*\(/, reason: 'File read/write', severity: 'medium' },
  { pattern: /import\s+pathlib|from\s+pathlib\s+import/, reason: 'Path manipulation', severity: 'medium' },
  { pattern: /import\s+shutil|from\s+shutil\s+import/, reason: 'File operations utility', severity: 'medium' },
  
  // Networking
  { pattern: /import\s+socket|from\s+socket\s+import/, reason: 'Network socket access', severity: 'medium' },
  { pattern: /import\s+urllib|from\s+urllib\s+import/, reason: 'URL/ network access', severity: 'medium' },
  { pattern: /import\s+requests|from\s+requests\s+import/, reason: 'HTTP library', severity: 'medium' },
  { pattern: /import\s+http|from\s+http\s+import/, reason: 'HTTP server access', severity: 'medium' },
  
  // Introspection/escape
  { pattern: /__builtins__|__globals__|__locals__/, reason: 'Python introspection', severity: 'high' },
  { pattern: /__class__|__base__|__subclasses__/, reason: 'Python class introspection', severity: 'high' },
  { pattern: /getattr\s*\(\s*__/, reason: 'Getattr on dunder methods', severity: 'high' },
  { pattern: /\[\s*140\s*\]/, reason: 'Common sandbox escape offset', severity: 'critical' },
];

/**
 * Check if a command contains dangerous patterns
 */
export function checkCommandSecurity(command: string): SecurityCheckResult {
  const trimmed = command.trim().toLowerCase();
  
  // Check bash/dangerous patterns
  for (const { pattern, reason, severity } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason,
        severity,
        blockedPattern: pattern.source,
      };
    }
  }
  
  // Check Python-specific patterns
  for (const { pattern, reason, severity } of PYTHON_DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason,
        severity,
        blockedPattern: pattern.source,
      };
    }
  }
  
  return { allowed: true, severity: 'low' };
}

/**
 * Obfuscation detection - patterns that suggest attempt to bypass blocks
 */
const OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\+\s*['"][a-z]['"]\s*\+/, name: 'String concatenation' },
  { pattern: /\.\s*join\s*\(/, name: 'String join' },
  { pattern: /base64\.b64decode|atob\s*\(/, name: 'Base64 decoding' },
  { pattern: /chr\s*\(\s*\d+\s*\)/, name: 'Character code obfuscation' },
  { pattern: /getattr\s*\(\s*__builtins__/, name: 'Builtin access' },
  { pattern: /__import__\s*\(/, name: 'Dynamic import' },
];

/**
 * Check for obfuscation patterns that might indicate bypass attempts
 */
export function detectObfuscation(command: string): { detected: boolean; patterns: string[] } {
  const found: string[] = [];
  
  for (const { pattern, name } of OBFUSCATION_PATTERNS) {
    if (pattern.test(command)) {
      found.push(name);
    }
  }
  
  return {
    detected: found.length > 0,
    patterns: found,
  };
}

/**
 * Get severity color for terminal output
 */
export function getSeverityColor(severity: SecurityCheckResult['severity']): string {
  switch (severity) {
    case 'critical':
      return '\x1b[31m'; // Red
    case 'high':
      return '\x1b[33m'; // Yellow
    case 'medium':
      return '\x1b[35m'; // Magenta
    case 'low':
      return '\x1b[36m'; // Cyan
    default:
      return '\x1b[0m'; // Reset
  }
}

/**
 * Format security warning for terminal display
 */
export function formatSecurityWarning(result: SecurityCheckResult): string {
  const color = getSeverityColor(result.severity);
  const reset = '\x1b[0m';
  const severity = result.severity || 'medium';
  
  return `${color}⚠️ Security Block${reset}\n` +
    `${color}Blocked:${reset} ${result.reason}\n` +
    `${color}Severity:${reset} ${severity.toUpperCase()}\n\n` +
    `${color}Note:${reset} This command was blocked by the local shell security layer.\n` +
    `For full terminal access, use the sandbox terminal (type "connect").`;
}

/**
 * Security configuration options
 */
export interface SecurityConfig {
  enableObfuscationDetection: boolean;
  blockOnObfuscation: boolean;
  logBlockedCommands: boolean;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enableObfuscationDetection: true,
  blockOnObfuscation: false, // Don't block by default - just warn
  logBlockedCommands: true,
};
