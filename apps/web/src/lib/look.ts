'use client';
/** Free look choices (no coins): table cloth and card back colour, remembered per device. */
export const TABLE_COLORS = ['green', 'blue', 'red', 'black'] as const;
export const BACK_COLORS = ['green', 'red', 'blue', 'black'] as const;
export type TableColor = (typeof TABLE_COLORS)[number];
export type BackColor = (typeof BACK_COLORS)[number];
const KEY = 'bb_look';

export function readLook(): { table: TableColor; back: BackColor } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { table: TABLE_COLORS.includes(v.table) ? v.table : 'green', back: BACK_COLORS.includes(v.back) ? v.back : 'green' };
  } catch {
    return { table: 'green', back: 'green' };
  }
}

export function applyLook(look: { table: TableColor; back: BackColor }) {
  document.documentElement.dataset.table = look.table;
  document.documentElement.dataset.back = look.back;
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* ignore */
  }
}
