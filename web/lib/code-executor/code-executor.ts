/**
 * Code Execution Service
 *
 * Multi-language code execution with sandbox isolation
 * Supports: JavaScript, TypeScript, Python, HTML, CSS, SQL, Bash
 *
 * SECURITY: JS/TS/Python/Bash execution uses sandbox providers (never eval()).
 * HTML/CSS/SQL/JSON are validated/rendered without server-side execution.
 *
 * @see lib/sandbox/ for sandbox providers
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('CodeExecutor');

// Maximum code size (50KB)
const MAX_CODE_LENGTH = 50000;

// Dangerous patterns that should never be executed (defense-in-depth)
// The sandbox is the primary security boundary; these patterns are logged as warnings
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /process\./, description: 'process object access' },
  { pattern: /require\s*\(/, description: 'require() module loading' },
  { pattern: /import\s+.*from\s+['"]/, description: 'ES module import' },
  { pattern: /\beval\s*\(/, description: 'eval() call' },
  { pattern: /new\s+Function\s*\(/, description: 'Function constructor' },
  { pattern: /child_process/, description: 'child_process module' },
  { pattern: /__dirname|__filename/, description: 'Node.js path globals' },
  { pattern: /\bglobal\b\./, description: 'global object access' },
  { pattern: /setTimeout\s*\(\s*['"`]/, description: 'setTimeout with string arg' },
  { pattern: /setInterval\s*\(\s*['"`]/, description: 'setInterval with string arg' },
];

export type CodeLanguage = 
  | 'javascript' 
  | 'typescript' 
  | 'python' 
  | 'html' 
  | 'css' 
  | 'sql' 
  | 'bash'
  | 'json';

export interface CodeExecutionRequest {
  code: string;
  language: CodeLanguage;
  stdin?: string;
  timeout?: number;
  sandboxId?: string;
}

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
  language: CodeLanguage;
  warnings?: string[]; // Security warnings from pattern detection (defense-in-depth)
}

/**
 * Validate code for dangerous patterns before execution
 * Returns list of human-readable descriptions of detected patterns (empty = safe)
 */
function detectDangerousPatterns(code: string): string[] {
  const detected: string[] = [];
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      detected.push(description);
    }
  }
  return detected;
}

/**
 * Execute code in specified language
 */
