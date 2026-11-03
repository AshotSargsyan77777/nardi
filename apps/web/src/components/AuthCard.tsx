import { LogoMark } from './Logo';

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-ink-800 to-ink-900 p-6 shadow-soft sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoMark size={56} />
          <h1 className="font-display text-2xl font-extrabold">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
