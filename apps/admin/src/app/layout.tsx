import type { Metadata, Viewport } from 'next';
import { PRODUCT } from '@gymflow/config';
import './globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.description,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: PRODUCT.name, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#16a34a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
