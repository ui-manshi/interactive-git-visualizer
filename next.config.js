/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  experimental: {
    // Import only the icons/helpers that are used from these packages.
    optimizePackageImports: ["reactflow"],
  },
};

module.exports = nextConfig;
