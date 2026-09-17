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
  /** Grup WA asal #KORAN. Jadi tujuan draft konfirmasi Finance — lihat
   *  catatan di kepala migrasi 178. NULL untuk unggahan lewat menu web. */
  wa_group_jid?: string | null;
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
  /** Kode draft resume yang ikut terbentuk karena koran hari itu jadi lengkap
   *  (null = belum lengkap, atau resume hari itu sudah final). */
  draft_kode?: string | null;
  /** Kenapa draft belum dibuat — dipakai balasan #KORAN supaya admin tahu
   *  apa yang masih ditunggu, bukan cuma diam. */
  draft_alasan?: string | null;
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
      dicetak_at, sumber, wa_message_id, wa_group_jid, file_path, file_nama, metode, model_used,
      ocr_dry_run, checksum_ok, status, parse_error, raw_text
    ) VALUES (
      ${acc.id}, ${tanggal}, ${(data.saldo_awal as number) ?? null}, ${(data.saldo_akhir as number) ?? null},
      ${(data.total_debit_tercetak as number) ?? null}, ${(data.total_kredit_tercetak as number) ?? null},
      ${(data.jumlah_debit as number) ?? null}, ${(data.jumlah_kredit as number) ?? null},
      ${(data.dicetak_at as string) ?? null}, ${input.sumber}, ${input.wa_message_id ?? null},
      ${input.wa_group_jid ?? null},
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
      wa_message_id = EXCLUDED.wa_message_id,
      -- Grup asal dipertahankan kalau kiriman baru datang tanpa grup (mis.
      -- perbaikan lewat unggah web): draft konfirmasi tetap punya tujuan.
      wa_group_jid = COALESCE(EXCLUDED.wa_group_jid, bank_statement.wa_group_jid),
      file_path = EXCLUDED.file_path,
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

  // Pemicu draft resume: begitu koran hari itu LENGKAP, Finance langsung
  // ditanya — tak menunggu jam tertentu (keputusan user 17 Sep 2026).
  //
  // Dibungkus try/catch dan TIDAK boleh menggagalkan ingest: file-nya sudah
  // tersimpan dengan benar: kegagalan mengirim draft adalah soal WA, bukan soal
  // data. Kalau ini melempar, admin akan melihat "#KORAN gagal" untuk file yang
  // sebenarnya sudah masuk, lalu mengirimnya ulang berkali-kali.
  let draft: DraftResult = { dibuat: false, alasan: "statement belum terverifikasi" };
  if (String(fin.status) === "terverifikasi") {
    try {
      draft = await buatDraftJikaLengkap(tanggal, input.wa_group_jid ?? null);
      // Belum lengkap → bukan berarti tak akan pernah jadi resume. Jadwalkan
      // ulang pengecekan; kalau tak ada koran lain menyusul dalam periode
      // hening, setoran dianggap selesai dan draftnya dibuat apa adanya.
      if (!draft.dibuat && !draft.kode) {
        const dijadwal = jadwalkanDraftHening(tanggal, input.wa_group_jid ?? null);
        if (dijadwal) draft = { ...draft, alasan: `${draft.alasan}. Draft menyusul ${heningMenit()} menit setelah koran terakhir.` };
      }
    } catch (e) {
      console.error(`[cashin] draft konfirmasi ${tanggal} gagal:`, e);
      draft = { dibuat: false, alasan: `draft gagal dibuat: ${(e as Error).message}` };
    }
  }

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
    draft_kode: draft.kode ?? null,
    draft_alasan: draft.alasan ?? null,
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
  // ⚠️ to_char, BUKAN kolom date mentah. Driver mengembalikan kolom `date`
  // sebagai objek Date JS, sehingga `String(...).slice(0,10)` menghasilkan
  // 'Thu Sep 03' — dan nilai itu dipakai lagi sebagai parameter query di bawah.
  // Postgres MENERIMA 'Thu Sep 03' (ditafsirkan tahun berjalan) lalu
  // mengembalikan NOL baris tanpa error: penilaian ulang hari sebelumnya tak
  // pernah terjadi, dan statement yang dicetak sebelum tutup hari lolos tanpa
  // peringatan. Diverifikasi 17 Sep 2026 di wrg_os_dev.
  const [prev] = await sql`
    SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal FROM bank_statement
    WHERE bank_account_id = ${bankAccountId} AND tanggal < ${tanggal}
    ORDER BY tanggal DESC LIMIT 1
  `;
  if (prev) {
    const tglPrev = String(prev.tanggal);
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
  /** Uang masuk per rekening kas — permintaan Direktur 18 Sep 2026: "perlu tahu
   *  uang yang masuk di mandiri berapa, di jatim berapa, dan seterusnya".
   *  Hanya rekening yang korannya SUDAH masuk; yang belum setor tetap
   *  dilaporkan terpisah lewat rekening_belum, bukan ditulis Rp 0 (nol yang
   *  dibaca sebagai "tidak ada penerimaan" padahal datanya belum ada). */
  per_rekening: Array<{
    label_file: string;
    nama_bank: string;
    uang_masuk: number;
    puteran_keluar: number;
  }>;
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

  // Rincian per rekening. Penyaringnya HARUS sama dengan total di atas
  // (jenis='kas' + status='terverifikasi' + kategori penerimaan), kalau tidak
  // penjumlahan rinciannya takkan sama dengan totalnya — dan yang membaca akan
  // menganggap salah satunya bohong. Puteran diukur dari sisi DEBIT, sama
  // seperti totalnya.
  const perRek = await sql`
    SELECT a.label_file, a.nama_bank,
           COALESCE(SUM(l.kredit) FILTER (WHERE l.kategori IN ('uang_masuk_riil', 'afiliasi_grup')), 0)::numeric AS uang_masuk,
           COALESCE(SUM(l.debit)  FILTER (WHERE l.kategori = 'puteran_internal'), 0)::numeric AS puteran_keluar
    FROM bank_statement s
    JOIN bank_account a ON a.id = s.bank_account_id
    LEFT JOIN bank_statement_line l ON l.statement_id = s.id
    WHERE s.tanggal = ${tanggal} AND a.jenis = 'kas' AND s.status = 'terverifikasi'
    GROUP BY a.label_file, a.nama_bank
    ORDER BY 3 DESC, a.label_file
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
    per_rekening: perRek.map((r) => ({
      label_file: String(r.label_file),
      nama_bank: String(r.nama_bank),
      uang_masuk: Number(r.uang_masuk),
      puteran_keluar: Number(r.puteran_keluar),
    })),
  };
}

// ── teks resume WA ───────────────────────────────────────────────────────────

const rp = (n: number): string => "Rp " + Math.round(n).toLocaleString("id-ID");

/** "Bank Mandiri" → "Mandiri". Nama bank ditulis lengkap di master (dipakai
 *  menu web), tapi di WA tiap kolom rebutan lebar layar HP. Prefiks 'Bank'
 *  dibuang saja; 'CIMB Niaga' tak berubah. */
const namaPendek = (nama: string): string => nama.replace(/^Bank\s+/i, "");

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function formatResume(r: RingkasanHarian): string {
  const [y, m, d] = r.tanggal.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const tgl = `${HARI[dt.getUTCDay()]}, ${String(d).padStart(2, "0")} ${BULAN[m - 1]} ${y}`;

  const baris: string[] = [`*UANG MASUK — ${tgl}*`];
  // Peringatan kelengkapan ditaruh di ATAS angka, bukan cuma di footer.
  //
  // Sejak draft boleh terbentuk dari koran yang belum lengkap (setelah hening
  // 15 menit), resume bisa sampai ke Direktur dengan hanya 2 dari 10 rekening
  // terhitung. Angka yang tidak lengkap TIDAK boleh terlihat seperti angka
  // final: baris "Koran diterima N/M" di footer terlalu mudah terlewat, apalagi
  // di WhatsApp yang pesannya dibaca sambil lalu.
  if (r.rekening_belum.length > 0) {
    baris.push(`⚠️ *BELUM LENGKAP — baru ${r.rekening_masuk}/${r.rekening_wajib} rekening.* Angka di bawah belum final.`);
  }
  baris.push("");

  // Rincian per rekening SEBELUM total. Direktur menanyakannya lebih dulu
  // ("mandiri berapa, jatim berapa"), dan angka gabungan tanpa rinciannya tak
  // bisa dicek siapa pun terhadap mutasi bank.
  if (r.per_rekening.length) {
    baris.push("*Masuk per rekening*");
    const lebar = Math.max(...r.per_rekening.map((p) => p.label_file.length));
    for (const p of r.per_rekening) {
      baris.push(`${p.label_file.padEnd(lebar)} · ${namaPendek(p.nama_bank)} : ${rp(p.uang_masuk)}`);
    }
    baris.push("");
  }

  baris.push(`Total uang masuk    : ${rp(r.uang_masuk_riil)}`);
  if (r.afiliasi_grup > 0) baris.push(`  + afiliasi grup   : ${rp(r.afiliasi_grup)}`);
  baris.push(`Puteran internal    : ${rp(r.puteran_internal)} (dikecualikan)`);
  if (r.bunga + r.deposito > 0) baris.push(`Bunga/deposito      : ${rp(r.bunga + r.deposito)}`);
  if (r.refund > 0) baris.push(`Refund              : ${rp(r.refund)}`);
  if (r.belum_ditriage > 0) baris.push(`Belum ditriage      : ${rp(r.belum_ditriage)} ⚠️`);

  // "Penerimaan terbesar" DIBUANG dari pesan (permintaan user 18 Sep 2026):
  // deskripsi mentah bank ('20260828PDJTIDJ1010O0101090643 PDJTIDJ1/W…') tak
  // terbaca manusia dan memakan 6 baris tanpa menjawab pertanyaan siapa pun.
  // Datanya TETAP dihitung dan tersimpan di ringkasan — dipakai menu web
  // /uang-masuk yang punya ruang untuk menampilkannya dengan benar.

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

  // Daftar "belum setor" PINDAH ke pesan draft (lihat formatDraftKonfirmasi):
  // ia memberi tahu Finance file mana yang kurang — informasi untuk BERTINDAK,
  // dan Finance yang bertindak, bukan Direktur. Fakta bahwa angkanya belum
  // lengkap tetap terbaca semua orang lewat peringatan di kepala resume.
  //
  // Peringatan integritas statement TETAP di sini: "saldo tidak bersambung"
  // artinya angka yang SEDANG DIBACA bisa salah, bukan sekadar ada file yang
  // belum datang. Itu harus ikut ke mana pun angkanya pergi.
  for (const s of r.statement_perlu_review) baris.push("", `⚠️ ${s.label_file}: ${s.alasan}`);

  return baris.join("\n");
}

// ── gerbang konfirmasi Finance ───────────────────────────────────────────────
//
// Alur yang diminta user 17 Sep 2026:
//
//   Finance setor #KORAN → koran hari itu LENGKAP → bot menyusun resume dan
//   mengirim DRAFT-nya ke grup asal → Finance balas "ya <kode>" → baru resume
//   dikirim ke Direktur.
//
// Konsekuensi yang paling gampang dilanggar: TIDAK ADA jalur lain menuju
// Direktur. Job terjadwal sekarang cuma boleh membuat draft dan mengingatkan;
// satu-satunya fungsi yang mengirim ke CASHIN_RESUME_TO adalah putuskanResume()
// dengan keputusan 'ya'. Kalau nanti ada yang menambahkan "kirim otomatis kalau
// lewat jam sekian", gerbang ini hilang tanpa ada yang sadar — pemiliknya
// menyangka masih ada verifikasi manusia padahal tidak.

export interface DraftResult {
  dibuat: boolean;
  kode?: string;
  alasan?: string;
  /** Draft sudah ada sebelumnya dan isinya diperbarui (koran di-ingest ulang). */
  diperbarui?: boolean;
  /** Draft dibuat dari koran yang BELUM lengkap (hening / jaring pengaman). */
  parsial?: boolean;
}

// ── pemicu "setoran hari itu sudah selesai" ──────────────────────────────────
//
// Sistem tidak punya cara tahu bahwa file ke-2 adalah yang terakhir. Menunggu
// 10/10 saja tidak cukup: kenyataannya tidak semua rekening disetor tiap hari,
// jadi draft bisa TIDAK PERNAH terbentuk dan resume hilang diam-diam — persis
// yang terjadi 18 Sep 2026 (2 file masuk, draft nol).
//
// Jadi: setiap ingest menjadwal ulang pengecekan. Kalau tak ada koran baru
// untuk tanggal itu selama CASHIN_HENING_MENIT (default 15), setoran dianggap
// selesai dan draft dibuat dari apa yang ADA — dengan angka kelengkapan yang
// ditulis terang-terangan di kepala resume, bukan disembunyikan.
//
// Timer in-process (bukan cron) supaya ikut hidup di tumpukan dev yang
// scheduler-nya sengaja mati. Konsekuensinya timer hilang saat proses
// restart — itu ditanggung job harian `cashin-resume` sebagai jaring pengaman.
const heningMenit = (): number => Number(process.env.CASHIN_HENING_MENIT ?? 15);
// Backfill besar (mis. re-ingest arsip berbulan-bulan) tidak boleh menghasilkan
// satu draft per tanggal lama yang membanjiri grup Finance.
const draftMaxUmurHari = (): number => Number(process.env.CASHIN_DRAFT_MAX_UMUR_HARI ?? 30);

const timerHening = new Map<string, ReturnType<typeof setTimeout>>();

function umurHari(tanggal: string): number {
  const t = Date.parse(`${tanggal}T00:00:00+07:00`);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86_400_000;
}

/** Jadwalkan pembuatan draft setelah periode hening. Dipanggil ulang tiap ingest
 *  → timer sebelumnya dibatalkan (debounce, bukan throttle): yang dihitung
 *  adalah jeda sejak file TERAKHIR, bukan sejak file pertama. */
export function jadwalkanDraftHening(tanggal: string, grupJid?: string | null): boolean {
  if (umurHari(tanggal) > draftMaxUmurHari()) return false;
  const lama = timerHening.get(tanggal);
  if (lama) clearTimeout(lama);
  const t = setTimeout(
    () => {
      timerHening.delete(tanggal);
      buatDraftJikaLengkap(tanggal, grupJid, { paksa: true })
        .then((r) => console.log(`[cashin] draft hening ${tanggal}: ${JSON.stringify(r)}`))
        .catch((e) => console.error(`[cashin] draft hening ${tanggal} gagal:`, e));
    },
    Math.max(heningMenit(), 1) * 60_000,
  );
  // unref: timer ini tak boleh menahan proses tetap hidup saat shutdown.
  if (typeof t.unref === "function") t.unref();
  timerHening.set(tanggal, t);
  return true;
}

/** Balasan konfirmasi dari Finance: "ya R12", "tidak R12 angka BJTM salah".
 *
 *  Menyalin pola 'ya L3' detect_leave, termasuk toleransinya: huruf besar/kecil
 *  bebas, '#' opsional, dan spasi antara huruf & angka dimaafkan. Yang TIDAK
 *  dimaafkan: kode tanpa awalan huruf. "ya 12" ditolak supaya balasan percakapan
 *  biasa ("ya 12 rb aja") tidak pernah menyetujui resume. */
const KEPUTUSAN =
  /^\s*(ya|iya|ok|oke|okay|setuju|kirim|tidak|tdk|gak|nggak|ngga|batal|no|jangan)\b[\s#]*r\s*(\d+)\b\s*(.*)$/i;
const SETUJU = /^(ya|iya|ok|oke|okay|setuju|kirim)$/i;

/** Balasan yang jelas-jelas MENIRU format keputusan tapi rusak ("ya R", "ok
 *  r1x", "ya resume"). Dibalas panduan format, bukan didiamkan.
 *
 *  Pelajaran yang disalin apa adanya dari detect_leave: balasan approval yang
 *  salah ketik dulu senyap, dan pengirimnya menyangka approval-nya masuk —
 *  cuti 3 hari nyaris kedaluwarsa gara-gara "ya LT2". Di sini taruhannya angka
 *  uang masuk yang tak pernah sampai ke Direktur.
 *
 *  Sengaja sempit: harus diawali kata keputusan, memuat 'r' + sesuatu, dan
 *  pesannya pendek. `L\d` DIKECUALIKAN karena itu ruang nama detect_leave —
 *  approval cuti yang kebetulan lewat di grup yang sama tidak boleh dibalas
 *  panduan konfirmasi resume. */
const MIRIP_KEPUTUSAN = /^\s*(ya|iya|ok|oke|okay|setuju|kirim|tidak|tdk|gak|nggak|batal|no|jangan)\b[\s#]*r/i;
const RUANG_NAMA_LAIN = /\bl\s*\d+\b/i;
const MIRIP_MAXLEN = 24;

const stripWaFmt = (s: string): string => s.replace(/[*_~`]/g, "").trim();

