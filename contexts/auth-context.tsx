"use client";

import { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { FEATURE_FLAGS } from '@/config/features';

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
  getApiKeys: () => Record<string, string>;
  setApiKeys: (keys: Record<string, string>) => void;
  refreshToken: () => Promise<boolean>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Skip auth in development mode
  const isDev = FEATURE_FLAGS.IS_DEVELOPMENT;
  const skipAuth = isDev && FEATURE_FLAGS.SKIP_AUTH_IN_DEV;

  // Token management utilities (kept for backward compatibility)
  const getStoredToken = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
  };

  const setStoredToken = (token: string): void => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
    }
  };

  const removeStoredToken = (): void => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  };

  // Validate session and get user info
  const validateSession = async (): Promise<User | null> => {
    try {
      const response = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
      return null;
    } catch (error) {
      console.error('Session validation failed:', error);
      return null;
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      if (skipAuth) {
        setUser({ 
          id: 1, 
          email: 'dev@example.com',
          createdAt: new Date(),
          isActive: true,
          subscriptionTier: 'premium',
          emailVerified: true
        });
        setIsLoading(false);
        return;
      }

      // Try session-based validation first
      const validatedUser = await validateSession();
      if (validatedUser) {
        setUser(validatedUser);
      } else {
        // Session is invalid, clean up any stored tokens
        removeStoredToken();
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

      if (!data.success || !data.user) {
        throw new Error('Invalid response from server');
      }

      // Store token if provided (for backward compatibility)
      if (data.token) {
        setStoredToken(data.token);
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
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session
      });

      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          setStoredToken(data.token);
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

  const getApiKeys = () => {
    const storedKeys = localStorage.getItem('apiKeys');
    return storedKeys ? JSON.parse(storedKeys) : {};
  };

  const setApiKeys = (keys: Record<string, string>) => {
    localStorage.setItem('apiKeys', JSON.stringify(keys));
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
