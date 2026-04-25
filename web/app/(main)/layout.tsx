import { ClientProviders } from '@/components/client-providers'
import { WorkspaceProviderWrapper } from '@/components/workspace-provider-wrapper'

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
