// F10 bagian 3 — register cek/giro keluar (migrasi 298, ambil alih F29; docs/features/F10-finance-ops-resilience.md).
//
// Alur: draft → diajukan → disetujui | ditolak → diserahkan → cair | tolak_bank; draft/diajukan/disetujui → batal.
//   • Hak per aksi diperiksa di BFF menu /register-cek: input/ajukan/serahkan/cair/batal = izin TAMBAH,
//     setujui/tolak = izin UBAH (HoD Finance). Di sini: pembuat cek tak boleh memutus ceknya sendiri
//     (maker-checker), dan transisi di luar peta ditolak.
//   • Saldo pembanding = saldo_akhir rekening koran terakhir (F-CASHIN bank_statement) — tidak diinput manual.
//     Total cek beredar (disetujui + diserahkan, belum cair) + cek ini > saldo → peringatan di layar & WA.
//   • Cair otomatis: mutasi DEBIT rekening yang sama, nominal persis, tanggal ≥ terbit, dan deskripsinya memuat
//     angka nomor seri (≥ 4 digit terakhir). Tanpa nomor seri di deskripsi → tidak ditebak, ditandai manual.
//   • Riwayat status di cek_keluar_log (append-only). Cek tak pernah dihapus.
// Saklar F10_CEK_ENABLED (default mati) untuk job harian (cair otomatis + pengingat H-3/H) dan WA.
// Penerima WA: F10_CEK_WA_TARGET (HoD Finance / grupnya), cadangan F10_WA_TARGET / INVOICE_REMINDER_FINANCE_TARGET.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

export const cekAktif = (): boolean => (process.env.F10_CEK_ENABLED ?? "false").toLowerCase() === "true";

export type StatusCek = "draft" | "diajukan" | "disetujui" | "ditolak" | "diserahkan" | "cair" | "tolak_bank" | "batal";
export type AksiCek = "ajukan" | "setujui" | "tolak" | "serahkan" | "cair" | "tolak_bank" | "batal";

export class CekError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Peta transisi: aksi → [status asal yang sah, status tujuan]. */
export const TRANSISI: Record<AksiCek, { dari: readonly StatusCek[]; ke: StatusCek }> = {
  ajukan: { dari: ["draft"], ke: "diajukan" },
  setujui: { dari: ["diajukan"], ke: "disetujui" },
  tolak: { dari: ["diajukan"], ke: "ditolak" },
  serahkan: { dari: ["disetujui"], ke: "diserahkan" },
  cair: { dari: ["diserahkan"], ke: "cair" },
  tolak_bank: { dari: ["diserahkan"], ke: "tolak_bank" },
  batal: { dari: ["draft", "diajukan", "disetujui"], ke: "batal" },
};
/** Aksi yang butuh izin UBAH (penyetuju) — dipakai BFF. Sisanya izin TAMBAH. */
export const AKSI_PENYETUJU: readonly AksiCek[] = ["setujui", "tolak"];
const WAJIB_CATATAN: readonly AksiCek[] = ["tolak", "tolak_bank", "batal"];

export function cekTransisi(status: StatusCek, aksi: AksiCek, opts: { oleh: string; dibuatOleh: string; catatan?: string | null }): string | null {
  const t = TRANSISI[aksi];
  if (!t) return "aksi tidak dikenal";
  if (!t.dari.includes(status)) return `cek berstatus ${status} tidak bisa di-${aksi}`;
  if (AKSI_PENYETUJU.includes(aksi) && opts.oleh.trim().toLowerCase() === opts.dibuatOleh.trim().toLowerCase()) {
    return "pembuat cek tidak boleh menyetujui/menolak ceknya sendiri";
  }
  if (WAJIB_CATATAN.includes(aksi) && !opts.catatan?.trim()) return "alasan wajib diisi";
  return null;
}

/** Angka seri: digit terakhir berurutan di nomor (“CEK 123456” → 123456). */
export const angkaSeri = (s: string): number | null => {
  const m = /(\d+)\D*$/.exec(s);
  return m ? Number(m[1]) : null;
};

/**
 * Peringatan nomor seri loncat dalam satu rekening: seri baru ≠ max+1 dari seri yang sudah tercatat
 * dengan awalan sama. Mengembalikan seri yang diharapkan, atau null bila urut / belum ada pembanding.
 */
