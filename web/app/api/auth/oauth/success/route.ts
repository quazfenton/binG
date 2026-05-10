import { NextRequest, NextResponse } from 'next/server';
import { GET as gatewayGet } from './gateway';

export async function GET(request: NextRequest) { return gatewayGet(request); }

export const dynamic = 'force-dynamic';