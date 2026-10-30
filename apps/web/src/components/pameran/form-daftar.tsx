"use client";

import { useState } from "react";

// F173 — form publik di HP pengunjung pameran. Halaman publik di luar dashboard, jadi warna
// ditulis eksplisit (bukan token tema) supaya tetap terbaca walau HP pengunjung mode gelap.

export interface InfoPameran { nama: string; lokasi: string | null; tanggal_mulai: string; tanggal_selesai: string; buka: boolean }
interface Hasil { kode_kupon: string; sudah_terdaftar: boolean }

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function rentang(a: string, b: string): string {
  const f = (t: string) => { const [y, m, d] = t.split("-").map(Number); return { y, m, d }; };
  const x = f(a), y = f(b);
  if (a === b) return `${x.d} ${BULAN[x.m - 1]} ${x.y}`;
  if (x.y === y.y && x.m === y.m) return `${x.d}–${y.d} ${BULAN[y.m - 1]} ${y.y}`;
  return `${x.d} ${BULAN[x.m - 1]} – ${y.d} ${BULAN[y.m - 1]} ${y.y}`;
}

const INPUT = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#0a8a9e] focus:outline-none focus:ring-2 focus:ring-[#0a8a9e]/30";

export function FormDaftarPameran({ slug, info }: { slug: string; info: InfoPameran }) {
  const [nama, setNama] = useState("");
  const [institusi, setInstitusi] = useState("");
  const [hp, setHp] = useState("");
  const [situs, setSitus] = useState("");
  const [kirim, setKirim] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasil, setHasil] = useState<Hasil | null>(null);

  const judul = (
    <div className="mb-5 text-center">
      <p className="text-xs font-medium tracking-[0.15em] text-[#0a8a9e] uppercase">Registrasi Pengunjung</p>
      <h1 className="mt-1 text-xl leading-snug font-bold">{info.nama}</h1>
      <p className="mt-1 text-sm text-slate-600">{[info.lokasi, rentang(info.tanggal_mulai, info.tanggal_selesai)].filter(Boolean).join(" · ")}</p>
    </div>
  );

  if (hasil) {
    return (
      <div className="text-center">
        {judul}
        <p className="text-sm text-slate-700">{hasil.sudah_terdaftar ? "Nomor Anda sudah terdaftar. Kupon undian Anda:" : "Terima kasih telah berkunjung! Kupon undian doorprize Anda:"}</p>
        <div className="my-4 rounded-xl border-2 border-dashed border-[#0a8a9e] bg-[#0a8a9e]/5 px-4 py-5">
          <p className="font-mono text-3xl font-bold tracking-widest text-[#086f80] select-all">{hasil.kode_kupon}</p>
        </div>
        <p className="text-sm text-slate-700">Simpan atau <b>screenshot</b> layar ini dan tunjukkan kepada petugas saat pengundian.</p>
      </div>
    );
  }

  if (!info.buka) {
    return (
      <div className="text-center">
        {judul}
        <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">Pendaftaran untuk pameran ini sedang tidak dibuka. Silakan tanyakan petugas di booth.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setKirim(true);
    try {
      const res = await fetch(`/api/publik/pameran/${encodeURIComponent(slug)}/daftar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nama, institusi, no_hp: hp, situs }),
      });
      const data = (await res.json().catch(() => null)) as (Hasil & { error?: string }) | null;
      if (!data) throw new Error("Koneksi terputus. Muat ulang halaman lalu coba lagi.");
      if (!res.ok) throw new Error(data.error ?? "Gagal mendaftar, coba lagi.");
      setHasil(data);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setKirim(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {judul}
      <label className="block text-sm font-medium">
        Nama lengkap
        <input className={INPUT} value={nama} onChange={(e) => setNama(e.target.value)} required maxLength={120} autoComplete="name" placeholder="dr. Nama Lengkap, Sp.PD" />
      </label>
      <label className="block text-sm font-medium">
        Asal institusi
        <input className={INPUT} value={institusi} onChange={(e) => setInstitusi(e.target.value)} required maxLength={160} autoComplete="organization" placeholder="RS / klinik / unit hemodialisa" />
      </label>
      <label className="block text-sm font-medium">
        No. HP (WhatsApp)
        <span className="ml-1 font-normal text-slate-500">— angka saja, tanpa spasi</span>
        <input className={INPUT} value={hp} onChange={(e) => setHp(e.target.value.replace(/(?!^\+)\D/g, ""))} required inputMode="tel" autoComplete="tel" maxLength={16} placeholder="081234567890" />
      </label>
      {/* umpan bot — tersembunyi dari manusia & pembaca layar */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Situs<input tabIndex={-1} autoComplete="off" value={situs} onChange={(e) => setSitus(e.target.value)} /></label>
      </div>
      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <button type="submit" disabled={kirim} className="w-full rounded-lg bg-[#0a8a9e] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#086f80] disabled:opacity-60">
        {kirim ? "Mengirim…" : "Daftar & dapatkan kupon"}
      </button>
    </form>
  );
}
