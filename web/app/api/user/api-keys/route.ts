/**
 * User API Keys API Route
 * 
 * Handles storage and retrieval of user API keys
 * - For authenticated users: stores encrypted in database
 * - For all users: also stores in localStorage as backup
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getDatabase } from '@/lib/database/connection';
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

    // Get from database
    const db = getDatabase();
    const result = db.prepare(
      'SELECT encrypted_keys, updated_at FROM user_api_keys WHERE user_id = ?'
    ).get(userId) as { encrypted_keys: string; updated_at: string } | undefined;

    if (!result) {
      return NextResponse.json({ 
        hasKeys: false, 
        message: 'No keys stored in database' 
      });
    }

    // Return metadata only - actual decryption happens client-side
    return NextResponse.json({
      hasKeys: true,
      updatedAt: result.updated_at,
      message: 'Keys retrieved from database (decryption happens client-side)',
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

    // Store in database
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO user_api_keys (user_id, encrypted_keys, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(userId, encryptedKeys);

    return NextResponse.json({
      success: true,
      message: 'API keys saved to database successfully',
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

    // Delete from database
    const db = getDatabase();
    db.prepare('DELETE FROM user_api_keys WHERE user_id = ?').run(userId);

    return NextResponse.json({
      success: true,
      message: 'API keys deleted from database successfully',
    });
  } catch (error: any) {
    console.error('Failed to delete API keys:', error);
    return NextResponse.json(
      { error: 'Failed to delete API keys' },
      { status: 500 }
    );
  }
}
