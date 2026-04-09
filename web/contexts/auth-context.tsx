"use client";

import { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { FEATURE_FLAGS } from '../../infra/config/config/features';

interface User {
  id: number;
  email: string;
  username?: string;
  createdAt: Date;
  lastLogin?: Date;
  isActive: boolean;
  subscriptionTier: string;
  emailVerified: boolean;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, username?: string) => Promise<void>;
  getApiKeys: () => Promise<Record<string, string>>;
  setApiKeys: (keys: Record<string, string>) => Promise<void>;
  refreshToken: () => Promise<boolean>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Skip auth only when explicitly enabled.
  const isDev = FEATURE_FLAGS.IS_DEVELOPMENT;
  const skipAuth = isDev && FEATURE_FLAGS.SKIP_AUTH_IN_DEV;

  // Token management utilities - uses secure secrets storage
  const getStoredToken = async (): Promise<string | null> => {
    if (typeof window === 'undefined') return null;
    try {
      const { secrets } = await import('@bing/platform/secrets');
      return await secrets.get('auth-token');
    } catch {
      return null;
    }
  };

  const setStoredToken = async (token: string): Promise<void> => {
    if (typeof window !== 'undefined') {
      try {
        const { secrets } = await import('@bing/platform/secrets');
        await secrets.set('auth-token', token);
      } catch {
        // Fallback to localStorage if secrets module fails
        localStorage.setItem('token', token);
      }
    }
  };

  const removeStoredToken = async (): Promise<void> => {
    if (typeof window !== 'undefined') {
      try {
        const { secrets } = await import('@bing/platform/secrets');
        await secrets.remove('auth-token');
      } catch {
        localStorage.removeItem('token');
      }
      localStorage.removeItem('user');
    }
  };

  // Validate session and get user info
  const validateSession = async (): Promise<User | null> => {
    try {
      const token = await getStoredToken();
      const response = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include', // Include cookies for session validation
      });

      if (response.ok) {
        const data = await response.json();
        if (data.valid && data.user) {
          return {
            ...data.user,
            createdAt: new Date(data.user.createdAt),
            lastLogin: data.user.lastLogin ? new Date(data.user.lastLogin) : undefined,
          };
        }
      }
      console.log('[AuthContext] Session validation failed:', response.status);
      return null;
    } catch (error) {
      console.error('Session validation failed:', error);
      return null;
    }
  };

  // Check for Auth0 session and create local session if exists
  const checkAuth0Session = async (): Promise<User | null> => {
    try {
      // Call endpoint that checks for Auth0 session and creates local session
      const response = await fetch('/api/auth/check-auth0-session', {
        method: 'POST',
        credentials: 'include', // Important: include cookies for session creation
      });

      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          console.log('[AuthContext] Auth0 session found, created local session for:', data.user.email);
          // Store token if provided
          if (data.token) {
            await setStoredToken(data.token);
          }
          return {
            ...data.user,
            createdAt: new Date(data.user.createdAt),
            lastLogin: data.user.lastLogin ? new Date(data.user.lastLogin) : undefined,
          };
        }
      } else if (response.status === 401) {
        // No Auth0 session - this is expected, not an error
        console.log('[AuthContext] No Auth0 session found');
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn('[AuthContext] checkAuth0Session returned:', response.status, errorData.error || '');
      }
      return null;
    } catch (error) {
      console.error('Auth0 session check failed:', error);
      return null;
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      if (skipAuth) {
        // Explicit opt-in bypass for development only.
        setUser({
          id: 1,
          email: 'dev-auth-bypass@example.com',
          createdAt: new Date(),
          isActive: true,
          subscriptionTier: 'premium',
          emailVerified: true
        });
        setIsLoading(false);
        return;
      }

      console.log('[AuthContext] Initializing auth...');
      
      // Try session-based validation first
      let validatedUser = await validateSession();
      console.log('[AuthContext] validateSession result:', validatedUser ? 'found user' : 'no session');

      // If no local session, check for Auth0 session
      if (!validatedUser) {
        console.log('[AuthContext] Checking Auth0 session...');
        validatedUser = await checkAuth0Session();
        console.log('[AuthContext] checkAuth0Session result:', validatedUser ? `found user: ${validatedUser.email}` : 'no Auth0 session');
      }

      if (validatedUser) {
        console.log('[AuthContext] Setting user:', validatedUser.email, 'verified:', validatedUser.emailVerified);
        setUser(validatedUser);
      } else {
        // Session is invalid, clean up any stored tokens AND clear user state
        console.log('[AuthContext] No valid session, clearing user');
        removeStoredToken();
        setUser(null); // CRITICAL: Clear user state when validation fails
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, [skipAuth]);

  const login = async (email: string, password: string) => {
    if (skipAuth) {
      setUser({
        id: 1,
        email,
        createdAt: new Date(),
        isActive: true,
        subscriptionTier: 'premium',
        emailVerified: true
      });
      return;
    }

    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include', // Include cookies for session
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (!data.success || !data.user) {
        throw new Error('Invalid response from server');
      }

      // Store token if provided (for backward compatibility)
      if (data.token) {
        setStoredToken(data.token);
      }

      // Clear anonymous session identity — user is now authenticated
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('anonymous_session_id');
        } catch {}
      }

      // Convert date strings to Date objects
      const user = {
        ...data.user,
        createdAt: new Date(data.user.createdAt),
        lastLogin: data.user.lastLogin ? new Date(data.user.lastLogin) : undefined,
      };

      setUser(user);
    } catch (error: any) {
      // Clean up any partial state
      removeStoredToken();
      setUser(null);
      throw error;
    }
  };

  const logout = async () => {
    if (skipAuth) {
      setUser(null);
      return;
    }

    try {
      // Call logout API to invalidate session
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include', // Include cookies for session
      });
    } catch (error) {
      console.error('Logout API call failed:', error);
      // Continue with local logout even if API call fails
    }

    // Clean up local state
    removeStoredToken();
    setUser(null);
    
    // Clean up sandbox-related localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('anonymous_session_id');
      // Clear any cached sandbox state
      try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('sandbox_') || k.startsWith('terminal_'));
        keys.forEach(k => localStorage.removeItem(k));
      } catch {}
    }
  };

  const register = async (email: string, password: string, username?: string) => {
    if (skipAuth) {
      setUser({
        id: 1,
        email,
        username,
        createdAt: new Date(),
        isActive: true,
        subscriptionTier: 'premium',
        emailVerified: true
      });
      return;
    }

    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username }),
        credentials: 'include', // Include cookies for session
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      if (!data.success) {
        throw new Error('Registration failed');
      }

      // Check if email verification is required
      if (data.requiresVerification) {
        // Don't set user as logged in - they need to verify email first
        // Return success but let the UI handle showing the "check your email" message
        return;
      }

      // Store token if provided (for backward compatibility)
      if (data.token) {
        setStoredToken(data.token);
      }

      // Clear anonymous session identity — user is now authenticated
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('anonymous_session_id');
        } catch {}
      }

      // Convert date strings to Date objects
      const user = {
        ...data.user,
        createdAt: new Date(data.user.createdAt),
        lastLogin: data.user.lastLogin ? new Date(data.user.lastLogin) : undefined,
      };

      setUser(user);
    } catch (error: any) {
      throw error;
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    if (skipAuth) return true;

    try {
      const token = getStoredToken();
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include', // Include cookies for session
      });

      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          await setStoredToken(data.token);
        }
        return true;
      }
      
      // Token refresh failed, logout user
      await logout();
      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
      await logout();
      return false;
    }
  };

  const getApiKeys = async (): Promise<Record<string, string>> => {
    if (typeof window === 'undefined') return {};
    try {
      const { secrets } = await import('@bing/platform/secrets');
      const storedKeys = await secrets.get('user-api-keys');
      return storedKeys ? JSON.parse(storedKeys) : {};
    } catch {
      return {};
    }
  };

  const setApiKeys = async (keys: Record<string, string>): Promise<void> => {
    if (typeof window === 'undefined') return;
    try {
      const { secrets } = await import('@bing/platform/secrets');
      await secrets.set('user-api-keys', JSON.stringify(keys));
    } catch {
      // Fallback to localStorage if secrets module fails
      localStorage.setItem('apiKeys', JSON.stringify(keys));
    }
  };

  const value = {
    isAuthenticated: !!user,
    user,
    login,
    logout,
    register,
    getApiKeys,
    setApiKeys,
    refreshToken,
    isLoading,
  };

  return (
    <AuthContext.Provider value={value}>
      {!isLoading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
