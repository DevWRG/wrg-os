// Klasifikasi produk + penerbit kode produk (tabel migrasi 072).
//
// Kode: KK.PP.CC.SSS.NNNN — id_kategori(2) . id_product_line(2) . id_class(2) .
// id_sub_class(3) . nomor urut(4). Tiga hal yang membedakan penerbit di sini dari
// generator spreadsheet asal (audit 29 Jul 2026):
//
//   1. Resolusi HIRARKIS. Product Line & Class dicari di dalam kategorinya, Sub
//      Class di dalam (class, kategori)-nya. VLOOKUP di sheet mencocokkan nama
//      saja, jadi 4 nama Class + 33 nama Sub Class yang kembar mengambil id dari
//      kategori lain (244 dari 931 produk salah prefix). Di sini bentuk salah itu
//      tidak bisa tersimpan — kunci komposit + FK yang menolak.
//   2. Sub Class SELALU 3 digit. Sheet Kroscek memakai 2 digit, jadi 491 produk
//      dengan id_sub_class >= 100 kepotong (112 → "12").
//   3. Nomor urut global per prefix, lintas semua sumber. Counter per-sheet di
//      spreadsheet sempat menerbitkan kode kembar.
//
// Kode yang sudah terbit TIDAK pernah diubah — kode menempel permanen di
// Accurate. Pindah klasifikasi = keputusan manusia, bukan efek samping impor.

import { db, isDbEnabled } from "../db.js";

export type Level = "kategori" | "line" | "class" | "sub_class";

export interface TaxonomyNode {
  level: Level;
  kategoriId: string;
  classId: string | null;   // hanya untuk sub_class
  id: string;
  nama: string;
  aktif: boolean;
  jumlahKode: number;       // berapa produk memakai node ini
}

export interface ProductCode {
  kode: string;
  kategoriId: string; lineId: string; classId: string; subClassId: string; seq: number;
  kategoriNama: string; lineNama: string; classNama: string; subClassNama: string;
  nama: string;
  namaPrincipal: string | null;
  kemasan: string | null;
  satuan: string | null;
  brand: string | null;
  penyedia: string | null;
  kode2025: string | null;
  kodeLegacy: string | null;
  // Kode dari generator spreadsheet berbeda dari kode yang berlaku sekarang.
  // Ditampilkan supaya rekonsiliasi ke Accurate tidak menebak.
  legacyBeda: boolean;
  sumber: string;
  accurateItemId: number | null;
  catatan: string | null;
}

export interface ReviewRow {
  id: number;
  sumber: string;
  sumberBaris: number | null;
  nama: string;
  brand: string | null;
  penyedia: string | null;
  kode2025: string | null;
  kodeLegacy: string | null;
  kategoriNama: string | null;
  lineNama: string | null;
  classNama: string | null;
  subClassNama: string | null;
  masalah: string;
  status: string;
}

export interface KlasifikasiSummary {
  taxonomy: { kategori: number; line: number; class: number; subClass: number };
  kode: number;
  kodePerKategori: { kategoriId: string; nama: string; jumlah: number }[];
  kodePerSumber: { sumber: string; jumlah: number }[];
  cocokAccurate: number;
  tanpaKode2025: number;
  legacyBeda: number;
  reviewTerbuka: number;
  // Prefix yang nomor urutnya mendekati habis (>9000 dari 9999). Kosong = aman.
  prefixHampirPenuh: { prefix: string; terpakai: number }[];
}

// Antrean review menyimpan teks klasifikasi APA ADANYA dari sumber, dan importer
// kroscek menulis kolom **Lini** ('IVD' / 'Alkes') ke `kategori_nama` — bukan nama
// kategori master ('IVD' / 'NON IVD'). 116 dari 233 baris antrean di dev kena.
// Importer sudah diperbaiki untuk impor berikutnya, tapi baris yang sudah ada di
// prod tetap ber-'Alkes', jadi aliasnya harus dikenali di sini juga.
const ALIAS_KATEGORI: Record<string, string> = { alkes: "NON IVD", medical: "NON IVD", ivd: "IVD" };
const namaKategoriKanonik = (v: string): string =>
  ALIAS_KATEGORI[v.trim().toLowerCase()] ?? v;

const KODE_RE = /^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{4}$/;
const ID2 = /^\d{2}$/;
const ID3 = /^\d{3}$/;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function isKodeValid(kode: string): boolean {
  return KODE_RE.test(kode);
}

