import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { upsertDigests } from "./monitor.js";

// F-CASHIN — Mitigasi Uang Masuk Harian.
//
// Pembacaan dokumen ada di services/ai (/parse-koran: parser teks per-bank,
// fallback OCR vision). Modul ini yang memutuskan ARTI tiap baris dan menyusun
// angka untuk resume Direktur.
//
// Tiga hal yang menentukan bentuk kode di bawah, semuanya dari data nyata
// folder REKENING KORAN (31 Agu – 4 Sep 2026):
//
//  1. DANA PUTERAN HANYA DIBUKTIKAN PASANGAN. Nama "WAHANA RIZKY" di deskripsi
//     TIDAK cukup: BJTM 31 Agu punya kredit 9.758.840 berdeskripsi
//     '0321018688WAHANARIZKYGUMILANGP' (nomor + nama rekening sendiri) yang
//     TIDAK berpasangan dengan debit mana pun — itu uang masuk riil. Aturan
//     berbasis nama akan memotongnya dari penerimaan hari itu.
//
//  2. TIDAK SEMUA REKENING ITU KAS. Dari 10 rekening: 3 fasilitas pinjaman
//     (Index 881 & 131, Hana — saldo negatif), 1 giro escrow (Index 336).
//     Mutasi di sana bukan penerimaan usaha, jadi total uang masuk dihitung
//     HANYA dari rekening jenis 'kas'. Sisanya dilaporkan sebagai blok
//     terpisah, bukan dibuang tanpa jejak.
//
//  3. YANG TIDAK JELAS TIDAK DITEBAK. Baris berdeskripsi buntu (mis.
//     'Cr Multi CASA' 3.676.320 di Mandiri 4 Sep, tanpa nama pengirim, tanpa
//     nomor referensi) masuk 'belum_ditriage' dan disebut di resume sebagai
//     angka tertahan. Menebaknya sebagai penerimaan membuat total kelihatan
//     rapi padahal belum tentu benar.

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Tanggal hari ini menurut WIB (UTC+7). Pola satu-baris yang sama sudah
 *  dipakai inbound.ts/detectleave.ts/scheduler.ts; diexport dari sini supaya
 *  endpoint /cashin/* dan job cashin-resume memakai definisi yang sama. */
export const wibDate = (): string =>
  new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// ── kategori ─────────────────────────────────────────────────────────────────

const RE_BUNGA = /\bbunga\b|jasa\s*giro|pembayaran\s+bunga/i;
const RE_PAJAK_BIAYA = /\bpajak\b|\bpph\b|biaya\s*adm|admin\s*fee|transfer\s*fee|(^|\s)fee(\s|$)/i;
const RE_DEPOSITO = /\bfd\s*tr\b|profit\s*payment|deposito|\bbilyet\b/i;
// Pemindahbukuan internal Bank Index ('PaymentFromBuffer SETOR PEMINDAHBUKUAN').
// Dipakai HANYA sebagai catatan pada baris yang tak ketemu pasangannya —
// bukan untuk melabeli puteran, lihat alasan (1) di atas.
const RE_INTERNAL_WORDING = /pemindahbukuan|paymentfrom(buffer|operational)/i;

// Deskripsi yang tak bisa ditafsirkan siapa pun tanpa membuka mutasi di bank.
// 'Cr Multi CASA' sedang dikroscek Finance (per 7 Sep 2026) — begitu jawabannya
// masuk, pindahkan ke aturan yang tepat dan hapus dari daftar ini.
const RE_BUNTU = /^\s*-?\s*$|^cr\s+multi\s+casa$/i;

export type Kategori =
  | "uang_masuk_riil"
  | "afiliasi_grup"
  | "puteran_internal"
  | "bunga"
  | "deposito"
  | "refund"
  | "biaya_pajak"
  | "pengeluaran"
  | "belum_ditriage";

export interface KoranLine {
  urut: number;
  waktu: string | null;
  deskripsi: string;
  debit: number;
  kredit: number;
  saldo: number | null;
  referensi: string | null;
}

/** Kategori awal satu baris, TANPA melihat pasangan puteran (itu tahap terpisah
 *  yang butuh seluruh statement hari itu). Urutan cek = urutan menang. */
export function kategoriAwal(line: KoranLine, polaAfiliasi: string[]): Kategori {
  const d = line.deskripsi || "";
  const isKredit = (line.kredit || 0) > 0;

  if (RE_BUNGA.test(d)) return "bunga";
  if (RE_DEPOSITO.test(d)) return "deposito";
  // Biaya/pajak dicek sebelum 'pengeluaran' supaya baris fee 2.500 tidak
  // tercampur dengan pembayaran vendor.
  if (!isKredit && RE_PAJAK_BIAYA.test(d)) return "biaya_pajak";
  if (isKredit) {
    // Afiliasi hanya berlaku untuk sisi TERIMA. Pembayaran WRG *kepada*
    // afiliasi (Mandiri 4 Sep: Pratamindo 25 jt, Insan Wahana 5 jt) tetap
    // pengeluaran biasa — kalau ikut dilabeli 'afiliasi_grup', angka itu hilang
    // dari total pengeluaran sekaligus muncul di baris penerimaan afiliasi.
    if (polaAfiliasi.some((p) => p && d.toUpperCase().includes(p.toUpperCase()))) {
      return "afiliasi_grup";
    }
    if (RE_BUNTU.test(d.trim())) return "belum_ditriage";
    if (RE_INTERNAL_WORDING.test(d)) return "belum_ditriage";
    return "uang_masuk_riil";
  }
  return "pengeluaran";
}

