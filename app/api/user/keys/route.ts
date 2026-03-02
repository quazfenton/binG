import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/database/db';
import jwt from 'jsonwebtoken';
import { encryptSecret, decryptSecret } from '@/lib/utils/crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Helper to verify JWT token
async function verifyToken(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ');
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

    // SECURITY: Validate provider name to prevent injection
    if (!/^[a-zA-Z0-9_-]+$/.test(provider)) {
      return NextResponse.json({ error: 'Invalid provider name format' }, { status: 400 });
    }

    const db = await initializeDatabase();

    // SECURITY: Encrypt API key before storing
    let encryptedKey: string;
    if (ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
      encryptedKey = encryptSecret(apiKey, ENCRYPTION_KEY);
    } else if (ENCRYPTION_KEY) {
      encryptedKey = encryptSecret(apiKey, ENCRYPTION_KEY);
    } else {
      // Development without encryption key - warn but allow
      console.warn('⚠️  WARNING: Storing API key without encryption. Set ENCRYPTION_KEY in production.');
      encryptedKey = apiKey;
    }

    await db.run(
      'INSERT OR REPLACE INTO user_api_keys (user_id, provider, api_key) VALUES (?, ?, ?)',
      [userId, provider, encryptedKey]
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
    for (const row of keys) {
      // SECURITY: Decrypt API key on retrieval
      let decryptedKey: string;
      if (ENCRYPTION_KEY && row.api_key.includes(':')) {
        try {
          decryptedKey = decryptSecret(row.api_key, ENCRYPTION_KEY);
        } catch (decryptError) {
          console.error('Failed to decrypt API key:', decryptError);
          decryptedKey = '***ENCRYPTION_ERROR***';
        }
      } else {
        decryptedKey = row.api_key;
      }
      apiKeys[row.provider] = decryptedKey;
    }

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error('Get API keys API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
