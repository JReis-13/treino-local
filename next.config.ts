import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next dev blocks requests from LAN hostnames unless explicitly allowed.
  allowedDevOrigins: process.env.TREINO_LAN_HOST ? [process.env.TREINO_LAN_HOST] : [],
};

export default nextConfig;