export async function executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
  const { code, language, stdin, timeout = 10000 } = request;
  const startTime = Date.now();

  try {
    // Input validation
    if (!code || typeof code !== 'string') {
      throw new Error('Code is required and must be a string');
    }
    if (code.length > MAX_CODE_LENGTH) {
      throw new Error(`Code exceeds maximum length of ${MAX_CODE_LENGTH} characters`);
    }

    // Code execution languages require sandbox + dangerous pattern scan
    const requiresSandbox = ['javascript', 'typescript', 'python', 'bash'].includes(language);
    let warnings: string[] | undefined;
    if (requiresSandbox) {
      const dangerousPatterns = detectDangerousPatterns(code);
      if (dangerousPatterns.length > 0) {
        logger.warn('Dangerous code pattern detected', { language, patterns: dangerousPatterns });
        // Don't block execution entirely (sandbox provides isolation), but include warnings in response
        // The sandbox is the primary security boundary; pattern detection is defense-in-depth
        warnings = dangerousPatterns.map(p => `Security warning: ${p} detected. Execution continues in sandbox.`);
      }
    }

    let result: CodeExecutionResult;
    switch (language) {
      case 'javascript':
      case 'typescript':
        result = await executeJavaScript(code, timeout);
        break;
      
      case 'python':
        result = await executePython(code, stdin, timeout);
        break;
      
      case 'html':
      case 'css':
        result = await executeWeb(code, language);
        break;
      
      case 'sql':
        result = await executeSQL(code, timeout);
        break;
      
      case 'bash':
        result = await executeBash(code, timeout);
        break;
      
      case 'json':
        result = await validateJSON(code);
        break;
      
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
    
    // Attach warnings to result
    if (warnings && warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Code execution failed:', { language, error: errMsg });
    return {
      success: false,
      output: '',
      error: errMsg,
      executionTime: Date.now() - startTime,
      language,
    };
  }
}

/**
 * Execute JavaScript/TypeScript code using sandbox provider
 * 
 * SECURITY: Never uses eval(). Code runs in an isolated sandbox
 * with proper process isolation, resource limits, and network restrictions.
 * Falls back to returning a "sandbox unavailable" message rather than
 * falling back to insecure eval().
 */
async function executeJavaScript(code: string, timeout: number): Promise<CodeExecutionResult> {
  const startTime = Date.now();
  
  try {
    // Attempt sandbox-based execution
    const { executeInSandbox } = await import('@/lib/sandbox/code-executor');
    
    const result = await executeInSandbox(code, 'javascript', {
      timeout: Math.min(timeout, 30000), // Hard cap at 30s
    });

    return {
      success: result.exitCode === 0,
      output: result.output || '',
      error: result.error,
      executionTime: result.executionTime || Date.now() - startTime,
      language: 'javascript',
    };
  } catch (sandboxError: unknown) {
    const errMsg = sandboxError instanceof Error ? sandboxError.message : String(sandboxError);
    logger.warn('Sandbox unavailable for JS execution', { error: errMsg });
    
    // DO NOT fall back to eval() — return error instead
    return {
      success: false,
      output: '',
      error: 'Code execution requires a sandbox provider. Configure SANDBOX_PROVIDER to enable live execution. ' +
             'HTML/CSS/JSON preview is available without sandbox.',
      executionTime: Date.now() - startTime,
      language: 'javascript',
    };
  }
}

/**
 * Execute Python code via sandbox provider
 */
async function executePython(code: string, stdin: string | undefined, timeout: number): Promise<CodeExecutionResult> {
  const startTime = Date.now();

  try {
    const { executeInSandbox } = await import('@/lib/sandbox/code-executor');
    
    const result = await executeInSandbox(code, 'python', {
      input: stdin,
      timeout: Math.min(timeout, 30000),
    });

    return {
      success: result.exitCode === 0,
      output: result.output || '',
      error: result.error,
      executionTime: result.executionTime || Date.now() - startTime,
      language: 'python',
    };
  } catch (sandboxError: unknown) {
    const errMsg = sandboxError instanceof Error ? sandboxError.message : String(sandboxError);
    logger.warn('Sandbox unavailable for Python execution', { error: errMsg });
    
    return {
      success: false,
      output: '',
      error: 'Python execution requires a sandbox provider. Configure SANDBOX_PROVIDER to enable live execution.',
      executionTime: Date.now() - startTime,
      language: 'python',
    };
  }
}

/**
 * Execute HTML/CSS (render preview)
 */
async function executeWeb(code: string, language: 'html' | 'css'): Promise<CodeExecutionResult> {
  const startTime = Date.now();
  return {
    success: true,
    output: `${language.toUpperCase()} code ready for preview`,
    executionTime: Date.now() - startTime,
    language,
  };
}

/**
 * Validate SQL syntax (no live execution — preview only)
 */
async function executeSQL(code: string, timeout: number): Promise<CodeExecutionResult> {
  const startTime = Date.now();

  try {
    // Validate SQL syntax (basic check)
    const upperCode = code.toUpperCase().trim();
    
    if (!upperCode.match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/)) {
      throw new Error('Invalid SQL statement');
    }

    // SECURITY: Block destructive SQL without WHERE clause
    const destructiveWithoutWhere = /^(DROP|TRUNCATE)\b/i.test(upperCode) ||
      (/^(DELETE|UPDATE)\b/i.test(upperCode) && !/\bWHERE\b/i.test(upperCode));
    if (destructiveWithoutWhere) {
      throw new Error('Destructive SQL without WHERE clause is not allowed in playground');
    }

    return {
      success: true,
      output: 'SQL syntax valid. Live execution requires database connection.\nConfigure DATABASE_URL for live SQL execution.',
      executionTime: Date.now() - startTime,
      language: 'sql',
    };
  } catch (error: unknown) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      executionTime: Date.now() - startTime,
      language: 'sql',
    };
  }
}

/**
 * Execute Bash command via sandbox provider
 */
