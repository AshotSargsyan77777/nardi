import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // phones held horizontally (landscape): very little vertical space
        short: { raw: '(max-height: 520px) and (orientation: landscape)' },
        // any phone (portrait or landscape) — gets the game-style mobile UI
        phone: { raw: '(max-width: 767px), (max-height: 520px) and (orientation: landscape)' },
      },
      colors: {
        ink: { 950: '#05080f', 900: '#0a1020', 850: '#0d1528', 800: '#111a30', 700: '#18233d', 600: '#22304f' },
        graphite: { 900: '#14171d', 800: '#1b1f27', 700: '#262b35', 600: '#343a46' },
        felt: { 900: '#063524', 800: '#0a4a33', 700: '#0d5e41', 600: '#117a54', 500: '#16996a' },
        gold: { 200: '#fbe7b2', 300: '#f6d47f', 400: '#eabd55', 500: '#d4a23a', 600: '#a97c22' },
        ruby: { 400: '#f0647a', 500: '#e0435c', 600: '#b92d45' },
      },
      fontFamily: {
        sans: ['Manrope', '"Noto Sans Armenian"', 'system-ui', 'sans-serif'],
        display: ['Manrope', '"Noto Sans Armenian"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px -10px rgba(0,0,0,0.55)',
        glow: '0 0 0 1px rgba(234,189,85,0.35), 0 8px 30px -8px rgba(234,189,85,0.35)',
        card: '0 6px 16px -4px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.35)',
      },
      backgroundImage: {
        'gold-grad': 'linear-gradient(135deg, #fbe7b2 0%, #eabd55 45%, #a97c22 100%)',
        'felt-grad': 'radial-gradient(ellipse at center, #16996a 0%, #0d5e41 45%, #063524 100%)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseRing: { '0%': { transform: 'scale(0.9)', opacity: '0.8' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
      },
      animation: { shimmer: 'shimmer 3s linear infinite', 'pulse-ring': 'pulseRing 1.6s ease-out infinite' },
    },
  },
  plugins: [],
} satisfies Config;
