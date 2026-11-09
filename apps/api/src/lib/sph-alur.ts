// F15 — "aksi apa yang boleh saya lakukan di SPH ini" (fungsi murni, diuji unit).
//
// Dipakai layar daftar & detail SPH supaya UI tidak menebak-nebak izin: tombol
// yang tampil, tombol yang mati + ALASANnya, dan petunjuk "langkah berikut".
// Ini HANYA penjelas untuk layar — gerbang sesungguhnya tetap di route aksi
// (BFF requireFeature + apps/api hodReviewSph / approveSalesDoc / dst.), dan
// aturannya sengaja disalin dari sana tanpa diubah:
//   · review tahap 1 (draft → hod_review): HoD Business aktif / admin /
//     superuser, BUKAN pembuat (bolehReviewSph);
//   · approve tahap 2 (hod_review → approved, beri nomor): izin edit Sales Docs,
//     BUKAN pembuat, semua baris nama-kembar sudah dikonfirmasi;
//   · konfirmasi varian & ganti penanda tangan: edit Sales Docs, bukan pembuat;
//   · kirim (approved → sent): edit Sales Docs, ke kontak WA customer;
//   · batalkan: edit Sales Docs, selama belum terkirim/dibatalkan;
//   · ubah syarat: edit Sales Docs, selama draft/hod_review.
//   · persetujuan Direktur (diskon jenjang "direktur", migrasi 301): status
//     hod_review, role direktur / superuser, BUKAN pembuat; selama belum ada,
//     approve tahap 2 tertahan (lib/sph-diskon.ts).

import type { TierDiskon } from "./sph-diskon.js";

export type StatusSph = "draft" | "hod_review" | "approved" | "sent" | "canceled";

export interface PutusanAksi {
  boleh: boolean;
  alasan: string | null; // diisi bila boleh=false (atau untuk penjelas)
}

export interface InputAksiSph {
  status: string;
  isCreator: boolean;
  /** HoD Business aktif, admin, atau superuser — syarat peran review tahap 1. */
  bolehReviewPeran: boolean;
  /** Izin edit menu Sales Docs (matriks Akses Grup). */
  bisaEdit: boolean;
  /** Jumlah baris nama-varian-kembar yang belum dikonfirmasi. */
  variantPending: number;
  /** Jenjang persetujuan diskon SPH (sales_doc.tier_persetujuan). Kosong = normal. */
  tier?: TierDiskon;
  /** Direktur sudah menyetujui (sales_doc.direktur_approved_at terisi). */
  direkturSudah?: boolean;
  /** role direktur atau superuser — syarat peran persetujuan Direktur. */
  bolehDirekturPeran?: boolean;
}

export interface AksiSph {
  review: PutusanAksi;
  approve: PutusanAksi;
  konfirmasiVarian: PutusanAksi;
  gantiTtd: PutusanAksi;
  kirim: PutusanAksi;
  batal: PutusanAksi;
  ubahSyarat: PutusanAksi;
  /** Persetujuan Direktur atas diskon jenjang "direktur". */
  direktur: PutusanAksi;
  /** true = SPH ini butuh persetujuan Direktur dan belum disetujui. */
  direkturPending: boolean;
  /** Aksi utama untuk penonton ini (null = tak ada yang perlu ia lakukan). */
  utama: "review" | "direktur" | "approve" | "konfirmasiVarian" | "kirim" | null;
  /** Petunjuk satu baris untuk daftar/detail, sudut pandang penonton. */
  petunjuk: string;
  /** true = ada yang perlu dikerjakan penonton ini sekarang. */
  perluAksiSaya: boolean;
}

const ya: PutusanAksi = { boleh: true, alasan: null };
const tidak = (alasan: string): PutusanAksi => ({ boleh: false, alasan });

export const LABEL_STATUS_SPH: Record<StatusSph, string> = {
  draft: "Menunggu Review",
  hod_review: "Menunggu Approve",
  approved: "Disetujui",
  sent: "Terkirim",
  canceled: "Dibatalkan",
};

