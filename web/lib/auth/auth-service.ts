// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

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
 * 
 * SECURITY: Includes LRU eviction to prevent memory exhaustion DoS via unique email enumeration
 * Maximum entries capped at MAX_LOGIN_TRACKED_EMAILS to prevent unbounded Map growth
 */
interface FailedLoginAttempt {
  email: string;
  timestamp: number;
  ipAddress: string;
  userAgent?: string;
}

const MAX_LOGIN_TRACKED_EMAILS = 10000; // LRU cap to prevent memory exhaustion DoS
const failedLoginAttempts = new Map<string, FailedLoginAttempt[]>();
let entryCount = 0; // Track number of unique emails in the Map

/**
 * MED-2 fix: Common password blocklist — patterns that are too easily guessable.
 * Uses exact-match (Set.has()) to avoid false positives on longer passwords
 * that merely contain a common substring (e.g., "masterplan!2024" should not
 * be blocked just because it contains "master").
 */
const COMMON_PASSWORDS = new Set([
  'password', 'qwerty', 'abc123', 'letmein', 'welcome',
  'admin', 'login', 'master', 'hello', 'football',
  'monkey', 'dragon', 'shadow', 'sunshine', 'trustno1',
  'iloveyou', 'princess', 'passw0rd', '123456', '12345678',
  '123456789', '1234567890', 'qwerty123', 'password1', 'password123',
  'admin123', 'letmein123', 'welcome123', 'master123', 'login123',
  // Common keyboard walks
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '!@#$%^&*',
  // Repeated patterns
  'aaaaaaaaaaaa', '111111111111', 'abcd1234!',
]);

const LOCKOUT_THRESHOLD = 5; // Number of failed attempts before first lockout
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000; // Track attempts within 30 minutes

// HIGH-7 fix: Progressive lockout durations (exponential backoff)
// 1st lockout: 5 min, 2nd: 30 min, 3rd: 2 hours, 4th+: 24 hours
const LOCKOUT_DURATIONS_MS = [
  5 * 60 * 1000,     // 5 minutes (1st lockout)
  30 * 60 * 1000,   // 30 minutes (2nd lockout)
  2 * 60 * 60 * 1000, // 2 hours (3rd lockout)
  24 * 60 * 60 * 1000, // 24 hours (4th+ lockout)
];

// Track how many times an account has been locked (for escalation)
const lockoutCountMap = new Map<string, number>();

/**
 * Evict oldest entries if we're at capacity (LRU eviction)
 */
function evictOldestIfNeeded(): void {
  if (entryCount < MAX_LOGIN_TRACKED_EMAILS) return;
  
  // Find and remove the oldest entry
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  
  for (const [email, attempts] of failedLoginAttempts) {
    const oldestAttempt = attempts[0];
    if (oldestAttempt && oldestAttempt.timestamp < oldestTime) {
      oldestTime = oldestAttempt.timestamp;
      oldestKey = email;
    }
  }
  
  if (oldestKey) {
    failedLoginAttempts.delete(oldestKey);
    lockoutCountMap.delete(oldestKey); // HIGH-7 fix: Clean up lockout counts alongside attempts
    entryCount--;
    console.warn(`[Auth] LRU eviction: removed oldest entry for ${oldestKey}`);
  }
}

/**
 * Check if account is locked due to too many failed login attempts
 */
