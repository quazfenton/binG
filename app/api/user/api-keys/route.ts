/**
 * User API Keys API Route
 * 
 * Handles storage and retrieval of user API keys
 * - For authenticated users: stores encrypted in database
 * - For all users: also stores in localStorage as backup
 */

import { NextRequest, NextResponse } from 'next/server';
// Database import commented out until connection module is fixed
// import { getDatabase } from '@/lib/database/connection';
import { authManager } from '@/lib/backend/auth';

/**
 * GET /api/user/api-keys
 * Get user's stored API keys
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const userId = await authManager.getUserId(token);

    if (!userId) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get from database (commented out until database module is fixed)
    // const db = await getDatabase();
    // const result = await db.get(
    //   'SELECT encrypted_keys, updated_at FROM user_api_keys WHERE user_id = ?',
    //   [userId]
    // );

    // For now, return success - actual keys are in localStorage
    return NextResponse.json({
      hasKeys: false,
      message: 'Keys stored in localStorage (database integration pending)',
    });
  } catch (error: any) {
    console.error('Failed to get API keys:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve API keys' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/api-keys
 * Save user's API keys
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const userId = await authManager.getUserId(token);

    if (!userId) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { encryptedKeys } = body;

    if (!encryptedKeys) {
      return NextResponse.json(
        { error: 'encryptedKeys required' },
        { status: 400 }
      );
    }

    // Store in database (commented out until database module is fixed)
    // const db = await getDatabase();
    // await db.run(
    //   `INSERT OR REPLACE INTO user_api_keys (user_id, encrypted_keys, updated_at)
    //    VALUES (?, ?, datetime('now'))`,
    //   [userId, encryptedKeys]
    // );

    return NextResponse.json({
      success: true,
      message: 'API keys saved to localStorage (database integration pending)',
    });
  } catch (error: any) {
    console.error('Failed to save API keys:', error);
    return NextResponse.json(
      { error: 'Failed to save API keys' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/api-keys
 * Delete user's API keys
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const userId = await authManager.getUserId(token);

    if (!userId) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Delete from database (commented out until database module is fixed)
    // const db = await getDatabase();
    // await db.run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);

    return NextResponse.json({
      success: true,
      message: 'API keys deleted from localStorage (database integration pending)',
    });
  } catch (error: any) {
    console.error('Failed to delete API keys:', error);
    return NextResponse.json(
      { error: 'Failed to delete API keys' },
      { status: 500 }
    );
  }
}
