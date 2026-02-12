import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  async headers() {
    // The app is deployed behind Cloudflare and Railway Edge. Without explicit headers,
    // Next can mark the HTML as highly cacheable, which causes users to see stale UI
    // after deploys. Keep HTML no-store, but allow immutable caching for build-hashed
    // static assets.
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
