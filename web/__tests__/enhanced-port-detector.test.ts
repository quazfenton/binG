/**
 * E2E Tests: Enhanced Port Detection
 * 
 * Tests the enhanced port detector with various terminal output patterns
 * 
 * @see lib/sandbox/enhanced-port-detector.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  EnhancedPortDetector, 
  enhancedPortDetector,
  detectPorts,
  getDetectedPorts,
  clearDetectedPorts,
  type PortDetectionResult,
} from '@/lib/sandbox/enhanced-port-detector'

describe('Enhanced Port Detector', () => {
  let detector: EnhancedPortDetector

  beforeEach(() => {
    detector = new EnhancedPortDetector()
    clearDetectedPorts()
  })

  afterEach(() => {
    clearDetectedPorts()
  })

  describe('High Confidence Patterns', () => {
    it('should detect localhost pattern', () => {
      const output = 'Server running at localhost:3000'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(3000)
      expect(results[0].confidence).toBe('high')
      expect(results[0].protocol).toBe('http')
      expect(results[0].url).toBe('http://localhost:3000')
    })

    it('should detect 127.0.0.1 pattern', () => {
      const output = 'Listening on 127.0.0.1:8080'
      const results = detector.detectPorts(output)
      
      // May match multiple patterns, but 8080 should be detected
      expect(results.map(r => r.port)).toContain(8080)
      const port8080 = results.find(r => r.port === 8080)
      expect(port8080?.confidence).toBe('high')
    })

    it('should detect 0.0.0.0 pattern', () => {
      const output = 'Bound to 0.0.0.0:4000'
      const results = detector.detectPorts(output)
      
      expect(results.map(r => r.port)).toContain(4000)
    })

    it('should detect "Running on" pattern (E2B)', () => {
      const output = 'Running on http://localhost:5173'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(5173)
      expect(results[0].confidence).toBe('high')
      expect(results[0].source).toBe('running-on')
    })

    it('should detect "Local:" pattern', () => {
      const output = 'Local:   http://localhost:3001'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(3001)
      expect(results[0].confidence).toBe('high')
      expect(results[0].source).toBe('local')
    })

    it('should detect "listening on port" pattern', () => {
      const output = 'App listening on port 8000'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(8000)
      expect(results[0].confidence).toBe('high')
    })

    it('should detect "started on port" pattern', () => {
      const output = 'Server started on port 9000'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(9000)
      expect(results[0].confidence).toBe('high')
    })
  })

  describe('Medium Confidence Patterns', () => {
    it('should detect "Network:" pattern', () => {
      const output = 'Network: http://192.168.1.100:3000'
      const results = detector.detectPorts(output)
      
      expect(results.map(r => r.port)).toContain(3000)
      const port3000 = results.find(r => r.port === 3000)
      expect(port3000?.source).toBe('network')
      // Network is now high confidence
      expect(port3000?.confidence).toBe('high')
    })

    it('should detect "server running at" pattern', () => {
      const output = 'Server running at http://example.com:4000'
      const results = detector.detectPorts(output)
      
      expect(results.map(r => r.port)).toContain(4000)
    })

    it('should detect "exposing port" pattern (Daytona)', () => {
      const output = 'Container exposing port 5432'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(5432)
      expect(results[0].confidence).toBe('medium')
      expect(results[0].source).toBe('exposing')
    })

    it('should detect "bound to" pattern', () => {
      const output = 'Process bound to :8888'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(8888)
      expect(results[0].confidence).toBe('medium')
    })
  })

  describe('Low Confidence Patterns', () => {
    it('should detect "port:" pattern', () => {
      const output = 'Using port: 7000'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(7000)
      expect(results[0].confidence).toBe('low')
      expect(results[0].source).toBe('port-colon')
    })

    it('should detect colon-port pattern', () => {
      const output = 'Connection established :9999'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(1)
      expect(results[0].port).toBe(9999)
      expect(results[0].confidence).toBe('low')
    })
  })

  describe('Multiple Port Detection', () => {
    it('should detect multiple ports in single output', () => {
      const output = `
        Local:   http://localhost:3000
        Network: http://192.168.1.100:3001
        Server bound to :3002
      `
      const results = detector.detectPorts(output)
      
      expect(results.length).toBeGreaterThanOrEqual(2)
      const ports = results.map(r => r.port)
      expect(ports).toContain(3000)
      expect(ports).toContain(3001)
    })

    it('should not duplicate same port', () => {
      const output = 'localhost:3000 and 127.0.0.1:3000'
      const results = detector.detectPorts(output)
      
      // Should only detect once
      const port3000Results = results.filter(r => r.port === 3000)
      expect(port3000Results.length).toBeLessThanOrEqual(1)
    })

    it('should detect ports across multiple calls', () => {
      detector.detectPorts('Server on :3000')
      detector.detectPorts('Database on :5432')
      detector.detectPorts('Redis on :6379')
      
      const allPorts = detector.getDetectedPorts()
      expect(allPorts).toHaveLength(3)
      expect(allPorts.map(p => p.port)).toEqual(expect.arrayContaining([3000, 5432, 6379]))
    })
  })

  describe('Port Validation', () => {
    it('should reject invalid port numbers (below 1)', () => {
      const output = 'Port: 0'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(0)
    })

    it('should reject invalid port numbers (above 65535)', () => {
      const output = 'Port: 99999'
      const results = detector.detectPorts(output)
      
      expect(results).toHaveLength(0)
    })

    it('should accept valid port range', () => {
      const output = 'Listening on port 8080, started on port 443, server running at :3000'
      const results = detector.detectPorts(output)
      
      const ports = results.map(r => r.port)
      expect(ports).toContain(8080)
      expect(ports).toContain(443)
      expect(ports).toContain(3000)
    })
  })

  describe('URL Generation', () => {
    it('should generate URL for HTTP ports', () => {
      const output = 'localhost:3000'
      const results = detector.detectPorts(output)
      
      expect(results[0].url).toBe('http://localhost:3000')
    })

    it('should generate URL for HTTPS ports', () => {
      const output = 'Running on https://localhost:443'
      const results = detector.detectPorts(output)
      
      expect(results[0].url).toBe('https://localhost:443')
    })

    it('should not generate URL for TCP ports', () => {
      const output = 'Database port: 5432'
      const results = detector.detectPorts(output)
      
      expect(results[0].protocol).toBe('tcp')
      expect(results[0].url).toBeUndefined()
    })
  })

  describe('State Management', () => {
    it('should track detected ports', () => {
      detector.detectPorts('Server on :3000')
      
      expect(detector.hasPort(3000)).toBe(true)
      expect(detector.hasPort(4000)).toBe(false)
    })

    it('should get specific port', () => {
      detector.detectPorts('Server on :3000')
      
      const port = detector.getPort(3000)
      expect(port).toBeDefined()
      expect(port?.port).toBe(3000)
    })

    it('should remove specific port', () => {
      detector.detectPorts('Server on :3000')
      detector.removePort(3000)
      
      expect(detector.hasPort(3000)).toBe(false)
    })

    it('should clear all ports', () => {
      detector.detectPorts('Server on :3000')
      detector.detectPorts('Database on :5432')
      detector.clear()
      
      expect(detector.getDetectedPorts()).toHaveLength(0)
    })
  })

  describe('Singleton Instance', () => {
    it('should share state across singleton calls', () => {
      detectPorts('Server on :3000')
      const ports = getDetectedPorts()
      
      expect(ports.length).toBeGreaterThanOrEqual(1)
      expect(ports.map(p => p.port)).toContain(3000)
    })

    it('should clear singleton state', () => {
      detectPorts('Server on :3000')
      clearDetectedPorts()
      const ports = getDetectedPorts()
      
      expect(ports).toHaveLength(0)
    })
  })

  describe('Real-World Terminal Output', () => {
    it('should detect ports in Vite output', () => {
      const viteOutput = `
  VITE v5.0.0  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.100:5173/
  ➜  press h + enter to show help
      `
      const results = detector.detectPorts(viteOutput)
      
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.map(r => r.port)).toContain(5173)
    })

    it('should detect ports in Next.js output', () => {
      const nextOutput = `
  ready - started server on 0.0.0.0:3000, url: http://localhost:3000
      `
      const results = detector.detectPorts(nextOutput)
      
      expect(results.map(r => r.port)).toContain(3000)
    })

    it('should detect ports in Express output', () => {
      const expressOutput = `
  Server listening on port 8080
  Connected to database at localhost:5432
      `
      const results = detector.detectPorts(expressOutput)
      
      expect(results.map(r => r.port)).toEqual(expect.arrayContaining([8080, 5432]))
    })

    it('should detect ports in Python output', () => {
      const pythonOutput = `
  * Running on http://127.0.0.1:5000
  * Running on http://localhost:5000
      `
      const results = detector.detectPorts(pythonOutput)
      
      expect(results.map(r => r.port)).toContain(5000)
    })

    it('should detect ports in Go output', () => {
      const goOutput = `
  2024/01/01 12:00:00 Starting server on :8080
      `
      const results = detector.detectPorts(goOutput)
      
      expect(results.map(r => r.port)).toContain(8080)
    })

    it('should detect ports in Rust output', () => {
      const rustOutput = `
  Listening on http://127.0.0.1:3000
      `
      const results = detector.detectPorts(rustOutput)
      
      expect(results.map(r => r.port)).toContain(3000)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty output', () => {
      const results = detector.detectPorts('')
      expect(results).toHaveLength(0)
    })

    it('should handle output without ports', () => {
      const output = 'Server started successfully'
      const results = detector.detectPorts(output)
      expect(results).toHaveLength(0)
    })

    it('should handle special characters', () => {
      const output = 'Server on :3000! @#$%'
      const results = detector.detectPorts(output)
      expect(results.map(r => r.port)).toContain(3000)
    })

    it('should handle multiline output', () => {
      const output = `
        Line 1: server on :8080
        Line 2: and database on :9000
      `
      const results = detector.detectPorts(output)
      expect(results.map(r => r.port)).toEqual(expect.arrayContaining([8080, 9000]))
    })
  })
})

describe('detectPorts helper function', () => {
  beforeEach(() => {
    clearDetectedPorts()
  })

  it('should return port numbers', () => {
    const ports = detectPorts('Server on localhost:3000 and database on :5432')
    expect(ports).toContain(3000)
    expect(ports).toContain(5432)
  })

  it('should use singleton state', () => {
    detectPorts('First: 3000')
    detectPorts('Second: 4000')
    
    const allPorts = getDetectedPorts()
    expect(allPorts.map(p => p.port)).toEqual(expect.arrayContaining([3000, 4000]))
  })
})
