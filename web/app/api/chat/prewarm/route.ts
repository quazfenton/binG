import { NextResponse } from 'next/server';
import { GET as prewarmGET } from './gateway';

export async function GET() {
  return prewarmGET();
}