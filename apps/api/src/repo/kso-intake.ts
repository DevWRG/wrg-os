// F170 Komite KSO — intake WhatsApp #KSO.
//
// AM mengirim rencana KSO lewat bot WA yang sudah ada (keputusan 16 Okt: nomor bot sekarang,
// semua perintah lewat #KSO supaya tak bentrok dengan #KIRIM dan konfirmasi "kirim R12").
// Sejak 10 Nov 2026 (keputusan product owner) usulan baru HANYA lewat format sembilan isian
// (lihat kso-format.ts), diurai DETERMINISTIK — jalur teks bebas (LLM /kso/ekstrak) dan voice note dimatikan:
//   #KSO BUDI + 9 baris berlabel       → draft baru (nama di kepala = nama pengirim)
//   #KSO D12 LABEL: isi                → melengkapi / mengoreksi draft (PENDUKUNG, STATUS UNIT, ALASAN, KLAUSUL, …)
//   #KSO D12 (+ PDF ≤ 10 menit)        → lampiran PDF Simulator CPRR untuk D12
//   #KSO ALAT 1 / #KSO ALAT: Z50       → memilih alat untuk isian yang tertunda (alat tak pasti di katalog)
//   #KSO kirim D12                     → mengajukan (DRAFT → DIAJUKAN → zona AM / 2 HOD / forum)
//   #KSO kelonggaran KSO-2026-0012 …   → minta kelonggaran (penawaran sudah terbit)
//   #KSO kalah KSO-2026-0012 …         → catat kalah
//   #KSO D12 volume 900                → volume RS turun sesudah mandat terbit
// Data lengkap + lampiran PDF cocok → diajukan OTOMATIS (sama dengan "#KSO kirim").
//
// Semua tulis lewat kso.app_bot_* dengan peran bot_wa (GUC wrg.kso_user di transaksi yang
// sama) — bukan akses tabel langsung. AM ditentukan dari pengirim (resolveSender ketat),
// TIDAK PERNAH dari isi pesan; nama di kepala pesan hanya DICOCOKKAN dengan pengirim.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { TransactionSql } from "postgres";
import { db } from "../db.js";
import { callAi } from "../ai.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { cariAkun } from "./interaction.js";
import {
  NAMA_LABEL, bacaBarisLabel, bacaIsianFormat, bacaPilihanFaskes, bedaDariCocok, bentukNama, cariAlat, cocokkanLampiran, daftarKurang,
  isianLengkapiDariFormat, namaCocok, putuskanFaskes, teksGalatOcr,
  type AlatKatalog, type CocokIsian, type DataKurang, type FaskesKatalog, type HasilAlat, type HasilFaskes, type HasilOcrCprr, type IsianFormat,
  type ItemKurang, type SaranAlat, type SaranFaskes,
} from "./kso-format.js";
import { NAMA_GERBANG, alasanGerbang } from "./kso-saring.js";

export const KSO_LINE = /^\s*#\s*kso\b/i;
export const KSO_BOT_USER = "bot-wa";
/** Jendela pemasangan lampiran PDF ↔ pesan #KSO di chat yang sama (pengirim sama, urutan bebas). */
export const KSO_JENDELA_MENIT = 10;
/** Nama lama (dipakai pemasangan voice note sebelum 10 Nov) — kini jendela lampiran PDF. */
export const KSO_JENDELA_SUARA_MENIT = KSO_JENDELA_MENIT;

export function ksoWaAktif(): boolean {
  return (process.env.KSO_WA_ENABLED ?? "").toLowerCase() === "true";
}

// ---------------------------------------------------------------- pengurai perintah (murni)

export type KsoAksi = "baru" | "lengkapi" | "kirim" | "kelonggaran" | "kalah" | "kosong";
export interface KsoPerintah {
  aksi: KsoAksi;
  draftId?: number;
  nomor?: string;
  isi: string;
  /** Nama di kepala "#KSO BUDI" (usulan baru) — dicocokkan dengan pengirim, bukan penentu identitas. */
  nama?: string;
}

const REF = /^(?:D\s*(\d{1,7})|(KSO-\d{4}-\d{3,}))\b[\s:,-]*/i;

export function parseKsoPerintah(body: string | null): KsoPerintah {
  const baris = stripInvisible(body ?? "").split(/\r?\n/);
  const i = baris.findIndex((l) => KSO_LINE.test(l));
  if (i < 0) return { aksi: "kosong", isi: "" };
  let kepala = baris[i].replace(KSO_LINE, "").trim();
  const sisa = baris.slice(i + 1).join("\n").trim();

  let aksi: KsoAksi = "baru";
  const kata = kepala.match(/^(kirim|minta\s+kelonggaran|kelonggaran|kalah)\b[\s:,-]*/i);
  if (kata) {
    const k = kata[1].toLowerCase();
    aksi = k === "kirim" ? "kirim" : k === "kalah" ? "kalah" : "kelonggaran";
    kepala = kepala.slice(kata[0].length);
  }
  let draftId: number | undefined;
  let nomor: string | undefined;
  const ref = kepala.match(REF);
  if (ref) {
    if (ref[1]) draftId = Number(ref[1]);
    if (ref[2]) nomor = ref[2].toUpperCase();
    kepala = kepala.slice(ref[0].length);
    if (aksi === "baru") aksi = "lengkapi";
  }
  let nama: string | undefined;
  if (aksi === "baru" && kepala) {
    if (/^(?:bantuan|format|help|template|\?)$/i.test(kepala)) return { aksi: "kosong", isi: "" };
    // "#KSO BUDI" = nama; "#KSO ALAT 1" = label (bukan nama); kalimat bebas tetap jadi isi (→ dibalas format)
    if (!bacaBarisLabel(kepala) && bentukNama(kepala)) {
      nama = kepala.trim();
      kepala = "";
    }
  }
  const isi = [kepala.trim(), sisa].filter(Boolean).join("\n").trim();
  if (aksi === "baru" && !isi) aksi = "kosong";
  return { aksi, draftId, nomor, isi, ...(nama ? { nama } : {}) };
}

// ---------------------------------------------------------------- teks balasan (murni)

