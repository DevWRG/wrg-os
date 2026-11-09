// F15 — diskon berjenjang per peran + diskon tambahan SPH (fungsi murni, diuji
// unit). Query DB-nya di repo/sph.ts; di sini cuma aturan & hitungan.
//
// Jenjang per baris (dan untuk diskon efektif keseluruhan bila ada diskon
// tambahan), dengan batas = batas diskon SKU efektif (Setup Harga terbit):
//   diskon ≤ batas                                → "normal"   (alur biasa)
//   ≤ batas + tambahanHodPp                       → "hod"      (HoD Business wajib menyetujui saat review)
//   ≤ batas + tambahanHodPp + tambahanDirekturPp  → "direktur" (Direktur wajib menyetujui sebelum approve tahap 2)
//   lebih dari itu                                → "tolak"    (ditolak saat SPH dibuat)
// "Pp" = poin persentase (5 = lima poin), bukan fraksi.
//
// Diskon tambahan (seluruh SPH) dipotong dari subtotal nett baris SEBELUM PPN.
// Diskon efektif keseluruhan = 1 − nett akhir sebelum PPN / Σ price list × qty;
// batasnya = diskon efektif baris (tanpa diskon tambahan) + diskonTotalMaksPct.
// Default diskonTotalMaksPct 0 → diskon tambahan berapa pun minimal jenjang HoD.

export type TierDiskon = "normal" | "hod" | "direktur";

export interface AturanTier {
  tambahanHodPp: number;
  tambahanDirekturPp: number;
  diskonTotalMaksPct: number;
}

export const ATURAN_TIER_DEFAULT: AturanTier = { tambahanHodPp: 5, tambahanDirekturPp: 10, diskonTotalMaksPct: 0 };

// PPN atas NETT (bukan price list) — sama dgn PPN_PRICEBOOK (repo/pricebook.ts).
export const PPN_SPH = 0.11;

// Toleransi pembulatan fraksi (diskon diketik dua desimal persen = 4 desimal fraksi).
const EPS = 1e-9;

const persen = (f: number) => `${(Math.round(f * 10000) / 100).toLocaleString("id-ID")}%`;

export const LABEL_TIER: Record<TierDiskon, string> = {
  normal: "Dalam batas",
  hod: "Perlu persetujuan HoD",
  direktur: "Perlu persetujuan Direktur",
};

const URUT: Record<TierDiskon, number> = { normal: 0, hod: 1, direktur: 2 };

export function tierTertinggi(...tier: (TierDiskon | null | undefined)[]): TierDiskon {
  let t: TierDiskon = "normal";
  for (const x of tier) if (x && URUT[x] > URUT[t]) t = x;
  return t;
}

export function tierSah(x: unknown): TierDiskon {
  return x === "hod" || x === "direktur" ? x : "normal";
}

export interface HasilTier {
  tier: TierDiskon | "tolak";
  batas: number; // fraksi
  batasHod: number;
  batasDirektur: number;
  alasan: string;
}

export function klasifikasiTier(diskon: number, batas: number, aturan: AturanTier): HasilTier {
  const batasHod = batas + aturan.tambahanHodPp / 100;
  // Diskon 100% = gratis — di atas jenjang apa pun selalu ditolak.
  const batasDirektur = Math.min(batasHod + aturan.tambahanDirekturPp / 100, 1 - 1e-4);
  const dasar = { batas, batasHod, batasDirektur };
  if (!Number.isFinite(diskon) || diskon < 0) return { ...dasar, tier: "tolak", alasan: "Diskon tidak boleh negatif" };
  if (diskon <= batas + EPS) return { ...dasar, tier: "normal", alasan: `Dalam batas ${persen(batas)}` };
  if (diskon <= batasHod + EPS) {
    return { ...dasar, tier: "hod", alasan: `Di atas batas ${persen(batas)} — perlu persetujuan HoD Business (maks. ${persen(batasHod)})` };
  }
  if (diskon <= batasDirektur + EPS) {
    return { ...dasar, tier: "direktur", alasan: `Di atas ${persen(batasHod)} — perlu persetujuan Direktur (maks. ${persen(batasDirektur)})` };
  }
  return { ...dasar, tier: "tolak", alasan: `Melebihi batas tertinggi ${persen(batasDirektur)} (batas produk + jatah HoD + jatah Direktur)` };
}

