/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          DEFAULT: "#f54e00",
          foreground: "#ffffff",
          muted: "#fff1eb",
          ink: "#26251e",
        },
      },
    },
  },
  plugins: [],
};
