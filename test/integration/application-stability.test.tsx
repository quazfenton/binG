/**
 * Integration Tests for Application Stability Improvements
 * 
 * This test suite covers the integration testing requirements from task 7.1:
 * - Test UI reorganization with authentication system
 * - Verify code mode works with stop button functionality  
 * - Test complete user workflow from registration to code operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '@/contexts/auth-context'
import InteractionPanel from '@/components/interaction-panel'
import AccessibilityControls from '@/components/accessibility-controls'
import CodeMode from '@/components/code-mode'
import ConversationInterface from '@/components/conversation-interface'

// Mock dependencies
vi.mock('@/lib/api/llm-providers', () => ({
  defaultProviders: [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      models: ['deepseek/deepseek-r1-0528:free'],
    },
  ],
}))

vi.mock('@/hooks/use-interaction-code-mode', () => ({
  useInteractionCodeMode: () => [
    {
      currentSession: null,
      isProcessing: false,
      error: null,
      pendingDiffs: {},
      lastResponse: null,
    },
    {
      createSession: vi.fn(),
      updateSessionFiles: vi.fn(),
      cancelSession: vi.fn(),
      clearError: vi.fn(),
      executeCodeTask: vi.fn(),
      applyDiffs: vi.fn(),
    },
  ],
}))

vi.mock('@/hooks/use-code-mode-integration', () => ({
  useCodeModeIntegration: () => [
    {
      currentSession: null,
      isProcessing: false,
      error: null,
      pendingDiffs: {},
      lastResponse: null,
    },
    {
      createSession: vi.fn(),
      updateSessionFiles: vi.fn(),
      cancelSession: vi.fn(),
      clearError: vi.fn(),
      executeCodeTask: vi.fn(),
      applyDiffs: vi.fn(),
    },
  ],
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock auth context
const mockAuthContext = {
  isAuthenticated: false,
  user: null,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  getApiKeys: vi.fn(),
  setApiKeys: vi.fn(),
  isLoading: false,
}

// Test wrapper component
const TestWrapper = ({ children, authOverrides = {} }: { children: React.ReactNode; authOverrides?: any }) => {
  const authValue = { ...mockAuthContext, ...authOverrides }
  return (
    <AuthProvider value={authValue}>
      {children}
    </AuthProvider>
  )
}

describe('Application Stability Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset fetch mock
    global.fetch = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('UI Reorganization with Authentication System', () => {
    it('should display authentication options when user is not logged in', async () => {
      const user = userEvent.setup()
      
      render(
        <TestWrapper>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Should show sign up and sign in buttons
      expect(screen.getByText('Sign Up')).toBeInTheDocument()
      expect(screen.getByText('Sign In')).toBeInTheDocument()
      expect(screen.getByText('Sign up for unlimited prompts and exclusive features')).toBeInTheDocument()
    })

    it('should display user profile when authenticated', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        subscriptionTier: 'premium' as const,
      }

      render(
        <TestWrapper authOverrides={{ isAuthenticated: true, user: mockUser }}>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Should show user email and premium status
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
      expect(screen.getByText('Premium Account')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('should reorganize plugin tabs correctly', async () => {
      const mockProviders = [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          models: ['deepseek/deepseek-r1-0528:free'],
        },
      ]

      render(
        <TestWrapper>
          <InteractionPanel
            onSubmit={vi.fn()}
            onNewChat={vi.fn()}
            isProcessing={false}
            toggleAccessibility={vi.fn()}
            toggleHistory={vi.fn()}
            toggleCodePreview={vi.fn()}
            toggleCodeMode={vi.fn()}
            onStopGeneration={vi.fn()}
            onRetry={vi.fn()}
            currentProvider="openrouter"
            currentModel="deepseek/deepseek-r1-0528:free"
            error={null}
            input=""
            setInput={vi.fn()}
            availableProviders={mockProviders}
            onProviderChange={vi.fn()}
            hasCodeBlocks={false}
            pendingDiffs={[]}
            activeTab="chat"
            onActiveTabChange={vi.fn()}
          />
        </TestWrapper>
      )

      // Check that tabs are properly organized
      expect(screen.getByText('Plugins')).toBeInTheDocument()
      expect(screen.getByText('Extra')).toBeInTheDocument()
      
      // The "Images" tab should have been renamed to "Extra"
      expect(screen.queryByText('Images')).not.toBeInTheDocument()
    })

    it('should handle theme switching for authenticated users', async () => {
      const user = userEvent.setup()
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        subscriptionTier: 'premium' as const,
      }

      render(
        <TestWrapper authOverrides={{ isAuthenticated: true, user: mockUser }}>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Should be able to select different themes
      const pinkTheme = screen.getByText('Pink Noir')
      expect(pinkTheme).toBeInTheDocument()
      
      await user.click(pinkTheme)
      // Theme should be selectable for premium users
      expect(pinkTheme.closest('button')).not.toHaveClass('cursor-not-allowed')
    })

    it('should restrict theme access for non-authenticated users', async () => {
      render(
        <TestWrapper>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Premium themes should be disabled for non-authenticated users
      const pinkTheme = screen.getByText('Pink Noir')
      expect(pinkTheme.closest('button')).toHaveClass('cursor-not-allowed')
      
      // Crown icon should be visible for premium themes
      const crownIcons = screen.getAllByTestId('crown-icon') || screen.getAllByRole('img', { name: /crown/i })
      expect(crownIcons.length).toBeGreaterThan(0)
    })
  })

  describe('Code Mode with Stop Button Functionality', () => {
    const mockProjectFiles = {
      'src/test.js': 'console.log("test");',
      'src/utils.js': 'export const helper = () => {};',
    }

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
      expect(screen.getByText('src/test.js')).toBeInTheDocument()
      expect(screen.getByText('src/utils.js')).toBeInTheDocument()
      
      // Should show session initialization
      await waitFor(() => {
        expect(screen.getByText('Initializing...')).toBeInTheDocument()
      })
    })

    it('should handle file selection and code requests', async () => {
      const user = userEvent.setup()
      const mockOnSendMessage = vi.fn()

      render(
        <TestWrapper>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={mockOnSendMessage}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Select files
      const testFileCheckbox = screen.getByRole('checkbox', { name: /src\/test\.js/i })
      await user.click(testFileCheckbox)

      // Enter a prompt
      const promptTextarea = screen.getByPlaceholderText('Describe what you want to do with the selected files...')
      await user.type(promptTextarea, 'Add error handling to this code')

      // Should be able to send request when files are selected and prompt is entered
      const sendButton = screen.getByText('Send Request')
      expect(sendButton).not.toBeDisabled()
    })

    it('should display stop button during processing', async () => {
      const user = userEvent.setup()
      
      // Mock processing state
      vi.mocked(require('@/hooks/use-code-mode-integration').useCodeModeIntegration).mockReturnValue([
        {
          currentSession: { id: 'test-session', status: 'processing' },
          isProcessing: true,
          error: null,
          pendingDiffs: {},
          lastResponse: null,
        },
        {
          createSession: vi.fn(),
          updateSessionFiles: vi.fn(),
          cancelSession: vi.fn(),
          clearError: vi.fn(),
          executeCodeTask: vi.fn(),
          applyDiffs: vi.fn(),
        },
      ])

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

      // Should show stop button when processing
      expect(screen.getByText('Stop')).toBeInTheDocument()
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })

    it('should handle diff application and cancellation', async () => {
      const user = userEvent.setup()
      const mockApplyDiffs = vi.fn()
      const mockClearError = vi.fn()

      // Mock pending diffs state
      vi.mocked(require('@/hooks/use-code-mode-integration').useCodeModeIntegration).mockReturnValue([
        {
          currentSession: { id: 'test-session', status: 'completed' },
          isProcessing: false,
          error: null,
          pendingDiffs: {
            'src/test.js': [
              {
                type: 'modify',
                lineStart: 1,
                lineEnd: 1,
                content: 'console.log("test with error handling");',
                originalContent: 'console.log("test");',
              },
            ],
          },
          lastResponse: null,
        },
        {
          createSession: vi.fn(),
          updateSessionFiles: vi.fn(),
          cancelSession: vi.fn(),
          clearError: mockClearError,
          executeCodeTask: vi.fn(),
          applyDiffs: mockApplyDiffs,
        },
      ])

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

      // Switch to diff tab to see pending changes
      const diffTab = screen.getByText('Diffs')
      await user.click(diffTab)

      // Should show pending diffs
      expect(screen.getByText('src/test.js')).toBeInTheDocument()
      expect(screen.getByText('1 change')).toBeInTheDocument()

      // Should show apply and cancel buttons
      const applyButton = screen.getByText('Apply Changes (Enter)')
      const cancelButton = screen.getByText('Cancel (Esc)')
      
      expect(applyButton).toBeInTheDocument()
      expect(cancelButton).toBeInTheDocument()

      // Test apply functionality
      await user.click(applyButton)
      expect(mockApplyDiffs).toHaveBeenCalled()

      // Test cancel functionality
      await user.click(cancelButton)
      expect(mockClearError).toHaveBeenCalled()
    })
  })

  describe('Complete User Workflow: Registration to Code Operations', () => {
    it('should complete full user workflow from registration to code operations', async () => {
      const user = userEvent.setup()
      const mockRegister = vi.fn().mockResolvedValue({ success: true })
      const mockLogin = vi.fn().mockResolvedValue({ success: true })

      // Start with unauthenticated state
      const { rerender } = render(
        <TestWrapper authOverrides={{ register: mockRegister, login: mockLogin }}>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Step 1: User sees sign up option
      expect(screen.getByText('Sign Up')).toBeInTheDocument()
      
      // Step 2: User clicks sign up
      await user.click(screen.getByText('Sign Up'))
      
      // Should trigger registration flow
      expect(mockRegister).toHaveBeenCalled()

      // Step 3: Simulate successful authentication
      const authenticatedUser = {
        id: '1',
        email: 'newuser@example.com',
        subscriptionTier: 'free' as const,
      }

      rerender(
        <TestWrapper authOverrides={{ 
          isAuthenticated: true, 
          user: authenticatedUser,
          register: mockRegister,
          login: mockLogin 
        }}>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Step 4: User should now see their profile
      expect(screen.getByText('newuser@example.com')).toBeInTheDocument()
      expect(screen.getByText('Free Account')).toBeInTheDocument()

      // Step 5: Test code mode functionality for authenticated user
      const { rerender: rerenderCodeMode } = render(
        <TestWrapper authOverrides={{ isAuthenticated: true, user: authenticatedUser }}>
          <CodeMode
            projectFiles={mockProjectFiles}
            onUpdateFiles={vi.fn()}
            onSendMessage={vi.fn()}
            isVisible={true}
            onClose={vi.fn()}
          />
        </TestWrapper>
      )

      // Should be able to use code mode
      expect(screen.getByText('Code Mode')).toBeInTheDocument()
      expect(screen.getByText('Project Files')).toBeInTheDocument()
    })

    it('should handle authentication errors gracefully', async () => {
      const user = userEvent.setup()
      const mockRegister = vi.fn().mockRejectedValue(new Error('Email already exists'))

      render(
        <TestWrapper authOverrides={{ register: mockRegister }}>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Try to register
      await user.click(screen.getByText('Sign Up'))
      
      // Should handle error
      expect(mockRegister).toHaveBeenCalled()
      
      // User should still see sign up options after error
      await waitFor(() => {
        expect(screen.getByText('Sign Up')).toBeInTheDocument()
      })
    })

    it('should maintain session state across component interactions', async () => {
      const user = userEvent.setup()
      const authenticatedUser = {
        id: '1',
        email: 'test@example.com',
        subscriptionTier: 'premium' as const,
      }

      // Test that authentication state persists across different components
      const { rerender } = render(
        <TestWrapper authOverrides={{ isAuthenticated: true, user: authenticatedUser }}>
          <InteractionPanel
            onSubmit={vi.fn()}
            onNewChat={vi.fn()}
            isProcessing={false}
            toggleAccessibility={vi.fn()}
            toggleHistory={vi.fn()}
            toggleCodePreview={vi.fn()}
            toggleCodeMode={vi.fn()}
            onStopGeneration={vi.fn()}
            onRetry={vi.fn()}
            currentProvider="openrouter"
            currentModel="deepseek/deepseek-r1-0528:free"
            error={null}
            input=""
            setInput={vi.fn()}
            availableProviders={[]}
            onProviderChange={vi.fn()}
            hasCodeBlocks={false}
            pendingDiffs={[]}
            activeTab="chat"
            onActiveTabChange={vi.fn()}
          />
        </TestWrapper>
      )

      // Should have access to premium features
      expect(screen.getByText('Plugins')).toBeInTheDocument()
      expect(screen.getByText('Extra')).toBeInTheDocument()

      // Switch to accessibility controls
      rerender(
        <TestWrapper authOverrides={{ isAuthenticated: true, user: authenticatedUser }}>
          <AccessibilityControls
            onClose={vi.fn()}
            messages={[]}
            isProcessing={false}
            voiceEnabled={false}
            onVoiceToggle={vi.fn()}
          />
        </TestWrapper>
      )

      // Should still show authenticated state
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
      expect(screen.getByText('Premium Account')).toBeInTheDocument()
    })

    it('should handle code operations with proper error boundaries', async () => {
      const user = userEvent.setup()
      const mockExecuteCodeTask = vi.fn().mockRejectedValue(new Error('Code execution failed'))

      // Mock error state
      vi.mocked(require('@/hooks/use-code-mode-integration').useCodeModeIntegration).mockReturnValue([
        {
          currentSession: { id: 'test-session', status: 'error' },
          isProcessing: false,
          error: 'Code execution failed',
          pendingDiffs: {},
          lastResponse: null,
        },
        {
          createSession: vi.fn(),
          updateSessionFiles: vi.fn(),
          cancelSession: vi.fn(),
          clearError: vi.fn(),
          executeCodeTask: mockExecuteCodeTask,
          applyDiffs: vi.fn(),
        },
      ])

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

      // Should display error state
      expect(screen.getByText('Code execution failed')).toBeInTheDocument()
      
      // Should still allow user to interact with the interface
      expect(screen.getByText('Project Files')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Describe what you want to do with the selected files...')).toBeInTheDocument()
    })
  })

  describe('TypeScript Compilation and Render Loop Prevention', () => {
    it('should not cause infinite render loops in components', async () => {
      const renderCount = { current: 0 }
      
      const TestComponent = () => {
        renderCount.current++
        return (
          <TestWrapper>
            <InteractionPanel
              onSubmit={vi.fn()}
              onNewChat={vi.fn()}
              isProcessing={false}
              toggleAccessibility={vi.fn()}
              toggleHistory={vi.fn()}
              toggleCodePreview={vi.fn()}
              toggleCodeMode={vi.fn()}
              onStopGeneration={vi.fn()}
              onRetry={vi.fn()}
              currentProvider="openrouter"
              currentModel="deepseek/deepseek-r1-0528:free"
              error={null}
              input=""
              setInput={vi.fn()}
              availableProviders={[]}
              onProviderChange={vi.fn()}
              hasCodeBlocks={false}
              pendingDiffs={[]}
              activeTab="chat"
              onActiveTabChange={vi.fn()}
            />
          </TestWrapper>
        )
      }

      render(<TestComponent />)
      
      // Wait a bit to see if there are excessive re-renders
      await waitFor(() => {
        expect(renderCount.current).toBeLessThan(5) // Allow for initial renders but prevent loops
      }, { timeout: 1000 })
    })

    it('should handle component cleanup properly', async () => {
      const mockCleanup = vi.fn()
      
      const TestComponent = ({ visible }: { visible: boolean }) => {
        React.useEffect(() => {
          return mockCleanup
        }, [])
        
        if (!visible) return null
        
        return (
          <TestWrapper>
            <CodeMode
              projectFiles={mockProjectFiles}
              onUpdateFiles={vi.fn()}
              onSendMessage={vi.fn()}
              isVisible={visible}
              onClose={vi.fn()}
            />
          </TestWrapper>
        )
      }

      const { rerender, unmount } = render(<TestComponent visible={true} />)
      
      // Hide component
      rerender(<TestComponent visible={false} />)
      
      // Unmount completely
      unmount()
      
      // Cleanup should have been called
      expect(mockCleanup).toHaveBeenCalled()
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle network errors gracefully', async () => {
      // Mock network error
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      render(
        <TestWrapper>
          <ConversationInterface />
        </TestWrapper>
      )

      // Component should still render despite network errors
      expect(screen.getByText('Provider:')).toBeInTheDocument()
    })

    it('should recover from component errors', async () => {
      const user = userEvent.setup()
      
      // Mock a component that might throw an error
      const ErrorProneComponent = ({ shouldError }: { shouldError: boolean }) => {
        if (shouldError) {
          throw new Error('Component error')
        }
        return <div>Component working</div>
      }

      const TestErrorBoundary = ({ children }: { children: React.ReactNode }) => {
        try {
          return <>{children}</>
        } catch (error) {
          return <div>Error caught: {(error as Error).message}</div>
        }
      }

      const { rerender } = render(
        <TestErrorBoundary>
          <ErrorProneComponent shouldError={false} />
        </TestErrorBoundary>
      )

      expect(screen.getByText('Component working')).toBeInTheDocument()

      // Trigger error
      rerender(
        <TestErrorBoundary>
          <ErrorProneComponent shouldError={true} />
        </TestErrorBoundary>
      )

      // Should handle error gracefully
      expect(screen.getByText('Error caught: Component error')).toBeInTheDocument()
    })
  })
})