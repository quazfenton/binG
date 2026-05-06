import { NextRequest } from 'next/server';
import { POST as parseEditsPOST } from './vfs-parse-edits/gateway';
import { GET as readFileGET } from './vfs-read-file/gateway';

export async function GET(request: NextRequest) {
  return readFileGET(request);
}

export async function POST(request: NextRequest) {
  return parseEditsPOST(request);
}
