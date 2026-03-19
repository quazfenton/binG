import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

// NOTE: Tambo local tools are for server-side tool execution without persistent sessions.
// Using 'anon:public' for unauthenticated requests is acceptable for development/public use.
// For persistent user sessions, callers should provide authContextUserId.
const DEFAULT_OWNER = 'anon:public';

/**
 * SECURITY: Get owner from authenticated context, NOT user input
 * This prevents IDOR attacks where users specify another user's ownerId
 * 
 * @param providedOwnerId - IGNORED for security (kept for API compatibility)
 * @param authContextUserId - User ID from verified authentication context
 * @returns The authenticated user's owner identifier
 */
function getSecureOwner(providedOwnerId: string | undefined, authContextUserId?: string): string {
  // SECURITY: Never trust user-provided ownerId - always use authenticated context
  if (authContextUserId) {
    return `user:${authContextUserId}`;
  }
  
  // Fallback to anonymous only if no auth context provided
  // This should only happen in development or for public resources
  return DEFAULT_OWNER;
}

export const tamboLocalTools = {
  /**
   * SECURITY: ownerId parameter is IGNORED - owner derived from auth context
   */
  readFile: async ({ path, ownerId }: { path: string; ownerId?: string }, authContextUserId?: string) => {
    const owner = getSecureOwner(ownerId, authContextUserId);
    const file = await virtualFilesystem.readFile(owner, path);
    return { path: file.path, content: file.content, language: file.language, version: file.version };
  },

  /**
   * SECURITY: ownerId parameter is IGNORED - owner derived from auth context
   */
  writeFile: async ({ path, content, ownerId }: { path: string; content: string; ownerId?: string }, authContextUserId?: string) => {
    const owner = getSecureOwner(ownerId, authContextUserId);
    const file = await virtualFilesystem.writeFile(owner, path, content);
    return { path: file.path, version: file.version, language: file.language, size: file.size };
  },

  /**
   * SECURITY: ownerId parameter is IGNORED - owner derived from auth context
   */
  listDirectory: async ({ path, ownerId }: { path?: string; ownerId?: string }, authContextUserId?: string) => {
    const owner = getSecureOwner(ownerId, authContextUserId);
    const listing = await virtualFilesystem.listDirectory(owner, path);
    return { path: listing.path, entries: listing.nodes.map(n => ({ name: n.name, type: n.type, path: n.path })) };
  },

  /**
   * SECURITY: ownerId parameter is IGNORED - owner derived from auth context
   */
  deletePath: async ({ path, ownerId }: { path: string; ownerId?: string }, authContextUserId?: string) => {
    const owner = getSecureOwner(ownerId, authContextUserId);
    const result = await virtualFilesystem.deletePath(owner, path);
    return { deletedCount: result.deletedCount };
  },

  /**
   * SECURITY: ownerId parameter is IGNORED - owner derived from auth context
   */
  searchFiles: async ({ query, path, ownerId }: { query: string; path?: string; ownerId?: string }, authContextUserId?: string) => {
    const owner = getSecureOwner(ownerId, authContextUserId);
    const results = await virtualFilesystem.search(owner, query, { path });
    return { results: results.map(r => ({ path: r.path, name: r.name, language: r.language, snippet: r.snippet })) };
  },

  formatCode: async ({ code, language }: { code: string; language: string }) => {
    const indentSize = 2;
    const lines = String(code || '').split('\n');
    let indentLevel = 0;

    const formatted = lines.map((line) => {
      const trimmed = line.trim();
      if (/^[}\]]/.test(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      const result = ' '.repeat(indentLevel * indentSize) + trimmed;
      if (/[{[]$/.test(trimmed)) {
        indentLevel += 1;
      }
      return result;
    });

    const formattedCode = formatted.join('\n');

    return {
      formatted: formattedCode,
      language,
      originalLength: code.length,
      formattedLength: formattedCode.length,
    };
  },

  validateInput: async ({ input, type, options }: {
    input: string;
    type: string;
    options?: { minLength?: number; maxLength?: number; pattern?: string };
  }) => {
    const val = String(input || '');
    const lowerType = String(type || '').toLowerCase();

    const validators: Record<string, () => { valid: boolean; message: string }> = {
      email: () => ({ valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), message: 'Invalid email address' }),
      url: () => {
        try {
          new URL(val);
          return { valid: true, message: 'Valid URL' };
        } catch {
          return { valid: false, message: 'Invalid URL' };
        }
      },
      number: () => ({ valid: !Number.isNaN(Number(val)), message: 'Must be a number' }),
      phone: () => ({ valid: /^[\d\s\-+()]+$/.test(val), message: 'Invalid phone number' }),
    };

    if (options?.minLength && val.length < options.minLength) {
      return { valid: false, message: `Minimum length is ${options.minLength}` };
    }
    if (options?.maxLength && val.length > options.maxLength) {
      return { valid: false, message: `Maximum length is ${options.maxLength}` };
    }
    if (options?.pattern && !new RegExp(options.pattern).test(val)) {
      return { valid: false, message: 'Does not match required pattern' };
    }

    const validator = validators[lowerType];
    return validator ? validator() : { valid: true, message: 'No validation rules applied' };
  },

  calculate: async ({ expression }: { expression: string }) => {
    const raw = String(expression || '');
    
    // Strict whitelist: only allow digits, basic operators, parentheses, spaces, and decimal points
    const sanitized = raw.replace(/[^0-9+\-*/().\s]/g, '');
    
    // Additional safety checks
    if (raw !== sanitized) {
      return { error: 'Invalid characters in expression' };
    }
    if (sanitized.length > 1000) {
      return { error: 'Expression too long' };
    }
    // Prevent division by zero patterns
    if (/\/\s*0(?:\.0+)?(?:\s|$|\)|\+|\-|\*|\/)/.test(sanitized)) {
      return { error: 'Division by zero' };
    }
    // Prevent unbalanced parentheses
    const openParens = (sanitized.match(/\(/g) || []).length;
    const closeParens = (sanitized.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return { error: 'Unbalanced parentheses' };
    }

    try {
      // Use Function with strict mode and sanitized input
      // This is safe because we've already validated the input contains only safe characters
      const calculateFunc = new Function(`'use strict'; return (${sanitized})`);
      const result = calculateFunc();
      
      // Validate result is a finite number
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        return { error: 'Invalid result' };
      }
      
      return { result: String(result), expression: raw, sanitized };
    } catch (error: any) {
      return { error: 'Invalid mathematical expression', expression: raw };
    }
  },

  convertUnits: async ({ value, from, to }: { value: number; from: string; to: string }) => {
    const conversions: Record<string, Record<string, number>> = {
      length: { m: 1, km: 0.001, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701 },
      weight: { kg: 1, g: 1000, lb: 2.20462, oz: 35.274 },
    };

    const category = Object.values(conversions).find((map) => from in map && to in map);
    if (!category) {
      return { error: 'Unsupported unit conversion' };
    }

    const fromFactor = category[from];
    const toFactor = category[to];
    return { result: (value / fromFactor) * toFactor, from, to, input: value };
  },

  searchDocs: async ({ query, limit = 5 }: { query: string; limit?: number }) => {
    return {
      query,
      totalFound: 2,
      results: [
        { title: 'Getting Started', excerpt: 'Learn how to get started with the platform...', url: '/docs/getting-started', score: 0.95 },
        { title: 'API Reference', excerpt: 'Complete API documentation...', url: '/docs/api', score: 0.85 },
      ].slice(0, limit),
    };
  },

  getFileInfo: async ({ path }: { path: string }) => {
    const extension = String(path || '').split('.').pop() || '';
    const languageMap: Record<string, string> = {
      ts: 'TypeScript',
      tsx: 'TypeScript React',
      js: 'JavaScript',
      jsx: 'JavaScript React',
      py: 'Python',
      md: 'Markdown',
      json: 'JSON',
    };

    return {
      name: String(path || '').split('/').pop() || path,
      path,
      extension,
      type: languageMap[extension] || 'Unknown',
      size: 'Unknown',
    };
  },
};

export type TamboLocalToolName = keyof typeof tamboLocalTools;
