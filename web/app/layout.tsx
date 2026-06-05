import type { Metadata } from 'next'
import type { Viewport } from 'next'
import './globals.css'
import { ServiceWorkerManager } from '@/components/service-worker-manager'

export const metadata: Metadata = {
  title: 'binG0 - AI Assistant',
  description: 'AI Assistant',
  manifest: '/manifest.json',
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
        <ServiceWorkerManager />
        {children}
      </body>
    </html>
  )
}
