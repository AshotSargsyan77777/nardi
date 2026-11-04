export const fmtNum = (n: number | null | undefined, locale = 'hy') => (n ?? 0).toLocaleString(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US');
export const fmtMoney = (minor: number, currency: string, locale = 'hy') =>
  new Intl.NumberFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
export const fmtDate = (d: string | Date | null | undefined, locale = 'hy', withTime = true) =>
  d ? new Date(d).toLocaleString(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—';
export const fmtDuration = (sec: number | null | undefined) => {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
export const isRed = (suit: string) => suit === 'H' || suit === 'D';
