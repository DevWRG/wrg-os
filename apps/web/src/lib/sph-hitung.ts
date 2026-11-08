// F15 — hitungan baris & ringkasan form Buat SPH (fungsi murni, diuji unit).
// Sejak migrasi 301: jenjang diskon (HoD/Direktur) & diskon tambahan SPH.
// Konvensi SAMA dengan apps/api repo/sph.ts createSphDraft: harga nett =
// round(price_list × (1 − diskon)), nett+PPN = round(nett × 1,11), jumlah per
// baris = nett × qty, total = Σ nett+PPN × qty. Server tetap menghitung ulang
// & memvalidasi — ini hanya supaya angka di layar sama dengan surat.

export const PPN_SPH = 0.11;

// ── Diskon berjenjang (salinan aturan apps/api lib/sph-diskon.ts) ──
// diskon ≤ batas SKU → normal · ≤ batas + jatah HoD → "hod" · ≤ + jatah
// Direktur → "direktur" · di atasnya → "tolak". Jatah dalam POIN persentase
// (Pengaturan SPH). Server mengklasifikasi ulang saat simpan.
export type TierDiskon = "normal" | "hod" | "direktur";
export type TierHasil = TierDiskon | "tolak";

export interface AturanTier {
  tambahanHodPp: number;
  tambahanDirekturPp: number;
  diskonTotalMaksPct: number;
}

export const ATURAN_TIER_DEFAULT: AturanTier = { tambahanHodPp: 5, tambahanDirekturPp: 10, diskonTotalMaksPct: 0 };

export const LABEL_TIER: Record<TierHasil, string> = {
  normal: "Dalam batas",
  hod: "Perlu persetujuan HoD",
  direktur: "Perlu persetujuan Direktur",
  tolak: "Melebihi batas",
};

const EPS = 1e-9;
const persen = (f: number) => `${(Math.round(f * 10000) / 100).toLocaleString("id-ID")}%`;

export function klasifikasiTier(
  diskon: number,
  batas: number,
  aturan: AturanTier,
): { tier: TierHasil; alasan: string; batasHod: number; batasDirektur: number } {
  const batasHod = batas + aturan.tambahanHodPp / 100;
  const batasDirektur = Math.min(batasHod + aturan.tambahanDirekturPp / 100, 1 - 1e-4);
  const b = { batasHod, batasDirektur };
  if (!Number.isFinite(diskon) || diskon < 0) return { ...b, tier: "tolak", alasan: "Diskon tidak boleh negatif" };
  if (diskon <= batas + EPS) return { ...b, tier: "normal", alasan: `Dalam batas ${persen(batas)}` };
  if (diskon <= batasHod + EPS) return { ...b, tier: "hod", alasan: `Di atas batas ${persen(batas)} — perlu persetujuan HoD Business (maks. ${persen(batasHod)})` };
  if (diskon <= batasDirektur + EPS) {
    return { ...b, tier: "direktur", alasan: `Di atas ${persen(batasHod)} — perlu persetujuan Direktur (maks. ${persen(batasDirektur)})` };
  }
  return { ...b, tier: "tolak", alasan: `Melebihi batas tertinggi ${persen(batasDirektur)} — turunkan diskon` };
}

const URUT: Record<TierHasil, number> = { normal: 0, hod: 1, direktur: 2, tolak: 3 };
export function tierTertinggi(...t: TierHasil[]): TierHasil {
  return t.reduce<TierHasil>((a, x) => (URUT[x] > URUT[a] ? x : a), "normal");
}

export interface BarisInput {
  priceList: number;
  diskonMaks: number; // fraksi, mis. 0.10 — batas EFEKTIF (Setup Harga terbit)
  qty: number;
  diskonPersen: number; // persen yang diketik, mis. 7.5
}

export interface BarisHasil {
  hargaNett: number;
  nettPpn: number;
  jumlah: number; // nett × qty
  jumlahPpn: number; // nett+PPN × qty
  /** Pesan masalah (bahasa pengguna) — null = baris sah. */
  masalahQty: string | null;
  masalahDiskon: string | null;
  /** Jenjang persetujuan (hanya bila aturan diberikan; tanpa aturan = normal/tolak). */
  tier: TierHasil;
  alasanTier: string;
}

