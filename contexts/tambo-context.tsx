"use client";

import React, { createContext, useContext, ReactNode } from 'react';

interface TamboContextValue {
  enabled: boolean;
  apiKey: string | null;
}

const TamboContext = createContext<TamboContextValue>({
  enabled: false,
  apiKey: null,
});

export function TamboContextProvider({ children }: { children: ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_TAMBO_ENABLED === 'true';
  const apiKey = process.env.NEXT_PUBLIC_TAMBO_API_KEY || null;

  return (
    <TamboContext.Provider value={{ enabled, apiKey }}>
      {children}
    </TamboContext.Provider>
  );
}

export function useTamboContext() {
  return useContext(TamboContext);
}
