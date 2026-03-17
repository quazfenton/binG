/**
 * NDJSON Stream Parser
 * 
 * Robust newline-delimited JSON parser that handles:
 * - Partial chunks (incomplete lines)
 * - Multiple JSON objects per chunk
 * - Empty lines
 * - Whitespace trimming
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
}

/**
 * Create NDJSON parser instance
 */
export function createNDJSONParser(): NDJSONParser {
  let buffer = ''
  
  return {
    parse(chunk: string): any[] {
      // Append chunk to buffer
      buffer += chunk
      
      // Split by newlines
      const lines = buffer.split(/\r?\n/)
      
      // Keep last line in buffer (might be incomplete)
      buffer = lines.pop() || ''
      
      // Parse complete lines
      const results: any[] = []
      
      for (const line of lines) {
        const trimmed = line.trim()
        
        // Skip empty lines
        if (!trimmed) continue
        
        try {
          const parsed = JSON.parse(trimmed)
          results.push(parsed)
        } catch (error: any) {
          // Log parsing error but continue with next line
          console.warn('[NDJSON Parser] Failed to parse line:', {
            error: error.message,
            line: trimmed.substring(0, 100) + (trimmed.length > 100 ? '...' : ''),
          })
        }
      }
      
      return results
    },
    
    reset(): void {
      buffer = ''
    },
    
    getBufferedLines(): number {
      return buffer ? 1 : 0
    },
  }
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
  stream: NodeJS.ReadableStream | ReadableStream
): AsyncGenerator<any> {
  const parser = createNDJSONParser()
  
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
  } else {
    // Web ReadableStream
    const webStream = stream as ReadableStream
    const reader = webStream.getReader()
    
    try {
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break
        
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
