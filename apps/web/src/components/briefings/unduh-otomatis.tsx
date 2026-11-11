"use client";

import { useEffect } from "react";
import { Download } from "lucide-react";

// Memulai unduhan sekali saat halaman dibuka; tombol tetap ada sebagai cadangan.
export function UnduhOtomatis({ href }: { href: string }) {
  useEffect(() => {
    window.location.assign(href);
  }, [href]);
  return (
    <a
      href={href}
      download
      className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
    >
      <Download className="size-4" aria-hidden /> Unduh PDF
    </a>
  );
}
