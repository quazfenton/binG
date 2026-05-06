import { NextRequest } from 'next/server';
import { GET as telemetryGET } from './tool-telemetry/gateway';

export async function GET(request: NextRequest) {
  return telemetryGET();
}
