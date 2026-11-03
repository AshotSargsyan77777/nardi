import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { ServiceWorker } from '@/components/InstallApp';
import { Footer, Header, MobileNav } from '@/components/Shell';
import { SoundProvider } from '@/components/Sound';
import { LookProvider } from '@/components/LookChoices';
import { FriendInviteToast } from '@/components/FriendInvites';
import { AppProviders } from '@/lib/app-state';
import { I18nProvider, Locale } from '@/lib/i18n';
import './globals.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const DESC = 'NARDI — կարճ ու երկար նարդի առցանց։ Խաղա ընկերներիդ կամ նոր խաղացողների հետ, անվճար, հեռախոսից ու համակարգչից։';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'NARDI — նարդի առցանց', template: '%s · NARDI' },
  description: DESC,
  keywords: ['նարդի', 'նարդի առցանց', 'երկար նարդի', 'կարճ նարդի', 'nardi', 'nardi online', 'backgammon', 'long nardi', 'нарды', 'нарды онлайн', 'длинные нарды', 'короткие нарды'],
  applicationName: 'NARDI',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website', siteName: 'NARDI', url: '/', locale: 'hy_AM',
    title: 'NARDI — նարդի առցանց', description: DESC,
    images: [{ url: '/brand/og.jpg', width: 1200, height: 630, alt: 'NARDI — short and long nardi online' }],
  },
  twitter: { card: 'summary_large_image', title: 'NARDI — նարդի առցանց', description: DESC, images: ['/brand/og.jpg'] },
  appleWebApp: { capable: true, title: 'NARDI', statusBarStyle: 'black-translucent' },
  icons: { apple: '/pwa/apple-touch-icon.png' },
};
export const viewport: Viewport = { themeColor: '#05080f', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (await cookies()).get('bb_lang')?.value;
  const locale: Locale = lang === 'ru' || lang === 'en' ? lang : 'hy';
  return (
    <html lang={locale}>
      <body className="font-sans antialiased">
        <I18nProvider initial={locale}>
          <AppProviders>
            <Header />
            <main className="mx-auto w-full max-w-7xl px-4 pt-5 phone:px-[max(12px,env(safe-area-inset-left))] phone:pb-[max(16px,env(safe-area-inset-bottom))] phone:pt-2">{children}</main>
            <Footer />
            <MobileNav />
            <ServiceWorker />
            <SoundProvider />
            <LookProvider />
            <FriendInviteToast />
          </AppProviders>
        </I18nProvider>
      </body>
    </html>
  );
}
