/**
 * Enhanced Port Detection
 * 
 * Detects port numbers from terminal output with higher accuracy
 * Supports E2B, Daytona, Sprites, and generic patterns
 * 
 * @see https://e2b.dev/docs/sandbox/port-detection
 * @see https://www.daytona.io/docs/en/preview.md
 */

export interface PortDetectionResult {
  /** Detected port number */
  port: number
  
  /** Protocol type */
  protocol: 'http' | 'https' | 'tcp'
  
  /** Pattern that matched */
  source: string
  
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low'
  
  /** Full URL if HTTP/HTTPS */
  url?: string
}

interface PortPattern {
  pattern: RegExp
  protocol: 'http' | 'https' | 'tcp'
  confidence: 'high' | 'medium' | 'low'
  name: string
}

/**
 * Enhanced port detector class
 */
export class EnhancedPortDetector {
  private detectedPorts = new Map<number, PortDetectionResult>()
  
  private patterns: PortPattern[] = [
    // ==================== High Confidence Patterns ====================
    // Order matters - more specific patterns first
    
    {
      pattern: /Running on (?:https?:\/\/)?(?:[^:\s]+):(\d+)/gi,
      protocol: 'http',
      confidence: 'high',
      name: 'running-on',
    },
    {
      pattern: /Local:\s+(?:https?:\/\/)?(?:[^:\s]+):(\d+)/gi,
      protocol: 'http',
      confidence: 'high',
      name: 'local',
    },
    {
      pattern: /Network:\s+(?:https?:\/\/)?(?:[^:\s]+):(\d+)/gi,
      protocol: 'http',
      confidence: 'high',
      name: 'network',
    },
    {
      pattern: /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/gi,
      protocol: 'http',
      confidence: 'high',
      name: 'listening',
    },
    {
      pattern: /started\s+(?:on\s+)?(?:port\s+)?(\d+)/gi,
      protocol: 'http',
      confidence: 'high',
      name: 'started',
    },
    {
      pattern: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/g,
      protocol: 'http',
      confidence: 'high',
      name: 'localhost',
    },
    
    // ==================== Medium Confidence Patterns ====================
    
    {
      pattern: /server\s+(?:running|started)\s+(?:at|on)\s+[^:]*:(\d+)/gi,
      protocol: 'http',
      confidence: 'medium',
      name: 'server',
    },
    {
      pattern: /exposing\s+port\s+(\d+)/gi,
      protocol: 'tcp',
      confidence: 'medium',
      name: 'exposing',
    },
    {
      pattern: /bound\s+(?:to\s+)?(?:.*?:)?(\d+)/gi,
      protocol: 'tcp',
      confidence: 'medium',
      name: 'bound',
    },
    
    // ==================== Low Confidence Patterns (Catch-all) ====================
    
    {
      pattern: /port[:\s]+(\d+)/gi,
      protocol: 'tcp',
      confidence: 'low',
      name: 'port-colon',
    },
    {
      pattern: /:\s*(\d{2,5})\s*(?:\/|$)/g,
      protocol: 'tcp',
      confidence: 'low',
      name: 'colon-number',
    },
    {
      pattern: /:(\d{2,5})\b/g,
      protocol: 'tcp',
      confidence: 'low',
      name: 'colon-port',
    },
  ]

  /**
   * Detect ports in output text
   * 
   * @param output - Terminal output text to scan for ports
   * @returns Array of detected ports
   * 
   * @example
   * ```typescript
   * const detector = new EnhancedPortDetector()
   * const ports = detector.detectPorts('Server running on http://localhost:3000')
   * console.log(ports) // [{ port: 3000, protocol: 'http', confidence: 'high', ... }]
   * ```
   */
  detectPorts(output: string): PortDetectionResult[] {
    const results: PortDetectionResult[] = []
    const seenPorts = new Set<number>()

    for (const { pattern, protocol, confidence, name } of this.patterns) {
      // Reset regex lastIndex
      pattern.lastIndex = 0
      
      const matches = output.matchAll(pattern)
      
      for (const match of matches) {
        const port = parseInt(match[1], 10)
        
        // Validate port range (valid ports are 1-65535)
        if (port < 1 || port > 65535) continue
        
        // Skip if already detected (avoid duplicates, prefer higher confidence)
        if (seenPorts.has(port)) continue
        
        // Check for HTTPS
        const fullMatch = match[0]
        const isHttps = fullMatch.toLowerCase().includes('https://')
        const finalProtocol = isHttps ? 'https' : protocol
        
        const result: PortDetectionResult = {
          port,
          protocol: finalProtocol,
          source: name,
          confidence,
          url: finalProtocol === 'http' || finalProtocol === 'https'
            ? `${finalProtocol}://localhost:${port}`
            : undefined,
        }

        seenPorts.add(port)
        this.detectedPorts.set(port, result)
        results.push(result)
      }
    }

    return results
  }

  /**
   * Get all detected ports
   */
  getDetectedPorts(): PortDetectionResult[] {
    return Array.from(this.detectedPorts.values())
  }

  /**
   * Check if port was detected
   */
  hasPort(port: number): boolean {
    return this.detectedPorts.has(port)
  }

  /**
   * Get specific port detection result
   */
  getPort(port: number): PortDetectionResult | undefined {
    return this.detectedPorts.get(port)
  }

  /**
   * Clear detected ports
   */
  clear(): void {
    this.detectedPorts.clear()
  }

  /**
   * Remove specific port from detected list
   */
  removePort(port: number): boolean {
    return this.detectedPorts.delete(port)
  }
}

/**
 * Singleton instance for shared port detection
 */
export const enhancedPortDetector = new EnhancedPortDetector()

/**
 * Quick port detection function
 * 
 * @param output - Terminal output text
 * @returns Array of detected port numbers
 */
export function detectPorts(output: string): number[] {
  return enhancedPortDetector.detectPorts(output).map(p => p.port)
}

/**
 * Get all detected ports
 */
export function getDetectedPorts(): PortDetectionResult[] {
  return enhancedPortDetector.getDetectedPorts()
}

/**
 * Clear all detected ports
 */
export function clearDetectedPorts(): void {
  enhancedPortDetector.clear()
}
