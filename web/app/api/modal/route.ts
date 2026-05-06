import { NextRequest } from 'next/server';
import { POST as trainPOST } from './train/gateway';

export async function POST(request: NextRequest) {
  return trainPOST(request);
}
