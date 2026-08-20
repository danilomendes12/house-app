import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistrar } from '@/components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: 'App da casa',
  description: 'Gastos, patrimônio, tarefas da casa e listas de compras da família em um só lugar.',
  // Prefixed by hand, and it has to be: basePath ('/financial', next.config.ts) rewrites what
  // Next emits — /_next/*, next/link, redirect() — and leaves strings like these alone. Checked
  // in the rendered HTML, not assumed. The full list of hand-written URLs is docs/DEPLOY.md §1.3.
  manifest: '/financial/manifest.webmanifest',
  applicationName: 'App da casa',
  icons: {
    icon: [
      { url: '/financial/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/financial/icon.svg', type: 'image/svg+xml' },
    ],
    apple: { url: '/financial/icons/apple-touch-icon.png', sizes: '180x180' },
  },
  // iOS ignores the manifest: "Adicionar à Tela de Início" reads these instead.
  appleWebApp: {
    capable: true,
    title: 'App da casa',
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
