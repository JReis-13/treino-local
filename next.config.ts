import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next dev blocks requests from LAN hostnames unless explicitly allowed.
  allowedDevOrigins: process.env.TREINO_LAN_HOST ? [process.env.TREINO_LAN_HOST] : [],
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
    ] }];
  },
};

export default nextConfig;
