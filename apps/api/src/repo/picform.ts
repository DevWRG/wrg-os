import { db } from "../db.js";

// Read-only atas data 6 form PIC Divisi (migrasi 168 + 170/171). Datanya masuk
// lewat scripts/ops/pic-form-to-json.py → pic-form-import.mjs, BUKAN lewat HTTP,
// jadi modul ini sengaja tidak punya jalur tulis apa pun.
//
// KENAPA `kondisi` DAN `target_level` SELALU DISAJIKAN BERPASANGAN, tak pernah
// satu angka "tingkat otomasi": angka yang tampil di
// WRG-OS_Blueprint-Operasional.html (Manual 22 · Digitalisasi 122 · Otomasi 37 ·
// AI 4) adalah distribusi kolom TARGET, sedangkan kondisi sekarang Manual 296 ·
// Digitalisasi 117 · Otomasi 5 · belum diisi 18. Dua-duanya sah, dan siapa pun
// yang membaca satu tanpa yang lain akan menyimpulkan arah yang berlawanan.
// Karena itu UI wajib punya dua kolom/dua baris — bukan satu metrik gabungan.

export const LEVEL_URUT = ["Manual", "Digitalisasi", "Otomasi", "AI"] as const;
export type Level = (typeof LEVEL_URUT)[number];

export interface LevelBucket { level: Level | null; jumlah: number }
export interface DivisiOtomasi {
  divisi_key: string;
  divisi: string;
  sop: number;
  langkah: number;
  kondisi: LevelBucket[];
  target: LevelBucket[];
  /** langkah yang target_level-nya lebih tinggi dari kondisi (rencana naik kelas) */
  naik: number;
  /** langkah yang kolom Target Level-nya belum diisi PIC */
  target_kosong: number;
}
export interface PicFormSummary {
  total_sop: number;
  total_langkah: number;
  kondisi: LevelBucket[];
  target: LevelBucket[];
  naik: number;
  target_kosong: number;
  per_divisi: DivisiOtomasi[];
}

const kePeta = (rows: { level: string | null; jumlah: string | number }[]): LevelBucket[] => {
  const peta = new Map<string, number>();
  for (const r of rows) peta.set(r.level ?? "", Number(r.jumlah));
  const out: LevelBucket[] = LEVEL_URUT.map((l) => ({ level: l, jumlah: peta.get(l) ?? 0 }));
  const kosong = peta.get("") ?? 0;
  // Baris "belum diisi" SELALU disertakan walau nol — supaya UI tak perlu
  // menebak apakah bucket itu ada, dan supaya 251 target kosong tak lenyap.
  out.push({ level: null, jumlah: kosong });
  return out;
};

