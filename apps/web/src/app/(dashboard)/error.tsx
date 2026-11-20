"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

// Batas error untuk semua halaman dashboard. Tanpa berkas ini, error di satu
// halaman naik ke app/error.tsx yang menggantikan SELURUH layout — sidebar &
// topbar ikut hilang dan pengguna kehilangan navigasi. Di sini hanya area
// konten yang diganti; menu tetap bisa dipakai untuk pindah halaman.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full">
        <AlertTriangle className="size-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Halaman ini gagal dimuat</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Coba muat ulang. Kalau terus berulang, kirim kode di bawah ke tim IT.
        </p>
        {error.digest ? <p className="text-muted-foreground font-mono text-xs">Kode: {error.digest}</p> : null}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>Coba lagi</Button>
        <Button variant="ghost" render={<Link href="/" />} nativeButton={false}>Ke beranda</Button>
      </div>
    </div>
  );
}