export function seriLoncat(baru: string, ada: readonly string[]): string | null {
  const awalan = (s: string) => s.replace(/(\d+)\D*$/, "").trim().toUpperCase();
  const n = angkaSeri(baru);
  if (n == null) return null;
  const sama = ada.filter((s) => awalan(s) === awalan(baru)).map(angkaSeri).filter((x): x is number => x != null && x !== n);
  if (!sama.length) return null;
  const maks = Math.max(...sama);
  if (n === maks + 1 || n < maks) return null; // seri lebih kecil = mengisi celah / buku lain, tak diperingatkan
  return String(maks + 1);
}

/**
 * Deskripsi mutasi memuat seri cek: ada deret angka utuh yang SAMA dengan angka seri (nol di depan diabaikan),
 * atau salah satunya potongan ekor yang lain dengan panjang ≥ 6 digit (bank sering memotong / menambah awalan).
 * Seri < 4 digit tak pernah dicocokkan — terlalu mudah kebetulan sama dengan angka lain di deskripsi.
 */
export function deskripsiMemuatSeri(deskripsi: string, noSeri: string): boolean {
  const n = angkaSeri(noSeri);
  if (n == null) return false;
  const seri = String(n);
  if (seri.length < 4) return false;
  return (deskripsi.match(/\d+/g) ?? []).some((mentah) => {
    const d = mentah.replace(/^0+/, "");
    if (d === seri) return true;
    const [pendek, panjang] = d.length < seri.length ? [d, seri] : [seri, d];
    return pendek.length >= 6 && panjang.endsWith(pendek);
  });
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const tglPendek = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("id-ID", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

const waTarget = () =>
  (process.env.F10_CEK_WA_TARGET ?? "").trim() || (process.env.F10_WA_TARGET ?? "").trim() || (process.env.INVOICE_REMINDER_FINANCE_TARGET ?? "").trim();

async function kirimWa(text: string): Promise<boolean> {
  if (!cekAktif()) return false;
  const t = waTarget();
  if (!t) return false;
  const w = await sendViaWaGateway(t, text);
  return w.sent && !w.stub && !w.dryRun;
}

// ---------------------------------------------------------------- saldo

export interface SaldoRekening {
  bank_account_id: string;
  label: string;
  saldo: number | null;              // saldo_akhir rekening koran terakhir
  saldo_tanggal: string | null;
  saldo_terverifikasi: boolean;
  beredar: number;                   // disetujui + diserahkan, belum cair
  beredar_cek: number;
}

export async function saldoRekening(ids?: readonly string[]): Promise<SaldoRekening[]> {
  const sql = db();
  const rows = await sql<{ id: string; label: string; saldo: string | null; tanggal: string | null; status: string | null; beredar: string; beredar_cek: number }[]>`
    SELECT a.id::text, a.label_file || ' · ' || a.nama_bank || COALESCE(' ' || a.no_rekening, '') AS label,
           s.saldo_akhir::text AS saldo, s.tanggal::text AS tanggal, s.status,
           COALESCE((SELECT sum(c.nominal) FROM cek_keluar c WHERE c.bank_account_id = a.id AND c.status IN ('disetujui','diserahkan')), 0)::text AS beredar,
           (SELECT count(*)::int FROM cek_keluar c WHERE c.bank_account_id = a.id AND c.status IN ('disetujui','diserahkan')) AS beredar_cek
      FROM bank_account a
      LEFT JOIN LATERAL (
        SELECT saldo_akhir, tanggal, status FROM bank_statement
         WHERE bank_account_id = a.id AND saldo_akhir IS NOT NULL AND status <> 'perlu_review'
         ORDER BY tanggal DESC LIMIT 1) s ON true
     WHERE a.aktif AND a.milik_wrg AND a.jenis = 'kas' ${ids?.length ? sql`AND a.id::text IN ${sql(ids as string[])}` : sql``}
     ORDER BY a.label_file`;
  return rows.map((r) => ({
    bank_account_id: r.id, label: r.label,
    saldo: r.saldo == null ? null : Number(r.saldo), saldo_tanggal: r.tanggal, saldo_terverifikasi: r.status === "terverifikasi",
    beredar: Number(r.beredar), beredar_cek: r.beredar_cek,
  }));
}

/** Peringatan saldo untuk satu cek yang akan disetujui: beredar + nominal > saldo terakhir. */
export function peringatanSaldo(s: SaldoRekening | undefined, nominal: number): string | null {
  if (!s) return "rekening tidak ditemukan";
  if (s.saldo == null) return "saldo rekening ini belum ada (rekening koran belum pernah disetor lewat #KORAN)";
  const total = s.beredar + nominal;
  if (total > s.saldo) return `cek beredar + cek ini ${rp(total)} melebihi saldo ${rp(s.saldo)} per ${s.saldo_tanggal}`;
  return null;
}

// ---------------------------------------------------------------- tulis

interface InputCek {
  bank_account_id?: unknown; no_seri?: unknown; jenis?: unknown; tanggal_terbit?: unknown; jatuh_tempo?: unknown;
  penerima?: unknown; nominal?: unknown; keperluan?: unknown; dokumen_dasar?: unknown;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Angka dari JSON apa adanya; teks format Indonesia: titik = ribuan, koma = desimal (“45.000.000,50”). */
export const nominalAngka = (v: unknown): number =>
  typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d,]/g, "").replace(",", ".") || NaN);

