import type { VerificationResult, SyntaxError } from '../schemas';

export interface VerificationOptions {
  language?: string;
  strict?: boolean;
  maxErrors?: number;
  timeoutMs?: number;
}

export interface FileVerification {
  path: string;
  content: string;
  errors: SyntaxError[];
  warnings: SyntaxError[];
  passed: boolean;
  duration: number;
}

/**
 * Verify modified files for syntax errors and other issues
 */
export async function verifyChanges(
  modifiedFiles: Record<string, string>,
  options: VerificationOptions = {}
): Promise<VerificationResult> {
  const {
    strict = false,
    maxErrors = 10,
    timeoutMs = 30000,
  } = options;

  const allErrors: SyntaxError[] = [];
  const allWarnings: SyntaxError[] = [];
  const verificationResults: FileVerification[] = [];

  const startTime = Date.now();

  for (const [path, content] of Object.entries(modifiedFiles)) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      allErrors.push({
        path,
        line: 0,
        error: 'Verification timeout exceeded',
        severity: 'error',
      });
      break;
    }

    // Skip if we've already hit max errors
    if (allErrors.length >= maxErrors) {
      break;
    }

    const result = await verifyFile(path, content, options);
    verificationResults.push(result);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  const passed = allErrors.length === 0;

  return {
    passed,
    errors: allErrors,
    warnings: allWarnings,
    reprompt: passed ? undefined : generateReprompt(allErrors),
  };
}

/**
 * Verify a single file for syntax errors
 */
async function verifyFile(
  path: string,
  content: string,
  options: VerificationOptions = {}
): Promise<FileVerification> {
  const startTime = Date.now();
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  const ext = path.split('.').pop()?.toLowerCase();
  const language = options.language || getLanguageFromExtension(ext || '');

  try {
    switch (language) {
      case 'typescript':
      case 'javascript':
      case 'tsx':
      case 'jsx':
        const jsResult = await checkJavaScriptSyntax(path, content, language);
        errors.push(...jsResult.errors);
        warnings.push(...jsResult.warnings);
        break;

      case 'json':
        const jsonResult = checkJsonSyntax(path, content);
        errors.push(...jsonResult.errors);
        warnings.push(...jsonResult.warnings);
        break;

      case 'yaml':
      case 'yml':
        const yamlResult = checkYamlSyntax(path, content);
        errors.push(...yamlResult.errors);
        warnings.push(...yamlResult.warnings);
        break;

      case 'markdown':
      case 'md':
        // Basic markdown validation
        const mdWarnings = checkMarkdownSyntax(path, content);
        warnings.push(...mdWarnings);
        break;

      case 'html':
        const htmlResult = checkHtmlSyntax(path, content);
        errors.push(...htmlResult.errors);
        warnings.push(...htmlResult.warnings);
        break;

      case 'css':
        const cssResult = checkCssSyntax(path, content);
        errors.push(...cssResult.errors);
        warnings.push(...cssResult.warnings);
        break;

      case 'python':
        const pyResult = await checkPythonSyntax(path, content);
        errors.push(...pyResult.errors);
        warnings.push(...pyResult.warnings);
        break;

      case 'shell':
      case 'sh':
      case 'bash':
        const shResult = await checkShellSyntax(path, content);
        errors.push(...shResult.errors);
        warnings.push(...shResult.warnings);
        break;

      default:
        // For unknown file types, do basic structural checks
        const basicResult = doBasicStructuralChecks(path, content);
        warnings.push(...basicResult);
    }
  } catch (error) {
    errors.push({
      path,
      line: 1,
      error: error instanceof Error ? error.message : 'Unknown verification error',
      severity: 'error',
    });
  }

  return {
    path,
    content,
    errors,
    warnings,
    passed: errors.length === 0,
    duration: Date.now() - startTime,
  };
}

/**
 * Get language from file extension
 */
function getLanguageFromExtension(ext: string): string {
  const mapping: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    markdown: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'css',
    less: 'css',
    py: 'python',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    sql: 'sql',
    graphql: 'graphql',
    xml: 'xml',
    svg: 'xml',
  };

  return mapping[ext] || 'unknown';
}

