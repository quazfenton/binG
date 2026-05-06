import { NextRequest } from 'next/server';
import { POST as sandboxPOST, PUT as sandboxPUT, DELETE as sandboxDELETE, GET as sandboxGET } from './sandbox/gateway';

export async function GET(request: NextRequest) {
  return sandboxGET();
}

export async function POST(request: NextRequest) {
  return sandboxPOST(request);
}

export async function PUT(request: NextRequest) {
  return sandboxPUT(request);
}

export async function DELETE(request: NextRequest) {
  return sandboxDELETE(request);
}
