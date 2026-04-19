import type { Metadata } from 'next'
import type { Viewport } from 'next'
import './globals.css'
import { ClientProviders } from '@/components/client-providers'

// Assume this is where app-level initialization for server components might occur.
// For async initialization like loading core capabilities, consider:
// 1. A server-side component in layout.tsx if supported and appropriate.
// 2. A dedicated server entry point or middleware that runs once on server start.
// 3. Importing and calling loadCoreCapabilities() from an appropriate server-side context.
//
// Example (requires an async context for await):
// import { loadCoreCapabilities } from '@/lib/tools/loader';
// loadCoreCapabilities(); // Note: This needs to be called in an async server context.

export const metadata: Metadata = {
  title: 'binG0 - AI Assistant',
  description: 'AI Assistant',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  )
}