export function rp(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")} jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

// Tanpa kurung sudut: WhatsApp membuang teks "<...>" (memori: placeholder hilang) — pakai huruf besar.
// KSO_FORMAT_ISIAN disalin APA ADANYA ke FORMAT_KSO di apps/web/src/lib/kso-komite-daftar.ts (dialog "Format #KSO");
// uji web kso-komite-daftar.test.ts membaca berkas ini dan gagal bila keduanya beda.
// KOTA sengaja tidak diminta (keputusan 10 Nov): faskes master punya kota/cabang sendiri, faskes baru = area AM (304).
export const KSO_FORMAT_ISIAN =
  "#KSO BUDI\n" +
  "1. FASKES : RS CONTOH SEJAHTERA\n" +
  "2. ALAT : ZYBIO Z50\n" +
  "3. TES : 700 TEST/BULAN\n" +
  "4. MASA KSO : 36 BULAN\n" +
  "5. PERMINTAAN HARGA : 11.800/TEST\n" +
  "6. FEE : 5% (tulis 0 bila tidak ada fee)\n" +
  "7. KOMPETITOR : MEREK-MODEL-HARGA (atau TIDAK ADA)\n" +
  "8. KLAUSUL : TIDAK (atau ADA - isi klausulnya)\n" +
  "9. LAMPIRAN : ADA — kirim PDF Simulator KSO di chat ini dalam 10 menit\n" +
  "10. STATUS UNIT : BARU / RELOKASI IDLE / EKS KSO / EKS DEMO / REFURBISH / PINJAMAN PRINCIPAL\n" +
  "11. BUKTI VOLUME : REKAP LIS 6 BULAN / PEMBELIAN REAGEN / SURAT RS\n" +
  "12. PENDUKUNG : dr. NAMA, JABATAN (mis. kepala instalasi lab)\n" +
  "(10 dan 11 pilih SATU. Tambahan bila perlu: JUMLAH : 2 bila lebih dari 1 unit · " +
  "HARI KERJA : 26 bila beda dari default · ALASAN : … hanya bila diminta bot)";

export const KSO_BANTUAN =
  "Format #KSO (usulan baru — satu pesan, nama kamu sendiri di baris pertama):\n" +
  KSO_FORMAT_ISIAN + "\n\n" +
  "Melengkapi/koreksi: #KSO D12 LABEL: ISI (mis. #KSO D12 PENDUKUNG: dr. Contoh, kepala instalasi lab)\n" +
  "PDF menyusul: kirim \"#KSO D12\" lalu PDF-nya dalam 10 menit.\n" +
  "Data lengkap + PDF cocok → diajukan otomatis. Mengajukan manual: #KSO kirim D12\n" +
  "Volume RS turun sesudah mandat terbit: #KSO D12 volume 900 (turun lebih dari 20% → mandat dihitung ulang)\n" +
  "Voice note tidak diproses untuk #KSO.";

/** Terjemahan galat fungsi kso.* ke bahasa manusia. Tak pernah menampilkan nama fungsi/kode. */
export function terjemahGalatKso(pesan: string, ref: string): string {
  if (/SUMBER_VOLUME_KOSONG/.test(pesan))
    return `Bukti volume belum ada — kirim PDF Simulator KSO, atau tulis: #KSO ${ref} BUKTI VOLUME: rekap LIS 6 bulan`;
  const kurang = pesan.match(/KOLOM_WAJIB_KOSONG:\s*(.+)/);
  if (kurang) {
    const label: Record<string, string> = {
      volume_estimasi: "TES per bulan",
      harga_per_test: "PERMINTAAN HARGA",
      tenor_bulan: "MASA KSO (bulan)",
      "pendukung (min 1)": "minimal satu PENDUKUNG di RS",
      jumlah: "JUMLAH unit",
      klausul: "KLAUSUL (ADA/TIDAK)",
    };
    const daftar = kurang[1].split(",").map((s) => label[s.trim()] ?? s.trim());
    return `Belum bisa diajukan, masih kurang: ${daftar.join("; ")}.\nJawab: #KSO ${ref} LABEL: ISI`;
  }
  if (/BUKAN_MILIK_PENGIRIM|RENCANA_TIDAK_ADA/.test(pesan)) return "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.";
  if (/DRAFT_TERKUNCI|TIDAK_BISA_DIAJUKAN/.test(pesan)) return `Rencana ${ref} sudah diajukan — isiannya tidak bisa diubah lagi lewat WA.`;
  if (/BUKAN_TAHAP_NEGOSIASI/.test(pesan)) return "Minta kelonggaran hanya untuk rencana yang penawarannya sudah terbit.";
  if (/BUKAN_TAHAP_MANDAT|TIDAK_ADA_MANDAT/.test(pesan)) return `Laporan volume hanya untuk rencana yang sudah punya mandat — ${ref} belum.`;
  if (/VOLUME_TIDAK_SAH/.test(pesan)) return `Volume harus angka tes per bulan, mis. "#KSO ${ref} volume 900".`;
  if (/GRUP_DIBEKUKAN/.test(pesan)) return "Grup faskes ini sedang dibekukan Direksi (SK Pasal 14) — belum bisa diproses.";
  if (/TRANSISI_TIDAK_SAH/.test(pesan)) return `Aksi itu tidak berlaku untuk status ${ref} sekarang.`;
  if (/ALASAN_STRATEGIS_WAJIB/.test(pesan))
    return `Usulan ini wajib alasan strategis — tulis dulu.\nJawab: #KSO ${ref} ALASAN: ISI ALASAN`;
  return "Maaf, permintaan belum bisa diproses. Coba lagi, atau hubungi admin.";
}

export interface LampiranTampil {
  id: number;
  lolos: boolean;
  cocok: Record<string, CocokIsian> | null;
  galat: string | null;
  tanggal: string | null;
  wa_message_id: string | null;
  dibuat_at: string | null;
}

export interface DraftTampil {
  id: number;
  nomor: string | null;
  status: string;
  faskes: string;
  cabang: string | null;
  /** 303: faskes SEMENTARA (calon customer, id BARU-<n>) + kotanya. */
  faskes_id?: string;
  faskes_baru?: boolean;
  faskes_kota?: string | null;
  /** 304: kota faskes baru masih default area AM (boleh diganti PDF Simulator / label KOTA). */
  faskes_kota_area?: boolean | null;
  alat: string;
  alat_kode: string;
  jumlah: number;
  volume_estimasi: number | null;
  volume_sumber: string | null;
  harga_per_test: number | null;
  harga_standar: number | null;
  kategori: string;
  tenor_bulan: number | null;
  /** 282: hari kerja alat/bulan yang disebut AM; null = default parameter Bottom Line. */
  hari_kerja?: number | null;
  hari_kerja_default?: number;
  unit_status: string | null;
  klausul: string[];
  kolom_dinyatakan: string[];
  pendukung: { nama: string; tipe: string }[];
  gerbang: { no: number; nama: string; status: string; nilai: string | null }[];
  kursi_hod: number;
  /** F170 v2 (266): zona dari GPM saja + GPM deal — null bila data GPM belum lengkap. */
  zona_dasar: "am" | "hod" | "forum" | "direktur" | null;
  gpm_deal: number | null;
  /** F170 v2 (267): isian template Pedoman. */
  harga_pesaing?: number | null;
  kompetitor_alat?: string | null;
  alasan_strategis?: string | null;
  /** 302: fee ke RS/perantara (%), jawaban KLAUSUL, lampiran PDF terakhir. */
  fee_persen?: number | null;
  klausul_ada?: boolean | null;
  klausul_detail?: string | null;
  lampiran?: LampiranTampil | null;
  /** Angka GPM per zona (kso.app_bot_angka_gpm) — null bila belum dihitung. */
  angka?: AngkaGpm | null;
}

export interface AngkaGpm {
  gpm: number | null; hd: boolean; catatan: string | null; biaya_per_tes: number | null;
  harga_am: number | null; harga_hod: number | null; harga_forum: number | null; volume_min_forum: number | null;
}


/** Harga bersih sesudah fee (302): harga × (1 − fee/100). */
export function hargaBersih(harga: number | null | undefined, fee: number | null | undefined): number | null {
  if (harga == null) return null;
  return harga * (1 - (fee ?? 0) / 100);
}

/** Label zona jalur forum di balasan "#KSO kirim". Usulan zona dasar Forum yang naik ke Direktur HANYA karena
 *  bukti volume (gerbang 2) belum diperiksa Sekretaris disebut Zona Forum + catatan: sejak migrasi 269 zonanya
 *  dihitung ulang dan kembali ke Forum begitu buktinya disahkan. Gerbang lain tak hijau / aturan grup = Direktur. */
export function teksZonaForum(z: {
  zona: string | null; zona_dasar: string | null; alasan_forum: string | null; belum_hijau: number[]; gerbang2: string | null;
}): { label: string; catatan: string | null } {
  if (z.zona === "direktur" && z.zona_dasar === "forum" && !z.alasan_forum
      && z.belum_hijau.length === 1 && z.belum_hijau[0] === 2 && z.gerbang2 === "belum")
    return { label: "ZONA FORUM", catatan: "Sementara tercatat Zona Direktur sampai Sekretaris memverifikasi bukti volume — siapkan berkas buktinya." };
  return { label: z.zona === "direktur" ? "ZONA DIREKTUR" : "ZONA FORUM", catatan: null };
}

/** Angka volume dari "#KSO D12 volume 900" / "volume turun jadi 1.100 tes" — titik = ribuan. null bila tak ada. */
export function volumeDariTeks(t: string): number | null {
  const m = /\bvolume\b[^\d]{0,30}(\d{1,3}(?:\.\d{3})+|\d+)/i.exec(t);
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Balasan kso.volume_turun (278): toleransi · dihitung ulang · ditarik ke forum. Murni — diuji tanpa DB.
 * Ke AM: TANPA harga mandat / GPM (keputusan 10 Nov) — angka mandat baru dipegang Sekretariat/Admin Sales yang
 * menerbitkan penawaran. Yang dibacakan hanya volume (angka AM sendiri) dan masa berlaku.
 */
export function balasanVolumeTurun(ref: string, h: Record<string, unknown>): string {
  const n = (k: string) => (h[k] == null ? null : Number(h[k]));
  const tes = (v: number | null) => (v == null ? "—" : v.toLocaleString("id-ID"));
  if (h.hasil === "toleransi")
    return `${ref}: volume ${tes(n("volume_baru"))} tes/bln masih dalam toleransi (batas ${tes(n("volume_batas"))} tes/bln). Mandat tetap.`;
  const turun = `${ref}: volume turun dari ${tes(n("volume_dasar"))} ke ${tes(n("volume_baru"))} tes/bln (melewati batas toleransi)`;
  if (h.hasil === "dihitung_ulang")
    return `${turun} — mandat dihitung ulang, berlaku s/d ${String(h.berlaku_sampai)}. `
      + "Penawaran berikutnya diterbitkan Sekretariat/Admin Sales dengan mandat baru — jangan pakai harga lama.";
  return `${turun} — ${h.tanpa_angka ? "mandat tak bisa dihitung ulang otomatis" : "usulan perlu diputus ulang"}. `
    + "Mandat lama gugur; usulan masuk agenda forum berikutnya. Jangan lanjutkan penawaran dengan harga lama.";
}

/**
 * Perkiraan jalur sebelum dikirim — cermin kso.ajukan (266): level zona GPM, satu gerbang 2–7 tidak hijau
 * (atau klausul belum dijawab) = naik satu level, routing HOD < 2 kursi di level HOD = forum.
 * Aturan grup mitra tidak terlihat di draft — final tetap saat dikirim.
 */
export function perkiraanZona(d: Pick<DraftTampil, "zona_dasar" | "gerbang" | "kursi_hod" | "kolom_dinyatakan">): "am" | "hod" | "forum" | "direktur" {
  const LEVEL = ["am", "hod", "forum", "direktur"] as const;
  let lv = d.zona_dasar ? LEVEL.indexOf(d.zona_dasar) : 2;
  const belumKlausul = !d.kolom_dinyatakan.includes("klausul");
  if (belumKlausul || d.gerbang.some((x) => x.no >= 2 && x.status !== "hijau")) lv = Math.min(lv + 1, 3);
  if (lv === 1 && d.kursi_hod < 2) lv = 2;
  return LEVEL[lv];
}

/** Data "Belum lengkap" dari draft yang tampil (satu sumber dengan dashboard). */
export function kurangDraft(d: DraftTampil): ItemKurang[] {
  const x: DataKurang = { ...d, angka: d.angka ? { hd: d.angka.hd } : null,
    lampiran: d.lampiran ? { lolos: d.lampiran.lolos, cocok: d.lampiran.cocok, galat: d.lampiran.galat } : null };
  return daftarKurang(x, `D${d.id}`);
}

/** Nama pendek isian kurang untuk baris "Kurang:" (kunci = ItemKurang.kunci). */
const KURANG_PENDEK: Record<string, string> = {
  tes: "tes/bulan", masa: "masa KSO", harga: "permintaan harga", fee: "fee", kompetitor: "kompetitor", klausul: "klausul",
  lampiran: "lampiran PDF", pendukung: "pendukung", status_unit: "status unit", sumber: "sumber volume", alasan: "alasan",
};

/** Satu baris gerbang di balasan WA: biner HIJAU / MERAH + alasan tanpa angka. */
export interface BarisGerbangWa { no: number; nama: string; hijau: boolean; alasan: string | null }

/** Tujuh gerbang untuk AM: 'belum' = MERAH; KLAUSUL belum dijawab = gerbang 7 MERAH. Tak pernah memuat angka. */
export function gerbangUntukAm(d: Pick<DraftTampil, "gerbang" | "kolom_dinyatakan" | "klausul_ada">): BarisGerbangWa[] {
  const klausulBelum = !d.kolom_dinyatakan.includes("klausul");
  return [1, 2, 3, 4, 5, 6, 7].map((no) => {
    const g = d.gerbang.find((x) => Number(x.no) === no);
    // KLAUSUL: ADA/YA tanpa isinya = sudah dijawab ada, detailnya yang ditunggu
    if (no === 7 && klausulBelum)
      return { no, nama: NAMA_GERBANG[no], hijau: false, alasan: d.klausul_ada === true ? "isi klausul belum ditulis" : "belum dijawab" };
    if (!g) return { no, nama: NAMA_GERBANG[no], hijau: false, alasan: "belum ada data" };
    const hijau = g.status === "hijau";
    return { no, nama: NAMA_GERBANG[no], hijau, alasan: hijau ? null : alasanGerbang(no, g.status, g.nilai) };
  });
}

/**
 * Balasan WA ke AM untuk semua keadaan draft (baru, lengkapi/susulan, lampiran diproses, "#KSO D62", kirim belum
 * lengkap). Bentuk disetujui product owner 10 Nov:
 *
 *   D63 · RS CONTOH · Z50 · 4/7 HIJAU
 *
 *   1. GPM deal              ❌ MERAH
 *   2. Volume terbukti       ❌ MERAH (belum ada bukti)
 *   …
 *   Kurang: lampiran PDF, pendukung, status unit, alasan
 *   (contoh: #KSO D63 PENDUKUNG: ...)
 *
 * TANPA angka margin/HPP/harga mandat (keputusan B 10 Nov). Diajukan otomatis → baris Kurang diganti hasil jalur.
 */
export function formatBalasanGerbang(
  d: DraftTampil,
  o: { tanpaTipe?: string[]; catatan?: string[]; diajukan?: string; belumBisaKirim?: boolean } = {},
): string {
  const ref = `D${d.id}`;
  const gs = gerbangUntukAm(d);
  const out: string[] = [`${ref} · ${d.faskes}${d.faskes_baru ? " (faskes baru)" : ""} · ${d.alat_kode} · ${gs.filter((g) => g.hijau).length}/7 HIJAU`, ""];
  for (const g of gs)
    out.push(`${`${g.no}. ${g.nama}`.padEnd(25)}${g.hijau ? "✅ HIJAU" : `❌ MERAH${g.alasan ? ` (${g.alasan})` : ""}`}`);
  out.push("");

  const q = kurangDraft(d);
  if (o.diajukan) out.push(o.diajukan);
  else if (q.length) {
    const lampiranBeda = d.lampiran && !d.lampiran.lolos;
    const nama = q.map((t) => (t.kunci === "lampiran" && lampiranBeda ? "lampiran PDF belum cocok" : KURANG_PENDEK[t.kunci] ?? t.kunci));
    out.push(`${o.belumBisaKirim ? "Belum bisa diajukan. " : ""}Kurang: ${nama.join(", ")}`);
    if (lampiranBeda) {
      const b = d.lampiran!.galat ? [teksGalatOcr(d.lampiran!.galat)] : bedaDariCocok(d.lampiran!.cocok);
      if (b.length) out.push(`PDF belum cocok: ${b.join("; ")}`);
    }
    out.push(`(contoh: ${q[0].contoh})`);
  } else if (d.status === "DRAFT" || d.status === "DITAHAN") {
    out.push(`Lengkap — balas "#KSO kirim ${ref}" untuk mengajukan.`);
  } else {
    out.push(`Sudah diajukan${d.nomor ? ` (${d.nomor})` : ""} — status ${d.status.replace(/_/g, " ").toLowerCase()}.`);
  }
  for (const c of o.catatan ?? []) out.push(`ℹ️ ${c}`);
  for (const n of o.tanpaTipe ?? []) out.push(`ℹ️ Peran ${n} belum jelas — tulis: #KSO ${ref} PENDUKUNG: ${n}, kepala instalasi lab`);
  return out.join("\n");
}

/** Hasil "#KSO kirim" / pengajuan otomatis untuk AM — jalur & zona dalam kata, TANPA GPM / harga mandat. */
export function teksHasilAjukan(x: {
  nomor: string; jalur: string; zona: string | null; zona_dasar: string | null; alasan_forum: string | null; belum_hijau: number[]; gerbang2: string | null;
}): string {
  if (x.jalur === "AM")
    return `${x.nomor} diajukan → ZONA AM: lolos tanpa forum, mandat terbit otomatis; penawaran diterbitkan Sekretariat/Admin Sales.\n` +
      `RS minta harga lebih rendah → #KSO kelonggaran ${x.nomor} ALASAN`;
  if (x.jalur === "CEPAT") return `${x.nomor} diajukan → ZONA 2 HOD: dua HOD memutus maksimal 1 hari kerja.`;
  const zf = teksZonaForum(x);
  return `${x.nomor} diajukan → ${zf.label}${x.alasan_forum ? ` (${x.alasan_forum})` : ""}: masuk agenda forum Selasa/Kamis berikutnya ` +
    `(batas data 14.00), Direktur memutus.${zf.catatan ? `\n${zf.catatan}` : ""}`;
}

/** Balasan saat alat belum pasti: 3 saran + cara memilih. */
export function balasanSaranAlat(nama: string, alatTeks: string, h: Extract<HasilAlat, { kind: "saran" }>, ref: string | null, semuaKode: string[]): string {
  const awal = ref
    ? `Alat "${alatTeks}" untuk ${ref} belum pasti — alat ${ref} tidak diubah.`
    : `Alat "${alatTeks}" belum cocok pasti ke katalog KSO, ${nama}. Draft BELUM dibuat — isian lain sudah disimpan, tinggal pilih alatnya.`;
  const saran = h.saran.length
    ? `${h.ambigu ? "Cocok ke beberapa tipe" : "Mungkin maksudnya"}:\n${h.saran.map((s, i) => `${i + 1}. ${s.kode} — ${s.nama}${s.kategori ? ` (${s.kategori})` : ""}`).join("\n")}`
    : `Tidak ada yang mirip. Pilihan katalog: ${semuaKode.join(", ")}.`;
  const cara = ref
    ? `Balas: #KSO ${ref} ALAT 1${h.saran.length > 1 ? ` (atau ${h.saran.map((_, i) => i + 1).join("/")})` : ""}, atau #KSO ${ref} ALAT: KODE`
    : `Balas: #KSO ALAT 1${h.saran.length > 1 ? ` (atau ${h.saran.map((_, i) => i + 1).join("/")})` : ""}, atau #KSO ALAT: KODE — berlaku 24 jam.`;
  return `${awal}\n${saran}\n${cara}`;
}

/** Balasan saat nama faskes mirip beberapa faskes (salah ketik / ambigu): maks 3 pilihan + FASKES BARU. */
export function balasanSaranFaskes(nama: string, faskesTeks: string, saran: SaranFaskes[], alatTeks: string | null): string {
  const daftar = saran.map((s, i) => `${i + 1}. ${s.nama}${s.cabang ? ` — ${s.cabang}` : ""}${s.baru ? " (faskes baru)" : ""}`).join("\n");
  const nomor = saran.length > 1 ? ` (atau ${saran.map((_, i) => i + 1).join("/")})` : "";
  return [
    `Faskes "${faskesTeks}" belum pasti, ${nama}. Draft BELUM dibuat — isian lain sudah disimpan, tinggal pilih faskesnya.`,
    `Mungkin maksudnya:\n${daftar}`,
    `Balas: #KSO FASKES 1${nomor} — atau #KSO FASKES BARU kalau ini customer baru. Berlaku 24 jam.`,
    ...(alatTeks ? [`Alat "${alatTeks}" juga belum pasti — ditanyakan sesudah faskes dipilih.`] : []),
  ].join("\n");
}

/**
 * Catatan di balasan draft yang memakai faskes baru (calon customer). Tanpa angka. Kota TIDAK ditanyakan (keputusan
 * 10 Nov): default = area AM (304), diganti kota dari PDF Simulator atau label KOTA bila AM menulisnya.
 */
export function catatanFaskesBaru(d: Pick<DraftTampil, "faskes" | "cabang">): string[] {
  return [`Faskes "${d.faskes}" belum ada di master — dicatat sebagai FASKES BARU (calon customer)${d.cabang ? `, cabang ${d.cabang}` : ""}. ` +
    "Sekretariat menautkannya ke akun master begitu customer ini terdaftar."];
}

/** Balasan pesan #KSO yang tidak sesuai format (teks bebas tidak lagi diproses). */
export function balasanFormatSalah(x: IsianFormat | null): string {
  const kurang = x ? (["faskes", "alat"] as const).filter((k) => !x.label.includes(k)).map((k) => NAMA_LABEL[k]) : [];
  return `Format #KSO belum sesuai${kurang.length ? ` (${kurang.join(" dan ")} wajib ada)` : ""} — usulan BELUM dicatat. Teks bebas dan voice note tidak diproses lagi.\n\n${KSO_BANTUAN}`;
}

// ---------------------------------------------------------------- DB (sebagai bot_wa)

type Tx = TransactionSql<Record<string, unknown>>;

/** Satu transaksi dengan identitas bot: set_config dan panggilan kso.app_bot_* WAJIB di tx yang sama (pool). */
export async function sebagaiBot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`set local role wrg_app`; // dev = prod: pagar peran & RLS berlaku walau koneksi superuser
    await tx`select set_config('wrg.kso_user', ${KSO_BOT_USER}, true)`;
    return fn(tx as unknown as Tx);
  })) as T;
}

