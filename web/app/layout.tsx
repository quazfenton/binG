import type { Metadata } from 'next'
import type { Viewport } from 'next'
import './globals.css'

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
        {children}
      </body>
    </html>
  )
}
