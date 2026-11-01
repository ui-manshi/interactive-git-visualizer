// Self-hosted fonts (latin subset, font-display: swap). The old Google Fonts <link> was a
// render-blocking request to another origin; these are same-origin, cached and only what is used.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Git Visualizer",
  description: "Interactive Git version control visualizer",
};

// Without this, phones render the page at ~980px wide and shrink it, so none of the responsive
// breakpoints apply. viewport-fit=cover lets the safe-area insets (notches, home bar) be used.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101317",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
