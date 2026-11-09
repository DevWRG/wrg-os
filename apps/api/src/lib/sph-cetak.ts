// F15 SPH — fungsi murni untuk dokumen cetak (nomor surat, tanggal WIB,
// terbilang, syarat & ketentuan). Tanpa DB, diuji unit (sph-cetak.test.ts).
// Query & penguncian nomor ada di repo/sph.ts; PDF di repo/sph-pdf.ts.

// ── Nomor surat ──────────────────────────────────────────────────
// Format perusahaan: <urut 5 digit>/<kode tengah>/<bulan Romawi>/<tahun>,
// mis. 00042/WRG.PN-PNA/VII/2026. Kode tengah & nomor urut berikutnya diatur
// admin (tabel sph_pengaturan, migrasi 300) supaya penomoran bisa MELANJUTKAN
// urutan manual yang sedang berjalan, bukan mulai dari 1.

const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function bulanRomawi(bulan: number): string {
  const r = ROMAWI[bulan - 1];
  if (!Number.isInteger(bulan) || !r) throw new Error(`bulan ${bulan} di luar 1-12`);
  return r;
}

export const KODE_TENGAH_DEFAULT = "WRG.PN-PNA";

// Garis miring adalah pemisah bagian nomor — dilarang di kode tengah, kalau
// tidak nomor bisa dibaca dengan jumlah bagian yang salah.
export function kodeTengahSah(kode: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.-]{0,29}$/.test(kode);
}

export const NOMOR_MAKS = 9_999_999;

export function nomorUrutSah(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= NOMOR_MAKS;
}

export function formatNomorSph(urut: number, kodeTengah: string, bulan: number, tahun: number): string {
  if (!nomorUrutSah(urut)) throw new Error(`nomor urut ${urut} tak sah`);
  return `${String(urut).padStart(5, "0")}/${kodeTengah}/${bulanRomawi(bulan)}/${tahun}`;
}

export interface StateNomor {
  nomorBerikutnya: number;
  resetTahunan: boolean;
  // Tahun nomor terakhir diberikan. null = belum pernah memberi nomor.
  tahunBerjalan: number | null;
}

// Nomor yang dipakai sekarang + state sesudahnya. Default kebijakan: TIDAK
// reset (urut terus lintas tahun). Bila reset_tahunan dinyalakan, nomor
// pertama di tahun baru = 1. Tahun pertama kali (tahunBerjalan null) tidak
// dianggap pergantian tahun — nomor yang diset admin dipakai apa adanya.
export function ambilNomor(state: StateNomor, tahun: number): { dipakai: number; sesudah: StateNomor } {
  const ganti = state.resetTahunan && state.tahunBerjalan !== null && state.tahunBerjalan !== tahun;
  const dipakai = ganti ? 1 : state.nomorBerikutnya;
  return { dipakai, sesudah: { ...state, nomorBerikutnya: dipakai + 1, tahunBerjalan: tahun } };
}

// ── Tanggal (WIB) ────────────────────────────────────────────────
const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export interface TanggalWib { tahun: number; bulan: number; hari: number }

// WIB = UTC+7 tanpa DST. Sengaja tak memakai zona server: SPH yang disetujui
// pukul 00.30 WIB tanggal 1 harus bernomor bulan baru, bukan bulan lalu (UTC).
export function tanggalWib(d: Date): TanggalWib {
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  return { tahun: w.getUTCFullYear(), bulan: w.getUTCMonth() + 1, hari: w.getUTCDate() };
}

export function tanggalIndo(d: Date): string {
  const t = tanggalWib(d);
  return `${t.hari} ${BULAN_ID[t.bulan - 1]} ${t.tahun}`;
}

// ── Terbilang ────────────────────────────────────────────────────
const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

