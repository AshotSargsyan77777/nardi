/** «Invite a friend»: the inviter's code is remembered on this device until the friend signs up. */
const KEY = 'bb_ref';

export function saveRef(code: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* storage blocked */ }
}

export function readRef(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    // an invite is good for 30 days
    return v && Date.now() - v.at < 30 * 86400_000 ? String(v.code) : null;
  } catch { return null; }
}

export function clearRef() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export const inviteUrl = (code: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/i/${encodeURIComponent(code)}`;