// ── ingest ───────────────────────────────────────────────────────────────────

export interface IngestKoranInput {
  /** Isi file. Salah satu dari file_path (dibaca dari disk) atau pdf_base64. */
  file_path?: string | null;
  pdf_base64?: string | null;
  file_nama?: string | null;
  sumber: "wa" | "web";
  wa_message_id?: string | null;
  /** Paksa jalur parser teks saja (tanpa OCR) — dipakai re-ingest massal. */
  allow_ocr?: boolean;
}

export interface IngestKoranResult {
  ok: true;
  statement_id: string;
  label_file: string;
  tanggal: string;
  status: string;
  metode: string;
  checksum_ok: boolean | null;
  saldo_bersambung_ok: boolean | null;
  jumlah_baris: number;
  total_kredit: number;
  total_debit: number;
  parse_error: string | null;
}

/** Cocokkan file ke rekening. Nomor rekening dari ISI dokumen selalu menang;
 *  label dari nama file hanya cadangan (nama file di folder sumber terbukti
 *  bisa salah tanggal dan salah ekstensi). */
async function resolveAccount(
  noRekening: string | null,
  fileNama: string | null,
): Promise<{ id: string; label_file: string; jenis: string } | null> {
  const sql = db();
  if (noRekening) {
    const digits = String(noRekening).replace(/\D/g, "");
    if (digits) {
      // `[^0-9]`, BUKAN `\D`: di dalam template literal `\D` luruh jadi `D`,
      // sehingga polanya membuang huruf D dari nomor rekening alih-alih
      // karakter non-digit — '123-456' tetap '123-456' dan tak pernah sama
      // dengan `digits` yang sudah bersih. Gagalnya senyap: rekening lolos ke
      // pencocokan nama file. Bentuk kelas karakter ini juga yang dipakai
      // master.ts, approval.ts, listmembers.ts, dan users.ts.
      const rows = await sql`
        SELECT id, label_file, jenis FROM bank_account
        WHERE regexp_replace(COALESCE(no_rekening, ''), '[^0-9]', '', 'g') = ${digits}
        LIMIT 1
      `;
      if (rows.length) {
        return { id: String(rows[0].id), label_file: String(rows[0].label_file), jenis: String(rows[0].jenis) };
      }
    }
  }
  if (fileNama) {
    // Label ada di awal nama file: 'MDR 038 040926.pdf', 'INDEX 881 010926.pdf'.
    // Dicocokkan dari label TERPANJANG dulu supaya 'INDEX 881' tidak kalah oleh
    // pola yang lebih pendek.
    //
    // Spasi DIBUANG di kedua sisi sebelum dibandingkan. Nama file yang dikirim
    // admin tidak konsisten spasinya — di folder sumber ada 'INDEX 131  020926.pdf'
    // (spasi ganda) dan 'BJTM 030926 pdf' (titik ekstensi hilang). Pencocokan
    // yang peka spasi akan menolak file yang jelas-jelas bisa dikenali manusia,
    // lalu menyalahkan adminnya. 'INDEX 881' vs 'INDEX 890' tetap terpisah
    // setelah spasi dibuang, jadi tak ada label yang jadi ambigu.
    const kunci = basename(fileNama).toUpperCase().replace(/\s+/g, "");
    const rows = await sql`
      SELECT id, label_file, jenis FROM bank_account
      ORDER BY length(replace(label_file, ' ', '')) DESC
    `;
    for (const r of rows) {
      const label = String(r.label_file).toUpperCase().replace(/\s+/g, "");
      if (label && kunci.startsWith(label)) {
        return { id: String(r.id), label_file: String(r.label_file), jenis: String(r.jenis) };
      }
    }
  }
  return null;
}

