import { NextRequest, NextResponse } from 'next/server';
import { getToolManager } from '@/lib/tools';
import { toolAuthManager } from '@/lib/services/tool-authorization-manager';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { checkRateLimitMiddleware } from '@/lib/middleware/rate-limit';
import { cors, addCORSHeaders } from '@/lib/middleware/cors';
import { validateToolExecutionRequest } from '@/lib/middleware/validation';

export async function POST(req: NextRequest) {
  const requestId = `tools_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    // SECURITY: Only accept auth via Authorization header, NOT query params
    // Query param tokens can leak via logs, browser history, and Referer headers
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            type: 'authentication_required',
            message: 'Valid authentication token required',
          },
          requestId,
        },
        { status: 401 }
      );
    }

    // Check rate limit
    const rateLimitResponse = checkRateLimitMiddleware(req, '/api/tools/execute', 100, 60000);
    if (rateLimitResponse) {
      return addCORSHeaders(rateLimitResponse, undefined, req);
    }

    // Use authenticated userId from token, ignore body userId
    const authenticatedUserId = authResult.userId;

    const body = await req.json();
    
    // Validate request body
    const validation = validateToolExecutionRequest(body);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error,
          requestId,
        },
        { status: 400 }
      );
    }

    const { toolKey, input, conversationId, metadata } = validation.data;

    // Check authorization for the authenticated user
    const authorized = await toolAuthManager.isAuthorized(authenticatedUserId, toolKey);
    if (!authorized) {
      const provider = toolAuthManager.getRequiredProvider(toolKey);

      // CRITICAL: If tool has no required provider but is not authorized,
      // this indicates a misconfiguration - explicitly deny access
      if (!provider) {
        console.error(`[Tools] Authorization bypass attempt detected: userId=${authenticatedUserId}, toolKey=${toolKey}`);
        return NextResponse.json({
          success: false,
          error: {
            type: 'access_denied',
            message: 'Unable to verify authorization for this tool',
          },
          toolName: toolKey,
          requestId,
        }, { status: 403 });
      }

      const authUrl = toolAuthManager.getAuthorizationUrl(provider);
      return NextResponse.json({
        success: false,
        error: {
          type: 'auth_required',
          message: `Please connect your ${provider} account to use ${toolKey}`,
          authUrl: authUrl ? `${authUrl}&userId=${authenticatedUserId}` : null,
          provider,
        },
        toolName: toolKey,
        requestId,
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
        success: false,
        error: {
          type: 'auth_required',
          message: 'Please authorize the application to continue',
          authUrl: result.authUrl,
        },
        toolName: toolKey,
        requestId,
      });
    }

    if (!result.success) {
      return NextResponse.json({ 
        success: false,
        error: {
          type: 'execution_error',
          message: 'Tool execution failed',
        },
        requestId,
      }, { status: 500 });
    }

    const response = NextResponse.json({
      success: true,
      output: result.output,
      requestId,
    });

    return addCORSHeaders(response, undefined, req);
  } catch (error: any) {
    console.error(`[Tools] Execution error (${requestId}):`, error);
    // Don't expose internal error details to clients
    return NextResponse.json({
      success: false,
      error: {
        type: 'internal_error',
        message: 'Tool execution failed',
      },
      requestId,
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const requestId = `tools_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    // SECURITY: Only accept auth via Authorization header
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            type: 'authentication_required',
            message: 'Valid authentication token required',
          },
          requestId,
        },
        { status: 401 }
      );
    }

    const authenticatedUserId = authResult.userId;
    const category = req.nextUrl.searchParams.get('category');

    const toolManager = getToolManager();

    if (category) {
      const tools = toolManager.getToolsByCategory(category);
      const response = NextResponse.json({
        success: true,
        tools,
        requestId,
      });
      return addCORSHeaders(response, undefined, req);
    }

    // Get available tools and connected providers for the authenticated user
    const available = await toolAuthManager.getAvailableTools(authenticatedUserId);
    const providers = await toolAuthManager.getConnectedProviders(authenticatedUserId);

    const response = NextResponse.json({
      success: true,
      availableTools: available,
      connectedProviders: providers,
      requestId,
    });

    return addCORSHeaders(response, undefined, req);
  } catch (error: any) {
    console.error(`[Tools] Error fetching tools (${requestId}):`, error);
    // Don't expose internal error details to clients
    return NextResponse.json({ 
      success: false,
      error: {
        type: 'internal_error',
        message: 'Failed to fetch tools',
      },
      requestId,
    }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  // Use proper CORS middleware for preflight requests
  const response = new NextResponse(null, { status: 200 });
  return addCORSHeaders(response, undefined, request);
}
