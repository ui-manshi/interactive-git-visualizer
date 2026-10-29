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
      // One type scale. Monospace carries data (hashes, dates, counts); sans carries language.
      fontSize: {
        caption: ["11px", { lineHeight: "16px" }],
        body: ["13px", { lineHeight: "20px" }],
        title: ["15px", { lineHeight: "22px" }],
        display: ["28px", { lineHeight: "34px", letterSpacing: "-0.02em" }],
      },
      transitionDuration: { DEFAULT: "150ms" },
    },
  },
  plugins: [],
};

export default config;
