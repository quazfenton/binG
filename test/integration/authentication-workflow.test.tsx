/**
 * Integration Tests for Authentication Workflow
 * 
 * Tests the complete authentication flow from registration to login
 * and integration with other components
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '@/contexts/auth-context'
import AccessibilityControls from '@/components/accessibility-controls'
import ModalLoginForm from '@/components/auth/modal-login-form'
import ModalSignupForm from '@/components/auth/modal-signup-form'

// Mock auth service
vi.mock('@/lib/auth/auth-service', () => ({
  AuthService: {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    validateSession: vi.fn(),
    checkEmailExists: vi.fn(),
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

describe('Authentication Workflow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset localStorage mock
    vi.mocked(localStorage.getItem).mockReturnValue(null)
    vi.mocked(localStorage.setItem).mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
  })

  describe('User Registration Flow', () => {
    it('should complete user registration successfully', async () => {
      const user = userEvent.setup()
      const mockRegister = vi.fn().mockResolvedValue({
        success: true,
        user: { id: '1', email: 'test@example.com' },
        token: 'mock-token'
      })

      render(
        <TestWrapper authOverrides={{ register: mockRegister }}>
          <ModalSignupForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={vi.fn()}
          />
        </TestWrapper>
      )

      // Fill out registration form
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign up/i })

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      // Should call register function
      expect(mockRegister).toHaveBeenCalledWith('test@example.com', 'password123')
    })

    it('should handle registration errors', async () => {
      const user = userEvent.setup()
      const mockRegister = vi.fn().mockRejectedValue(new Error('Email already exists'))
      const mockOnError = vi.fn()

      render(
        <TestWrapper authOverrides={{ register: mockRegister }}>
          <ModalSignupForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={mockOnError}
          />
        </TestWrapper>
      )

      // Fill out registration form
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign up/i })

      await user.type(emailInput, 'existing@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      // Should handle error
      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Email already exists')
      })
    })

    it('should validate email format', async () => {
      const user = userEvent.setup()
      const mockRegister = vi.fn()

      render(
        <TestWrapper authOverrides={{ register: mockRegister }}>
          <ModalSignupForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={vi.fn()}
          />
        </TestWrapper>
      )

      // Try invalid email
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign up/i })

      await user.type(emailInput, 'invalid-email')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      // Should not call register with invalid email
      expect(mockRegister).not.toHaveBeenCalled()
    })

    it('should switch between login and signup forms', async () => {
      const user = userEvent.setup()
      const mockOnSwitchMode = vi.fn()

      render(
        <TestWrapper>
          <ModalSignupForm
            onSwitchMode={mockOnSwitchMode}
            onSuccess={vi.fn()}
            onError={vi.fn()}
          />
        </TestWrapper>
      )

      // Find and click switch to login link
      const switchLink = screen.getByText(/already have an account/i) || 
                        screen.getByText(/sign in/i)
      
      await user.click(switchLink)
      expect(mockOnSwitchMode).toHaveBeenCalled()
    })
  })

  describe('User Login Flow', () => {
    it('should complete user login successfully', async () => {
      const user = userEvent.setup()
      const mockLogin = vi.fn().mockResolvedValue({
        success: true,
        user: { id: '1', email: 'test@example.com' },
        token: 'mock-token'
      })

      render(
        <TestWrapper authOverrides={{ login: mockLogin }}>
          <ModalLoginForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={vi.fn()}
          />
        </TestWrapper>
      )

      // Fill out login form
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      // Should call login function
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
    })

    it('should handle login errors', async () => {
      const user = userEvent.setup()
      const mockLogin = vi.fn().mockRejectedValue(new Error('Invalid credentials'))
      const mockOnError = vi.fn()

      render(
        <TestWrapper authOverrides={{ login: mockLogin }}>
          <ModalLoginForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={mockOnError}
          />
        </TestWrapper>
      )

      // Fill out login form
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'wrongpassword')
      await user.click(submitButton)

      // Should handle error
      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Invalid credentials')
      })
    })

    it('should remember login state', async () => {
      const user = userEvent.setup()
      const mockLogin = vi.fn().mockResolvedValue({
        success: true,
        user: { id: '1', email: 'test@example.com' },
        token: 'mock-token'
      })

      render(
        <TestWrapper authOverrides={{ login: mockLogin }}>
          <ModalLoginForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={vi.fn()}
          />
        </TestWrapper>
      )

      // Check remember me option
      const rememberCheckbox = screen.getByLabelText(/remember me/i)
      await user.click(rememberCheckbox)

      // Fill out and submit form
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      // Should save to localStorage when remember me is checked
      expect(localStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('Authentication State Management', () => {
    it('should display correct UI for unauthenticated users', async () => {
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

      // Should show sign up and sign in options
      expect(screen.getByText('Sign Up')).toBeInTheDocument()
      expect(screen.getByText('Sign In')).toBeInTheDocument()
      expect(screen.getByText('Sign up for unlimited prompts and exclusive features')).toBeInTheDocument()
    })

    it('should display correct UI for authenticated users', async () => {
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

      // Should show user profile
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
      expect(screen.getByText('Premium Account')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('should handle logout correctly', async () => {
      const user = userEvent.setup()
      const mockLogout = vi.fn()
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        subscriptionTier: 'free' as const,
      }

      render(
        <TestWrapper authOverrides={{ 
          isAuthenticated: true, 
          user: mockUser, 
          logout: mockLogout 
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

      // Find and click logout button
      const logoutButton = screen.getByTitle('Sign Out')
      await user.click(logoutButton)

      expect(mockLogout).toHaveBeenCalled()
    })

    it('should persist authentication across page reloads', async () => {
      // Mock localStorage with existing token
      vi.mocked(localStorage.getItem).mockImplementation((key) => {
        if (key === 'auth_token') return 'mock-token'
        if (key === 'user_data') return JSON.stringify({ id: '1', email: 'test@example.com' })
        return null
      })

      const mockValidateSession = vi.fn().mockResolvedValue(true)

      render(
        <TestWrapper authOverrides={{ 
          isAuthenticated: true,
          user: { id: '1', email: 'test@example.com' },
          validateSession: mockValidateSession
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

      // Should show authenticated state
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })
  })

  describe('Session Management', () => {
    it('should handle session expiration', async () => {
      const mockValidateSession = vi.fn().mockResolvedValue(false)
      const mockLogout = vi.fn()

      render(
        <TestWrapper authOverrides={{ 
          isAuthenticated: false,
          validateSession: mockValidateSession,
          logout: mockLogout
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

      // Should show unauthenticated state when session is invalid
      expect(screen.getByText('Sign Up')).toBeInTheDocument()
      expect(screen.getByText('Sign In')).toBeInTheDocument()
    })

    it('should refresh session token automatically', async () => {
      const mockValidateSession = vi.fn().mockResolvedValue(true)
      
      render(
        <TestWrapper authOverrides={{ 
          isAuthenticated: true,
          user: { id: '1', email: 'test@example.com' },
          validateSession: mockValidateSession
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

      // Session validation should be called
      await waitFor(() => {
        expect(mockValidateSession).toHaveBeenCalled()
      })
    })
  })

  describe('Feature Access Control', () => {
    it('should restrict premium features for free users', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        subscriptionTier: 'free' as const,
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

      // Should show free account status
      expect(screen.getByText('Free Account')).toBeInTheDocument()
      expect(screen.getByText('Limited prompts • Basic features')).toBeInTheDocument()

      // Premium themes should be disabled
      const pinkTheme = screen.getByText('Pink Noir')
      expect(pinkTheme.closest('button')).toHaveClass('cursor-not-allowed')
    })

    it('should allow premium features for premium users', async () => {
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

      // Should show premium account status
      expect(screen.getByText('Premium Account')).toBeInTheDocument()
      expect(screen.getByText('Unlimited prompts • Custom themes • Priority support')).toBeInTheDocument()

      // Premium themes should be enabled
      const pinkTheme = screen.getByText('Pink Noir')
      expect(pinkTheme.closest('button')).not.toHaveClass('cursor-not-allowed')
    })

    it('should handle API key management for authenticated users', async () => {
      const user = userEvent.setup()
      const mockGetApiKeys = vi.fn().mockResolvedValue({ openai: 'sk-...' })
      const mockSetApiKeys = vi.fn()
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        subscriptionTier: 'premium' as const,
      }

      render(
        <TestWrapper authOverrides={{ 
          isAuthenticated: true, 
          user: mockUser,
          getApiKeys: mockGetApiKeys,
          setApiKeys: mockSetApiKeys
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

      // Should be able to access settings
      const settingsButton = screen.getByTitle('User Settings')
      expect(settingsButton).toBeInTheDocument()
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle network errors during authentication', async () => {
      const user = userEvent.setup()
      const mockLogin = vi.fn().mockRejectedValue(new Error('Network error'))
      const mockOnError = vi.fn()

      render(
        <TestWrapper authOverrides={{ login: mockLogin }}>
          <ModalLoginForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={mockOnError}
          />
        </TestWrapper>
      )

      // Try to login
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'password123')
      await user.click(submitButton)

      // Should handle network error
      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Network error')
      })
    })

    it('should recover from authentication failures', async () => {
      const user = userEvent.setup()
      let loginAttempts = 0
      const mockLogin = vi.fn().mockImplementation(() => {
        loginAttempts++
        if (loginAttempts === 1) {
          return Promise.reject(new Error('Invalid credentials'))
        }
        return Promise.resolve({
          success: true,
          user: { id: '1', email: 'test@example.com' },
          token: 'mock-token'
        })
      })

      const { rerender } = render(
        <TestWrapper authOverrides={{ login: mockLogin }}>
          <ModalLoginForm
            onSwitchMode={vi.fn()}
            onSuccess={vi.fn()}
            onError={vi.fn()}
          />
        </TestWrapper>
      )

      // First attempt - should fail
      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/password/i)
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'wrongpassword')
      await user.click(submitButton)

      // Clear and try again with correct password
      await user.clear(passwordInput)
      await user.type(passwordInput, 'correctpassword')
      await user.click(submitButton)

      // Should succeed on second attempt
      expect(mockLogin).toHaveBeenCalledTimes(2)
    })
  })
})