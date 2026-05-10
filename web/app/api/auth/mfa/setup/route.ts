import { NextRequest, NextResponse } from 'next/server';
import { POST as gatewayPost } from './gateway';

export async function POST(request: NextRequest) { return gatewayPost(request); }

export const dynamic = 'force-dynamic';