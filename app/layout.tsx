import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';
import { TamboWrapper } from '@/components/tambo/tambo-wrapper';

export const metadata: Metadata = {
  title: 'app',
  description: 'sikasem',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <TamboContextProvider>
            <TamboWrapper>
              {children}
            </TamboWrapper>
          </TamboContextProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