function bersihkanInput(b: InputCek) {
  const s = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const out = {
    bank_account_id: s(b.bank_account_id, 40),
    no_seri: s(b.no_seri, 40).toUpperCase(),
    jenis: s(b.jenis) === "giro" ? "giro" : "cek",
    tanggal_terbit: s(b.tanggal_terbit, 10),
    jatuh_tempo: s(b.jatuh_tempo, 10) || s(b.tanggal_terbit, 10),
    penerima: s(b.penerima),
    nominal: nominalAngka(b.nominal),
    keperluan: s(b.keperluan, 500),
    dokumen_dasar: s(b.dokumen_dasar) || null,
  };
  if (!/^[0-9a-f-]{36}$/i.test(out.bank_account_id)) throw new CekError(400, "rekening wajib dipilih");
  if (!out.no_seri || angkaSeri(out.no_seri) == null) throw new CekError(400, "nomor seri wajib dan harus memuat angka");
  if (!YMD.test(out.tanggal_terbit) || !YMD.test(out.jatuh_tempo)) throw new CekError(400, "tanggal terbit / jatuh tempo tidak sah");
  if (out.jatuh_tempo < out.tanggal_terbit) throw new CekError(400, "jatuh tempo tidak boleh sebelum tanggal terbit");
  if (!out.penerima) throw new CekError(400, "penerima wajib diisi");
  if (!Number.isFinite(out.nominal) || out.nominal <= 0) throw new CekError(400, "nominal harus lebih dari 0");
  if (!out.keperluan) throw new CekError(400, "keperluan wajib diisi");
  return out;
}

async function catatLog(cekId: string | number, dari: string | null, ke: string, oleh: string, catatan: string | null) {
  await db()`INSERT INTO cek_keluar_log (cek_id, dari, ke, oleh, catatan) VALUES (${cekId}, ${dari}, ${ke}, ${oleh}, ${catatan})`;
}

export async function buatCek(b: InputCek & { ajukan?: unknown }, oleh: string) {
  if (!oleh) throw new CekError(400, "pelaku tak diketahui");
  const v = bersihkanInput(b);
  const sql = db();
  const [rek] = await sql`SELECT 1 FROM bank_account WHERE id = ${v.bank_account_id} AND aktif AND jenis = 'kas'`;
  if (!rek) throw new CekError(400, "rekening tidak ada / bukan rekening kas aktif");
  const status: StatusCek = b.ajukan === true ? "diajukan" : "draft";
  let baru: { id: string } | undefined;
  try {
    [baru] = await sql<{ id: string }[]>`
      INSERT INTO cek_keluar (bank_account_id, no_seri, jenis, tanggal_terbit, jatuh_tempo, penerima, nominal, keperluan, dokumen_dasar, status, dibuat_oleh)
      VALUES (${v.bank_account_id}, ${v.no_seri}, ${v.jenis}, ${v.tanggal_terbit}, ${v.jatuh_tempo}, ${v.penerima}, ${v.nominal}, ${v.keperluan}, ${v.dokumen_dasar}, ${status}, ${oleh})
      RETURNING id::text`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CekError(409, `nomor seri ${v.no_seri} sudah tercatat di rekening ini`);
    throw e;
  }
  await catatLog(baru.id, null, "draft", oleh, null);
  if (status === "diajukan") {
    await catatLog(baru.id, "draft", "diajukan", oleh, null);
    await notifDiajukan(baru.id);
  }
  return { id: Number(baru.id), status };
}

