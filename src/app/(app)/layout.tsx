import { FinoraProvider } from '@/components/layout/FinoraProvider';

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FinoraProvider>{children}</FinoraProvider>;
}
