import type { Metadata, Viewport } from 'next';
import { PRODUCT } from '@gymflow/config';
import { currentLanguage } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.description,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: PRODUCT.name, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#15803d',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the same way every server component does — explicit cookie first,
  // then the staff member's own profile language. Reading only the cookie
  // meant a Telugu-speaking receptionist who had never touched the toggle got
  // lang="en", which is what a screen reader goes by.
  //
  // It is also how client components learn the language: they cannot await
  // the server-side resolver, so they read document.documentElement.lang.
  // See lib/i18n-client.ts.
  const lang = await currentLanguage();
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
