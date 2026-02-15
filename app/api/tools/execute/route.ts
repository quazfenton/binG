import { NextRequest, NextResponse } from 'next/server';
import { getToolManager } from '@/lib/tools';
import { toolAuthManager } from '@/lib/services/tool-authorization-manager';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { toolKey, input, userId, conversationId, metadata } = body;

    if (!toolKey || !userId) {
      return NextResponse.json({ error: 'toolKey and userId are required' }, { status: 400 });
    }

    // Check authorization
    const authorized = await toolAuthManager.isAuthorized(parseInt(userId, 10), toolKey);
    if (!authorized) {
      const provider = toolAuthManager.getRequiredProvider(toolKey);
      if (provider) {
        const authUrl = toolAuthManager.getAuthorizationUrl(provider);
        return NextResponse.json({
          status: 'auth_required',
          authUrl: `${authUrl}&userId=${userId}`,
          provider,
          toolName: toolKey,
          message: `Please connect your ${provider} account to use ${toolKey}`,
        });
      }
    }

    const toolManager = getToolManager();
    const result = await toolManager.executeTool(toolKey, input, {
      userId,
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
    const userId = req.nextUrl.searchParams.get('userId');
    const category = req.nextUrl.searchParams.get('category');

    const toolManager = getToolManager();

    if (category) {
      const tools = toolManager.getToolsByCategory(category);
      return NextResponse.json({ tools });
    }

    if (userId) {
      const available = await toolAuthManager.getAvailableTools(parseInt(userId, 10));
      const providers = await toolAuthManager.getConnectedProviders(parseInt(userId, 10));
      return NextResponse.json({ availableTools: available, connectedProviders: providers });
    }

    const categories = toolManager.getCategories();
    return NextResponse.json({ categories });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