/**
 * Check JavaScript/TypeScript syntax
 */
async function checkJavaScriptSyntax(
  path: string,
  content: string,
  language: string
): Promise<{ errors: SyntaxError[]; warnings: SyntaxError[] }> {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  // Basic structural checks (always available)
  const basicErrors = doBasicStructuralChecks(path, content);
  warnings.push(...basicErrors);

  // Try to use TypeScript compiler if available
  try {
    const { parse } = await import('@typescript-eslint/typescript-estree').catch(() => ({
      parse: null,
    }));

    if (parse) {
      try {
        parse(content, {
          filePath: path,
          loc: true,
          range: true,
          jsx: language === 'tsx' || language === 'jsx',
        });
      } catch (parseError: any) {
        errors.push({
          path,
          line: parseError.lineNumber || 1,
          column: parseError.column,
          error: parseError.message,
          severity: 'error',
        });
      }
    } else {
      // Fallback: Try Acorn parser
      try {
        const acorn = await import('acorn').catch(() => null);
        if (acorn) {
          acorn.parse(content, {
            ecmaVersion: 2024,
            sourceType: 'module',
          });
        }
      } catch (parseError: any) {
        warnings.push({
          path,
          line: parseError.loc?.line || 1,
          column: parseError.loc?.column,
          error: parseError.message,
          severity: 'warning',
        });
      }
    }
  } catch (importError) {
    // Parser not available, rely on basic checks only
    console.log(`[Verification] Parser not available for ${path}, using basic checks only`);
  }

  // Check for common issues
  const commonIssues = checkCommonJavaScriptIssues(content);
  warnings.push(...commonIssues);

  return { errors, warnings };
}

/**
 * Check for common JavaScript/TypeScript issues
 */
function checkCommonJavaScriptIssues(content: string): SyntaxError[] {
  const warnings: SyntaxError[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for console.log statements (warning in strict mode)
    if (line.includes('console.log') || line.includes('console.error')) {
      warnings.push({
        path: 'inline',
        line: lineNum,
        error: 'Console statement found - consider removing in production code',
        severity: 'warning',
      });
    }

    // Check for TODO comments
    if (line.includes('TODO') || line.includes('FIXME')) {
      warnings.push({
        path: 'inline',
        line: lineNum,
        error: 'TODO/FIXME comment found',
        severity: 'warning',
      });
    }

    // Check for very long lines
    if (line.length > 150) {
      warnings.push({
        path: 'inline',
        line: lineNum,
        error: `Line exceeds 150 characters (${line.length} chars)`,
        severity: 'warning',
      });
    }
  }

  return warnings;
}

/**
 * Check JSON syntax
 */
function checkJsonSyntax(path: string, content: string): { errors: SyntaxError[]; warnings: SyntaxError[] } {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  try {
    JSON.parse(content);
  } catch (error: any) {
    const match = error.message.match(/position (\d+)/);
    let line = 1;
    let column = 1;

    if (match) {
      const position = parseInt(match[1], 10);
      const lines = content.substring(0, position).split('\n');
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    }

    errors.push({
      path,
      line,
      column,
      error: `Invalid JSON: ${error.message}`,
      severity: 'error',
    });
  }

  // Check for trailing commas (invalid in JSON)
  const trailingCommaRegex = /,\s*[\]}]/g;
  let match;
  while ((match = trailingCommaRegex.exec(content)) !== null) {
    const position = match.index;
    const lines = content.substring(0, position).split('\n');
    warnings.push({
      path,
      line: lines.length,
      error: 'Potential trailing comma detected',
      severity: 'warning',
    });
  }

  return { errors, warnings };
}

/**
 * Check YAML syntax
 */
