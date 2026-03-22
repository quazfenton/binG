import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/connection';
import { DatabaseOperations } from '../database/connection';
import { generateToken, blacklistToken, isTokenExpiringSoon } from './jwt';
import { authCache } from './auth-cache';
import { createLogger } from '../utils/logger';

const logger = createLogger('Auth:Service');

// Check if we're in a build/Edge environment
function shouldSkipValidation(): boolean {
  const env: any = typeof process !== 'undefined' ? process.env : {};
  return env.SKIP_DB_INIT === 'true' ||
         env.SKIP_DB_INIT === '1' ||
         env.NEXT_BUILD === 'true' ||
         env.NEXT_BUILD === '1' ||
         env.NEXT_PHASE === 'build' ||
         env.NEXT_PHASE === 'export';
}

// Lazy-loaded session token hash secret
let sessionTokenHashSecret: Buffer | null = null;

function getSessionTokenHashSecret(): Buffer {
  if (sessionTokenHashSecret) return sessionTokenHashSecret;

  // Lazy require crypto
  const crypto = require('crypto');

  const env: any = typeof process !== 'undefined' ? process.env : {};
  const key = env.ENCRYPTION_KEY;

  // Skip validation during build
  if (shouldSkipValidation()) {
    logger.warn('[Auth] Skipping ENCRYPTION_KEY validation during build');
    sessionTokenHashSecret = Buffer.alloc(32, 'dummy-key-for-build');
    return sessionTokenHashSecret;
  }

  if (!key) {
    if (env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production for session token security');
    }
    // In development, generate a random key per session (not persistent)
    logger.warn('⚠️  WARNING: ENCRYPTION_KEY not set! Session tokens will not persist across restarts.');
    logger.warn('Set ENCRYPTION_KEY environment variable to a secure 32+ character random string.');
    sessionTokenHashSecret = crypto.randomBytes(32);
    return sessionTokenHashSecret;
  }

  // Validate key strength
  if (key.length < 16) {
    throw new Error('ENCRYPTION_KEY must be at least 16 characters for session security');
  }

  sessionTokenHashSecret = Buffer.from(key);
  return sessionTokenHashSecret;
}

/**
 * Account lockout tracking
 * Prevents brute-force attacks by locking accounts after too many failed attempts
 */
interface FailedLoginAttempt {
  email: string;
  timestamp: number;
  ipAddress: string;
  userAgent?: string;
}

const failedLoginAttempts = new Map<string, FailedLoginAttempt[]>();
const LOCKOUT_THRESHOLD = 5; // Number of failed attempts before lockout
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes lockout
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000; // Track attempts within 30 minutes

/**
 * Check if account is locked due to too many failed login attempts
 */
function checkAccountLockout(email: string): {
  locked: boolean;
  unlockAfter?: number;
  remainingAttempts?: number;
} {
  const attempts = failedLoginAttempts.get(email.toLowerCase()) || [];
  const now = Date.now();
  
  // Filter to attempts within the window
  const recentAttempts = attempts.filter(a => now - a.timestamp < ATTEMPT_WINDOW_MS);
  
  if (recentAttempts.length >= LOCKOUT_THRESHOLD) {
    // Find the oldest attempt to calculate unlock time
    const oldestAttempt = recentAttempts[0];
    const unlockAfter = oldestAttempt.timestamp + LOCKOUT_DURATION_MS;
    
    return {
      locked: true,
      unlockAfter,
      remainingAttempts: 0,
    };
  }
  
  return {
    locked: false,
    remainingAttempts: LOCKOUT_THRESHOLD - recentAttempts.length,
  };
}

/**
 * Record a failed login attempt
 */
function recordFailedLogin(email: string, ipAddress: string, userAgent?: string): void {
  const attempts = failedLoginAttempts.get(email.toLowerCase()) || [];
  attempts.push({
    email: email.toLowerCase(),
    timestamp: Date.now(),
    ipAddress,
    userAgent,
  });
  failedLoginAttempts.set(email.toLowerCase(), attempts);
  
  // Cleanup old attempts (keep only recent ones)
  const now = Date.now();
  const recentAttempts = attempts.filter(a => now - a.timestamp < ATTEMPT_WINDOW_MS);
  failedLoginAttempts.set(email.toLowerCase(), recentAttempts);
  
  console.warn(`[Auth] Failed login attempt for ${email} from ${ipAddress} (${recentAttempts.length}/${LOCKOUT_THRESHOLD})`);
}

/**
 * Clear failed login attempts for an email (called on successful login)
 */
function clearFailedLogins(email: string): void {
  failedLoginAttempts.delete(email.toLowerCase());
}

/**
 * Get failed login attempt count for an email (for debugging/admin)
 */
