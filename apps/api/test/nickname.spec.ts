import { nickScriptOk, nickSkeleton } from '../src/common/nickname';

describe('nickname look-alikes', () => {
  it('folds look-alike letters, case, digits and separators', () => {
    expect(nickSkeleton('Aram')).toBe(nickSkeleton('Аrаm')); // Cyrillic А and а
    expect(nickSkeleton('Vahe_77')).toBe(nickSkeleton('vahe.77'));
    expect(nickSkeleton('Gor0')).toBe(nickSkeleton('Goro'));
    expect(nickSkeleton('Mike')).not.toBe(nickSkeleton('Mika'));
  });
  it('allows one alphabet per nickname', () => {
    expect(nickScriptOk('Արամ_77')).toBe(true);
    expect(nickScriptOk('Aram')).toBe(true);
    expect(nickScriptOk('Арам')).toBe(true);
    expect(nickScriptOk('Аram')).toBe(false); // Cyrillic А + Latin
    expect(nickScriptOk('Արամ_Aram')).toBe(false);
  });
});
