import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { THEME_COLOR, THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Finah', template: '%s · Finah' },
  description: 'Controle financeiro do casal',
  applicationName: 'Finah',
  appleWebApp: { capable: true, title: 'Finah', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // o padrão é escuro; o script do tema e o ThemeControls ajustam a cor quando o tema muda
  themeColor: THEME_COLOR.dark,
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* antes da primeira pintura: aplica o tema escolhido neste aparelho (evita piscar) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
