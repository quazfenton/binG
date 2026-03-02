"use client";

/**
 * Tambo Tools Registry
 * Define functions/tools that Tambo can call during response generation
 */

import { z } from 'zod';

// Format code with proper indentation
async function formatCode({ code, language }: { code: string; language: string }) {
  // Simple formatting - can be enhanced with prettier or language-specific formatters
  const indentSize = 2;
  const lines = code.split('\n');
  let indentLevel = 0;
  
  const formatted = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.match(/^[}\]]/)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }
    const result = ' '.repeat(indentLevel * indentSize) + trimmed;
    if (trimmed.match(/[{[]$/)) {
      indentLevel++;
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
}

// Validate input with multiple validation types
async function validateInput({ input, type, options }: { 
  input: string; 
  type: string;
  options?: { minLength?: number; maxLength?: number; pattern?: string };
}) {
  const validations: Record<string, (val: string, opts?: any) => { valid: boolean; message: string }> = {
    email: (val) => ({
      valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      message: 'Invalid email address',
    }),
    url: (val) => {
      try {
        new URL(val);
        return { valid: true, message: 'Valid URL' };
      } catch {
        return { valid: false, message: 'Invalid URL' };
      }
    },
    number: (val) => ({
      valid: !isNaN(Number(val)),
      message: 'Must be a number',
    }),
    phone: (val) => ({
      valid: /^[\d\s\-\+\(\)]+$/.test(val),
      message: 'Invalid phone number',
    }),
  };

  const validation = validations[type]?.(input, options);
  
  if (!validation) {
    return { valid: true, message: 'No validation rules applied' };
  }
  
  // Check length constraints
  if (options?.minLength && input.length < options.minLength) {
    return { valid: false, message: `Minimum length is ${options.minLength}` };
  }
  if (options?.maxLength && input.length > options.maxLength) {
    return { valid: false, message: `Maximum length is ${options.maxLength}` };
  }
  
  // Check pattern
  if (options?.pattern) {
    const regex = new RegExp(options.pattern);
    if (!regex.test(input)) {
      return { valid: false, message: 'Does not match required pattern' };
    }
  }
  
  return validation;
}

// Search documentation (placeholder - integrate with actual docs)
async function searchDocs({ query, limit = 5 }: { query: string; limit?: number }) {
  // Placeholder - integrate with your actual docs search API
  return {
    results: [
      {
        title: 'Getting Started',
        excerpt: 'Learn how to get started with the platform...',
        url: '/docs/getting-started',
        score: 0.95,
      },
      {
        title: 'API Reference',
        excerpt: 'Complete API documentation...',
        url: '/docs/api',
        score: 0.85,
      },
    ].slice(0, limit),
    query,
    totalFound: 2,
  };
}

// Get file information
async function getFileInfo({ path }: { path: string }) {
  // Placeholder - integrate with actual file system if needed
  const extension = path.split('.').pop() || '';
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
    name: path.split('/').pop() || path,
    path,
    extension,
    type: languageMap[extension] || 'Unknown',
    size: 'Unknown', // Would need actual file access
  };
}

// Calculate mathematical expressions safely
async function calculate({ expression }: { expression: string }) {
  try {
    // Safe math evaluation using Function with strict mode
    // Only allows basic math operations
    const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
    if (sanitized !== expression) {
      return { error: 'Invalid characters in expression' };
    }
    
    const result = Function(`'use strict'; return (${sanitized})`)();
    return {
      result: String(result),
      expression,
      sanitized,
    };
  } catch (error) {
    return {
      error: 'Invalid mathematical expression',
      expression,
    };
  }
}

// Convert between units
async function convertUnits({ value, from, to }: { value: number; from: string; to: string }) {
  // Conversion factors relative to base unit
  const conversions: Record<string, Record<string, number>> = {
    length: {
      m: 1,
      km: 0.001,
      cm: 100,
      mm: 1000,
      ft: 3.28084,
      in: 39.3701,
    },
    weight: {
      kg: 1,
      g: 1000,
      lb: 2.20462,
      oz: 35.274,
    },
  };
  
  // Find which category contains both units
  const category = Object.values(conversions).find(
    (map) => from in map && to in map,
  );
  
  if (category) {
    // Convert: (value / from_factor) * to_factor
    const fromFactor = category[from] as number;
    const toFactor = category[to] as number;
    const result = (value / fromFactor) * toFactor;
    
    return {
      result,
      from,
      to,
      input: value,
    };
  }
  
  return { error: 'Unsupported unit conversion' };
}

// Register tools for Tambo to use (as array for @tambo-ai/react)
export const tamboTools = [
  {
    name: 'formatCode',
    tool: formatCode,
    argsSchema: z.object({
      code: z.string().describe('The code to format'),
      language: z.string().describe('The programming language (e.g., typescript, python)'),
    }),
    description: 'Formats code with proper indentation and styling',
  },
  {
    name: 'validateInput',
    tool: validateInput,
    argsSchema: z.object({
      input: z.string().describe('The input string to validate'),
      type: z.string().describe('Validation type: email, url, number, phone'),
      options: z.object({
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        pattern: z.string().optional(),
      }).optional().describe('Optional validation constraints'),
    }),
    description: 'Validates input based on specified rules',
  },
  {
    name: 'searchDocs',
    tool: searchDocs,
    argsSchema: z.object({
      query: z.string().describe('The search query'),
      limit: z.number().default(5).describe('Maximum number of results to return'),
    }),
    description: 'Searches documentation for relevant results',
  },
  {
    name: 'getFileInfo',
    tool: getFileInfo,
    argsSchema: z.object({
      path: z.string().describe('The file path to get information about'),
    }),
    description: 'Gets information about a file including name, type, and extension',
  },
  {
    name: 'calculate',
    tool: calculate,
    argsSchema: z.object({
      expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2 * 3")'),
    }),
    description: 'Safely calculates mathematical expressions',
  },
  {
    name: 'convertUnits',
    tool: convertUnits,
    argsSchema: z.object({
      value: z.number().describe('The numeric value to convert'),
      from: z.string().describe('Source unit (e.g., m, km, kg, lb)'),
      to: z.string().describe('Target unit (e.g., ft, cm, oz, kg)'),
    }),
    description: 'Converts between different units of measurement',
  },
  // Add more tools as needed
];

// Export types for TypeScript
export type TamboToolName = 'formatCode' | 'validateInput' | 'searchDocs' | 'getFileInfo' | 'calculate' | 'convertUnits';
