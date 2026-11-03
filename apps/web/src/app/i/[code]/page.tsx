import type { Metadata } from 'next';
import { InviteLanding } from './InviteLanding';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const code = decodeURIComponent((await params).code).slice(0, 20);
  const title = `${code}-ը քեզ հրավիրում ա NARDI խաղալու`;
  const description = 'Կարճ ու երկար նարդի առցանց։ Գրանցվիր հղումով ու ստացիր բոնուս մետաղադրամներ։';
  return {
    title,
    description,
    robots: { index: false },
    openGraph: { title, description, images: [{ url: '/brand/og.jpg', width: 1200, height: 630 }] },
  };
}

export default async function InvitePage({ params }: Props) {
  return <InviteLanding code={decodeURIComponent((await params).code).slice(0, 20)} />;
}
