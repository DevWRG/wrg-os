"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

// ── ANGKA DESIMAL WAJIB PAKAI KOMA ────────────────────────────────────────────────
// String(1.067) menghasilkan "1.067", dan Excel dengan locale Indonesia membaca titik
// itu sebagai PEMISAH RIBUAN — jadi 1,067 terbaca 1067. Pada nilai berdesimal panjang
// akibatnya ekstrem: revenue 29167568.055227 tampil sebagai 29.167.568.055.227, membesar
// sejuta kali. Terlihat di export /kso-produktivitas 2026-08-24, dan `marginPct` di
// pricebook-setup-table punya cacat yang sama.
//
// KENAPA DI SINI, BUKAN DI TIAP PEMANGGIL: pemanggil mengirim `number` dan wajar
// menganggap komponen export tahu cara menuliskannya. Menyerahkan pemformatan ke tiap
// pemanggil berarti cacat yang sama menunggu di setiap kolom desimal baru — dan cacat
// ini TIDAK memunculkan error: berkasnya terbuka normal, angkanya saja yang salah.
//
// PEMISAH KOLOM TETAP KOMA (`sep=,`, keputusan di CLAUDE.md: "buka mulus di Excel lokal
// apa pun"). Tidak bentrok, karena csvCell mengutip sel yang memuat koma — dan sel
// berkutip berisi "1,067" tetap dikenali sebagai angka oleh Excel locale Indonesia.
//
// useGrouping: false — pemisah ribuan di dalam CSV justru sumber ambiguitas baru.
// maximumFractionDigits 6: cukup untuk rasio & porsi, tanpa memuntahkan ekor float.
function angkaCsv(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);          // integer aman di semua locale
  return v.toLocaleString("id-ID", { useGrouping: false, maximumFractionDigits: 6 });
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? angkaCsv(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export client-side ke CSV yang dibuka mulus di Excel (BOM UTF-8 + directive
// sep=, agar Excel lokal apa pun pakai koma sbg pemisah kolom).
//
// Tombolnya SOLID (variant default), bukan outline. Di toolbar tabel, tombol ini
// berdiri di antara kotak cari & dropdown filter yang semuanya putih — dengan
// outline ia tampak sebagai kotak putih keempat dan orang tidak sadar itu bisa
// diklik. Aturan umumnya: kontrol masukan putih, AKSI berwarna.
export function ExportButton<T>({
  filename,
  columns,
  data,
  fetchData,
  label = "Export Excel",
  pdf = true,
}: {
  filename: string;
  columns: ExportColumn<T>[];
  data?: T[];
  /** kalau di-set, data diambil saat klik (mis. detail dari API), bukan dari prop. */
  fetchData?: () => Promise<T[]>;
  label?: string;
  /** F92: tombol Export PDF di samping CSV (isi sama persis). Matikan dengan `pdf={false}`. */
  pdf?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);

  async function exportCsv() {
    setBusy(true);
    let rows: T[] = [];
    try {
      rows = fetchData ? await fetchData() : (data ?? []);
    } catch {
      rows = [];
    } finally {
      setBusy(false);
    }
    if (rows.length === 0) return;
    const head = columns.map((c) => csvCell(c.header)).join(",");
    const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")).join("\n");
    const stamp = new Date().toISOString().slice(0, 10);
    const csv = `sep=,\n${head}\n${body}`;
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  // PDF = baris yang sama dengan CSV, ditata ulang di server (pdfkit). Angka ditulis
  // apa adanya (bukan angkaCsv) karena PDF dibaca manusia, bukan di-parse Excel.
  async function exportPdf() {
    setBusyPdf(true);
    try {
      const rows = fetchData ? await fetchData() : (data ?? []);
      if (rows.length === 0) return;
      const sel = (v: string | number | null | undefined) =>
        v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("id-ID", { maximumFractionDigits: 6 }) : String(v);
      const res = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          judul: filename.replace(/[-_]+/g, " "),
          header: columns.map((c) => c.header),
          baris: rows.map((row) => columns.map((c) => sel(c.value(row)))),
        }),
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* gagal diam — tombol kembali aktif, user bisa ulangi */
    } finally {
      setBusyPdf(false);
    }
  }
  const kosong = busy || (!fetchData && (data?.length ?? 0) === 0);
  return (
    <>
      <Button size="sm" variant="default" onClick={exportCsv} disabled={kosong}>
        <Download className="size-4" /> {busy ? "Menyiapkan…" : label}
      </Button>
      {pdf && (
        <Button size="sm" variant="default" onClick={exportPdf} disabled={kosong || busyPdf}>
          <FileText className="size-4" /> {busyPdf ? "Menyiapkan…" : "Export PDF"}
        </Button>
      )}
    </>
  );
}
