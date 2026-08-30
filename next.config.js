/** @type {import('next').NextConfig} */

// next.config.js
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig = {
  
  reactStrictMode: true,
  output: "standalone",
  generateBuildId: async () => {
    // This could be anything, using the latest git hash
    return new Date().toLocaleDateString();
  },
  images: {
    // Keep optimised variants for at least as long as the cover route's own
    // max-age. At 0 the optimiser re-resized the full-size originals far more
    // often than necessary, which is expensive on small hardware.
    minimumCacheTTL: 300,
    remotePatterns: [
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
 
};



module.exports = withBundleAnalyzer(nextConfig);