async function bacaDraft(tx: Tx, id: number): Promise<DraftTampil | null> {
  const [r] = await tx`
    select r.id::int, r.nomor, r.status::text, r.faskes_id, f.nama as faskes, f.cabang, f.baru as faskes_baru, f.kota as faskes_kota,
           f.kota_dari_area as faskes_kota_area, a.nama as alat, a.kode as alat_kode,
           r.jumlah, r.volume_estimasi, r.volume_sumber, r.harga_per_test::float8, k.harga_standar_per_test::float8 as harga_standar,
           k.label as kategori, r.tenor_bulan, r.hari_kerja,
           coalesce((select p.hari_kerja from public.kso_bottomline_parameter p where p.id = 1), 25)::int as hari_kerja_default,
           r.unit_status::text, r.kolom_dinyatakan,
           coalesce((select array_agg(klausul_kode order by klausul_kode) from kso.rencana_klausul where rencana_id = r.id), '{}') as klausul,
           coalesce((select json_agg(json_build_object('nama', nama, 'tipe', tipe) order by id) from kso.rencana_pendukung where rencana_id = r.id), '[]') as pendukung,
           coalesce((select json_agg(json_build_object('no', no, 'nama', nama, 'status', status, 'nilai', nilai) order by no) from kso.gerbang_hasil where rencana_id = r.id), '[]') as gerbang,
           (select count(*)::int from kso.hod_untuk(r.id)) as kursi_hod, r.zona_dasar, r.gpm_deal::float8 as gpm_deal,
           r.harga_pesaing::float8 as harga_pesaing, r.kompetitor_alat, r.alasan_strategis,
           r.fee_persen::float8 as fee_persen, r.klausul_ada, r.klausul_detail,
           (select json_build_object('id', l.id, 'lolos', l.lolos, 'cocok', l.cocok, 'wa_message_id', l.wa_message_id, 'dibuat_at', l.dibuat_at,
                                     'tanggal', l.hasil_ocr->'isian'->>'tanggal',
                                     'galat', case when coalesce((l.hasil_ocr->>'ok')::boolean, false) then null
                                                   else coalesce(l.hasil_ocr->>'galat', 'tidak-terbaca') end)
              from kso.rencana_lampiran l where l.rencana_id = r.id order by l.dibuat_at desc, l.id desc limit 1) as lampiran
      from kso.rencana_kso r join kso.faskes f on f.id = r.faskes_id
      join kso.alat a on a.kode = r.alat_kode join kso.kategori k on k.kode = a.kategori
     where r.id = ${id}`;
  if (!r) return null;
  const [g] = await tx`select gpm::float8, hd, catatan, biaya_per_tes::float8, harga_am::float8, harga_hod::float8,
                              harga_forum::float8, volume_min_forum::float8 from kso.app_bot_angka_gpm(${id})`;
  return { ...(r as unknown as DraftTampil), angka: (g as unknown as AngkaGpm) ?? null };
}

