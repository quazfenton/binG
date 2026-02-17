import { NextRequest, NextResponse } from 'next/server';
import { getToolManager } from '@/lib/tools';
import { toolAuthManager } from '@/lib/services/tool-authorization-manager';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token - do NOT trust userId from request body
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token, ignore body userId
    const authenticatedUserId = authResult.userId;

    const body = await req.json();
    const { toolKey, input, conversationId, metadata } = body;

    if (!toolKey) {
      return NextResponse.json({ error: 'toolKey is required' }, { status: 400 });
    }

    // Check authorization for the authenticated user
    const authorized = await toolAuthManager.isAuthorized(authenticatedUserId, toolKey);
    if (!authorized) {
      const provider = toolAuthManager.getRequiredProvider(toolKey);

      // CRITICAL: If tool has no required provider but is not authorized,
      // this indicates a misconfiguration - explicitly deny access
      if (!provider) {
        console.error(`[Tools] Authorization bypass attempt detected: userId=${authenticatedUserId}, toolKey=${toolKey}`);
        return NextResponse.json({
          error: 'Access denied: unable to verify authorization for this tool',
          toolName: toolKey,
        }, { status: 403 });
      }

      const authUrl = toolAuthManager.getAuthorizationUrl(provider);
      return NextResponse.json({
        status: 'auth_required',
        authUrl: authUrl ? `${authUrl}&userId=${authenticatedUserId}` : null,
        provider,
        toolName: toolKey,
        message: `Please connect your ${provider} account to use ${toolKey}`,
      }, { status: 403 });
    }

    const toolManager = getToolManager();
    const result = await toolManager.executeTool(toolKey, input, {
      userId: authenticatedUserId,
      conversationId,
      metadata,
    });

    if (result.authRequired && result.authUrl) {
      return NextResponse.json({
        status: 'auth_required',
        authUrl: result.authUrl,
        toolName: toolKey,
        message: 'Please authorize the application to continue',
      });
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ status: 'success', output: result.output });
  } catch (error: any) {
    console.error('[Tools] Execution error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // Authenticate user from JWT token
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const authenticatedUserId = authResult.userId;
    const category = req.nextUrl.searchParams.get('category');

    const toolManager = getToolManager();

    if (category) {
      const tools = toolManager.getToolsByCategory(category);
      return NextResponse.json({ tools });
    }

    // Get available tools and connected providers for the authenticated user
    const available = await toolAuthManager.getAvailableTools(authenticatedUserId);
    const providers = await toolAuthManager.getConnectedProviders(authenticatedUserId);
    return NextResponse.json({ availableTools: available, connectedProviders: providers });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
