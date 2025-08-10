"use client";

import { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { FEATURE_FLAGS } from '@/config/features';

interface AuthContextType {
  isAuthenticated: boolean;
  user: { id?: number; email: string } | null;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => void;
  register: (email: string, password?: string) => Promise<void>;
  getApiKeys: () => Record<string, string>;
  setApiKeys: (keys: Record<string, string>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id?: number; email: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Skip auth in development mode
  const isDev = FEATURE_FLAGS.IS_DEVELOPMENT;
  const skipAuth = isDev && FEATURE_FLAGS.SKIP_AUTH_IN_DEV;

  useEffect(() => {
    // Check if user is already logged in
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else if (skipAuth) {
      setUser({ email: 'dev@example.com' });
    }
    setIsLoading(false);
  }, [skipAuth]);

  const login = async (email: string, password?: string) => {
    if (skipAuth) {
      setUser({ email });
      return;
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('user', JSON.stringify({ email }));
    localStorage.setItem('token', data.token);
    setUser({ email });
  };

  const logout = () => {
    localStorage.removeItem('user');
    setUser(null);
  };

  const register = async (email: string, password?: string) => {
    if (skipAuth) {
      setUser({ email });
      return;
    }

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    localStorage.setItem('user', JSON.stringify({ email }));
    setUser({ email });
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