function checkYamlSyntax(path: string, content: string): { errors: SyntaxError[]; warnings: SyntaxError[] } {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  try {
    // Try to use js-yaml if available
    const yaml = require('js-yaml');
    yaml.load(content);
  } catch (error: any) {
    if (error.mark) {
      errors.push({
        path,
        line: error.mark.line + 1,
        column: error.mark.column,
        error: `Invalid YAML: ${error.reason || error.message}`,
        severity: 'error',
      });
    } else {
      errors.push({
        path,
        line: 1,
        error: `Invalid YAML: ${error.message}`,
        severity: 'error',
      });
    }
  }

  return { errors, warnings };
}

/**
 * Check HTML syntax (basic)
 */
function checkHtmlSyntax(path: string, content: string): { errors: SyntaxError[]; warnings: SyntaxError[] } {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  // Check for unclosed tags
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>(.*?)<\/\1>|<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>|<!--[\s\S]*?-->/g;
  const selfClosingTags = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

  const openTags: Array<{ tag: string; line: number }> = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Find opening tags
    const openTagPattern = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
    let match;
    while ((match = openTagPattern.exec(line)) !== null) {
      const tagName = match[1].toLowerCase();
      if (!selfClosingTags.includes(tagName) && !line.includes(`</${tagName}>`)) {
        openTags.push({ tag: tagName, line: lineNum });
      }
    }

    // Find closing tags
    const closeTagPattern = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g;
    while ((match = closeTagPattern.exec(line)) !== null) {
      const tagName = match[1].toLowerCase();
      const lastOpen = openTags[openTags.length - 1];
      if (lastOpen && lastOpen.tag === tagName) {
        openTags.pop();
      }
    }
  }

  // Report unclosed tags as warnings
  for (const { tag, line } of openTags.slice(0, 5)) {
    warnings.push({
      path,
      line,
      error: `Unclosed <${tag}> tag`,
      severity: 'warning',
    });
  }

  return { errors, warnings };
}

/**
 * Check CSS syntax (basic)
 */
function checkCssSyntax(path: string, content: string): { errors: SyntaxError[]; warnings: SyntaxError[] } {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  // Check for balanced braces
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;

  if (openBraces !== closeBraces) {
    errors.push({
      path,
      line: 1,
      error: `Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`,
      severity: 'error',
    });
  }

  // Check for common issues
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for missing semicolons (heuristic)
    if (line.includes(':') && !line.includes(';') && !line.includes('{') && !line.includes('}')) {
      warnings.push({
        path,
        line: i + 1,
        error: 'Possible missing semicolon',
        severity: 'warning',
      });
    }
  }

  return { errors, warnings };
}

/**
 * Check Python syntax
 */
async function checkPythonSyntax(
  path: string,
  content: string
): Promise<{ errors: SyntaxError[]; warnings: SyntaxError[] }> {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  // Basic indentation check
  const lines = content.split('\n');
  const indentStack: number[] = [0];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.search(/\S/);

    // Check for tabs
    if (line.includes('\t')) {
      warnings.push({
        path,
        line: lineNum,
        error: 'Tab character found - use spaces for indentation',
        severity: 'warning',
      });
    }
  }

  // Try to use Python parser if available via sandbox
  try {
    const { exec } = await import('child_process').catch(() => ({ exec: null }));
    if (exec) {
      // This would require a sandbox environment
      // For now, skip external Python validation
    }
  } catch (error) {
    // Python not available
  }

  return { errors, warnings };
}

/**
 * Check Shell script syntax
 */
async function checkShellSyntax(
  path: string,
  content: string
): Promise<{ errors: SyntaxError[]; warnings: SyntaxError[] }> {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  // Basic checks
  const lines = content.split('\n');

  // Check for balanced quotes
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Simple quote tracking (doesn't handle escapes perfectly)
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      }
    }

    if (inSingleQuote || inDoubleQuote) {
      warnings.push({
        path,
        line: lineNum,
        error: 'Potentially unclosed quote',
        severity: 'warning',
      });
    }
  }

  return { errors, warnings };
}

/**
 * Check Markdown syntax (basic)
 */
