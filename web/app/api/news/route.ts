import { NextRequest, NextResponse } from 'next/server';
import { GET as feedGET, POST as feedPOST } from './main';
import { GET as rssGET, POST as rssPOST } from './rss/gateway';
import { GET as imageSearchGET, POST as imageSearchPOST } from './image-search/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'rss') return rssGET(request);
  if (segments.length === 3 && segments[2] === 'image-search') return imageSearchGET(request);
  return feedGET(request);
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3) {
    if (segments[2] === 'clear-cache') return feedPOST(request);
    if (segments[2] === 'rss-parse') return rssPOST(request);
    if (segments[2] === 'image-search') return imageSearchPOST(request);
  }
  return feedPOST(request);
}