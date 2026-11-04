'use client';
import { useEffect, useState } from 'react';

/**
 * Board and checker looks, remembered per device. They are free; the fancier ones open up with the
 * player's level. Board images are pre-rendered by scripts/board-texture.mjs (same ids).
 */
export const BOARDS = [
  { id: 'walnut', level: 1, swatch: ['#5b3418', '#d8b07a', '#8e3a22'] },
  { id: 'oak', level: 3, swatch: ['#a77442', '#ead2a6', '#3f5a3a'] },
  { id: 'felt', level: 5, swatch: ['#5a2414', '#1f6a49', '#efe2c2'] },
  { id: 'ebony', level: 8, swatch: ['#26201d', '#3a3330', '#8f1e1e'] },
  { id: 'pomegranate', level: 12, swatch: ['#5e1420', '#e4c79a', '#b5852f'] },
] as const;
export type BoardTheme = (typeof BOARDS)[number]['id'];

export interface CheckerColors { stops: [string, string, string, string]; rim: string; groove: string; ridge: string; text: string; shine: number }
export const CHECKERS: { id: string; level: number; light: CheckerColors; dark: CheckerColors }[] = [
  {
    id: 'classic', level: 1,
    light: { stops: ['#fffdf6', '#efe4cc', '#cdbb93', '#a8936a'], rim: '#8d7a52', groove: 'rgba(90,70,35,.35)', ridge: 'rgba(255,255,255,.75)', text: '#3b2f1a', shine: 0.9 },
    dark: { stops: ['#5a5148', '#2a2420', '#141110', '#070606'], rim: '#000', groove: 'rgba(0,0,0,.65)', ridge: 'rgba(255,255,255,.13)', text: '#f4ead2', shine: 0.5 },
  },
  {
    id: 'wood', level: 2,
    light: { stops: ['#fbe7c2', '#ecc98f', '#c99a5c', '#9a6d3a'], rim: '#7a5226', groove: 'rgba(110,70,25,.4)', ridge: 'rgba(255,240,210,.7)', text: '#4a2e10', shine: 0.75 },
    dark: { stops: ['#9a6238', '#6a3c1c', '#3f210d', '#241205'], rim: '#1a0c03', groove: 'rgba(0,0,0,.5)', ridge: 'rgba(255,210,160,.18)', text: '#f6dfb8', shine: 0.45 },
  },
  {
    id: 'ruby', level: 4,
    light: { stops: ['#fffdf6', '#efe4cc', '#cdbb93', '#a8936a'], rim: '#8d7a52', groove: 'rgba(90,70,35,.35)', ridge: 'rgba(255,255,255,.75)', text: '#3b2f1a', shine: 0.9 },
    dark: { stops: ['#e2585a', '#a8222a', '#6a1016', '#3a070b'], rim: '#2a0306', groove: 'rgba(40,0,5,.55)', ridge: 'rgba(255,200,200,.25)', text: '#fff1e8', shine: 0.6 },
  },
  {
    id: 'marble', level: 7,
    light: { stops: ['#ffffff', '#eef1f4', '#cfd6dd', '#9aa5b0'], rim: '#7c8794', groove: 'rgba(70,80,95,.35)', ridge: 'rgba(255,255,255,.85)', text: '#2a313a', shine: 0.9 },
    dark: { stops: ['#4fb68a', '#1f7a55', '#0f4a33', '#06281b'], rim: '#021a10', groove: 'rgba(0,30,15,.55)', ridge: 'rgba(200,255,225,.22)', text: '#eafff4', shine: 0.6 },
  },
  {
    id: 'gold', level: 10,
    light: { stops: ['#ffffff', '#e8ecf0', '#b9c1ca', '#7d8792'], rim: '#5f6872', groove: 'rgba(60,70,80,.4)', ridge: 'rgba(255,255,255,.9)', text: '#262c33', shine: 1 },
    dark: { stops: ['#fff0b0', '#e3b94e', '#a87a1c', '#5e4108'], rim: '#3e2a03', groove: 'rgba(80,50,0,.5)', ridge: 'rgba(255,250,220,.6)', text: '#3a2604', shine: 0.9 },
  },
];
export type CheckerTheme = string;

export interface Look { board: BoardTheme; checkers: CheckerTheme }
const KEY = 'nardi_look';
const EVENT = 'nardi-look';
const DEFAULT: Look = { board: 'walnut', checkers: 'classic' };

export function readLook(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      board: BOARDS.some((b) => b.id === v.board) ? v.board : DEFAULT.board,
      checkers: CHECKERS.some((c) => c.id === v.checkers) ? v.checkers : DEFAULT.checkers,
    };
  } catch {
    return DEFAULT;
  }
}

export function saveLook(look: Look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The current look; a choice above the player's level falls back to the default. */
export function useLook(level?: number): Look {
  const [look, setLook] = useState<Look>(DEFAULT);
  useEffect(() => {
    const update = () => setLook(readLook());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', update); };
  }, []);
  if (level === undefined) return look;
  return {
    board: (BOARDS.find((b) => b.id === look.board)?.level ?? 1) <= level ? look.board : DEFAULT.board,
    checkers: (CHECKERS.find((c) => c.id === look.checkers)?.level ?? 1) <= level ? look.checkers : DEFAULT.checkers,
  };
}

export const checkerColors = (id: string) => CHECKERS.find((c) => c.id === id) ?? CHECKERS[0];
