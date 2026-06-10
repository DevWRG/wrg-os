/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // WRG Brand Colors (dari design system)
        "wrg-cyan": "#15C8DC",
        "wrg-coral": "#E84830",
        "wrg-navy": "#0D1B2A",
        "wrg-navy-light": "#1A2D42",
        "wrg-gray": "#8B9BB4",
        "wrg-gray-light": "#E8ECF2"
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  },
  plugins: []
}