export async function ubahDraft(id: unknown, b: InputCek, oleh: string) {
  const n = idSah(id);
  const v = bersihkanInput(b);
  const sql = db();
  try {
    const r = await sql`UPDATE cek_keluar SET bank_account_id = ${v.bank_account_id}, no_seri = ${v.no_seri}, jenis = ${v.jenis},
                          tanggal_terbit = ${v.tanggal_terbit}, jatuh_tempo = ${v.jatuh_tempo}, penerima = ${v.penerima}, nominal = ${v.nominal},
                          keperluan = ${v.keperluan}, dokumen_dasar = ${v.dokumen_dasar}, updated_at = now()
                         WHERE id = ${n} AND status = 'draft'`;
    if (!r.count) throw new CekError(409, "hanya cek berstatus draft yang bisa diubah");
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CekError(409, `nomor seri ${v.no_seri} sudah tercatat di rekening ini`);
    throw e;
  }
  await catatLog(n, "draft", "draft", oleh, "data diubah");
  return { id: n };
}

const idSah = (id: unknown): number => {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new CekError(400, "id tidak sah");
  return n;
};

export async function ubahStatus(id: unknown, aksiMentah: unknown, opts: { oleh: string; catatan?: unknown }) {
  const n = idSah(id);
  const aksi = String(aksiMentah ?? "") as AksiCek;
  if (!TRANSISI[aksi]) throw new CekError(400, "aksi tidak dikenal");
  const catatan = String(opts.catatan ?? "").trim().slice(0, 500) || null;
  const sql = db();
  const [c] = await sql<{ status: StatusCek; dibuat_oleh: string }[]>`SELECT status, dibuat_oleh FROM cek_keluar WHERE id = ${n}`;
  if (!c) throw new CekError(404, "cek tidak ada");
  const salah = cekTransisi(c.status, aksi, { oleh: opts.oleh, dibuatOleh: c.dibuat_oleh, catatan });
  if (salah) throw new CekError(409, salah);
  const ke = TRANSISI[aksi].ke;
  const putus = AKSI_PENYETUJU.includes(aksi);
  const r = await sql`UPDATE cek_keluar SET status = ${ke}, updated_at = now(),
                        diputus_oleh = ${putus ? opts.oleh : sql`diputus_oleh`}, diputus_at = ${putus ? sql`now()` : sql`diputus_at`}
                       WHERE id = ${n} AND status = ${c.status}`;
  if (!r.count) throw new CekError(409, "status cek baru saja berubah — muat ulang");
  await catatLog(n, c.status, ke, opts.oleh, catatan);
  if (aksi === "ajukan") await notifDiajukan(String(n));
  return { id: n, status: ke };
}

async function notifDiajukan(id: string) {
  const [c] = await db()<{ no_seri: string; jenis: string; nominal: string; penerima: string; jatuh_tempo: string; keperluan: string; bank_account_id: string; dibuat_oleh: string }[]>`
    SELECT no_seri, jenis, nominal::text, penerima, jatuh_tempo::text, keperluan, bank_account_id::text, dibuat_oleh FROM cek_keluar WHERE id = ${id}`;
  if (!c) return;
  const [s] = await saldoRekening([c.bank_account_id]);
  const warn = peringatanSaldo(s, Number(c.nominal));
  await kirimWa([
    `🧾 *${c.jenis === "giro" ? "Giro" : "Cek"} menunggu persetujuan* — C${id}`,
    `${c.no_seri} · ${s?.label ?? "rekening ?"}`,
    `${rp(Number(c.nominal))} → ${c.penerima} · jatuh tempo ${tglPendek(c.jatuh_tempo)}`,
    `Keperluan: ${c.keperluan}`,
    `Diajukan: ${c.dibuat_oleh}`,
    ...(warn ? ["", `🔴 PERINGATAN: ${warn}.`] : []),
    "",
    "Setujui/tolak di menu Finance → Register Cek.",
  ].join("\n"));
}

// ---------------------------------------------------------------- baca

