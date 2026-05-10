import { NextRequest, NextResponse } from 'next/server';
import { GET as gatewayGet } from './gateway';
import { POST as gatewayPost } from './gateway';

export async function GET(request: NextRequest) { return gatewayGet(request); }

export async function POST(request: NextRequest) { return gatewayPost(request); }

export const dynamic = 'force-dynamic';