export async function picFormSummary(): Promise<PicFormSummary> {
  const sql = db();
  // Peringkat level dipakai untuk menghitung "naik kelas". Ditulis di SQL (bukan
  // di JS atas baris terpaginasi) supaya angkanya benar untuk SELURUH data —
  // pola yang sama dengan endpoint /summary terpisah di F37: kartu KPI tidak
  // boleh dihitung dari array yang sudah dipotong LIMIT.
  const [agg] = await sql`
    WITH pangkat AS (
      SELECT sl.*, so.divisi_key,
             array_position(ARRAY['Manual','Digitalisasi','Otomasi','AI'], sl.kondisi)      AS p_kondisi,
             array_position(ARRAY['Manual','Digitalisasi','Otomasi','AI'], sl.target_level) AS p_target
      FROM sop_langkah sl JOIN sop so ON so.id = sl.sop_id
    )
    SELECT count(*)::int                                                            AS langkah,
           count(DISTINCT sop_id)::int                                              AS sop,
           count(*) FILTER (WHERE p_target IS NOT NULL AND p_kondisi IS NOT NULL
                              AND p_target > p_kondisi)::int                        AS naik,
           count(*) FILTER (WHERE target_level IS NULL)::int                        AS target_kosong
    FROM pangkat`;

  const kondisi = await sql`
    SELECT kondisi AS level, count(*)::int AS jumlah FROM sop_langkah GROUP BY 1`;
  const target = await sql`
    SELECT target_level AS level, count(*)::int AS jumlah FROM sop_langkah GROUP BY 1`;

  const perDivisi = await sql`
    WITH pangkat AS (
      SELECT sl.*, so.divisi_key,
             array_position(ARRAY['Manual','Digitalisasi','Otomasi','AI'], sl.kondisi)      AS p_kondisi,
             array_position(ARRAY['Manual','Digitalisasi','Otomasi','AI'], sl.target_level) AS p_target
      FROM sop_langkah sl JOIN sop so ON so.id = sl.sop_id
    )
    SELECT d.key AS divisi_key, d.label AS divisi, d.seq,
           coalesce(count(p.id), 0)::int                                            AS langkah,
           coalesce(count(DISTINCT p.sop_id), 0)::int                               AS sop,
           coalesce(count(p.id) FILTER (WHERE p.p_target IS NOT NULL
                     AND p.p_kondisi IS NOT NULL AND p.p_target > p.p_kondisi), 0)::int AS naik,
           coalesce(count(p.id) FILTER (WHERE p.target_level IS NULL), 0)::int       AS target_kosong
    FROM divisi d LEFT JOIN pangkat p ON p.divisi_key = d.key
    GROUP BY 1,2,3 ORDER BY d.seq`;

  // Distribusi level per divisi diambil sebagai query TERPISAH, bukan
  // jsonb_agg di dalam query di atas: agregat bersarang gampang kena fan-out
  // begitu nanti ada JOIN tambahan (persis yang terjadi pada
  // v_posisi_employee_gap), dan biayanya di sini nol — 436 baris.
  const kondisiDiv = await sql`
    SELECT so.divisi_key, sl.kondisi AS level, count(*)::int AS jumlah
      FROM sop_langkah sl JOIN sop so ON so.id = sl.sop_id GROUP BY 1,2`;
  const targetDiv = await sql`
    SELECT so.divisi_key, sl.target_level AS level, count(*)::int AS jumlah
      FROM sop_langkah sl JOIN sop so ON so.id = sl.sop_id GROUP BY 1,2`;

  const per: DivisiOtomasi[] = perDivisi.map((d) => ({
    divisi_key: d.divisi_key as string,
    divisi: d.divisi as string,
    sop: Number(d.sop),
    langkah: Number(d.langkah),
    naik: Number(d.naik),
    target_kosong: Number(d.target_kosong),
    kondisi: kePeta(kondisiDiv.filter((r) => r.divisi_key === d.divisi_key) as never),
    target: kePeta(targetDiv.filter((r) => r.divisi_key === d.divisi_key) as never),
  }));

  return {
    total_sop: Number(agg?.sop ?? 0),
    total_langkah: Number(agg?.langkah ?? 0),
    naik: Number(agg?.naik ?? 0),
    target_kosong: Number(agg?.target_kosong ?? 0),
    kondisi: kePeta(kondisi as never),
    target: kePeta(target as never),
    per_divisi: per,
  };
}

export interface LangkahQuery {
  q?: string; divisi?: string; kondisi?: string; target?: string;
  /** hanya langkah yang kolom Target Level-nya belum diisi */
  targetKosong?: boolean;
  limit?: number; offset?: number;
}
export interface LangkahRow {
  id: number; divisi_key: string; divisi: string; sop: string; seq: number;
  langkah: string; kondisi: string | null; kondisi_raw: string | null;
  target_level: string | null; target_raw: string | null; catatan: string | null;
}

