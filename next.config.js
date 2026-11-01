/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  // The Docker build sets STANDALONE=1 to produce a small self-contained server (.next/standalone).
  output: process.env.STANDALONE ? "standalone" : undefined,
  experimental: {
    // Import only the icons/helpers that are used from these packages.
    optimizePackageImports: ["reactflow"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
