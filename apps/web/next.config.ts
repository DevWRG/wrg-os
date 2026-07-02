import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Resolusi versi + channel build dari state git saat build-time, lalu di-expose
// ke footer (apps/web/src/components/layout/footer.tsx) sbg env publik.
//   - Server build dari `main` → tag rilis terakhir (mis. v1.57.3), channel "production".
//   - Local dev di `dev`        → `git describe` (mis. v1.57.1-14-g83db4af), channel "dev build".
// Bisa di-override via env var (berguna saat .git tidak tersedia, mis. build di container).
function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const branch =
  process.env.VERCEL_GIT_COMMIT_REF ??
  process.env.GIT_BRANCH ??
  git("rev-parse --abbrev-ref HEAD") ??
  "";

const appVersion =
  process.env.NEXT_PUBLIC_APP_VERSION ??
  git("describe --tags --always --dirty") ??
  "unknown";

const buildChannel =
  process.env.NEXT_PUBLIC_BUILD_CHANNEL ??
  (branch === "main" ? "production" : "dev build");

const nextConfig: NextConfig = {
  // Sembunyikan overlay dev-tools Next.js (bulatan "N" pojok kiri-bawah) yang
  // menutupi user-card footer sidebar. Hanya berpengaruh di mode dev.
  devIndicators: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_BUILD_CHANNEL: buildChannel,
  },
};

export default nextConfig;
