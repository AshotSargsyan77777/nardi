/**
 * Bad-word filter for chat and nicknames. Each word also matches when written with spaces/dots
 * between the letters, in upper case, or with look-alike Latin/Cyrillic letters and digits.
 */
const LOOKALIKE: Record<string, string> = {
  a: 'aа@4', o: 'oо0', e: 'eеё3', c: 'cс', p: 'pр', x: 'xх', i: 'i1!|', s: 's$5', y: 'yу', k: 'kк', m: 'mм', t: 'tт', b: 'bвь6', h: 'hн',
  а: 'аa@4', о: 'оo0', е: 'еeё3', ё: 'ёеe', с: 'сc', р: 'рp', х: 'хx', у: 'уy', к: 'кk', м: 'мm', т: 'тt', н: 'нh',
};
const SEP = '[\\s._\\-*~]*';
const esc = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let cacheKey = '';
let cache: RegExp | null = null;

function regexFor(words: string[]) {
  const key = words.join('\n');
  if (key !== cacheKey) {
    const parts = words
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 2)
      .map((w) => [...w].map((ch) => `[${esc(LOOKALIKE[ch] ?? ch)}]+`).join(SEP));
    cache = parts.length ? new RegExp(parts.join('|'), 'giu') : null;
    cacheKey = key;
  }
  return cache;
}

export function censor(text: string, words: string[]) {
  const re = regexFor(words);
  return re ? text.replace(re, (m) => '*'.repeat(Math.min(5, m.length))) : text;
}

export function hasProfanity(text: string, words: string[]) {
  const re = regexFor(words);
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text);
}

/** Starter list; admins extend it in Games → Game settings → chatFilter. */
export const DEFAULT_CHAT_FILTER = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'whore', 'dick',
  'бля', 'хуй', 'хуе', 'хуё', 'пизд', 'сука', 'ебат', 'ебан', 'ёбан', 'мудак', 'пидор', 'шлюх', 'гандон',
  'քունեմ', 'քունած', 'մամադ', 'մերդ', 'qunem', 'kunem', 'qunel', 'kunel', 'mamad', 'mamat',
];
