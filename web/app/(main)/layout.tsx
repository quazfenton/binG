import { ClientProviders } from '@/components/client-providers'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientProviders>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Invisible drag handle at the very top */}
        <div data-tauri-drag-region className="h-6 w-full flex-shrink-0 absolute top-0 left-0 z-[10000] pointer-events-auto" />
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </div>
    </ClientProviders>
  );
}
