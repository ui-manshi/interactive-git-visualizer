import type { Config } from "tailwindcss";

// Colours are CSS variables (see app/globals.css) so opacity modifiers like
// `bg-add/10` work everywhere.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ground: token("ground"),
        surface: token("surface"),
        raised: token("raised"),
        line: token("line"),
        fg: token("fg"),
        muted: token("muted"),
        faint: token("faint"),
        accent: token("accent"),
        add: token("add"),
        del: token("del"),
        warn: token("warn"),
        violet: token("violet"),
        blue: token("blue"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // One type scale for every screen: 11 meta / 12 secondary / 13 body / 15 heading / 20 figure.
      // (3xl and 4xl remain only for the landing-page title.)
      fontSize: {
        "2xs": ["11px", "16px"],
        xs: ["12px", "16px"],
        sm: ["13px", "20px"],
        lg: ["15px", "22px"],
        xl: ["20px", "28px"],
      },
      transitionDuration: { DEFAULT: "150ms" },
    },
  },
  plugins: [],
};

export default config;
