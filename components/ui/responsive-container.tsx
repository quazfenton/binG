"use client"

import React, { ReactNode, CSSProperties } from 'react'
import { useResponsiveLayout } from '@/hooks/use-responsive-layout'

interface ResponsiveContainerProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  // Responsive padding
  padding?: {
    xs?: string
    sm?: string
    md?: string
    lg?: string
    xl?: string
    '2xl'?: string
  }
  // Responsive margins
  margin?: {
    xs?: string
    sm?: string
    md?: string
    lg?: string
    xl?: string
    '2xl'?: string
  }
  // Responsive max width
  maxWidth?: {
    xs?: string
    sm?: string
    md?: string
    lg?: string
    xl?: string
    '2xl'?: string
  }
  // Safe area handling for mobile
  useSafeArea?: boolean
  // Touch-friendly spacing
  touchFriendly?: boolean
}

export function ResponsiveContainer({
  children,
  className = '',
  style = {},
  padding,
  margin,
  maxWidth,
  useSafeArea = false,
  touchFriendly = false,
  ...props
}: ResponsiveContainerProps) {
  const layout = useResponsiveLayout()
  
  // Get responsive values based on current breakpoint
  const getResponsiveValue = (values: Record<string, string> | undefined, fallback: string = '') => {
    if (!values) return fallback
    
    // Check from largest to smallest breakpoint
    if (layout.currentBreakpoint === '2xl' && values['2xl']) return values['2xl']
    if (layout.currentBreakpoint === 'xl' && values.xl) return values.xl
    if (layout.currentBreakpoint === 'lg' && values.lg) return values.lg
    if (layout.currentBreakpoint === 'md' && values.md) return values.md
    if (layout.currentBreakpoint === 'sm' && values.sm) return values.sm
    if (layout.currentBreakpoint === 'xs' && values.xs) return values.xs
    
    // Fallback to largest available value
    return values['2xl'] || values.xl || values.lg || values.md || values.sm || values.xs || fallback
  }
  
  const responsiveStyle: CSSProperties = {
    ...style,
    padding: getResponsiveValue(padding),
    margin: getResponsiveValue(margin),
    maxWidth: getResponsiveValue(maxWidth),
    // Safe area handling
    ...(useSafeArea && layout.isMobile && {
      paddingTop: `max(${getResponsiveValue(padding)?.split(' ')[0] || '0px'}, env(safe-area-inset-top))`,
      paddingRight: `max(${getResponsiveValue(padding)?.split(' ')[1] || '0px'}, env(safe-area-inset-right))`,
      paddingBottom: `max(${getResponsiveValue(padding)?.split(' ')[2] || '0px'}, env(safe-area-inset-bottom))`,
      paddingLeft: `max(${getResponsiveValue(padding)?.split(' ')[3] || '0px'}, env(safe-area-inset-left))`
    }),
    // Touch-friendly spacing
    ...(touchFriendly && layout.isMobile && {
      minHeight: layout.messageBubbleConfig.touchTargetSize
    })
  }
  
  const responsiveClassName = [
    className,
    // Add responsive classes based on breakpoint
    layout.isMobile ? 'mobile-layout' : '',
    layout.isTablet ? 'tablet-layout' : '',
    layout.isDesktop ? 'desktop-layout' : '',
    layout.isPortrait ? 'portrait-layout' : 'landscape-layout',
    touchFriendly && layout.isMobile ? 'touch-friendly' : ''
  ].filter(Boolean).join(' ')
  
  return (
    <div 
      className={responsiveClassName}
      style={responsiveStyle}
      {...props}
    >
      {children}
    </div>
  )
}

// Utility component for responsive visibility
interface ResponsiveVisibilityProps {
  children: ReactNode
  showOn?: ('xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'mobile' | 'tablet' | 'desktop')[]
  hideOn?: ('xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'mobile' | 'tablet' | 'desktop')[]
}

export function ResponsiveVisibility({ children, showOn, hideOn }: ResponsiveVisibilityProps) {
  const layout = useResponsiveLayout()
  
  // Determine if component should be visible
  let isVisible = true
  
  if (showOn) {
    isVisible = showOn.some(breakpoint => {
      switch (breakpoint) {
        case 'mobile': return layout.isMobile
        case 'tablet': return layout.isTablet
        case 'desktop': return layout.isDesktop
        default: return layout.currentBreakpoint === breakpoint
      }
    })
  }
  
  if (hideOn && isVisible) {
    isVisible = !hideOn.some(breakpoint => {
      switch (breakpoint) {
        case 'mobile': return layout.isMobile
        case 'tablet': return layout.isTablet
        case 'desktop': return layout.isDesktop
        default: return layout.currentBreakpoint === breakpoint
      }
    })
  }
  
  if (!isVisible) return null
  
  return <>{children}</>
}

// Responsive grid component
interface ResponsiveGridProps {
  children: ReactNode
  className?: string
  columns?: {
    xs?: number
    sm?: number
    md?: number
    lg?: number
    xl?: number
    '2xl'?: number
  }
  gap?: {
    xs?: string
    sm?: string
    md?: string
    lg?: string
    xl?: string
    '2xl'?: string
  }
}

export function ResponsiveGrid({ 
  children, 
  className = '', 
  columns = { xs: 1, sm: 1, md: 2, lg: 2, xl: 3, '2xl': 4 },
  gap = { xs: '8px', sm: '12px', md: '16px', lg: '20px', xl: '24px', '2xl': '28px' }
}: ResponsiveGridProps) {
  const layout = useResponsiveLayout()
  
  const getResponsiveValue = (values: Record<string, any>, fallback: any) => {
    if (layout.currentBreakpoint === '2xl' && values['2xl'] !== undefined) return values['2xl']
    if (layout.currentBreakpoint === 'xl' && values.xl !== undefined) return values.xl
    if (layout.currentBreakpoint === 'lg' && values.lg !== undefined) return values.lg
    if (layout.currentBreakpoint === 'md' && values.md !== undefined) return values.md
    if (layout.currentBreakpoint === 'sm' && values.sm !== undefined) return values.sm
    if (layout.currentBreakpoint === 'xs' && values.xs !== undefined) return values.xs
    return fallback
  }
  
  const currentColumns = getResponsiveValue(columns, 1)
  const currentGap = getResponsiveValue(gap, '16px')
  
  return (
    <div 
      className={`grid ${className}`}
      style={{
        gridTemplateColumns: `repeat(${currentColumns}, 1fr)`,
        gap: currentGap
      }}
    >
      {children}
    </div>
  )
}