function checkAccountLockout(email: string): {
  locked: boolean;
  unlockAfter?: number;
  remainingAttempts?: number;
} {
  const emailKey = email.toLowerCase();
  const attempts = failedLoginAttempts.get(emailKey) || [];
  const now = Date.now();
  
  // Filter to attempts within the window
  const recentAttempts = attempts.filter(a => now - a.timestamp < ATTEMPT_WINDOW_MS);
  
  if (recentAttempts.length >= LOCKOUT_THRESHOLD) {
    // HIGH-7 fix: Progressive lockout — escalation based on how many times locked
    const lockoutCount = lockoutCountMap.get(emailKey) || 0;
    const durationIndex = Math.min(lockoutCount, LOCKOUT_DURATIONS_MS.length - 1);
    const lockoutDuration = LOCKOUT_DURATIONS_MS[durationIndex];
    
    // Find the most recent attempt to calculate unlock time
    const latestAttempt = recentAttempts[recentAttempts.length - 1];
    const unlockAfter = latestAttempt.timestamp + lockoutDuration;
    
    // If unlock time has passed, account is no longer locked
    if (now >= unlockAfter) {
      return {
        locked: false,
        remainingAttempts: LOCKOUT_THRESHOLD,
      };
    }
    
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
 * Includes LRU eviction to prevent memory exhaustion DoS
 */
function recordFailedLogin(email: string, ipAddress: string, userAgent?: string): void {
  const emailKey = email.toLowerCase();
  
  // Check if this email already exists (to track entry count correctly)
  const exists = failedLoginAttempts.has(emailKey);
  
  // LRU eviction: remove oldest entries if at capacity and this is a new email
  if (!exists && entryCount >= MAX_LOGIN_TRACKED_EMAILS) {
    evictOldestIfNeeded();
  }
  
  const attempts = failedLoginAttempts.get(emailKey) || [];
  attempts.push({
    email: emailKey,
    timestamp: Date.now(),
    ipAddress,
    userAgent,
  });
  failedLoginAttempts.set(emailKey, attempts);
  
  if (!exists) {
    entryCount++;
  }
  
  // Cleanup old attempts (keep only recent ones)
  const now = Date.now();
  const recentAttempts = attempts.filter(a => now - a.timestamp < ATTEMPT_WINDOW_MS);
  
  // If all attempts are now expired, remove the entry entirely
  if (recentAttempts.length === 0) {
    failedLoginAttempts.delete(emailKey);
    entryCount--;
  } else {
    failedLoginAttempts.set(emailKey, recentAttempts);
  }
  
  // HIGH-7 fix: If this attempt triggers a lockout, increment the lockout count for escalation
  if (recentAttempts.length >= LOCKOUT_THRESHOLD) {
    const currentCount = lockoutCountMap.get(emailKey) || 0;
    lockoutCountMap.set(emailKey, currentCount + 1);
    const durationIndex = Math.min(currentCount, LOCKOUT_DURATIONS_MS.length - 1);
    const durationMin = Math.round(LOCKOUT_DURATIONS_MS[durationIndex] / 60000);
    console.warn(`[Auth] Account LOCKED (escalation level ${currentCount + 1}): ${email} from ${ipAddress} — lockout duration: ${durationMin} minutes`);
  } else {
    console.warn(`[Auth] Failed login attempt for ${email} from ${ipAddress} (${recentAttempts.length}/${LOCKOUT_THRESHOLD}) [tracking ${entryCount} emails]`);
  }
}

/**
 * Clear failed login attempts for an email (called on successful login)
 */
function clearFailedLogins(email: string): void {
  const emailKey = email.toLowerCase();
  if (failedLoginAttempts.has(emailKey)) {
    failedLoginAttempts.delete(emailKey);
    entryCount--;
  }
  // HIGH-7 fix: Reset lockout escalation on successful login
  // (but keep the count for logging — reset only if it's been >24h since last lockout)
  // This prevents indefinite escalation from ancient lockouts
  lockoutCountMap.delete(emailKey);
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
  const emailKey = email.toLowerCase();
  if (failedLoginAttempts.has(emailKey)) {
    failedLoginAttempts.delete(emailKey);
    entryCount--;
  }
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
  id: string;
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
  userId: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export class AuthService {
  private dbOps: DatabaseOperations;
  private db: any;
  private dbInitPromise: Promise<void> | null = null;

  constructor() {
    this.dbOps = new DatabaseOperations();
    this.db = getDatabase();
  }

  /**
   * Ensure database is initialized before proceeding
   * Waits for async database initialization if needed
   * Uses shared promise pattern to prevent race conditions from concurrent calls
   */
  private async ensureDatabase(): Promise<void> {
    if (this.db) return;

    // Use shared promise to prevent concurrent initialization
    if (!this.dbInitPromise) {
      this.dbInitPromise = new Promise<void>((resolve, reject) => {
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (pollTimer) clearTimeout(pollTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        // Check immediately before starting polling
        this.db = getDatabase();
        if (this.db) {
          cleanup();
          this.dbInitPromise = null;
          resolve();
          return;
        }

        const check = () => {
          this.db = getDatabase();
          if (this.db) {
            cleanup();
            this.dbInitPromise = null;
            resolve();
            return;
          } else {
            pollTimer = setTimeout(check, 50);
          }
        };

        // Timeout after 5 seconds - clear poll timer and REJECT to prevent proceeding with null db
        timeoutTimer = setTimeout(() => {
          cleanup();
          this.dbInitPromise = null;
          const error = new Error('Database initialization timeout after 5 seconds');
          logger.error('[AuthService] Database initialization failed:', error);
          reject(error);
        }, 5000);

        check();
      });
    }

    await this.dbInitPromise;

    // Final safety check: if db is still null after promise resolves, throw
    if (!this.db) {
      throw new Error('Database is not available after initialization attempt');
    }
  }

  /**
   * Register a new user
   */
  async register(credentials: RegisterCredentials, sessionInfo?: Partial<SessionInfo>): Promise<AuthResult> {
    try {
      // Ensure database is ready
      await this.ensureDatabase();

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

      // Note: With TEXT primary key, we can't get lastInsertRowid easily
      // Get the user by email instead (user was just created)
      const newUser = this.dbOps.getUserByEmail(credentials.email) as any;
      if (!newUser) {
        return { success: false, error: 'Failed to retrieve created user' };
      }

      const userId = newUser.id as string;

      // Use the newUser we already fetched
      const user = this.mapDbUserToUser(newUser);

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
        user: user,
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
      // Ensure database is ready
      await this.ensureDatabase();

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

      // CRIT-4 fix: Invalidate all previous sessions for this user before creating a new one.
      // This prevents session fixation attacks where an attacker pre-sets a session cookie
      // and the victim's login doesn't invalidate it.
      try {
        this.invalidateAllSessionsForUser(dbUser.id);
        logger.info('Invalidated previous sessions on login', { userId: dbUser.id });
      } catch (cleanupError) {
        // Log but don't fail login if session cleanup fails
        logger.error('Failed to invalidate previous sessions on login', cleanupError as Error);
      }

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
      // HIGH-8 fix: email removed from JWT — use getUserEmail() from jwt.ts if needed
      const token = generateToken({
        userId: dbUser.id.toString(),
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
  async createSessionForUser(userId: string, sessionInfo?: { ipAddress: string; userAgent: string }): Promise<{
    success: boolean;
    sessionId?: string;
    error?: string;
  }> {
    try {
      // Ensure database is ready
      await this.ensureDatabase();

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
      this.dbOps.db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

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
      // Ensure database is ready
      await this.ensureDatabase();

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
      // Ensure database is ready
      await this.ensureDatabase();

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
      // Ensure database is ready
      await this.ensureDatabase();

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
      // Ensure database is ready
      await this.ensureDatabase();

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
  async getUserById(userId: string): Promise<User | null> {
    try {
      // Ensure database is ready
      await this.ensureDatabase();

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
  private updateLastLogin(userId: string): void {
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
   *
   * MED-2 fix: Enhanced password policy — 12 char minimum, special character required,
   * common password blocklist. Previous policy was 8 chars + upper/lower/digit only.
   */
  private validatePassword(password: string): { valid: boolean; error?: string } {
    // MED-2 fix: Increased from 8 to 12 characters for better brute-force resistance
    if (password.length < 12) {
      return { valid: false, error: 'Password must be at least 12 characters long' };
    }

    if (password.length > 128) {
      return { valid: false, error: 'Password must be at most 128 characters long' };
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

    // MED-2 fix: Require at least one special character
    if (!/(?=.*[^a-zA-Z0-9])/.test(password)) {
      return { valid: false, error: 'Password must contain at least one special character (!@#$%^&* etc.)' };
    }

    // MED-2 fix: Block commonly used passwords (exact match only to avoid false positives
    // on longer passwords that merely contain a common substring like "masterplan!2024")
    const lower = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lower)) {
      return { valid: false, error: 'This password is too common. Choose a more unique password.' };
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
      isActive: !!dbUser.is_active,
      subscriptionTier: dbUser.subscription_tier || 'free',
      emailVerified: !!dbUser.email_verified  // Convert SQLite 0/1 to boolean
    };
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // Ensure database is ready
      await this.ensureDatabase();

      this.dbOps.cleanupExpiredSessions();
    } catch (error) {
      console.error('Session cleanup error:', error);
    }
  }

  /**
   * Invalidate all active sessions for a user.
   * Used on login (CRIT-4: session fixation prevention) and password change.
   */
  async invalidateAllSessionsForUser(userId: string): Promise<number> {
    try {
      await this.ensureDatabase();
      const stmt = this.db.prepare(
        'DELETE FROM user_sessions WHERE user_id = ?'
      );
      const result = stmt.run(userId);
      const count = result.changes || 0;
      if (count > 0) {
        logger.info('Invalidated all sessions for user', { userId, count });
      }
      return count;
    } catch (error) {
      logger.error('Failed to invalidate sessions for user', error as Error);
      return 0;
    }
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId: string): Promise<any[]> {
    try {
      // Ensure database is ready
      await this.ensureDatabase();

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
   async revokeSession(sessionId: string, userId: string): Promise<{ success: boolean; error?: string }> {
     try {
       // Ensure database is ready
       await this.ensureDatabase();

       // Hash sessionId for lookup
       const crypto = require('crypto');
       const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
       const stmt = this.db.prepare('DELETE FROM user_sessions WHERE session_id = ? AND user_id = ?');
       const result = stmt.run(sessionHash, userId);

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
       // Ensure database is ready
       await this.ensureDatabase();

       // Hash the presented refresh token for secure lookup
       const crypto = require('crypto');
       const sessionHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

       // Find session by hashed refresh token
       const stmt = this.db.prepare(`
         SELECT us.*, u.email, u.id as user_id 
         FROM user_sessions us
         JOIN users u ON us.user_id = u.id
         WHERE us.session_id = ? AND us.is_active = TRUE AND datetime(us.expires_at) > datetime('now')
       `);
       const session = stmt.get(sessionHash) as any;

       if (!session) {
         return { success: false, error: 'Invalid or expired refresh token' };
       }

       // Check if user is still active
       if (!session.is_active) {
         return { success: false, error: 'User account is deactivated' };
       }

       // Generate new token pair
       // HIGH-8 fix: email removed from JWT — use getUserEmail() from jwt.ts if needed
       const newToken = generateToken({
         userId: session.user_id.toString(),
       });

       // Generate new refresh token (token rotation)
       const newRefreshToken = uuidv4();
       const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

       // Invalidate old refresh token (delete by hashed session_id)
       this.db.prepare('DELETE FROM user_sessions WHERE session_id = ?').run(sessionHash);

       // Create new session with raw token; createSession will hash it
       this.dbOps.createSession(newRefreshToken, session.user_id, newExpiresAt, sessionInfo?.ipAddress, sessionInfo?.userAgent);

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