// Validasi isian Pengaturan SPH (poin persentase 0 ≤ x < 100, maks 2 desimal).
export function aturanTierDariInput(
  dasar: AturanTier,
  input: Partial<Record<keyof AturanTier, unknown>>,
): { ok: true; aturan: AturanTier } | { ok: false; error: string } {
  const out = { ...dasar };
  const label: Record<keyof AturanTier, string> = {
    tambahanHodPp: "jatah HoD",
    tambahanDirekturPp: "jatah Direktur",
    diskonTotalMaksPct: "batas diskon tambahan",
  };
  for (const k of Object.keys(label) as (keyof AturanTier)[]) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (input[k] === null || input[k] === "" || !Number.isFinite(n) || n < 0 || n >= 100) {
      return { ok: false, error: `${label[k]} harus angka 0 sampai kurang dari 100 (poin persentase)` };
    }
    out[k] = Math.round(n * 100) / 100;
  }
  return { ok: true, aturan: out };
}

export function aturanTierDariDb(r: Record<string, unknown> | null | undefined): AturanTier {
  const n = (v: unknown, d: number) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    tambahanHodPp: n(r?.tambahan_hod_pp ?? r?.tambahanHodPp, ATURAN_TIER_DEFAULT.tambahanHodPp),
    tambahanDirekturPp: n(r?.tambahan_direktur_pp ?? r?.tambahanDirekturPp, ATURAN_TIER_DEFAULT.tambahanDirekturPp),
    diskonTotalMaksPct: n(r?.diskon_total_maks_pct ?? r?.diskonTotalMaksPct, ATURAN_TIER_DEFAULT.diskonTotalMaksPct),
  };
}

// ── Diskon tambahan (seluruh SPH) ──

export type TipeDiskonTambahan = "persen" | "nominal";

export interface DiskonTambahan {
  tipe: TipeDiskonTambahan;
  nilai: number; // persen (mis. 2.5) atau Rupiah
}

// Masukan klien → bentuk sah. Kosong/0 → null (tanpa diskon tambahan).
export function bacaDiskonTambahan(x: unknown): { ok: true; d: DiskonTambahan | null } | { ok: false; error: string } {
  if (x === null || x === undefined || x === "") return { ok: true, d: null };
  if (typeof x !== "object" || Array.isArray(x)) return { ok: false, error: "diskon tambahan harus berupa {tipe, nilai}" };
  const o = x as Record<string, unknown>;
  if (o.tipe !== "persen" && o.tipe !== "nominal") return { ok: false, error: 'tipe diskon tambahan harus "persen" atau "nominal"' };
  const nilai = Number(o.nilai ?? 0);
  if (!Number.isFinite(nilai) || nilai < 0) return { ok: false, error: "nilai diskon tambahan harus angka ≥ 0" };
  if (o.tipe === "persen" && nilai >= 100) return { ok: false, error: "diskon tambahan persen harus kurang dari 100%" };
  if (nilai === 0) return { ok: true, d: null };
  return { ok: true, d: { tipe: o.tipe, nilai: o.tipe === "persen" ? Math.round(nilai * 100) / 100 : Math.round(nilai) } };
}

export function hitungDiskonTambahan(
  subtotalNett: number,
  d: DiskonTambahan | null,
): { ok: true; rp: number } | { ok: false; error: string } {
  if (!d || d.nilai <= 0) return { ok: true, rp: 0 };
  const rp = d.tipe === "persen" ? Math.round((subtotalNett * d.nilai) / 100) : Math.round(d.nilai);
  if (rp >= subtotalNett) return { ok: false, error: "diskon tambahan harus lebih kecil dari subtotal" };
  return { ok: true, rp };
}

export interface BarisTotal {
  priceList: number;
  hargaNett: number;
  nettPpn: number;
  qty: number;
}