// ── Taxonomy ───────────────────────────────────────────────────────────────
export async function taxonomy(): Promise<TaxonomyNode[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT 'kategori' AS level, k.id AS kategori_id, NULL::text AS class_id, k.id, k.nama, k.aktif,
           (SELECT count(*) FROM product_code c WHERE c.kategori_id = k.id) AS jumlah_kode
      FROM product_kategori k
    UNION ALL
    SELECT 'line', l.kategori_id, NULL, l.id, l.nama, l.aktif,
           (SELECT count(*) FROM product_code c
             WHERE c.kategori_id = l.kategori_id AND c.line_id = l.id)
      FROM product_line l
    UNION ALL
    SELECT 'class', cl.kategori_id, NULL, cl.id, cl.nama, cl.aktif,
           (SELECT count(*) FROM product_code c
             WHERE c.kategori_id = cl.kategori_id AND c.class_id = cl.id)
      FROM product_class cl
    UNION ALL
    SELECT 'sub_class', s.kategori_id, s.class_id, s.id, s.nama, s.aktif,
           (SELECT count(*) FROM product_code c
             WHERE c.kategori_id = s.kategori_id AND c.class_id = s.class_id
               AND c.sub_class_id = s.id)
      FROM product_sub_class s
    ORDER BY 1, 2, 3 NULLS FIRST, 4
  `;
  return rows.map((r) => ({
    level: r.level as Level,
    kategoriId: String(r.kategori_id),
    classId: str(r.class_id),
    id: String(r.id),
    nama: String(r.nama),
    aktif: r.aktif === true,
    jumlahKode: num(r.jumlah_kode),
  }));
}

export interface NodeInput {
  level: Level;
  kategoriId: string;
  classId?: string | null;
  id: string;
  nama: string;
  aktif?: boolean;
}

/** Validasi bentuk id per level. Kesalahan panjang id = kode salah selamanya,
 *  jadi ditolak di sini, bukan diperbaiki diam-diam. */
function cekNode(n: NodeInput): string | null {
  const nama = n.nama?.trim();
  if (!nama) return "nama wajib diisi";
  if (!ID2.test(n.kategoriId)) return "kategori_id harus 2 digit angka";
  if (n.level === "sub_class") {
    if (!ID3.test(n.id)) return "id sub class harus 3 digit angka (mis. 031)";
    if (!n.classId || !ID2.test(n.classId)) return "class_id harus 2 digit angka";
  } else if (n.level !== "kategori" && !ID2.test(n.id)) {
    return "id harus 2 digit angka (mis. 09)";
  } else if (n.level === "kategori" && !ID2.test(n.id)) {
    return "id kategori harus 2 digit angka";
  }
  return null;
}

export async function upsertNode(n: NodeInput): Promise<{ ok: boolean; error?: string }> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  const bad = cekNode(n);
  if (bad) return { ok: false, error: bad };
  const sql = db();
  const nama = n.nama.trim();
  const aktif = n.aktif !== false;
  try {
    if (n.level === "kategori") {
      await sql`INSERT INTO product_kategori (id, nama, aktif) VALUES (${n.id}, ${nama}, ${aktif})
                ON CONFLICT (id) DO UPDATE SET nama = EXCLUDED.nama, aktif = EXCLUDED.aktif`;
    } else if (n.level === "line") {
      await sql`INSERT INTO product_line (kategori_id, id, nama, aktif)
                VALUES (${n.kategoriId}, ${n.id}, ${nama}, ${aktif})
                ON CONFLICT (kategori_id, id) DO UPDATE SET nama = EXCLUDED.nama, aktif = EXCLUDED.aktif`;
    } else if (n.level === "class") {
      await sql`INSERT INTO product_class (kategori_id, id, nama, aktif)
                VALUES (${n.kategoriId}, ${n.id}, ${nama}, ${aktif})
                ON CONFLICT (kategori_id, id) DO UPDATE SET nama = EXCLUDED.nama, aktif = EXCLUDED.aktif`;
    } else {
      await sql`INSERT INTO product_sub_class (kategori_id, class_id, id, nama, aktif)
                VALUES (${n.kategoriId}, ${n.classId ?? ""}, ${n.id}, ${nama}, ${aktif})
                ON CONFLICT (kategori_id, class_id, id)
                DO UPDATE SET nama = EXCLUDED.nama, aktif = EXCLUDED.aktif`;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Hapus node. Ditolak bila masih dipakai kode produk atau punya anak — kode yang
 *  sudah terbit tidak boleh jadi yatim (kodenya sudah ada di Accurate). */
export async function deleteNode(
  level: Level, kategoriId: string, id: string, classId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  const sql = db();
  const pakai = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM product_code c
     WHERE c.kategori_id = ${kategoriId}
       AND (${level}::text <> 'line'      OR c.line_id = ${id})
       AND (${level}::text <> 'class'     OR c.class_id = ${id})
       AND (${level}::text <> 'sub_class' OR (c.class_id = ${classId ?? ""} AND c.sub_class_id = ${id}))
  `;
  if (Number(pakai[0]?.n ?? 0) > 0) {
    return { ok: false, error: `masih dipakai ${pakai[0].n} kode produk — tidak bisa dihapus, nonaktifkan saja (aktif=false)` };
  }
  try {
    if (level === "kategori") {
      await sql`DELETE FROM product_kategori WHERE id = ${id}`;
    } else if (level === "line") {
      await sql`DELETE FROM product_line WHERE kategori_id = ${kategoriId} AND id = ${id}`;
    } else if (level === "class") {
      await sql`DELETE FROM product_class WHERE kategori_id = ${kategoriId} AND id = ${id}`;
    } else {
      await sql`DELETE FROM product_sub_class
                 WHERE kategori_id = ${kategoriId} AND class_id = ${classId ?? ""} AND id = ${id}`;
    }
    return { ok: true };
  } catch (e) {
    // FK dari anak (mis. class masih punya sub class) mendarat di sini.
    return { ok: false, error: (e as Error).message };
  }
}

