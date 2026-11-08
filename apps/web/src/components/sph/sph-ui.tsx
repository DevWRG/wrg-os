"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, CircleCheck, Clock, X } from "lucide-react";

import { cn } from "@/lib/utils";

// F15 — potongan UI bersama halaman SPH (daftar, buat, detail, pengaturan):
// label & warna status, pelacak alur, notifikasi singkat (toast), format angka.

export type StatusSph = "draft" | "hod_review" | "approved" | "sent" | "canceled";

export interface PutusanAksi {
  boleh: boolean;
  alasan: string | null;
}

// Bentuk keluaran apps/api lib/sph-alur.ts aksiSph().
export interface AksiSph {
  review: PutusanAksi;
  approve: PutusanAksi;
  konfirmasiVarian: PutusanAksi;
  gantiTtd: PutusanAksi;
  kirim: PutusanAksi;
  batal: PutusanAksi;
  ubahSyarat: PutusanAksi;
  utama: "review" | "approve" | "konfirmasiVarian" | "kirim" | null;
  petunjuk: string;
  perluAksiSaya: boolean;
}

export const STATUS_SPH: Record<StatusSph, { label: string; pendek: string; kelas: string; titik: string }> = {
  draft: {
    label: "Menunggu Review",
    pendek: "Review",
    kelas: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    titik: "bg-amber-500",
  },
  hod_review: {
    label: "Menunggu Approve",
    pendek: "Approve",
    kelas: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    titik: "bg-sky-500",
  },
  approved: {
    label: "Disetujui",
    pendek: "Disetujui",
    kelas: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    titik: "bg-emerald-500",
  },
  sent: {
    label: "Terkirim",
    pendek: "Terkirim",
    kelas: "border-primary-dark/50 bg-primary-soft text-foreground dark:border-primary/60",
    titik: "bg-primary",
  },
  canceled: {
    label: "Dibatalkan",
    pendek: "Batal",
    kelas: "border-border bg-card text-muted-foreground",
    titik: "bg-muted-foreground",
  },
};

export function metaStatus(s: string) {
  return STATUS_SPH[s as StatusSph] ?? { label: s, pendek: s, kelas: "border-border bg-card", titik: "bg-muted-foreground" };
}

export function StatusSphBadge({ status, className }: { status: string; className?: string }) {
  const m = metaStatus(status);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        m.kelas,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", m.titik)} aria-hidden />
      {m.label}
    </span>
  );
}

export const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

// Waktu dari DB (timestamptz::text) → "8 Nov 2026, 14.05" zona WIB.
export function tglWaktu(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T").replace(/\+(\d\d)$/, "+$1:00"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function tglPendek(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T").replace(/\+(\d\d)$/, "+$1:00"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });
}

// Pesan error dari server → kalimat ramah (tanpa "Error:" / JSON mentah).
export function pesanRamah(e: unknown, cadangan = "Terjadi kesalahan. Coba lagi."): string {
  let s = e instanceof Error ? e.message : String(e ?? "");
  s = s.replace(/^(Type)?Error:\s*/i, "").trim();
  if (!s || s === "[object Object]") return cadangan;
  if (/backend unreachable|failed to fetch|networkerror/i.test(s)) return "Server tidak terjangkau. Periksa koneksi lalu coba lagi.";
  if (/^unauthenticated$/i.test(s)) return "Sesi Anda berakhir. Silakan masuk lagi.";
  if (/^forbidden/i.test(s)) return "Anda tidak punya izin untuk aksi ini.";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Ambil JSON + lempar Error dengan pesan server bila gagal.
export async function ambilJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* body bukan JSON */
  }
  const obj = (data ?? {}) as { error?: string; ok?: boolean };
  if (!res.ok || obj.ok === false) throw new Error(obj.error ?? `Gagal (${res.status})`);
  return data as T;
}

// ── Toast ──
type Jenis = "sukses" | "gagal" | "info";
interface Toast {
  id: number;
  jenis: Jenis;
  judul: string;
  isi?: string;
}

export function useToast() {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const tutup = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (jenis: Jenis, judul: string, isi?: string) => {
      const id = ++seq.current;
      setList((l) => [...l.slice(-2), { id, jenis, judul, isi }]);
      window.setTimeout(() => tutup(id), jenis === "gagal" ? 7000 : 4500);
    },
    [tutup],
  );
  const node = (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.jenis === "gagal" ? "alert" : "status"}
          className={cn(
            "bg-card pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg",
            t.jenis === "sukses" && "border-emerald-300 dark:border-emerald-700",
            t.jenis === "gagal" && "border-destructive/50",
          )}
        >
          {t.jenis === "sukses" ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : t.jenis === "gagal" ? (
            <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
          ) : (
            <Clock className="text-primary mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">{t.judul}</p>
            {t.isi && <p className="text-muted-foreground mt-0.5 break-words">{t.isi}</p>}
          </div>
          <button
            type="button"
            onClick={() => tutup(t.id)}
            className="text-muted-foreground hover:text-foreground -m-1 cursor-pointer rounded p-1"
            aria-label="Tutup"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
  return { toast, node };
}

// ── Pelacak alur: Dibuat → Review HoD → Approve & nomor → Terkirim ──
export interface LangkahAlur {
  judul: string;
  oleh?: string | null;
  waktu?: string | null;
  ket?: string | null;
}

export function urutanStatus(s: string): number {
  return { draft: 1, hod_review: 2, approved: 3, sent: 4 }[s] ?? 0;
}

export function PelacakAlur({ status, langkah }: { status: string; langkah: LangkahAlur[] }) {
  // langkah[0] = dibuat (selalu selesai); indeks i selesai bila i < urutanStatus.
  const batal = status === "canceled";
  const sampai = batal ? langkah.filter((l) => l.waktu || l.oleh).length : urutanStatus(status);
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-0">
      {langkah.map((l, i) => {
        const selesai = i < sampai;
        const sekarang = !batal && i === sampai;
        return (
          <li key={l.judul} className="relative flex gap-3 sm:flex-col sm:gap-2 sm:pr-4">
            {/* garis penghubung */}
            {i < langkah.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-7 left-3.5 h-[calc(100%-0.5rem)] w-0.5 sm:top-3.5 sm:left-8 sm:h-0.5 sm:w-[calc(100%-2.5rem)]",
                  i < sampai - 1 ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                selesai && "border-primary bg-primary text-primary-foreground",
                sekarang && "border-primary-dark bg-primary-soft text-foreground dark:border-primary",
                !selesai && !sekarang && "border-border bg-card text-muted-foreground",
              )}
            >
              {selesai ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 pb-1">
              <p className={cn("text-sm font-medium", !selesai && !sekarang && "text-muted-foreground")}>{l.judul}</p>
              {selesai && (l.oleh || l.waktu) ? (
                <p className="text-muted-foreground text-xs">
                  {l.oleh}
                  {l.oleh && l.waktu ? " · " : ""}
                  {tglWaktu(l.waktu)}
                </p>
              ) : sekarang ? (
                <p className="text-primary-dark text-xs font-medium dark:text-primary">Langkah sekarang</p>
              ) : null}
              {selesai && l.ket && <p className="text-muted-foreground font-mono text-xs break-all">{l.ket}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Efek kecil: jalankan fn sekali saat mount (async) dengan penjaga unmount.
export function useSekali(fn: (aktif: () => boolean) => Promise<void> | void, deps: unknown[] = []) {
  useEffect(() => {
    let a = true;
    void fn(() => a);
    return () => {
      a = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps diteruskan pemanggil
  }, deps);
}