async function executeBash(code: string, timeout: number): Promise<CodeExecutionResult> {
  const startTime = Date.now();

  try {
    // SECURITY: Block obviously dangerous patterns (defense-in-depth, sandbox is primary boundary)
    const blockedPatterns = [
      /rm\s+-rf\s+\//,                    // Recursive force delete from root
      /:\s*\(\s*\)\s*\{.*?\|.*?&/,           // Fork bomb pattern (various spacings)
      /\/dev\/tcp\//,                      // Reverse shell via /dev/tcp (any variant)
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(code)) {
        throw new Error(`Command blocked for security: dangerous pattern detected`);
      }
    }

    // Attempt sandbox-based execution
    const { executeInSandbox } = await import('@/lib/sandbox/code-executor');
    
    const result = await executeInSandbox(code, 'bash', {
      timeout: Math.min(timeout, 30000),
    });

    return {
      success: result.exitCode === 0,
      output: result.output || '',
      error: result.error,
      executionTime: result.executionTime || Date.now() - startTime,
      language: 'bash',
    };
  } catch (sandboxError: unknown) {
    // If sandbox import fails (not the pattern check above), return unavailable message
    if (sandboxError instanceof Error && sandboxError.message.includes('dangerous pattern')) {
      return {
        success: false,
        output: '',
        error: sandboxError.message,
        executionTime: Date.now() - startTime,
        language: 'bash',
      };
    }
    
    const errMsg = sandboxError instanceof Error ? sandboxError.message : String(sandboxError);
    logger.warn('Sandbox unavailable for Bash execution', { error: errMsg });
    
    return {
      success: false,
      output: '',
      error: 'Bash execution requires a sandbox provider. Configure SANDBOX_PROVIDER to enable live execution.',
      executionTime: Date.now() - startTime,
      language: 'bash',
    };
  }
}

/**
 * Validate JSON
 */
async function validateJSON(code: string): Promise<CodeExecutionResult> {
  const startTime = Date.now();

  try {
    const parsed = JSON.parse(code);
    return {
      success: true,
      output: `Valid JSON\n\n${JSON.stringify(parsed, null, 2)}`,
      executionTime: Date.now() - startTime,
      language: 'json',
    };
  } catch (error: unknown) {
    return {
      success: false,
      output: '',
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      executionTime: Date.now() - startTime,
      language: 'json',
    };
  }
}

/**
 * Get code templates
 */
export function getCodeTemplate(language: CodeLanguage): string {
  const templates: Record<CodeLanguage, string> = {
    javascript: `// JavaScript Playground
const greeting = "Hello, World!";
console.log(greeting);

// Try async/await
async function fetchData() {
  const response = await fetch('https://api.example.com/data');
  const data = await response.json();
  return data;
}

fetchData().then(console.log);`,

    typescript: `// TypeScript Playground
interface User {
  id: number;
  name: string;
  email: string;
}

const getUser = async (id: number): Promise<User> => {
  const response = await fetch(\`/api/users/\${id}\`);
  return await response.json();
};

const user = await getUser(1);
console.log(user);`,

    python: `# Python Playground
def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("World"))

# Try list comprehension
numbers = [1, 2, 3, 4, 5]
squares = [n**2 for n in numbers]
print(f"Squares: {squares}")`,

    html: `<!DOCTYPE html>
<html>
<head>
  <title>HTML Preview</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Hello, World!</h1>
    <p>Welcome to the HTML playground</p>
  </div>
</body>
</html>`,

    css: `/* CSS Playground */
:root {
  --primary-color: #3498db;
  --secondary-color: #2ecc71;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  color: white;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card {
  background: rgba(255, 255, 255, 0.1);
  padding: 2rem;
  border-radius: 10px;
  backdrop-filter: blur(10px);
}`,

    sql: `-- SQL Playground
-- Create table
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert data
INSERT INTO users (name, email) VALUES
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com');

-- Query data
SELECT * FROM users WHERE created_at > '2024-01-01';`,

    bash: `# Bash Playground
echo "Hello, World!"

# List files
ls -la

# Show system info
uname -a
uptime
free -h`,

    json: `{
  "name": "JSON Playground",
  "version": "1.0.0",
  "description": "Test JSON validation and formatting",
  "features": [
    "Syntax validation",
    "Pretty printing",
    "Minification"
  ],
  "author": {
    "name": "binG",
    "url": "https://github.com/quazfenton/binG"
  }
}`,
  };

  return templates[language] || '';
}
