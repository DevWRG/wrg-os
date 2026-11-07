// F172 × F145 (migrasi 281) — biaya reagen Bottom Line Alat dari rumus Simulator KSO dengan harga beli =
// HPP Price Book. Murni (tanpa React) supaya bisa diuji. Hanya hematologi: rumusnya memisah reagen per tes
// (siklus) dan reagen harian (startup/shutdown/probe) — yang harian dibagi volume harian, jadi bottom per tes
// ikut test/bulan, hari kerja, dan masa KSO (Pedoman Komite KSO Forum v01).
import { ccDetergent, elektroCost, hematoCost, perUnitOf } from "./formula";
import type { HargaInput, KsoAnalyzer } from "./types";

/** Volume acuan untuk memisah komponen harian; komponen tetap per tes × (volume ÷ hari kerja) = rupiah per hari. */
const VOL_ACUAN = 1000;

export interface BarisOtomatis {
  model_key: string; biaya_per_tes: number; biaya_tetap_harian: number;
  /** 284: pilihan kemasan cartridge BG — reagen/tes di volume V = min(max(per_tes, min_bulan ÷ V)). */
  biaya_tangga?: { per_tes: number; min_bulan: number }[];
  /** keterangan sumber (ikut tersimpan di kolom sumber) */
  rincian?: string;
}
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

// ── Kimia Klinik (284) ──────────────────────────────────────────────────────

/** Baris campuran tes riil per SKU (API kso_parameter_mix_v): kit reagen terkirim 12 bulan ke faskes yang memakai alat ini. */
export interface MixKk { analyzer: string; parameter: string; sku: string; tesPerKemasan: number; kit12bln: number; hpp: number | null }

/** Batch per hari bawaan Simulator (kk-panel: kosong = 5 sesi). */
const BATCH_KK = 5;

/**
 * Kimia Klinik: reagen per tes = Σ(kit × HPP) ÷ Σ(kit × tes per kit) atas kiriman 12 bulan (campuran tes riil, keputusan
 * user 7 Nov) + detergent per tes; detergent tetap per hari (startup/shutdown, per batch) → reagen harian.
 * Simulator membagi detergent harian dengan 30 hari kalender; di Bottom Line dikalikan HARI KERJA (alat dicuci saat dipakai),
 * konsisten dengan hematologi.
 */
export function biayaOtomatisKk(analyzers: KsoAnalyzer[], mix: MixKk[], hariKerja: number): HasilOtomatis {
  const baris: BarisOtomatis[] = [];
  const kurang: HasilOtomatis["kurang"] = [];
  for (const a of analyzers) {
    if (a.kategori !== "CC" || !a.modelKey) continue;
    let terkirim = mix.filter((m) => m.analyzer === a.kode && m.kit12bln > 0 && m.tesPerKemasan > 0);
    // 286: alat baru (belum ada unit terpasang) → campuran tes alat sejenis (reagen Zybio KK sama), dijumlah per SKU
    let sejenis: string[] = [];
    if (terkirim.length === 0) {
      const lain = mix.filter((m) => m.analyzer !== a.kode && m.kit12bln > 0 && m.tesPerKemasan > 0);
      sejenis = [...new Set(lain.map((m) => m.analyzer))];
      const perSku = new Map<string, MixKk>();
      for (const m of lain) {
        const x = perSku.get(m.sku);
        perSku.set(m.sku, x ? { ...x, kit12bln: x.kit12bln + m.kit12bln } : { ...m, analyzer: a.kode });
      }
      terkirim = [...perSku.values()];
    }
    const tanpaHpp = terkirim.filter((m) => m.hpp == null);
    const byKode = new Map(a.reagents.map((r) => [r.kode, r]));
    const deterKurang = ["conc", "probe_d"].filter((k) => byKode.get(k)?.hargaBeli == null).map((k) => byKode.get(k)?.nama ?? k);
    if (terkirim.length === 0) { kurang.push({ alat: a.label, reagen: ["belum ada kiriman reagen 12 bulan (campuran tes)"] }); continue; }
    if (tanpaHpp.length || deterKurang.length) {
      kurang.push({ alat: a.label, reagen: [...tanpaHpp.map((m) => `${m.parameter} (${m.sku})`), ...deterKurang] });
      continue;
    }
    const tes = terkirim.reduce((t, m) => t + m.kit12bln * m.tesPerKemasan, 0);
    const rupiah = terkirim.reduce((t, m) => t + m.kit12bln * (m.hpp ?? 0), 0);
    const harga: Record<string, HargaInput> = Object.fromEntries(a.reagents.map((r) => [r.kode, { price: r.hargaBeli ?? 0, disc: 0 }]));
    const u = perUnitOf(a, harga);
    // detergent per tes = A ÷ D + B (D = tes per hari) → A = rupiah per hari, B = rupiah per tes
    const det = (d: number) => ccDetergent(a.kode, d * 30, hariKerja, u.perMl("conc"), u.perMl("probe_d"), BATCH_KK)?.total ?? 0;
    const t1 = det(100), t2 = det(200);
    const perTesDet = 2 * t2 - t1, harianDet = (t1 - perTesDet) * 100;
    baris.push({
      model_key: a.modelKey,
      biaya_per_tes: Math.round((rupiah / tes + perTesDet) * 100) / 100,
      biaya_tetap_harian: Math.round(harianDet),
      rincian: `campuran tes riil${sejenis.length ? ` alat sejenis (${sejenis.join(", ")})` : ""}: ${terkirim.length} SKU, ${Math.round(tes).toLocaleString("id-ID")} tes terkirim 12 bln`,
    });
  }
  return { baris, kurang };
}

