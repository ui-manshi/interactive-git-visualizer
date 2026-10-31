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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
