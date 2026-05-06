import { NextRequest } from 'next/server';
import { GET as zipballGET } from './zipball/[owner]/[repo]/gateway';

export async function GET(request: NextRequest) {
  return zipballGET(request);
}
