/**
 * Mastra Verification Module
 * 
 * Provides code verification and security checking functions.
 */

export interface VerificationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  score?: number;
}

export interface CodeQualityResult {
  score: number;
  issues: string[];
  suggestions: string[];
}

/**
 * Verify changes in files
 */
export async function verifyChanges(files: Record<string, string>): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  for (const [path, content] of Object.entries(files)) {
    if (!content || content.trim() === '') {
      warnings.push(`File ${path} is empty`);
    }
    
    if (path.endsWith('.ts') || path.endsWith('.js')) {
      if (content.includes('any') && !content.includes(': any')) {
        warnings.push(`File ${path} may have type issues`);
      }
    }
  }
  
  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Run code quality checks
 */
export async function runCodeQuality(code: string): Promise<CodeQualityResult> {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  let score = 100;
  
  if (code.length < 10) {
    issues.push('Code is too short');
    score -= 20;
  }
  
  if (!code.includes('return') && !code.includes(';')) {
    suggestions.push('Consider adding return statements');
  }
  
  if (code.includes('any')) {
    issues.push('Avoid using "any" type');
    score -= 10;
  }
  
  if (!code.includes('//') && !code.includes('/*')) {
    suggestions.push('Consider adding comments for clarity');
  }
  
  return {
    score: Math.max(0, score),
    issues,
    suggestions,
  };
}

/**
 * Check code for security issues
 */
export async function checkSecurity(code: string): Promise<{
  issues: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}> {
  const issues: string[] = [];
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  
  const dangerousPatterns = [
    { pattern: /eval\s*\(/, issue: 'Avoid using eval()', severity: 'critical' as const },
    { pattern: /innerHTML\s*=/, issue: 'Avoid innerHTML - use textContent instead', severity: 'high' as const },
    { pattern: /dangerouslySetInnerHTML/, issue: 'Be careful with dangerouslySetInnerHTML', severity: 'high' as const },
    { pattern: /\bshell\s*\(/, issue: 'Avoid shell execution', severity: 'critical' as const },
    { pattern: /exec\s*\(/, issue: 'Avoid exec()', severity: 'critical' as const },
    { pattern: /process\.env/, issue: 'Be careful with process.env', severity: 'medium' as const },
  ];
  
  for (const { pattern, issue, severity: sev } of dangerousPatterns) {
    if (pattern.test(code)) {
      issues.push(issue);
      if (sev === 'critical') severity = 'critical';
      else if (sev === 'high' && severity !== 'critical') severity = 'high';
      else if (sev === 'medium' && severity === 'low') severity = 'medium';
    }
  }
  
  return { issues, severity };
}
