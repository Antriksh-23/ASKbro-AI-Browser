/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,js,ts,jsx,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        // High-End Industrial Palette: Graphite, Acid Lime, Warm Silver, Muted Amber
        graphite: {
          950: '#0C0D0E', // Void / deep chassis base
          900: '#121417', // Primary dark graphite chassis
          850: '#181B1F', // Module container / card surface
          800: '#20242A', // Elevated component / input well
          750: '#292E36', // Active element / hover background
          700: '#343B45', // Precision structural border
          650: '#3F4753', // Secondary border / rule
          600: '#505967', // Muted boundary line
          500: '#697484', // Intermediate tone
        },
        // Acid Lime: High-voltage electric precision accent & telemetry highlight
        lime: {
          300: '#F0FF80',
          400: '#E4FF33',
          500: '#D4FF00', // Signature electric acid lime
          600: '#B8E000',
          700: '#94B500',
          800: '#708A00',
          900: '#4D5E00',
          950: '#1C2200',
        },
        // Warm Silver: Machined metal typography, technical readouts, precision surfaces
        silver: {
          50: '#F8F9FA',
          100: '#EFF1F4', // High silver / brightest readout
          200: '#E0E3E8', // Primary body text / crisp labels
          300: '#C2C7D0', // Secondary descriptions
          400: '#9DA5B2', // Parameter keys & metadata
          500: '#737C8A', // Deep muted / inactive icons
          600: '#525A65', // Subtle indicators
          700: '#3D434C',
        },
        // Muted Amber: High-stakes caution, instrument warning, safety rails
        amber: {
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B', // Muted technical amber
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#451A03',
          950: '#2A1002',
        },
        // Semantic chassis aliases for fast, clean styling
        chassis: {
          base: '#0C0D0E',
          surface: '#121417',
          card: '#181B1F',
          input: '#15171B',
          elevated: '#20242A',
          border: '#2A303A',
          'border-strong': '#3B4452',
          'border-subtle': '#1F242C',
        },
        // Accent semantic aliases
        accent: {
          lime: '#D4FF00',
          'lime-dim': 'rgba(212, 255, 0, 0.12)',
          'lime-border': 'rgba(212, 255, 0, 0.35)',
          amber: '#F59E0B',
          'amber-dim': 'rgba(245, 158, 11, 0.12)',
          'amber-border': 'rgba(245, 158, 11, 0.35)',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
        display: ['Inter', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'precision-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.4), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)',
        'precision-md': '0 4px 12px -2px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
        'lime-glow': '0 0 12px -1px rgba(212, 255, 0, 0.45)',
        'amber-glow': '0 0 12px -1px rgba(245, 158, 11, 0.45)',
        'well-inset': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'fade-in': 'fadeIn 0.14s ease-out forwards',
        'slide-up': 'slideUp 0.18s ease-out forwards',
        'pulse-subtle': 'pulseSubtle 2.5s infinite ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(1px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}