export function getFailedLoginCount(email: string): number {
  const attempts = failedLoginAttempts.get(email.toLowerCase()) || [];
  const now = Date.now();
  return attempts.filter(a => now - a.timestamp < ATTEMPT_WINDOW_MS).length;
}

/**
 * Manually clear lockout for an email (for admin use)
 */
export function clearAccountLockout(email: string): void {
  failedLoginAttempts.delete(email.toLowerCase());
}

/**
 * Hash a session token using HMAC-SHA256
 * This is fast for lookups while still being secure (prevents rainbow table attacks)
 * The hash is stored in the database instead of the raw token
 */
function hashSessionToken(token: string): string {
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', getSessionTokenHashSecret())
    .update(token)
    .digest('hex');
}

export interface User {
  id: number;
  email: string;
  username?: string;
  createdAt: Date;
  lastLogin?: Date;
  isActive: boolean;
  subscriptionTier: string;
  emailVerified: boolean;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  token?: string;
  sessionId?: string;
  error?: string;
  message?: string;
  requiresVerification?: boolean;
  source?: 'jwt' | 'session' | 'cookie' | 'anonymous' | 'none';
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  username?: string;
  emailVerified?: boolean; // For OAuth users - email already verified by provider
}

export interface SessionInfo {
  sessionId: string;
  userId: number;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export class AuthService {
  private dbOps: DatabaseOperations;
  private db: any;

  constructor() {
    this.db = getDatabase();
    this.dbOps = new DatabaseOperations();
  }

  /**
   * Register a new user
   */
  async register(credentials: RegisterCredentials, sessionInfo?: Partial<SessionInfo>): Promise<AuthResult> {
    try {
      // Validate email format
      if (!this.isValidEmail(credentials.email)) {
        return { success: false, error: 'Invalid email format' };
      }

      // Validate password strength
      const passwordValidation = this.validatePassword(credentials.password);
      if (!passwordValidation.valid) {
        return { success: false, error: passwordValidation.error };
      }

      // Check if email already exists
      const emailExists = await this.checkEmailExists(credentials.email);
      if (emailExists) {
        return { success: false, error: 'Email already registered' };
      }

      // Check if username already exists (if provided)
      if (credentials.username) {
        const usernameExists = await this.checkUsernameExists(credentials.username);
        if (usernameExists) {
          return { success: false, error: 'Username already taken' };
        }
      }

      // Hash password
      const passwordHash = await this.hashPassword(credentials.password);

      // Generate email verification token
      const { v4: uuidv4 } = await import('uuid');
      const verificationToken = uuidv4();
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create user with verification token
      // OAuth users pass emailVerified: true since their email is already verified by the provider
      const result = this.dbOps.createUserWithVerification(
        credentials.email,
        credentials.username || '',
        passwordHash,
        verificationToken,
        verificationExpires,
        credentials.emailVerified || false
      );

      if (!result.lastInsertRowid) {
        return { success: false, error: 'Failed to create user' };
      }

      const userId = result.lastInsertRowid as number;

      // Get created user
      const user = this.dbOps.getUserById(userId);
      if (!user) {
        return { success: false, error: 'Failed to retrieve created user' };
      }

      // Send verification email ONLY for non-OAuth users
      // OAuth users already have verified emails from their provider
      if (!credentials.emailVerified) {
        try {
          const { emailService } = await import('@/lib/email/email-service');
          const verificationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
          await emailService.sendVerificationEmail(credentials.email, {
            token: verificationToken,
            expiresAt: verificationExpires,
            verificationUrl
          });
        } catch (emailError) {
          console.error('Failed to send verification email:', emailError);
          // Don't fail registration if email fails - user can request resend later
        }
      }

      // Return success - OAuth users are auto-verified, regular users need to verify
      return {
        success: true,
        user: this.mapDbUserToUser(user),
        requiresVerification: !credentials.emailVerified,
        message: credentials.emailVerified
          ? 'Registration successful! You are now logged in.'
          : 'Registration successful! Please check your email to verify your account.'
      };

    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: 'Registration failed' };
    }
  }

