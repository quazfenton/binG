import { NextRequest, NextResponse } from 'next/server';
import { getToolManager } from '@/lib/tools';
import { toolAuthManager } from '@/lib/services/tool-authorization-manager';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

export async function POST(req: NextRequest) {
  try {
    const tokenFromQuery = req.nextUrl.searchParams.get('token');
    const authResult = await resolveRequestAuth(req, {
      bearerToken: tokenFromQuery,
      allowAnonymous: false,
    });
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
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Tool execution failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const tokenFromQuery = req.nextUrl.searchParams.get('token');
    const authResult = await resolveRequestAuth(req, {
      bearerToken: tokenFromQuery,
      allowAnonymous: false,
    });
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
    console.error('[Tools] Error fetching tools:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to fetch tools' }, { status: 500 });
  }
}
