import { NextRequest, NextResponse } from 'next/server';
import { GET as rootGET, POST as rootPOST, PUT as rootPUT, DELETE as rootDELETE } from './main';

export async function GET(request: NextRequest) {
  return rootGET(request);
}

export async function POST(request: NextRequest) {
  return rootPOST(request);
}

export async function PUT(request: NextRequest) {
  return rootPUT(request);
}

export async function DELETE(request: NextRequest) {
  return rootDELETE(request);
}