export async function listSopLangkah(qy: LangkahQuery = {}): Promise<{
  rows: LangkahRow[]; total_rows: number;
}> {
  const sql = db();
  const limit = Math.min(Math.max(qy.limit ?? 100, 1), 500);
  const offset = Math.max(qy.offset ?? 0, 0);
  const q = (qy.q ?? "").trim();

  const rows = await sql`
    WITH difilter AS (
      SELECT sl.id, so.divisi_key, d.label AS divisi, so.nama AS sop, sl.seq,
             sl.langkah, sl.kondisi, sl.kondisi_raw, sl.target_level, sl.target_raw,
             sl.catatan, d.seq AS d_seq, so.seq AS s_seq
      FROM sop_langkah sl
      JOIN sop so ON so.id = sl.sop_id
      JOIN divisi d ON d.key = so.divisi_key
      WHERE (${q} = '' OR sl.langkah ILIKE ${"%" + q + "%"} OR so.nama ILIKE ${"%" + q + "%"}
             OR coalesce(sl.catatan, '') ILIKE ${"%" + q + "%"})
        AND (${qy.divisi ?? null}::text IS NULL OR so.divisi_key = ${qy.divisi ?? null})
        -- 'BELUM' dipakai untuk menyaring yang NULL. Tanpa nilai sentinel ini,
        -- 18 langkah tanpa kondisi & 251 tanpa target tidak bisa dicari sama
        -- sekali dari UI — padahal itu justru daftar kerja yang perlu ditagih.
        AND (${qy.kondisi ?? null}::text IS NULL
             OR (${qy.kondisi ?? ""} = 'BELUM' AND sl.kondisi IS NULL)
             OR sl.kondisi = ${qy.kondisi ?? null})
        AND (${qy.target ?? null}::text IS NULL
             OR (${qy.target ?? ""} = 'BELUM' AND sl.target_level IS NULL)
             OR sl.target_level = ${qy.target ?? null})
        AND (${qy.targetKosong ?? false} = false OR sl.target_level IS NULL)
    )
    SELECT *, count(*) OVER () AS total_rows
    FROM difilter
    ORDER BY d_seq, s_seq, seq
    LIMIT ${limit} OFFSET ${offset}`;

  // `count(*) OVER ()` hanya terbaca dari baris hasil, dan halaman kosong tak
  // punya baris → total_rows jadi 0 dan klien tak bisa membedakan "offset
  // kelewat jauh" dari "tak ada data". Diselesaikan dengan memanggil ulang
  // fungsi INI (offset 0) supaya filternya mustahil menyimpang. Pola & alasan
  // sama listStockBranch di repo/stock-branch.ts.
  if (rows.length === 0 && offset > 0) {
    const probe = await listSopLangkah({ ...qy, limit: 1, offset: 0 });
    return { rows: [], total_rows: probe.total_rows };
  }

  return {
    total_rows: rows.length ? Number(rows[0].total_rows) : 0,
    rows: rows.map((r) => ({
      id: Number(r.id), divisi_key: r.divisi_key as string, divisi: r.divisi as string,
      sop: r.sop as string, seq: Number(r.seq), langkah: r.langkah as string,
      kondisi: (r.kondisi as string | null) ?? null,
      kondisi_raw: (r.kondisi_raw as string | null) ?? null,
      target_level: (r.target_level as string | null) ?? null,
      target_raw: (r.target_raw as string | null) ?? null,
      catatan: (r.catatan as string | null) ?? null,
    })),
  };
}

export interface RaciQuery { q?: string; divisi?: string; limit?: number; offset?: number }
export interface RaciRow {
  tugas_id: number; divisi_key: string; divisi: string; proses: string;
  r_responsible: string; a_accountable: string | null; a_belum_kanonik: boolean;
  frekuensi: string | null; kpi_target: string | null;
}

