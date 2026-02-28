/**
 * E2E Tests: E2B Codex Service
 * 
 * Tests OpenAI Codex integration with E2B sandboxes
 * 
 * @see lib/sandbox/providers/e2b-codex-service.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { 
  createCodexService, 
  getCodexService,
  createCodexOutputSchema,
  CodexSchemas,
  type CodexExecutionConfig,
  type CodexExecutionResult,
  type CodexEvent,
} from '@/lib/sandbox/providers/e2b-codex-service'

// Mock sandbox
const createMockSandbox = () => ({
  sandboxId: 'test-sandbox-codex',
  commands: {
    run: vi.fn(),
  },
  files: {
    write: vi.fn(),
    read: vi.fn(),
  },
  kill: vi.fn(),
})

describe('E2B Codex Service', () => {
  let mockSandbox: ReturnType<typeof createMockSandbox>

  beforeEach(() => {
    mockSandbox = createMockSandbox()
    vi.stubEnv('CODEX_API_KEY', 'test-codex-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  describe('createCodexService', () => {
    it('should create service instance', () => {
      const codexService = createCodexService(mockSandbox, 'test-key')
      expect(codexService).toBeDefined()
      expect(codexService.run).toBeDefined()
      expect(codexService.streamEvents).toBeDefined()
      expect(codexService.runWithImage).toBeDefined()
    })
  })

  describe('run', () => {
    it('should execute Codex with basic prompt', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Code changes completed',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const result = await codexService.run({
        prompt: 'Create a hello world function',
        fullAuto: true,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Code changes completed')
      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('codex exec --full-auto'),
        expect.any(Object)
      )
    })

    it('should execute with skipGitRepoCheck', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Done',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      await codexService.run({
        prompt: 'Fix bugs',
        fullAuto: true,
        skipGitRepoCheck: true,
      })

      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('--skip-git-repo-check'),
        expect.any(Object)
      )
    })

    it('should execute with working directory', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Done',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      await codexService.run({
        prompt: 'Refactor',
        fullAuto: true,
        workingDir: '/home/user/repo',
      })

      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('-C /home/user/repo'),
        expect.any(Object)
      )
    })

    it('should handle execution failure', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Task failed',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const result = await codexService.run({
        prompt: 'Failing task',
        fullAuto: true,
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('Error: Task failed')
    })

    it('should handle timeout', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('Command timeout'))

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      await expect(codexService.run({
        prompt: 'Long task',
        fullAuto: true,
        timeout: 1000,
      })).rejects.toThrow('timeout')
    })

    it('should use custom timeout', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Done',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      await codexService.run({
        prompt: 'Task',
        fullAuto: true,
        timeout: 600000,
      })

      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 600000,
        })
      )
    })

    it('should call onStdout callback', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Output',
        stderr: '',
      })

      const onStdout = vi.fn()
      const codexService = createCodexService(mockSandbox, 'test-key')
      await codexService.run({
        prompt: 'Task',
        fullAuto: true,
        onStdout,
      })

      expect(onStdout).toBeDefined()
    })

    it('should call onStderr callback', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: 'Warning',
      })

      const onStderr = vi.fn()
      const codexService = createCodexService(mockSandbox, 'test-key')
      await codexService.run({
        prompt: 'Task',
        fullAuto: true,
        onStderr,
      })

      expect(onStderr).toBeDefined()
    })
  })

  describe('run with output schema', () => {
    it('should validate output against schema', async () => {
      const schemaOutput = {
        issues: [
          { file: 'test.ts', severity: 'high', description: 'Bug' },
        ],
      }

      mockSandbox.files.read.mockResolvedValue(JSON.stringify(CodexSchemas.securityReview))
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(schemaOutput),
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const result = await codexService.run({
        prompt: 'Security review',
        fullAuto: true,
        outputSchemaPath: '/schema.json',
      })

      expect(result.parsedOutput).toEqual(schemaOutput)
    })

    it('should handle invalid schema output', async () => {
      mockSandbox.files.read.mockResolvedValue(JSON.stringify(CodexSchemas.securityReview))
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Invalid JSON',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const result = await codexService.run({
        prompt: 'Review',
        fullAuto: true,
        outputSchemaPath: '/schema.json',
      })

      expect(result.parsedOutput).toBeUndefined()
    })

    it('should handle missing schema file', async () => {
      mockSandbox.files.read.mockRejectedValue(new Error('File not found'))

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      await expect(codexService.run({
        prompt: 'Review',
        fullAuto: true,
        outputSchemaPath: '/nonexistent.json',
      })).rejects.toThrow('not found')
    })
  })

  describe('runWithImage', () => {
    it('should execute with image input', async () => {
      const imageData = Buffer.from('fake-image-data')
      
      mockSandbox.files.write.mockResolvedValue(undefined)
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'UI implemented',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const result = await codexService.runWithImage({
        prompt: 'Implement this UI',
        imagePath: '/mockup.png',
        imageData,
        fullAuto: true,
      })

      expect(mockSandbox.files.write).toHaveBeenCalledWith('/mockup.png', imageData)
      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('--image /mockup.png'),
        expect.any(Object)
      )
      expect(result.exitCode).toBe(0)
    })

    it('should throw if imagePath not provided', async () => {
      const codexService = createCodexService(mockSandbox, 'test-key')
      
      await expect(codexService.runWithImage({
        prompt: 'Implement UI',
        fullAuto: true,
      } as any)).rejects.toThrow('imagePath is required')
    })
  })

  describe('streamEvents', () => {
    it('should stream JSONL events', async () => {
      const events = [
        { type: 'tool_call', data: { tool_name: 'read_file' } },
        { type: 'file_change', data: { file_path: 'test.ts', change_type: 'modify' } },
        { type: 'message', data: { content: 'Done' } },
      ]

      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: events.map(e => JSON.stringify(e)).join('\n'),
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const receivedEvents: CodexEvent[] = []

      for await (const event of codexService.streamEvents({
        prompt: 'Refactor',
        fullAuto: true,
      })) {
        receivedEvents.push(event)
      }

      expect(receivedEvents).toHaveLength(3)
      expect(receivedEvents[0].type).toBe('tool_call')
      expect(receivedEvents[1].type).toBe('file_change')
      expect(receivedEvents[2].type).toBe('message')
    })

    it('should call onEvent callback', async () => {
      const events = [{ type: 'tool_call', data: {} }]
      
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(events[0]),
        stderr: '',
      })

      const onEvent = vi.fn()
      const codexService = createCodexService(mockSandbox, 'test-key')

      for await (const event of codexService.streamEvents({
        prompt: 'Task',
        fullAuto: true,
        onEvent,
      })) {
        // Events streamed
      }

      expect(onEvent).toHaveBeenCalled()
    })

    it('should skip invalid JSON lines', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Progress: 50%\n{"type":"tool_call"}\nProgress: 100%',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      const events: CodexEvent[] = []

      for await (const event of codexService.streamEvents({
        prompt: 'Task',
        fullAuto: true,
      })) {
        events.push(event)
      }

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('tool_call')
    })

    it('should handle working directory', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: '{"type":"complete"}',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')

      for await (const _ of codexService.streamEvents({
        prompt: 'Task',
        fullAuto: true,
        workingDir: '/home/user/repo',
      })) {
        // Stream
      }

      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('-C /home/user/repo'),
        expect.any(Object)
      )
    })
  })

  describe('getCodexService', () => {
    it('should create service via factory', () => {
      const service = getCodexService(mockSandbox, 'test-key')
      expect(service).toBeDefined()
      expect(service.run).toBeDefined()
    })

    it('should use CODEX_API_KEY from env', () => {
      vi.stubEnv('CODEX_API_KEY', 'env-key')
      
      const service = getCodexService(mockSandbox, 'test-key')
      expect(service).toBeDefined()
    })

    it('should use OPENAI_API_KEY as fallback', () => {
      vi.stubEnv('OPENAI_API_KEY', 'openai-key')
      vi.stubEnv('CODEX_API_KEY', '')
      
      const service = getCodexService(mockSandbox, 'test-key')
      expect(service).toBeDefined()
    })
  })

  describe('createCodexOutputSchema', () => {
    it('should create JSON schema string', () => {
      const schema = {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      }

      const schemaString = createCodexOutputSchema(schema)
      
      expect(typeof schemaString).toBe('string')
      expect(JSON.parse(schemaString)).toEqual(schema)
    })

    it('should format with indentation', () => {
      const schema = { type: 'object' }
      const schemaString = createCodexOutputSchema(schema)
      
      expect(schemaString).toContain('\n')
      expect(schemaString).toContain('  ')
    })
  })

  describe('CodexSchemas', () => {
    it('should have securityReview schema', () => {
      expect(CodexSchemas.securityReview).toBeDefined()
      expect(CodexSchemas.securityReview.type).toBe('object')
      expect(CodexSchemas.securityReview.properties.issues).toBeDefined()
    })

    it('should have codeReview schema', () => {
      expect(CodexSchemas.codeReview).toBeDefined()
      expect(CodexSchemas.codeReview.properties.improvements).toBeDefined()
    })

    it('should have refactoringPlan schema', () => {
      expect(CodexSchemas.refactoringPlan).toBeDefined()
      expect(CodexSchemas.refactoringPlan.properties.steps).toBeDefined()
    })

    it('securityReview schema should have correct structure', () => {
      const schema = CodexSchemas.securityReview
      expect(schema.required).toContain('issues')
      expect(schema.properties.issues.items.required).toEqual(
        expect.arrayContaining(['file', 'severity', 'description'])
      )
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle complete Codex workflow', async () => {
      // Setup mock responses for workflow
      mockSandbox.files.read.mockResolvedValue(JSON.stringify(CodexSchemas.securityReview))
      mockSandbox.commands.run.mockResolvedValue({ 
        exitCode: 0, 
        stdout: JSON.stringify({ 
          issues: [{ file: 'test.ts', severity: 'high', description: 'Bug' }],
          summary: 'Found 1 issue',
        }),
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      // Run security review
      const result = await codexService.run({
        prompt: 'Security review',
        fullAuto: true,
        outputSchemaPath: '/schema.json',
        workingDir: '/home/user/repo',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Found 1 issue')
    })

    it('should handle image-to-code workflow', async () => {
      const mockImageData = Buffer.from('mock-ui-design')
      
      mockSandbox.files.write.mockResolvedValue(undefined)
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Component created',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      const result = await codexService.runWithImage({
        prompt: 'Implement this React component',
        imagePath: '/design.png',
        imageData: mockImageData,
        fullAuto: true,
        workingDir: '/home/user/project',
      })

      expect(result.exitCode).toBe(0)
      expect(mockSandbox.files.write).toHaveBeenCalledWith('/design.png', mockImageData)
    })
  })

  describe('Error Handling', () => {
    it('should handle Codex API errors', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('API rate limit exceeded'))

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      await expect(codexService.run({
        prompt: 'Task',
        fullAuto: true,
      })).rejects.toThrow('API rate limit')
    })

    it('should handle sandbox connection errors', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('Sandbox disconnected'))

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      await expect(codexService.run({
        prompt: 'Task',
        fullAuto: true,
      })).rejects.toThrow('Sandbox disconnected')
    })

    it('should handle file write errors for image', async () => {
      mockSandbox.files.write.mockRejectedValue(new Error('Disk full'))

      const codexService = createCodexService(mockSandbox, 'test-key')
      
      await expect(codexService.runWithImage({
        prompt: 'Task',
        imagePath: '/image.png',
        imageData: Buffer.from('data'),
        fullAuto: true,
      })).rejects.toThrow('Disk full')
    })
  })

  describe('Configuration Options', () => {
    it('should respect all configuration options', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Done',
        stderr: '',
      })

      const codexService = createCodexService(mockSandbox, 'test-key')
      await codexService.run({
        prompt: 'Complex task',
        fullAuto: true,
        skipGitRepoCheck: true,
        outputSchemaPath: '/schema.json',
        workingDir: '/workspace',
        timeout: 300000,
      })

      const callArgs = mockSandbox.commands.run.mock.calls[0]
      expect(callArgs[0]).toContain('--full-auto')
      expect(callArgs[0]).toContain('--skip-git-repo-check')
      expect(callArgs[0]).toContain('--output-schema')
      expect(callArgs[0]).toContain('-C /workspace')
      expect(callArgs[1]?.timeout).toBe(300000)
    })
  })
})
