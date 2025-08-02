import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/database/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Use a strong secret in production

// Helper to verify JWT token
async function verifyToken(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' '); // Get the actual token string
  try {
    const decoded: any = jwt.verify(token[1], JWT_SECRET);
    return decoded.userId;
  } catch (error) {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const userId = await verifyToken(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider, apiKey } = await req.json();
    if (!provider || !apiKey) {
      return NextResponse.json({ error: 'Provider and API key are required' }, { status: 400 });
    }

    const db = await initializeDatabase();
    
    // For simplicity, storing as plain text. In a real app, encrypt this.
    await db.run(
      'INSERT OR REPLACE INTO user_api_keys (user_id, provider, api_key) VALUES (?, ?, ?)',
      [userId, provider, apiKey]
    );

    return NextResponse.json({ message: 'API key saved successfully' });
  } catch (error) {
    console.error('Save API key API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const userId = await verifyToken(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await initializeDatabase();
    const keys = await db.all('SELECT provider, api_key FROM user_api_keys WHERE user_id = ?', [userId]);

    const apiKeys: Record<string, string> = {};
    keys.forEach((row: any) => {
      apiKeys[row.provider] = row.api_key;
    });

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error('Get API keys API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