// ── Kode produk ────────────────────────────────────────────────────────────
export interface CodeFilter {
  kategoriId?: string; lineId?: string; classId?: string; subClassId?: string;
  sumber?: string; q?: string; limit?: number;
}

export async function listCodes(f: CodeFilter = {}): Promise<ProductCode[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const limit = Math.min(Math.max(f.limit ?? 5000, 1), 20000);
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const rows = await sql<Record<string, unknown>[]>`
    SELECT c.*, k.nama AS kategori_nama, l.nama AS line_nama,
           cl.nama AS class_nama, s.nama AS sub_class_nama
      FROM product_code c
      JOIN product_kategori  k  ON k.id = c.kategori_id
      JOIN product_line      l  ON l.kategori_id = c.kategori_id AND l.id  = c.line_id
      JOIN product_class     cl ON cl.kategori_id = c.kategori_id AND cl.id = c.class_id
      JOIN product_sub_class s  ON s.kategori_id = c.kategori_id AND s.class_id = c.class_id
                               AND s.id = c.sub_class_id
     WHERE (${f.kategoriId ?? null}::text IS NULL OR c.kategori_id = ${f.kategoriId ?? null})
       AND (${f.lineId ?? null}::text     IS NULL OR c.line_id = ${f.lineId ?? null})
       AND (${f.classId ?? null}::text    IS NULL OR c.class_id = ${f.classId ?? null})
       AND (${f.subClassId ?? null}::text IS NULL OR c.sub_class_id = ${f.subClassId ?? null})
       AND (${f.sumber ?? null}::text     IS NULL OR c.sumber = ${f.sumber ?? null})
       AND (${q}::text IS NULL OR c.nama ILIKE ${q} OR c.kode ILIKE ${q}
            OR c.kode_2025 ILIKE ${q} OR c.brand ILIKE ${q} OR c.nama_principal ILIKE ${q})
     ORDER BY c.kode
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    kode: String(r.kode),
    kategoriId: String(r.kategori_id), lineId: String(r.line_id),
    classId: String(r.class_id), subClassId: String(r.sub_class_id), seq: num(r.seq),
    kategoriNama: String(r.kategori_nama), lineNama: String(r.line_nama),
    classNama: String(r.class_nama), subClassNama: String(r.sub_class_nama),
    nama: String(r.nama),
    namaPrincipal: str(r.nama_principal), kemasan: str(r.kemasan), satuan: str(r.satuan),
    brand: str(r.brand), penyedia: str(r.penyedia),
    kode2025: str(r.kode_2025), kodeLegacy: str(r.kode_legacy),
    legacyBeda: !!r.kode_legacy && String(r.kode_legacy) !== String(r.kode),
    sumber: String(r.sumber),
    accurateItemId: r.accurate_item_id === null ? null : Number(r.accurate_item_id),
    catatan: str(r.catatan),
  }));
}

export interface NextKode {
  prefix: string;
  seq: number;
  kode: string;
  terpakai: number;
  kategoriNama: string; lineNama: string; classNama: string; subClassNama: string;
}

/** Pratinjau kode berikutnya untuk satu prefix. Angka ini BUKAN reservasi —
 *  yang mengikat hanya INSERT (lihat createCode). */
export async function nextKode(
  kategoriId: string, lineId: string, classId: string, subClassId: string,
): Promise<{ ok: true; data: NextKode } | { ok: false; error: string }> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT k.nama AS kategori_nama, l.nama AS line_nama, cl.nama AS class_nama,
           s.nama AS sub_class_nama,
           (SELECT count(*) FROM product_code c
             WHERE c.kategori_id = ${kategoriId} AND c.line_id = ${lineId}
               AND c.class_id = ${classId} AND c.sub_class_id = ${subClassId}) AS terpakai,
           (SELECT COALESCE(max(c.seq), 0) FROM product_code c
             WHERE c.kategori_id = ${kategoriId} AND c.line_id = ${lineId}
               AND c.class_id = ${classId} AND c.sub_class_id = ${subClassId}) AS seq_max
      FROM product_kategori k
      JOIN product_line      l  ON l.kategori_id = k.id AND l.id = ${lineId}
      JOIN product_class     cl ON cl.kategori_id = k.id AND cl.id = ${classId}
      JOIN product_sub_class s  ON s.kategori_id = k.id AND s.class_id = ${classId}
                               AND s.id = ${subClassId}
     WHERE k.id = ${kategoriId}
  `;
  const r = rows[0];
  if (!r) {
    return { ok: false, error: "kombinasi kategori → product line → class → sub class tidak terdaftar di master" };
  }
  const seq = num(r.seq_max) + 1;
  if (seq > 9999) return { ok: false, error: "nomor urut prefix ini sudah habis (9999)" };
  const prefix = `${kategoriId}.${lineId}.${classId}.${subClassId}`;
  return {
    ok: true,
    data: {
      prefix, seq, kode: `${prefix}.${String(seq).padStart(4, "0")}`, terpakai: num(r.terpakai),
      kategoriNama: String(r.kategori_nama), lineNama: String(r.line_nama),
      classNama: String(r.class_nama), subClassNama: String(r.sub_class_nama),
    },
  };
}

