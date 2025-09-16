"use client"

import React, { createContext, useContext, ReactNode } from 'react'
import { useResponsiveLayout, ResponsiveState, ResponsiveConfig } from '@/hooks/use-responsive-layout'

interface ResponsiveLayoutContextType extends ResponsiveState {
  updateConfig: (newConfig: Partial<ResponsiveConfig>) => void
}

const ResponsiveLayoutContext = createContext<ResponsiveLayoutContextType | undefined>(undefined)

interface ResponsiveLayoutProviderProps {
  children: ReactNode
  config?: ResponsiveConfig
}

export function ResponsiveLayoutProvider({ children, config }: ResponsiveLayoutProviderProps) {
  const layout = useResponsiveLayout(config)
  
  const updateConfig = (newConfig: Partial<ResponsiveConfig>) => {
    // This would be implemented if we need dynamic config updates
    console.log('Config update requested:', newConfig)
  }

  const contextValue: ResponsiveLayoutContextType = {
    ...layout,
    updateConfig
  }

  return (
    <ResponsiveLayoutContext.Provider value={contextValue}>
      {children}
    </ResponsiveLayoutContext.Provider>
  )
}

export function useResponsiveLayoutContext(): ResponsiveLayoutContextType {
  const context = useContext(ResponsiveLayoutContext)
  if (context === undefined) {
    throw new Error('useResponsiveLayoutContext must be used within a ResponsiveLayoutProvider')
  }
  return context
}

// Utility hook for common responsive patterns
export function useResponsiveBreakpoints() {
  const { currentBreakpoint, isMobile, isTablet, isDesktop } = useResponsiveLayoutContext()
  
  return {
    currentBreakpoint,
    isMobile,
    isTablet,
    isDesktop,
    isXs: currentBreakpoint === 'xs',
    isSm: currentBreakpoint === 'sm',
    isMd: currentBreakpoint === 'md',
    isLg: currentBreakpoint === 'lg',
    isXl: currentBreakpoint === 'xl',
    is2Xl: currentBreakpoint === '2xl',
    // Utility functions for common responsive patterns
    showOnMobile: isMobile,
    showOnTablet: isTablet,
    showOnDesktop: isDesktop,
    hideOnMobile: !isMobile,
    hideOnTablet: !isTablet,
    hideOnDesktop: !isDesktop
  }
}