export interface KeputusanResume {
  keputusan: "ya" | "tidak";
  kode: string;
  alasan: string | null;
}

export function parseKeputusanResume(body: string | null): KeputusanResume | null {
  if (!body) return null;
  for (const baris of stripWaFmt(body).split(/\r?\n/)) {
    const m = baris.match(KEPUTUSAN);
    if (!m) continue;
    const alasan = (m[3] ?? "").trim();
    return {
      keputusan: SETUJU.test(m[1]) ? "ya" : "tidak",
      kode: `R${m[2]}`,
      alasan: alasan || null,
    };
  }
  return null;
}

export function miripKeputusanResume(body: string | null): boolean {
  if (!body) return false;
  const teks = stripWaFmt(body);
  if (teks.length > MIRIP_MAXLEN) return false;
  if (RUANG_NAMA_LAIN.test(teks)) return false;
  return MIRIP_KEPUTUSAN.test(teks) && parseKeputusanResume(teks) === null;
}

export function formatDraftKonfirmasi(teks: string, kode: string, r?: RingkasanHarian): string {
  const baris = [`*DRAFT — belum dikirim ke Direktur*`, "", teks];
  // Kelengkapan setoran ditulis di DRAFT saja, bukan di resume yang diteruskan
  // ke Direktur: ini informasi untuk BERTINDAK (file mana yang masih kurang),
  // dan yang bertindak Finance. Tanpa daftarnya, Finance tahu angkanya belum
  // lengkap tapi tidak tahu harus mengejar koran yang mana.
  if (r) {
    baris.push("", `_Koran diterima ${r.rekening_masuk}/${r.rekening_wajib} rekening._`);
    if (r.rekening_belum.length) baris.push(`_Belum setor: ${r.rekening_belum.join(", ")}_`);
  }
  baris.push(
    "",
    `Balas *ya ${kode}* untuk kirim ke Direktur,`,
    `atau *tidak ${kode} <alasan>* untuk menahan.`,
  );
  return baris.join("\n");
}

