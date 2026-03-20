"use client";

import { Providers } from "./providers";

/**
 * ClientProviders - Wrapper component for Providers with SSR disabled
 * 
 * This component must be a Client Component ("use client") to use ssr:false
 * with next/dynamic. It prevents useContext errors during prerendering
 * in React 19/Next.js 16 by ensuring Providers only renders on the client.
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}