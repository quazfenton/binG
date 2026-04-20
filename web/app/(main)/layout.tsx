import { ClientProviders } from '@/components/client-providers'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientProviders>{children}</ClientProviders>;
}
