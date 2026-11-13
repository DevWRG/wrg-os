// Proyek HD fase 2 — data operasional per proyek (migrasi 316): konstruksi, kurva S, RO,
// mesin, keuangan, permintaan RS, isu & risiko, funnel. Satu spesifikasi (OPS) dipakai
// CRUD generik di sini dan form di web. Nama tabel & kolom HANYA dari spesifikasi —
// tidak pernah dari input — jadi SQL dinamis aman.
//
// Gerbang menu "/proyek-hd" (lihat/buat/ubah/hapus) DIPERIKSA DI BFF; `oleh` dari sesi.

import ExcelJS from "exceljs";
import { db } from "../db.js";
import { ProyekHdError, TAHAP } from "./proyek-hd.js";

// ================================================================ spesifikasi (murni)

export type TipeKolom = "text" | "longtext" | "int" | "number" | "rupiah" | "percent" | "date" | "month" | "bool" | "enum" | "pic";
export interface Kolom { nama: string; label: string; tipe: TipeKolom; pilihan?: readonly string[]; wajib?: boolean }
export interface TabOps {
  slug: string; tabel: string; label: string;
  /** Satu baris per proyek (konstruksi, RO). */
  tunggal?: boolean;
  /** Boleh tanpa proyek (funnel). */
  proyekOpsional?: boolean;
  kolom: Kolom[];
}

const SEGMEN = ["Kemenkes", "RSUD/Pemda", "TNI/Polri", "Swasta"] as const;
const TIPE_PROYEK = ["Start New", "Pindah/Relokasi", "Tambah Unit", "Replacement"] as const;

