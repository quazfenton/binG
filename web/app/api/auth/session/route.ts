import { NextRequest, NextResponse } from 'next/server';
import { GET as sessionGET } from './gateway';

export async function GET(request: NextRequest) {
  return sessionGET(request);
}