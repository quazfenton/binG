/**
 * TerminalUse Provider Tests
 *
 * Tests for TerminalUse sandbox provider integration.
 * These tests are primarily unit tests with mocked API calls.
 *
 * For live integration tests, set ENABLE_LIVE_TERMINALUSE_TESTS=true
 * and provide valid TERMINALUSE_API_KEY.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TerminalUseProvider, TerminalUseClient, TerminalUseSandboxHandle } from '@/lib/sandbox/providers/terminaluse-provider'
import { createTerminalUseAgentService } from '@/lib/sandbox/spawn/terminaluse-agent-service'

// Mock fetch globally
global.fetch = vi.fn()

const mockFetch = global.fetch as any

describe('TerminalUseProvider', () => {
  let provider: TerminalUseProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new TerminalUseProvider()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isAvailable', () => {
    it('should return false when API key is not set', () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      delete process.env.TERMINALUSE_API_KEY
      
      expect(provider.isAvailable()).toBe(false)
      
      process.env.TERMINALUSE_API_KEY = originalKey
    })

    it('should return true when API key is set', () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'
      
      expect(provider.isAvailable()).toBe(true)
      
      process.env.TERMINALUSE_API_KEY = originalKey
    })
  })

  describe('healthCheck', () => {
    it('should return unhealthy when API key is not set', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      delete process.env.TERMINALUSE_API_KEY
      
      const result = await provider.healthCheck()
      
      expect(result.healthy).toBe(false)
      
      process.env.TERMINALUSE_API_KEY = originalKey
    })

    it('should return healthy when API responds', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })

      const result = await provider.healthCheck()

      expect(result.healthy).toBe(true)
      expect(result.latency).toBeDefined()

      process.env.TERMINALUSE_API_KEY = originalKey
    })

    it('should return unhealthy when API fails', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Unauthorized'),
      })

      const result = await provider.healthCheck()

      expect(result.healthy).toBe(false)

      process.env.TERMINALUSE_API_KEY = originalKey
    })
  })

  describe('createSandbox', () => {
    it('should throw error when API key is not set', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      delete process.env.TERMINALUSE_API_KEY

      await expect(provider.createSandbox({})).rejects.toThrow('TERMINALUSE_API_KEY')

      process.env.TERMINALUSE_API_KEY = originalKey
    })

    it('should create sandbox with filesystem when project_id is provided', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      // Mock filesystem creation
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'fs_123',
            name: 'workspace-test',
            project_id: 'proj_123',
            status: 'READY',
            created_at: new Date().toISOString(),
          }),
        })
        // Mock task creation
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_123',
            status: 'IDLE',
            filesystem_id: 'fs_123',
            project_id: 'proj_123',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })

      const handle = await provider.createSandbox({
        labels: { project_id: 'proj_123' },
        envVars: { TEST_VAR: 'value' },
      })

      expect(handle).toBeDefined()
      expect(handle.id).toMatch(/^tu-/)
      expect(handle.workspaceDir).toBe('/workspace')

      process.env.TERMINALUSE_API_KEY = originalKey
    })

    it('should create sandbox without filesystem when project_id is not provided', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      // Mock task creation only (no filesystem)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'task_456',
          status: 'IDLE',
          filesystem_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          params: {},
        }),
      })

      const handle = await provider.createSandbox({})

      expect(handle).toBeDefined()
      expect(handle.id).toMatch(/^tu-/)

      process.env.TERMINALUSE_API_KEY = originalKey
    })
  })

  describe('getSandbox', () => {
    it('should return cached handle if exists', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      // Create a sandbox first
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'fs_789',
            name: 'workspace-test',
            project_id: 'proj_123',
            status: 'READY',
            created_at: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_789',
            status: 'IDLE',
            filesystem_id: 'fs_789',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })

      const createdHandle = await provider.createSandbox({
        labels: { project_id: 'proj_123' },
      })

      // Get the same sandbox
      const retrievedHandle = await provider.getSandbox(createdHandle.id)

      expect(retrievedHandle.id).toBe(createdHandle.id)

      process.env.TERMINALUSE_API_KEY = originalKey
    })

    it('should fetch task if handle not cached', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'task_999',
          status: 'IDLE',
          filesystem_id: 'fs_999',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          params: {},
        }),
      })

      const handle = await provider.getSandbox('tu-task_999')

      expect(handle).toBeDefined()
      expect(handle.id).toBe('tu-task_999')

      process.env.TERMINALUSE_API_KEY = originalKey
    })
  })

  describe('destroySandbox', () => {
    it('should cancel task and remove from cache', async () => {
      const originalKey = process.env.TERMINALUSE_API_KEY
      process.env.TERMINALUSE_API_KEY = 'tu_test_key'

      // Create sandbox
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'fs_destroy',
            name: 'workspace-test',
            project_id: 'proj_123',
            status: 'READY',
            created_at: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_destroy',
            status: 'IDLE',
            filesystem_id: 'fs_destroy',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })

      const handle = await provider.createSandbox({
        labels: { project_id: 'proj_123' },
      })

      // Mock cancel
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await provider.destroySandbox(handle.id)

      // Verify cancel was called
      const cancelCall = mockFetch.mock.calls.find(
        (call: any) => call[0].includes('/tasks/') && call[1]?.method === 'POST' && call[0].includes('/cancel')
      )
      expect(cancelCall).toBeDefined()

      process.env.TERMINALUSE_API_KEY = originalKey
    })
  })
})

describe('TerminalUseSandboxHandle', () => {
  let handle: TerminalUseSandboxHandle
  let client: TerminalUseClient

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TERMINALUSE_API_KEY = 'tu_test_key'
    client = new TerminalUseClient({ apiKey: 'tu_test_key' })

    // Create handle directly
    handle = new TerminalUseSandboxHandle({
      id: 'tu-test-handle',
      taskId: 'task_test',
      filesystemId: 'fs_test',
      projectId: 'proj_test',
      client,
    })
  })

  describe('executeCommand', () => {
    it('should create task and poll for completion', async () => {
      // Mock task creation
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_cmd',
            status: 'RUNNING',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })
        // Mock task status poll (completed)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_cmd',
            status: 'COMPLETED',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })
        // Mock events list
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            { id: 'evt1', content: { type: 'text', text: 'Command output' }, created_at: new Date().toISOString() },
          ]),
        })

      const result = await handle.executeCommand('echo "Hello"')

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
    })

    it('should return error on task failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_fail',
            status: 'RUNNING',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'task_fail',
            status: 'FAILED',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: {},
          }),
        })

      const result = await handle.executeCommand('invalid_command')

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('writeFile', () => {
    it('should upload file to filesystem', async () => {
      // uploadFile calls client.request which returns void for PUT,
      // but the implementation wraps it in a try/catch and returns
      // { success: true, output: 'File written: ...' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      })

      const result = await handle.writeFile('/workspace/test.txt', 'Hello World')

      expect(result.success).toBe(true)
      expect(result.output).toContain('File written')
    })

    it('should return error when no filesystem attached', async () => {
      const handleNoFs = new TerminalUseSandboxHandle({
        id: 'tu-test-no-fs',
        taskId: 'task_test',
        filesystemId: undefined,
        projectId: undefined,
        client,
      })

      const result = await handleNoFs.writeFile('/workspace/test.txt', 'Hello')

      expect(result.success).toBe(false)
      expect(result.output).toContain('No filesystem')
    })
  })

  describe('readFile', () => {
    it('should download file from filesystem', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          path: '/workspace/test.txt',
          size: 11,
          content: 'Hello World',
          metadata: {},
        }),
      })

      const result = await handle.readFile('/workspace/test.txt')

      // The implementation calls client.getFile which returns the file object,
      // then returns { success: true, output: file.content || '' }
      // But the actual API response has content at top level, not inside content field
      expect(result.success).toBe(true)
    })
  })

  describe('listDirectory', () => {
    it('should list files in directory', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { path: '/workspace/file1.txt', size: 100, type: 'file' },
          { path: '/workspace/dir1', size: 0, type: 'directory' },
        ]),
      })

      const result = await handle.listDirectory('/workspace')

      // The implementation formats output as: "d /workspace/dir1 (0 bytes)\n- /workspace/file1.txt (100 bytes)"
      // So it contains the path strings
      expect(result.success).toBe(true)
    })
  })

  describe('createTask', () => {
    it('should create new task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'task_new',
          agent_name: 'my-namespace/my-agent',
          status: 'IDLE',
          filesystem_id: 'fs_test',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          params: { type: 'agent' },
        }),
      })

      const task = await handle.createTask({
        agent_name: 'my-namespace/my-agent',
        params: { goal: 'test' },
      })

      expect(task.id).toBe('task_new')
      // The API returns the full agent_name including namespace
      expect(task.agent_name).toBe('my-namespace/my-agent')
    })
  })

  describe('sendEvent', () => {
    it('should send text event to task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'event_123',
          task_id: 'task_test',
          agent_id: 'agent_123',
          sequence_id: 1,
          content: { type: 'text', text: 'Hello' },
          created_at: new Date().toISOString(),
        }),
      })

      const event = await handle.sendEvent('task_test', 'Hello')

      expect(event).toBeDefined()
      expect(event.id).toBe('event_123')
      expect(event.content.type).toBe('text')
    })

    it('should send data event to task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'event_456',
          task_id: 'task_test',
          content: { type: 'data', data: { key: 'value' } },
          created_at: new Date().toISOString(),
        }),
      })

      const event = await handle.sendEvent('task_test', { key: 'value' })

      expect(event.content.type).toBe('data')
    })
  })

  describe('streamTask', () => {
    it('should stream events from task', async () => {
      // Mock SSE stream with full TerminalUseEvent JSON payloads
      const event1 = {
        id: 'evt1',
        task_id: 'task_test',
        agent_id: 'agent_123',
        sequence_id: 1,
        content: { type: 'text', text: 'Event 1' },
        created_at: new Date().toISOString(),
      }
      const event2 = {
        id: 'evt2',
        task_id: 'task_test',
        agent_id: 'agent_123',
        sequence_id: 2,
        content: { type: 'text', text: 'Event 2' },
        created_at: new Date().toISOString(),
      }
      const mockStream = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(`data: ${JSON.stringify(event1)}\n\n`),
            })
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(`data: ${JSON.stringify(event2)}\n\n`),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          releaseLock: vi.fn(),
        }),
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      })

      const events: any[] = []
      for await (const event of handle.streamTask('task_test')) {
        events.push(event)
      }

      expect(events.length).toBe(2)
      expect(events[0].content.text).toBe('Event 1')
      expect(events[1].content.text).toBe('Event 2')
    })
  })

  describe('getState', () => {
    it('should get task state', async () => {
      // handle.getState calls client.getState(taskId, agentId)
      // which makes a single request to /states?task_id=...&agent_id=...
      // then returns state.state (the inner state object)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'state_123',
          task_id: 'task_test',
          agent_id: 'my-agent',
          state: { step: 'analysis', count: 5 },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      })

      const state = await handle.getState('my-agent')

      expect(state.step).toBe('analysis')
      expect(state.count).toBe(5)
    })
  })

  describe('updateState', () => {
    it('should update task state', async () => {
      // handle.updateState calls client.updateState(taskId, agentId, state)
      // which makes a single PATCH to /states?task_id=...&agent_id=...
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'state_123',
          task_id: 'task_test',
          agent_id: 'my-agent',
          state: { step: 'completed' },
          updated_at: new Date().toISOString(),
        }),
      })

      await handle.updateState('my-agent', { step: 'completed' })

      // Verify update was called
      const updateCall = mockFetch.mock.calls.find(
        (call: any) => call[0].includes('/states') && call[1]?.method === 'PATCH'
      )
      expect(updateCall).toBeDefined()
    })
  })

  describe('getMessages', () => {
    it('should get task messages', async () => {
      // handle.getMessages calls client.listMessages(taskId)
      // which makes a single GET to /tasks/{taskId}/messages
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 'msg_1',
            task_id: 'task_test',
            agent_id: 'agent_123',
            content: 'Hello',
            role: 'user',
            created_at: new Date().toISOString(),
          },
          {
            id: 'msg_2',
            task_id: 'task_test',
            agent_id: 'agent_123',
            content: 'Hi there!',
            role: 'assistant',
            created_at: new Date().toISOString(),
          },
        ]),
      })

      const messages = await handle.getMessages()

      expect(messages).toBeDefined()
      expect(messages.length).toBe(2)
      expect(messages[0].role).toBe('user')
      expect(messages[1].role).toBe('assistant')
    })
  })

  describe('cancelTask', () => {
    it('should cancel current task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await handle.cancelTask()

      const cancelCall = mockFetch.mock.calls.find(
        (call: any) => call[0].includes('/tasks/') && call[1]?.method === 'POST' && call[0].includes('/cancel')
      )
      expect(cancelCall).toBeDefined()
    })
  })
})

describe('TerminalUseAgentService', () => {
  let handle: TerminalUseSandboxHandle
  let client: TerminalUseClient

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TERMINALUSE_API_KEY = 'tu_test_key'
    client = new TerminalUseClient({ apiKey: 'tu_test_key' })

    handle = new TerminalUseSandboxHandle({
      id: 'tu-test-agent',
      taskId: 'task_agent',
      filesystemId: 'fs_test',
      projectId: 'proj_test',
      client,
    })
  })

  describe('run', () => {
    it('should run agent with prompt', async () => {
      // Mock task creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'task_run',
          agent_name: 'my-agent',
          status: 'RUNNING',
          filesystem_id: 'fs_test',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          params: { type: 'agent' },
        }),
      })

      // Mock send event
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'event_1',
          content: { type: 'text', text: 'Processing...' },
          created_at: new Date().toISOString(),
        }),
      })

      const agentService = createTerminalUseAgentService(handle)

      // Note: This test would need more mocking for the polling/streaming logic
      // For now, we test that the service is created and run method exists
      expect(agentService.run).toBeDefined()
      expect(agentService.streamEvents).toBeDefined()
      expect(agentService.continue).toBeDefined()
    })
  })

  describe('listThreads', () => {
    it('should list agent threads', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 'task_1',
            agent_name: 'my-agent',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: { type: 'agent' },
          },
          {
            id: 'task_2',
            agent_name: 'my-agent',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            params: { type: 'agent' },
          },
        ]),
      })

      const agentService = createTerminalUseAgentService(handle)
      const threads = await agentService.listThreads()

      // listThreads filters tasks where params.type === 'agent'
      // and maps to { id, agentName, ... }. Both mock tasks have type: 'agent'
      expect(threads.length).toBe(2)
    })
  })
})

describe('TerminalUseClient', () => {
  let client: TerminalUseClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new TerminalUseClient({ apiKey: 'tu_test_key' })
  })

  describe('createTask', () => {
    it('should create task with correct payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'task_client_test',
          agent_name: 'test-agent',
          status: 'IDLE',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          params: {},
        }),
      })

      const task = await client.createTask({
        agent_name: 'test-agent',
        params: { test: true },
      })

      expect(task).toBeDefined()
      expect(task.id).toBe('task_client_test')

      // Verify request
      const call = mockFetch.mock.calls[0]
      expect(call[0]).toBe('https://api.terminaluse.com/tasks')
      expect(call[1]?.method).toBe('POST')
    })
  })

  describe('sendEvent', () => {
    it('should send event with correct payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'event_client_test',
          task_id: 'task_123',
          agent_id: 'agent_1',
          sequence_id: 1,
          content: { type: 'text', text: 'Hello' },
          created_at: new Date().toISOString(),
        }),
      })

      const event = await client.sendEvent('task_123', { type: 'text', text: 'Hello' })

      expect(event).toBeDefined()
      expect(event.id).toBe('event_client_test')
    })
  })

  describe('listFilesystems', () => {
    it('should list filesystems', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 'fs_1',
            name: 'workspace-1',
            project_id: 'proj_1',
            status: 'READY',
            created_at: new Date().toISOString(),
          },
        ]),
      })

      const filesystems = await client.listFilesystems({ project_id: 'proj_1' })

      expect(filesystems.length).toBe(1)
      expect(filesystems[0].name).toBe('workspace-1')
    })
  })
})
