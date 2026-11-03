import type { MetadataRoute } from 'next';

/** Web app manifest: lets phones install NARDI as a full-screen app with its own icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'NARDI',
    short_name: 'NARDI',
    description: 'Կարճ ու երկար նարդի առցանց՝ ընկերների կամ պատահական խաղացողների հետ',
    lang: 'hy',
    start_url: '/?source=app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#05080f',
    theme_color: '#05080f',
    categories: ['games', 'entertainment'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
