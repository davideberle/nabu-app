import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/meals/inspirations": [
      "./scripts/weekly-inspirations.mjs",
      "./node_modules/@vercel/blob/**/*",
      "./node_modules/async-retry/**/*",
      "./node_modules/is-buffer/**/*",
      "./node_modules/is-node-process/**/*",
      "./node_modules/throttleit/**/*",
      "./node_modules/undici/**/*",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
