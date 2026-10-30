"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// F173 — dropdown cari kota/kabupaten (514 kab/kota, migrasi 260) untuk form publik pameran.
// Warna eksplisit (bukan token tema) seperti form-nya: tetap terbaca di HP mode gelap.

export interface KabKota { kode: string; nama: string; provinsi: string }

/** "Kabupaten Malang" → "malang"; untuk pencocokan, awalan jenis wilayah dibuang. */
export function intiNama(nama: string): string {
  return nama.toLowerCase().replace(/^(kabupaten administrasi|kota administrasi|kabupaten|kota)\s+/, "").trim();
}

/** Cari: semua kata kunci harus ada (nama/provinsi); yang namanya diawali kata kunci naik ke atas. */
export function cariKabKota(daftar: readonly KabKota[], q: string, maks = 8): KabKota[] {
  const kata = q.toLowerCase().replace(/\bkab\b\.?/g, "kabupaten").split(/\s+/).filter(Boolean);
  if (!kata.length) return [];
  const skor = (k: KabKota) => {
    const teks = `${k.nama} ${k.provinsi}`.toLowerCase();
    if (!kata.every((w) => teks.includes(w))) return -1;
    const inti = intiNama(k.nama);
    const awal = kata.filter((w) => w !== "kota" && w !== "kabupaten")[0] ?? "";
    return (inti === awal ? 3 : 0) + (inti.startsWith(awal) ? 2 : 0) + (k.nama.toLowerCase().includes(kata.join(" ")) ? 1 : 0);
  };
  return daftar
    .map((k) => ({ k, s: skor(k) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.k.nama.localeCompare(b.k.nama))
    .slice(0, maks)
    .map((x) => x.k);
}

export function PilihKabKota({ nilai, onPilih, kelasInput }: { nilai: KabKota | null; onPilih: (k: KabKota | null) => void; kelasInput: string }) {
  const [daftar, setDaftar] = useState<KabKota[] | null>(null);
  const [gagal, setGagal] = useState(false);
  const [q, setQ] = useState("");
  const [buka, setBuka] = useState(false);
  const [aktif, setAktif] = useState(0);
  const wadah = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/publik/kab-kota")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: KabKota[] }) => setDaftar(d.items))
      .catch(() => setGagal(true));
  }, []);
  useEffect(() => {
    const tutup = (e: MouseEvent) => { if (!wadah.current?.contains(e.target as Node)) setBuka(false); };
    document.addEventListener("mousedown", tutup);
    return () => document.removeEventListener("mousedown", tutup);
  }, []);

  const hasil = useMemo(() => (daftar ? cariKabKota(daftar, q) : []), [daftar, q]);
  const pilih = (k: KabKota) => { onPilih(k); setQ(""); setBuka(false); };

  if (nilai) {
    return (
      <div className={`${kelasInput} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">{nilai.nama} <span className="text-slate-500">· {nilai.provinsi}</span></span>
        <button type="button" className="shrink-0 text-sm font-medium text-[#0a8a9e]" onClick={() => onPilih(null)}>Ganti</button>
      </div>
    );
  }

  return (
    <div ref={wadah} className="relative">
      <input
        className={kelasInput}
        value={q}
        placeholder={gagal ? "Gagal memuat daftar — muat ulang halaman" : daftar ? "Ketik nama kota/kabupaten…" : "Memuat daftar…"}
        disabled={!daftar}
        role="combobox"
        aria-controls="daftar-kab-kota"
        aria-expanded={buka && hasil.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setBuka(true); setAktif(0); }}
        onFocus={() => setBuka(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAktif((a) => Math.min(a + 1, hasil.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAktif((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && buka && hasil[aktif]) { e.preventDefault(); pilih(hasil[aktif]); }
          else if (e.key === "Escape") setBuka(false);
        }}
      />
      {/* input tersembunyi supaya validasi `required` browser menolak kirim sebelum memilih */}
      <input tabIndex={-1} aria-hidden required value="" onChange={() => {}} className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0" />
      {buka && q.trim() && (
        <ul id="daftar-kab-kota" role="listbox" className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-slate-900 shadow-lg">
          {hasil.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">Tidak ditemukan. Coba ejaan lain.</li>
          ) : hasil.map((k, i) => (
            <li
              key={k.kode}
              role="option"
              aria-selected={i === aktif}
              className={`cursor-pointer px-3 py-2 text-sm ${i === aktif ? "bg-[#0a8a9e]/10" : ""}`}
              onMouseEnter={() => setAktif(i)}
              onMouseDown={(e) => { e.preventDefault(); pilih(k); }}
            >
              <span className="font-medium">{k.nama}</span>
              <span className="block text-xs text-slate-500">{k.provinsi}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