async function idDariNomor(tx: Tx, p: KsoPerintah): Promise<number | null> {
  if (p.draftId) return p.draftId;
  if (!p.nomor) return null;
  const [r] = await tx`select id::int from kso.rencana_kso where nomor = ${p.nomor}`;
  return r ? Number(r.id) : null;
}

type Cocok<T> = { kind: "one"; nilai: T; nama: string } | { kind: "none" } | { kind: "ambiguous"; names: string[] };

/**
 * Faskes untuk usulan baru (303 — keputusan product owner 10 Nov: faskes boleh customer baru). Jalur pasti lama tetap
 * (cariAkun → tepat satu kso.faskes master); selain itu diputuskan putuskanFaskes atas kso.faskes (master + faskes
 * baru yang belum ditautkan): pilihan bila ada yang mirip, faskes baru bila tidak ada.
 */
async function cariFaskesBot(tx: Tx, teks: string): Promise<HasilFaskes> {
  let yakin: { id: string; nama: string } | null = null;
  let ambigu: string[] = [];
  try {
    const akun = await cariAkun(teks);
    if (akun.kind === "one") {
      const rows = await tx`select id, nama from kso.faskes where id = any(${akun.ids.map(String)}) and not baru`;
      if (rows.length === 1) yakin = { id: String(rows[0].id), nama: String(rows[0].nama) };
      else ambigu = rows.map((r) => String(r.nama));
    } else if (akun.kind === "ambiguous") ambigu = akun.names;
  } catch { /* accurate_customer tak terbaca → putuskan dari kso.faskes saja */ }
  const katalog = (await tx`select id, nama, cabang, kota, baru from kso.faskes where ditautkan_ke is null`)
    .map((r) => ({ id: String(r.id), nama: String(r.nama), cabang: r.cabang ? String(r.cabang) : null, kota: r.kota ? String(r.kota) : null,
                   baru: Boolean(r.baru) })) as FaskesKatalog[];
  return putuskanFaskes(teks, katalog, { yakin, ambigu });
}

/** Kompatibilitas lama: kode yang pasti → "one"; beberapa yang yakin → "ambiguous"; selain itu "none". */
export function pilihAlat(teks: string, katalog: { kode: string; nama: string; kategori?: string | null }[]): Cocok<string> {
  const h = cariAlat(teks, katalog);
  if (h.kind === "one") return { kind: "one", nilai: h.kode, nama: h.nama };
  return h.ambigu ? { kind: "ambiguous", names: h.saran.map((s) => s.kode) } : { kind: "none" };
}

// label/merek/nama Price Book dari Simulator (public.kso_analyzer) — alias pencarian alat. Cache 10 menit;
// dibaca di koneksi biasa (bukan tx bot) supaya tabel yang tak ada di lingkungan uji tak membatalkan transaksi.
let cacheAlias: { at: number; peta: Map<string, string[]> } | null = null;
async function aliasAnalyzer(): Promise<Map<string, string[]>> {
  if (cacheAlias && Date.now() - cacheAlias.at < 600_000) return cacheAlias.peta;
  const peta = new Map<string, string[]>();
  try {
    const rows = await db()`select kode, to_jsonb(a) as j from public.kso_analyzer a`;
    for (const r of rows) {
      const j = (r.j ?? {}) as Record<string, unknown>;
      const v = ["label", "brand", "pricebook_nama", "pricebook_kode"].map((k) => j[k]).filter((x): x is string => typeof x === "string" && !!x.trim());
      peta.set(String(r.kode), [...(peta.get(String(r.kode)) ?? []), ...v]);
    }
  } catch { /* tanpa alias — katalog kso.alat saja */ }
  cacheAlias = { at: Date.now(), peta };
  return peta;
}

async function muatKatalog(tx: Tx, alias: Map<string, string[]>): Promise<AlatKatalog[]> {
  const rows = await tx`select a.kode, a.nama, k.label as kategori from kso.alat a join kso.kategori k on k.kode = a.kategori order by a.kode`;
  return rows.map((r) => ({ kode: String(r.kode), nama: String(r.nama), kategori: r.kategori ? String(r.kategori) : null, alias: alias.get(String(r.kode)) ?? [] }));
}

/** Kandidat nama pengirim untuk dicocokkan dengan "#KSO NAMA": nama AM master + panggilan + pushname WA. */
async function namaPengirim(amId: string, k: KsoKonteks): Promise<string[]> {
  const out = [k.nama, k.pushname ?? null];
  try {
    const [r] = await db()`select nama, panggilan from master_user where am_id = ${amId}`;
    if (r) out.push(r.nama ? String(r.nama) : null, r.panggilan ? String(r.panggilan) : null);
  } catch { /* master_user tak terbaca → nama resolveSender + pushname saja */ }
  return out.filter((x): x is string => !!x && !!x.trim());
}

// ---------------------------------------------------------------- lampiran PDF

export interface LampiranWa {
  /** wa_message.message_id pesan PDF. */
  wa_message_id: string | null;
  media_path: string;
}
interface OcrLampiran {
  lampiran: LampiranWa;
  hasil: HasilOcrCprr;
  sha256: string | null;
}

/** Baca PDF lewat services/ai /kso/ocr-cprr (di LUAR transaksi — bisa puluhan detik). Tak pernah melempar. */
async function bacaLampiran(l: LampiranWa): Promise<OcrLampiran> {
  let buf: Buffer;
  try {
    buf = await readFile(l.media_path);
  } catch {
    return { lampiran: l, hasil: { ok: false, galat: "pdf-rusak" }, sha256: null };
  }
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const r = await callAi("/kso/ocr-cprr", { pdf_base64: buf.toString("base64") }, { timeoutMs: 120_000 });
  if (r.status >= 400) return { lampiran: l, hasil: { ok: false, galat: "ai-tak-terjangkau" }, sha256 };
  const hasil = r.data as HasilOcrCprr;
  // teks OCR utuh bisa panjang; cukup potongan untuk audit
  if (typeof hasil.teks_ocr === "string" && hasil.teks_ocr.length > 20_000) hasil.teks_ocr = hasil.teks_ocr.slice(0, 20_000);
  return { lampiran: l, hasil, sha256 };
}

