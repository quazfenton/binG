import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, generateToken } from '@/lib/auth/jwt';
import { initializeDatabase } from '@/lib/database/db';

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request);
    
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    // Get user data from database to ensure user still exists
    const db = await initializeDatabase();
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(authResult.userId);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    // Generate new token
    const newToken = generateToken({
      userId: user.id.toString(),
      email: user.email
    });

    return NextResponse.json({
      token: newToken,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}