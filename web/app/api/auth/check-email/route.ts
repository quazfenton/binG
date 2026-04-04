import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const exists = await authService.checkEmailExists(email);

    return NextResponse.json({
      exists,
      available: !exists
    });

  } catch (error) {
    console.error('Check email API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}