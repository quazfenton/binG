import type { z } from 'zod';

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, any>;
  source: 'native' | 'grammar' | 'xml';
}

export interface ParserContext {
  provider?: string;
  model?: string;
  content?: string;
  metadata?: Record<string, any>;
}

export interface ParserToolDefinition {
  name: string;
  inputSchema?: z.ZodTypeAny;
}

export type ToolCallingMode = 'native' | 'grammar' | 'xml' | 'auto';