export const OPS: TabOps[] = [
  {
    slug: "konstruksi", tabel: "hd_konstruksi", label: "Konstruksi", tunggal: true,
    kolom: [
      { nama: "lingkup", label: "Lingkup", tipe: "longtext" },
      { nama: "kontraktor", label: "Kontraktor", tipe: "text" },
      { nama: "spk_wrg", label: "SPK WRG terbit", tipe: "bool" },
      { nama: "spk_sipil", label: "SPK sipil terbit", tipe: "bool" },
      { nama: "bq_internal", label: "BQ internal siap", tipe: "bool" },
      { nama: "bq_versi_rs", label: "BQ versi RS siap", tipe: "bool" },
      { nama: "bq_disepakati", label: "BQ disepakati", tipe: "bool" },
      { nama: "ttd_manajemen_rs", label: "BQ + timeline ttd manajemen RS", tipe: "bool" },
      { nama: "timeline_internal_bln", label: "Timeline internal (bln)", tipe: "number" },
      { nama: "timeline_rs_bln", label: "Timeline versi RS (bln)", tipe: "number" },
      { nama: "mulai", label: "Mulai", tipe: "date" },
      { nama: "target_selesai", label: "Target selesai", tipe: "month" },
      { nama: "pct_rencana", label: "% rencana", tipe: "percent" },
      { nama: "pct_aktual", label: "% aktual", tipe: "percent" },
      { nama: "dibayar", label: "Dibayar (Rp)", tipe: "rupiah" },
    ],
  },
  {
    slug: "kurva-s", tabel: "hd_kurva_s", label: "Kurva S",
    kolom: [
      { nama: "minggu_ke", label: "Minggu ke", tipe: "int", wajib: true },
      { nama: "pct_rencana", label: "% rencana (kumulatif)", tipe: "percent" },
      { nama: "pct_aktual", label: "% aktual (kumulatif)", tipe: "percent" },
    ],
  },
  {
    slug: "ro", tabel: "hd_ro", label: "RO & Utilitas", tunggal: true,
    kolom: [
      { nama: "kapasitas_gdp", label: "Kapasitas (GDP)", tipe: "int" },
      { nama: "status_ro", label: "Status RO", tipe: "text" },
      { nama: "vendor", label: "Vendor", tipe: "text" },
      { nama: "spk_ro", label: "SPK vendor RO terbit", tipe: "bool" },
      { nama: "nilai", label: "Nilai (Rp)", tipe: "rupiah" },
      { nama: "dibayar", label: "Dibayar (Rp)", tipe: "rupiah" },
      { nama: "jadwal_masuk", label: "Jadwal masuk", tipe: "date" },
      { nama: "uji_air", label: "Uji air lolos", tipe: "bool" },
      { nama: "listrik_ok", label: "Listrik OK", tipe: "bool" },
      { nama: "pipa_ok", label: "Pipa OK", tipe: "bool" },
    ],
  },
  {
    slug: "mesin", tabel: "hd_mesin", label: "Mesin (relokasi & cek)",
    kolom: [
      { nama: "merk", label: "Merk", tipe: "text" },
      { nama: "jumlah_unit", label: "Jumlah unit", tipe: "int" },
      { nama: "dari", label: "Dari", tipe: "text" },
      { nama: "ke", label: "Ke", tipe: "text" },
      { nama: "tujuan", label: "Tujuan", tipe: "text" },
      { nama: "surat_dasar", label: "Surat dasar", tipe: "text" },
      { nama: "target_tiba", label: "Target tiba", tipe: "date" },
      { nama: "status", label: "Status", tipe: "text" },
      { nama: "cek_teknis", label: "Cek teknis", tipe: "text" },
    ],
  },
  {
    slug: "keuangan", tabel: "hd_keuangan", label: "Keuangan (termin & tagihan)",
    kolom: [
      { nama: "arah", label: "Arah", tipe: "enum", pilihan: ["Masuk", "Keluar"], wajib: true },
      { nama: "pihak", label: "Pihak", tipe: "text" },
      { nama: "keterangan", label: "Keterangan", tipe: "longtext" },
      { nama: "nilai", label: "Nilai (Rp)", tipe: "rupiah" },
      { nama: "jatuh_tempo", label: "Jatuh tempo", tipe: "date" },
      { nama: "status", label: "Status", tipe: "enum", pilihan: ["Belum", "Ditagih", "Lunas"] },
      { nama: "tgl_bayar", label: "Tanggal bayar", tipe: "date" },
    ],
  },
  {
    slug: "permintaan", tabel: "hd_permintaan", label: "Permintaan RS",
    kolom: [
      { nama: "item", label: "Item", tipe: "text", wajib: true },
      { nama: "kategori", label: "Kategori", tipe: "enum", pilihan: ["Wajib izin", "Aksesori"] },
      { nama: "estimasi", label: "Estimasi (Rp)", tipe: "rupiah" },
      { nama: "status", label: "Status", tipe: "enum", pilihan: ["Belum", "Proses", "Selesai"] },
    ],
  },
  {
    slug: "isu", tabel: "hd_isu", label: "Isu & Risiko",
    kolom: [
      { nama: "isu", label: "Isu", tipe: "longtext", wajib: true },
      { nama: "dampak", label: "Dampak", tipe: "text" },
      { nama: "tindakan", label: "Tindakan", tipe: "longtext" },
      { nama: "pic_employee_id", label: "PIC", tipe: "pic" },
      { nama: "target", label: "Target", tipe: "date" },
      { nama: "status", label: "Status", tipe: "enum", pilihan: ["Terbuka", "Proses", "Selesai"] },
    ],
  },
  {
    slug: "funnel", tabel: "hd_funnel", label: "Funnel", proyekOpsional: true,
    kolom: [
      { nama: "nama_rs", label: "Nama RS", tipe: "text", wajib: true },
      { nama: "wilayah", label: "Wilayah", tipe: "text" },
      { nama: "segmen", label: "Segmen", tipe: "enum", pilihan: SEGMEN },
      { nama: "tipe_proyek", label: "Tipe proyek", tipe: "enum", pilihan: TIPE_PROYEK },
      { nama: "est_unit", label: "Estimasi unit", tipe: "int" },
      { nama: "vendor_existing", label: "Vendor existing", tipe: "text" },
      { nama: "pipeline", label: "Pipeline", tipe: "enum", pilihan: ["Cold", "Warm", "Hot"] },
      { nama: "target", label: "Target", tipe: "month" },
      { nama: "pic_employee_id", label: "PIC", tipe: "pic" },
    ],
  },
];