  /**
   * Login user
   * 
   * Enhanced with account lockout protection after failed attempts
   */
  async login(credentials: LoginCredentials, sessionInfo?: Partial<SessionInfo>): Promise<AuthResult> {
    try {
      // Check account lockout status FIRST (before any password checking)
      const lockout = checkAccountLockout(credentials.email);
      if (lockout.locked && lockout.unlockAfter) {
        const unlockTime = new Date(lockout.unlockAfter);
        const minutesUntilUnlock = Math.ceil((lockout.unlockAfter - Date.now()) / 60000);
        
        console.warn(`[Auth] Account locked: ${credentials.email} (unlock in ${minutesUntilUnlock}m)`);
        
        return {
          success: false,
          error: `Account locked due to too many failed attempts. Try again after ${unlockTime.toLocaleTimeString()}`,
        };
      }

      // Get user by email
      const dbUser = this.dbOps.getUserByEmail(credentials.email) as any;
      if (!dbUser) {
        // Record failed attempt even for non-existent email (prevents email enumeration)
        recordFailedLogin(credentials.email, sessionInfo?.ipAddress || 'unknown', sessionInfo?.userAgent);
        return { success: false, error: 'Invalid email or password' };
      }

      // Verify password
      const passwordValid = await this.verifyPassword(credentials.password, dbUser.password_hash);
      if (!passwordValid) {
        // Record failed login attempt
        recordFailedLogin(credentials.email, sessionInfo?.ipAddress || 'unknown', sessionInfo?.userAgent);
        // SECURITY: Return generic error to prevent email enumeration
        // Lockout status should be communicated via separate flow (e.g., email notification)
        return { success: false, error: 'Invalid email or password' };
      }

      // SUCCESS: Clear failed login attempts on successful login
      clearFailedLogins(credentials.email);

      // Update last login
      this.updateLastLogin(dbUser.id);

      // Create session
      // Note: We store the raw sessionId (not hashed) to match how sessions are looked up
      // in other parts of the codebase (e.g., chat/history route uses raw sessionId from cookie)
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      this.dbOps.createSession(
        sessionId,
        dbUser.id,
        expiresAt,
        sessionInfo?.ipAddress,
        sessionInfo?.userAgent
      );

      // Generate JWT token
      const token = generateToken({
        userId: dbUser.id.toString(),
        email: dbUser.email
      });

      return {
        success: true,
        user: this.mapDbUserToUser(dbUser),
        token,
        sessionId
      };

    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Login failed' };
    }
  }

  /**
   * Create a session for an existing user (used for OAuth/SSO logins)
   */
  async createSessionForUser(userId: number, sessionInfo?: { ipAddress: string; userAgent: string }): Promise<{
    success: boolean;
    sessionId?: string;
    error?: string;
  }> {
    try {
      const dbUser = this.dbOps.getUserById(userId) as any;

      if (!dbUser) {
        return { success: false, error: 'User not found' };
      }

      // Create session
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      this.dbOps.createSession(
        sessionId,
        userId,
        expiresAt,
        sessionInfo?.ipAddress,
        sessionInfo?.userAgent
      );

      // Update last login
      this.dbOps.getDb().prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

      return {
        success: true,
        sessionId,
      };
    } catch (error) {
      console.error('Create session error:', error);
      return { success: false, error: 'Failed to create session' };
    }
  }

  /**
   * Logout user
   * 
   * Invalidates session and blacklists JWT token if provided
   */
  async logout(sessionId: string, jwtToken?: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Use raw sessionId to match how sessions are stored
      this.dbOps.deleteSession(sessionId);

      // CRITICAL: Invalidate auth cache to prevent stale auth results
      // Without this, cached auth results remain valid for 5 minutes after logout
      authCache.invalidateSession(sessionId);

      // Blacklist JWT token if provided (for immediate revocation)
      if (jwtToken) {
        try {
          // Decode token to get JTI and expiration
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(jwtToken) as { jti?: string; exp?: number };
          if (decoded?.jti && decoded?.exp) {
            const expiresAt = new Date(decoded.exp * 1000);
            blacklistToken(decoded.jti, expiresAt);
          }
        } catch (error) {
          // Token decoding failed, continue with session logout
          console.warn('Failed to decode JWT for blacklisting:', error);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: 'Logout failed' };
    }
  }

  /**
   * Validate session
   */
  async validateSession(sessionId: string): Promise<AuthResult> {
    try {
      // Use raw sessionId to match how sessions are stored
      const session = this.dbOps.getSession(sessionId) as any;

      if (!session) {
        return { success: false, error: 'Invalid session' };
      }

      // Check if session is expired
      const now = new Date();
      const expiresAt = new Date(session.expires_at);

      if (now > expiresAt) {
        // Clean up expired session
        this.dbOps.deleteSession(sessionId);
        return { success: false, error: 'Session expired' };
      }

      // Get user details
      const user = this.dbOps.getUserById(session.user_id) as any;
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      return {
        success: true,
        user: this.mapDbUserToUser(user),
        sessionId
      };

    } catch (error) {
      console.error('Session validation error:', error);
      return { success: false, error: 'Session validation failed' };
    }
  }

  /**
   * Check if email exists
   */
  async checkEmailExists(email: string): Promise<boolean> {
    try {
      const user = this.dbOps.getUserByEmail(email);
      return !!user;
    } catch (error) {
      console.error('Email check error:', error);
      return false;
    }
  }

