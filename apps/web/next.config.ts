import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fabtyna/shared"],
  // Allow cross-origin dev requests from your local network IP
  experimental: {
    // Note: If you are using an older Next.js 14 version, 'allowedDevOrigins' lives under 'experimental'.
    // If you are on Next.js 15+, it can be defined directly at the root level as `allowedDevOrigins: ["192.168.43.120"]`
  },
  allowedDevOrigins: ["192.168.43.119"],
};

export default nextConfig;