function sumberDariLampiran(tanggal: string | null): string {
  return `Lampiran Simulator KSO ${tanggal ?? new Date().toISOString().slice(0, 10)}`;
}

// ---------------------------------------------------------------- handler

export interface KsoKonteks {
  am_id: string;
  nama: string;
  /** Pushname WA pengirim — kandidat nama untuk "#KSO NAMA". */
  pushname?: string | null;
  perintah: KsoPerintah;
  wa_message_id: string | null;
  /** PDF di pesan ini (caption #KSO) atau pasangannya dalam jendela 10 menit. */
  lampiran?: LampiranWa | null;
  /** Cari PDF dekat pesan #KSO lain (dipakai saat isian tertunda akhirnya jadi draft). */
  cariLampiranDekat?: (waMessageId: string) => Promise<LampiranWa | null>;
}
type Hasil = { balasan: string; hasil: Record<string, unknown> };

/** Ajukan satu draft (= "#KSO kirim") dan susun teks hasil zona. Dipakai juga oleh pengajuan otomatis. */
async function ajukanDraft(tx: Tx, id: number, k: Pick<KsoKonteks, "am_id" | "nama">): Promise<Hasil> {
  const [j] = await tx`select kso.app_bot_ajukan(${id}, ${k.am_id})::text as jalur`;
  const [r] = await tx`select nomor, alasan_forum from kso.rencana_kso where id = ${id}`;
  // hanya zona & status gerbang — angka GPM dan harga mandat TIDAK dibaca untuk balasan AM (keputusan 10 Nov)
  const [z] = await tx`select r.zona, r.zona_dasar,
                              coalesce((select array_agg(g.no order by g.no) from kso.gerbang_hasil g
                                         where g.rencana_id = r.id and g.no between 2 and 7 and g.status <> 'hijau'), '{}') as belum_hijau,
                              (select g.status::text from kso.gerbang_hasil g where g.rencana_id = r.id and g.no = 2) as gerbang2
                         from kso.rencana_kso r where r.id = ${id}`;
  return {
    balasan: teksHasilAjukan({ nomor: String(r.nomor), jalur: String(j.jalur), zona: z?.zona ?? null, zona_dasar: z?.zona_dasar ?? null,
                               alasan_forum: r.alasan_forum ?? null, belum_hijau: (z?.belum_hijau ?? []).map(Number), gerbang2: z?.gerbang2 ?? null }),
    hasil: { aksi: "kirim", rencana_id: id, nomor: r.nomor, jalur: j.jalur },
  };
}

interface OpsiSelesai {
  baru: boolean;
  catatan?: string[];
  tanpaTipe?: string[];
  alatTeks?: string;
  faskesTeks?: string;
  ocr?: OcrLampiran | null;
  hasil?: Record<string, unknown>;
}

/**
 * Langkah akhir semua jalur draft: catat lampiran baru (atau cocokkan ulang lampiran terakhir dengan isian sekarang),
 * baca draft, hitung "Belum lengkap"; lengkap → ajukan otomatis (savepoint: gagal mengajukan tak membatalkan isian).
 */
async function selesaikan(k: KsoKonteks, id: number, o: OpsiSelesai): Promise<Hasil> {
  const alias = await aliasAnalyzer();
  const nama = await namaPengirim(k.am_id, k);
  if (k.perintah.nama) nama.unshift(k.perintah.nama);
  return sebagaiBot(async (tx) => {
    const katalog = await muatKatalog(tx, alias);
    const awal = await bacaDraft(tx, id);
    if (!awal) return { balasan: "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.", hasil: { error: "ref-tidak-ada", rencana_id: id } };
    const bahan = (d: DraftTampil) => ({
      namaAm: nama, faskes: [d.faskes, o.faskesTeks], alat_kode: d.alat_kode, alat_nama: d.alat,
      volume_estimasi: d.volume_estimasi, tenor_bulan: d.tenor_bulan, kompetitor_alat: d.kompetitor_alat ?? null,
      harga_pesaing: d.harga_pesaing ?? null, harga_per_test: d.harga_per_test,
    });
    const terkunci = !["DRAFT", "DITAHAN"].includes(awal.status);
    let lampiranHasil: Record<string, unknown> | undefined;
    if (o.ocr) {
      const cek = cocokkanLampiran(o.ocr.hasil, bahan(awal), katalog);
      await tx`select kso.app_bot_catat_lampiran(${id}, ${k.am_id}, ${o.ocr.lampiran.wa_message_id}, ${o.ocr.lampiran.media_path}, ${o.ocr.sha256},
                 ${tx.json(o.ocr.hasil as never)}, ${tx.json(cek.cocok as never)}, ${cek.lolos}, ${cek.hari_kerja},
                 ${cek.lolos ? sumberDariLampiran(cek.tanggal) : null})`;
      // cek.info (peringatan hitungan OCR, harga pesaing) tidak dikirim ke AM — balasan hanya gerbang + kurang
      lampiranHasil = { lolos: cek.lolos, beda: cek.beda.length };
      // 303/304: faskes baru tanpa kota ATAU kota masih default area AM → kota dari PDF Simulator (nama faskes PDF sudah
      // dicocokkan dengan nama yang ditulis AM)
      const kotaPdf = o.ocr.hasil.ok ? o.ocr.hasil.isian?.kota?.trim() : null;
      if (awal.faskes_baru && (!awal.faskes_kota || awal.faskes_kota_area) && kotaPdf && awal.faskes_id) {
        const [kt] = await tx`select kso.app_bot_isi_kota_faskes(${k.am_id}, ${awal.faskes_id}, ${kotaPdf}) as ok`;
        if (kt?.ok) lampiranHasil.kota_faskes = kotaPdf;
      }
      if (terkunci)
        return { balasan: `PDF untuk ${awal.nomor ?? `D${id}`} dicatat sebagai arsip — usulannya sudah diajukan, isiannya tidak berubah.`,
                 hasil: { aksi: "lampiran", rencana_id: id, lampiran: lampiranHasil } };
    } else if (!terkunci) {
      // isian berubah → lampiran terakhir dicocokkan ulang (AM cukup mengoreksi isian, tak perlu kirim PDF lagi)
      const [l] = await tx`select wa_message_id, media_path, sha256, hasil_ocr, cocok, lolos from kso.rencana_lampiran
                            where rencana_id = ${id} order by dibuat_at desc, id desc limit 1`;
      const h = l?.hasil_ocr as HasilOcrCprr | undefined;
      if (l && l.wa_message_id && h?.ok) {
        const cek = cocokkanLampiran(h, bahan(awal), katalog);
        if (cek.lolos !== Boolean(l.lolos) || JSON.stringify(cek.cocok) !== JSON.stringify(l.cocok)) {
          await tx`select kso.app_bot_catat_lampiran(${id}, ${k.am_id}, ${String(l.wa_message_id)}, ${l.media_path ?? null}, ${l.sha256 ?? null},
                     ${tx.json(h as never)}, ${tx.json(cek.cocok as never)}, ${cek.lolos}, ${cek.hari_kerja},
                     ${cek.lolos ? sumberDariLampiran(cek.tanggal) : null})`;
          lampiranHasil = { lolos: cek.lolos, dicek_ulang: true };
        }
      }
    }
    const d = (await bacaDraft(tx, id))!;
    const kurang = kurangDraft(d);
    let diajukan: Hasil | null = null;
    let galatAjukan: string | null = null;
    if (!kurang.length && (d.status === "DRAFT" || d.status === "DITAHAN")) {
      try {
        diajukan = await tx.savepoint(async (sp) => ajukanDraft(sp as unknown as Tx, id, k));
      } catch (e) {
        galatAjukan = (e as Error).message;
      }
    }
    const catatan = [...(o.baru && d.faskes_baru ? catatanFaskesBaru(d) : []), ...(o.catatan ?? [])];
    if (galatAjukan) catatan.push(terjemahGalatKso(galatAjukan, `D${id}`));
    const balasan = formatBalasanGerbang(d, { tanpaTipe: o.tanpaTipe, catatan, diajukan: diajukan?.balasan });
    return {
      balasan,
      hasil: { ...(o.hasil ?? {}), rencana_id: id, kurang: kurang.map((x) => x.kunci), ...(d.faskes_baru ? { faskes_baru: d.faskes_id } : {}),
               ...(lampiranHasil ? { lampiran: lampiranHasil } : {}),
               ...(diajukan ? { diajukan: true, nomor: diajukan.hasil.nomor, jalur: diajukan.hasil.jalur } : {}),
               ...(galatAjukan ? { galat_ajukan: galatAjukan.slice(0, 200) } : {}) },
    };
  });
}

/** PDF yang datang terpisah (sesudah draftnya ada) — dipanggil inbound dari baris dokumen. */
export async function prosesLampiranKso(
  k: Pick<KsoKonteks, "am_id" | "nama" | "pushname" | "wa_message_id">, rencanaId: number, lampiran: LampiranWa,
): Promise<Hasil> {
  const ocr = await bacaLampiran(lampiran);
  const ks: KsoKonteks = { ...k, perintah: { aksi: "lengkapi", draftId: rencanaId, isi: "" } };
  try {
    const r = await selesaikan(ks, rencanaId, { baru: false, ocr, hasil: { aksi: "lampiran" } });
    return r;
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, `D${rencanaId}`), hasil: { aksi: "lampiran", error: "kso-galat", galat: m.slice(0, 200) } };
  }
}

// ---------------------------------------------------------------- isian tertunda (alat dan/atau faskes belum pasti)

