// F145 Fase B (migrasi 264) — basis harga Simulator KSO. Murni (tanpa React) supaya bisa diuji.
import type { KsoMaster } from "./types";

/**
 * Basis harga (Pedoman Komite KSO Forum v01, Fase B): "beli" = harga beli WRG dari Finance
 * (reagen/kit) + HPP alat F172; barang yang belum punya harga beli memakai harga lama.
 * "daftar" = perilaku lama (price list / distributor). Rumus panel TIDAK berubah — yang diganti
 * hanya nilai awal harga yang dimasukkan ke panel.
 */
export type BasisHarga = "beli" | "daftar";

export function terapkanBasis(m: KsoMaster, basis: BasisHarga): KsoMaster {
  if (basis === "daftar") return m;
  return {
    ...m,
    analyzers: m.analyzers.map((a) => ({
      ...a,
      ...(a.hppAlat != null ? { defaultCapex: a.hppAlat, defaultCapexPl: a.hppAlat, defaultDisc: 0 } : {}),
      reagents: a.reagents.map((r) => (r.hargaBeli != null ? { ...r, hargaDp: r.hargaBeli, hargaPl: r.hargaBeli } : r)),
    })),
    parameters: m.parameters.map((p) => (p.hargaBeli != null ? { ...p, hargaDp: p.hargaBeli, hargaPl: p.hargaBeli } : p)),
  };
}
