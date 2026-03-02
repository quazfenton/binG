/**
 * Tambo Local Tools
 * 
 * Provides local tools that can be used within Tambo workspace.
 */

import { z } from 'zod';

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

export interface TamboTool {
  name: string;
  description: string;
  execute: (input: Record<string, any>) => Promise<any>;
}

const formatCodeSchema = z.object({
  code: z.string(),
  language: z.string().optional(),
  options: z.record(z.any()).optional(),
});

export const formatCodeTool: TamboTool = {
  name: 'format_code',
  description: 'Format code with proper indentation and style',
  execute: async (input: Record<string, any>): Promise<ToolExecutionResult> => {
    try {
      const { code, language = 'javascript', options = {} } = input;
      
      let formatted = code;
      
      if (language === 'typescript' || language === 'javascript') {
        formatted = code
          .replace(/\s+/g, ' ')
          .replace(/\s*{\s*/g, ' {\n  ')
          .replace(/\s*}\s*/g, '\n}\n')
          .replace(/;/g, ';\n')
          .trim();
      } else if (language === 'python') {
        formatted = code
          .replace(/\s+/g, ' ')
          .replace(/:/g, ':\n')
          .trim();
      } else {
        formatted = code.trim();
      }

      return {
        success: true,
        result: {
          formatted,
          language,
          options,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

const validateInputSchema = z.object({
  input: z.any(),
  schema: z.record(z.any()),
});

export const validateInputTool: TamboTool = {
  name: 'validate_input',
  description: 'Validate input against a JSON schema',
  execute: async (input: Record<string, any>): Promise<ToolExecutionResult> => {
    try {
      const { input: data, schema } = input;

      let valid = true;
      let errors: string[] = [];

      if (schema.type === 'object' && typeof data === 'object' && data !== null) {
        if (schema.required) {
          for (const field of schema.required) {
            if (!(field in data)) {
              valid = false;
              errors.push(`Missing required field: ${field}`);
            }
          }
        }
        
        if (schema.properties) {
          for (const [key, prop] of Object.entries(schema.properties)) {
            const propDef = prop as Record<string, any>;
            if (key in data) {
              if (propDef.type && typeof data[key] !== propDef.type) {
                valid = false;
                errors.push(`Field ${key} must be of type ${propDef.type}`);
              }
            }
          }
        }
      }

      return {
        success: true,
        result: {
          valid,
          errors,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

const calculateSchema = z.object({
  expression: z.string(),
});

export const calculateTool: TamboTool = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  execute: async (input: Record<string, any>): Promise<ToolExecutionResult> => {
    try {
      const { expression } = input;
      
      const safeEval = (expr: string): number => {
        const sanitized = expr
          .replace(/[^0-9+\-*/().\s]/g, '')
          .replace(/\s+/g, '');
        
        const tokens: string[] = [];
        let current = '';
        
        for (const char of sanitized) {
          if ('+-*/().'.includes(char)) {
            if (current) {
              tokens.push(current);
              current = '';
            }
            tokens.push(char);
          } else {
            current += char;
          }
        }
        if (current) tokens.push(current);
        
        let result = 0;
        let operation: '+' | '-' | '*' | '/' | null = null;
        let currentNum = 0;
        
        for (const token of tokens) {
          if (!isNaN(Number(token))) {
            currentNum = Number(token);
          } else if (token === '+') {
            operation = '+';
          } else if (token === '-') {
            operation = '-';
          } else if (token === '*') {
            operation = '*';
          } else if (token === '/') {
            operation = '/';
          } else if (token === '(') {
            // Handle parentheses - simplified
          } else if (token === ')') {
            // Handle parentheses - simplified
          }
          
          if (operation && !isNaN(Number(token))) {
            switch (operation) {
              case '+':
                result += currentNum;
                break;
              case '-':
                result = currentNum - result;
                break;
              case '*':
                result = result * currentNum;
                break;
              case '/':
                result = currentNum / result;
                break;
            }
            operation = null;
          }
        }
        
        if (tokens.length === 1) {
          return Number(tokens[0]);
        }
        
        return result || 0;
      };

      const result = safeEval(expression);

      return {
        success: true,
        result: {
          expression,
          result,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

export const allTamboTools: Record<string, TamboTool> = {
  format_code: formatCodeTool,
  validate_input: validateInputTool,
  calculate: calculateTool,
};

export function getToolByName(name: string): TamboTool | undefined {
  return allTamboTools[name];
}

export function registerTool(tool: TamboTool): void {
  allTamboTools[tool.name] = tool;
}
