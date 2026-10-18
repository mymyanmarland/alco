import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the M6 Docker image (server.js + minimal deps).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
