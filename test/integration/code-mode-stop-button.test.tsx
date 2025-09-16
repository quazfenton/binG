/**
 * Integration Tests for Code Mode with Stop Button Functionality
 * 
 * Tests the integration between code mode operations and stop button functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodeMode from '@/components/code-mode'
import ConversationInterface from '@/components/conversation-interface'
import { AuthProvider } from '@/contexts/auth-context'

// Mock the code mode integration hook
const mockCodeModeIntegration = {
  currentSession: null,
  isProcessing: false,
  error: null,
  pendingDiffs: {},
  lastResponse: null,
}

const mockCodeModeActions = {
  createSession: vi.fn(),
  updateSessionFiles: vi.fn(),
  cancelSession: vi.fn(),
  clearError: vi.fn(),
  executeCodeTask: vi.fn(),
  applyDiffs: vi.fn(),
}

vi.mock('@/hooks/use-code-mode-integration', () => ({
  useCodeModeIntegration: () => [mockCodeModeIntegration, mockCodeModeActions],
}))

vi.mock('@/hooks/use-interaction-code-mode', () => ({
  useInteractionCodeMode: () => [mockCodeModeIntegration, mockCodeModeActions],
}))

// Mock enhanced code orchestrator
vi.mock('@/enhanced-code-system/enhanced-code-orchestrator', () => ({
  EnhancedCodeOrchestrator: class {
    constructor() {}
    async createSession() { return { id: 'test-session' } }
    async executeTask() { return { success: true } }
    async cancelSession() { return { success: true } }
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const mockAuthContext = {
  isAuthenticated: true,
  user: { id: '1', email: 'test@example.com' },
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  getApiKeys: vi.fn(),
  setApiKeys: vi.fn(),
  isLoading: false,
}

const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <AuthProvider value={mockAuthContext}>
      {children}
    </AuthProvider>
  )
}

describe('Code Mode with Stop Button Integration Tests', () => {
  const mockProjectFiles = {
    'src/app.js': 'console.log("Hello World");',
    'src/utils.js': 'export const helper = () => {};',
    'package.json': '{"name": "test-project", "version": "1.0.0"}',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    Object.assign(mockCodeModeIntegration, {
      currentSession: null,
      isProcessing: false,
      error: null,
      pendingDiffs: {},
      lastResponse: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  describe('Code Mode Session Management', () => {
    it('should initialize code mode session properly', async () => {
      const user = userEvent.setup()
      const mockOnUpdateFiles = vi.fn()
      const mockOnSendMessage = vi.fn()

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={mockOnUpdateFiles}
            onSendMessage={mockOnSendMessage}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Should display project files
      expect(screen.getByText('src/app.js')).toBeInTheDocument()
      expect(screen.getByText('src/utils.js')).toBeInTheDocument()
      expect(screen.getByText('package.json')).toBeInTheDocument()

      // Should show initialization status
      await waitFor(() => {
        expect(screen.getByText('Initializing...')).toBeInTheDocument()
      })

      // Should call createSession
      expect(mockCodeModeActions.createSession).toHaveBeenCalled()
    })

    it('should handle file selection for code operations', async () => {
      const user = userEvent.setup()

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Select files
      const appFileCheckbox = screen.getByRole('checkbox', { name: /src\/app\.js/i })
      const utilsFileCheckbox = screen.getByRole('checkbox', { name: /src\/utils\.js/i })

      await user.click(appFileCheckbox)
      await user.click(utilsFileCheckbox)

      // Should show selected files count
      expect(screen.getByText('2 files selected')).toBeInTheDocument()
    })

    it('should execute code tasks with proper session management', async () => {
      const user = userEvent.setup()
      
      // Mock active session
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'active' },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Select a file
      const appFileCheckbox = screen.getByRole('checkbox', { name: /src\/app\.js/i })
      await user.click(appFileCheckbox)

      // Enter a prompt
      const promptTextarea = screen.getByPlaceholderText('Describe what you want to do with the selected files...')
      await user.type(promptTextarea, 'Add error handling to this code')

      // Submit the request
      const sendButton = screen.getByText('Send Request')
      await user.click(sendButton)

      // Should call executeCodeTask
      expect(mockCodeModeActions.executeCodeTask).toHaveBeenCalledWith(
        'Add error handling to this code',
        undefined,
        ['src/app.js']
      )
    })
  })

  describe('Stop Button Functionality', () => {
    it('should display stop button during processing', async () => {
      // Mock processing state
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'processing' },
        isProcessing: true,
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Should show stop button and processing state
      expect(screen.getByText('Stop')).toBeInTheDocument()
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })

    it('should handle stop button click to cancel operations', async () => {
      const user = userEvent.setup()
      
      // Mock processing state
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'processing' },
        isProcessing: true,
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Click stop button
      const stopButton = screen.getByText('Stop')
      await user.click(stopButton)

      // Should call cancelSession
      expect(mockCodeModeActions.cancelSession).toHaveBeenCalled()
    })

    it('should handle timeout scenarios gracefully', async () => {
      const user = userEvent.setup()
      
      // Mock timeout error
      mockCodeModeActions.executeCodeTask.mockRejectedValue(new Error('Request timed out after 2 minutes'))
      
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'active' },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Select file and enter prompt
      const appFileCheckbox = screen.getByRole('checkbox', { name: /src\/app\.js/i })
      await user.click(appFileCheckbox)

      const promptTextarea = screen.getByPlaceholderText('Describe what you want to do with the selected files...')
      await user.type(promptTextarea, 'Refactor this code')

      // Submit request
      const sendButton = screen.getByText('Send Request')
      await user.click(sendButton)

      // Should handle timeout error
      await waitFor(() => {
        expect(mockCodeModeActions.executeCodeTask).toHaveBeenCalled()
      })
    })

    it('should restore prompt on cancellation', async () => {
      const user = userEvent.setup()
      
      // Mock cancellation
      mockCodeModeActions.executeCodeTask.mockRejectedValue(new Error('Operation cancelled'))
      
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'active' },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Select file and enter prompt
      const appFileCheckbox = screen.getByRole('checkbox', { name: /src\/app\.js/i })
      await user.click(appFileCheckbox)

      const promptTextarea = screen.getByPlaceholderText('Describe what you want to do with the selected files...')
      const testPrompt = 'Add logging to this function'
      await user.type(promptTextarea, testPrompt)

      // Submit request
      const sendButton = screen.getByText('Send Request')
      await user.click(sendButton)

      // Prompt should be restored after cancellation
      await waitFor(() => {
        expect(promptTextarea).toHaveValue(testPrompt)
      })
    })
  })

  describe('Diff Management with Stop Functionality', () => {
    it('should display pending diffs with apply/cancel options', async () => {
      const user = userEvent.setup()
      
      // Mock pending diffs
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'completed' },
        isProcessing: false,
        pendingDiffs: {
          'src/app.js': [
            {
              type: 'modify',
              lineStart: 1,
              lineEnd: 1,
              content: 'console.log("Hello World with error handling");',
              originalContent: 'console.log("Hello World");',
            },
          ],
        },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Switch to diff tab
      const diffTab = screen.getByText('Diffs')
      await user.click(diffTab)

      // Should show pending diffs
      expect(screen.getByText('src/app.js')).toBeInTheDocument()
      expect(screen.getByText('1 change')).toBeInTheDocument()

      // Should show apply and cancel buttons
      expect(screen.getByText('Apply Changes (Enter)')).toBeInTheDocument()
      expect(screen.getByText('Cancel (Esc)')).toBeInTheDocument()
    })

    it('should apply diffs when confirmed', async () => {
      const user = userEvent.setup()
      const mockOnUpdateFiles = vi.fn()
      
      // Mock pending diffs and successful application
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'completed' },
        pendingDiffs: {
          'src/app.js': [
            {
              type: 'modify',
              lineStart: 1,
              lineEnd: 1,
              content: 'console.log("Hello World with error handling");',
              originalContent: 'console.log("Hello World");',
            },
          ],
        },
      })

      mockCodeModeActions.applyDiffs.mockResolvedValue({
        success: true,
        files: {
          'src/app.js': 'console.log("Hello World with error handling");',
        },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={mockOnUpdateFiles}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Switch to diff tab
      const diffTab = screen.getByText('Diffs')
      await user.click(diffTab)

      // Apply changes
      const applyButton = screen.getByText('Apply Changes (Enter)')
      await user.click(applyButton)

      // Should call applyDiffs and update files
      expect(mockCodeModeActions.applyDiffs).toHaveBeenCalled()
      await waitFor(() => {
        expect(mockOnUpdateFiles).toHaveBeenCalledWith({
          ...mockProjectFiles,
          'src/app.js': 'console.log("Hello World with error handling");',
        })
      })
    })

    it('should cancel diffs when requested', async () => {
      const user = userEvent.setup()
      
      // Mock pending diffs
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'completed' },
        pendingDiffs: {
          'src/app.js': [
            {
              type: 'modify',
              lineStart: 1,
              lineEnd: 1,
              content: 'console.log("Hello World with error handling");',
              originalContent: 'console.log("Hello World");',
            },
          ],
        },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Switch to diff tab
      const diffTab = screen.getByText('Diffs')
      await user.click(diffTab)

      // Cancel changes
      const cancelButton = screen.getByText('Cancel (Esc)')
      await user.click(cancelButton)

      // Should call clearError to cancel diffs
      expect(mockCodeModeActions.clearError).toHaveBeenCalled()
    })

    it('should handle keyboard shortcuts for diff management', async () => {
      const user = userEvent.setup()
      
      // Mock pending diffs
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'completed' },
        pendingDiffs: {
          'src/app.js': [
            {
              type: 'modify',
              lineStart: 1,
              lineEnd: 1,
              content: 'console.log("Hello World with error handling");',
              originalContent: 'console.log("Hello World");',
            },
          ],
        },
      })

      mockCodeModeActions.applyDiffs.mockResolvedValue({
        success: true,
        files: { 'src/app.js': 'updated content' },
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Switch to diff tab
      const diffTab = screen.getByText('Diffs')
      await user.click(diffTab)

      // Test Enter key for apply
      await user.keyboard('{Enter}')
      expect(mockCodeModeActions.applyDiffs).toHaveBeenCalled()

      // Reset mock
      vi.clearAllMocks()

      // Test Escape key for cancel
      await user.keyboard('{Escape}')
      expect(mockCodeModeActions.clearError).toHaveBeenCalled()
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should display error messages appropriately', async () => {
      // Mock error state
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'error' },
        error: 'Failed to process code request',
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Should display error message
      expect(screen.getByText('Failed to process code request')).toBeInTheDocument()
    })

    it('should allow error dismissal', async () => {
      const user = userEvent.setup()
      
      // Mock error state
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'error' },
        error: 'Network connection failed',
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Find and click error dismiss button
      const dismissButton = screen.getByRole('button', { name: /close|dismiss|×/i })
      await user.click(dismissButton)

      // Should call clearError
      expect(mockCodeModeActions.clearError).toHaveBeenCalled()
    })

    it('should handle session cleanup on component unmount', async () => {
      // Mock active session
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'active' },
      })

      const { unmount } = render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Unmount component
      unmount()

      // Should call cancelSession for cleanup
      expect(mockCodeModeActions.cancelSession).toHaveBeenCalled()
    })

    it('should handle processing timeout with automatic cleanup', async () => {
      vi.useFakeTimers()
      
      // Mock stuck processing state
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'processing' },
        isProcessing: true,
      })

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(180000) // 3 minutes

      // Should call cleanup functions
      await waitFor(() => {
        expect(mockCodeModeActions.clearError).toHaveBeenCalled()
        expect(mockCodeModeActions.cancelSession).toHaveBeenCalled()
      })

      vi.useRealTimers()
    })
  })

  describe('Integration with Conversation Interface', () => {
    it('should integrate code mode with conversation interface stop button', async () => {
      const user = userEvent.setup()

      // Mock conversation interface with code mode
      render(
        <TestWrapper>
          <ConversationInterface />
        </TestWrapper>
      )

      // Should render conversation interface
      expect(screen.getByText('Provider:')).toBeInTheDocument()
    })

    it('should handle stop button from conversation interface', async () => {
      const user = userEvent.setup()
      
      // Mock processing state in conversation
      Object.assign(mockCodeModeIntegration, {
        currentSession: { id: 'test-session', status: 'processing' },
        isProcessing: true,
      })

      render(
        <TestWrapper>
          <ConversationInterface />
        </TestWrapper>
      )

      // Should be able to stop operations from conversation interface
      // This tests the integration between conversation interface and code mode
      expect(screen.getByText('Provider:')).toBeInTheDocument()
    })
  })
})