export async function ingestKoran(
  input: IngestKoranInput,
): Promise<IngestKoranResult | ActionResult> {
  const sql = db();

  let pdfBase64 = input.pdf_base64 ?? null;
  if (!pdfBase64) {
    if (!input.file_path) return { ok: false, error: "butuh file_path atau pdf_base64" };
    try {
      pdfBase64 = (await readFile(input.file_path)).toString("base64");
    } catch (e) {
      return { ok: false, error: `gagal baca file: ${(e as Error).message}` };
    }
  }
  const fileNama = input.file_nama ?? (input.file_path ? basename(input.file_path) : null);

  const { status, data } = await callAi("/parse-koran", {
    pdf_base64: pdfBase64,
    file_nama: fileNama,
    allow_ocr: input.allow_ocr !== false,
    dry_run: aiDryRun(),
  });
  if (status >= 400) {
    return { ok: false, error: `services/ai /parse-koran status ${status}: ${JSON.stringify(data)}` };
  }

  const acc = await resolveAccount((data.no_rekening as string) ?? null, fileNama);
  if (!acc) {
    return {
      ok: false,
      error:
        "rekening tidak dikenali. Nomor di dokumen: " +
        `${(data.no_rekening as string) ?? "(tak terbaca)"}, nama file: ${fileNama ?? "(tak ada)"}. ` +
        "Tambahkan rekeningnya di menu Rekening dulu.",
    };
  }

  const tanggal = (data.tanggal as string) ?? null;
  if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    // Tanggal SENGAJA tidak diambil dari nama file walau tersedia — lihat
    // catatan migrasi 169. Lebih baik menolak dan minta cetak ulang daripada
    // menyimpan mutasi di tanggal yang salah.
    return {
      ok: false,
      error: `tanggal tidak terbaca dari isi dokumen (${acc.label_file}). File tidak diproses — tanggal dari nama file tidak dipakai karena tidak bisa dipercaya.`,
    };
  }

  const lines = ((data.lines as KoranLine[]) ?? []).map((l) => ({
    urut: Number(l.urut),
    waktu: l.waktu ?? null,
    deskripsi: String(l.deskripsi ?? ""),
    debit: Number(l.debit ?? 0),
    kredit: Number(l.kredit ?? 0),
    saldo: l.saldo == null ? null : Number(l.saldo),
    referensi: l.referensi ?? null,
  }));

  const checksumOk = data.checksum_ok == null ? null : Boolean(data.checksum_ok);
  const parseError = (data.parse_error as string) ?? null;

  const polaRows = await sql`SELECT pola FROM bank_afiliasi WHERE aktif`;
  const polaAfiliasi = polaRows.map((r) => String(r.pola));

  // Upsert statement + ganti seluruh barisnya. Upload ulang = perbaikan
  // (parser/OCR bisa diperbaiki lalu di-ingest lagi), bukan penambahan yang
  // membuat total dobel — karena itu DELETE baris lama, bukan append.
  const [stmt] = await sql`
    INSERT INTO bank_statement (
      bank_account_id, tanggal, saldo_awal, saldo_akhir,
      total_debit_tercetak, total_kredit_tercetak, jumlah_debit, jumlah_kredit,
      dicetak_at, sumber, wa_message_id, file_path, file_nama, metode, model_used,
      ocr_dry_run, checksum_ok, status, parse_error, raw_text
    ) VALUES (
      ${acc.id}, ${tanggal}, ${(data.saldo_awal as number) ?? null}, ${(data.saldo_akhir as number) ?? null},
      ${(data.total_debit_tercetak as number) ?? null}, ${(data.total_kredit_tercetak as number) ?? null},
      ${(data.jumlah_debit as number) ?? null}, ${(data.jumlah_kredit as number) ?? null},
      ${(data.dicetak_at as string) ?? null}, ${input.sumber}, ${input.wa_message_id ?? null},
      ${input.file_path ?? null}, ${fileNama}, ${(data.metode as string) ?? "parser"},
      ${(data.model as string) ?? null}, ${Boolean(data.dry_run)}, ${checksumOk},
      ${checksumOk === true ? "terverifikasi" : "perlu_review"}, ${parseError},
      ${(data.raw_text as string) ?? null}
    )
    ON CONFLICT (bank_account_id, tanggal) DO UPDATE SET
      saldo_awal = EXCLUDED.saldo_awal, saldo_akhir = EXCLUDED.saldo_akhir,
      total_debit_tercetak = EXCLUDED.total_debit_tercetak,
      total_kredit_tercetak = EXCLUDED.total_kredit_tercetak,
      jumlah_debit = EXCLUDED.jumlah_debit, jumlah_kredit = EXCLUDED.jumlah_kredit,
      dicetak_at = EXCLUDED.dicetak_at, sumber = EXCLUDED.sumber,
      wa_message_id = EXCLUDED.wa_message_id, file_path = EXCLUDED.file_path,
      file_nama = EXCLUDED.file_nama, metode = EXCLUDED.metode,
      model_used = EXCLUDED.model_used, ocr_dry_run = EXCLUDED.ocr_dry_run,
      checksum_ok = EXCLUDED.checksum_ok, status = EXCLUDED.status,
      parse_error = EXCLUDED.parse_error, raw_text = EXCLUDED.raw_text,
      updated_at = now()
    RETURNING id
  `;
  const statementId = String(stmt.id);
  await sql`DELETE FROM bank_statement_line WHERE statement_id = ${statementId}`;

  for (const l of lines) {
    const kat = kategoriAwal(l, polaAfiliasi);
    const catatan =
      kat === "belum_ditriage" && RE_INTERNAL_WORDING.test(l.deskripsi)
        ? "diduga pemindahbukuan internal — pasangan debit/kredit belum ketemu"
        : null;
    await sql`
      INSERT INTO bank_statement_line (
        statement_id, urut, waktu, deskripsi, debit, kredit, saldo, referensi, kategori, kategori_oleh, catatan
      ) VALUES (
        ${statementId}, ${l.urut}, ${l.waktu}, ${l.deskripsi}, ${l.debit}, ${l.kredit},
        ${l.saldo}, ${l.referensi}, ${kat}, 'aturan', ${catatan}
      )
    `;
  }

  await matchPuteran(tanggal);
  const bersambung = await cekSaldoBersambung(acc.id, tanggal);

  const [agg] = await sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(debit),0)::numeric AS d, COALESCE(SUM(kredit),0)::numeric AS k
    FROM bank_statement_line WHERE statement_id = ${statementId}
  `;
  const [fin] = await sql`SELECT status FROM bank_statement WHERE id = ${statementId}`;

  return {
    ok: true,
    statement_id: statementId,
    label_file: acc.label_file,
    tanggal,
    status: String(fin.status),
    metode: (data.metode as string) ?? "parser",
    checksum_ok: checksumOk,
    saldo_bersambung_ok: bersambung,
    jumlah_baris: Number(agg.n),
    total_debit: Number(agg.d),
    total_kredit: Number(agg.k),
    parse_error: parseError,
  };
}

// ── pencocokan pasangan puteran ──────────────────────────────────────────────

/** Toleransi jarak waktu antar sisi puteran. 30 menit: pada data nyata jaraknya
 *  1–4 menit (BJTM 17:07:32 → Mandiri 17:08:45), tapi ada bank yang tidak
 *  mencetak jam sama sekali (Bank Index) — baris tanpa jam dicocokkan hanya
 *  berdasarkan tanggal + nominal. */
const TOLERANSI_MENIT = 30;

/** Pasangkan debit di satu rekening dengan kredit bernominal sama di rekening
 *  lain pada tanggal yang sama, lalu tandai keduanya 'puteran_internal'.
 *
 *  Dijalankan ulang untuk SELURUH tanggal setiap kali ada statement masuk:
 *  pasangan baru bisa muncul karena file lawannya baru di-upload belakangan
 *  (mis. koran Mandiri disetor jam 5 sore, koran Hana baru besok pagi).
 *
 *  Baris yang sudah ditriage manusia (kategori_oleh='manual') TIDAK ditimpa. */
export async function matchPuteran(tanggal: string): Promise<number> {
  const sql = db();
  const rows = await sql`
    SELECT l.id, l.debit, l.kredit, l.waktu, l.deskripsi, l.kategori, l.kategori_oleh, s.bank_account_id
    FROM bank_statement_line l
    JOIN bank_statement s ON s.id = l.statement_id
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE s.tanggal = ${tanggal} AND a.milik_wrg AND l.pasangan_line_id IS NULL
    ORDER BY l.waktu NULLS LAST, l.id
  `;

  type Row = {
    id: string; debit: number; kredit: number; waktu: string | null;
    bank_account_id: string; kategori_oleh: string; deskripsi: string;
  };
  const debits: Row[] = [];
  const credits: Row[] = [];
  for (const r of rows) {
    const row: Row = {
      id: String(r.id),
      debit: Number(r.debit),
      kredit: Number(r.kredit),
      waktu: r.waktu ? new Date(r.waktu as string).toISOString() : null,
      bank_account_id: String(r.bank_account_id),
      kategori_oleh: String(r.kategori_oleh),
      deskripsi: String(r.deskripsi ?? ""),
    };
    if (row.debit > 0) debits.push(row);
    else if (row.kredit > 0) credits.push(row);
  }

  const dipakai = new Set<string>();
  const pasangan: Array<[string, string]> = [];
  for (const d of debits) {
    const cocok = credits.find(
      (c) =>
        !dipakai.has(c.id) &&
        c.bank_account_id !== d.bank_account_id && // pindah antar rekening, bukan dalam satu rekening
        Math.abs(c.kredit - d.debit) < 0.005 &&
        dalamToleransi(d.waktu, c.waktu) &&
        // Nominal + tanggal saja BELUM cukup: dua transaksi tak berhubungan
        // bisa bernominal sama di hari yang sama (customer bayar 2,5 jt ke BJTM
        // sementara Mandiri bayar vendor 2,5 jt). Salah pasang = uang masuk
        // riil hilang dari total. Jadi minimal SATU sisi harus berbunyi seperti
        // pindah-buku internal. Ini pemakaian nama yang benar: penguat bukti
        // pasangan, bukan bukti tunggal.
        (berbauInternal(d.deskripsi) || berbauInternal(c.deskripsi)),
    );
    if (cocok) {
      dipakai.add(cocok.id);
      pasangan.push([d.id, cocok.id]);
    }
  }

  for (const [debitId, kreditId] of pasangan) {
    await sql`
      UPDATE bank_statement_line SET
        pasangan_line_id = ${kreditId},
        kategori = CASE WHEN kategori_oleh = 'manual' THEN kategori ELSE 'puteran_internal' END,
        kategori_oleh = CASE WHEN kategori_oleh = 'manual' THEN 'manual' ELSE 'aturan' END
      WHERE id = ${debitId}
    `;
    await sql`
      UPDATE bank_statement_line SET
        pasangan_line_id = ${debitId},
        kategori = CASE WHEN kategori_oleh = 'manual' THEN kategori ELSE 'puteran_internal' END,
        kategori_oleh = CASE WHEN kategori_oleh = 'manual' THEN 'manual' ELSE 'aturan' END
      WHERE id = ${kreditId}
    `;
  }
  return pasangan.length;
}

// Nama entitas sendiri + kode SWIFT rekening WRG + kata kerja pindah-buku.
// SWIFT sengaja ikut: deskripsi Mandiri menulis lawan transaksinya sebagai
// 'BIFAST Inc GL-CS PDJTIDJ1/WAHANA RIZKY GUMILANG PT', jadi kode banknya
// sendiri sudah menandai asal internal walau nama terpotong.
const RE_BERBAU_INTERNAL =
  /wahana\s*rizky|wahanarizky|pemindahbukuan|paymentfrom|transfer\s*bi\s*fast|bifast|inhousetrf|pdjtidj1|bmriidja|bidxidja|hnbnidja|bniaidja|bninidja/i;

export function berbauInternal(deskripsi: string): boolean {
  return RE_BERBAU_INTERNAL.test(deskripsi || "");
}

function dalamToleransi(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // salah satu bank tak mencetak jam → cukup tanggal + nominal
  const selisih = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return selisih <= TOLERANSI_MENIT * 60 * 1000;
}

// ── validator saldo bersambung ───────────────────────────────────────────────

/** Bandingkan saldo_akhir hari-N dengan saldo_awal hari-N+1 di rekening yang
 *  sama, dua arah (statement yang baru masuk bisa jadi hari-N maupun hari-N+1).
 *
 *  Gunanya menangkap statement yang dicetak sebelum hari selesai. Terbukti
 *  terjadi: Mandiri 1420075012038 tanggal 2 Sep dicetak 17:55:50, saldo akhir
 *  309.212.500,41, sementara saldo awal 3 Sep 470.560.990,41 — 161,3 juta
 *  transaksi tidak terekam.
 *
 *  NULL = tetangganya belum ada, belum bisa dinilai (bukan berarti aman). */
export async function cekSaldoBersambung(
  bankAccountId: string,
  tanggal: string,
): Promise<boolean | null> {
  const sql = db();
  const nilai = async (id: string, tgl: string): Promise<boolean | null> => {
    const [row] = await sql`
      WITH ini AS (
        SELECT saldo_akhir, tanggal FROM bank_statement
        WHERE bank_account_id = ${id} AND tanggal = ${tgl}
      ), besok AS (
        SELECT saldo_awal FROM bank_statement
        WHERE bank_account_id = ${id} AND tanggal > ${tgl}
        ORDER BY tanggal LIMIT 1
      )
      SELECT ini.saldo_akhir, besok.saldo_awal FROM ini LEFT JOIN besok ON true
    `;
    if (!row) return null;
    if (row.saldo_akhir == null || row.saldo_awal == null) return null;
    return Math.abs(Number(row.saldo_akhir) - Number(row.saldo_awal)) < 0.005;
  };

  const hasilIni = await nilai(bankAccountId, tanggal);
  if (hasilIni !== null) {
    await sql`
      UPDATE bank_statement SET saldo_bersambung_ok = ${hasilIni}, updated_at = now()
      WHERE bank_account_id = ${bankAccountId} AND tanggal = ${tanggal}
    `;
  }
  // Statement yang baru masuk juga menjadi "hari besok" bagi hari sebelumnya —
  // nilai ulang tetangga sebelumnya supaya penilaiannya tidak tertinggal.
  const [prev] = await sql`
    SELECT tanggal FROM bank_statement
    WHERE bank_account_id = ${bankAccountId} AND tanggal < ${tanggal}
    ORDER BY tanggal DESC LIMIT 1
  `;
  if (prev) {
    const tglPrev = String(prev.tanggal).slice(0, 10);
    const hasilPrev = await nilai(bankAccountId, tglPrev);
    if (hasilPrev !== null) {
      await sql`
        UPDATE bank_statement SET saldo_bersambung_ok = ${hasilPrev}, updated_at = now()
        WHERE bank_account_id = ${bankAccountId} AND tanggal = ${tglPrev}
      `;
    }
  }
  return hasilIni;
}

// ── ringkasan harian ─────────────────────────────────────────────────────────

export interface RingkasanHarian {
  tanggal: string;
  uang_masuk_riil: number;
  afiliasi_grup: number;
  puteran_internal: number;
  bunga: number;
  deposito: number;
  refund: number;
  belum_ditriage: number;
  pengeluaran: number;
  /** Mutasi di rekening non-kas (pinjaman/escrow), dilaporkan terpisah. */
  non_kas_kredit: number;
  non_kas_debit: number;
  rekening_wajib: number;
  rekening_masuk: number;
  rekening_belum: string[];
  statement_perlu_review: Array<{ label_file: string; alasan: string }>;
  penerimaan_terbesar: Array<{ label_file: string; deskripsi: string; kredit: number }>;
  puteran_detail: Array<{ dari: string; ke: string; nominal: number }>;
}

const NOL: Record<string, number> = {
  uang_masuk_riil: 0, afiliasi_grup: 0, puteran_internal: 0, bunga: 0,
  deposito: 0, refund: 0, belum_ditriage: 0, pengeluaran: 0,
};

/** Kategori yang diukur dari sisi DEBIT (uang keluar). Sisanya dari sisi kredit. */
const ARAH_DEBIT = new Set(["puteran_internal", "pengeluaran", "biaya_pajak"]);

export async function ringkasanHarian(tanggal: string): Promise<RingkasanHarian> {
  const sql = db();

  // Total per kategori HANYA dari rekening jenis 'kas' dan statement yang
  // checksum-nya lolos. Dua penyaring itu yang menjaga angka resume: baris dari
  // rekening pinjaman bukan penerimaan usaha, dan statement yang gagal checksum
  // isinya belum tentu utuh.
  const katRows = await sql`
    SELECT l.kategori, COALESCE(SUM(l.kredit),0)::numeric AS kredit, COALESCE(SUM(l.debit),0)::numeric AS debit
    FROM bank_statement_line l
    JOIN bank_statement s ON s.id = l.statement_id
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE s.tanggal = ${tanggal} AND a.jenis = 'kas' AND s.status = 'terverifikasi'
    GROUP BY l.kategori
  `;
  const per: Record<string, number> = { ...NOL };
  for (const r of katRows) {
    const kat = String(r.kategori);
    // Tiap kategori diukur dari SATU sisi saja. Untuk puteran itu wajib: satu
    // transfer 100 jt tercatat sebagai debit 100 jt di rekening asal DAN kredit
    // 100 jt di rekening tujuan, jadi menjumlahkan dua-duanya melaporkan 200 jt
    // dana puteran yang tidak pernah ada. Sisi debit yang dipakai = "dana yang
    // diputar keluar hari itu".
    per[kat] = ARAH_DEBIT.has(kat) ? Number(r.debit) : Number(r.kredit);
  }

  const [nonKas] = await sql`
    SELECT COALESCE(SUM(l.kredit),0)::numeric AS kredit, COALESCE(SUM(l.debit),0)::numeric AS debit
    FROM bank_statement_line l
    JOIN bank_statement s ON s.id = l.statement_id
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE s.tanggal = ${tanggal} AND a.jenis <> 'kas'
  `;

  const wajib = await sql`
    SELECT a.label_file, s.id AS stmt_id, s.status, s.parse_error, s.checksum_ok, s.saldo_bersambung_ok
    FROM bank_account a
    LEFT JOIN bank_statement s ON s.bank_account_id = a.id AND s.tanggal = ${tanggal}
    WHERE a.aktif AND a.wajib_harian
    ORDER BY a.label_file
  `;
  const belum = wajib.filter((r) => !r.stmt_id).map((r) => String(r.label_file));
  const perluReview = wajib
    .filter((r) => r.stmt_id && String(r.status) !== "terverifikasi")
    .map((r) => ({
      label_file: String(r.label_file),
      alasan: String(r.parse_error ?? (r.checksum_ok === null ? "total tak tercetak, checksum tak bisa dinilai" : "checksum gagal")),
    }));
  // Saldo tidak bersambung dilaporkan terpisah: statement-nya bisa lolos
  // checksum (angka di dalamnya konsisten) tapi tetap tidak lengkap karena
  // dicetak sebelum hari selesai.
  for (const r of wajib) {
    if (r.stmt_id && r.saldo_bersambung_ok === false) {
      perluReview.push({
        label_file: String(r.label_file),
        alasan: "saldo akhir tidak bersambung ke hari berikutnya — kemungkinan dicetak sebelum tutup hari",
      });
    }
  }

  const terbesar = await sql`
    SELECT a.label_file, l.deskripsi, l.kredit::numeric AS kredit
    FROM bank_statement_line l
    JOIN bank_statement s ON s.id = l.statement_id
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE s.tanggal = ${tanggal} AND a.jenis = 'kas' AND s.status = 'terverifikasi'
      AND l.kategori IN ('uang_masuk_riil', 'afiliasi_grup') AND l.kredit > 0
    ORDER BY l.kredit DESC LIMIT 5
  `;

  const puteran = await sql`
    SELECT ad.label_file AS dari, ak.label_file AS ke, ld.debit::numeric AS nominal
    FROM bank_statement_line ld
    JOIN bank_statement_line lk ON lk.id = ld.pasangan_line_id
    JOIN bank_statement sd ON sd.id = ld.statement_id
    JOIN bank_statement sk ON sk.id = lk.statement_id
    JOIN bank_account ad ON ad.id = sd.bank_account_id
    JOIN bank_account ak ON ak.id = sk.bank_account_id
    WHERE sd.tanggal = ${tanggal} AND ld.debit > 0
    ORDER BY ld.debit DESC
  `;

  return {
    tanggal,
    uang_masuk_riil: per.uang_masuk_riil,
    afiliasi_grup: per.afiliasi_grup,
    puteran_internal: per.puteran_internal,
    bunga: per.bunga,
    deposito: per.deposito,
    refund: per.refund,
    belum_ditriage: per.belum_ditriage,
    pengeluaran: per.pengeluaran,
    non_kas_kredit: Number(nonKas?.kredit ?? 0),
    non_kas_debit: Number(nonKas?.debit ?? 0),
    rekening_wajib: wajib.length,
    rekening_masuk: wajib.length - belum.length,
    rekening_belum: belum,
    statement_perlu_review: perluReview,
    penerimaan_terbesar: terbesar.map((r) => ({
      label_file: String(r.label_file),
      deskripsi: String(r.deskripsi),
      kredit: Number(r.kredit),
    })),
    puteran_detail: puteran.map((r) => ({
      dari: String(r.dari),
      ke: String(r.ke),
      nominal: Number(r.nominal),
    })),
  };
}

// ── teks resume WA ───────────────────────────────────────────────────────────

const rp = (n: number): string => "Rp " + Math.round(n).toLocaleString("id-ID");

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function formatResume(r: RingkasanHarian): string {
  const [y, m, d] = r.tanggal.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const tgl = `${HARI[dt.getUTCDay()]}, ${String(d).padStart(2, "0")} ${BULAN[m - 1]} ${y}`;

  const baris: string[] = [`*UANG MASUK — ${tgl}*`, ""];
  baris.push(`Uang masuk riil     : ${rp(r.uang_masuk_riil)}`);
  if (r.afiliasi_grup > 0) baris.push(`  + afiliasi grup   : ${rp(r.afiliasi_grup)}`);
  baris.push(`Puteran internal    : ${rp(r.puteran_internal)} (dikecualikan)`);
  if (r.bunga + r.deposito > 0) baris.push(`Bunga/deposito      : ${rp(r.bunga + r.deposito)}`);
  if (r.refund > 0) baris.push(`Refund              : ${rp(r.refund)}`);
  if (r.belum_ditriage > 0) baris.push(`Belum ditriage      : ${rp(r.belum_ditriage)} ⚠️`);

  if (r.penerimaan_terbesar.length) {
    baris.push("", "*Penerimaan terbesar*");
    r.penerimaan_terbesar.forEach((t, i) => {
      const desc = t.deskripsi.length > 42 ? t.deskripsi.slice(0, 41) + "…" : t.deskripsi;
      baris.push(`${i + 1}. ${desc} — ${rp(t.kredit)}`);
    });
  }

  if (r.puteran_detail.length) {
    baris.push("", "*Puteran*");
    for (const p of r.puteran_detail) baris.push(`• ${p.dari} → ${p.ke} ${rp(p.nominal)}`);
  }

  if (r.non_kas_kredit + r.non_kas_debit > 0) {
    baris.push(
      "",
      `_Rekening pinjaman/escrow (di luar hitungan): kredit ${rp(r.non_kas_kredit)}, debit ${rp(r.non_kas_debit)}_`,
    );
  }

  baris.push("", `Koran diterima ${r.rekening_masuk}/${r.rekening_wajib} rekening`);
  if (r.rekening_belum.length) baris.push(`⚠️ Belum setor: ${r.rekening_belum.join(", ")}`);
  for (const s of r.statement_perlu_review) baris.push(`⚠️ ${s.label_file}: ${s.alasan}`);

  return baris.join("\n");
}

// ── job resume harian ────────────────────────────────────────────────────────

export interface RunResumeResult {
  tanggal: string;
  terkirim: boolean;
  alasan?: string;
  rekening_masuk: number;
  rekening_wajib: number;
  uang_masuk_riil: number;
}

/** Hitung ringkasan hari itu, simpan ke monitor_digest, lalu kirim DM ke
 *  Direktur.
 *
 *  Nomor tujuan HARUS datang dari env CASHIN_RESUME_TO. Tanpa itu resume tetap
 *  dihitung dan disimpan, tapi TIDAK dikirim — target broadcast WA ditentukan
 *  manusia, bukan ditebak dari roster oleh sistem.
 *
 *  Hari tanpa satu pun koran masuk (libur, atau admin belum menyetor) juga
 *  tidak dikirim: resume berisi nol rupiah bukan informasi, cuma bikin
 *  penerimanya berhenti membaca notifikasi ini. */
export async function runCashinResume(tanggal?: string): Promise<RunResumeResult> {
  const tgl = tanggal ?? wibDate();
  const r = await ringkasanHarian(tgl);
  const teks = formatResume(r);

  await upsertDigests([{ kind: "cashin", tanggal: tgl, waktu: null, content: teks }]);

  const dasar = {
    tanggal: tgl,
    rekening_masuk: r.rekening_masuk,
    rekening_wajib: r.rekening_wajib,
    uang_masuk_riil: r.uang_masuk_riil,
  };

  if (r.rekening_masuk === 0) {
    return { ...dasar, terkirim: false, alasan: "belum ada koran masuk hari ini" };
  }
  const tujuan = (process.env.CASHIN_RESUME_TO ?? "").trim();
  if (!tujuan) {
    return { ...dasar, terkirim: false, alasan: "CASHIN_RESUME_TO belum di-set (nomor WA Direktur)" };
  }
  const kirim = await sendViaWaGateway(tujuan, teks);
  return { ...dasar, terkirim: kirim.sent, alasan: kirim.sent ? undefined : (kirim.error ?? (kirim.dryRun ? "WA_DRY_RUN aktif" : "gateway tidak mengirim")) };
}

// ── daftar untuk menu web ────────────────────────────────────────────────────

export async function listStatement(tanggal?: string): Promise<Record<string, unknown>[]> {
  const sql = db();
  const rows = await sql`
    SELECT s.id, s.tanggal, a.label_file, a.nama_bank, a.no_rekening, a.jenis,
           s.saldo_awal, s.saldo_akhir, s.total_debit_tercetak, s.total_kredit_tercetak,
           s.metode, s.status, s.checksum_ok, s.saldo_bersambung_ok, s.parse_error,
           s.dicetak_at, s.sumber, s.file_nama, s.created_at,
           (SELECT COUNT(*)::int FROM bank_statement_line l WHERE l.statement_id = s.id) AS jumlah_baris
    FROM bank_statement s
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE ${tanggal ? sql`s.tanggal = ${tanggal}` : sql`true`}
    ORDER BY s.tanggal DESC, a.label_file
  `;
  return rows.map((r) => ({ ...r, tanggal: String(r.tanggal).slice(0, 10) }));
}

export interface ListLineOpts {
  tanggal?: string;
  kategori?: string;
  bank_account_id?: string;
  /** Cari di deskripsi/referensi. */
  q?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

// Whitelist kolom sort. Nama kolom TIDAK boleh datang langsung dari query string
// ke dalam SQL — dipetakan lewat daftar ini.
const SORT_KOLOM: Record<string, string> = {
  tanggal: "s.tanggal",
  label_file: "a.label_file",
  waktu: "l.waktu",
  deskripsi: "l.deskripsi",
  debit: "l.debit",
  kredit: "l.kredit",
  kategori: "l.kategori",
};

/** Bentuk balasan {rows, count, total_rows, limit, offset} — sengaja mengikuti
 *  kontrak DataTable mode server yang sudah ada. Menghitung KPI dari array yang
 *  sudah dipotong limit sudah pernah menghasilkan angka bohong di menu lain;
 *  total_rows datang dari COUNT di server, bukan dari panjang array. */
export async function listLine(opts: ListLineOpts): Promise<Record<string, unknown>> {
  const sql = db();
  const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const cari = (opts.q ?? "").trim();
  const where = sql`
    WHERE ${opts.tanggal ? sql`s.tanggal = ${opts.tanggal}` : sql`true`}
      AND ${opts.kategori ? sql`l.kategori = ${opts.kategori}` : sql`true`}
      AND ${opts.bank_account_id ? sql`s.bank_account_id = ${opts.bank_account_id}` : sql`true`}
      AND ${cari ? sql`(l.deskripsi ILIKE ${"%" + cari + "%"} OR l.referensi ILIKE ${"%" + cari + "%"})` : sql`true`}
  `;
  const kolom = SORT_KOLOM[opts.sort ?? ""] ?? null;
  const arah = String(opts.dir ?? "").toLowerCase() === "asc" ? sql`ASC` : sql`DESC`;
  const orderBy = kolom
    ? sql`ORDER BY ${sql.unsafe(kolom)} ${arah}, s.tanggal DESC, a.label_file, l.urut`
    : sql`ORDER BY s.tanggal DESC, a.label_file, l.urut`;
  const rows = await sql`
    SELECT l.id, s.tanggal, a.label_file, l.urut, l.waktu, l.deskripsi,
           l.debit::numeric AS debit, l.kredit::numeric AS kredit, l.saldo::numeric AS saldo,
           l.referensi, l.kategori, l.kategori_oleh, l.pasangan_line_id, l.catatan
    FROM bank_statement_line l
    JOIN bank_statement s ON s.id = l.statement_id
    JOIN bank_account a ON a.id = s.bank_account_id
    ${where}
    ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [cnt] = await sql`
    SELECT COUNT(*)::int AS n
    FROM bank_statement_line l
    JOIN bank_statement s ON s.id = l.statement_id
    JOIN bank_account a ON a.id = s.bank_account_id
    ${where}
  `;
  return {
    rows: rows.map((r) => ({ ...r, tanggal: String(r.tanggal).slice(0, 10) })),
    count: rows.length,
    total_rows: Number(cnt.n),
    limit,
    offset,
  };
}

