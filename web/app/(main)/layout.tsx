import { ClientProviders } from '@/components/client-providers'
import { WorkspaceProviderWrapper } from '@/components/workspace-provider-wrapper'

// Disable static prerendering to prevent useContext errors with providers
export const dynamic = 'force-dynamic';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientProviders>
      <WorkspaceProviderWrapper>
        <div className="flex flex-col h-screen overflow-hidden">
          <div className="flex-1 overflow-hidden relative">
            {children}
          </div>
        </div>
      </WorkspaceProviderWrapper>
    </ClientProviders>
  )
}