export function tabOps(slug: string): TabOps {
  const t = OPS.find((x) => x.slug === slug);
  if (!t) throw new ProyekHdError(404, `tab ${slug} tidak dikenal`);
  return t;
}

const kosong = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Satu nilai kolom dari body → nilai DB (null = kosong), atau galat 400 yang menyebut kolomnya. */
export function nilaiKolom(k: Kolom, v: unknown): string | number | boolean | null {
  const salah = (m: string): never => { throw new ProyekHdError(400, `${k.label}: ${m}`, k.nama); };
  if (k.tipe === "bool") {
    if (kosong(v)) return false;
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "TRUE") return true;
    if (v === "false" || v === "FALSE") return false;
    return salah("harus ya/tidak");
  }
  if (kosong(v)) return null;
  switch (k.tipe) {
    case "int": case "number": case "rupiah": case "percent": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0) return salah("harus angka ≥ 0");
      if (k.tipe === "int" && !Number.isInteger(n)) return salah("harus bilangan bulat");
      if (k.tipe === "percent" && n > 100) return salah("maksimal 100");
      return n;
    }
    case "date": {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return salah("format YYYY-MM-DD");
      const [t, b, h] = v.split("-").map(Number);
      const d = new Date(Date.UTC(t, b - 1, h));
      if (d.getUTCMonth() !== b - 1 || d.getUTCDate() !== h) return salah("tanggal tidak ada di kalender");
      return v;
    }
    case "month":
      if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return salah("format YYYY-MM");
      return v;
    case "enum":
      if (typeof v !== "string" || !k.pilihan!.includes(v)) return salah(`pilih salah satu: ${k.pilihan!.join(" / ")}`);
      return v;
    case "pic":
      if (typeof v !== "string" || v.length > 60) return salah("tidak valid");
      return v.trim();
    default:
      if (typeof v !== "string") return salah("harus teks");
      return v.trim().slice(0, k.tipe === "longtext" ? 4000 : 300);
  }
}

/** Isian dari body. `baru` = semua kolom diisi (kosong → null) + cek wajib; ubah = hanya kolom yang dikirim. */
export function isianOps(t: TabOps, b: Record<string, unknown>, baru: boolean): Record<string, string | number | boolean | null> {
  const o: Record<string, string | number | boolean | null> = {};
  for (const k of t.kolom) {
    if (!baru && !(k.nama in b)) continue;
    const v = nilaiKolom(k, b[k.nama]);
    if (k.wajib && (v === null || v === "")) throw new ProyekHdError(400, `${k.label} wajib diisi`, k.nama);
    o[k.nama] = v;
  }
  return o;
}

export interface Gate { kode: string; label: string; ok: boolean }

/** Gate SOP sebelum tukang masuk (G1–G3) dari data konstruksi & RO. */
export function gateChecklist(k?: Record<string, unknown> | null, r?: Record<string, unknown> | null): Gate[] {
  const ya = (v: unknown) => v === true;
  return [
    { kode: "G2", label: "BQ internal & BQ versi RS siap", ok: ya(k?.bq_internal) && ya(k?.bq_versi_rs) },
    { kode: "G1", label: "BQ disepakati + timeline ditandatangani manajemen RS", ok: ya(k?.bq_disepakati) && ya(k?.ttd_manajemen_rs) },
    { kode: "G3", label: "SPK WRG terbit", ok: ya(k?.spk_wrg) },
    { kode: "G3", label: "SPK sipil terbit", ok: ya(k?.spk_sipil) },
    { kode: "G3", label: "SPK vendor RO terbit", ok: ya(r?.spk_ro) },
  ];
}