  /**
   * Check if username exists
   */
  async checkUsernameExists(username: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare('SELECT id FROM users WHERE username = ? AND is_active = TRUE');
      const result = stmt.get(username);
      return !!result;
    } catch (error) {
      console.error('Username check error:', error);
      return false;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: number): Promise<User | null> {
    try {
      const dbUser = this.dbOps.getUserById(userId) as any;
      return dbUser ? this.mapDbUserToUser(dbUser) : null;
    } catch (error) {
      console.error('Get user error:', error);
      return null;
    }
  }

  /**
   * Update user last login
   */
  private updateLastLogin(userId: number): void {
    try {
      const stmt = this.db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
      stmt.run(userId);
    } catch (error) {
      console.error('Update last login error:', error);
    }
  }

  /**
   * Hash password
   */
  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  private validatePassword(password: string): { valid: boolean; error?: string } {
    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters long' };
    }

    if (!/(?=.*[a-z])/.test(password)) {
      return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }

    if (!/(?=.*[A-Z])/.test(password)) {
      return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }

    if (!/(?=.*\d)/.test(password)) {
      return { valid: false, error: 'Password must contain at least one number' };
    }

    return { valid: true };
  }

  /**
   * Map database user to User interface
   */
  private mapDbUserToUser(dbUser: any): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
      createdAt: new Date(dbUser.created_at),
      lastLogin: dbUser.last_login ? new Date(dbUser.last_login) : undefined,
      isActive: dbUser.is_active,
      subscriptionTier: dbUser.subscription_tier || 'free',
      emailVerified: dbUser.email_verified || false
    };
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      this.dbOps.cleanupExpiredSessions();
    } catch (error) {
      console.error('Session cleanup error:', error);
    }
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId: number): Promise<any[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, expires_at, created_at, ip_address, user_agent, is_active
        FROM user_sessions 
        WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC
      `);
      return stmt.all(userId);
    } catch (error) {
      console.error('Get user sessions error:', error);
      return [];
    }
  }

  /**
   * Revoke session
   */
  async revokeSession(sessionId: string, userId: number): Promise<{ success: boolean; error?: string }> {
    try {
      // Use raw sessionId to match how sessions are stored
      const stmt = this.db.prepare('DELETE FROM user_sessions WHERE session_id = ? AND user_id = ?');
      const result = stmt.run(sessionId, userId);

      if (result.changes === 0) {
        return { success: false, error: 'Session not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Revoke session error:', error);
      return { success: false, error: 'Failed to revoke session' };
    }
  }

  /**
   * Refresh access token using refresh token
   * 
   * Validates refresh token and issues new access/refresh token pair
   * Implements token rotation for security (old refresh token is invalidated)
   */
  async refreshToken(refreshToken: string, sessionInfo?: Partial<SessionInfo>): Promise<AuthResult> {
    try {
      // Find session by refresh token
      // Note: In a production system, refresh tokens should be stored separately
      // For now, we'll use a simplified approach
      const stmt = this.db.prepare(`
        SELECT us.*, u.email, u.id as user_id 
        FROM user_sessions us
        JOIN users u ON us.user_id = u.id
        WHERE us.id = ? AND us.is_active = TRUE AND datetime(us.expires_at) > datetime('now')
      `);
      const session = stmt.get(refreshToken) as any;

      if (!session) {
        return { success: false, error: 'Invalid or expired refresh token' };
      }

      // Check if user is still active
      if (!session.is_active) {
        return { success: false, error: 'User account is deactivated' };
      }

      // Generate new token pair
      const newToken = generateToken({
        userId: session.user_id.toString(),
        email: session.email,
      });

      // Generate new refresh token (token rotation)
      const newRefreshToken = uuidv4();
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Invalidate old refresh token and create new one
      this.db.prepare('DELETE FROM user_sessions WHERE session_id = ?').run(refreshToken);

      this.db.prepare(`
        INSERT INTO user_sessions (session_id, user_id, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `).run(newRefreshToken, session.user_id, newExpiresAt.toISOString(),
             sessionInfo?.ipAddress, sessionInfo?.userAgent);

      logger.info('Token refreshed successfully', {
        userId: session.user_id,
        oldToken: refreshToken.substring(0, 8) + '...',
        newToken: newRefreshToken.substring(0, 8) + '...',
      });

      return {
        success: true,
        token: newToken,
        sessionId: newRefreshToken,
        user: this.mapDbUserToUser(session),
      };
    } catch (error) {
      logger.error('Token refresh error', error as Error);
      return { success: false, error: 'Token refresh failed' };
    }
  }
}

// Export singleton instance
export const authService = new AuthService();