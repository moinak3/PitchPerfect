/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#080808',
          surface: '#101010',
          panel: '#181818',
          border: '#252525',
          amber: '#F59E0B',
          gold: '#FBBF24',
          muted: '#6B7280',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'score-pop': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '60%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.2s ease-out infinite',
        'fade-up': 'fade-up 0.4s ease forwards',
        'score-pop': 'score-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards',
      },
    },
  },
  plugins: [],
}
