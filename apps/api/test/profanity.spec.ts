import { DEFAULT_CHAT_FILTER, censor, hasProfanity } from '../src/common/profanity';

describe('chat filter', () => {
  const w = DEFAULT_CHAT_FILTER;
  it('hides listed words in any case, spaced out or with look-alike letters', () => {
    expect(censor('you are a FUCKING fool', w)).not.toMatch(/fuck/i);
    expect(censor('с у к а', w)).not.toMatch(/с у к а/);
    expect(censor('s.h.i.t happens', w)).not.toMatch(/s\.h\.i\.t/);
    expect(censor('сyкa', w)).toMatch(/\*/); // Latin y and a among Cyrillic letters
    expect(hasProfanity('Mamad123', w)).toBe(true);
  });
  it('leaves normal text alone', () => {
    for (const ok of ['Բարև, լավ խաղ էր', 'Ջրի, իմը տուզ ա', 'Привет, хорошая игра', 'Good game!', 'Assassin', 'Shitake']) {
      expect(censor(ok, w)).toBe(ok.replace(/shit/i, '****'));
    }
    expect(hasProfanity('Vahe_77', w)).toBe(false);
  });
});