function bilang(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${bilang(n - 10)} belas`;
  if (n < 100) return `${bilang(Math.floor(n / 10))} puluh ${bilang(n % 10)}`;
  if (n < 200) return `seratus ${bilang(n - 100)}`;
  if (n < 1000) return `${bilang(Math.floor(n / 100))} ratus ${bilang(n % 100)}`;
  if (n < 2000) return `seribu ${bilang(n - 1000)}`;
  const skala: [number, string][] = [
    [1e12, "triliun"], [1e9, "miliar"], [1e6, "juta"], [1e3, "ribu"],
  ];
  for (const [nilai, nama] of skala) {
    if (n >= nilai) return `${bilang(Math.floor(n / nilai))} ${nama} ${bilang(n % nilai)}`;
  }
  return "";
}

/** Bilangan bulat ≥ 0 → kata Bahasa Indonesia ("seribu dua ratus lima"). */
export function terbilang(n: number): string {
  const x = Math.round(n);
  if (!Number.isFinite(x) || x < 0) throw new Error(`terbilang: ${n} tak didukung`);
  if (x >= 1e15) throw new Error(`terbilang: ${n} terlalu besar`);
  if (x === 0) return "nol";
  return bilang(x).replace(/\s+/g, " ").trim();
}

/** "Satu juta dua ratus ribu rupiah" — huruf besar di awal, untuk baris Terbilang. */
export function terbilangRupiah(n: number): string {
  const t = `${terbilang(n)} rupiah`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Syarat & ketentuan ───────────────────────────────────────────
export interface SyaratSph {
  pembayaran: string;
  pengiriman: string;
  masaBerlaku: string;
  harga: string;
}

export const KUNCI_SYARAT = ["pembayaran", "pengiriman", "masaBerlaku", "harga"] as const;

export const LABEL_SYARAT: Record<keyof SyaratSph, string> = {
  pembayaran: "Pembayaran",
  pengiriman: "Pengiriman",
  masaBerlaku: "Masa berlaku",
  harga: "Harga",
};

// Cadangan bila baris sph_pengaturan belum ada. Nilai yang berlaku diambil
// dari sph_pengaturan.syarat_default (bisa diubah admin). `harga` mengikuti cara
// total dicetak: harga satuan & subtotal = nett TANPA PPN, PPN 11% dicetak
// terpisah, Total = termasuk PPN.
export const SYARAT_DEFAULT: SyaratSph = {
  pembayaran: "30 hari setelah faktur diterima",
  pengiriman: "Franco gudang customer",
  masaBerlaku: "14 hari sejak tanggal penawaran",
  harga: "Harga satuan belum termasuk PPN; PPN 11% dicantumkan terpisah pada total",
};

export const SYARAT_MAKS = 300;

/**
 * Gabung berlapis: dasar ← timpa1 ← timpa2 … Nilai kosong/bukan teks diabaikan
 * (tidak menghapus nilai di bawahnya), dirapikan spasinya, dipotong SYARAT_MAKS.
 */
export function gabungSyarat(dasar: SyaratSph, ...timpa: (Partial<Record<string, unknown>> | null | undefined)[]): SyaratSph {
  const out: SyaratSph = { ...dasar };
  for (const t of timpa) {
    if (!t || typeof t !== "object") continue;
    for (const k of KUNCI_SYARAT) {
      const v = t[k];
      if (typeof v !== "string") continue;
      const s = v.replace(/\s+/g, " ").trim().slice(0, SYARAT_MAKS);
      if (s) out[k] = s;
    }
  }
  return out;
}

/** Input lama form /sph/new ({paymentTerms, shippingTerms, validityDays}) → SyaratSph parsial. */
export function syaratDariInputLama(t: { paymentTerms?: string; shippingTerms?: string; validityDays?: number } | null | undefined): Partial<SyaratSph> {
  if (!t) return {};
  const out: Partial<SyaratSph> = {};
  if (t.paymentTerms) out.pembayaran = t.paymentTerms;
  if (t.shippingTerms) out.pengiriman = t.shippingTerms;
  if (Number.isInteger(t.validityDays) && (t.validityDays as number) > 0) {
    out.masaBerlaku = `${t.validityDays} hari sejak tanggal penawaran`;
  }
  return out;
}

// ── Teks surat (draft_text) ──────────────────────────────────────
// draft_text tetap dipakai pratinjau Sales Docs & kirim WA. Bagian kepala
// (Nomor/Tanggal) dan kaki (Syarat + penanda tangan) ditulis sistem dengan pola
// tetap (repo/sph.ts letterHeader/letterFooter), jadi bisa diganti tanpa
// menyentuh kalimat pengantar & tabel di tengah.

export const NOMOR_DRAF = "DRAF - belum bernomor";

export interface PenandaTangan { nama: string; jabatan: string | null }

export function kakiSurat(syarat: SyaratSph, ttd?: PenandaTangan | null): string {
  const baris = KUNCI_SYARAT.map((k) => `- ${LABEL_SYARAT[k]}: ${syarat[k]}`).join("\n");
  const nama = ttd?.nama ? `\n\n${ttd.nama}${ttd.jabatan ? `\n${ttd.jabatan}` : ""}` : "";
  return `\nSyarat & Ketentuan:\n${baris}\n\nHormat kami,\nPT Wahana Rizky Gumilang${nama}\n`;
}

export function perbaruiTeksSph(
  teks: string,
  p: { nomor?: string | null; tanggal?: string | null; syarat?: SyaratSph | null; ttd?: PenandaTangan | null },
): string {
  let out = teks;
  if (p.nomor || p.tanggal) {
    out = out.replace(/^Nomor: (.*?) \| Tanggal: (.*)$/m, (_m, nomor: string, tgl: string) =>
      `Nomor: ${p.nomor ?? nomor} | Tanggal: ${p.tanggal ?? tgl}`);
  }
  if (p.syarat) {
    const i = out.lastIndexOf("\nSyarat & Ketentuan:");
    out = (i >= 0 ? out.slice(0, i) : out.replace(/\n+$/, "\n")) + kakiSurat(p.syarat, p.ttd);
  }
  return out;
}
