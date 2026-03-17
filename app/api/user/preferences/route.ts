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

    // Check if user has preferences record
    const existing = db.prepare(
      'SELECT preferences FROM user_preferences WHERE user_id = ?'
    ).get([userId]) as any;

    if (existing?.preferences) {
      return JSON.parse(existing.preferences);
    }

    // Return defaults
    return {
      OPENCODE_ENABLED: false,
      NULLCLAW_ENABLED: false,
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
 * Save user preference to database
 */
async function saveUserPreference(
  userId: string,
  key: string,
  value: boolean
): Promise<void> {
  try {
    const db = getDatabase();

    // Get existing preferences
    const existing = db.prepare(
      'SELECT preferences FROM user_preferences WHERE user_id = ?'
    ).get([userId]) as any;

    let preferences: Record<string, boolean> = {
      OPENCODE_ENABLED: false,
      NULLCLAW_ENABLED: false,
    };

    if (existing?.preferences) {
      preferences = JSON.parse(existing.preferences);
    }

    // Update the specific key
    preferences[key] = value;

    // Upsert preferences
    db.prepare(
      `INSERT INTO user_preferences (user_id, preferences, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         preferences = excluded.preferences,
         updated_at = CURRENT_TIMESTAMP`
    ).run([userId, JSON.stringify(preferences)]);
  } catch (error) {
    console.error('[UserPreferences] Failed to save preference:', error);
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
 * Save a user preference override
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

      // Validate and save each key-value pair
      const allowedKeys = ['OPENCODE_ENABLED', 'NULLCLAW_ENABLED'];
      const updates: Record<string, boolean> = {};

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

        updates[key] = value;
        await saveUserPreference(auth.userId || 'anonymous', key, value);
      }

      return NextResponse.json({
        success: true,
        preferences: updates,
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
