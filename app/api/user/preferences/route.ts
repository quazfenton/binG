/**
 * User Preferences API
 * 
 * Allows users to override environment variables for their session.
 * Preferences are stored in the database and sync across devices.
 * 
 * POST /api/user/preferences - Save user preference
 * GET /api/user/preferences - Get user preferences
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { withAuth } from '@/lib/auth/enhanced-middleware';

/**
 * Get user preferences from database
 */
async function getUserPreferences(userId: string): Promise<Record<string, boolean>> {
  try {
    const db = getDatabase();

    // Get all preferences as key-value pairs
    const rows = db.prepare(
      'SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ?'
    ).all([userId]) as any[];

    if (!rows || rows.length === 0) {
      // Return defaults
      return {
        OPENCODE_ENABLED: false,
        NULLCLAW_ENABLED: false,
      };
    }

    // Convert rows to object
    const preferences: Record<string, boolean> = {};
    for (const row of rows) {
      try {
        preferences[row.preference_key] = JSON.parse(row.preference_value);
      } catch {
        // If parsing fails, try as string boolean
        preferences[row.preference_key] = row.preference_value === 'true';
      }
    }

    // Ensure defaults exist
    return {
      OPENCODE_ENABLED: false,
      NULLCLAW_ENABLED: false,
      ...preferences,
    };
  } catch (error) {
    console.error('[UserPreferences] Failed to get preferences:', error);
    // Return defaults on error
    return {
      OPENCODE_ENABLED: false,
      NULLCLAW_ENABLED: false,
    };
  }
}

/**
 * Save user preferences to database (atomic batch update)
 */
async function saveUserPreferences(
  userId: string,
  preferences: Record<string, boolean>
): Promise<void> {
  try {
    const db = getDatabase();

    // Use transaction for atomic batch update
    const transaction = db.transaction((updates: Array<[string, string]>) => {
      for (const [key, value] of updates) {
        db.prepare(
          `INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
        ).run([userId, key, value]);
      }
    });

    // Convert preferences to array for transaction
    const updates: Array<[string, string]> = Object.entries(preferences).map(
      ([key, value]) => [key, JSON.stringify(value)]
    );

    // Execute transaction
    transaction(updates);
  } catch (error) {
    console.error('[UserPreferences] Failed to save preferences:', error);
    throw error;
  }
}

/**
 * GET /api/user/preferences
 * Get all user preferences
 */
export const GET = withAuth(
  async (request: NextRequest, auth) => {
    try {
      const preferences = await getUserPreferences(auth.userId || 'anonymous');

      return NextResponse.json({
        success: true,
        preferences,
      });
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  }
);

/**
 * POST /api/user/preferences
 * Save user preference overrides (atomic batch update)
 *
 * Body: { [key: string]: boolean }
 * Example: { "OPENCODE_ENABLED": true }
 */
export const POST = withAuth(
  async (request: NextRequest, auth) => {
    try {
      const body = await request.json();

      // Validate body is an object
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { success: false, error: 'Invalid request body' },
          { status: 400 }
        );
      }

      // Validate all keys and values first
      const allowedKeys = ['OPENCODE_ENABLED', 'NULLCLAW_ENABLED'];
      const validatedUpdates: Record<string, boolean> = {};

      for (const [key, value] of Object.entries(body)) {
        // Only allow specific keys
        if (!allowedKeys.includes(key)) {
          return NextResponse.json(
            { success: false, error: `Unknown preference key: ${key}` },
            { status: 400 }
          );
        }

        // Only allow boolean values
        if (typeof value !== 'boolean') {
          return NextResponse.json(
            { success: false, error: `Value for ${key} must be boolean` },
            { status: 400 }
          );
        }

        validatedUpdates[key] = value;
      }

      // Save all preferences atomically in single transaction
      await saveUserPreferences(auth.userId || 'anonymous', validatedUpdates);

      return NextResponse.json({
        success: true,
        preferences: validatedUpdates,
        message: 'Preferences saved successfully',
      });
    } catch (error: any) {
      console.error('[UserPreferences] Save failed:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  }
);
