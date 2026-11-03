/**
 * Look-alike nicknames: «Aram» written with a Cyrillic «А», or «0» for «o», must not pass as a
 * different name. The skeleton is what a nickname looks like, used to check uniqueness.
 */
const BEFORE_LOWER: Record<string, string> = { I: 'l', '1': 'l', '0': 'o' };
const LOOKALIKE: Record<string, string> = {
  // Cyrillic
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l',
  // Greek
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  // Armenian letters that look like Latin ones
  օ: 'o', ս: 'u', հ: 'h', ո: 'n', զ: 'q', ց: 'g',
  // separators look alike too
  '-': '_', '.': '_',
};

export function nickSkeleton(nickname: string) {
  return [...nickname.trim()]
    .map((ch) => BEFORE_LOWER[ch] ?? ch)
    .join('')
    .toLowerCase()
    .split('')
    .map((ch) => LOOKALIKE[ch] ?? ch)
    .join('');
}

/** All letters of a nickname come from one alphabet: Armenian, Latin or Cyrillic. */
export function nickScriptOk(nickname: string) {
  const letters = [...nickname].filter((c) => /\p{L}/u.test(c));
  const scripts = new Set(
    letters.map((c) => (/\p{Script=Armenian}/u.test(c) ? 'hy' : /\p{Script=Latin}/u.test(c) ? 'la' : /\p{Script=Cyrillic}/u.test(c) ? 'cy' : 'other')),
  );
  return !scripts.has('other') && scripts.size <= 1;
}
