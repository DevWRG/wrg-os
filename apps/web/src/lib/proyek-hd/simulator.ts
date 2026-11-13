// Simulator HD — dua sudut pandang atas satu unit hemodialisa:
//   Proyeksi RS : berapa tindakan, klaim RS, dan omset Wahana (dibawa ke direktur RS + nefrolog).
//   Margin WRG  : biaya per tindakan (consumable + alat + operasional) vs pendapatan WRG.
//                 Hanya untuk pemegang 'proyek-hd-margin' — disaring di BFF.
// Rumus murni (diuji). Nilai awal dari tabel hd_param (layar Parameter), BUKAN dari
// kode: harga & tarif tak boleh masuk repo publik. Kunci kosong = 0 + peringatan.

export const PPN = 1.11;
/** Rata-rata tindakan per pasien tetap per bulan (±2–3×/minggu). */
export const TINDAKAN_PER_PASIEN = 11;
/** Di bawah ini biaya tetap terlalu berat per tindakan. */
export const BATAS_TINDAKAN_SEHAT = 400;

export type ModeBayar = "bagi_hasil" | "harga_tetap";

export interface ProyeksiInput {
  mesin: number; shift: number; hari: number; tarif_klaim: number; mode: ModeBayar; porsi_pct: number; harga_tetap: number;
}

export type Kesehatan = "sehat" | "kurang_shift" | "kurang_tindakan";

export function hitungProyeksi(i: ProyeksiInput) {
  const tindakan = i.mesin * i.shift * i.hari;
  const perTindakan = i.mode === "bagi_hasil" ? (i.tarif_klaim * i.porsi_pct) / 100 : i.harga_tetap;
  const omsetBln = perTindakan * tindakan;
  const kesehatan: Kesehatan = tindakan < BATAS_TINDAKAN_SEHAT ? "kurang_tindakan" : i.shift < 2 ? "kurang_shift" : "sehat";
  return {
    tindakan_bln: tindakan,
    pasien_tetap: Math.round(tindakan / TINDAKAN_PER_PASIEN),
    klaim_rs_bln: tindakan * i.tarif_klaim,
    wahana_per_tindakan: perTindakan,
    omset_wahana_bln: omsetBln,
    omset_wahana_thn: omsetBln * 12,
    kesehatan,
  };
}

export const CONSUMABLE = [
  { key: "needle", label: "Fistula needle", qty: 2 },
  { key: "circuit", label: "Blood circuit", qty: 1 },
  { key: "bicarb", label: "Bicarbonate cartridge", qty: 1 },
  { key: "acid", label: "Acid concentrate", qty: 1 },
  { key: "dialyzer", label: "Dialyzer", qty: 1 },
] as const;

export interface MarginInput {
  needle: number; circuit: number; bicarb: number; acid: number; dialyzer: number;
  harga_mesin: number; ro: number;
  mesin: number; backup: number; tindakan_per_hari: number; hari: number; tenor: number; pendapatan: number; share_pct: number;
  gaji_teknisi: number; fee_dpjp: number; kirim: number; lab_air: number; diklat: number; kalibrasi: number; pitnas: number; renovasi: number;
  lain_per_tindakan: number; lain_harian: number; lain_bln: number; min_pct: number;
}

export const setExPpn = (i: MarginInput) => CONSUMABLE.reduce((a, it) => a + it.qty * i[it.key], 0);

