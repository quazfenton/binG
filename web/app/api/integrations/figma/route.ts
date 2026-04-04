/**
 * Figma Integration API
 * 
 * Unified endpoint for all Figma operations:
 * - GET /api/integrations/figma - List user's Figma files
 * - GET /api/integrations/figma?fileKey=xxx - Get file structure
 * - POST /api/integrations/figma { action: 'export', fileKey, nodeIds, format } - Export nodes as images/SVG
 * - POST /api/integrations/figma { action: 'components', fileKey } - Get components from file
 * - POST /api/integrations/figma { action: 'import', fileKey, nodeIds } - Import frames to visual editor
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getDatabase } from '@/lib/database/connection';
import { decryptApiKey, encryptApiKey } from '@/lib/database/connection';
import { createFigmaApi, FigmaApiError } from '@/lib/figma/api';
import { isFigmaConfigured, getFigmaRedirectUri } from '@/lib/figma/config';
import { generateCodeVerifier, generateCodeChallenge, generateState, generateAuthUrl } from '@/lib/figma/oauth';

export const runtime = 'nodejs';

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Get Figma access token for user from database
 */
async function getFigmaToken(userId: number): Promise<string | null> {
  try {
    const db = getDatabase();
    if (!db) return null;

    const stmt = db.prepare(`
      SELECT access_token_encrypted, token_expires_at, refresh_token_encrypted
      FROM external_connections
      WHERE user_id = ? AND provider = 'figma' AND is_active = TRUE
      LIMIT 1
    `);

    const row = stmt.get(userId) as {
      access_token_encrypted: string;
      token_expires_at: string | null;
      refresh_token_encrypted: string;
    } | undefined;

    if (!row?.access_token_encrypted) {
      return null;
    }

    // Check if token is expired
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;
    const now = new Date();
    
    // Refresh if expired or about to expire (5 min buffer)
    if (expiresAt && now >= new Date(expiresAt.getTime() - 5 * 60 * 1000)) {
      // Token expired, try to refresh
      const refreshToken = decryptApiKey(row.refresh_token_encrypted);
      if (refreshToken) {
        try {
          const { refreshToken: refreshFigmaToken } = await import('@/lib/figma/oauth');
          const tokenData = await refreshFigmaToken({ refreshToken });
          
          // Update database with new token
          const updateStmt = db.prepare(`
            UPDATE external_connections
            SET access_token_encrypted = ?,
                refresh_token_encrypted = ?,
                token_expires_at = datetime('now', '+' || ? || ' seconds'),
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND provider = 'figma'
          `);
          
          const newAccessToken = tokenData.access_token;
          const newRefreshToken = tokenData.refresh_token;
          
          updateStmt.run(
            encryptApiKey(newAccessToken),
            encryptApiKey(newRefreshToken),
            tokenData.expires_in,
            userId
          );
          
          return newAccessToken;
        } catch (refreshError) {
          console.error('[Figma] Token refresh failed:', refreshError);
          return null;
        }
      }
      return null;
    }

    return decryptApiKey(row.access_token_encrypted);
  } catch (error) {
    console.error('[Figma] Error getting token:', error);
    return null;
  }
}

/**
 * Check if user has Figma connection
 */
async function isFigmaConnected(userId: number): Promise<boolean> {
  try {
    const db = getDatabase();
    if (!db) return false;

    const stmt = db.prepare(`
      SELECT 1 FROM external_connections
      WHERE user_id = ? AND provider = 'figma' AND is_active = TRUE
      LIMIT 1
    `);

    return !!stmt.get(userId);
  } catch {
    return false;
  }
}

// ============================================================================
// OAuth State Storage (in-memory for now, should use database)
// ============================================================================

export const oauthStateStore = new Map<string, {
  userId: number;
  codeVerifier: string;
  state: string;
  expiresAt: Date;
}>();

