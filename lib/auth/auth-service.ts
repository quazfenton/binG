import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/connection';
import { DatabaseOperations } from '../database/connection';
import { generateToken } from './jwt';

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
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  username?: string;
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

      // Create user
      const result = this.dbOps.createUser(
        credentials.email,
        credentials.username || '',
        passwordHash
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

      // Generate JWT token
      const token = generateToken({
        userId: userId.toString(),
        email: credentials.email
      });

      return {
        success: true,
        user: this.mapDbUserToUser(user),
        token,
        sessionId
      };

    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: 'Registration failed' };
    }
  }

  /**
   * Login user
   */
  async login(credentials: LoginCredentials, sessionInfo?: Partial<SessionInfo>): Promise<AuthResult> {
    try {
      // Get user by email
      const dbUser = this.dbOps.getUserByEmail(credentials.email) as any;
      if (!dbUser) {
        return { success: false, error: 'Invalid email or password' };
      }

      // Verify password
      const passwordValid = await this.verifyPassword(credentials.password, dbUser.password_hash);
      if (!passwordValid) {
        return { success: false, error: 'Invalid email or password' };
      }

      // Update last login
      this.updateLastLogin(dbUser.id);

      // Create session
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
   * Logout user
   */
  async logout(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.dbOps.deleteSession(sessionId);
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
      const stmt = this.db.prepare('DELETE FROM user_sessions WHERE id = ? AND user_id = ?');
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
}

// Export singleton instance
export const authService = new AuthService();