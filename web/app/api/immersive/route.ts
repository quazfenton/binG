import { NextRequest } from 'next/server';
import { GET as contentGET, DELETE as contentDELETE } from './content/[url]/gateway';

export async function GET(request: NextRequest) {
  return contentGET(request);
}

export async function DELETE(request: NextRequest) {
  return contentDELETE(request);
}
