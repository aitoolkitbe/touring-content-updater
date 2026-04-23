import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        touring: {
          blue: "#003d7a",
          accent: "#ffcc00",
          ink: "#1a1a1a",
          muted: "#6b7280",
          surface: "#f8fafc",
          border: "#e5e7eb",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
