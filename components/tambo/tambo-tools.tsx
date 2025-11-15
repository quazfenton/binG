"use client";

/**
 * Tambo Tools Registry
 * Define functions/tools that Tambo can call during response generation
 */

// Example: Format code tool
async function formatCode({ code, language }: { code: string; language: string }) {
  // Simple formatting example - can be enhanced with actual formatters
  return {
    formatted: code.trim(),
    language,
  };
}

// Example: Validate input tool
async function validateInput({ input, type }: { input: string; type: string }) {
  // Simple validation example
  const validations: Record<string, (val: string) => boolean> = {
    email: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    url: (val) => {
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    },
    number: (val) => !isNaN(Number(val)),
  };

  const isValid = validations[type]?.(input) ?? true;

  return {
    valid: isValid,
    message: isValid ? 'Valid input' : `Invalid ${type}`,
  };
}

// Example: Search documentation tool
async function searchDocs({ query }: { query: string }) {
  // Placeholder - integrate with your actual docs search
  return {
    results: [
      {
        title: 'Getting Started',
        excerpt: 'Learn how to get started with the platform...',
        url: '/docs/getting-started',
      },
    ],
  };
}

// Example: Get file info tool
async function getFileInfo({ path }: { path: string }) {
  // Placeholder - integrate with actual file system if needed
  return {
    name: path.split('/').pop(),
    path,
    type: path.endsWith('.tsx') ? 'TypeScript React' : 'Unknown',
  };
}

// Example: Calculate tool
async function calculate({ expression }: { expression: string }) {
  try {
    // Simple safe evaluation for basic math
    // In production, use a proper math parser library
    const result = Function(`'use strict'; return (${expression})`)();
    return {
      result: String(result),
      expression,
    };
  } catch (error) {
    return {
      error: 'Invalid expression',
      expression,
    };
  }
}

// Register tools for Tambo to use
export const tamboTools = {
  formatCode,
  validateInput,
  searchDocs,
  getFileInfo,
  calculate,
  // Add more tools as needed
};

// Export types for TypeScript
export type TamboToolName = keyof typeof tamboTools;