// RACI grain POSISI, dari view v_raci_posisi (migrasi 168). BUKAN pengganti
// /people/raci — itu grain KARYAWAN dari raci_assignment (migrasi 052/053,
// turunan transkrip). Dua-duanya sah dan menjawab pertanyaan berbeda:
// "posisi apa yang bertanggung jawab atas proses ini" vs "orang ini terlibat
// di proses apa saja". Menggabungkannya butuh posisi_employee lengkap, dan
// itu baru menutup 26 dari 53 karyawan.
export async function listRaciPosisi(qy: RaciQuery = {}): Promise<{
  rows: RaciRow[]; total_rows: number;
}> {
  const sql = db();
  const limit = Math.min(Math.max(qy.limit ?? 100, 1), 500);
  const offset = Math.max(qy.offset ?? 0, 0);
  const q = (qy.q ?? "").trim();

  const rows = await sql`
    WITH difilter AS (
      SELECT v.*, d.seq AS d_seq
      FROM v_raci_posisi v JOIN divisi d ON d.key = v.divisi_key
      WHERE (${q} = '' OR v.proses ILIKE ${"%" + q + "%"} OR v.r_responsible ILIKE ${"%" + q + "%"}
             OR coalesce(v.a_accountable, '') ILIKE ${"%" + q + "%"})
        AND (${qy.divisi ?? null}::text IS NULL OR v.divisi_key = ${qy.divisi ?? null})
    )
    SELECT *, count(*) OVER () AS total_rows
    FROM difilter ORDER BY d_seq, r_responsible, proses
    LIMIT ${limit} OFFSET ${offset}`;

  if (rows.length === 0 && offset > 0) {
    const probe = await listRaciPosisi({ ...qy, limit: 1, offset: 0 });
    return { rows: [], total_rows: probe.total_rows };
  }

  return {
    total_rows: rows.length ? Number(rows[0].total_rows) : 0,
    rows: rows.map((r) => ({
      tugas_id: Number(r.tugas_id), divisi_key: r.divisi_key as string,
      divisi: r.divisi as string, proses: r.proses as string,
      r_responsible: r.r_responsible as string,
      a_accountable: (r.a_accountable as string | null) ?? null,
      a_belum_kanonik: r.a_belum_kanonik === true,
      frekuensi: (r.frekuensi as string | null) ?? null,
      kpi_target: (r.kpi_target as string | null) ?? null,
    })),
  };
}

export interface KelengkapanRow {
  divisi_key: string; divisi: string; pic_nama: string | null;
  posisi: number; tugas: number; sop: number; langkah_sop: number;
  koordinasi: number; objective: number;
  pct_tugas_ada_kpi: number | null; pct_tugas_ada_pj: number | null;
  pct_pj_kanonik: number | null; pct_langkah_ada_kondisi: number | null;
  pct_langkah_ada_target: number | null;
  pct_koordinasi_terklasifikasi: number | null;
  pct_objective_ada_perspektif: number | null;
  terpetakan_ke_department: boolean;
}

// v_form_kelengkapan ADA SUPAYA BOLONG TERBACA SEBAGAI BOLONG. Rasio bernilai
// NULL berarti penyebutnya nol ("tak ada barisnya"), berbeda arti dari 0%
// ("ada barisnya, kosong semua") — UI tak boleh meleburkan keduanya jadi "0".
export async function picFormKelengkapan(): Promise<KelengkapanRow[]> {
  const sql = db();
  const rows = await sql`SELECT * FROM v_form_kelengkapan`;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    divisi_key: r.divisi_key as string, divisi: r.divisi as string,
    pic_nama: (r.pic_nama as string | null) ?? null,
    posisi: Number(r.posisi), tugas: Number(r.tugas), sop: Number(r.sop),
    langkah_sop: Number(r.langkah_sop), koordinasi: Number(r.koordinasi),
    objective: Number(r.objective),
    pct_tugas_ada_kpi: num(r.pct_tugas_ada_kpi),
    pct_tugas_ada_pj: num(r.pct_tugas_ada_pj),
    pct_pj_kanonik: num(r.pct_pj_kanonik),
    pct_langkah_ada_kondisi: num(r.pct_langkah_ada_kondisi),
    pct_langkah_ada_target: num(r.pct_langkah_ada_target),
    pct_koordinasi_terklasifikasi: num(r.pct_koordinasi_terklasifikasi),
    pct_objective_ada_perspektif: num(r.pct_objective_ada_perspektif),
    terpetakan_ke_department: r.terpetakan_ke_department === true,
  }));
}

