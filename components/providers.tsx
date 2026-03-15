"use client";

import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';
import { ThemeProvider } from './theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={["dark", "light", "ocean", "forest", "sepia", "midnight", "rose", "desert", "lavender", "slate"]}
      enableSystem={false}
      disableTransitionOnChange
    >
      <AuthProvider>
        <TamboContextProvider>
          {children}
        </TamboContextProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
