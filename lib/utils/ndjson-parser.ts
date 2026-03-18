/**
 * NDJSON Stream Parser
 *
 * Robust newline-delimited JSON parser that handles:
 * - Partial chunks (incomplete lines)
 * - Multiple JSON objects per chunk
 * - Empty lines
 * - Whitespace trimming
 * - Buffer size limits (prevents memory issues)
 * - Brace matching for partial JSON detection
 * - Detailed error diagnostics
 *
 * Usage:
 * ```typescript
 * const parser = createNDJSONParser()
 *
 * stream.on('data', (chunk) => {
 *   const objects = parser.parse(chunk.toString())
 *   for (const obj of objects) {
 *     // Process parsed JSON object
 *   }
 * })
 * ```
 *
 * Or with async iterator:
 * ```typescript
 * for await (const obj of parseNDJSONStream(stream)) {
 *   // Process parsed JSON object
 * }
 * ```
 */

export interface NDJSONParser {
  /**
   * Parse a chunk of data
   * Returns array of parsed JSON objects
   * Incomplete lines are buffered for next chunk
   */
  parse(chunk: string): any[]

  /**
   * Reset parser state (clear buffer)
   */
  reset(): void

  /**
   * Get number of lines currently buffered
   */
  getBufferedLines(): number

  /**
   * Get current buffer size in characters
   */
  getBufferSize(): number

  /**
   * Finalize parsing (flush remaining buffer)
   * Call this when stream ends to process any remaining data
   */
  finalize(): any[]
}

export interface NDJSONParserOptions {
  /**
   * Maximum buffer size in characters (default: 10MB)
   * Prevents memory issues from malformed streams
   */
  maxBufferSize?: number

  /**
   * Maximum line length (default: 1MB)
   * Rejects excessively long lines
   */
  maxLineLength?: number

  /**
   * Enable verbose logging (default: false)
   */
  verbose?: boolean

  /**
   * Custom error handler (default: console.warn)
   */
  onError?: (error: Error, context: { line?: string; chunk?: string }) => void
}

/**
 * Check if a string looks like it might be incomplete JSON
 * Uses brace/bracket matching to detect partial objects
 */
function isIncompleteJSON(str: string): boolean {
  if (!str || str.length === 0) return false;

  const trimmed = str.trim();
  if (!trimmed) return false;

  // Count braces and brackets
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }
  }

  // Incomplete if braces/brackets don't match or we're in a string
  return inString || braceCount !== 0 || bracketCount !== 0;
}

/**
 * Validate JSON structure before parsing (early error detection)
 */
function validateJSONStructure(str: string): { valid: boolean; error?: string } {
  const trimmed = str.trim();

  // Must start with { or [ for valid JSON
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { valid: false, error: 'Invalid JSON: must start with { or [' };
  }

  // Check for basic structure issues
  const openBraces = (trimmed.match(/{/g) || []).length;
  const closeBraces = (trimmed.match(/}/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/]/g) || []).length;

  if (openBraces !== closeBraces) {
    return { valid: false, error: `Unbalanced braces: ${openBraces} open, ${closeBraces} close` };
  }

  if (openBrackets !== closeBrackets) {
    return { valid: false, error: `Unbalanced brackets: ${openBrackets} open, ${closeBrackets} close` };
  }

  return { valid: true };
}

/**
 * Create NDJSON parser instance with enhanced error handling
 */
