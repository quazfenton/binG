"use client";
import { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { FEATURE_FLAGS } from '../.bing-infra-config/config/features';
import { isDesktopMode } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AuthContext');

/**
 * Safely parse a fetch response as JSON, falling back to a text snippet
 * when the server returns a non-JSON body (e.g. an HTML error page from
 * the Next.js dev overlay or a reverse proxy). Returns a structured
 * `{ error, raw }` shape so callers can surface a useful message instead
 * of a confusing "Unexpected token <" SyntaxError.
 */
async function safeParseResponse(
  response: Response
): Promise<{ data: any; rawText: string; contentType: string | null }> {
  const contentType = response.headers.get('content-type');
  const rawText = await response.text();
  if (contentType && contentType.includes('application/json')) {
    try {
      return { data: JSON.parse(rawText), rawText, contentType };
    } catch {
      // Fall through to text handling below.
    }
  }
  // Try JSON anyway — some servers forget to set the content-type.
  if (rawText && (rawText.trimStart().startsWith('{') || rawText.trimStart().startsWith('['))) {
    try {
      return { data: JSON.parse(rawText), rawText, contentType };
    } catch {
      // Not JSON.
    }
  }
  // Surface a short snippet of the HTML/text body so users get a useful
  // diagnostic instead of a generic SyntaxError.
  const snippet = rawText.replace(/\s+/g, ' ').slice(0, 240);
  return {
    data: { error: snippet ? `Server returned non-JSON response (${response.status})` : `Request failed with status ${response.status}` },
    rawText,
    contentType,
  };
}

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
      logger.info('Session validation failed:', response.status);
      return null;
    } catch (error) {
      logger.error('Session validation failed:', error);
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
          logger.info('Auth0 session found, created local session for:', data.user.email);
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
        logger.info('No Auth0 session found');
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.warn('checkAuth0Session returned:', response.status, errorData.error || '');
      }
      return null;
    } catch (error) {
      logger.error('Auth0 session check failed:', error);
      return null;
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      if (isDesktopMode()) {
        // Desktop mode: create a local-only user identity.
        // Uses 'desktop' tier — distinct from 'premium' (paid cloud) and
        // 'free' (restricted cloud). Downstream feature gates should
        // treat 'desktop' as having local-only privileges; cloud-only
        // premium features (e.g. hosted sandboxes) remain unavailable.
        setUser({
          id: -1, // Sentinel: distinguishes desktop pseudo-user from DB users
          email: 'desktop-local@localhost',
          createdAt: new Date(),
          isActive: true,
          subscriptionTier: 'desktop',
          emailVerified: false,
        });
        setIsLoading(false);
        return;
      }

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

      logger.info('Initializing auth...');
      
      // Try session-based validation first
      let validatedUser = await validateSession();
      logger.info('validateSession result:', validatedUser ? 'found user' : 'no session');

      // If no local session, check for Auth0 session
      if (!validatedUser) {
        logger.info('Checking Auth0 session...');
        validatedUser = await checkAuth0Session();
        logger.info('checkAuth0Session result:', validatedUser ? `found user: ${validatedUser.email}` : 'no Auth0 session');
      }

      if (validatedUser) {
        logger.info('Setting user:', validatedUser.email, 'verified:', validatedUser.emailVerified);
        setUser(validatedUser);
      } else {
        // Session is invalid, clean up any stored tokens AND clear user state
        logger.info('No valid session, clearing user');
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

      const { data } = await safeParseResponse(response);

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

      // Capture the pre-login anonymous identity so we can decide
      // whether to fire the defensive client-side VFS transfer below.
      // If the user was never anonymous on this device (no localStorage
      // key set, or the key was already null/empty), there's no anon
      // workspace to recover and the fetch would be a wasted round-trip
      // to a 0-files no-op on the server.
      // Capture the actual anonymous session ID BEFORE we clear localStorage.
      // If the inline login transfer missed (e.g. the anon-session-id cookie
      // never reached the server), the recovery POST needs the ID to be
      // effective — otherwise the server has nothing to migrate and the
      // recovery request becomes a no-op for the exact failure mode it is
      // meant to heal.
      let capturedAnonSessionId: string | null = null;
      const hadAnonymousSession =
        typeof window !== 'undefined' &&
        (() => {
          try {
            const value = localStorage.getItem('anonymous_session_id');
            if (value !== null && value !== '') {
              capturedAnonSessionId = value;
              return true;
            }
            return false;
          } catch {
            return false;
          }
        })();

      // Clear anonymous session identity — user is now authenticated
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('anonymous_session_id');
        } catch {}
      }

      // Defensive: explicitly trigger the anon → user VFS transfer on the
      // client side. The login gateway already calls transferVFSOnLogin
      // server-side using the anon-session-id cookie that traveled with
      // this request, but a redirect / refresh / cookie race could have
      // skipped it. Hitting /api/auth/transfer-vfs-on-login here is
      // idempotent and ensures returning users (who explored the app
      // anonymously and then logged in to an existing account) don't
      // leave their anonymous workspace orphaned.
      //
      // SKIP when the user wasn't anonymous on this device: the
      // endpoint would return 0 transferred files anyway (the
      // anon-session-id cookie wouldn't match anything in the DB), and
      // every login otherwise issues a wasted round-trip + rate-limit
      // token against the per-user limiter.
      if (hadAnonymousSession) {
        try {
          // Build the recovery request body. The endpoint prefers the
          // `anonymousSessionId` body field over a stale cookie when both
          // are present, so the client-captured value wins when the cookie
          // never reached the server.
          const recoveryBody: Record<string, unknown> = {};
          if (capturedAnonSessionId) {
            recoveryBody.anonymousSessionId = capturedAnonSessionId;
          }
          await fetch('/api/auth/transfer-vfs-on-login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(recoveryBody),
          });
        } catch (transferErr) {
          // Non-fatal — the server-side in-line transfer already ran. Log
          // so we have a breadcrumb if a user reports missing files.
          logger.warn('transferVFSOnLogin request failed:', transferErr);
        }
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
      logger.error('Logout API call failed:', error);
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

      const { data } = await safeParseResponse(response);

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
      logger.error('Token refresh failed:', error);
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