export function hitungMargin(i: MarginInput) {
  const nTotal = i.mesin + i.backup;
  const tindakanHari = i.mesin * i.tindakan_per_hari;
  const tindakanBln = tindakanHari * i.hari;
  const tindakanTenor = tindakanBln * 12 * i.tenor;
  const per = (total: number) => (tindakanTenor > 0 ? total / tindakanTenor : 0);

  const set = setExPpn(i);
  const biayaSet = set * PPN;
  const biayaAlat = per(nTotal * i.harga_mesin * PPN + i.ro);
  const lainLain = i.lain_per_tindakan
    + (tindakanHari > 0 ? i.lain_harian / tindakanHari : 0)
    + (tindakanBln > 0 ? i.lain_bln / tindakanBln : 0);
  const biayaOps =
    per(i.gaji_teknisi * 13 * i.tenor) + // 13× gaji (THR) per tahun
    i.fee_dpjp + i.kirim +
    per(i.lab_air * i.tenor) +
    per(i.diklat * i.tenor) +
    per(nTotal * Math.max(0, i.tenor - 1) * i.kalibrasi) + // tahun pertama masih garansi
    per(i.pitnas * i.tenor) +
    per(i.renovasi) +
    lainLain;

  const biaya = biayaSet + biayaAlat + biayaOps;
  const pendapatan = (i.pendapatan * i.share_pct) / 100;
  const margin = pendapatan - biaya;
  const marginPct = pendapatan > 0 ? margin / pendapatan : 0;
  return {
    tindakan_bln: tindakanBln,
    tindakan_tenor: tindakanTenor,
    set_ex_ppn: set,
    biaya_set: biayaSet,
    biaya_alat: biayaAlat,
    biaya_ops: biayaOps,
    biaya_total: biaya,
    pendapatan_per_tindakan: pendapatan,
    margin_per_tindakan: margin,
    margin_pct: marginPct,
    margin_bln: margin * tindakanBln,
    margin_thn: margin * tindakanBln * 12,
    margin_tenor: margin * tindakanTenor,
    layak: marginPct * 100 >= i.min_pct,
    beli_mesin: nTotal * i.harga_mesin,
    beli_consumable_bln: tindakanBln * set,
    beli_consumable_tenor: tindakanTenor * set,
  };
}

// ---------------------------------------------------------------- parameter → input awal

export type ParamMap = Record<string, number | null>;

const KUNCI_PROYEKSI = ["mesin", "shift", "hari", "tarif_klaim", "porsi_pct", "harga_tetap"] as const;
export const KUNCI_MARGIN = [
  "needle", "circuit", "bicarb", "acid", "dialyzer", "harga_mesin", "ro",
  "mesin", "backup", "tindakan_per_hari", "hari", "tenor", "pendapatan", "share_pct",
  "gaji_teknisi", "fee_dpjp", "kirim", "lab_air", "diklat", "kalibrasi", "pitnas", "renovasi",
  "lain_per_tindakan", "lain_harian", "lain_bln", "min_pct",
] as const;

/** Input awal + daftar kunci yang belum diisi admin (dipakai sebagai 0). */
export function proyeksiAwal(p: ParamMap): { input: ProyeksiInput; kosong: string[] } {
  const kosong: string[] = [];
  const v = (k: string) => { const x = p[`rs_${k}`]; if (x == null) { kosong.push(k); return 0; } return x; };
  const o = Object.fromEntries(KUNCI_PROYEKSI.map((k) => [k, v(k)])) as Omit<ProyeksiInput, "mode">;
  return { input: { ...o, mode: "bagi_hasil" }, kosong };
}

export function marginAwal(p: ParamMap): { input: MarginInput; kosong: string[] } {
  const kosong: string[] = [];
  const o = Object.fromEntries(KUNCI_MARGIN.map((k) => {
    const x = p[`margin_${k}`];
    if (x == null) kosong.push(k);
    return [k, x ?? 0];
  })) as unknown as MarginInput;
  return { input: o, kosong };
}

const persen = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const rp = (v: number) => Math.round(v).toLocaleString("id-ID");

/** Ringkasan satu baris untuk daftar simulasi tersimpan — dihitung di server (BFF), bukan dari klien. */
export function ringkasProyeksi(i: ProyeksiInput): string {
  const r = hitungProyeksi(i);
  return `${rp(r.tindakan_bln)} tindakan/bln · ±${r.pasien_tetap} pasien · omset Wahana Rp ${rp(r.omset_wahana_bln)}/bln`;
}
export function ringkasMargin(i: MarginInput): string {
  const r = hitungMargin(i);
  return `Margin ${persen(r.margin_pct)} · Rp ${rp(r.margin_per_tindakan)}/tindakan · ${rp(r.tindakan_bln)} tindakan/bln`;
}