export function aksiSph(i: InputAksiSph): AksiSph {
  const s = i.status;
  const tanpaEdit = "Butuh izin ubah (edit) menu Sales Docs";
  const tier = i.tier ?? "normal";
  const perluDirektur = tier === "direktur";
  const direkturPending = perluDirektur && !i.direkturSudah && (s === "draft" || s === "hod_review");

  let direktur: PutusanAksi;
  if (!perluDirektur) direktur = tidak("Diskon SPH ini tidak perlu persetujuan Direktur");
  else if (i.direkturSudah) direktur = tidak("Sudah disetujui Direktur");
  else if (s === "draft") direktur = tidak("Tunggu review HoD Business dulu");
  else if (s !== "hod_review") direktur = tidak("SPH sudah tidak menunggu persetujuan");
  else if (i.isCreator) direktur = tidak("Anda pembuat SPH ini — persetujuan harus oleh Direktur lain");
  else if (!i.bolehDirekturPeran) direktur = tidak("Persetujuan diskon ini hanya untuk Direktur");
  else direktur = ya;

  let review: PutusanAksi;
  if (s !== "draft") review = tidak("Hanya untuk SPH yang menunggu review");
  else if (i.isCreator) review = tidak("Anda pembuat SPH ini — review harus oleh HoD Business lain");
  else if (!i.bolehReviewPeran) review = tidak("Review tahap 1 hanya untuk HoD Business (atau admin)");
  else review = ya;

  const finalPembuat = "Anda pembuat SPH ini — approve harus oleh orang lain";
  let approve: PutusanAksi;
  if (s !== "hod_review") approve = tidak(s === "draft" ? "Tunggu review HoD Business dulu" : "Hanya untuk SPH yang menunggu approve");
  else if (i.isCreator) approve = tidak(finalPembuat);
  else if (direkturPending) approve = tidak("Tunggu persetujuan Direktur atas diskon di atas batas");
  else if (!i.bisaEdit) approve = tidak(tanpaEdit);
  else if (i.variantPending > 0) approve = tidak(`Konfirmasi ${i.variantPending} item nama-kembar dulu`);
  else approve = ya;

  let konfirmasiVarian: PutusanAksi;
  if (i.variantPending === 0) konfirmasiVarian = tidak("Tak ada item yang perlu dikonfirmasi");
  else if (s !== "draft" && s !== "hod_review") konfirmasiVarian = tidak("SPH sudah tidak bisa diubah");
  else if (i.isCreator) konfirmasiVarian = tidak("Anda pembuat SPH ini — konfirmasi harus oleh orang lain");
  else if (!i.bisaEdit) konfirmasiVarian = tidak(tanpaEdit);
  else konfirmasiVarian = ya;

  let gantiTtd: PutusanAksi;
  if (s !== "approved") gantiTtd = tidak("Penanda tangan dipilih saat approve");
  else if (i.isCreator) gantiTtd = tidak("Anda pembuat SPH ini — penanda tangan diatur approver");
  else if (!i.bisaEdit) gantiTtd = tidak(tanpaEdit);
  else gantiTtd = ya;

  let kirim: PutusanAksi;
  if (s !== "approved") kirim = tidak(s === "sent" ? "Sudah terkirim" : "SPH harus disetujui (bernomor) dulu");
  else if (!i.bisaEdit) kirim = tidak(tanpaEdit);
  else kirim = ya;

  let batal: PutusanAksi;
  if (s === "sent") batal = tidak("SPH sudah terkirim, tak bisa dibatalkan");
  else if (s === "canceled") batal = tidak("SPH sudah dibatalkan");
  else if (!i.bisaEdit) batal = tidak(tanpaEdit);
  else batal = ya;

  let ubahSyarat: PutusanAksi;
  if (s !== "draft" && s !== "hod_review") ubahSyarat = tidak("Syarat terkunci setelah SPH disetujui");
  else if (!i.bisaEdit) ubahSyarat = tidak(tanpaEdit);
  else ubahSyarat = ya;

  let utama: AksiSph["utama"] = null;
  let petunjuk: string;
  if (s === "draft") {
    if (review.boleh) {
      utama = "review";
      petunjuk = tier === "normal" ? "Perlu review Anda" : "Perlu review Anda · diskon di atas batas";
    } else petunjuk = perluDirektur ? "Menunggu review HoD · lalu persetujuan Direktur" : "Menunggu review HoD Business";
  } else if (s === "hod_review") {
    if (direktur.boleh) {
      utama = "direktur";
      petunjuk = "Perlu persetujuan Direktur (Anda)";
    } else if (approve.boleh) {
      utama = "approve";
      petunjuk = "Perlu approve Anda";
    } else if (konfirmasiVarian.boleh) {
      // Varian boleh dikonfirmasi paralel selagi menunggu Direktur.
      utama = "konfirmasiVarian";
      petunjuk = "Perlu konfirmasi varian";
    } else if (direkturPending) {
      petunjuk = "Perlu persetujuan Direktur";
    } else petunjuk = "Menunggu approve & nomor surat";
  } else if (s === "approved") {
    if (kirim.boleh) {
      utama = "kirim";
      petunjuk = "Siap dikirim ke customer";
    } else petunjuk = "Disetujui — menunggu dikirim";
  } else if (s === "sent") petunjuk = "Sudah terkirim ke customer";
  else if (s === "canceled") petunjuk = "Dibatalkan";
  else petunjuk = s;

  return {
    review,
    approve,
    konfirmasiVarian,
    gantiTtd,
    kirim,
    batal,
    ubahSyarat,
    direktur,
    direkturPending,
    utama,
    petunjuk,
    perluAksiSaya: utama !== null,
  };
}

// Kata kunci pencarian daftar SPH → pola ILIKE aman. `%`, `_` dan `\`
// di-escape supaya ketikan pengguna tak menjadi wildcard (pelajaran uji batch
// magang: ILIKE tanpa escape = "_" mencocokkan semua). Kosong → null.
export function polaCariSph(q: string | null | undefined): string | null {
  const s = String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