const KATEGORI_VALID: Kategori[] = [
  "uang_masuk_riil", "afiliasi_grup", "puteran_internal", "bunga",
  "deposito", "refund", "biaya_pajak", "pengeluaran", "belum_ditriage",
];

export async function triageLine(
  id: string,
  kategori: string,
  catatan?: string | null,
): Promise<ActionResult> {
  if (!KATEGORI_VALID.includes(kategori as Kategori)) {
    return { ok: false, error: `kategori tidak valid: ${kategori}` };
  }
  const sql = db();
  const rows = await sql`
    UPDATE bank_statement_line
    SET kategori = ${kategori}, kategori_oleh = 'manual', catatan = ${catatan ?? null}
    WHERE id = ${id} RETURNING id
  `;
  return rows.length ? { ok: true } : { ok: false, error: "baris tidak ditemukan" };
}

export async function listAccount(): Promise<Record<string, unknown>[]> {
  const sql = db();
  return await sql`
    SELECT id, label_file, bank_kode, nama_bank, no_rekening, nama_pemilik, cabang,
           swift_kode, jenis, milik_wrg, wajib_harian, aktif, catatan
    FROM bank_account ORDER BY bank_kode, label_file
  `;
}

export interface UpdateAccountInput {
  no_rekening?: string | null;
  nama_pemilik?: string | null;
  cabang?: string | null;
  jenis?: string | null;
  wajib_harian?: boolean | null;
  aktif?: boolean | null;
  catatan?: string | null;
}

