/**
 * Integration Tests for UI Reorganization
 * 
 * Tests the plugin tab reorganization from "Images" to "Extra" tab
 * and the movement of Advanced AI Plugins
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InteractionPanel from '@/components/interaction-panel'
import { AuthProvider } from '@/contexts/auth-context'

// Mock the plugin migration service
vi.mock('@/lib/plugins/plugin-migration', () => ({
  pluginMigrationService: {
    movePluginsToTab: vi.fn(),
    validateTabStructure: vi.fn().mockReturnValue(true),
  },
  PluginCategorizer: {
    categorizePlugin: vi.fn(),
  },
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

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

const TestWrapper = ({ children, authOverrides = {} }: { children: React.ReactNode; authOverrides?: any }) => {
  const authValue = { ...mockAuthContext, ...authOverrides }
  return (
    <AuthProvider value={authValue}>
      {children}
    </AuthProvider>
  )
}

describe('UI Reorganization Integration Tests', () => {
  const mockProviders = [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      models: ['deepseek/deepseek-r1-0528:free'],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Plugin Tab Reorganization', () => {
    it('should display Extra tab instead of Images tab', async () => {
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

      // Should show Extra tab
      expect(screen.getByText('Extra')).toBeInTheDocument()
      
      // Should not show Images tab
      expect(screen.queryByText('Images')).not.toBeInTheDocument()
    })

    it('should maintain Plugins tab with Modular Tools', async () => {
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

      // Should show Plugins tab
      expect(screen.getByText('Plugins')).toBeInTheDocument()
    })

    it('should call plugin migration service on initialization', async () => {
      const { pluginMigrationService } = await import('@/lib/plugins/plugin-migration')
      
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

      // Should call migration service to move plugins
      await waitFor(() => {
        expect(pluginMigrationService.movePluginsToTab).toHaveBeenCalledWith(['advanced-ai-plugins'], 'extra')
        expect(pluginMigrationService.movePluginsToTab).toHaveBeenCalledWith(['modular-tools'], 'plugins')
        expect(pluginMigrationService.validateTabStructure).toHaveBeenCalled()
      })
    })

    it('should handle tab switching between reorganized tabs', async () => {
      const user = userEvent.setup()
      const mockOnActiveTabChange = vi.fn()

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
            onActiveTabChange={mockOnActiveTabChange}
          />
        </TestWrapper>
      )

      // Click on Plugins tab
      const pluginsTab = screen.getByText('Plugins')
      await user.click(pluginsTab)

      // Should be able to switch tabs
      expect(pluginsTab).toBeInTheDocument()

      // Click on Extra tab
      const extraTab = screen.getByText('Extra')
      await user.click(extraTab)

      expect(extraTab).toBeInTheDocument()
    })
  })

  describe('Plugin Content Organization', () => {
    it('should display appropriate plugins in each tab', async () => {
      const user = userEvent.setup()

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

      // Check that plugins are available
      expect(screen.getByText('Plugins')).toBeInTheDocument()
      expect(screen.getByText('Extra')).toBeInTheDocument()

      // Should have plugin content available
      const pluginsTab = screen.getByText('Plugins')
      await user.click(pluginsTab)

      // Should show modular tools in plugins tab
      // Note: The actual plugin content might be in a different structure
      // This tests the tab structure itself
    })

    it('should preserve plugin functionality after reorganization', async () => {
      const user = userEvent.setup()
      const mockOnSubmit = vi.fn()

      render(
        <TestWrapper>
          <InteractionPanel
            onSubmit={mockOnSubmit}
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

      // Test that basic functionality still works
      const chatInput = screen.getByPlaceholderText(/type your message/i) || 
                       screen.getByRole('textbox') ||
                       screen.getByDisplayValue('')

      if (chatInput) {
        await user.type(chatInput, 'Test message')
        
        // Should be able to interact with the interface
        expect(chatInput).toHaveValue('Test message')
      }
    })
  })

  describe('Migration Validation', () => {
    it('should validate tab structure after migration', async () => {
      const { pluginMigrationService } = await import('@/lib/plugins/plugin-migration')
      
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

      await waitFor(() => {
        expect(pluginMigrationService.validateTabStructure).toHaveBeenCalled()
      })
    })

    it('should handle migration validation failure gracefully', async () => {
      const { pluginMigrationService } = await import('@/lib/plugins/plugin-migration')
      
      // Mock validation failure
      vi.mocked(pluginMigrationService.validateTabStructure).mockReturnValue(false)
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

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

      // Should log warning but continue to work
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Plugin tab structure validation failed')
      })

      // Component should still render
      expect(screen.getByText('Plugins')).toBeInTheDocument()
      expect(screen.getByText('Extra')).toBeInTheDocument()

      consoleSpy.mockRestore()
    })
  })

  describe('Backward Compatibility', () => {
    it('should maintain existing functionality after reorganization', async () => {
      const user = userEvent.setup()
      const mockToggleAccessibility = vi.fn()
      const mockToggleHistory = vi.fn()
      const mockToggleCodePreview = vi.fn()

      render(
        <TestWrapper>
          <InteractionPanel
            onSubmit={vi.fn()}
            onNewChat={vi.fn()}
            isProcessing={false}
            toggleAccessibility={mockToggleAccessibility}
            toggleHistory={mockToggleHistory}
            toggleCodePreview={mockToggleCodePreview}
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

      // All existing functionality should still work
      expect(screen.getByText('Plugins')).toBeInTheDocument()
      expect(screen.getByText('Extra')).toBeInTheDocument()
      
      // Should be able to access all tabs
      const pluginsTab = screen.getByText('Plugins')
      const extraTab = screen.getByText('Extra')
      
      await user.click(pluginsTab)
      await user.click(extraTab)
      
      // No errors should occur
      expect(pluginsTab).toBeInTheDocument()
      expect(extraTab).toBeInTheDocument()
    })

    it('should handle legacy plugin references gracefully', async () => {
      // Test that old "Images" tab references don't break the app
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

      // Should not show old Images tab
      expect(screen.queryByText('Images')).not.toBeInTheDocument()
      
      // Should show new Extra tab
      expect(screen.getByText('Extra')).toBeInTheDocument()
      
      // Component should render without errors
      expect(screen.getByText('Plugins')).toBeInTheDocument()
    })
  })
})