export function createNDJSONParser(options: NDJSONParserOptions = {}): NDJSONParser {
  const {
    maxBufferSize = 10 * 1024 * 1024, // 10MB default
    maxLineLength = 1024 * 1024, // 1MB default
    verbose = false,
    onError,
  } = options;

  let buffer = '';
  let parseCount = 0;
  let errorCount = 0;

  const handleError = (error: Error, context: { line?: string; chunk?: string }) => {
    errorCount++;
    
    if (onError) {
      onError(error, context);
    } else {
      // Default error handler
      console.warn('[NDJSON Parser] Parse error:', {
        error: error.message,
        line: context.line ? context.line.substring(0, 100) + (context.line.length > 100 ? '...' : '') : undefined,
        errorCount,
        parseCount,
      });
    }

    if (verbose) {
      console.log('[NDJSON Parser] Error context:', context);
    }
  };

  return {
    parse(chunk: string): any[] {
      // Validate chunk
      if (!chunk || chunk.length === 0) {
        return [];
      }

      // Check buffer size limit
      if (buffer.length + chunk.length > maxBufferSize) {
        const error = new Error(
          `Buffer size exceeded limit (${buffer.length + chunk.length} > ${maxBufferSize}). ` +
          'This may indicate a malformed stream or missing newlines.'
        );
        handleError(error, { chunk: chunk.substring(0, 100) });
        
        // Clear buffer to prevent memory issues
        buffer = '';
        return [];
      }

      // Append chunk to buffer
      buffer += chunk;

      // Split by newlines (handles \r\n, \n, \r)
      const lines = buffer.split(/\r?\n/);

      // Keep last line in buffer (might be incomplete)
      buffer = lines.pop() || '';

      // Check if buffered line is getting too long
      if (buffer.length > maxLineLength) {
        const error = new Error(
          `Line length exceeded limit (${buffer.length} > ${maxLineLength}). ` +
          'Possible missing newline or malformed JSON.'
        );
        handleError(error, { line: buffer.substring(0, 100) });
        
        // Clear buffer to prevent memory issues
        buffer = '';
        return [];
      }

      // Parse complete lines
      const results: any[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Quick validation before attempting parse
        const validation = validateJSONStructure(trimmed);
        if (!validation.valid) {
          // Check if it looks like incomplete JSON (might complete in next chunk)
          if (isIncompleteJSON(trimmed)) {
            // Put it back in buffer - might complete later
            buffer = trimmed + '\n' + buffer;
            continue;
          }
          
          handleError(new Error(validation.error || 'Invalid JSON structure'), { line: trimmed });
          continue;
        }

        try {
          const parsed = JSON.parse(trimmed);
          results.push(parsed);
          parseCount++;
        } catch (error: any) {
          // Check if this might be incomplete JSON
          if (isIncompleteJSON(trimmed)) {
            // Put it back in buffer - might complete in next chunk
            buffer = trimmed + '\n' + buffer;
            
            if (verbose) {
              console.log('[NDJSON Parser] Detected incomplete JSON, buffering:', trimmed.substring(0, 50));
            }
            continue;
          }

          // Genuine parse error
          handleError(error, { line: trimmed });
        }
      }

      return results;
    },

    reset(): void {
      if (verbose && buffer.length > 0) {
        console.log('[NDJSON Parser] Resetting with', buffer.length, 'characters in buffer');
      }
      buffer = '';
      parseCount = 0;
      errorCount = 0;
    },

    getBufferedLines(): number {
      return buffer ? 1 : 0;
    },

    getBufferSize(): number {
      return buffer.length;
    },

    finalize(): any[] {
      if (verbose) {
        console.log('[NDJSON Parser] Finalizing with', buffer.length, 'characters in buffer');
      }

      // Try to parse any remaining buffered content
      const trimmed = buffer.trim();
      if (!trimmed) {
        buffer = '';
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed);
        buffer = '';
        return [parsed];
      } catch (error: any) {
        // Final attempt - if it's incomplete JSON, warn but don't fail
        if (isIncompleteJSON(trimmed)) {
          handleError(
            new Error('Stream ended with incomplete JSON in buffer'),
            { line: trimmed.substring(0, 100) }
          );
        } else {
          handleError(error, { line: trimmed });
        }
        buffer = '';
        return [];
      }
    },
  };
}

/**
 * Parse NDJSON stream with async iterator
 *
 * Usage:
 * ```typescript
 * for await (const obj of parseNDJSONStream(readableStream)) {
 *   console.log('Parsed:', obj)
 * }
 * ```
 */
export async function* parseNDJSONStream(
  stream: NodeJS.ReadableStream | ReadableStream,
  options?: NDJSONParserOptions
): AsyncGenerator<any> {
  const parser = createNDJSONParser(options);

  // Handle Node.js streams
  if ('on' in stream) {
    // Node.js ReadableStream
    const nodeStream = stream as NodeJS.ReadableStream

    for await (const chunk of nodeStream) {
      const objects = parser.parse(chunk.toString())
      for (const obj of objects) {
        yield obj
      }
    }
    
    // Finalize to process any remaining buffered data
    const final = parser.finalize();
    for (const obj of final) {
      yield obj;
    }
  } else {
    // Web ReadableStream
    const webStream = stream as ReadableStream
    const reader = webStream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          // Finalize to process any remaining buffered data
          const final = parser.finalize();
          for (const obj of final) {
            yield obj;
          }
          break;
        }

        const objects = parser.parse(new TextDecoder().decode(value))
        for (const obj of objects) {
          yield obj
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}

/**
 * Parse NDJSON from string (for testing)
 */
export function parseNDJSONString(input: string): any[] {
  const parser = createNDJSONParser()
  return parser.parse(input)
}

/**
 * Stringify object to NDJSON line
 */
export function stringifyNDJSON(obj: any): string {
  return JSON.stringify(obj) + '\n'
}

/**
 * Stringify array of objects to NDJSON
 */
export function stringifyNDJSONArray(arr: any[]): string {
  return arr.map(obj => stringifyNDJSON(obj)).join('')
}
