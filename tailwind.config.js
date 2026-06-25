/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#185FA5',
        ink: { DEFAULT: '#1a1a1a', strong: '#0d0d0d', soft: '#6b6b68', faded: '#9a9a96' },
        paper: { DEFAULT: '#ffffff', soft: '#fafaf9', tinted: '#f3f3f1', strong: '#ece9e3' },
        line: { DEFAULT: '#e6e5e0', strong: '#d4d3cd', soft: '#f0efec' },
        cat: {
          hotel: '#185FA5',
          rooftop: '#BA7517',
          aerial: '#534AB7',
          culture: '#1D9E75',
          restaurant: '#993556',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