interface BarisTertunda {
  id: number;
  faskes_id: string | null;
  isian: Record<string, unknown>;
  alat_teks: string | null;
  saran: SaranAlat[];
  wa_message_id: string | null;
  alat_kode: string | null;
  faskes_teks: string | null;
  faskes_saran: SaranFaskes[];
  kota: string | null;
  lampiran_wa: string | null;
  lampiran_path: string | null;
}

/** Usulan BARU (tanpa draft) milik AM yang masih menunggu jawaban (24 jam). */
async function bacaTertunda(tx: Tx, amId: string): Promise<BarisTertunda | null> {
  const [r] = await tx`select id::int, faskes_id, isian, alat_teks, saran, wa_message_id, alat_kode, faskes_teks, faskes_saran, kota,
                              lampiran_wa, lampiran_path
                         from kso.intake_tertunda
                        where am_id = ${amId} and selesai_at is null and rencana_id is null and dibuat_at > now() - interval '24 hours'
                        order by dibuat_at desc limit 1`;
  if (!r) return null;
  return { ...(r as unknown as BarisTertunda), saran: (r.saran as SaranAlat[]) ?? [], faskes_saran: (r.faskes_saran as SaranFaskes[]) ?? [],
           isian: (r.isian as Record<string, unknown>) ?? {} };
}

/** Faskes masih ditanya = belum ada faskes_id dan ada daftar pilihan. faskes_id kosong tanpa pilihan = faskes BARU nanti. */
export function faskesTerbuka(t: Pick<BarisTertunda, "faskes_id" | "faskes_saran">): boolean {
  return t.faskes_id == null && t.faskes_saran.length > 0;
}

/**
 * Pertanyaan berikutnya untuk isian tertunda: faskes dulu, lalu alat. null = keduanya sudah terjawab (draft bisa dibuat).
 * Murni — diuji tanpa DB.
 */
export function pertanyaanTertunda(nama: string, t: Omit<BarisTertunda, "isian" | "wa_message_id" | "kota" | "lampiran_wa" | "lampiran_path">,
                                   semuaKode: string[]): Hasil | null {
  if (faskesTerbuka(t))
    return {
      balasan: balasanSaranFaskes(nama, t.faskes_teks ?? "", t.faskes_saran, t.alat_kode ? null : t.alat_teks),
      hasil: { aksi: "baru", error: "faskes-belum-pasti", tertunda_id: t.id, saran_faskes: t.faskes_saran.map((s) => s.id) },
    };
  if (t.alat_kode == null) {
    const h: Extract<HasilAlat, { kind: "saran" }> = { kind: "saran", ambigu: false, saran: t.saran };
    const faskesBaru = t.faskes_id == null && t.faskes_teks ? `\nFaskes "${t.faskes_teks}" belum ada di master — akan dicatat sebagai faskes baru.` : "";
    return {
      balasan: balasanSaranAlat(nama, t.alat_teks ?? "", h, null, semuaKode) + faskesBaru,
      hasil: { aksi: "baru", error: "alat-belum-pasti", tertunda_id: t.id, faskes_id: t.faskes_id, saran: t.saran.map((s) => s.kode) },
    };
  }
  return null;
}

/** Tanya bagian yang masih terbuka, atau — bila alat & faskes sudah pasti — buat draftnya (faskes baru bila perlu). */
async function lanjutkanTertunda(k: KsoKonteks, t: BarisTertunda, semuaKode: string[]): Promise<Hasil> {
  const tanya = pertanyaanTertunda(k.nama, t, semuaKode);
  if (tanya) return tanya;
  let id: number;
  try {
    id = await sebagaiBot(async (tx) => {
      let faskes = t.faskes_id;
      if (!faskes) {
        const [f] = await tx`select kso.app_bot_buat_faskes_baru(${k.am_id}, ${t.faskes_teks}, ${t.kota}) as id`;
        faskes = String(f.id);
      } else if (t.kota) await tx`select kso.app_bot_isi_kota_faskes(${k.am_id}, ${faskes}, ${t.kota})`;
      const isian = t.isian;
      const [b] = await tx`
        select kso.app_bot_buat_draft(${k.am_id}, ${faskes}, ${t.alat_kode}, ${(isian.jumlah as number) ?? null},
          ${(isian.volume_estimasi as number) ?? null}, null, ${(isian.harga_per_test as number) ?? null}, null, null, '{}'::text[],
          '[]'::jsonb, ${t.wa_message_id ?? k.wa_message_id}, null, null)::int as id`;
      await tx`select kso.app_bot_lengkapi_draft(${b.id}, ${k.am_id}, ${tx.json(isian as never)})`;
      await tx`select kso.app_bot_tutup_tertunda(${t.id}, ${k.am_id})`;
      return Number(b.id);
    });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, "D?"), hasil: { error: "kso-galat", galat: m.slice(0, 200), tertunda_id: t.id } };
  }
  // PDF yang dikirim BERSAMA pesan #KSO aslinya (tersimpan di baris tertunda), lalu PDF di pesan jawaban ini, lalu PDF
  // terpisah di sekitar pesan asli — draft baru ada sekarang, jadi lampirannya baru diproses sekarang.
  let lampiran: LampiranWa | null = t.lampiran_path ? { wa_message_id: t.lampiran_wa, media_path: t.lampiran_path } : k.lampiran ?? null;
  if (!lampiran && t.wa_message_id && k.cariLampiranDekat) lampiran = await k.cariLampiranDekat(String(t.wa_message_id));
  const ocr = lampiran ? await bacaLampiran(lampiran) : null;
  try {
    return await selesaikan(k, id, { baru: true, ocr, alatTeks: t.alat_teks ?? undefined, faskesTeks: t.faskes_teks ?? undefined,
                                     hasil: { aksi: "baru", dari_tertunda: t.id, alat: t.alat_kode } });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, `D${id}`), hasil: { aksi: "baru", rencana_id: id, error: "kso-galat", galat: m.slice(0, 200) } };
  }
}

/** Ubah baris tertunda (kunci yang ada ditulis apa adanya), baca ulang, lanjutkan. */
async function ubahLanjutkan(k: KsoKonteks, id: number, ubah: Record<string, unknown>, semuaKode: string[]): Promise<Hasil> {
  const t = await sebagaiBot(async (tx) => {
    await tx`select kso.app_bot_tertunda_isi(${id}, ${k.am_id}, ${tx.json(ubah as never)})`;
    return bacaTertunda(tx, k.am_id);
  });
  if (!t) return { balasan: `Usulan yang menunggu sudah kedaluwarsa, ${k.nama}. Kirim ulang dengan format #KSO lengkap.`, hasil: { error: "tanpa-tertunda" } };
  return lanjutkanTertunda(k, t, semuaKode);
}

/** "#KSO ALAT 1" / "#KSO ALAT: Z50" (tanpa D) atau "#KSO D62 ALAT 2": pilih alat untuk isian tertunda. */
async function pilihAlatTertunda(k: KsoKonteks, alatTeks: string, rencanaId: number | null): Promise<Hasil | null> {
  if (rencanaId != null) return pilihAlatDraft(k, alatTeks, rencanaId);
  const alias = await aliasAnalyzer();
  const t = await sebagaiBot(async (tx) => ({ katalog: await muatKatalog(tx, alias), row: await bacaTertunda(tx, k.am_id) }));
  const semuaKode = t.katalog.map((c) => c.kode);
  if (!t.row)
    return { balasan: `Tidak ada usulan yang menunggu pilihan alat, ${k.nama}. Kirim usulan baru dengan format #KSO lengkap.`, hasil: { error: "tanpa-tertunda" } };
  const angka = /^\s*(\d)\s*$/.exec(alatTeks);
  let ubah: Record<string, unknown>;
  if (angka) {
    const s = t.row.saran[Number(angka[1]) - 1];
    if (!s)
      return { balasan: t.row.saran.length ? `Nomor ${angka[1]} tidak ada di daftar alat (1–${t.row.saran.length}).`
                                           : "Tidak ada daftar pilihan alat yang terbuka. Tulis kodenya: #KSO ALAT: KODE",
               hasil: { error: "nomor-alat-salah" } };
    ubah = { alat_kode: s.kode };
  } else {
    const h = cariAlat(alatTeks, t.katalog);
    ubah = h.kind === "one" ? { alat_kode: h.kode, alat_teks: alatTeks, saran: [] } : { alat_kode: null, alat_teks: alatTeks, saran: h.saran };
  }
  return ubahLanjutkan(k, t.row.id, ubah, semuaKode);
}