// `aturan` null = mode lama (tanpa jenjang): di atas batas = masalah.
export function hitungBaris(b: BarisInput, aturan: AturanTier | null = null): BarisHasil {
  const qtySah = Number.isInteger(b.qty) && b.qty > 0;
  const d = Number.isFinite(b.diskonPersen) ? b.diskonPersen / 100 : 0;
  let masalahDiskon: string | null = null;
  let tier: TierHasil = "normal";
  let alasanTier = `Dalam batas ${persen(b.diskonMaks)}`;
  if (d < 0) {
    masalahDiskon = "Diskon tidak boleh negatif";
    tier = "tolak";
    alasanTier = masalahDiskon;
  } else if (aturan) {
    const t = klasifikasiTier(d, b.diskonMaks, aturan);
    tier = t.tier;
    alasanTier = t.alasan;
    if (t.tier === "tolak") masalahDiskon = t.alasan;
  } else if (d > b.diskonMaks + EPS) {
    masalahDiskon = `Maks. diskon ${persen(b.diskonMaks)} untuk produk ini`;
    tier = "tolak";
    alasanTier = masalahDiskon;
  }
  // Angka di layar memakai diskon yang DIMINTA (bukan dipotong ke batas) agar
  // pengguna melihat persis apa yang ia ketik; baris bermasalah ditandai.
  const dPakai = Math.max(d, 0);
  const hargaNett = Math.round(b.priceList * (1 - dPakai));
  const nettPpn = Math.round(hargaNett * (1 + PPN_SPH));
  const q = qtySah ? b.qty : 0;
  return {
    hargaNett,
    nettPpn,
    jumlah: hargaNett * q,
    jumlahPpn: nettPpn * q,
    masalahQty: qtySah ? null : "Qty harus bilangan bulat minimal 1",
    masalahDiskon,
    tier,
    alasanTier,
  };
}

// ── Diskon tambahan (seluruh SPH) ──
export type TipeDiskonTambahan = "persen" | "nominal";
export interface DiskonTambahan {
  tipe: TipeDiskonTambahan;
  nilai: number; // persen (mis. 2.5) atau Rupiah
}

export function hitungDiskonTambahan(subtotal: number, d: DiskonTambahan | null): { rp: number; masalah: string | null } {
  if (!d || !Number.isFinite(d.nilai) || d.nilai === 0) return { rp: 0, masalah: null };
  if (d.nilai < 0) return { rp: 0, masalah: "Diskon tambahan tidak boleh negatif" };
  if (d.tipe === "persen" && d.nilai >= 100) return { rp: 0, masalah: "Diskon tambahan harus kurang dari 100%" };
  // Sama persis dgn server: nilai persen dibulatkan 2 desimal dulu.
  const rp = d.tipe === "persen" ? Math.round((subtotal * (Math.round(d.nilai * 100) / 100)) / 100) : Math.round(d.nilai);
  if (rp >= subtotal) return { rp: 0, masalah: "Diskon tambahan harus lebih kecil dari subtotal" };
  return { rp, masalah: null };
}

export interface Ringkasan {
  priceList: number; // Σ price list × qty
  subtotal: number; // Σ nett × qty
  diskonTambahan: number; // Rp
  dpp: number; // subtotal − diskon tambahan
  ppn: number; // PPN Rupiah (total − dpp)
  total: number; // incl. PPN
  hemat: number; // Σ (price list − nett) × qty + diskon tambahan
  adaMasalah: boolean;
  diskonEfektif: number; // 1 − dpp / priceList
  tierTambahan: TierHasil; // jenjang diskon tambahan (normal bila tak ada)
  alasanTambahan: string | null;
  masalahTambahan: string | null;
  tier: TierHasil; // jenjang dokumen (tertinggi)
}

