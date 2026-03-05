/**
 * Mistral Code Validator
 *
 * Validates code for safety before execution.
 * Detects dangerous patterns and provides language-specific validation.
 */

import type { CodeLanguage } from '../mistral-types';

export interface ValidationResult {
  safe: boolean;
  reason?: string;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
}

export interface ValidationRule {
  name: string;
  pattern: RegExp;
  severity: 'error' | 'warning';
  message: string;
  languages?: CodeLanguage[];
}

export class CodeValidator {
  private rules: Map<string, ValidationRule> = new Map();
  private allowedLanguages: Set<CodeLanguage> = new Set([
    'python',
    'python3',
    'javascript',
    'typescript',
    'bash',
    'shell',
  ]);

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Initialize default validation rules
   */
  private initializeDefaultRules(): void {
    // Dangerous system commands
    this.addRule({
      name: 'dangerous-system-command',
      pattern: /rm\s+-rf\s+\//i,
      severity: 'error',
      message: 'Dangerous: Recursive delete from root directory',
    });

    this.addRule({
      name: 'filesystem-format',
      pattern: /mkfs\./i,
      severity: 'error',
      message: 'Dangerous: Filesystem formatting command',
    });

    this.addRule({
      name: 'disk-write',
      pattern: /dd\s+if=.*of=\/dev/i,
      severity: 'error',
      message: 'Dangerous: Direct disk write',
    });

    this.addRule({
      name: 'fork-bomb',
      pattern: /:\(\)\{\s*:\|:\s*&\s*\}\s*:/i,
      severity: 'error',
      message: 'Dangerous: Fork bomb detected',
    });

    this.addRule({
      name: 'chmod-all',
      pattern: /chmod\s+-R\s+777\s+\//i,
      severity: 'error',
      message: 'Dangerous: Recursive chmod 777 on root',
    });

    this.addRule({
      name: 'pipe-to-shell',
      pattern: /(wget|curl).*\|\s*(sh|bash)/i,
      severity: 'error',
      message: 'Dangerous: Piping remote script to shell',
    });

    // Python-specific rules
    this.addRule({
      name: 'python-os-system',
      pattern: /os\.system\s*\(/i,
      severity: 'warning',
      message: 'Warning: os.system() can execute arbitrary shell commands',
      languages: ['python', 'python3'],
    });

    this.addRule({
      name: 'python-subprocess',
      pattern: /subprocess\.(call|Popen|run)\s*\(/i,
      severity: 'warning',
      message: 'Warning: subprocess can execute arbitrary shell commands',
      languages: ['python', 'python3'],
    });

    this.addRule({
      name: 'python-eval',
      pattern: /\beval\s*\(/i,
      severity: 'warning',
      message: 'Warning: eval() can execute arbitrary code',
      languages: ['python', 'python3'],
    });

    this.addRule({
      name: 'python-exec',
      pattern: /\bexec\s*\(/i,
      severity: 'warning',
      message: 'Warning: exec() can execute arbitrary code',
      languages: ['python', 'python3'],
    });

    // JavaScript-specific rules
    this.addRule({
      name: 'js-eval',
      pattern: /\beval\s*\(/i,
      severity: 'warning',
      message: 'Warning: eval() can execute arbitrary code',
      languages: ['javascript', 'typescript'],
    });

    this.addRule({
      name: 'js-function-constructor',
      pattern: /\bFunction\s*\(/i,
      severity: 'warning',
      message: 'Warning: Function constructor can execute arbitrary code',
      languages: ['javascript', 'typescript'],
    });

    this.addRule({
      name: 'js-dynamic-require',
      pattern: /require\s*\(\s*[^'"]/i,
      severity: 'warning',
      message: 'Warning: Dynamic require path detected',
      languages: ['javascript', 'typescript'],
    });

    this.addRule({
      name: 'js-vm-module',
      pattern: /vm\.runInContext/i,
      severity: 'warning',
      message: 'Warning: Node.js vm module can execute arbitrary code',
      languages: ['javascript', 'typescript'],
    });

    // Bash-specific rules
    this.addRule({
      name: 'bash-curl-bash',
      pattern: /curl.*\|\s*bash/i,
      severity: 'error',
      message: 'Dangerous: Piping curl output to bash',
      languages: ['bash', 'shell'],
    });

    this.addRule({
      name: 'bash-wget-bash',
      pattern: /wget.*\|\s*bash/i,
      severity: 'error',
      message: 'Dangerous: Piping wget output to bash',
      languages: ['bash', 'shell'],
    });
  }

  /**
   * Add a validation rule
   */
  addRule(rule: ValidationRule): void {
    this.rules.set(rule.name, rule);
  }

  /**
   * Remove a validation rule
   */
  removeRule(name: string): void {
    this.rules.delete(name);
  }

  /**
   * Validate code for safety
   */
  async validate(
    code: string,
    language: CodeLanguage
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check if language is supported
    if (!this.allowedLanguages.has(language)) {
      errors.push(`Unsupported language: ${language}`);
    }

    // Check against all rules
    for (const rule of this.rules.values()) {
      // Skip language-specific rules
      if (rule.languages && !rule.languages.includes(language)) {
        continue;
      }

      if (rule.pattern.test(code)) {
        const message = `${rule.name}: ${rule.message}`;
        if (rule.severity === 'error') {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }

    // Language-specific validation
    if (language === 'python' || language === 'python3') {
      const pythonValidation = this.validatePython(code);
      errors.push(...pythonValidation.errors);
      warnings.push(...pythonValidation.warnings);
      suggestions.push(...pythonValidation.suggestions || []);
    } else if (language === 'javascript' || language === 'typescript') {
      const jsValidation = this.validateJavaScript(code);
      errors.push(...jsValidation.errors);
      warnings.push(...jsValidation.warnings);
      suggestions.push(...jsValidation.suggestions || []);
    } else if (language === 'bash' || language === 'shell') {
      const bashValidation = this.validateBash(code);
      errors.push(...bashValidation.errors);
      warnings.push(...bashValidation.warnings);
      suggestions.push(...bashValidation.suggestions || []);
    }

    return {
      safe: errors.length === 0,
      reason: errors.length > 0 ? errors.join('; ') : undefined,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Python-specific validation
   */
  private validatePython(code: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check for import statements
    const dangerousImports = [
      'os',
      'sys',
      'subprocess',
      'ctypes',
      'pickle',
      'marshal',
    ];

    for (const imp of dangerousImports) {
      if (new RegExp(`\\bimport\\s+${imp}\\b`).test(code)) {
        warnings.push(`Import of '${imp}' module detected`);
      }
    }

    // Check for file operations
    if (/\bopen\s*\([^)]*['"]\/etc\//.test(code)) {
      errors.push('Attempt to read system files in /etc/');
    }

    if (/\bopen\s*\([^)]*['"]\/proc\//.test(code)) {
      errors.push('Attempt to access /proc/ filesystem');
    }

    // Check for network operations
    if (/\b(socket|urllib|requests|http)\./.test(code)) {
      suggestions.push('Consider if network access is necessary');
    }

    // Suggest using safer alternatives
    if (/\beval\s*\(/.test(code) || /\bexec\s*\(/.test(code)) {
      suggestions.push(
        'Consider using ast.literal_eval() for safe evaluation of literals'
      );
    }

    return { errors, warnings, suggestions };
  }

  /**
   * JavaScript-specific validation
   */
  private validateJavaScript(code: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check for require statements
    const dangerousRequires = [
      'child_process',
      'fs',
      'net',
      'dgram',
      'crypto',
    ];

    for (const req of dangerousRequires) {
      if (new RegExp(`require\\s*\\(\\s*['"]${req}['"]\\s*\\)`).test(code)) {
        warnings.push(`Require of '${req}' module detected`);
      }
    }

    // Check for file operations
    if (/fs\.(read|write)File\s*\([^)]*['"]\/etc\//.test(code)) {
      errors.push('Attempt to read/write system files in /etc/');
    }

    // Check for child process execution
    if (/child_process\.(exec|spawn|fork)/.test(code)) {
      warnings.push('Child process execution detected');
      suggestions.push('Ensure all inputs are properly sanitized');
    }

    // Check for eval with user input
    if (/eval\s*\(\s*(process\.env|req\.|args)/.test(code)) {
      errors.push('eval() with user input detected - critical security risk');
    }

    return { errors, warnings, suggestions };
  }

  /**
   * Bash-specific validation
   */
  private validateBash(code: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check for sudo usage
    if (/^\s*sudo\s+/m.test(code)) {
      warnings.push('sudo usage detected');
      suggestions.push('Ensure sudo commands are necessary and safe');
    }

    // Check for environment variable exposure
    if (/\becho\s+\$[^{]/.test(code)) {
      suggestions.push('Avoid echoing sensitive environment variables');
    }

    // Check for command substitution with user input
    if (/\$\([^)]*\$[^)]*\)/.test(code)) {
      warnings.push('Nested command substitution detected');
    }

    // Check for unsafe variable expansion
    if (/\$\{[^}]*:-[^}]*\}/.test(code)) {
      suggestions.push('Use quoted variable expansions to prevent word splitting');
    }

    return { errors, warnings, suggestions };
  }

  /**
   * Validate code with auto-fix suggestions
   */
  async validateWithAutoFix(
    code: string,
    language: CodeLanguage
  ): Promise<{
    result: ValidationResult;
    fixedCode?: string;
  }> {
    const result = await this.validate(code, language);

    if (!result.safe) {
      return { result };
    }

    // Apply auto-fixes for warnings
    let fixedCode = code;

    // Fix common issues
    if (language === 'python' || language === 'python3') {
      // Replace eval with ast.literal_eval where possible
      fixedCode = fixedCode.replace(
        /\beval\s*\(\s*(['"])(.*?)\1\s*\)/g,
        "ast.literal_eval($1$2$1)"
      );
    }

    if (fixedCode !== code) {
      result.suggestions = [
        ...(result.suggestions || []),
        'Auto-fixes applied',
      ];
    }

    return { result, fixedCode: fixedCode !== code ? fixedCode : undefined };
  }

  /**
   * Get all validation rules
   */
  getRules(): ValidationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Check if a specific rule exists
   */
  hasRule(name: string): boolean {
    return this.rules.has(name);
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(name: string, enabled: boolean): void {
    const rule = this.rules.get(name);
    if (rule) {
      if (!enabled) {
        this.rules.delete(name);
      }
    } else if (enabled) {
      // Re-add default rule if disabled
      this.initializeDefaultRules();
    }
  }
}

export const codeValidator = new CodeValidator();