/** "#KSO FASKES 1" / "#KSO FASKES BARU" / "#KSO FASKES: NAMA" — faskes untuk usulan tertunda. null = tak ada yang tertunda (bukan jawaban). */
async function pilihFaskesTertunda(k: KsoKonteks, teks: string, kota: string | null): Promise<Hasil | null> {
  const alias = await aliasAnalyzer();
  const pil = bacaPilihanFaskes(teks);
  const t = await sebagaiBot(async (tx) => ({ katalog: await muatKatalog(tx, alias), row: await bacaTertunda(tx, k.am_id) }));
  const semuaKode = t.katalog.map((c) => c.kode);
  if (!t.row) {
    if (pil.kind === "nama") return null;
    return { balasan: `Tidak ada usulan yang menunggu pilihan faskes, ${k.nama}. Kirim usulan baru dengan format #KSO lengkap.`, hasil: { error: "tanpa-tertunda" } };
  }
  const r = t.row;
  let ubah: Record<string, unknown>;
  if (pil.kind === "nomor") {
    const s = r.faskes_saran[pil.n - 1];
    if (!s)
      return { balasan: r.faskes_saran.length ? `Nomor ${pil.n} tidak ada di daftar faskes (1–${r.faskes_saran.length}).`
                                              : "Tidak ada daftar pilihan faskes yang terbuka. Tulis namanya: #KSO FASKES: NAMA FASKES",
               hasil: { error: "nomor-faskes-salah" } };
    ubah = { faskes_id: s.id, faskes_teks: r.faskes_teks, faskes_saran: [] };
  } else if (pil.kind === "baru") {
    if (!r.faskes_teks)
      return { balasan: "Nama faskes barunya belum ada — tulis: #KSO FASKES: NAMA FASKES", hasil: { error: "faskes-baru-tanpa-nama" } };
    ubah = { faskes_id: null, faskes_teks: r.faskes_teks, faskes_saran: [] };
  } else {
    const h = await sebagaiBot((tx) => cariFaskesBot(tx, pil.nama));
    ubah = h.kind === "one" ? { faskes_id: h.id, faskes_teks: pil.nama, faskes_saran: [] }
      : { faskes_id: null, faskes_teks: pil.nama, faskes_saran: h.kind === "saran" ? h.saran : [] };
  }
  if (kota) ubah.kota = kota;
  return ubahLanjutkan(k, r.id, ubah, semuaKode);
}

/** "#KSO D62 ALAT 2" / "#KSO D62 ALAT: Z50": pilih alat untuk draft yang sudah ada (pilihan dari koreksi alat). */
async function pilihAlatDraft(k: KsoKonteks, alatTeks: string, rencanaId: number): Promise<Hasil | null> {
  const alias = await aliasAnalyzer();
  const t = await sebagaiBot(async (tx) => {
    const katalog = await muatKatalog(tx, alias);
    const [row] = await tx`select id::int, saran, wa_message_id from kso.intake_tertunda
                            where am_id = ${k.am_id} and selesai_at is null and rencana_id = ${rencanaId}
                              and dibuat_at > now() - interval '24 hours'
                            order by dibuat_at desc limit 1`;
    return { katalog, row };
  });
  const angka = /^\s*(\d)\s*$/.exec(alatTeks);
  if (!t.row) {
    if (!angka) return null; // koreksi alat biasa untuk draft — jalur lengkapi
    return { balasan: `Tidak ada daftar pilihan alat yang terbuka untuk D${rencanaId}. Tulis kodenya: #KSO D${rencanaId} ALAT: KODE`,
             hasil: { error: "tanpa-tertunda" } };
  }
  const saran = (t.row.saran as SaranAlat[]) ?? [];
  let pilih: { kode: string; nama: string } | null = null;
  if (angka) {
    const s = saran[Number(angka[1]) - 1];
    if (!s) return { balasan: `Nomor ${angka[1]} tidak ada di daftar (1–${saran.length}).`, hasil: { error: "nomor-alat-salah" } };
    pilih = s;
  } else {
    const h = cariAlat(alatTeks, t.katalog);
    if (h.kind === "one") pilih = { kode: h.kode, nama: h.nama };
    else {
      await sebagaiBot((tx) => tx`select kso.app_bot_simpan_tertunda(${k.am_id}, ${rencanaId}, null, '{}'::jsonb,
                                    ${alatTeks}, ${tx.json(h.saran as never)}, ${t.row.wa_message_id ?? null})`);
      return { balasan: balasanSaranAlat(k.nama, alatTeks, h, `D${rencanaId}`, t.katalog.map((c) => c.kode)),
               hasil: { aksi: "pilih-alat", error: "alat-belum-pasti", saran: h.saran.map((s) => s.kode) } };
    }
  }
  try {
    await sebagaiBot(async (tx) => {
      await tx`select kso.app_bot_lengkapi_draft(${rencanaId}, ${k.am_id}, ${tx.json({ alat_kode: pilih!.kode } as never)})`;
      await tx`select kso.app_bot_tutup_tertunda(${t.row.id}, ${k.am_id})`;
    });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, `D${rencanaId}`), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
  }
  const ocr = k.lampiran ? await bacaLampiran(k.lampiran) : null;
  return selesaikan(k, rencanaId, { baru: false, ocr, alatTeks: angka ? undefined : alatTeks,
                                    hasil: { aksi: "lengkapi", dari_tertunda: t.row.id, alat: pilih.kode } });
}

/** Kerjakan satu perintah #KSO. Mengembalikan teks balasan + ringkasan untuk processed_result. */
export async function prosesKso(k: KsoKonteks): Promise<Hasil> {
  const p = k.perintah;
  const ref = p.nomor ?? (p.draftId ? `D${p.draftId}` : "");

  const amAda = await sebagaiBot(async (tx) => (await tx`select 1 from kso.am where id = ${k.am_id}`).length > 0);
  if (!amAda)
    return { balasan: `Maaf ${k.nama}, Anda belum terdaftar sebagai AM di Komite KSO. Hubungi admin.`, hasil: { error: "bukan-am-kso" } };

  if (p.aksi === "kosong") return { balasan: KSO_BANTUAN, hasil: { aksi: "bantuan" } };

  if (p.aksi === "kirim" || p.aksi === "kelonggaran" || p.aksi === "kalah") {
    if (!ref) return { balasan: `Sebutkan nomornya, mis. "#KSO ${p.aksi} D12".`, hasil: { error: "tanpa-ref" } };
    if (p.aksi !== "kirim" && !p.isi) return { balasan: `Sebutkan alasannya, mis. "#KSO ${p.aksi} ${ref} RS minta harga lebih rendah".`, hasil: { error: "tanpa-alasan" } };
    try {
      return await sebagaiBot(async (tx) => {
        const id = await idDariNomor(tx, p);
        if (!id) return { balasan: "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.", hasil: { error: "ref-tidak-ada", ref } };
        if (p.aksi === "kirim") {
          // syarat format baru (fee, kompetitor, lampiran PDF cocok, …) berlaku juga untuk pengajuan manual
          const d = await bacaDraft(tx, id);
          if (d && (d.status === "DRAFT" || d.status === "DITAHAN")) {
            const q = kurangDraft(d);
            if (q.length)
              return {
                balasan: formatBalasanGerbang(d, { belumBisaKirim: true }),
                hasil: { aksi: "kirim", rencana_id: id, error: "belum-lengkap", kurang: q.map((t) => t.kunci) },
              };
          }
          return ajukanDraft(tx, id, k);
        }
        if (p.aksi === "kelonggaran") await tx`select kso.app_bot_minta_kelonggaran(${id}, ${k.am_id}, ${p.isi})`;
        else await tx`select kso.app_bot_catat_kalah(${id}, ${k.am_id}, ${p.isi})`;
        return {
          balasan: p.aksi === "kelonggaran" ? `Permintaan kelonggaran ${ref} dicatat — dibahas di forum berikutnya.` : `${ref} dicatat kalah. Terima kasih sudah melapor.`,
          hasil: { aksi: p.aksi, rencana_id: id },
        };
      });
    } catch (e) {
      const m = (e as Error).message;
      return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
    }
  }

  // "#KSO D12 volume 900" untuk usulan yang SUDAH memegang mandat → volume turun (Pedoman: > 20% = mandat dihitung
  // ulang; keputusan user 5 Nov: dilaporkan AM lewat #KSO). Deterministik. Draft → alur lengkapi biasa (TES).
  const volBaru = p.aksi === "lengkapi" ? volumeDariTeks(p.isi) : null;
  if (volBaru != null && ref) {
    try {
      const hasilVol = await sebagaiBot(async (tx) => {
        const id = await idDariNomor(tx, p);
        if (!id) return { balasan: "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.", hasil: { error: "ref-tidak-ada", ref } };
        const [st] = await tx`select status::text as status from kso.rencana_kso where id = ${id}`;
        if (!["DIPUTUS_AM", "DIPUTUS_HOD", "MANDAT_TERBIT", "PENAWARAN_TERBIT"].includes(String(st?.status))) return null;
        const [v] = await tx`select kso.app_bot_volume_turun(${id}, ${k.am_id}, ${volBaru}) as h`;
        const h = v.h as Record<string, unknown>;
        return { balasan: balasanVolumeTurun(ref, h), hasil: { aksi: "volume", rencana_id: id, ...h } };
      });
      if (hasilVol) return hasilVol;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
    }
  }

  const x = bacaIsianFormat(p.isi);
  const tidakTerbaca = x.tidakTerbaca.map((t) => `${NAMA_LABEL[t.label]} "${t.nilai}" tidak terbaca — ${t.sebab}.`);
  const tanpaTipe = x.pendukung.filter((q) => !q.tipe).map((q) => q.nama);

  if (p.aksi === "lengkapi") return lengkapi(k, x, ref, tidakTerbaca, tanpaTipe);

  // ---- baru
  // jawaban isian tertunda: "#KSO ALAT 1" / "#KSO FASKES 2" / "#KSO FASKES BARU" (tanpa nama, satu label)
  if (!p.nama && x.alat && !x.faskes) return (await pilihAlatTertunda(k, x.alat, null))!;
  if (!p.nama && x.faskes && !x.alat) {
    const r = await pilihFaskesTertunda(k, x.faskes, x.kota ?? null);
    if (r) return r;
  }
  if (!x.faskes || !x.alat) return { balasan: balasanFormatSalah(x), hasil: { error: "format-tidak-sesuai", label: x.label } };
  const kandidat = await namaPengirim(k.am_id, k);
  if (!p.nama)
    return { balasan: `Nama kamu belum ditulis di baris #KSO, ${k.nama}. Usulan BELUM dicatat — tulis baris pertama: #KSO ${k.nama.split(/\s+/)[0].toUpperCase()}`,
             hasil: { error: "nama-kosong" } };
  if (!namaCocok(p.nama, kandidat))
    return {
      balasan: `Maaf, nama di baris #KSO ("${p.nama}") tidak sama dengan pengirim pesan (${k.nama}). Usulan BELUM dicatat.\n` +
        `Usulan KSO hanya bisa dikirim oleh AM-nya sendiri — tulis nama kamu sendiri: #KSO ${k.nama.split(/\s+/)[0].toUpperCase()}`,
      hasil: { error: "nama-tidak-cocok", nama_kepala: p.nama },
    };

  const alias = await aliasAnalyzer();
  let tahap1: Hasil | { id: number; alatTeks: string };
  try {
    tahap1 = await sebagaiBot(async (tx): Promise<Hasil | { id: number; alatTeks: string }> => {
      const katalog = await muatKatalog(tx, alias);
      const isian = isianLengkapiDariFormat(x);
      // 303: faskes boleh customer baru — pasti → dipakai; mirip → AM memilih; tak ada yang mirip → faskes baru
      const f = await cariFaskesBot(tx, x.faskes!);
      const a = cariAlat(x.alat!, katalog);
      if (f.kind === "saran" || a.kind !== "one") {
        const faskesId = f.kind === "one" ? f.id : null;
        const faskesSaran = f.kind === "saran" ? f.saran : [];
        const alatKode = a.kind === "one" ? a.kode : null;
        const alatSaran = a.kind === "saran" ? a.saran : [];
        const [t] = await tx`select kso.app_bot_tertunda_simpan(${k.am_id}, ${tx.json(isian as never)}, ${k.wa_message_id},
                               ${faskesId}, ${x.faskes!}, ${tx.json(faskesSaran as never)}, ${x.kota ?? null},
                               ${alatKode}, ${x.alat!}, ${tx.json(alatSaran as never)},
                               ${k.lampiran?.wa_message_id ?? null}, ${k.lampiran?.media_path ?? null})::int as id`;
        const tanya = pertanyaanTertunda(k.nama, { id: Number(t.id), faskes_id: faskesId, alat_teks: x.alat!, saran: alatSaran, alat_kode: alatKode,
                                                   faskes_teks: x.faskes!, faskes_saran: faskesSaran }, katalog.map((c) => c.kode))!;
        return { balasan: tanya.balasan, hasil: { ...tanya.hasil, ...(k.lampiran ? { lampiran_menunggu: k.lampiran.wa_message_id } : {}) } };
      }
      let faskesId: string;
      if (f.kind === "one") {
        faskesId = f.id;
        if (f.baru && x.kota) await tx`select kso.app_bot_isi_kota_faskes(${k.am_id}, ${faskesId}, ${x.kota})`;
      } else {
        const [fb] = await tx`select kso.app_bot_buat_faskes_baru(${k.am_id}, ${x.faskes!}, ${x.kota ?? null}) as id`;
        faskesId = String(fb.id);
      }
      const [b] = await tx`
        select kso.app_bot_buat_draft(${k.am_id}, ${faskesId}, ${a.kode}, ${(isian.jumlah as number) ?? null}, ${(isian.volume_estimasi as number) ?? null},
          null, ${(isian.harga_per_test as number) ?? null}, null, null, '{}'::text[], '[]'::jsonb, ${k.wa_message_id}, null, null)::int as id`;
      await tx`select kso.app_bot_lengkapi_draft(${b.id}, ${k.am_id}, ${tx.json(isian as never)})`;
      return { id: Number(b.id), alatTeks: x.alat! };
    });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, "D?"), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
  }
  if ("balasan" in tahap1) return tahap1;
  const ocr = k.lampiran ? await bacaLampiran(k.lampiran) : null;
  try {
    return await selesaikan(k, tahap1.id, { baru: true, ocr, alatTeks: tahap1.alatTeks, faskesTeks: x.faskes, tanpaTipe,
      catatan: [...tidakTerbaca, ...(x.lampiran && !k.lampiran ? ["LAMPIRAN: ADA — PDF-nya belum terlihat; kirim PDF Simulator di chat ini dalam 10 menit."] : [])],
      hasil: { aksi: "baru" } });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, `D${tahap1.id}`), hasil: { aksi: "baru", rencana_id: tahap1.id, error: "kso-galat", galat: m.slice(0, 200) } };
  }
}