export interface BarisCek {
  id: number; bank_account_id: string; rekening: string; no_seri: string; jenis: string; tanggal_terbit: string; jatuh_tempo: string;
  penerima: string; nominal: number; keperluan: string; dokumen_dasar: string | null; status: StatusCek;
  dibuat_oleh: string; dibuat_at: string; diputus_oleh: string | null; diputus_at: string | null; cair_otomatis: boolean;
  seri_loncat: string | null; peringatan_saldo: string | null;
  log: { dari: string | null; ke: string; oleh: string; catatan: string | null; at: string }[];
}

export async function daftarCek(opts: { status?: unknown; hari?: unknown } = {}) {
  const sql = db();
  const hari = Math.min(730, Math.max(7, Number(opts.hari) || 180));
  const st = String(opts.status ?? "");
  const aktif = st === "aktif";
  const rows = await sql<{
    id: string; bank_account_id: string; rekening: string; no_seri: string; jenis: string; tanggal_terbit: string; jatuh_tempo: string;
    penerima: string; nominal: string; keperluan: string; dokumen_dasar: string | null; status: StatusCek; dibuat_oleh: string; dibuat_at: Date;
    diputus_oleh: string | null; diputus_at: Date | null; cair_line_id: string | null;
  }[]>`
    SELECT c.id::text, c.bank_account_id::text, a.label_file || ' · ' || a.nama_bank AS rekening, c.no_seri, c.jenis,
           c.tanggal_terbit::text, c.jatuh_tempo::text, c.penerima, c.nominal::text, c.keperluan, c.dokumen_dasar, c.status,
           c.dibuat_oleh, c.dibuat_at, c.diputus_oleh, c.diputus_at, c.cair_line_id::text
      FROM cek_keluar c JOIN bank_account a ON a.id = c.bank_account_id
     WHERE ${aktif ? sql`c.status IN ('draft','diajukan','disetujui','diserahkan')` : sql`(c.status IN ('draft','diajukan','disetujui','diserahkan') OR c.dibuat_at >= now() - make_interval(days => ${hari}))`}
     ORDER BY CASE c.status WHEN 'diajukan' THEN 0 WHEN 'disetujui' THEN 1 WHEN 'diserahkan' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, c.jatuh_tempo, c.id`;
  const ids = rows.map((r) => r.id);
  const logs = ids.length
    ? await sql<{ cek_id: string; dari: string | null; ke: string; oleh: string; catatan: string | null; at: Date }[]>`
        SELECT cek_id::text, dari, ke, oleh, catatan, at FROM cek_keluar_log WHERE cek_id IN ${sql(ids)} ORDER BY at, id`
    : [];
  const seriPerRek = new Map<string, { id: string; seri: string }[]>();
  for (const r of await sql<{ id: string; rek: string; seri: string }[]>`SELECT id::text, bank_account_id::text rek, no_seri seri FROM cek_keluar`) {
    seriPerRek.set(r.rek, [...(seriPerRek.get(r.rek) ?? []), { id: r.id, seri: r.seri }]);
  }
  const saldo = new Map((await saldoRekening()).map((s) => [s.bank_account_id, s]));
  const items: BarisCek[] = rows.map((r) => {
    // Seri loncat dibandingkan dengan cek yang tercatat LEBIH DULU di rekening yang sama.
    const sebelum = (seriPerRek.get(r.bank_account_id) ?? []).filter((x) => Number(x.id) < Number(r.id)).map((x) => x.seri);
    return {
      id: Number(r.id), bank_account_id: r.bank_account_id, rekening: r.rekening, no_seri: r.no_seri, jenis: r.jenis,
      tanggal_terbit: r.tanggal_terbit, jatuh_tempo: r.jatuh_tempo, penerima: r.penerima, nominal: Number(r.nominal), keperluan: r.keperluan,
      dokumen_dasar: r.dokumen_dasar, status: r.status, dibuat_oleh: r.dibuat_oleh, dibuat_at: new Date(r.dibuat_at).toISOString(),
      diputus_oleh: r.diputus_oleh, diputus_at: r.diputus_at ? new Date(r.diputus_at).toISOString() : null, cair_otomatis: r.cair_line_id != null,
      seri_loncat: seriLoncat(r.no_seri, sebelum),
      peringatan_saldo: r.status === "diajukan" ? peringatanSaldo(saldo.get(r.bank_account_id), Number(r.nominal)) : null,
      log: logs.filter((l) => l.cek_id === r.id).map((l) => ({ dari: l.dari, ke: l.ke, oleh: l.oleh, catatan: l.catatan, at: new Date(l.at).toISOString() })),
    };
  });
  return { rekening: [...saldo.values()], items };
}

