// F15 — hitungan baris & ringkasan form Buat SPH (fungsi murni, diuji unit).
// Konvensi SAMA dengan apps/api repo/sph.ts createSphDraft: harga nett =
// round(price_list × (1 − diskon)), nett+PPN = round(nett × 1,11), jumlah per
// baris = nett × qty, total = Σ nett+PPN × qty. Server tetap menghitung ulang
// & memvalidasi — ini hanya supaya angka di layar sama dengan surat.

export const PPN_SPH = 0.11;

export interface BarisInput {
  priceList: number;
  diskonMaks: number; // fraksi, mis. 0.10
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
}

const persen = (f: number) => `${Math.round(f * 10000) / 100}%`;

export function hitungBaris(b: BarisInput): BarisHasil {
  const qtySah = Number.isInteger(b.qty) && b.qty > 0;
  const d = Number.isFinite(b.diskonPersen) ? b.diskonPersen / 100 : 0;
  let masalahDiskon: string | null = null;
  if (d < 0) masalahDiskon = "Diskon tidak boleh negatif";
  else if (d > b.diskonMaks + 1e-9) masalahDiskon = `Maks. diskon ${persen(b.diskonMaks)} untuk produk ini`;
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
  };
}

export interface Ringkasan {
  subtotal: number; // Σ nett × qty
  ppn: number; // total − subtotal
  total: number; // Σ nett+PPN × qty
  hemat: number; // Σ (price list − nett) × qty
  adaMasalah: boolean;
}

export function ringkasSph(baris: (BarisInput & { hasil?: BarisHasil })[]): Ringkasan {
  let subtotal = 0;
  let total = 0;
  let hemat = 0;
  let adaMasalah = false;
  for (const b of baris) {
    const h = b.hasil ?? hitungBaris(b);
    subtotal += h.jumlah;
    total += h.jumlahPpn;
    hemat += (b.priceList - h.hargaNett) * (h.masalahQty ? 0 : b.qty);
    if (h.masalahQty || h.masalahDiskon) adaMasalah = true;
  }
  return { subtotal, ppn: total - subtotal, total, hemat, adaMasalah };
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
