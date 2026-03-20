/**
 * Google Integration API
 *
 * Provides Google service operations via Auth0 connection tokens:
 * - GET /api/integrations/google/drive - List Google Drive files
 * - GET /api/integrations/google/calendar - List calendar events
 * - POST /api/integrations/google/drive/download - Download file content
 *
 * Uses Auth0 connection tokens for authenticated access.
 * Falls back to Nango/Arcade if Auth0 not connected.
 * 
 * Auth0 Integration:
 * - Users connect via /auth/connect?connection=google-oauth2
 * - Tokens stored in Auth0 Token Vault
 * - Complementary to Nango/Composio/Arcade (not a replacement)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAccessTokenForConnection, AUTH0_CONNECTIONS } from '@/lib/auth0';

export const runtime = 'nodejs';

/**
 * Google API base URLs
 */
const GOOGLE_APIS = {
  DRIVE: 'https://www.googleapis.com/drive/v3',
  CALENDAR: 'https://www.googleapis.com/calendar/v3',
  GMAIL: 'https://gmail.googleapis.com/gmail/v1',
  DOCS: 'https://docs.googleapis.com/v1',
  SHEETS: 'https://sheets.googleapis.com/v4',
};

/**
 * Fetch with Google token
 */
async function fetchGoogle<T>(endpoint: string, token: string, apiBase: string = GOOGLE_APIS.DRIVE): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };

  const response = await fetch(`${apiBase}${endpoint}`, { headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message || `Google API error: ${response.status}`);
  }

  return response.json();
}

/**
 * GET /api/integrations/google
 * 
 * Query params:
 * - service: 'drive' | 'calendar' | 'gmail' (default: 'drive')
 * - action: 'list' | 'get' | 'download' (default: 'list')
 * - fileId: string (for get/download actions)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'drive';
    const action = searchParams.get('action') || 'list';
    const fileId = searchParams.get('fileId');

    // Try to get Auth0 Google token
    const auth0Token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.GOOGLE);
    
    if (!auth0Token) {
      return NextResponse.json({
        error: 'Google not connected',
        requiresAuth: true,
        connection: 'google-oauth2',
        connectUrl: '/auth/connect?connection=google-oauth2',
      }, { status: 401 });
    }

    // Route to appropriate service
    switch (service) {
      case 'drive':
        return await handleDrive(auth0Token, action, fileId);
      
      case 'calendar':
        return await handleCalendar(auth0Token, action);
      
      case 'gmail':
        return await handleGmail(auth0Token, action);
      
      default:
        return NextResponse.json({ error: 'Unknown service' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Google Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process Google request'
    }, { status: 500 });
  }
}

/**
 * Handle Google Drive operations
 */
async function handleDrive(token: string, action: string, fileId?: string | null) {
  if (action === 'list') {
    // List Drive files
    const response = await fetchGoogle<{ files: Array<{ id: string; name: string; mimeType: string; size?: string }> }>(
      '/files?q=mimeType!=\'application/vnd.google-apps.folder\'&fields=files(id,name,mimeType,size)',
      token
    );

    return NextResponse.json({
      success: true,
      service: 'drive',
      action: 'list',
      files: response.files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? parseInt(f.size) : 0,
      })),
      authSource: 'auth0',
    });
  }

  if (action === 'download' && fileId) {
    // Download file content
    const encodedFileId = encodeURIComponent(fileId);
    const downloadResponse = await fetch(`${GOOGLE_APIS.DRIVE}/files/${encodedFileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!downloadResponse.ok) {
      throw new Error('Failed to download file');
    }

    const content = await downloadResponse.text();
    
    return NextResponse.json({
      success: true,
      service: 'drive',
      action: 'download',
      fileId,
      content,
      authSource: 'auth0',
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

/**
 * Handle Google Calendar operations
 */
async function handleCalendar(token: string, action: string) {
  if (action === 'list') {
    // List calendars
    const calendars = await fetchGoogle<{ items: Array<{ id: string; summary: string }> }>(
      '/users/me/calendarList',
      token,
      GOOGLE_APIS.CALENDAR
    );

    return NextResponse.json({
      success: true,
      service: 'calendar',
      action: 'list',
      calendars: (calendars.items || []).map(c => ({
        id: c.id,
        name: c.summary,
      })),
      authSource: 'auth0',
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

/**
 * Handle Gmail operations
 */
async function handleGmail(token: string, action: string) {
  if (action === 'list') {
    // List recent messages
    const messages = await fetchGoogle<{ messages: Array<{ id: string; threadId: string }> }>(
      '/users/me/messages?maxResults=10',
      token,
      GOOGLE_APIS.GMAIL
    );

    return NextResponse.json({
      success: true,
      service: 'gmail',
      action: 'list',
      messages: messages.messages || [],
      authSource: 'auth0',
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
