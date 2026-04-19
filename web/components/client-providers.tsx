"use client";

import dynamic from "next/dynamic";

const Providers = dynamic(
  () => import("./providers").then((mod) => mod.Providers),
  { ssr: false }
);

/**
 * ClientProviders - Wrapper component for Providers with SSR disabled
 * 
 * Uses next/dynamic with ssr:false to prevent useContext errors during
 * prerendering in React 19/Next.js 16 by ensuring Providers only
 * renders on the client.
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