// ── Blood Gas (284) ─────────────────────────────────────────────────────────

/**
 * Blood Gas: cartridge kedaluwarsa `meta.stability` hari sesudah dibuka → residu terbuang dihitung (mode CPRR Simulator,
 * keputusan user 7 Nov). Tiap ukuran cartridge ber-HPP = satu pilihan {per_tes = harga ÷ kapasitas, min_bulan = harga × 30
 * ÷ masa pakai}; Bottom Line memilih yang termurah di volume usulan. biaya_per_tes = per tes cartridge paling efisien.
 */
export function biayaOtomatisBg(analyzers: KsoAnalyzer[]): HasilOtomatis {
  const baris: BarisOtomatis[] = [];
  const kurang: HasilOtomatis["kurang"] = [];
  for (const a of analyzers) {
    if (a.kategori !== "BG" || !a.modelKey) continue;
    const stab = Number(a.meta?.stability ?? 0);
    const cart = a.reagents.filter((r) => r.jenis === "cartridge" && (r.yieldTest ?? 0) > 0);
    const ada = cart.filter((r) => r.hargaBeli != null);
    if (!stab || ada.length === 0) {
      kurang.push({ alat: a.label, reagen: !stab ? ["masa pakai cartridge belum diisi"] : cart.map((r) => r.nama) });
      continue;
    }
    const tangga = ada.map((r) => ({
      per_tes: Math.round((r.hargaBeli! / r.yieldTest!) * 100) / 100,
      min_bulan: Math.round((r.hargaBeli! * 30) / stab),
    }));
    baris.push({
      model_key: a.modelKey,
      biaya_per_tes: Math.min(...tangga.map((t) => t.per_tes)),
      biaya_tetap_harian: 0,
      biaya_tangga: tangga,
      rincian: `${tangga.length} ukuran cartridge, masa pakai ${stab} hari (residu dihitung)`,
    });
  }
  return { baris, kurang };
}

// ── Elektrolit (288) ────────────────────────────────────────────────────────

/** Kode baris reagen paket Cartridge DN-X6 (migrasi 288). */
const REAGEN_ELEKTRO = "cart_reagen";

/**
 * Elektrolit (DN-X6, mode Cartridge): rumus Simulator elektroCost — Cal A habis 21 mL per hari kerja + 0,8 mL per tes,
 * paket diganti saat Cal A habis. Biaya per tes = A ÷ D + B (D = tes per hari kerja) → B = reagen/tes, A = reagen harian.
 */
export function biayaOtomatisElektro(analyzers: KsoAnalyzer[], hariKerja: number): HasilOtomatis {
  const baris: BarisOtomatis[] = [];
  const kurang: HasilOtomatis["kurang"] = [];
  for (const a of analyzers) {
    if (a.kategori !== "ELEKTRO" || !a.modelKey) continue;
    const r = a.reagents.find((x) => x.kode === REAGEN_ELEKTRO);
    if (!r || r.hargaBeli == null || !r.vol) { kurang.push({ alat: a.label, reagen: [r?.nama ?? "paket reagen cartridge"] }); continue; }
    const cpt = (d: number) => elektroCost(d * hariKerja, hariKerja, r.vol!, r.hargaBeli!)?.cpt ?? 0;
    const t1 = cpt(10), t2 = cpt(20);
    const perTes = 2 * t2 - t1, harian = (t1 - perTes) * 10;
    baris.push({
      model_key: a.modelKey,
      biaya_per_tes: Math.round(perTes * 100) / 100,
      biaya_tetap_harian: Math.round(harian),
      rincian: `paket cartridge ${Number(r.vol).toLocaleString("id-ID")} mL Cal A (21 mL/hari + 0,8 mL/tes)`,
    });
  }
  return { baris, kurang };
}

/** Semua kategori yang bisa dihitung otomatis. */
export function biayaOtomatis(b: { analyzers: KsoAnalyzer[]; hariKerja: number; mixKk?: MixKk[] }): HasilOtomatis {
  const h = [biayaOtomatisHemato(b.analyzers, b.hariKerja), biayaOtomatisKk(b.analyzers, b.mixKk ?? [], b.hariKerja),
    biayaOtomatisBg(b.analyzers), biayaOtomatisElektro(b.analyzers, b.hariKerja)];
  return { baris: h.flatMap((x) => x.baris), kurang: h.flatMap((x) => x.kurang) };
}
