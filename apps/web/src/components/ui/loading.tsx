import { Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Satu sumber untuk SEMUA tampilan "sedang memuat" di web.
 *
 * Aturannya sederhana, dan sengaja ditulis supaya tidak lahir gaya kedua:
 * - Bentuk kontennya sudah diketahui (kartu, tabel, grafik) -> pakai Skeleton*,
 *   karena rangkanya menahan tata letak: isi tidak melompat saat data datang.
 * - Bentuknya belum diketahui atau ruangnya sempit (baris tabel yang dibuka,
 *   isi dialog, status di samping tombol) -> pakai LoadingInline/LoadingBlock.
 *
 * Semua varian memakai `role="status"` + `aria-live="polite"` sekali saja di
 * pembungkus terluar: pembaca layar mengumumkan "Memuat…" satu kali, bukan
 * sekali per kotak skeleton. Kotak skeleton-nya sendiri `aria-hidden`.
 *
 * `motion-reduce:animate-none` dipasang di tiap animasi — pengguna yang
 * mematikan animasi di OS tetap melihat penanda, hanya tanpa gerak.
 */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-4 shrink-0 animate-spin motion-reduce:animate-none", className)} />;
}

/** Spinner + teks dalam satu baris. Untuk ruang sempit: baris tabel yang
 *  dibuka, isi dialog, status di samping kontrol. */
export function LoadingInline({
  label = "Memuat…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("text-muted-foreground inline-flex items-center gap-2 text-sm", className)}
    >
      <Spinner className="size-3.5" />
      {label}
    </span>
  );
}

/** Blok tengah untuk isi kartu/panel yang belum punya bentuk tetap. */
export function LoadingBlock({
  label = "Memuat…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-center text-sm",
        className,
      )}
    >
      <Spinner className="size-5" />
      {label}
    </div>
  );
}

/** Kartu utuh berisi LoadingBlock — untuk layar yang isinya satu kartu. */
export function LoadingCard({ label, className }: { label?: string; className?: string }) {
  return (
    <Card className={className}>
      <CardContent>
        <LoadingBlock label={label} />
      </CardContent>
    </Card>
  );
}

/** Deret kartu KPI. `count` disamakan dengan jumlah kartu sungguhan supaya
 *  lebar baris tidak berubah begitu data datang. */
export function SkeletonCards({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Memuat"
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="border-border rounded-xl border p-4">
          <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-7 w-32 motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-3 w-20 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** Grid kartu isi (bukan KPI) — mis. daftar approval/draft/dokumen yang
 *  memang dirender sebagai `grid gap-4 md:grid-cols-2`. */
export function SkeletonCardGrid({
  count = 4,
  lines = 3,
  className,
}: {
  count?: number;
  lines?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Memuat"
      className={cn("grid gap-4 md:grid-cols-2", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="border-border space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
            <Skeleton className="h-5 w-16 rounded-full motion-reduce:animate-none" />
          </div>
          {Array.from({ length: lines }, (_, j) => (
            <Skeleton
              key={j}
              className={cn("h-3 motion-reduce:animate-none", j === lines - 1 ? "w-1/2" : "w-full")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Rangka tabel: satu baris kepala + `rows` baris isi. */
export function SkeletonTable({
  rows = 6,
  cols = 5,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Memuat"
      className={cn("border-border overflow-hidden rounded-xl border", className)}
    >
      <div aria-hidden className="bg-muted/40 flex gap-4 border-b px-4 py-2.5">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1 motion-reduce:animate-none" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} aria-hidden className="flex gap-4 border-b px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            // Kolom pertama dibuat lebih lebar: kolom nama memang begitu, dan
            // rangka yang seragam rata justru terbaca sebagai kotak kosong.
            <Skeleton
              key={c}
              className={cn("h-3.5 motion-reduce:animate-none", c === 0 ? "flex-[2]" : "flex-1")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Rangka grafik: judul, bidang plot, sumbu. */
export function SkeletonChart({
  height = 220,
  judul = true,
  className,
}: {
  height?: number;
  judul?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Memuat"
      className={cn("border-border rounded-xl border p-4", className)}
    >
      {judul ? (
        <div aria-hidden>
          <Skeleton className="h-3.5 w-40 motion-reduce:animate-none" />
          <Skeleton className="mt-2 h-3 w-56 motion-reduce:animate-none" />
        </div>
      ) : null}
      <Skeleton
        aria-hidden
        className="mt-4 w-full motion-reduce:animate-none"
        style={{ height }}
      />
      <div aria-hidden className="mt-2 flex gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

/** Beberapa baris teks — untuk daftar/rincian yang bukan tabel. */
export function SkeletonLines({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-label="Memuat" className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          aria-hidden
          // Baris terakhir dipendekkan supaya terbaca sebagai teks, bukan blok.
          className={cn("h-3.5 motion-reduce:animate-none", i === rows - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Rangka satu halaman penuh: judul + kartu + tabel. Dipakai di layar yang
 *  menahan SELURUH isinya sampai fetch pertama selesai. */
export function SkeletonPage({
  cards = 4,
  rows = 6,
  cols = 5,
  className,
}: {
  cards?: number;
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <div aria-hidden className="space-y-2">
        <Skeleton className="h-5 w-52 motion-reduce:animate-none" />
        <Skeleton className="h-3 w-80 motion-reduce:animate-none" />
      </div>
      {cards > 0 ? <SkeletonCards count={cards} /> : null}
      <SkeletonTable rows={rows} cols={cols} />
    </div>
  );
}
