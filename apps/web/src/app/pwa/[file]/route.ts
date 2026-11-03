import { PWA_ICONS } from '@/lib/pwa-icons';

export const dynamic = 'force-static';
export function generateStaticParams() {
  return Object.keys(PWA_ICONS).map((file) => ({ file }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const data = PWA_ICONS[file];
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(data, 'base64'), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800, immutable' },
  });
}