export async function listDivisi(): Promise<{ key: string; label: string }[]> {
  const sql = db();
  const rows = await sql`SELECT key, label FROM divisi ORDER BY seq`;
  return rows.map((r) => ({ key: r.key as string, label: r.label as string }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Graf koordinasi antar posisi (Tabel C form PIC) — pengisi menu Spider Network.
//
// KENAPA MENU ITU PINDAH SUMBER: /network sebelumnya merender graf co-occurrence
// ENTITY dari anotasi A8 (repo/network.ts: node = entity + nama pengirim, edge =
// "muncul bersama dalam satu pesan"). Dua hal membuatnya tak terpakai:
//   1. `message_annotation` KOSONG di prod (0 baris) — halamannya menampilkan
//      "Graf kosong. Jalankan A8 (anotasi) lalu A9.";
//   2. graf itu bukan jaringan koordinasi organisasi sama sekali, padahal nama
//      menunya ("Spider Network") dan harapan pembacanya ke arah situ.
// repo/network.ts + endpoint /network/graph SENGAJA DIBIARKAN UTUH supaya A9
// bisa dihidupkan kapan pun tanpa membangun ulang; yang berpindah hanya apa
// yang dirender halaman.
//
// GRAFNYA CAMPUR SATUAN, DAN ITU MELEKAT DI SUMBERNYA. Node asal = POSISI
// ('Admin Teknisi'), tapi node tujuan sudah dinormalisasi classifyRules ke
// DIVISI ('aftersales') atau label eksternal. Jadi edge berbentuk posisi→divisi.
//
// Konsekuensi yang sempat saya salah tangani: uji "saling mengakui"
// (resiprositas) MUSTAHIL menyala di level ini — sebuah divisi tak pernah
// muncul sebagai asal, sehingga B→A tak akan pernah ada untuk A→B mana pun.
// Versi pertama fungsi ini memasang flag `bolak_balik` per-edge dan hasilnya
// selalu 0 dari 64; itu bukan temuan tentang organisasi, itu metrik mati.
//
// Ditangani dengan menyediakan DUA level, masing-masing dengan pertanyaan yang
// memang bisa dijawabnya:
//   • `edges`        — apa adanya dari form (posisi→tujuan). Setia pada sumber,
//                      dipakai untuk menelusuri siapa berkoordinasi ke mana.
//   • `edges_divisi` — asal ikut diangkat ke divisi-nya, jadi divisi↔divisi.
//                      DI SINI resiprositas bermakna, dan `sepihak` menandai
//                      pasangan yang cuma diakui satu sisi — itu justru sinyal
//                      yang berguna: koordinasi yang dianggap ada oleh satu
//                      divisi tapi tak dicatat divisi lawannya.
export interface KoordNode {
  id: string; label: string; grup: string; keluar: number; masuk: number; derajat: number;
}
export interface KoordEdge {
  from: string; to: string; bobot: number; topik: string[];
}
export interface KoordEdgeDivisi {
  from: string; to: string; bobot: number; bolak_balik: boolean; sepihak: boolean;
}
export interface KoordGraf {
  ringkas: {
    node: number; edge: number; baris: number;
    internal: number; external: number; tak_terklasifikasi: number;
    pasangan_divisi: number; pasangan_bolak_balik: number; pasangan_sepihak: number;
  };
  nodes: KoordNode[];
  edges: KoordEdge[];
  edges_divisi: KoordEdgeDivisi[];
}

export async function koordinasiGraf(opts: { divisi?: string } = {}): Promise<KoordGraf> {
  const sql = db();
  // Satu baris = satu pernyataan koordinasi. `dengan_key` bisa berupa divisi_key
  // (internal), label eksternal (Customer/User, Vendor/Principal, Leadership),
  // 'ALL', atau NULL kalau classifyRules tak mengenalinya.
  const baris = await sql`
    SELECT p.nama                                   AS dari,
           p.divisi_key,
           coalesce(k.dengan_key, k.dengan_raw)     AS ke,
           k.dengan_key IS NULL                     AS tak_kenal,
           k.dengan_grup,
           k.apa,
           k.pemicu
      FROM posisi_koordinasi k
      JOIN posisi p ON p.id = k.posisi_id
     WHERE (${opts.divisi ?? null}::text IS NULL OR p.divisi_key = ${opts.divisi ?? null})`;

  const node = new Map<string, KoordNode>();
  const pakaiNode = (id: string, grup: string) => {
    if (!node.has(id)) node.set(id, { id, label: id, grup, keluar: 0, masuk: 0, derajat: 0 });
    return node.get(id)!;
  };
  const edge = new Map<string, KoordEdge>();
  const edgeDiv = new Map<string, KoordEdgeDivisi>();

  for (const r of baris) {
    const dari = String(r.dari);
    const ke = String(r.ke);
    // Node asal SELALU 'posisi': ia memang sebuah posisi di form. Node tujuan
    // pakai dengan_grup; NULL (mis. 'ALL') dilabeli tersendiri, bukan dipaksa
    // internal — memaksanya akan menambah simpul palsu ke jaringan internal.
    const a = pakaiNode(dari, "posisi");
    const b = pakaiNode(ke, r.tak_kenal ? "tak-terklasifikasi" : ((r.dengan_grup as string | null) ?? "lain"));
    a.keluar++; b.masuk++;
    const k = `${dari}→${ke}`;
    if (!edge.has(k)) edge.set(k, { from: dari, to: ke, bobot: 0, topik: [] });
    const e = edge.get(k)!;
    e.bobot++;
    const topik = [r.apa, r.pemicu].filter(Boolean).join(" — ");
    if (topik && e.topik.length < 8) e.topik.push(topik);

    // Level divisi: asal diangkat dari posisi ke divisi-nya, supaya kedua ujung
    // edge bersatuan sama dan resiprositas bisa diuji. Koordinasi di DALAM satu
    // divisi (mis. Admin Teknisi → aftersales) dilewati — itu bukan pasangan
    // antar-divisi, dan memasukkannya membuat tiap divisi terlihat "saling
    // mengakui" dengan dirinya sendiri.
    const dariDiv = String(r.divisi_key);
    if (dariDiv !== ke) {
      const kd = `${dariDiv}→${ke}`;
      if (!edgeDiv.has(kd)) edgeDiv.set(kd, { from: dariDiv, to: ke, bobot: 0, bolak_balik: false, sepihak: false });
      edgeDiv.get(kd)!.bobot++;
    }
  }
  for (const n of node.values()) n.derajat = n.keluar + n.masuk;
  for (const e of edgeDiv.values()) {
    e.bolak_balik = edgeDiv.has(`${e.to}→${e.from}`);
    // `sepihak` hanya bermakna untuk pasangan INTERNAL: pihak eksternal
    // (Customer/User, Vendor/Principal, Leadership) tak punya form untuk
    // mengakui balik, jadi menandainya sepihak akan menuduh tanpa dasar.
    e.sepihak = !e.bolak_balik && node.get(e.to)?.grup === "internal";
  }

  const nodes = [...node.values()].sort((x, y) => y.derajat - x.derajat || x.id.localeCompare(y.id));
  const edges = [...edge.values()].sort((x, y) => y.bobot - x.bobot || x.from.localeCompare(y.from));
  const edgesDivisi = [...edgeDiv.values()].sort((x, y) => y.bobot - x.bobot || x.from.localeCompare(y.from));
  return {
    ringkas: {
      node: nodes.length,
      edge: edges.length,
      baris: baris.length,
      internal: nodes.filter((n) => n.grup === "internal").length,
      external: nodes.filter((n) => n.grup === "external").length,
      tak_terklasifikasi: nodes.filter((n) => n.grup === "tak-terklasifikasi").length,
      pasangan_divisi: edgesDivisi.length,
      pasangan_bolak_balik: edgesDivisi.filter((e) => e.bolak_balik).length,
      pasangan_sepihak: edgesDivisi.filter((e) => e.sepihak).length,
    },
    nodes,
    edges,
    edges_divisi: edgesDivisi,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rantai orang → posisi → proses, + karyawan yang BELUM tertaut beserta alasannya.
//
// Dipakai /people/raci sebagai bagian TAMBAHAN di bawah matriks F120 yang sudah
// ada — bukan penggantinya. F120 menjawab "orang ini terlibat di proses apa"
// (grain karyawan, turunan transkrip); bagian ini menjawab "orang ini memegang
// posisi apa, dan posisi itu bertanggung jawab atas proses apa" (grain posisi,
// dari form PIC). Dua pertanyaan berbeda atas dua sumber berbeda.
export interface RantaiRow {
  employee_id: string; karyawan: string; panggilan: string | null; dept: string | null;
  cabang: string | null; role_roster: string | null;
  posisi_id: number; posisi: string; jumlah_orang: number | null;
  divisi_key: string; divisi: string; sumber: string; dasar_tautan: string | null;
  proses: number;
}
export interface GapRow {
  employee_id: string; karyawan: string; panggilan: string | null;
  dept: string | null; role_roster: string | null; alasan: string; kandidat: string | null;
}
export interface RaciKaryawan {
  ringkas: { karyawan_total: number; tertaut: number; belum: number; baris_tautan: number };
  rantai: RantaiRow[];
  gap: GapRow[];
}

export async function raciKaryawanPosisi(): Promise<RaciKaryawan> {
  const sql = db();
  const rantai = await sql`SELECT * FROM v_raci_karyawan_posisi`;
  const gap = await sql`
    SELECT g.employee_id, e.nama AS karyawan, e.panggilan, e.dept,
           e.role AS role_roster, g.alasan, g.kandidat
      FROM employee_posisi_gap g JOIN employee e ON e.id = g.employee_id
     ORDER BY e.dept, e.nama`;
  const [{ n: total }] = await sql`SELECT count(*)::int AS n FROM employee`;

  // `tertaut` dihitung dari karyawan UNIK, bukan jumlah baris — Enggar & Nopa
  // masing-masing punya 2 baris (merangkap), jadi menghitung baris akan
  // melaporkan lebih banyak orang daripada yang sebenarnya ada.
  const unik = new Set(rantai.map((r) => String(r.employee_id)));
  return {
    ringkas: {
      karyawan_total: Number(total),
      tertaut: unik.size,
      belum: gap.length,
      baris_tautan: rantai.length,
    },
    rantai: rantai.map((r) => ({
      employee_id: r.employee_id as string, karyawan: r.karyawan as string,
      panggilan: (r.panggilan as string | null) ?? null, dept: (r.dept as string | null) ?? null,
      cabang: (r.cabang as string | null) ?? null, role_roster: (r.role_roster as string | null) ?? null,
      posisi_id: Number(r.posisi_id), posisi: r.posisi as string,
      jumlah_orang: r.jumlah_orang == null ? null : Number(r.jumlah_orang),
      divisi_key: r.divisi_key as string, divisi: r.divisi as string,
      sumber: r.sumber as string, dasar_tautan: (r.dasar_tautan as string | null) ?? null,
      proses: Number(r.proses),
    })),
    gap: gap.map((g) => ({
      employee_id: g.employee_id as string, karyawan: g.karyawan as string,
      panggilan: (g.panggilan as string | null) ?? null, dept: (g.dept as string | null) ?? null,
      role_roster: (g.role_roster as string | null) ?? null,
      alasan: g.alasan as string, kandidat: (g.kandidat as string | null) ?? null,
    })),
  };
}
