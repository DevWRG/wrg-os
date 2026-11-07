"use client";

import { useEffect, useState } from "react";

import { kasApi } from "./types";

// Muat data GET dari BFF. Hasil dikunci per (path, versi) — `loading` diturunkan dari kunci,
// bukan setState sinkron di effect (aturan lint react-hooks, lihat kalender-view F31).
// `data` tetap menampilkan hasil terakhir saat memuat ulang supaya tabel tidak berkedip kosong.
export function useKasData<T>(path: string | null) {
  const [versi, setVersi] = useState(0);
  const [hasil, setHasil] = useState<{ kunci: string; data: T | null; galat: string | null } | null>(null);
  const kunci = path === null ? null : `${path}#${versi}`;

  useEffect(() => {
    if (kunci === null || path === null) return;
    let batal = false;
    kasApi<T>(path)
      .then((data) => { if (!batal) setHasil({ kunci, data, galat: null }); })
      .catch((e: unknown) => { if (!batal) setHasil({ kunci, data: null, galat: e instanceof Error ? e.message : String(e) }); });
    return () => { batal = true; };
  }, [kunci, path]);

  const selesai = hasil !== null && hasil.kunci === kunci;
  return {
    data: hasil?.data ?? null,
    galat: selesai ? hasil.galat : null,
    loading: kunci !== null && !selesai,
    muatUlang: () => setVersi((v) => v + 1),
  };
}