// ================================================================ DB

const idDari = (v: string | number | null | undefined, field = "id"): number => {
  const s = String(v ?? "");
  if (!/^\d{1,12}$/.test(s)) throw new ProyekHdError(400, `${field} tidak valid`, field);
  return Number(s);
};

type Baris = Record<string, unknown>;

/** Nilai angka dari driver (NUMERIC = string) → number; tanggal → teks. */
function rapikan(t: TabOps, r: Baris): Baris {
  const o: Baris = { ...r };
  for (const k of t.kolom) {
    const v = r[k.nama];
    if (v == null) continue;
    if (["number", "rupiah", "percent", "int"].includes(k.tipe)) o[k.nama] = Number(v);
  }
  return o;
}

async function cekProyek(id: number) {
  const [p] = await db()`SELECT id FROM hd_proyek WHERE id = ${id} AND dihapus_at IS NULL`;
  if (!p) throw new ProyekHdError(400, "proyek tidak ditemukan", "proyek_id");
}

function galatDb(e: unknown): never {
  const m = e as { code?: string; constraint_name?: string };
  if (m?.code === "23503") throw new ProyekHdError(400, m.constraint_name?.includes("pic") ? "PIC tidak dikenal" : "rujukan tidak dikenal");
  if (m?.code === "23505") throw new ProyekHdError(409, "baris yang sama sudah ada (mis. minggu kurva S kembar)");
  if (m?.code === "23514") throw new ProyekHdError(400, "isian melanggar aturan data");
  throw e;
}

/** Kolom SELECT dari spesifikasi: DATE di-cast ke teks di SQL (bukan lewat Date JS — geser zona WIB). */
function kolomSelect(sql: ReturnType<typeof db>, t: TabOps) {
  return t.kolom.map((k) => (k.tipe === "date" ? sql`${sql("t." + k.nama)}::text AS ${sql(k.nama)}` : sql`${sql("t." + k.nama)}`))
    .reduce((a, c) => sql`${a}, ${c}`);
}

/** Baris aktif satu tab; proyekId null = semua proyek (dengan nama RS & kode). */
export async function listOps(slug: string, proyekId: string | null | undefined) {
  const t = tabOps(slug);
  const sql = db();
  const pid = proyekId ? idDari(proyekId, "proyek_id") : null;
  const adaPic = t.kolom.some((k) => k.tipe === "pic");
  const urut = t.slug === "kurva-s" ? sql`t.minggu_ke` : sql`t.id`;
  const rows = await sql`
    SELECT t.id::int AS id, t.proyek_id::int AS proyek_id, ${kolomSelect(sql, t)},
           t.diubah_oleh, t.diubah_at::text AS diubah_at, t.dibuat_at::text AS dibuat_at,
           p.kode AS proyek_kode, p.nama_rs AS proyek_nama, ${adaPic ? sql`e.nama` : sql`NULL::text`} AS pic_nama
      FROM ${sql(t.tabel)} t
      LEFT JOIN hd_proyek p ON p.id = t.proyek_id
      ${adaPic ? sql`LEFT JOIN employee e ON e.id = t.pic_employee_id` : sql``}
     WHERE t.dihapus_at IS NULL AND (${pid}::bigint IS NULL OR t.proyek_id = ${pid})
     ORDER BY t.proyek_id NULLS FIRST, ${urut}`;
  return rows.map((r) => rapikan(t, r as Baris));
}

