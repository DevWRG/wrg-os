// F172 × F145 (migrasi 281) — biaya reagen Bottom Line Alat dari rumus Simulator KSO dengan harga beli =
// HPP Price Book. Murni (tanpa React) supaya bisa diuji. Hanya hematologi: rumusnya memisah reagen per tes
// (siklus) dan reagen harian (startup/shutdown/probe) — yang harian dibagi volume harian, jadi bottom per tes
// ikut test/bulan, hari kerja, dan masa KSO (Pedoman Komite KSO Forum v01).
import { hematoCost, perUnitOf } from "./formula";
import type { HargaInput, KsoAnalyzer } from "./types";

/** Volume acuan untuk memisah komponen harian; komponen tetap per tes × (volume ÷ hari kerja) = rupiah per hari. */
const VOL_ACUAN = 1000;

export interface BarisOtomatis { model_key: string; biaya_per_tes: number; biaya_tetap_harian: number }
export interface HasilOtomatis { baris: BarisOtomatis[]; kurang: { alat: string; reagen: string[] }[] }

/** Reagen yang ikut rumus alat ini (kontribusi ≠ 0 saat semua harga = 1). */
function reagenDipakai(a: KsoAnalyzer, hariKerja: number): string[] {
  const satu: Record<string, HargaInput> = Object.fromEntries(a.reagents.map((r) => [r.kode, { price: 1, disc: 0 }]));
  const h = hematoCost(a.kode, VOL_ACUAN, hariKerja, perUnitOf(a, satu));
  return h ? Object.entries(h.pr).filter(([, v]) => v.c + v.f > 0).map(([k]) => k) : [];
}

/**
 * Hitung biaya per model Bottom Line. Alat yang salah satu reagennya belum punya harga beli (HPP Price Book)
 * TIDAK dihitung — harga daftar akan membuat bottom 2–4× terlalu tinggi. Dua alat satu model → ambil yang
 * lebih mahal (bottom tak boleh terlalu rendah).
 */
export function biayaOtomatisHemato(analyzers: KsoAnalyzer[], hariKerja: number): HasilOtomatis {
  const per = new Map<string, BarisOtomatis>();
  const kurang: HasilOtomatis["kurang"] = [];
  for (const a of analyzers) {
    if (a.kategori !== "HEMATO" || !a.modelKey) continue;
    const pakai = reagenDipakai(a, hariKerja);
    const byKode = new Map(a.reagents.map((r) => [r.kode, r]));
    const tanpa = pakai.filter((k) => byKode.get(k)?.hargaBeli == null);
    if (pakai.length === 0 || tanpa.length) { kurang.push({ alat: a.label, reagen: tanpa.map((k) => byKode.get(k)?.nama ?? k) }); continue; }
    const harga: Record<string, HargaInput> = Object.fromEntries(a.reagents.map((r) => [r.kode, { price: r.hargaBeli ?? 0, disc: 0 }]));
    const h = hematoCost(a.kode, VOL_ACUAN, hariKerja, perUnitOf(a, harga));
    if (!h) continue;
    const b = { model_key: a.modelKey, biaya_per_tes: Math.round(h.cyc * 100) / 100, biaya_tetap_harian: Math.round((h.fix * VOL_ACUAN) / hariKerja) };
    const lama = per.get(a.modelKey);
    if (!lama || b.biaya_per_tes + b.biaya_tetap_harian > lama.biaya_per_tes + lama.biaya_tetap_harian) per.set(a.modelKey, b);
  }
  return { baris: [...per.values()], kurang };
}
