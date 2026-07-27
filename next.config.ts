import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/meals/inspirations": [
      "./scripts/weekly-inspirations.mjs",
      "./node_modules/@vercel/blob/**/*",
      "./node_modules/async-retry/**/*",
      "./node_modules/retry/**/*",
      "./node_modules/is-buffer/**/*",
      "./node_modules/is-node-process/**/*",
      "./node_modules/throttleit/**/*",
      "./node_modules/undici/**/*",
    ],
  },
  images: {
    // Local-only escape hatch for visual verification. This is a build-time
    // flag: Next.js bakes the images config into the build, so it must be set
    // for `next build` (and kept for the matching `next start`). Needed
    // because local serving runs the auth middleware for /recipes/* public
    // assets, so the optimizer's cookieless fetch 302s to /login and images
    // break. Vercel serves public assets before middleware, so production
    // never sets this.
    unoptimized: process.env.NABU_UNOPTIMIZED_IMAGES === "1",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
