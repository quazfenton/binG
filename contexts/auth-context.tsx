"use client";

import { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { FEATURE_FLAGS } from '@/config/features';

interface User {
  id: number;
  email: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (email: string, password: string) => Promise<void>;
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

  // Token management utilities
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

  // Validate token and get user info
  const validateToken = async (token: string): Promise<User | null> => {
    try {
      const response = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.user;
      }
      return null;
    } catch (error) {
      console.error('Token validation failed:', error);
      return null;
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      if (skipAuth) {
        setUser({ id: 1, email: 'dev@example.com' });
        setIsLoading(false);
        return;
      }

      const token = getStoredToken();
      if (token) {
        const validatedUser = await validateToken(token);
        if (validatedUser) {
          setUser(validatedUser);
        } else {
          // Token is invalid, remove it
          removeStoredToken();
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, [skipAuth]);

  const login = async (email: string, password: string) => {
    if (skipAuth) {
      setUser({ id: 1, email });
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
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (!data.token || !data.user) {
        throw new Error('Invalid response from server');
      }

      // Store token and user data
      setStoredToken(data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
    } catch (error: any) {
      // Clean up any partial state
      removeStoredToken();
      setUser(null);
      throw error;
    }
  };

  const logout = () => {
    removeStoredToken();
    setUser(null);
  };

  const register = async (email: string, password: string) => {
    if (skipAuth) {
      setUser({ id: 1, email });
      return;
    }

    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // After successful registration, log the user in
      await login(email, password);
    } catch (error: any) {
      throw error;
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    if (skipAuth) return true;

    const currentToken = getStoredToken();
    if (!currentToken) return false;

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStoredToken(data.token);
        return true;
      }
      
      // Token refresh failed, logout user
      logout();
      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
      logout();
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
