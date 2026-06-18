/**
 * SEV-4 Regression Tests — middleware validateRequest null-body guard
 *
 * Locks down the SEV-4 fix that turns the recurring
 * `Expected object, received null` ZodError noise into a deterministic
 * typed-400 response with the `invalid_body_null` discriminator.
 *
 * Invariants:
 *   - When `req.json()` resolves to `null` (missing body, JSON `null`,
 *     or malformed JSON), the wrapper returns status 400, body shape
 *     `{ error: 'invalid_body', details: [{ field: 'root', code: 'invalid_body_null', ... }] }`.
 *   - When `req.json()` resolves to a valid object that fails schema
 *     validation, the wrapper returns status 400 with body shape
 *     `{ error: 'Validation failed', details: [{ field, message, code }, ...] }`.
 *   - When `req.json()` resolves to a valid object that passes schema
 *     validation, the inner handler is invoked with `validatedBody`.
 *
 * Without these guards, schema.parse(null) cascades into a noisy
 * ZodError warn logged at `Middleware:Validation` and the inner handler
 * never runs.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { NextResponse } from 'next/server';

import { validateRequest } from '../validate';

// Minimal NextRequest stub — only `req.json()` is exercised by validateRequest.
function mockRequest(jsonResult: unknown): any {
  return {
    json: async () => jsonResult,
    nextUrl: { searchParams: { entries: () => [] as [string, string][] } },
  };
}

async function callWrapper(
  schema: z.ZodTypeAny,
  jsonResult: unknown,
  handler: any = vi.fn(async () => NextResponse.json({ ok: true })),
) {
  const wrapped = validateRequest(schema)(handler);
  return wrapped(mockRequest(jsonResult));
}

describe('validateRequest — SEV-4 null-body guard', () => {
  describe('null-body path (req.json() resolves to null)', () => {
    it('returns status 400 with error=invalid_body and discriminator code', async () => {
      const res = await callWrapper(z.object({ email: z.string() }), null);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_body');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details[0].field).toBe('root');
      expect(body.details[0].code).toBe('invalid_body_null');
      expect(typeof body.details[0].message).toBe('string');
    });

    it('does NOT invoke the inner handler on null body', async () => {
      const handler = vi.fn(async () => NextResponse.json({ ok: true }));
      await callWrapper(z.object({ email: z.string() }), null, handler);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('invalid-body path (non-null but fails zod)', () => {
    it('returns status 400 with error="Validation failed" and per-field details', async () => {
      const res = await callWrapper(
        z.object({ email: z.string().email() }),
        { email: 'not-an-email' },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
      // The failed field is `email` (top-level key)
      expect(body.details[0].field).toBe('email');
      expect(body.details[0].code).toBe('invalid_string');
    });

    it('does NOT invoke the inner handler when validation fails', async () => {
      const handler = vi.fn(async () => NextResponse.json({ ok: true }));
      await callWrapper(z.object({ email: z.string().email() }), {}, handler);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('valid-body path (passes schema.parse)', () => {
    it('invokes the inner handler with typed validatedBody', async () => {
      const handler = vi.fn(async (_req: any, ctx: any) =>
        NextResponse.json({ ok: true, echoed: ctx.validatedBody }),
      );
      const schema = z.object({
        email: z.string().email(),
        name: z.string(),
      });
      const res = await callWrapper(
        schema,
        { email: 'a@b.com', name: 'Ada' },
        handler,
      );
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      // The 2nd arg is the context with validatedBody
      const ctxArg = handler.mock.calls[0][1];
      expect(ctxArg.validatedBody).toEqual({ email: 'a@b.com', name: 'Ada' });
    });
  });

  describe('require-failure type (object missing required field)', () => {
    it('returns 400 even when input is object but missing required keys', async () => {
      const res = await callWrapper(z.object({ id: z.string() }), {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details[0].field).toBe('id');
    });
  });
});