export function formatIngatanKonfirmasi(kode: string, tanggal: string, belumTriage: number): string {
  return [
    `⏰ Resume uang masuk ${tanggal} (${kode}) belum dikonfirmasi.`,
    belumTriage > 0 ? `Masih ada ${rp(belumTriage)} berstatus belum ditriage.` : null,
    `Balas *ya ${kode}* untuk kirim ke Direktur, atau *tidak ${kode} <alasan>*.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatIngatanBelumLengkap(r: RingkasanHarian): string {
  return [
    `⏰ Koran ${r.tanggal} baru ${r.rekening_masuk}/${r.rekening_wajib} rekening.`,
    `Belum setor: ${r.rekening_belum.join(", ")}`,
    "Resume belum bisa disusun sampai semuanya masuk.",
  ].join("\n");
}

/** Buat/segarkan draft resume kalau koran hari itu sudah lengkap, lalu kirim
 *  draftnya ke grup Finance sekali.
 *
 *  "Lengkap" = semua rekening aktif+wajib_harian punya statement hari itu.
 *  Sengaja tidak menuntut semuanya `terverifikasi`: statement yang checksum-nya
 *  gagal SUDAH disebut sebagai peringatan di dalam teks resume, jadi Finance
 *  tetap melihatnya dan bisa memutuskan. Menuntut 10/10 terverifikasi berarti
 *  satu file bermasalah menahan resume seharian tanpa ada yang tahu.
 *
 *  Draft dikirim SEKALI (draft_terkirim_at). Re-ingest sesudahnya memperbarui
 *  teksnya diam-diam — mengirim ulang draft tiap file masuk akan membuat grup
 *  Finance dibanjiri, dan itu cara tercepat membuat orang berhenti membacanya. */
export async function buatDraftJikaLengkap(
  tanggal: string,
  grupJid?: string | null,
  opts: { paksa?: boolean } = {},
): Promise<DraftResult> {
  const sql = db();
  const r = await ringkasanHarian(tanggal);
  const teks = formatResume(r);

  // monitor_digest tetap diisi apa pun hasil gerbangnya — itu arsip harian,
  // bukan jalur pengiriman.
  await upsertDigests([{ kind: "cashin", tanggal, waktu: null, content: teks }]);

  const [ada] = await sql`SELECT id, kode, status, grup_jid, draft_terkirim_at FROM cashin_resume WHERE tanggal = ${tanggal}`;

  // Resume yang sudah diputuskan TIDAK ditimpa. Kalau koran hari itu ternyata
  // diperbaiki sesudah Direktur menerima angkanya, itu perlu koreksi yang
  // disengaja manusia — bukan draft baru yang diam-diam menggantikan riwayat.
  if (ada && String(ada.status) !== "menunggu_konfirmasi") {
    return { dibuat: false, kode: String(ada.kode), alasan: `resume ${tanggal} sudah berstatus ${String(ada.status)}` };
  }

  // `paksa` = pemicu hening / jaring pengaman harian: setoran dianggap selesai
  // walau belum 10/10. Angkanya tetap boleh disusun — yang haram itu
  // MENYEMBUNYIKAN ketidaklengkapannya, dan itu dijaga formatResume yang
  // menulis "BELUM LENGKAP — baru N/M rekening" di kepala resume.
  const parsial = r.rekening_belum.length > 0;
  if (parsial && !opts.paksa) {
    return {
      dibuat: false,
      alasan: `koran belum lengkap (${r.rekening_masuk}/${r.rekening_wajib}) — belum setor: ${r.rekening_belum.join(", ")}`,
    };
  }
  // Nol koran bukan "setoran selesai", itu hari tanpa setoran sama sekali.
  if (r.rekening_masuk === 0) return { dibuat: false, alasan: "belum ada koran masuk untuk tanggal ini" };

  const tujuan = (grupJid ?? "").trim() || String(ada?.grup_jid ?? "") || (await grupTerakhirKoran(tanggal)) || konfirmasiTujuanEnv();

  const [row] = await sql`
    INSERT INTO cashin_resume (tanggal, teks, ringkasan, grup_jid)
    VALUES (${tanggal}, ${teks}, ${JSON.stringify(r)}::jsonb, ${tujuan || null})
    ON CONFLICT (tanggal) DO UPDATE SET
      teks = EXCLUDED.teks,
      ringkasan = EXCLUDED.ringkasan,
      grup_jid = COALESCE(cashin_resume.grup_jid, EXCLUDED.grup_jid),
      updated_at = now()
    RETURNING id, kode, grup_jid, draft_terkirim_at
  `;
  const kode = String(row.kode);
  const sudahDikirim = row.draft_terkirim_at != null;
  if (sudahDikirim) return { dibuat: false, diperbarui: true, kode, alasan: "draft sudah dikirim ke Finance, teksnya diperbarui" };

  const ke = String(row.grup_jid ?? "").trim();
  if (!ke) {
    return {
      dibuat: false,
      kode,
      alasan: "grup tujuan konfirmasi tak diketahui (statement diunggah lewat web) — set CASHIN_KONFIRMASI_TO",
    };
  }

  const kirim = await sendViaWaGateway(ke, formatDraftKonfirmasi(teks, kode, r));
  if (!kirim.sent) {
    return { dibuat: false, kode, alasan: kirim.error ?? "gateway tidak mengirim draft" };
  }
  await sql`UPDATE cashin_resume SET draft_terkirim_at = now(), updated_at = now() WHERE id = ${row.id}`;
  return { dibuat: true, kode, parsial };
}

/** Grup asal #KORAN hari itu — dipakai kalau pemanggil tak menyertakan grup
 *  (mis. job terjadwal). Yang TERAKHIR menyetor yang menang; kalau Finance
 *  pindah grup, draft ikut pindah tanpa perlu ubah konfigurasi. */
async function grupTerakhirKoran(tanggal: string): Promise<string | null> {
  const [row] = await db()`
    SELECT wa_group_jid FROM bank_statement
    WHERE tanggal = ${tanggal} AND wa_group_jid IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1
  `;
  return row ? String(row.wa_group_jid) : null;
}

/** Cadangan terakhir tujuan draft: grup/nomor yang di-set manusia. Kosong =
 *  tidak ada tebakan — pola yang sama dengan CASHIN_RESUME_TO. */
const konfirmasiTujuanEnv = (): string => (process.env.CASHIN_KONFIRMASI_TO ?? "").trim();

export interface PutusanResult {
  ok: boolean;
  error?: string;
  kode?: string;
  tanggal?: string;
  status?: string;
  terkirim?: boolean;
  alasan?: string;
}

/** Terapkan keputusan Finance. 'ya' → kirim resume ke Direktur. 'tidak' → tahan.
 *
 *  SATU-SATUNYA pintu menuju Direktur. Dipakai dua pemanggil: pemindai balasan
 *  WA dan endpoint web. */
export async function putuskanResume(
  kode: string,
  keputusan: "ya" | "tidak",
  oleh: string,
  opts: { alasan?: string | null; waMessageId?: string | null } = {},
): Promise<PutusanResult> {
  const sql = db();
  const [row] = await sql`
    SELECT id, kode, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, teks, status
    FROM cashin_resume WHERE upper(kode) = upper(${kode})
  `;
  if (!row) return { ok: false, error: `kode ${kode} tidak dikenal` };

  const tanggal = String(row.tanggal);
  const status = String(row.status);
  // 'gagal_kirim' BOLEH diputuskan lagi: Finance sudah setuju, yang gagal
  // gatewaynya. 'terkirim'/'ditolak' tidak — itu keputusan yang sudah final.
  if (status === "terkirim" || status === "ditolak") {
    return { ok: false, error: `resume ${tanggal} sudah ${status}`, kode: String(row.kode), tanggal, status };
  }

  if (keputusan === "tidak") {
    await sql`
      UPDATE cashin_resume SET status = 'ditolak', diputuskan_oleh = ${oleh}, diputuskan_at = now(),
        alasan_tolak = ${opts.alasan ?? null}, wa_message_id = ${opts.waMessageId ?? null}, updated_at = now()
      WHERE id = ${row.id}
    `;
    return { ok: true, kode: String(row.kode), tanggal, status: "ditolak", terkirim: false };
  }

  const tujuan = (process.env.CASHIN_RESUME_TO ?? "").trim();
  if (!tujuan) {
    return { ok: false, error: "CASHIN_RESUME_TO belum di-set (nomor WA Direktur)", kode: String(row.kode), tanggal };
  }

  const jam = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 16);
  const teks = `${String(row.teks)}\n\n_Dikonfirmasi ${oleh} ${jam} WIB._`;
  const kirim = await sendViaWaGateway(tujuan, teks);
  const gagal = kirim.sent ? null : (kirim.error ?? "gateway tidak mengirim");

  await sql`
    UPDATE cashin_resume SET
      status = ${kirim.sent ? "terkirim" : "gagal_kirim"},
      diputuskan_oleh = ${oleh}, diputuskan_at = now(),
      wa_message_id = ${opts.waMessageId ?? null},
      terkirim_at = ${kirim.sent ? new Date().toISOString() : null},
      kirim_error = ${gagal}, updated_at = now()
    WHERE id = ${row.id}
  `;
  return {
    ok: kirim.sent,
    error: gagal ?? undefined,
    kode: String(row.kode),
    tanggal,
    status: kirim.sent ? "terkirim" : "gagal_kirim",
    terkirim: kirim.sent,
  };
}

export interface ScanKonfirmasiResult {
  dinilai: number;
  diputuskan: number;
  mirip: number;
}

/** Pindai balasan konfirmasi di grup yang punya draft menunggu.
 *
 *  Kenapa pemindai sendiri, bukan nebeng processUnprocessed: balasan "ya R12"
 *  TIDAK ber-hashtag, sementara pipeline itu menyaring wa_message dengan pola
 *  hashtag. Jejak idempotensinya pun terpisah (cashin_konfirmasi_seen), supaya
 *  dua pipeline tak saling mencuri baris lewat processed_at. */
export async function scanKonfirmasiResume(): Promise<ScanKonfirmasiResult> {
  const sql = db();
  const hasil: ScanKonfirmasiResult = { dinilai: 0, diputuskan: 0, mirip: 0 };

  const draft = await sql`
    SELECT kode, grup_jid, draft_terkirim_at FROM cashin_resume
    WHERE status IN ('menunggu_konfirmasi', 'gagal_kirim') AND grup_jid IS NOT NULL AND draft_terkirim_at IS NOT NULL
  `;
  if (draft.length === 0) return hasil;

  const grup = [...new Set(draft.map((d) => String(d.grup_jid)))];
  const sejak = draft.reduce(
    (min, d) => (String(d.draft_terkirim_at) < min ? String(d.draft_terkirim_at) : min),
    String(draft[0].draft_terkirim_at),
  );

  // Hanya pesan SESUDAH draft dikirim. Tanpa batas waktu ini, kalimat lama di
  // grup yang kebetulan berbunyi "ya R2" (nomor ruangan, kode barang) bisa
  // menyetujui resume yang baru dibuat hari ini.
  const pesan = await sql`
    SELECT m.id, m.group_jid, m.body, m.sender_name
    FROM wa_message m
    WHERE m.group_jid = ANY(${grup}) AND m.received_at >= ${sejak}
      AND m.body IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cashin_konfirmasi_seen s WHERE s.message_id = m.id)
    ORDER BY m.received_at
    LIMIT 200
  `;

  for (const m of pesan) {
    hasil.dinilai++;
    const id = String(m.id);
    const body = m.body == null ? null : String(m.body);
    const oleh = String(m.sender_name ?? "").trim() || "Finance";
    const keputusan = parseKeputusanResume(body);

    if (!keputusan) {
      if (miripKeputusanResume(body)) {
        hasil.mirip++;
        const daftar = draft
          .filter((d) => String(d.grup_jid) === String(m.group_jid))
          .map((d) => String(d.kode))
          .join(", ");
        await sendViaWaGateway(
          String(m.group_jid),
          `⚠️ Format konfirmasi resume: *ya ${daftar || "R<nomor>"}* atau *tidak ${daftar || "R<nomor>"} <alasan>*.` +
            (daftar ? `\nMenunggu konfirmasi: ${daftar}` : ""),
        );
        await tandaiSeen(id, "mirip-keputusan");
      } else {
        await tandaiSeen(id, "bukan-keputusan");
      }
      continue;
    }

    const r = await putuskanResume(keputusan.kode, keputusan.keputusan, oleh, {
      alasan: keputusan.alasan,
      waMessageId: id,
    });
    if (!r.ok && r.error?.startsWith("kode")) {
      await sendViaWaGateway(String(m.group_jid), `⚠️ ${r.error}. Kode yang menunggu: ${draft.map((d) => String(d.kode)).join(", ")}`);
      await tandaiSeen(id, "kode-tak-dikenal");
      continue;
    }
    hasil.diputuskan++;
    const balas =
      keputusan.keputusan === "tidak"
        ? `🛑 Resume ${r.tanggal} ditahan${keputusan.alasan ? ` — ${keputusan.alasan}` : ""}. Tidak dikirim ke Direktur.`
        : r.terkirim
          ? `✅ Resume ${r.tanggal} dikirim ke Direktur.`
          : `⚠️ Konfirmasi ${r.kode} tercatat, TAPI pengiriman ke Direktur gagal: ${r.error}. Tidak perlu konfirmasi ulang — akan dicoba lagi.`;
    await sendViaWaGateway(String(m.group_jid), balas);
    await tandaiSeen(id, r.ok ? "diputuskan" : "gagal-kirim");
  }
  return hasil;
}

async function tandaiSeen(messageId: string, status: string): Promise<void> {
  await db()`
    INSERT INTO cashin_konfirmasi_seen (message_id, status) VALUES (${messageId}, ${status})
    ON CONFLICT (message_id) DO NOTHING
  `;
}

// ── job harian ───────────────────────────────────────────────────────────────

export interface RunResumeResult {
  tanggal: string;
  /** Draft baru dibuat & dikirim ke Finance pada run ini. */
  draft_dibuat: boolean;
  kode?: string;
  /** Pengingat dikirim (draft menggantung, atau koran belum lengkap). */
  diingatkan: boolean;
  alasan?: string;
  rekening_masuk: number;
  rekening_wajib: number;
  uang_masuk_riil: number;
}

/** Jaring pengaman harian. TIDAK mengirim apa pun ke Direktur.
 *
 *  Dua keadaan yang ditangani:
 *   a. koran lengkap tapi draft belum pernah terbentuk (mis. statement terakhir
 *      masuk lewat web) → buat draftnya sekarang;
 *   b. draft menggantung tanpa konfirmasi, atau koran tak kunjung lengkap →
 *      ingatkan Finance, sekali sehari (ingat_terakhir_at).
 *
 *  Keputusan user 17 Sep 2026 saat memilih perilaku "tidak dikirim, ingatkan
 *  finance": resume yang tidak dikonfirmasi TIDAK boleh lolos ke Direktur
 *  dengan label apa pun. Diam = belum diverifikasi. */
export async function runCashinResume(tanggal?: string): Promise<RunResumeResult> {
  const sql = db();
  const tgl = tanggal ?? wibDate();
  const r = await ringkasanHarian(tgl);

  const dasar = {
    tanggal: tgl,
    rekening_masuk: r.rekening_masuk,
    rekening_wajib: r.rekening_wajib,
    uang_masuk_riil: r.uang_masuk_riil,
    draft_dibuat: false,
    diingatkan: false,
  };

  if (r.rekening_masuk === 0) {
    // Hari tanpa satu pun koran (libur) tidak diingatkan: pengingat yang muncul
    // tiap tanggal merah membuat orang berhenti membaca pengingat yang penting.
    await upsertDigests([{ kind: "cashin", tanggal: tgl, waktu: null, content: formatResume(r) }]);
    return { ...dasar, alasan: "belum ada koran masuk hari ini" };
  }

  // paksa: kalau sampai jam ini draft belum pernah terbentuk, setoran hari itu
  // dianggap selesai apa adanya. Timer hening hidup di dalam proses, jadi ia
  // hilang kalau api di-restart di tengah hari — job inilah yang menutupnya.
  const draft = await buatDraftJikaLengkap(tgl, null, { paksa: true });
  if (draft.dibuat) return { ...dasar, draft_dibuat: true, kode: draft.kode };

  const [row] = await sql`
    SELECT id, kode, status, grup_jid, ingat_terakhir_at FROM cashin_resume WHERE tanggal = ${tgl}
  `;
  const tujuan = String(row?.grup_jid ?? "").trim() || (await grupTerakhirKoran(tgl)) || konfirmasiTujuanEnv();
  if (!tujuan) return { ...dasar, kode: draft.kode, alasan: draft.alasan ?? "tak ada grup tujuan pengingat" };

  // Sekali sehari. Pengingat yang berulang tiap run cron adalah cara tercepat
  // membuat grup me-mute bot-nya, dan sesudah itu tak ada pengingat yang sampai.
  const sudahDiingatkanHariIni =
    row?.ingat_terakhir_at != null && String(row.ingat_terakhir_at).slice(0, 10) === new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  if (sudahDiingatkanHariIni) return { ...dasar, kode: draft.kode, alasan: "sudah diingatkan hari ini" };

  const pesan =
    row && String(row.status) === "menunggu_konfirmasi"
      ? formatIngatanKonfirmasi(String(row.kode), tgl, r.belum_ditriage)
      : r.rekening_belum.length
        ? formatIngatanBelumLengkap(r)
        : null;
  if (!pesan) return { ...dasar, kode: draft.kode, alasan: draft.alasan };

  const kirim = await sendViaWaGateway(tujuan, pesan);
  if (kirim.sent && row) {
    await sql`UPDATE cashin_resume SET ingat_terakhir_at = now(), updated_at = now() WHERE id = ${row.id}`;
  }
  return { ...dasar, diingatkan: kirim.sent, kode: draft.kode, alasan: kirim.sent ? undefined : (kirim.error ?? "gateway tidak mengirim") };
}

/** Daftar resume untuk menu web (audit: siapa menyetujui angka hari apa). */
export async function listResume(limit = 30): Promise<Record<string, unknown>[]> {
  const rows = await db()`
    SELECT id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, kode, status, teks, grup_jid, draft_terkirim_at,
           diputuskan_oleh, diputuskan_at, alasan_tolak, terkirim_at, kirim_error
    FROM cashin_resume ORDER BY tanggal DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
  return rows;
}

