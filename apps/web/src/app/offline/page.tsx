import { LogoMark } from '@/components/Logo';

export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <div className="mx-auto mb-5 w-fit"><LogoMark size={72} /></div>
      <h1 className="font-display text-2xl font-extrabold">Ինտերնետ չկա</h1>
      <p className="mt-2 text-white/60">Միացիր ինտերնետին ու նորից փորձի․ խաղը աշխատում է միայն առցանց։</p>
      <p className="mt-1 text-sm text-white/40">No internet connection — NARDI needs to be online.</p>
    </div>
  );
}
