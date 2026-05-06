import { NextRequest } from 'next/server';
import { GET as resourcesGET } from './resources/gateway';

export async function GET(request: NextRequest) {
  return resourcesGET(request);
}