export interface CodeInput {
  kategoriId: string; lineId: string; classId: string; subClassId: string;
  nama: string;
  namaPrincipal?: string | null; kemasan?: string | null; satuan?: string | null;
  brand?: string | null; penyedia?: string | null;
  kode2025?: string | null; catatan?: string | null;
  createdBy?: string | null;
}

/** Terbitkan kode baru. Nomor urut dihitung DI DALAM satu pernyataan INSERT …
 *  SELECT max(seq)+1, jadi dua permintaan berbarengan tidak bisa menerbitkan
 *  kode kembar (yang kalah kena UNIQUE dan diulang). */
export async function createCode(
  input: CodeInput,
): Promise<{ ok: true; kode: string } | { ok: false; error: string }> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  const nama = input.nama?.trim();
  if (!nama) return { ok: false, error: "nama produk wajib diisi" };
  if (!ID2.test(input.kategoriId) || !ID2.test(input.lineId) || !ID2.test(input.classId)
      || !ID3.test(input.subClassId)) {
    return { ok: false, error: "id klasifikasi tidak valid (kategori/line/class 2 digit, sub class 3 digit)" };
  }
  const sql = db();
  const kode2025 = input.kode2025?.trim() || null;
  // Sama dengan importer: kode Accurate berjalan lebih dipercaya daripada nama.
  const identitas = kode2025 ? `K:${kode2025.toUpperCase()}` : `N:${nama.toUpperCase()}`;

  for (let coba = 0; coba < 5; coba++) {
    try {
      const rows = await sql<{ kode: string }[]>`
        INSERT INTO product_code (
          kode, kategori_id, line_id, class_id, sub_class_id, seq, identitas, nama,
          nama_principal, kemasan, satuan, brand, penyedia, kode_2025, sumber, catatan, created_by)
        SELECT ${input.kategoriId} || '.' || ${input.lineId} || '.' || ${input.classId} || '.'
                 || ${input.subClassId} || '.' || lpad((n.seq)::text, 4, '0'),
               ${input.kategoriId}, ${input.lineId}, ${input.classId}, ${input.subClassId},
               n.seq, ${identitas}, ${nama},
               ${input.namaPrincipal ?? null}, ${input.kemasan ?? null}, ${input.satuan ?? null},
               ${input.brand ?? null}, ${input.penyedia ?? null}, ${kode2025}, 'manual',
               ${input.catatan ?? null}, ${input.createdBy ?? null}
          FROM (SELECT COALESCE(max(c.seq), 0) + 1 AS seq FROM product_code c
                 WHERE c.kategori_id = ${input.kategoriId} AND c.line_id = ${input.lineId}
                   AND c.class_id = ${input.classId} AND c.sub_class_id = ${input.subClassId}) n
         WHERE n.seq <= 9999
        RETURNING kode
      `;
      if (!rows[0]) return { ok: false, error: "nomor urut prefix ini sudah habis (9999)" };
      return { ok: true, kode: rows[0].kode };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("product_code_identitas_key")) {
        const ada = await sql<{ kode: string }[]>`
          SELECT kode FROM product_code WHERE identitas = ${identitas}`;
        return {
          ok: false,
          error: `produk ini sudah punya kode ${ada[0]?.kode ?? "(?)"} — ${
            kode2025 ? `kode 2025 '${kode2025}'` : `nama '${nama}'`} sudah terpakai`,
        };
      }
      // Bentrok nomor urut (dua penerbitan bersamaan) → ulangi, max 5x.
      if (msg.includes("product_code_pkey") || msg.includes("kategori_id_line_id_class_id")) continue;
      if (msg.includes("violates foreign key")) {
        return { ok: false, error: "kombinasi klasifikasi tidak terdaftar di master" };
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "gagal menerbitkan kode setelah 5 percobaan (bentrok nomor urut)" };
}