export async function buatOps(slug: string, b: Record<string, unknown>, oleh: string | null) {
  const t = tabOps(slug);
  const isi = isianOps(t, b, true);
  const pid = kosong(b.proyek_id) ? null : idDari(b.proyek_id as string, "proyek_id");
  if (pid === null && !t.proyekOpsional) throw new ProyekHdError(400, "proyek wajib dipilih", "proyek_id");
  if (pid !== null) await cekProyek(pid);
  const sql = db();
  if (t.tunggal) {
    const [ada] = await sql`SELECT id FROM ${sql(t.tabel)} WHERE proyek_id = ${pid} AND dihapus_at IS NULL`;
    if (ada) throw new ProyekHdError(409, `${t.label} proyek ini sudah ada — ubah baris yang ada`);
  }
  // Kolom kosong tidak dikirim, supaya DEFAULT tabel berlaku (mis. status isu = 'Terbuka').
  const terisi = Object.fromEntries(Object.entries(isi).filter(([, v]) => v !== null));
  const baris = { ...terisi, proyek_id: pid, dibuat_oleh: oleh, diubah_oleh: oleh };
  const [r] = await sql`INSERT INTO ${sql(t.tabel)} ${sql(baris)} RETURNING id::int`.catch(galatDb);
  return (await listOps(slug, pid === null ? null : String(pid))).find((x) => x.id === r.id) ?? { id: r.id };
}

/** Ubah sebagian; `diubah_at` dari klien wajib sama dengan yang tersimpan. */
export async function ubahOps(slug: string, idStr: string, b: Record<string, unknown>, oleh: string | null) {
  const t = tabOps(slug);
  const id = idDari(idStr);
  const isi = isianOps(t, b, false);
  const sql = db();
  const [cur] = await sql`SELECT proyek_id::int, diubah_at::text FROM ${sql(t.tabel)} WHERE id = ${id} AND dihapus_at IS NULL`;
  if (!cur) throw new ProyekHdError(404, "baris tidak ditemukan");
  if (typeof b.diubah_at !== "string" || b.diubah_at !== cur.diubah_at) throw new ProyekHdError(409, "baris sudah diubah orang lain — muat ulang");
  if (Object.keys(isi).length) {
    await sql`UPDATE ${sql(t.tabel)} SET ${sql(isi)}, diubah_oleh = ${oleh}, diubah_at = now() WHERE id = ${id}`.catch(galatDb);
  }
  return (await listOps(slug, cur.proyek_id == null ? null : String(cur.proyek_id))).find((x) => x.id === id)!;
}

export async function hapusOps(slug: string, idStr: string, oleh: string | null) {
  const t = tabOps(slug);
  const id = idDari(idStr);
  const sql = db();
  const r = await sql`UPDATE ${sql(t.tabel)} SET dihapus_oleh = ${oleh}, dihapus_at = now() WHERE id = ${id} AND dihapus_at IS NULL RETURNING id`;
  if (!r.length) throw new ProyekHdError(404, "baris tidak ditemukan");
  return { ok: true };
}

// ---------------------------------------------------------------- ringkasan untuk detail & dashboard

/** Panel detail proyek: konstruksi, kurva S, RO, mesin, isu terbuka, gate. */
export async function opsProyek(proyekId: number) {
  const pid = String(proyekId);
  const [kon, kurva, ro, mesin, isu] = await Promise.all([
    listOps("konstruksi", pid), listOps("kurva-s", pid), listOps("ro", pid), listOps("mesin", pid), listOps("isu", pid),
  ]);
  const k = kon[0] ?? null;
  const r = ro[0] ?? null;
  return {
    konstruksi: k, kurva, ro: r, mesin,
    isu_terbuka: isu.filter((i) => i.status !== "Selesai"),
    gate: gateChecklist(k, r),
  };
}

