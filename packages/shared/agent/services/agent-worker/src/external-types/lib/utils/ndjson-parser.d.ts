/**
 * Type declarations for @/lib/utils/ndjson-parser
 * Stub for agent-worker — mirrors real exports from web/lib/utils/ndjson-parser.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

export interface NDJSONParser {
  parse(chunk: string): any[];
  reset(): void;
  getBufferedLines(): number;
  getBufferSize(): number;
  finalize(): any[];
}

export interface NDJSONParserOptions {
  maxBufferSize?: number;
  maxLineLength?: number;
  verbose?: boolean;
  onError?: (error: Error, context: { line?: string; chunk?: string }) => void;
}

export function createNDJSONParser(options?: NDJSONParserOptions): NDJSONParser;
export function parseNDJSONString(input: string): any[];
export function stringifyNDJSON(obj: any): string;
export function stringifyNDJSONArray(arr: any[]): string;
