import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sembunyikan overlay dev-tools Next.js (bulatan "N" pojok kiri-bawah) yang
  // menutupi user-card footer sidebar. Hanya berpengaruh di mode dev.
  devIndicators: false,
};

export default nextConfig;
