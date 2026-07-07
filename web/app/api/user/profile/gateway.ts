import { NextRequest, NextResponse } from 'next/server';


import { verifyAuth } from '@/lib/auth/jwt';
import { initializeDatabase, hashPassword, comparePassword } from '@/lib/database/db';
import { csrfCheckOrReject } from '@/lib/auth/csrf';

export async function PUT(request: NextRequest) {
  try {
    // HIGH-10 fix: CSRF protection on profile update
    const csrfReject = csrfCheckOrReject(request);
    if (csrfReject) return csrfReject;

    // NEW-1 followup-b (2026-07-07, /opt/bing/docs/async-parallelization-opportunities.md
    // §NEW-1 followup-b): Promise.all the verifyAuth(request) + request.json() pair to
    // mask wallclock. Pre-PA CSRF gate stays BEFORE this PA. PUT-only: the GET handler
    // at this route is untouched since it does a sync DB read, not a verifyAuth+body
    // pattern. ~2-5ms saved per PUT request on the auth+body overlap window.
    const [authResult, body] = await Promise.all([verifyAuth(request), request.json()]);

    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current password and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }

    const db = await initializeDatabase();
    
    // Get current user data
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authResult.userId) as { id: number; email: string; password: string } | undefined;
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
    
    if (!isCurrentPasswordValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedNewPassword, authResult.userId);

    return NextResponse.json({ 
      message: 'Password updated successfully',
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Group C audit (2026-07-07, /opt/bing/docs/async-parallelization-opportunities.md
    // §NEW-1 followup-b / Group C): Promise.all the verifyAuth(request) +
    // initializeDatabase() pair to mask wallclock. audit-clean because
    // /opt/bing/web/lib/database/db.ts `initializeDatabase` body is fully synchronous
    // (no `await` between the `if (dbInstance)` check and the `dbInstance = db`
    // assignment), so the singleton check-and-set is atomic in a single JavaScript
    // tick — concurrent callers arriving at subsequent microtasks see `dbInstance`
    // populated and skip the `new Database(...)` + `CREATE TABLE IF NOT EXISTS ...`
    // block entirely. No race window exists within the JS event-loop model.
    // Caveat: Next.js HMR resets module-level `let` variables on hot reload
    // (dev-only, but a real runtime scenario — not just a "future refactor").
    // Mid-process module reset could re-open the singleton check-and-set window.
    // Production is unaffected; dev may see double-init log spam under hot-reload.
    // The underlying `initializeDatabase` singleton is structurally fragile
    // compared to the connection.ts mutex-protected `getDatabase()` used by
    // verifyAuth internally for token-version checks. A future refactor that
    // adds an `await` inside the db.ts body would require a defensive in-flight-
    // promise de-dup pattern (Tier 5 #66's `_dynamicDefaultsInflight` shape).
    const [authResult, db] = await Promise.all([
      verifyAuth(request),
      initializeDatabase(),
    ]);

    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    const user = db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(authResult.userId) as { id: number; email: string; created_at: string } | undefined;

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