/** Dashboard: isu terbuka semua proyek + proyek DED/CIP yang gate G1–G3 belum lengkap. */
export async function ringkasanOps() {
  const sql = db();
  const [isu, kon, ro, prj] = await Promise.all([
    listOps("isu", null), listOps("konstruksi", null), listOps("ro", null),
    sql`SELECT id::int, kode, nama_rs, tahap_kode FROM hd_proyek WHERE dihapus_at IS NULL AND tahap_kode IN ('3', '4')`,
  ]);
  const gate_terbuka = prj
    .map((p) => ({ id: Number(p.id), kode: String(p.kode), nama_rs: String(p.nama_rs), tahap_kode: String(p.tahap_kode),
      gate: gateChecklist(kon.find((k) => k.proyek_id === Number(p.id)), ro.find((r) => r.proyek_id === Number(p.id))) }))
    .filter((p) => p.gate.some((g) => !g.ok))
    .map(({ gate, ...p }) => ({ ...p, kurang: gate.filter((g) => !g.ok).map((g) => g.label) }));
  return {
    isu_terbuka: isu.filter((i) => i.status !== "Selesai")
      .map((i) => ({ id: i.id, proyek_id: i.proyek_id, proyek_nama: i.proyek_nama, isu: i.isu, tindakan: i.tindakan, status: i.status, pic_nama: i.pic_nama })),
    gate_terbuka,
  };
}

// ---------------------------------------------------------------- ekspor Excel

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1B2D" } } as const;

