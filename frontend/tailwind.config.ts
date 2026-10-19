import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff5ed',
          100: '#ffe8d4',
          200: '#fed0a9',
          300: '#fdb173',
          400: '#fa883a',
          500: '#f56311', // Warm vibrant saffron / terracotta orange
          600: '#e64907',
          700: '#bf3309',
          800: '#98290f',
          900: '#7b2410',
          950: '#430f06',
        },
        surface: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(15, 23, 42, 0.06), inset 0 1px 1px 0 rgba(255, 255, 255, 0.85)',
        'glass-hover': '0 16px 48px -4px rgba(15, 23, 42, 0.1), inset 0 1px 1px 0 rgba(255, 255, 255, 0.95)',
        'glass-warm': '0 16px 40px -8px rgba(245, 99, 17, 0.18), inset 0 1px 1px 0 rgba(255, 255, 255, 0.9)',
        'glass-emerald': '0 16px 40px -8px rgba(16, 185, 129, 0.18), inset 0 1px 1px 0 rgba(255, 255, 255, 0.9)',
        'glass-dock': '0 24px 60px -12px rgba(15, 23, 42, 0.16), inset 0 1px 2px 0 rgba(255, 255, 255, 0.95)',
      },
      backdropBlur: {
        xs: '2px',
        '2xl': '40px',
        '3xl': '64px',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 4s ease-in-out infinite',
        'float-slow': 'float 7s ease-in-out infinite',
        'orb-slow': 'orb 15s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        orb: {
          '0%': { transform: 'translate(0px, 0px) scale(1)' },
          '50%': { transform: 'translate(40px, -30px) scale(1.08)' },
          '100%': { transform: 'translate(-20px, 20px) scale(0.95)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
