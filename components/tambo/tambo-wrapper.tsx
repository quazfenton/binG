"use client";

import { ReactNode, useState, useEffect } from 'react';
import { TamboProvider } from '@tambo-ai/react';
import { useTamboContext } from '@/contexts/tambo-context';
import { tamboComponents } from './tambo-components';
import { tamboTools } from './tambo-tools';

interface TamboWrapperProps {
  children: ReactNode;
}

export function TamboWrapper({ children }: TamboWrapperProps) {
  const { enabled, apiKey } = useTamboContext();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // If Tambo is not enabled or no API key, render children without Tambo
  if (!enabled || !apiKey || !isClient) {
    return <>{children}</>;
  }

  // Wrap with TamboProvider when enabled
  return (
    <TamboProvider
      components={tamboComponents}
      tools={tamboTools}
      apiKey={apiKey}
    >
      {children}
    </TamboProvider>
  );
}
