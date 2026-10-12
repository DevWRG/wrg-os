"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * State tabel server-driven yang hidup di URL.
 *
 * Dipakai bersama oleh tabel yang memakai mode `server` DataTable (visits,
 * purchase-orders, orders, shipments). Satu tempat karena keempatnya harus
 * berperilaku identik: search di-debounce, tiap perubahan filter/sort
 * me-reset halaman, dan navigasi memakai `replace` supaya tombol Back tidak
 * memutar ulang tiap ketikan.
 *
 * Ini bukan sekadar merapikan: yang diperbaiki keempat tabel itu adalah kelas
 * bug "angka bohong tanpa suara" (backend membatasi baris, klien menghitung
 * dari yang kebetulan ter-load). Kalau logika URL-nya disalin per tabel, cepat
 * atau lambat satu salinan menyimpang dan bug itu kembali di satu menu saja —
 * di tempat yang paling tidak diperiksa orang.
 */
export function useTableUrl(qUrl: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      startTransition(() => {
        router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  // Kotak pencarian diketik lokal lalu di-debounce ke URL; tanpa debounce tiap
  // huruf memicu satu query ke backend.
  const [qInput, setQInput] = useState(qUrl);
  const [qTerakhir, setQTerakhir] = useState(qUrl);
  // URL berubah dari luar (Back, klik tab filter) → samakan kotaknya.
  // Disesuaikan saat render, bukan lewat useEffect: efek yang memanggil
  // setState memicu render berantai dan ditolak react-hooks/set-state-in-effect.
  if (qUrl !== qTerakhir) {
    setQTerakhir(qUrl);
    setQInput(qUrl);
  }
  useEffect(() => {
    if (qInput === qUrl) return;
    const t = setTimeout(() => push({ q: qInput || null, page: null }), 350);
    return () => clearTimeout(t);
  }, [qInput, qUrl, push]);

  return { push, qInput, setQInput, pending };
}