export interface TotalSph {
  priceList: number; // Σ price list × qty
  nett: number; // Σ nett × qty (subtotal baris)
  diskonTambahan: number; // Rp
  dpp: number; // nett − diskon tambahan = dasar PPN
  ppnRp: number; // PPN 11% Rupiah
  ppn: number; // TOTAL termasuk PPN (nama lama dipertahankan — dipakai banyak layar)
}

// Tanpa diskon tambahan: total = Σ round(nett × 1,11) × qty PERSIS seperti
// sebelumnya (SPH lama tak berubah satu rupiah pun). Dengan diskon tambahan:
// PPN dihitung ulang dari DPP setelah diskon = round(dpp × 0,11) — diskon wajib
// mengurangi DPP faktur pajak (lihat 071 soal PPN dari NETT).
export function totalSph(baris: BarisTotal[], diskonRp = 0): TotalSph {
  let priceList = 0;
  let nett = 0;
  let incl = 0;
  for (const b of baris) {
    priceList += b.priceList * b.qty;
    nett += b.hargaNett * b.qty;
    incl += b.nettPpn * b.qty;
  }
  const d = Math.max(0, Math.round(diskonRp || 0));
  if (d === 0) return { priceList, nett, diskonTambahan: 0, dpp: nett, ppnRp: incl - nett, ppn: incl };
  const dpp = nett - d;
  const ppnRp = Math.round(dpp * PPN_SPH);
  return { priceList, nett, diskonTambahan: d, dpp, ppnRp, ppn: dpp + ppnRp };
}

export function diskonEfektif(priceListTotal: number, nettAkhir: number): number {
  return priceListTotal > 0 ? 1 - nettAkhir / priceListTotal : 0;
}

// Jenjang diskon tambahan: diskon efektif keseluruhan diuji terhadap batas =
// diskon efektif baris + diskonTotalMaksPct. Tanpa diskon tambahan → null.
export function tierDiskonTotal(t: TotalSph, aturan: AturanTier): (HasilTier & { efektif: number }) | null {
  if (t.diskonTambahan <= 0) return null;
  const efektif = diskonEfektif(t.priceList, t.dpp);
  const batas = diskonEfektif(t.priceList, t.nett) + aturan.diskonTotalMaksPct / 100;
  return { ...klasifikasiTier(efektif, batas, aturan), efektif };
}

// ── Teks surat (draft_text): blok tabel harga ──

export interface BarisTeks {
  nama: string;
  qty: number;
  hargaNett: number;
}

export function blokTabelHarga(items: BarisTeks[], total: TotalSph): string {
  const rows = items
    .map(
      (it, i) =>
        `| ${i + 1} | ${it.nama} | ${it.qty} | Rp${it.hargaNett.toLocaleString("id-ID")} | Rp${(it.hargaNett * it.qty).toLocaleString("id-ID")} |`,
    )
    .join("\n");
  const diskon =
    total.diskonTambahan > 0
      ? `Diskon tambahan: -Rp${total.diskonTambahan.toLocaleString("id-ID")}\n` +
        `Subtotal setelah diskon: Rp${total.dpp.toLocaleString("id-ID")}\n`
      : "";
  return (
    `| No | Produk | Qty | Harga Nett/Unit | Jumlah |\n${rows}\n\n` +
    `Subtotal Nett: Rp${total.nett.toLocaleString("id-ID")}\n` +
    diskon +
    `PPN 11% (dari nett): Rp${total.ppnRp.toLocaleString("id-ID")}\n` +
    `Total: Rp${total.ppn.toLocaleString("id-ID")}`
  );
}

// Ganti blok tabel harga di draft_text (mis. diskon tambahan diturunkan HoD
// saat review) tanpa menyentuh pengantar AI / syarat / penutup. null = blok
// tak ditemukan (teks diubah manual) → pemanggil memakai template penuh.
export function gantiBlokTabel(teks: string, blokBaru: string): string | null {
  const re = /\| No \| Produk \| Qty \|[\s\S]*?\nTotal: Rp[\d.]+/;
  if (!re.test(teks)) return null;
  return teks.replace(re, () => blokBaru);
}

// HoD boleh MENURUNKAN diskon tambahan saat review, tidak menaikkan.
export function bolehUbahDiskonTambahan(lamaRp: number, baruRp: number): boolean {
  return baruRp <= lamaRp;
}