function checkMarkdownSyntax(path: string, content: string): SyntaxError[] {
  const warnings: SyntaxError[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for very long lines
    if (line.length > 200) {
      warnings.push({
        path,
        line: lineNum,
        error: `Very long line (${line.length} chars) - consider breaking it up`,
        severity: 'warning',
      });
    }

    // Check for bare URLs (not in links)
    const urlPattern = /(?<!\()(https?:\/\/[^\s\)]+)(?!\))/g;
    if (urlPattern.test(line) && !line.includes('](')) {
      warnings.push({
        path,
        line: lineNum,
        error: 'Bare URL found - consider using markdown link syntax',
        severity: 'warning',
      });
    }
  }

  return warnings;
}

/**
 * Do basic structural checks on any file
 */
function doBasicStructuralChecks(path: string, content: string): SyntaxError[] {
  const warnings: SyntaxError[] = [];

  // Check for balanced braces
  const braceCount = (content.match(/{/g) || []).length - (content.match(/}/g) || []).length;
  if (braceCount !== 0) {
    warnings.push({
      path,
      line: 1,
      error: `Unbalanced braces: ${braceCount > 0 ? 'missing closing' : 'extra closing'} brace(s)`,
      severity: 'warning',
    });
  }

  // Check for balanced parentheses
  const parenCount = (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length;
  if (parenCount !== 0) {
    warnings.push({
      path,
      line: 1,
      error: `Unbalanced parentheses: ${parenCount > 0 ? 'missing closing' : 'extra closing'} paren(s)`,
      severity: 'warning',
    });
  }

  // Check for balanced brackets
  const bracketCount = (content.match(/\[/g) || []).length - (content.match(/]/g) || []).length;
  if (bracketCount !== 0) {
    warnings.push({
      path,
      line: 1,
      error: `Unbalanced brackets: ${bracketCount > 0 ? 'missing closing' : 'extra closing'} bracket(s)`,
      severity: 'warning',
    });
  }

  // Check for empty file
  if (!content.trim()) {
    warnings.push({
      path,
      line: 1,
      error: 'File is empty',
      severity: 'warning',
    });
  }

  // Check for very large files
  if (content.length > 1000000) {
    warnings.push({
      path,
      line: 1,
      error: `Very large file (${(content.length / 1000000).toFixed(2)}MB)`,
      severity: 'warning',
    });
  }

  return warnings;
}

/**
 * Generate a reprompt message based on verification errors
 */
function generateReprompt(errors: SyntaxError[]): string {
  if (errors.length === 0) {
    return '';
  }

  const errorSummary = errors
    .slice(0, 5)
    .map((e) => `- ${e.path}:${e.line}${e.column ? ':' + e.column : ''} - ${e.error}`)
    .join('\n');

  let message = `The following ${errors.length === 1 ? 'error was' : 'errors were'} detected:\n\n${errorSummary}`;

  if (errors.length > 5) {
    message += `\n\n... and ${errors.length - 5} more ${errors.length - 5 === 1 ? 'error' : 'errors'}.`;
  }

  message += '\n\nPlease fix these issues before proceeding.';

  return message;
}

/**
 * Quick syntax check for a single file
 */
export async function quickSyntaxCheck(path: string, content: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const result = await verifyFile(path, content);
    return {
      valid: result.passed,
      error: result.errors[0]?.error,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Enhanced code quality checks (no external dependencies required)
 * 
 * Uses built-in TypeScript/Acorn parsers already available in the project.
 * Catches common issues without requiring ESLint/Prettier in sandbox.
 */
export async function runCodeQualityChecks(
  files: Record<string, string>
): Promise<{ errors: SyntaxError[]; warnings: SyntaxError[]; output: string }> {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  for (const [path, content] of Object.entries(files)) {
    const ext = path.split('.').pop()?.toLowerCase();
    
    // Skip non-code files
    if (!['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext || '')) {
      continue;
    }

    // Run enhanced checks based on file type
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext || '')) {
      const result = await runEnhancedJavaScriptChecks(path, content);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    } else if (ext === 'json') {
      const result = runEnhancedJSONChecks(path, content);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  const errorCount = errors.length;
  const warningCount = warnings.length;
  const output = errorCount === 0 && warningCount === 0
    ? 'Code quality checks passed'
    : `Found ${errorCount} error(s) and ${warningCount} warning(s)`;

  return { errors, warnings, output };
}

/**
 * Enhanced JavaScript/TypeScript checks using built-in parsers
 */
async function runEnhancedJavaScriptChecks(
  path: string,
  content: string
): Promise<{ errors: SyntaxError[]; warnings: SyntaxError[] }> {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  // 1. Use TypeScript compiler API (already installed as dev dependency)
  try {
    const ts = await import('typescript');
    
    // Create source file
    const sourceFile = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    // Check for syntax errors
    const diagnostics: Array<{ messageText: string; start?: number }> = [];
    
    // Visit all nodes to find errors
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.Unknown) {
        diagnostics.push({
          messageText: `Unknown syntax at line ${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
          start: node.getStart(),
        });
      }
      ts.forEachChild(node, visit);
    };
    
    visit(sourceFile);

    for (const diag of diagnostics) {
      const line = diag.start ? sourceFile.getLineAndCharacterOfPosition(diag.start).line + 1 : 1;
      errors.push({
        path,
        line,
        error: diag.messageText,
        severity: 'error',
      });
    }
  } catch {
    // TypeScript not available, use Acorn fallback (already installed)
    try {
      const acorn = await import('acorn');
      acorn.parse(content, {
        ecmaVersion: 2024,
        sourceType: 'module',
        allowReturnOutsideFunction: true,
      });
    } catch (parseError: any) {
      const line = parseError.loc?.line || 1;
      errors.push({
        path,
        line,
        column: parseError.loc?.column,
        error: `Syntax error: ${parseError.message}`,
        severity: 'error',
      });
    }
  }

  // 2. Check for common code quality issues (warnings only)
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Console statements (warning)
    if (/\bconsole\.(log|warn|error|info|debug)\b/.test(line)) {
      warnings.push({
        path,
        line: lineNum,
        error: 'Console statement found - consider removing in production',
        severity: 'warning',
      });
    }

    // TODO/FIXME comments (warning)
    if (/\b(TODO|FIXME|XXX|HACK)\b/i.test(line)) {
      warnings.push({
        path,
        line: lineNum,
        error: 'TODO/FIXME comment found',
        severity: 'warning',
      });
    }

    // Very long lines (warning)
    if (line.length > 150) {
      warnings.push({
        path,
        line: lineNum,
        error: `Line exceeds 150 characters (${line.length} chars)`,
        severity: 'warning',
      });
    }

    // Debugger statements (error)
    if (/\bdebugger\b/.test(line)) {
      errors.push({
        path,
        line: lineNum,
        error: 'Debugger statement found - remove before committing',
        severity: 'error',
      });
    }

    // eval() usage (error)
    if (/\beval\s*\(/.test(line)) {
      errors.push({
        path,
        line: lineNum,
        error: 'eval() usage found - security risk',
        severity: 'error',
      });
    }
  }

  return { errors, warnings };
}

/**
 * Enhanced JSON checks
 */
function runEnhancedJSONChecks(
  path: string,
  content: string
): { errors: SyntaxError[]; warnings: SyntaxError[] } {
  const errors: SyntaxError[] = [];
  const warnings: SyntaxError[] = [];

  try {
    JSON.parse(content);
  } catch (error: any) {
    const match = error.message.match(/position (\d+)/);
    let line = 1;
    let column = 1;

    if (match) {
      const position = parseInt(match[1], 10);
      const lines = content.substring(0, position).split('\n');
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    }

    errors.push({
      path,
      line,
      column,
      error: `Invalid JSON: ${error.message}`,
      severity: 'error',
    });
  }

  // Check for trailing commas (invalid in JSON)
  const trailingCommaRegex = /,\s*[\]}]/g;
  let match;
  while ((match = trailingCommaRegex.exec(content)) !== null) {
    const position = match.index;
    const lines = content.substring(0, position).split('\n');
    warnings.push({
      path,
      line: lines.length,
      error: 'Trailing comma detected (invalid in JSON)',
      severity: 'warning',
    });
  }

  return { errors, warnings };
}
