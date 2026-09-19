// Bentuk muatan /picform/pohon dan /picform/koordinasi.
//
// Ditulis ulang di sisi web (bukan di-import dari apps/api) mengikuti pola yang
// sudah dipakai koordinasi-view.tsx: web berbicara ke API lewat HTTP, jadi
// tipenya adalah kontrak muatan, bukan tipe internal repo. Kalau salah satu
// berubah, yang menangkapnya adalah endpoint-nya — bukan tsc lintas paket.

export interface PohonTugas {
  id: number;
  uraian: string;
  frekuensi: string | null;
  frekuensi_raw: string | null;
  pj_key: string | null;
  pj_raw: string | null;
  kpi_target: string | null;
  rules: string | null;
}
export interface PohonPosisi {
  id: number;
  nama: string;
  jumlah_orang: number | null;
  level_raw: string | null;
  catatan: string | null;
  tugas: PohonTugas[];
}
export interface PohonLangkah {
  id: number;
  seq: number;
  langkah: string;
  kondisi: string | null;
  target_level: string | null;
  catatan: string | null;
}
export interface PohonSop {
  id: number;
  nama: string;
  langkah: PohonLangkah[];
}
export interface PohonDivisi {
  key: string;
  label: string;
  pic_nama: string | null;
  hod_nama: string | null;
  posisi: PohonPosisi[];
  sop: PohonSop[];
}
export interface PohonPekerjaan {
  ringkas: { divisi: number; posisi: number; tugas: number; sop: number; langkah: number };
  divisi: PohonDivisi[];
}

export interface KoordNode {
  id: string;
  label: string;
  grup: string;
  keluar: number;
  masuk: number;
  derajat: number;
}
/** Satu pernyataan koordinasi apa adanya dari Tabel C form PIC.
 *
 *  `apa` (ISI komunikasinya) dan `pemicu` (KAPAN/KARENA APA ia terjadi) sengaja
 *  terpisah — lihat RinciKoord di apps/api/src/repo/picform.ts. Keduanya terisi
 *  di seluruh 126 baris; menampilkan `apa` saja berarti membuang setengah model
 *  komunikasinya. */
export interface RinciKoord {
  apa: string | null;
  pemicu: string | null;
  /** posisi yang menyatakan — hanya ada di level divisi */
  dari?: string;
}
export interface KoordEdge {
  from: string;
  to: string;
  bobot: number;
  rinci: RinciKoord[];
}
export interface KoordEdgeDivisi {
  from: string;
  to: string;
  bobot: number;
  bolak_balik: boolean;
  sepihak: boolean;
  rinci: RinciKoord[];
}
export interface KoordGraf {
  ringkas: {
    node: number;
    edge: number;
    baris: number;
    internal: number;
    external: number;
    tak_terklasifikasi: number;
    pasangan_divisi: number;
    pasangan_bolak_balik: number;
    pasangan_sepihak: number;
  };
  nodes: KoordNode[];
  edges: KoordEdge[];
  edges_divisi: KoordEdgeDivisi[];
}