// Clean up expired states every 10 minutes
setInterval(() => {
  const now = new Date();
  for (const [key, value] of oauthStateStore.entries()) {
    if (now >= value.expiresAt) {
      oauthStateStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ============================================================================
// API Routes
// ============================================================================

/**
 * GET /api/integrations/figma
 * - No params: List user's Figma files
 * - ?fileKey=xxx: Get file structure
 * - ?action=authorize: Initiate OAuth flow
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const fileKey = searchParams.get('fileKey');

  try {
    // Get session
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({
        error: 'Authentication required',
        requiresAuth: true,
      }, { status: 401 });
    }

    const userId = (session.user as any).id;
    if (!userId) {
      return NextResponse.json({ error: 'Invalid user session' }, { status: 401 });
    }

    // Action: authorize - initiate OAuth flow
    if (action === 'authorize') {
      if (!isFigmaConfigured()) {
        return NextResponse.json({
          error: 'Figma integration not configured',
          missingEnv: ['FIGMA_CLIENT_ID', 'FIGMA_CLIENT_SECRET'],
        }, { status: 500 });
      }

      // Generate PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = generateState();

      // Store state for callback validation
      oauthStateStore.set(state, {
        userId,
        codeVerifier,
        state,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      });

      const redirectUri = getFigmaRedirectUri();
      const authUrl = generateAuthUrl({
        redirectUri,
        state,
        codeChallenge,
      });

      return NextResponse.json({
        success: true,
        authUrl,
        status: 'pending',
      });
    }

    // Check Figma connection
    const isConnected = await isFigmaConnected(userId);
    if (!isConnected) {
      return NextResponse.json({
        error: 'Figma not connected',
        requiresAuth: true,
        connection: 'figma',
        authorizeUrl: '/api/integrations/figma?action=authorize',
      }, { status: 401 });
    }

    // Get access token
    const accessToken = await getFigmaToken(userId);
    if (!accessToken) {
      return NextResponse.json({
        error: 'Failed to get Figma access token',
        requiresReauth: true,
      }, { status: 401 });
    }

    const figma = createFigmaApi(accessToken);

    // GET /api/integrations/figma?fileKey=xxx - Get file structure
    if (fileKey) {
      try {
        const fileData = await figma.getFile(fileKey, { depth: 2 });
        
        return NextResponse.json({
          success: true,
          file: {
            key: fileData.meta?.key,
            name: fileData.meta?.name,
            thumbnailUrl: fileData.meta?.thumbnailUrl,
            lastModified: fileData.meta?.lastModified,
            root: fileData.document,
          },
        });
      } catch (error) {
        if (error instanceof FigmaApiError) {
          return NextResponse.json({
            error: error.message,
            statusCode: error.statusCode,
          }, { status: error.statusCode });
        }
        throw error;
      }
    }

    // GET /api/integrations/figma - List user's files
    try {
      const filesData = await figma.getFiles();
      
      return NextResponse.json({
        success: true,
        files: filesData.meta?.files || [],
      });
    } catch (error) {
      if (error instanceof FigmaApiError) {
        return NextResponse.json({
          error: error.message,
          statusCode: error.statusCode,
        }, { status: error.statusCode });
      }
      throw error;
    }
  } catch (error) {
    console.error('[Figma Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process Figma request',
    }, { status: 500 });
  }
}

/**
 * POST /api/integrations/figma
 * - { action: 'export', fileKey, nodeIds, format } - Export nodes
 * - { action: 'components', fileKey } - Get components
 * - { action: 'import', fileKey, nodeIds } - Import to visual editor
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch (error: any) {
    return NextResponse.json({
      error: 'Invalid JSON in request body',
      details: error.message,
    }, { status: 400 });
  }

  try {
    // Get session
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    if (!userId) {
      return NextResponse.json({ error: 'Invalid user session' }, { status: 401 });
    }

    // Check Figma connection
    const isConnected = await isFigmaConnected(userId);
    if (!isConnected) {
      return NextResponse.json({
        error: 'Figma not connected',
        requiresAuth: true,
      }, { status: 401 });
    }

    // Get access token
    const accessToken = await getFigmaToken(userId);
    if (!accessToken) {
      return NextResponse.json({
        error: 'Failed to get Figma access token',
        requiresReauth: true,
      }, { status: 401 });
    }

    const figma = createFigmaApi(accessToken);
    const { action, fileKey, nodeIds } = body;

    // Validate fileKey for all actions
    if (!fileKey) {
      return NextResponse.json({ error: 'fileKey is required' }, { status: 400 });
    }

    // Action: export - Export nodes as images/SVG
    if (action === 'export') {
      if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
        return NextResponse.json({ error: 'nodeIds array is required' }, { status: 400 });
      }

      const format = body.format || 'svg';
      const scale = body.scale || 1;

      try {
        const imageData = await figma.getImages(fileKey, nodeIds, {
          format: format as 'png' | 'jpg' | 'svg' | 'pdf',
          scale,
        });

        return NextResponse.json({
          success: true,
          images: imageData.images,
          format,
        });
      } catch (error) {
        if (error instanceof FigmaApiError) {
          return NextResponse.json({
            error: error.message,
            statusCode: error.statusCode,
          }, { status: error.statusCode });
        }
        throw error;
      }
    }

    // Action: components - Get components from file
    if (action === 'components') {
      try {
        const componentsData = await figma.getComponents(fileKey);
        
        return NextResponse.json({
          success: true,
          components: componentsData.meta?.components || [],
        });
      } catch (error) {
        if (error instanceof FigmaApiError) {
          return NextResponse.json({
            error: error.message,
            statusCode: error.statusCode,
          }, { status: error.statusCode });
        }
        throw error;
      }
    }

    // Action: import - Import frames to visual editor (returns file structure)
    if (action === 'import') {
      if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
        return NextResponse.json({ error: 'nodeIds array is required' }, { status: 400 });
      }

      try {
        // Get full file structure
        const fileData = await figma.getFile(fileKey, { depth: 4 });
        
        // Find requested nodes
        const findNode = (node: any, id: string): any | null => {
          if (node.id === id) return node;
          if (node.children) {
            for (const child of node.children) {
              const found = findNode(child, id);
              if (found) return found;
            }
          }
          return null;
        };

        const importedNodes = nodeIds
          .map((id: string) => findNode(fileData.document, id))
          .filter(Boolean);

        if (importedNodes.length === 0) {
          return NextResponse.json({
            error: 'No matching nodes found',
          }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          file: {
            key: fileData.meta?.key,
            name: fileData.meta?.name,
          },
          nodes: importedNodes,
          message: 'Nodes ready for import to visual editor',
        });
      } catch (error) {
        if (error instanceof FigmaApiError) {
          return NextResponse.json({
            error: error.message,
            statusCode: error.statusCode,
          }, { status: error.statusCode });
        }
        throw error;
      }
    }

    // Unknown action
    return NextResponse.json({
      error: 'Unknown action. Valid actions: export, components, import',
    }, { status: 400 });

  } catch (error) {
    console.error('[Figma Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process Figma request',
    }, { status: 500 });
  }
}