export async function updateAccount(id: string, input: UpdateAccountInput): Promise<ActionResult> {
  if (input.jenis && !["kas", "prk_pinjaman", "deposito", "escrow"].includes(input.jenis)) {
    return { ok: false, error: `jenis tidak valid: ${input.jenis}` };
  }
  const sql = db();
  const rows = await sql`
    UPDATE bank_account SET
      no_rekening  = COALESCE(${input.no_rekening ?? null}, no_rekening),
      nama_pemilik = COALESCE(${input.nama_pemilik ?? null}, nama_pemilik),
      cabang       = COALESCE(${input.cabang ?? null}, cabang),
      jenis        = COALESCE(${input.jenis ?? null}, jenis),
      wajib_harian = COALESCE(${input.wajib_harian ?? null}, wajib_harian),
      aktif        = COALESCE(${input.aktif ?? null}, aktif),
      catatan      = COALESCE(${input.catatan ?? null}, catatan),
      updated_at   = now()
    WHERE id = ${id} RETURNING id
  `;
  return rows.length ? { ok: true } : { ok: false, error: "rekening tidak ditemukan" };
}

/** Matriks kelengkapan tanggal x rekening untuk tab Kelengkapan. */
export async function matriksKelengkapan(dari: string, sampai: string): Promise<Record<string, unknown>> {
  const sql = db();
  const akun = await sql`
    SELECT id, label_file FROM bank_account WHERE aktif AND wajib_harian ORDER BY label_file
  `;
  const rows = await sql`
    SELECT s.tanggal, a.label_file, s.status
    FROM bank_statement s
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE s.tanggal BETWEEN ${dari} AND ${sampai}
  `;
  const isi: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const t = String(r.tanggal).slice(0, 10);
    isi[t] = isi[t] ?? {};
    isi[t][String(r.label_file)] = String(r.status);
  }
  return { rekening: akun.map((a) => String(a.label_file)), isi };
}