// ── Antrean review ─────────────────────────────────────────────────────────
export async function listReview(status = "terbuka", limit = 2000): Promise<ReviewRow[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM product_code_review
     WHERE (${status}::text = 'semua' OR status = ${status})
     ORDER BY sumber, sumber_baris
     LIMIT ${Math.min(Math.max(limit, 1), 20000)}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    sumber: String(r.sumber),
    sumberBaris: r.sumber_baris === null ? null : Number(r.sumber_baris),
    nama: String(r.nama),
    brand: str(r.brand), penyedia: str(r.penyedia),
    kode2025: str(r.kode_2025), kodeLegacy: str(r.kode_legacy),
    kategoriNama: str(r.kategori_nama), lineNama: str(r.line_nama),
    classNama: str(r.class_nama), subClassNama: str(r.sub_class_nama),
    masalah: String(r.masalah),
    status: String(r.status),
  }));
}

export async function setReviewStatus(
  id: number, status: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  if (!["terbuka", "beres", "diabaikan"].includes(status)) {
    return { ok: false, error: "status harus terbuka/beres/diabaikan" };
  }
  const sql = db();
  await sql`UPDATE product_code_review SET status = ${status} WHERE id = ${id}`;
  return { ok: true };
}

// ── Ringkasan ──────────────────────────────────────────────────────────────
export async function summary(): Promise<KlasifikasiSummary> {
  const kosong: KlasifikasiSummary = {
    taxonomy: { kategori: 0, line: 0, class: 0, subClass: 0 },
    kode: 0, kodePerKategori: [], kodePerSumber: [], cocokAccurate: 0,
    tanpaKode2025: 0, legacyBeda: 0, reviewTerbuka: 0, prefixHampirPenuh: [],
  };
  if (!isDbEnabled()) return kosong;
  const sql = db();
  const [tax] = await sql<Record<string, unknown>[]>`
    SELECT (SELECT count(*) FROM product_kategori)  AS kategori,
           (SELECT count(*) FROM product_line)      AS line,
           (SELECT count(*) FROM product_class)     AS class,
           (SELECT count(*) FROM product_sub_class) AS sub_class,
           (SELECT count(*) FROM product_code)      AS kode,
           (SELECT count(*) FROM product_code WHERE accurate_item_id IS NOT NULL) AS cocok,
           (SELECT count(*) FROM product_code WHERE kode_2025 IS NULL) AS tanpa_kode_2025,
           (SELECT count(*) FROM product_code WHERE kode_legacy IS NOT NULL AND kode_legacy <> kode) AS legacy_beda,
           (SELECT count(*) FROM product_code_review WHERE status = 'terbuka') AS review_terbuka
  `;
  const perKategori = await sql<Record<string, unknown>[]>`
    SELECT c.kategori_id, k.nama, count(*) AS jumlah
      FROM product_code c JOIN product_kategori k ON k.id = c.kategori_id
     GROUP BY 1, 2 ORDER BY 1
  `;
  const perSumber = await sql<Record<string, unknown>[]>`
    SELECT sumber, count(*) AS jumlah FROM product_code GROUP BY 1 ORDER BY 2 DESC
  `;
  // Nomor urut 4 digit = 9999 produk per prefix. Belum pernah dekat, tapi kalau
  // sampai penuh kodenya tidak bisa diperlebar tanpa mengubah kode yang sudah
  // ada di Accurate — jadi diawasi.
  const penuh = await sql<Record<string, unknown>[]>`
    SELECT kategori_id || '.' || line_id || '.' || class_id || '.' || sub_class_id AS prefix,
           max(seq) AS terpakai
      FROM product_code GROUP BY 1 HAVING max(seq) > 9000 ORDER BY 2 DESC LIMIT 20
  `;
  return {
    taxonomy: {
      kategori: num(tax.kategori), line: num(tax.line),
      class: num(tax.class), subClass: num(tax.sub_class),
    },
    kode: num(tax.kode),
    kodePerKategori: perKategori.map((r) => ({
      kategoriId: String(r.kategori_id), nama: String(r.nama), jumlah: num(r.jumlah),
    })),
    kodePerSumber: perSumber.map((r) => ({ sumber: String(r.sumber), jumlah: num(r.jumlah) })),
    cocokAccurate: num(tax.cocok),
    tanpaKode2025: num(tax.tanpa_kode_2025),
    legacyBeda: num(tax.legacy_beda),
    reviewTerbuka: num(tax.review_terbuka),
    prefixHampirPenuh: penuh.map((r) => ({ prefix: String(r.prefix), terpakai: num(r.terpakai) })),
  };
}