// ── daftar untuk menu web ────────────────────────────────────────────────────

export async function listStatement(tanggal?: string): Promise<Record<string, unknown>[]> {
  const sql = db();
  const rows = await sql`
    SELECT s.id, to_char(s.tanggal, 'YYYY-MM-DD') AS tanggal, a.label_file, a.nama_bank, a.no_rekening, a.jenis,
           s.saldo_awal, s.saldo_akhir, s.total_debit_tercetak, s.total_kredit_tercetak,
           s.metode, s.status, s.checksum_ok, s.saldo_bersambung_ok, s.parse_error,
           s.dicetak_at, s.sumber, s.file_nama, s.created_at,
           (SELECT COUNT(*)::int FROM bank_statement_line l WHERE l.statement_id = s.id) AS jumlah_baris
    FROM bank_statement s
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE ${tanggal ? sql`s.tanggal = ${tanggal}` : sql`true`}
    ORDER BY s.tanggal DESC, a.label_file
  `;
  return rows;
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
    SELECT l.id, to_char(s.tanggal, 'YYYY-MM-DD') AS tanggal, a.label_file, l.urut, l.waktu, l.deskripsi,
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
    rows,
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
    SELECT to_char(s.tanggal, 'YYYY-MM-DD') AS tanggal, a.label_file, s.status
    FROM bank_statement s
    JOIN bank_account a ON a.id = s.bank_account_id
    WHERE s.tanggal BETWEEN ${dari} AND ${sampai}
  `;
  const isi: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const t = String(r.tanggal);
    isi[t] = isi[t] ?? {};
    isi[t][String(r.label_file)] = String(r.status);
  }
  return { rekening: akun.map((a) => String(a.label_file)), isi };
}
