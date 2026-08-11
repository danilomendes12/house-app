import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistrar } from '@/components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finanças',
  description: 'Controle de gastos mensais e acompanhamento de patrimônio.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Finanças',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
  },
  // iOS ignores the manifest: "Adicionar à Tela de Início" reads these instead.
  appleWebApp: {
    capable: true,
    title: 'Finanças',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Required for the `env(safe-area-inset-*)` padding in globals.css to resolve to
  // anything but zero on a notched iPhone.
  viewportFit: 'cover',
  themeColor: '#6b5ad4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
