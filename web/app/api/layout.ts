import React from 'react';

/**
 * `/api/**` segment configuration.
 *
 * Next.js App Router strictly type-checks ANY file named `layout.{ts,tsx}` against
 * `LayoutConfig<Route>`, which REQUIRES a `default` React component export.
 * Without a `default` export, the generated types in
 * `bing/web/.next/dev/types/validator.ts` (L1066) fail with TS2344.
 *
 * This `force-dynamic` line cascades down to every `route.ts` under `/api/**`,
 * preventing accidentally-static build-time caching of API endpoints \u2014 critical
 * for routes that depend on request-time state (cookies, headers, body params,
 * session, etc.).
 *
 * The default export is a pass-through `children` wrapper. It is INERT at runtime:
 * Next.js App Router API endpoints (`route.ts` files) do NOT participate in the
 * React rendering tree and will never attempt to render or execute this layout.
 * The export exists purely to satisfy TS structural typing.
 */
export const dynamic = 'force-dynamic';

// Pass-through children wrapper. Inert at runtime; exists only to satisfy
// Next.js `LayoutConfig<"/api">` structural typing. See the docblock above
// for the rationale.
export default function ApiLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return children;
}