function gayaHeader(ws: ExcelJS.Worksheet) {
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** Laporan Proyek HD: sheet Kontrak KSO (format laporan lama) + satu sheet per tab operasional + daftar lampiran. */
export async function eksporXlsx(): Promise<Buffer> {
  const sql = db();
  const [proyek, param, lampiran] = await Promise.all([
    sql`SELECT p.*, p.id::int AS id, e.nama AS pic_nama FROM hd_proyek p LEFT JOIN employee e ON e.id = p.pic_employee_id
         WHERE p.dihapus_at IS NULL ORDER BY p.kode`,
    sql`SELECT nilai::float8 AS nilai FROM hd_param WHERE kunci = 'tarif_per_tindakan'`,
    sql`SELECT p.kode, p.nama_rs, c.tahap_kode, c.tanggal::text AS tanggal, l.nama_asli, l.diunggah_oleh, l.diunggah_at::text AS diunggah_at
          FROM hd_lampiran l JOIN hd_catatan c ON c.id = l.catatan_id JOIN hd_proyek p ON p.id = l.proyek_id
         WHERE p.dihapus_at IS NULL ORDER BY p.kode, c.tanggal, l.id`,
  ]);
  const tarif = param[0]?.nilai == null ? null : Number(param[0].nilai);
  const tahapNama = (k: string) => TAHAP.find((t) => t.kode === k)?.nama ?? k;
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet("Kontrak KSO");
  const kolom: [string, number, string?][] = [
    ["No", 6], ["Kode", 11], ["Nama Customer / RS", 44], ["Nama Alat", 20], ["Jml Unit KSO", 12], ["Jml Unit Terinstal", 14],
    ["Jml Unit Running", 14], ["Jml Unit Dibutuhkan", 14], ["Harga Unit (Rp)", 16, "#,##0"], ["Kebutuhan Dana (Rp)", 18, "#,##0"],
    ["Nomor MOU / PKS / SPK", 26], ["Target Tindakan / Bulan", 14], ["Estimasi Omset / Bulan (Rp)", 20, "#,##0"],
    ["Tipe Proyek", 16], ["Tahap", 24], ["Status", 9], ["PIC", 20], ["Target Go-live", 12], ["Langkah Berikutnya", 40], ["Lampiran", 10],
  ];
  ws.columns = kolom.map(([h, w, f]) => ({ header: h, key: h, width: w, style: f ? { numFmt: f } : {} }));
  proyek.forEach((p, i) => {
    const butuh = Math.max(0, Number(p.unit_kso) - Number(p.unit_terinstal));
    const harga = p.harga_unit == null ? null : Number(p.harga_unit);
    const target = p.target_tindakan_bln == null ? null : Number(p.target_tindakan_bln);
    ws.addRow({
      "No": i + 1, "Kode": p.kode, "Nama Customer / RS": p.nama_rs, "Nama Alat": p.nama_alat ?? "",
      "Jml Unit KSO": Number(p.unit_kso), "Jml Unit Terinstal": Number(p.unit_terinstal), "Jml Unit Running": Number(p.unit_running),
      "Jml Unit Dibutuhkan": butuh, "Harga Unit (Rp)": harga, "Kebutuhan Dana (Rp)": harga == null ? null : butuh * harga,
      "Nomor MOU / PKS / SPK": p.nomor_kontrak || "Proses", "Target Tindakan / Bulan": target,
      "Estimasi Omset / Bulan (Rp)": target == null || tarif == null ? null : target * tarif,
      "Tipe Proyek": p.tipe_proyek, "Tahap": `${p.tahap_kode} ${tahapNama(String(p.tahap_kode))}`, "Status": p.status_rag,
      "PIC": p.pic_nama ?? "", "Target Go-live": p.target_golive ?? "", "Langkah Berikutnya": p.next_action ?? "",
      "Lampiran": lampiran.filter((l) => l.kode === p.kode).length,
    });
  });
  if (proyek.length) {
    const n = proyek.length + 1;
    const total: Record<string, unknown> = { "Nama Customer / RS": "TOTAL" };
    for (const h of ["Jml Unit KSO", "Jml Unit Terinstal", "Jml Unit Running", "Jml Unit Dibutuhkan", "Kebutuhan Dana (Rp)", "Target Tindakan / Bulan", "Estimasi Omset / Bulan (Rp)"]) {
      const L = ws.getColumn(h).letter;
      total[h] = { formula: `SUM(${L}2:${L}${n})` };
    }
    ws.addRow({});
    ws.addRow(total).font = { bold: true };
  }
  gayaHeader(ws);

  for (const t of OPS) {
    const rows = await listOps(t.slug, null);
    const s = wb.addWorksheet(t.label.replace(/[\\/*?:[\]]/g, "").slice(0, 31));
    s.columns = [
      { header: "Proyek", key: "_proyek", width: 36 },
      ...t.kolom.map((k) => ({
        header: k.label, key: k.nama, width: k.tipe === "longtext" ? 40 : Math.max(12, k.label.length + 2),
        style: k.tipe === "rupiah" ? { numFmt: "#,##0" } : {},
      })),
      { header: "Diubah oleh", key: "diubah_oleh", width: 18 },
    ];
    for (const r of rows) {
      const o: Record<string, unknown> = { _proyek: r.proyek_nama ? `${r.proyek_kode} ${r.proyek_nama}` : "—", diubah_oleh: r.diubah_oleh ?? "" };
      for (const k of t.kolom) {
        const v = r[k.nama];
        o[k.nama] = k.tipe === "bool" ? (v ? "Ya" : "Belum") : k.tipe === "pic" ? (r.pic_nama ?? "") : (v ?? "");
      }
      s.addRow(o);
    }
    if (!rows.length) s.addRow({ _proyek: "Belum ada data." });
    gayaHeader(s);
  }

  const wl = wb.addWorksheet("Lampiran");
  wl.columns = [
    { header: "Kode", key: "kode", width: 11 }, { header: "Nama Customer / RS", key: "nama_rs", width: 40 },
    { header: "Tahap", key: "tahap", width: 24 }, { header: "Tanggal Catatan", key: "tanggal", width: 14 },
    { header: "Nama Berkas", key: "nama_asli", width: 40 }, { header: "Diunggah Oleh", key: "diunggah_oleh", width: 20 },
    { header: "Diunggah", key: "diunggah_at", width: 22 },
  ];
  for (const l of lampiran) wl.addRow({ ...l, tahap: `${l.tahap_kode} ${tahapNama(String(l.tahap_kode))}` });
  if (!lampiran.length) wl.addRow({ nama_rs: "Belum ada lampiran." });
  gayaHeader(wl);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
