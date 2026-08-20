import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Kao TDAHZEI' };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