// Tanpa diskon tambahan total = Σ nett+PPN × qty (persis server). Dengan diskon
// tambahan PPN dihitung ulang dari DPP: round(dpp × 0,11) — sama totalSph() api.
export function ringkasSph(
  baris: (BarisInput & { hasil?: BarisHasil })[],
  opsi: { aturan?: AturanTier | null; diskonTambahan?: DiskonTambahan | null } = {},
): Ringkasan {
  const aturan = opsi.aturan ?? null;
  let priceList = 0;
  let subtotal = 0;
  let incl = 0;
  let hemat = 0;
  let adaMasalah = false;
  const tiers: TierHasil[] = [];
  for (const b of baris) {
    const h = b.hasil ?? hitungBaris(b, aturan);
    const q = h.masalahQty ? 0 : b.qty;
    priceList += b.priceList * q;
    subtotal += h.jumlah;
    incl += h.jumlahPpn;
    hemat += (b.priceList - h.hargaNett) * q;
    tiers.push(h.tier);
    if (h.masalahQty || h.masalahDiskon) adaMasalah = true;
  }
  const dt = hitungDiskonTambahan(subtotal, opsi.diskonTambahan ?? null);
  let tierTambahan: TierHasil = "normal";
  let alasanTambahan: string | null = null;
  let dpp = subtotal;
  let total = incl;
  if (dt.rp > 0) {
    dpp = subtotal - dt.rp;
    total = dpp + Math.round(dpp * PPN_SPH);
    hemat += dt.rp;
    const a = aturan ?? ATURAN_TIER_DEFAULT;
    const efektifBaris = priceList > 0 ? 1 - subtotal / priceList : 0;
    const efektif = priceList > 0 ? 1 - dpp / priceList : 0;
    const t = klasifikasiTier(efektif, efektifBaris + a.diskonTotalMaksPct / 100, a);
    tierTambahan = t.tier;
    alasanTambahan = `Diskon efektif ${persen(efektif)} · ${t.alasan}`;
  }
  if (dt.masalah || tierTambahan === "tolak") adaMasalah = true;
  return {
    priceList,
    subtotal,
    diskonTambahan: dt.rp,
    dpp,
    ppn: total - dpp,
    total,
    hemat,
    adaMasalah,
    diskonEfektif: priceList > 0 ? 1 - dpp / priceList : 0,
    tierTambahan,
    alasanTambahan,
    masalahTambahan: dt.masalah ?? (tierTambahan === "tolak" ? alasanTambahan : null),
    tier: tierTertinggi(...tiers, tierTambahan),
  };
}

// ── Pratinjau nomor surat (halaman Pengaturan SPH) ──
// Salinan aturan apps/api lib/sph-cetak.ts (formatNomorSph + ambilNomor +
// kodeTengahSah) supaya pratinjau berubah seketika saat admin mengetik.
// Nomor sesungguhnya tetap diberikan server saat approve.
const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export const kodeTengahSah = (kode: string) => /^[A-Za-z0-9][A-Za-z0-9.-]{0,29}$/.test(kode);
export const nomorUrutSah = (n: number) => Number.isInteger(n) && n >= 1 && n <= 9_999_999;

export function pratinjauNomorSph(
  s: { kodeTengah: string; nomorBerikutnya: number; resetTahunan: boolean; tahunBerjalan: number | null },
  sekarang: Date = new Date(),
): { nomor: string | null; masalah: string | null } {
  const kode = s.kodeTengah.trim();
  if (!kodeTengahSah(kode)) return { nomor: null, masalah: "Kode tengah hanya huruf, angka, titik, atau strip (maks. 30), tanpa garis miring" };
  if (!nomorUrutSah(s.nomorBerikutnya)) return { nomor: null, masalah: "Nomor berikutnya harus bilangan bulat 1 – 9.999.999" };
  const w = new Date(sekarang.getTime() + 7 * 3600 * 1000); // WIB
  const tahun = w.getUTCFullYear();
  const bulan = w.getUTCMonth() + 1;
  const ganti = s.resetTahunan && s.tahunBerjalan !== null && s.tahunBerjalan !== tahun;
  const urut = ganti ? 1 : s.nomorBerikutnya;
  return { nomor: `${String(urut).padStart(5, "0")}/${kode}/${ROMAWI[bulan - 1]}/${tahun}`, masalah: null };
}
