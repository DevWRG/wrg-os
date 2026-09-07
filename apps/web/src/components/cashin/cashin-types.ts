// Tipe bersama menu Uang Masuk (F-CASHIN). Bentuknya mengikuti balasan
// apps/api /cashin/* apa adanya supaya tak ada lapisan pemetaan kedua.

export interface CashinRingkasan {
  tanggal: string;
  uang_masuk_riil: number;
  afiliasi_grup: number;
  puteran_internal: number;
  bunga: number;
  deposito: number;
  refund: number;
  belum_ditriage: number;
  pengeluaran: number;
  non_kas_kredit: number;
  non_kas_debit: number;
  rekening_wajib: number;
  rekening_masuk: number;
  rekening_belum: string[];
  statement_perlu_review: Array<{ label_file: string; alasan: string }>;
  penerimaan_terbesar: Array<{ label_file: string; deskripsi: string; kredit: number }>;
  puteran_detail: Array<{ dari: string; ke: string; nominal: number }>;
}

export interface CashinStatement {
  id: string;
  tanggal: string;
  label_file: string;
  nama_bank: string;
  no_rekening: string | null;
  jenis: string;
  saldo_awal: string | number | null;
  saldo_akhir: string | number | null;
  total_debit_tercetak: string | number | null;
  total_kredit_tercetak: string | number | null;
  metode: string;
  status: string;
  checksum_ok: boolean | null;
  saldo_bersambung_ok: boolean | null;
  parse_error: string | null;
  dicetak_at: string | null;
  sumber: string;
  file_nama: string | null;
  jumlah_baris: number;
}

export interface CashinLine {
  id: string;
  tanggal: string;
  label_file: string;
  urut: number;
  waktu: string | null;
  deskripsi: string;
  debit: string | number;
  kredit: string | number;
  saldo: string | number | null;
  referensi: string | null;
  kategori: string;
  kategori_oleh: string;
  pasangan_line_id: string | null;
  catatan: string | null;
}

export interface CashinAccount {
  id: string;
  label_file: string;
  bank_kode: string;
  nama_bank: string;
  no_rekening: string | null;
  nama_pemilik: string | null;
  cabang: string | null;
  swift_kode: string | null;
  jenis: string;
  milik_wrg: boolean;
  wajib_harian: boolean;
  aktif: boolean;
  catatan: string | null;
}

export interface CashinKelengkapan {
  dari: string;
  sampai: string;
  rekening: string[];
  isi: Record<string, Record<string, string>>;
}

export const KATEGORI_LABEL: Record<string, string> = {
  uang_masuk_riil: "Uang masuk riil",
  afiliasi_grup: "Afiliasi grup",
  puteran_internal: "Puteran internal",
  bunga: "Bunga",
  deposito: "Deposito",
  refund: "Refund",
  biaya_pajak: "Biaya/pajak",
  pengeluaran: "Pengeluaran",
  belum_ditriage: "Belum ditriage",
};

export const JENIS_LABEL: Record<string, string> = {
  kas: "Kas",
  prk_pinjaman: "PRK / pinjaman",
  escrow: "Escrow",
  deposito: "Deposito",
};

export const rupiah = (n: number | string | null): string =>
  n == null ? "-" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
