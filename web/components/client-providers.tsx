"use client";

import dynamic from "next/dynamic";
import { ThemeProvider } from "./theme-provider";

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
 *
 * NOTE: ThemeProvider (next-themes) is rendered OUTSIDE the ssr:false
 * dynamic boundary so its inline theme-init <script> is emitted during
 * server rendering. React 19 warns ("Encountered a script tag while
 * rendering React component") when <script> tags are produced on the
 * client, because client-rendered scripts never execute.
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={["dark", "light", "ocean", "forest", "sepia", "midnight", "rose", "desert", "lavender", "slate"]}
      enableSystem={false}
      disableTransitionOnChange
    >
      <Providers>{children}</Providers>
    </ThemeProvider>
  );
}
