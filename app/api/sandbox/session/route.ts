import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';
import { getSandboxProvider } from '@/lib/sandbox/providers';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';

// Force Node.js runtime for Daytona SDK compatibility
export const runtime = 'nodejs';

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

    // Rate limiting: prevent rapid session creation
    const rateLimitResult = checkUserRateLimit(authenticatedUserId, 'generic');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many session operations.', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers }
      );
    }

    const body = await req.json();

    const existing = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (existing) {
      return NextResponse.json({ session: existing });
    }

    const session = await sandboxBridge.createWorkspace(authenticatedUserId, body.config);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error: any) {
    console.error('[Sandbox Session] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token
    const authenticatedUserId = authResult.userId;

    const session = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('[Sandbox Session] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token
    const authenticatedUserId = authResult.userId;

    const body = await req.json();
    const { sessionId, sandboxId } = body;

    if (!sessionId || !sandboxId) {
      return NextResponse.json({ error: 'sessionId and sandboxId are required' }, { status: 400 });
    }

    // Verify sandbox ownership - ensure the authenticated user owns this sandbox
    const userSession = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      return NextResponse.json(
        { error: 'Unauthorized: sandbox does not belong to this user' },
        { status: 403 }
      );
    }

    await sandboxBridge.destroyWorkspace(sessionId, sandboxId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Sandbox Session] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}

/**
 * PATCH /api/sandbox/session
 *
 * Service management for sandbox environments.
 * Merged from the removed app/api/sandbox/services/route.ts.
 *
 * Body: { action: 'list' | 'configure' | 'restart' | 'status', service?, provider? }
 *
 * action='list'      - list all services on the sandbox
 * action='configure' - create/update a service (service must be a ServiceConfig object)
 * action='restart'   - restart a service by name (service must be a string)
 * action='status'    - get detailed status of a service by name (service must be a string)
 *
 * provider is optional; defaults to SANDBOX_PROVIDER env var or 'daytona'.
 * Only providers that implement the service methods (e.g. Sprites) will succeed.
 */
export async function PATCH(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token - do NOT trust userId from request body
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const authenticatedUserId = authResult.userId;

    const body = await req.json();
    const { action, service, provider } = body as {
      action: 'list' | 'configure' | 'restart' | 'status';
      service?: Record<string, any> | string;
      provider?: string;
    };

    if (!action) {
      return NextResponse.json(
        { error: 'action is required: list | configure | restart | status' },
        { status: 400 }
      );
    }

    // Verify sandbox ownership - sandbox must belong to the authenticated user
    const userSession = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!userSession) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }

    const { sandboxId } = userSession;

    // Resolve sandbox handle through the provider layer
    // Prefer caller-supplied provider, fall back to env / registry default
    const sandboxProvider = getSandboxProvider(
      (provider as any) ?? (process.env.SANDBOX_PROVIDER as any) ?? undefined
    );
    const handle = await sandboxProvider.getSandbox(sandboxId);

    switch (action) {
      case 'list': {
        if (!('listServices' in handle) || typeof (handle as any).listServices !== 'function') {
          return NextResponse.json(
            { error: 'Service listing is not supported by the active sandbox provider' },
            { status: 400 }
          );
        }
        const services = await (handle as any).listServices();
        return NextResponse.json({ success: true, sandboxId, services, count: services.length });
      }

      case 'configure': {
        if (!('configureService' in handle) || typeof (handle as any).configureService !== 'function') {
          return NextResponse.json(
            { error: 'Service configuration is not supported by the active sandbox provider (requires Sprites)' },
            { status: 400 }
          );
        }
        if (!service || typeof service === 'string') {
          return NextResponse.json(
            { error: 'service must be a configuration object for the configure action' },
            { status: 400 }
          );
        }
        const cfg = service as Record<string, any>;
        if (!cfg.name || !cfg.command) {
          return NextResponse.json(
            { error: 'service.name and service.command are required' },
            { status: 400 }
          );
        }
        const serviceInfo = await (handle as any).configureService(cfg);
        return NextResponse.json({
          success: true,
          action: 'configure',
          service: serviceInfo,
          message: `Service '${cfg.name}' configured successfully`,
        });
      }

      case 'restart': {
        if (!('restartService' in handle) || typeof (handle as any).restartService !== 'function') {
          return NextResponse.json(
            { error: 'Service restart is not supported by the active sandbox provider (requires Sprites)' },
            { status: 400 }
          );
        }
        if (typeof service !== 'string' || !service) {
          return NextResponse.json(
            { error: 'service must be a service name string for the restart action' },
            { status: 400 }
          );
        }
        const result = await (handle as any).restartService(service);
        return NextResponse.json({
          success: result.success,
          action: 'restart',
          serviceName: service,
          error: result.error,
          message: result.success
            ? `Service '${service}' restarted successfully`
            : `Failed to restart service: ${result.error}`,
        });
      }

      case 'status': {
        if (!('getServiceStatus' in handle) || typeof (handle as any).getServiceStatus !== 'function') {
          return NextResponse.json(
            { error: 'Service status is not supported by the active sandbox provider (requires Sprites)' },
            { status: 400 }
          );
        }
        if (typeof service !== 'string' || !service) {
          return NextResponse.json(
            { error: 'service must be a service name string for the status action' },
            { status: 400 }
          );
        }
        const status = await (handle as any).getServiceStatus(service);
        return NextResponse.json({ success: true, action: 'status', serviceName: service, status });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action '${action}'. Valid actions: list, configure, restart, status` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[Sandbox Session/Services] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to manage service' },
      { status: 500 }
    );
  }
}
