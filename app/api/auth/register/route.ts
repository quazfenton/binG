import { NextResponse } from 'next/server';
import { initializeDatabase, hashPassword } from '@/lib/database/db';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const db = await initializeDatabase();
    const hashedPassword = await hashPassword(password);

    try {
      const result = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, hashedPassword);
      
      return NextResponse.json({ 
        message: 'User registered successfully', 
        userId: result.lastInsertRowid,
        user: {
          id: result.lastInsertRowid,
          email: email
        }
      });
    } catch (error: any) {
      if (error.message.includes('UNIQUE constraint failed')) {
        return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    console.error('Registration API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}