/** "#KSO D12 LABEL: isi" (beberapa baris boleh) dan "#KSO D12" (+ PDF). */
async function lengkapi(k: KsoKonteks, x: IsianFormat, ref: string, tidakTerbaca: string[], tanpaTipe: string[]): Promise<Hasil> {
  const p = k.perintah;
  let id: number | null;
  try {
    id = await sebagaiBot((tx) => idDariNomor(tx, p));
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
  }
  if (!id) return { balasan: "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.", hasil: { error: "ref-tidak-ada", ref } };

  // "#KSO D62" tanpa isi: PDF pasangannya, atau ringkasan status draft
  if (!p.isi.trim()) {
    const ocr = k.lampiran ? await bacaLampiran(k.lampiran) : null;
    try {
      return await selesaikan(k, id, { baru: false, ocr, hasil: { aksi: k.lampiran ? "lampiran" : "status" },
        catatan: k.lampiran ? [] : [`PDF Simulator untuk ${ref}: kirim di chat ini dalam ${KSO_JENDELA_MENIT} menit.`] });
    } catch (e) {
      const m = (e as Error).message;
      return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
    }
  }
  if (x.alat && /^\s*\d\s*$/.test(x.alat)) {
    const r = await pilihAlatTertunda(k, x.alat, id);
    if (r) return r;
  }
  if (!x.label.length)
    return {
      balasan: `Tidak ada isian yang dikenali untuk ${ref}. Tulis berlabel, satu per baris, mis.:\n#KSO ${ref} PENDUKUNG: dr. Contoh, kepala instalasi lab\n` +
        `Label: ${Object.values(NAMA_LABEL).filter((l) => l !== "LAMPIRAN").join(", ")}.`,
      hasil: { aksi: "lengkapi", rencana_id: id, kosong: true },
    };

  const alias = await aliasAnalyzer();
  const catatan: string[] = [...tidakTerbaca];
  let alatTeks: string | undefined;
  try {
    const saranBalas = await sebagaiBot(async (tx): Promise<Hasil | null> => {
      const awal = await bacaDraft(tx, id!);
      const isian = isianLengkapiDariFormat(x);
      if (x.alat) {
        const katalog = await muatKatalog(tx, alias);
        const a = cariAlat(x.alat, katalog);
        if (a.kind === "one") { isian.alat_kode = a.kode; alatTeks = x.alat; }
        else {
          await tx`select kso.app_bot_simpan_tertunda(${k.am_id}, ${id}, null, '{}'::jsonb, ${x.alat}, ${tx.json(a.saran as never)}, ${k.wa_message_id})`;
          catatan.push(balasanSaranAlat(k.nama, x.alat, a, ref, katalog.map((c) => c.kode)));
        }
      }
      if (x.faskes && awal && !awal.faskes.toLowerCase().includes(x.faskes.toLowerCase()))
        catatan.push("Faskes tidak bisa diganti di draft yang sama — kirim #KSO baru untuk faskes lain.");
      // 303/304: "#KSO D12 KOTA: SURABAYA" — tidak diminta lagi, tetap diterima untuk faskes baru (mengganti default area
      // AM, tak menimpa kota yang ditulis/dari PDF). Faskes master: diabaikan diam-diam (kota dari master customer).
      if (x.kota && awal?.faskes_baru && awal.faskes_id) {
        const [kt] = await tx`select kso.app_bot_isi_kota_faskes(${k.am_id}, ${awal.faskes_id}, ${x.kota}) as ok`;
        catatan.push(kt?.ok ? `Kota faskes baru dicatat: ${x.kota}.` : "Kota faskes ini sudah terisi — tidak diubah.");
      }
      if (Object.keys(isian).length === 0 && tanpaTipe.length === 0 && !catatan.length)
        return { balasan: `Tidak ada isian baru yang terbaca untuk ${ref}. Tulis langsung, mis. "#KSO ${ref} MASA KSO: 36".`,
                 hasil: { aksi: "lengkapi", rencana_id: id, kosong: true } };
      if (Object.keys(isian).length) await tx`select kso.app_bot_lengkapi_draft(${id}, ${k.am_id}, ${tx.json(isian as never)})`;
      return null;
    });
    if (saranBalas) return saranBalas;
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
  }
  const ocr = k.lampiran ? await bacaLampiran(k.lampiran) : null;
  try {
    return await selesaikan(k, id, { baru: false, ocr, alatTeks, tanpaTipe, catatan, faskesTeks: x.faskes,
                                     hasil: { aksi: "lengkapi", kunci: x.label } });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
  }
}

/** Pesan PDF (wa_message.message_id) yang sudah tercatat sebagai lampiran usulan mana pun — supaya satu PDF diproses sekali. */
export async function lampiranSudahDicatat(waIds: string[]): Promise<Set<string>> {
  if (!waIds.length) return new Set();
  const rows = await sebagaiBot((tx) => tx`select distinct wa_message_id from kso.rencana_lampiran where wa_message_id = any(${waIds})`);
  return new Set(rows.map((r) => String(r.wa_message_id)));
}

/** Untuk inbound: pesan #KSO ini boleh memakai PDF pasangan (usulan baru / "#KSO D12" / melengkapi). */
export function ksoBolehLampiran(p: KsoPerintah): boolean {
  return p.aksi === "baru" || p.aksi === "lengkapi";
}

export { teksGalatOcr };
export type { HasilAlat };
