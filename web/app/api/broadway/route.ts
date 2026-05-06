import { NextRequest } from 'next/server';
import { GET as dealsGET, POST as dealsPOST } from './deals/gateway';

export async function GET(request: NextRequest) {
  return dealsGET(request);
}

export async function POST(request: NextRequest) {
  return dealsPOST(request);
}