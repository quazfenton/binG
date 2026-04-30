/**
 * Messaging Identity & Discovery Service
 * 
 * Manages PGP keys and public social discovery.
 */

import { db } from '@/lib/database/db'; // Assuming your standard DB connector

export interface MessagingProfile {
  userId: string;
  matrixId: string;
  pgpPublicKey: string;
  displayName: string;
  bio?: string;
  searchable: boolean;
}

export class MessagingIdentity {
  /**
   * Search for users by email or display name
   */
  static async searchUsers(query: string): Promise<MessagingProfile[]> {
    const stmt = db.prepare(`
      SELECT * FROM user_messaging_profiles 
      WHERE searchable = 1 AND (display_name LIKE ? OR user_id LIKE ?)
      LIMIT 10
    `);
    return stmt.all(`%${query}%`, `%${query}%`) as MessagingProfile[];
  }

  /**
   * Update PGP key for E2EE
   */
  static async updatePGPKey(userId: string, publicKey: string): Promise<void> {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_messaging_profiles (user_id, pgp_public_key)
      VALUES (?, ?)
    `);
    stmt.run(userId, publicKey);
  }

  /**
   * Get public profile for encryption
   */
  static async getPublicProfile(userId: string): Promise<MessagingProfile | null> {
    const stmt = db.prepare(`SELECT * FROM user_messaging_profiles WHERE user_id = ?`);
    return stmt.get(userId) as MessagingProfile | null;
  }
}