// ---------------------------------------------------------------- job harian

const hariIniWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tambahHari = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Cair otomatis dari mutasi debit rekening koran. Kembalikan jumlah cek yang ditandai cair. */
export async function cocokkanCair(): Promise<number> {
  const sql = db();
  const cek = await sql<{ id: string; bank_account_id: string; no_seri: string; nominal: string; tanggal_terbit: string }[]>`
    SELECT id::text, bank_account_id::text, no_seri, nominal::text, tanggal_terbit::text FROM cek_keluar WHERE status = 'diserahkan'`;
  let n = 0;
  for (const c of cek) {
    const lines = await sql<{ id: string; deskripsi: string; referensi: string | null }[]>`
      SELECT l.id::text, l.deskripsi, l.referensi FROM bank_statement_line l JOIN bank_statement s ON s.id = l.statement_id
       WHERE s.bank_account_id = ${c.bank_account_id} AND s.tanggal >= ${c.tanggal_terbit} AND l.debit = ${c.nominal}
         AND NOT EXISTS (SELECT 1 FROM cek_keluar x WHERE x.cair_line_id = l.id)`;
    const hit = lines.filter((l) => deskripsiMemuatSeri(`${l.deskripsi} ${l.referensi ?? ""}`, c.no_seri));
    if (hit.length !== 1) continue; // nol atau ambigu → biarkan manual
    const r = await sql`UPDATE cek_keluar SET status = 'cair', cair_line_id = ${hit[0].id}, updated_at = now() WHERE id = ${c.id} AND status = 'diserahkan'`;
    if (r.count) {
      await catatLog(c.id, "diserahkan", "cair", "otomatis: rekening koran", hit[0].deskripsi.slice(0, 200));
      n++;
    }
  }
  return n;
}

export function buildPengingatWa(hariIni: string, rows: { id: string; no_seri: string; nominal: number; penerima: string; jatuh_tempo: string; rekening: string }[]): string {
  return [
    `⏰ *Cek/giro jatuh tempo* — ${rows.length} lembar belum tercatat cair`,
    ...rows.map((r) => `• C${r.id} ${r.no_seri} · ${r.rekening} · ${rp(r.nominal)} → ${r.penerima} · ${r.jatuh_tempo === hariIni ? "HARI INI" : tglPendek(r.jatuh_tempo)}`),
    "",
    "Pastikan saldo rekening cukup. Tandai cair / tolak bank di menu Register Cek.",
  ].join("\n");
}

export async function runCekHarian(opts: { dryRun?: boolean; hariIni?: string } = {}) {
  const hariIni = opts.hariIni ?? hariIniWib();
  const cair = opts.dryRun ? 0 : await cocokkanCair();
  const sql = db();
  const rows = await sql<{ id: string; no_seri: string; nominal: string; penerima: string; jatuh_tempo: string; rekening: string }[]>`
    SELECT c.id::text, c.no_seri, c.nominal::text, c.penerima, c.jatuh_tempo::text, a.label_file AS rekening
      FROM cek_keluar c JOIN bank_account a ON a.id = c.bank_account_id
     WHERE c.status = 'diserahkan' AND c.jatuh_tempo BETWEEN ${hariIni} AND ${tambahHari(hariIni, 3)}
       AND NOT EXISTS (SELECT 1 FROM notif_state n WHERE n.key = 'f10-cek:' || c.id || ':' || CASE WHEN c.jatuh_tempo = ${hariIni}::date THEN 'h' ELSE 'h3' END)
     ORDER BY c.jatuh_tempo`;
  if (!rows.length) return { cair, pengingat: 0, sent: false };
  const list = rows.map((r) => ({ ...r, nominal: Number(r.nominal) }));
  const text = buildPengingatWa(hariIni, list);
  if (opts.dryRun) return { cair, pengingat: rows.length, sent: false, payload: text };
  const sent = await kirimWa(text);
  if (sent) {
    for (const r of rows) {
      const key = `f10-cek:${r.id}:${r.jatuh_tempo === hariIni ? "h" : "h3"}`;
      await sql`INSERT INTO notif_state (key, signature, count, sent_at) VALUES (${key}, ${hariIni}, 1, now()) ON CONFLICT (key) DO NOTHING`;
    }
  }
  return { cair, pengingat: rows.length, sent };
}
