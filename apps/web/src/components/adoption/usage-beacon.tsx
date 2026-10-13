"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// F58 — mencatat VIEW saat user berpindah halaman fitur. Layout dashboard tak dirender ulang
// pada navigasi klien, jadi pencatatannya di sini (usePathname), bukan di layout server.
// Throttle per (user, fitur) ada di apps/api; di sini cukup hindari kirim ulang path yang sama.
export function UsageBeacon() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || pathname === last.current) return;
    last.current = pathname;
    try {
      void fetch("/api/adoption/view", {
        method: "POST", keepalive: true, headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: pathname }),
      }).catch(() => {});
    } catch {
      /* tak boleh mengganggu halaman */
    }
  }, [pathname]);
  return null;
}
