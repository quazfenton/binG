"use client";

import { ReactNode } from 'react';
import { TamboProvider } from '@tambo-ai/react';
import { useTamboContext } from '@/contexts/tambo-context';
import { tamboComponents } from './tambo-components';
import { tamboTools } from './tambo-tools';

interface TamboWrapperProps {
  children: ReactNode;
}

export function TamboWrapper({ children }: TamboWrapperProps) {
  const { enabled, apiKey } = useTamboContext();

  // If Tambo is not enabled or no API key, render children without Tambo
  if (!enabled || !apiKey) {
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
