'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en } from './en';
import { Dict, hy } from './hy';
import { ru } from './ru';

export type Locale = 'hy' | 'ru' | 'en';
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'hy', label: 'Հայերեն' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];
const DICTS: Record<Locale, Dict> = { hy, ru, en };
export type TKey = keyof Dict;

interface Ctx { locale: Locale; setLocale: (l: Locale) => void; t: (k: TKey | string, vars?: Record<string, string | number>) => string }
const I18nCtx = createContext<Ctx>(null!);

export function I18nProvider({ children, initial }: { children: React.ReactNode; initial: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `bb_lang=${l}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const t = useCallback(
    (k: string, vars?: Record<string, string | number>) => {
      let s: string = (DICTS[locale] as any)[k] ?? (hy as any)[k] ?? k;
      if (vars) for (const [name, v] of Object.entries(vars)) s = s.replace(`{${name}}`, String(v));
      return s;
    },
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