// ── Selesaikan satu baris antrean "Perlu Keputusan" ─────────────────────────
// Sebelumnya tombol di UI cuma mengubah status jadi 'beres': barisnya hilang dari
// antrean padahal tak ada kode terbit dan master tetap kurang — jalan buntu yang
// menyesatkan (dikeluhkan user 1 Agt 2026: "kagak tau larinya data ke mana").
//
// Sekarang satu aksi menyelesaikan betulan, dalam SATU transaksi:
//   a. sub class BARU  → daftarkan ke master di bawah (kategori, class) baris itu,
//      id = 3 digit berikutnya yang belum terpakai di class itu; atau
//   b. sub class ADA   → pakai id yang dipilih (produk dipindahkan ke sana),
// lalu terbitkan kode KK.PP.CC.SSS.NNNN dan tandai barisnya 'beres'.
//
// Transaksi itu wajib: tanpa itu, kegagalan di langkah kode meninggalkan sub
// class karangan di master — dan master inilah yang jadi sumber kode permanen.

export interface SelesaikanInput {
  /** id sub class yang sudah ada (3 digit). Kosongkan untuk mendaftarkan baru. */
  subClassId?: string | null;
  /** nama sub class baru; default = nama di baris antrean. */
  subClassNama?: string | null;
  /** Akui bahwa kode yang sudah ada (dipasangkan atas dasar NAMA) memang produk
   *  yang sama. Wajib untuk baris tanpa kode 2025 — satu nama bisa dipakai
   *  beberapa produk berbeda. */
  akuiNamaSama?: boolean;
  by?: string | null;
}

export async function selesaikanReview(
  id: number,
  input: SelesaikanInput,
): Promise<
  | { ok: true; kode: string; subClassId: string; didaftarkan: boolean; sudahAda?: boolean;
      /** berapa baris price book yang ikut dapat pautan kode ini */
      pricebookDipautkan: number }
  | { ok: false; error: string }
> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      const [r] = await tx<Record<string, unknown>[]>`
        SELECT * FROM product_code_review WHERE id = ${id} FOR UPDATE`;
      if (!r) return { ok: false as const, error: "baris antrean tidak ditemukan" };
      if (r.status !== "terbuka") {
        return { ok: false as const, error: `baris ini sudah berstatus '${String(r.status)}'` };
      }

      // Kategori → line → class WAJIB sudah ada di master. Kalau salah satunya
      // belum, yang kurang bukan sub class-nya — itu keputusan yang lebih besar
      // dan tidak boleh diselesaikan lewat dialog ini.
      // Produk yang SUDAH punya kode: barisnya cuma basi (kodenya terbit lewat
      // sheet lain / impor sebelumnya). Menolak dengan galat cuma bikin antrean
      // macet selamanya, jadi barisnya ditutup dan kode yang ada dilaporkan.
      const identitasAwal = r.kode_2025
        ? `K:${String(r.kode_2025).toUpperCase()}`
        : `N:${String(r.nama ?? "").toUpperCase()}`;
      const [sudah] = await tx<{ kode: string }[]>`
        SELECT kode FROM product_code WHERE identitas = ${identitasAwal}`;
      if (sudah) {
        // Bentuk 'N:' dipasangkan atas dasar nama saja — rawan (satu nama bisa
        // dipakai beberapa produk). Butuh pengakuan manusia dulu.
        if (identitasAwal.startsWith("N:") && !input.akuiNamaSama) {
          return { ok: false as const,
                   error: `Sudah ada kode ${sudah.kode} untuk produk BERNAMA SAMA, tapi baris ini tak punya kode 2025 — `
                        + `belum tentu produk yang sama. Periksa di tab Kode Produk; kalau memang sama, ulangi dengan centang konfirmasi.` };
        }
        const kodeFinal = sudah.kode;

      // Tutup lingkarannya: `product_code_review.kode_legacy` itu kode 5-bagian
      // dari sheet, dan kolom itulah yang disimpan di
      // `product_pricelist_setup.kode_sumber`. Tanpa langkah ini, kode baru terbit
      // tapi KPI "Dapat kode produk" di Setup Harga tetap 0 sampai importer
      // dijalankan lagi — dan user tak punya cara menebaknya.
      let pricebookDipautkan = 0;
      const legacy = String(r.kode_legacy ?? "").trim();
      if (legacy) {
        const dipautkan = await tx`
          UPDATE product_pricelist_setup SET product_kode = ${kodeFinal}, updated_at = now()
           WHERE product_kode IS NULL AND kode_sumber = ${legacy}
          RETURNING row_no`;
        pricebookDipautkan = dipautkan.length;
      }
        await tx`UPDATE product_code_review SET status = 'beres' WHERE id = ${id}`;
        return { ok: true as const, kode: kodeFinal, subClassId: String(kodeFinal).split(".")[3],
                 didaftarkan: false, sudahAda: true, pricebookDipautkan };
      }

      const katSumber = String(r.kategori_nama ?? "");
      const [kat] = await tx<{ id: string }[]>`
        SELECT id FROM product_kategori
         WHERE lower(nama) IN (lower(${katSumber}), lower(${namaKategoriKanonik(katSumber)}))
         ORDER BY (lower(nama) = lower(${katSumber})) DESC LIMIT 1`;
      if (!kat) return { ok: false as const, error: `Kategori '${katSumber}' belum ada di master` };
      // Baris tanpa teks Product Line / Class di sumber tidak bisa diselesaikan di
      // sini — yang kurang bukan sub class-nya, tapi seluruh klasifikasinya. Itu
      // pekerjaan tab "Terbitkan Kode" yang memang meminta keempat level.
      if (!String(r.line_nama ?? "").trim() || !String(r.class_nama ?? "").trim()) {
        return { ok: false as const,
                 error: "Baris ini tak punya Product Line/Class di sumber, jadi tak ada induk yang bisa dipakai. "
                      + "Terbitkan kodenya lewat tab Terbitkan Kode (pilih sendiri keempat level)." };
      }
      const [line] = await tx<{ id: string }[]>`
        SELECT id FROM product_line
         WHERE kategori_id = ${kat.id} AND lower(nama) = lower(${String(r.line_nama ?? "")})`;
      if (!line) {
        return { ok: false as const,
                 error: `Product Line '${String(r.line_nama ?? "")}' belum terdaftar di kategori ${kat.id} — lengkapi dulu di tab Master Klasifikasi` };
      }
      const [cls] = await tx<{ id: string }[]>`
        SELECT id FROM product_class
         WHERE kategori_id = ${kat.id} AND lower(nama) = lower(${String(r.class_nama ?? "")})`;
      if (!cls) {
        return { ok: false as const,
                 error: `Class '${String(r.class_nama ?? "")}' belum terdaftar di kategori ${kat.id} — lengkapi dulu di tab Master Klasifikasi` };
      }

      let subId = (input.subClassId ?? "").trim();
      let didaftarkan = false;
      if (subId) {
        if (!ID3.test(subId)) return { ok: false as const, error: "id sub class harus 3 digit angka" };
        const [ada] = await tx<{ id: string }[]>`
          SELECT id FROM product_sub_class
           WHERE kategori_id = ${kat.id} AND class_id = ${cls.id} AND id = ${subId}`;
        if (!ada) {
          return { ok: false as const,
                   error: `sub class ${subId} tidak ada di Class ${cls.id} kategori ${kat.id}` };
        }
      } else {
        const nama = (input.subClassNama ?? String(r.sub_class_nama ?? "")).trim();
        if (!nama) return { ok: false as const, error: "nama sub class wajib diisi" };
        // Nama yang sama di class yang sama = pakai yang sudah ada, jangan bikin
        // id kedua untuk hal yang sama.
        const [sama] = await tx<{ id: string }[]>`
          SELECT id FROM product_sub_class
           WHERE kategori_id = ${kat.id} AND class_id = ${cls.id} AND lower(nama) = lower(${nama})`;
        if (sama) {
          subId = sama.id;
        } else {
          const [maks] = await tx<{ n: number }[]>`
            SELECT COALESCE(MAX(id::int), 0) AS n FROM product_sub_class
             WHERE kategori_id = ${kat.id} AND class_id = ${cls.id}`;
          const next = num(maks?.n) + 1;
          if (next > 999) return { ok: false as const, error: "id sub class di class ini sudah habis (999)" };
          subId = String(next).padStart(3, "0");
          await tx`INSERT INTO product_sub_class (kategori_id, class_id, id, nama)
                   VALUES (${kat.id}, ${cls.id}, ${subId}, ${nama})`;
          didaftarkan = true;
        }
      }

      // Nomor urut dihitung di dalam INSERT … SELECT max(seq)+1 supaya dua
      // permintaan berbarengan tak bisa menerbitkan kode kembar.
      const identitas = r.kode_2025
        ? `K:${String(r.kode_2025).toUpperCase()}`
        : `N:${String(r.nama ?? "").toUpperCase()}`;
      const [kodeRow] = await tx<{ kode: string }[]>`
        INSERT INTO product_code (
          kode, kategori_id, line_id, class_id, sub_class_id, seq, identitas, nama,
          nama_principal, kemasan, satuan, brand, penyedia, kode_2025, kode_legacy,
          sumber, created_by)
        SELECT ${kat.id} || '.' || ${line.id} || '.' || ${cls.id} || '.' || ${subId} || '.' ||
               lpad((COALESCE(MAX(c.seq), 0) + 1)::text, 4, '0'),
               ${kat.id}, ${line.id}, ${cls.id}, ${subId}, COALESCE(MAX(c.seq), 0) + 1,
               ${identitas}, ${String(r.nama ?? "")},
               ${(r.nama_principal as string) ?? null}, ${(r.kemasan as string) ?? null},
               ${(r.satuan as string) ?? null}, ${(r.brand as string) ?? null},
               ${(r.penyedia as string) ?? null}, ${(r.kode_2025 as string) ?? null},
               ${(r.kode_legacy as string) ?? null},
               ${`review:${String(r.sumber ?? "")}`}, ${input.by ?? null}
          FROM product_code c
         WHERE c.kategori_id = ${kat.id} AND c.line_id = ${line.id}
           AND c.class_id = ${cls.id} AND c.sub_class_id = ${subId}
        RETURNING kode`;
      if (!kodeRow) return { ok: false as const, error: "gagal menerbitkan kode" };

      const kodeFinal = kodeRow.kode;

      // Tutup lingkarannya: `product_code_review.kode_legacy` itu kode 5-bagian
      // dari sheet, dan kolom itulah yang disimpan di
      // `product_pricelist_setup.kode_sumber`. Tanpa langkah ini, kode baru terbit
      // tapi KPI "Dapat kode produk" di Setup Harga tetap 0 sampai importer
      // dijalankan lagi — dan user tak punya cara menebaknya.
      let pricebookDipautkan = 0;
      const legacy = String(r.kode_legacy ?? "").trim();
      if (legacy) {
        const dipautkan = await tx`
          UPDATE product_pricelist_setup SET product_kode = ${kodeFinal}, updated_at = now()
           WHERE product_kode IS NULL AND kode_sumber = ${legacy}
          RETURNING row_no`;
        pricebookDipautkan = dipautkan.length;
      }
      await tx`UPDATE product_code_review SET status = 'beres' WHERE id = ${id}`;
      // Pautkan ke mirror Accurate kalau kode berjalannya cocok — sama aturannya
      // dengan importer: lewat kode saja, tidak fuzzy nama.
      await tx`UPDATE product_code p SET accurate_item_id = ai.id, updated_at = now()
                 FROM accurate_item ai
                WHERE p.kode = ${kodeFinal} AND p.kode_2025 IS NOT NULL AND ai.no = p.kode_2025`;
      return { ok: true as const, kode: kodeFinal, subClassId: subId, didaftarkan, sudahAda: false,
               pricebookDipautkan };
    });
  } catch (e) {
    const msg = (e as Error).message;
    // identitas UNIQUE = produk ini sudah punya kode. Itu bukan kegagalan teknis,
    // jadi pesannya dibuat bisa dimengerti HoD.
    if (/product_code_identitas_key|duplicate key/.test(msg)) {
      return { ok: false, error: "produk ini sudah punya kode (identitas sama) — cek tab Kode Produk" };
    }
    return { ok: false, error: msg };
  }
}

