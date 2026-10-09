"use client";

import { useEffect, useState } from "react";

// Daftar HoD dari master_hod (migrasi 198) lewat BFF /api/hods. Dulu daftar ini
// ditulis ulang di sini dan di 4 tempat lain, lalu menyimpang (HoD Aftersales
// ber-key `pakMuhid` di sini, `muhid` di NPK/approval). Jangan menulis daftar
// HoD lagi di komponen — pakai hook ini.

export interface HodOption {
  key: string;
  label: string; // "Rocky — Sales East"
}

// Satu fetch per muat halaman, dibagi semua komponen (dropdown + sel tabel).
// Gagal → cache dibuang supaya pemakaian berikutnya mencoba lagi.
let shared: Promise<HodOption[]> | null = null;

function loadHods(): Promise<HodOption[]> {
  shared ??= fetch("/api/hods")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d: { hods?: HodOption[] }) => (d.hods ?? []).map((h) => ({ key: h.key, label: h.label })))
    .catch((err) => {
      shared = null;
      throw err;
    });
  return shared;
}

export function useHodOptions(): { hods: HodOption[]; loading: boolean; error: string | null } {
  const [hods, setHods] = useState<HodOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadHods()
      .then((h) => alive && setHods(h))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { hods, loading, error };
}

/** Label HoD; key yang tak (lagi) ada di master tampil apa adanya. */
export const hodLabel = (hods: HodOption[], key: string) => hods.find((h) => h.key === key)?.label ?? key;

/** Untuk sel tabel / teks yang cuma butuh label satu HoD. */
export function HodName({ hodKey }: { hodKey: string }) {
  const { hods } = useHodOptions();
  return <>{hodLabel(hods, hodKey)}</>;
}

// className utk <select> native agar selaras dengan komponen Input.
export const selectClass =
  "border-input bg-transparent dark:bg-input/30 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";
