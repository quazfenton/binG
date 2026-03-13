"use client";

import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TamboContextProvider>
        {children}
      </TamboContextProvider>
    </AuthProvider>
  );
}