/** Sub class yang sudah terdaftar di bawah (kategori, class) sebuah baris antrean —
 *  bahan pilihan "pakai yang sudah ada" di dialog. */
export async function subClassPilihan(
  reviewId: number,
): Promise<{ ok: true; kategoriId: string; classId: string; rows: { id: string; nama: string }[] }
  | { ok: false; error: string }> {
  if (!isDbEnabled()) return { ok: false, error: "db disabled" };
  const sql = db();
  const [r] = await sql<Record<string, unknown>[]>`
    SELECT kategori_nama, class_nama FROM product_code_review WHERE id = ${reviewId}`;
  if (!r) return { ok: false, error: "baris antrean tidak ditemukan" };
  const katSumber = String(r.kategori_nama ?? "");
  const [kat] = await sql<{ id: string }[]>`
    SELECT id FROM product_kategori
     WHERE lower(nama) IN (lower(${katSumber}), lower(${namaKategoriKanonik(katSumber)}))
     ORDER BY (lower(nama) = lower(${katSumber})) DESC LIMIT 1`;
  if (!kat) return { ok: false, error: "kategori baris ini belum ada di master" };
  const [cls] = await sql<{ id: string }[]>`
    SELECT id FROM product_class
     WHERE kategori_id = ${kat.id} AND lower(nama) = lower(${String(r.class_nama ?? "")})`;
  if (!cls) return { ok: false, error: "class baris ini belum terdaftar di kategorinya" };
  const rows = await sql<{ id: string; nama: string }[]>`
    SELECT id, nama FROM product_sub_class
     WHERE kategori_id = ${kat.id} AND class_id = ${cls.id} ORDER BY id`;
  return { ok: true, kategoriId: kat.id, classId: cls.id, rows };
}
