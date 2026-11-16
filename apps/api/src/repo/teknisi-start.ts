// F175 #START Teknisi — jam mulai per pekerjaan (migrasi 323).
//
// Alur: #PLAN → #START n (jam mulai + bukti lokasi) → #REPORT n (jam selesai). Waktu servis =
// jam report − jam start (dihitung di simpanReportTeknisi & view teknisi_kerja_v).
//
// Bukti lokasi = foto geotag (Geo-Tagging Camera, pola foto kunjungan AM): wa-bridge sudah meng-OCR cap koordinatnya ke
// wa_message.geo_lat/geo_lon/geo_address (pola foto kunjungan AM). Foto tanpa cap / tanpa
// foto → start tetap diterima, ditandai "tanpa lokasi" (keputusan user 16 Nov 2026).
// Koordinat disimpan permanen; FOTO start dihapus setelah masa simpan (job retensi).
// Foto #REPORT (teknisi_kunjungan_foto) tidak pernah disentuh di sini.
import { lstat, realpath, unlink } from "node:fs/promises";
import { extname } from "node:path";
import { db } from "../db.js";
import { isInsideRoot, mediaRootWa } from "../media-akses.js";
import { sendViaWaGateway } from "../wasend.js";
import { accountIdDariTulisan } from "./akun-faskes.js";
import { cariAlat, jadwalRutinId } from "./teknisi-plan-report.js";
import type { TeknisiStartParse } from "../parsers/teknisi.js";

/** Foto & teks #START dikirim terpisah (WA) → dipasangkan dalam jendela ini. */
export const START_FOTO_JENDELA_MENIT = 10;
/** Nomor item untuk kerja di luar plan mulai dari sini (tak bentrok dengan #PLAN 1..n). */
export const URUT_DI_LUAR_PLAN = 51;

export interface GeoWa {
  lat: number | null;
  lon: number | null;
  ts: string | null;
  alamat: string | null;
}

const adaGeo = (g: GeoWa | null | undefined): g is GeoWa => !!g && g.lat != null && g.lon != null;

/** Jam WIB "HH:MM" dari timestamp (untuk balasan bot). */
export function jamWib(ts: string | Date | null | undefined): string {
  const d = ts ? new Date(ts) : new Date();
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(11, 16);
}

export interface HasilStart {
  jam: string;
  mulai: { urut: number; diLuarPlan: boolean; berlokasi: boolean }[];
  ditolak: { urut: number; alasan: string }[];
  pesan: string[];
}

export async function simpanStartTeknisi(input: {
  teknisiId: string;
  tanggal: string;
  parse: TeknisiStartParse;
  waMessageId: string | null;
  receivedAt: string | null;
  groupJid: string;
  senderName: string | null;
  /** Foto yang menjadi pembawa caption #START (null bila teks saja). */
  mediaPath: string | null;
  geo: GeoWa | null;
}): Promise<HasilStart> {
  const sql = db();
  const mulaiAt = input.receivedAt ?? new Date().toISOString();
  let mediaPath = input.mediaPath;
  let geo = adaGeo(input.geo) ? input.geo : null;

  // Teks #START tanpa foto: ambil foto pengirim yang sama yang dikirim sesaat SEBELUMNYA
  // (pola penjodohan #KORAN/#KSO: di grup kuncinya grup + nama pengirim).
  if (!mediaPath) {
    const [f] = await sql`
      SELECT w.media_path, w.geo_lat, w.geo_lon, w.geo_ts, w.geo_address
      FROM wa_message w
      WHERE w.group_jid = ${input.groupJid}
        AND coalesce(w.sender_name, '') = coalesce(${input.senderName}, '')
        AND w.message_type ~* '^image' AND w.media_path IS NOT NULL
        AND w.received_at BETWEEN ${mulaiAt}::timestamptz - make_interval(mins => ${START_FOTO_JENDELA_MENIT})
                              AND ${mulaiAt}::timestamptz
        AND w.message_id IS DISTINCT FROM ${input.waMessageId}
        AND NOT EXISTS (SELECT 1 FROM teknisi_kunjungan_foto x WHERE x.media_path = w.media_path)
        AND NOT EXISTS (SELECT 1 FROM teknisi_plan_item x WHERE x.start_media_path = w.media_path)
      ORDER BY w.received_at DESC LIMIT 1`;
    if (f) {
      mediaPath = String(f.media_path);
      if (!geo && f.geo_lat != null && f.geo_lon != null) {
        geo = { lat: Number(f.geo_lat), lon: Number(f.geo_lon), ts: f.geo_ts ?? null, alamat: f.geo_address ?? null };
      }
    }
  }

  const out: HasilStart = { jam: jamWib(mulaiAt), mulai: [], ditolak: [], pesan: [] };
  const kolomStart = {
    started_at: mulaiAt, start_wa_message_id: input.waMessageId, start_group_jid: input.groupJid,
    start_lat: geo?.lat ?? null, start_lon: geo?.lon ?? null, start_geo_ts: geo?.ts ?? null,
    start_alamat: geo?.alamat ?? null, start_media_path: mediaPath,
  };

  if (input.parse.baru) {
    const it = input.parse.baru;
    let acc = await accountIdDariTulisan(it.faskes);
    const a = await cariAlat(sql, acc, it.sn, it.alat);
    if (!acc && a.account_id) acc = a.account_id;
    const masalah = [acc ? null : `faskes "${it.faskes}" tak dikenali`, a.masalah].filter(Boolean).join("; ") || null;
    const jr = await jadwalRutinId(sql, acc, input.tanggal);
    const [r] = await sql`
      INSERT INTO teknisi_plan_item
        (teknisi_id, tanggal, urut, account_id, faskes_teks, kso_asset_id, installation_unit_id,
         sn_teks, alat_teks, jenis, tiket_teks, jadwal_rutin_id, catatan_cocok, wa_message_id, is_late, submitted_at,
         di_luar_plan, started_at, start_wa_message_id, start_group_jid, start_lat, start_lon, start_geo_ts,
         start_alamat, start_media_path)
      SELECT ${input.teknisiId}, ${input.tanggal},
             GREATEST(${URUT_DI_LUAR_PLAN - 1}, COALESCE(max(urut), 0)) + 1,
             ${acc}, ${it.faskes}, ${a.kso_asset_id}, ${a.installation_unit_id}, ${it.sn}, ${it.alat}, ${it.jenis},
             ${it.tiket}, ${jr}, ${masalah}, ${input.waMessageId}, false, ${mulaiAt}::timestamptz,
             true, ${kolomStart.started_at}::timestamptz, ${kolomStart.start_wa_message_id}, ${kolomStart.start_group_jid},
             ${kolomStart.start_lat}, ${kolomStart.start_lon}, ${kolomStart.start_geo_ts}, ${kolomStart.start_alamat},
             ${kolomStart.start_media_path}
      FROM teknisi_plan_item WHERE teknisi_id = ${input.teknisiId} AND tanggal = ${input.tanggal}
      RETURNING urut`;
    out.mulai.push({ urut: Number(r.urut), diLuarPlan: true, berlokasi: !!geo });
    if (masalah) out.ditolak.push({ urut: Number(r.urut), alasan: `tercatat, tapi ${masalah} — laporkan dengan SN` });
    return out;
  }

  let nomor = input.parse.nomor;
  if (input.parse.faskes) {
    // #START <faskes> → semua item plan hari ini di faskes itu (account_id, atau tulisan faskes yang sama).
    const acc = await accountIdDariTulisan(input.parse.faskes);
    const kunci = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const items = await sql`
      SELECT urut, account_id, faskes_teks, started_at, reported_at FROM teknisi_plan_item
      WHERE teknisi_id = ${input.teknisiId} AND tanggal = ${input.tanggal} ORDER BY urut`;
    const cocok = items.filter((p) =>
      (acc != null && p.account_id != null && Number(p.account_id) === acc) || kunci(p.faskes_teks) === kunci(input.parse.faskes));
    if (cocok.length === 0) {
      out.pesan.push(`Tak ada #PLAN hari ini untuk "${input.parse.faskes}". Kerja di luar plan: #START ${input.parse.faskes} | SN/alat | jenis`);
      return out;
    }
    const terbuka = cocok.filter((p) => !p.started_at && !p.reported_at);
    if (terbuka.length === 0) {
      out.pesan.push(`Semua pekerjaan di "${input.parse.faskes}" hari ini sudah dimulai/dilaporkan.`);
      return out;
    }
    nomor = terbuka.map((p) => Number(p.urut));
  }
  for (const n of nomor) {
    const [p] = await sql`
      SELECT id, started_at, reported_at FROM teknisi_plan_item
      WHERE teknisi_id = ${input.teknisiId} AND tanggal = ${input.tanggal} AND urut = ${n}`;
    if (!p) { out.ditolak.push({ urut: n, alasan: "tak ada di #PLAN hari ini" }); continue; }
    if (p.reported_at) { out.ditolak.push({ urut: n, alasan: "sudah dilaporkan" }); continue; }
    if (p.started_at) { out.ditolak.push({ urut: n, alasan: `sudah dimulai ${jamWib(p.started_at as string)}` }); continue; }
    const u = await sql`
      UPDATE teknisi_plan_item SET
        started_at = ${kolomStart.started_at}::timestamptz, start_wa_message_id = ${kolomStart.start_wa_message_id},
        start_group_jid = ${kolomStart.start_group_jid}, start_lat = ${kolomStart.start_lat},
        start_lon = ${kolomStart.start_lon}, start_geo_ts = ${kolomStart.start_geo_ts},
        start_alamat = ${kolomStart.start_alamat}, start_media_path = ${kolomStart.start_media_path}
      WHERE id = ${p.id} AND started_at IS NULL AND reported_at IS NULL
      RETURNING id`;
    if (u.length) out.mulai.push({ urut: n, diLuarPlan: false, berlokasi: !!geo });
    else out.ditolak.push({ urut: n, alasan: "baru saja dimulai/dilaporkan" });
  }
  return out;
}

/**
 * Foto yang dikirim SESUDAH teks #START (tanpa caption hashtag) → item yang baru di-start
 * pengirim ini dalam jendela START_FOTO_JENDELA_MENIT dan belum berfoto. Koordinat hanya
 * diisi bila item itu belum punya. null = tak ada start yang menunggu foto (caller lanjut ke
 * jalur foto report).
 */
export async function tempelFotoStart(input: {
  teknisiId: string;
  mediaPath: string;
  receivedAt: string;
  geo: GeoWa | null;
}): Promise<{ urut: number[]; berlokasi: boolean } | null> {
  const sql = db();
  const geo = adaGeo(input.geo) ? input.geo : null;
  const rows = await sql`
    UPDATE teknisi_plan_item SET
      start_media_path = ${input.mediaPath},
      start_lat = COALESCE(start_lat, ${geo?.lat ?? null}), start_lon = COALESCE(start_lon, ${geo?.lon ?? null}),
      start_geo_ts = COALESCE(start_geo_ts, ${geo?.ts ?? null}), start_alamat = COALESCE(start_alamat, ${geo?.alamat ?? null})
    WHERE teknisi_id = ${input.teknisiId} AND start_media_path IS NULL AND reported_at IS NULL
      AND started_at BETWEEN ${input.receivedAt}::timestamptz - make_interval(mins => ${START_FOTO_JENDELA_MENIT})
                         AND ${input.receivedAt}::timestamptz + interval '1 minute'
    RETURNING urut, (start_lat IS NOT NULL) AS berlokasi`;
  if (rows.length === 0) return null;
  return { urut: rows.map((r) => Number(r.urut)).sort((a, b) => a - b), berlokasi: rows.every((r) => r.berlokasi) };
}

// ---------------------------------------------------------------------------
// Job: pengingat "sudah #START, belum #REPORT" (default 17:00)
// ---------------------------------------------------------------------------

export const teknisiStartReminderAktif = (): boolean =>
  (process.env.TEKNISI_START_REMINDER_ENABLED ?? "false").toLowerCase() === "true";

export function pesanIngatReport(nama: string, items: { urut: number; faskes: string | null; jam: string }[]): string {
  return [
    `⏰ ${nama}, pekerjaan ini sudah di-#START tapi belum di-#REPORT:`,
    ...items.map((i) => `• No. ${i.urut}${i.faskes ? ` · ${i.faskes}` : ""} · mulai ${i.jam}`),
    "",
    "Kirim #REPORT sebelum pulang. Yang tetap kosong besok pagi tercatat \"tanpa laporan\".",
  ].join("\n");
}

/** Hari ini (WIB): item start tanpa report & belum diingatkan → satu pesan per teknisi per grup. */
export async function ingatkanBelumReport(): Promise<{ teknisi: number; item: number; terkirim: number }> {
  const sql = db();
  const rows = await sql`
    SELECT p.id, p.teknisi_id, p.urut, p.faskes_teks, p.started_at, p.start_group_jid,
           COALESCE(NULLIF(mu.panggilan, ''), mu.nama, p.teknisi_id) AS nama
    FROM teknisi_plan_item p
    LEFT JOIN master_user mu ON mu.am_id = p.teknisi_id
    WHERE p.started_at IS NOT NULL AND p.reported_at IS NULL AND p.ingat_report_at IS NULL
      AND p.start_group_jid IS NOT NULL
      AND p.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
    ORDER BY p.teknisi_id, p.start_group_jid, p.urut`;
  const grup = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) {
    const k = `${r.teknisi_id}\u0000${r.start_group_jid}`;
    grup.set(k, [...(grup.get(k) ?? []), r]);
  }
  let terkirim = 0;
  for (const items of grup.values()) {
    const teks = pesanIngatReport(String(items[0].nama), items.map((i) => ({
      urut: Number(i.urut), faskes: i.faskes_teks ?? null, jam: jamWib(i.started_at as string),
    })));
    const r = await sendViaWaGateway(String(items[0].start_group_jid), teks);
    // Gagal kirim → tak ditandai, supaya run berikutnya mencoba lagi.
    if (!r.sent && !r.dryRun) continue;
    terkirim++;
    await sql`UPDATE teknisi_plan_item SET ingat_report_at = now() WHERE id IN ${sql(items.map((i) => Number(i.id)))}`;
  }
  return { teknisi: new Set(rows.map((r) => r.teknisi_id)).size, item: rows.length, terkirim };
}

// ---------------------------------------------------------------------------
// Job: retensi foto #START (default 30 hari). Koordinat & jam TETAP disimpan.
// ---------------------------------------------------------------------------

export const teknisiFotoStartRetensiAktif = (): boolean =>
  (process.env.TEKNISI_FOTO_START_RETENSI_ENABLED ?? "false").toLowerCase() === "true";
export const teknisiFotoStartRetensiHari = (): number =>
  Math.min(Math.max(Number(process.env.TEKNISI_FOTO_START_RETENSI_HARI) || 30, 7), 365);

const EKSTENSI_FOTO = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

export interface FsFoto {
  lstat(p: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath(p: string): Promise<string>;
  unlink(p: string): Promise<void>;
}
const fsAsli: FsFoto = { lstat, realpath: (p) => realpath(p), unlink };
const kodeGalat = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;

export type HasilHapusFoto =
  | { status: "dihapus" }
  | { status: "tidak-ada" }
  | { status: "ditolak"; alasan: "path-kosong" | "bukan-foto" | "symlink" | "bukan-berkas" | "di-luar-root" }
  | { status: "gagal"; alasan: string };

/**
 * Hapus SATU foto start. Syarat semua wajib (kalau tidak, berkas dibiarkan): ekstensi foto,
 * bukan symlink, berkas biasa, realpath di dalam realpath(root). ENOENT = "tidak-ada".
 * Tidak pernah melempar. Pola sama dengan hapusBerkasLampiran (kso-lampiran-berkas.ts).
 */
export async function hapusFotoStart(path: string | null | undefined, o: { root: string; fs?: FsFoto }): Promise<HasilHapusFoto> {
  const fs = o.fs ?? fsAsli;
  if (!path || !path.trim()) return { status: "ditolak", alasan: "path-kosong" };
  if (!EKSTENSI_FOTO.has(extname(path).toLowerCase())) return { status: "ditolak", alasan: "bukan-foto" };
  try {
    let st: Awaited<ReturnType<FsFoto["lstat"]>>;
    try {
      st = await fs.lstat(path);
    } catch (e) {
      if (kodeGalat(e) === "ENOENT") return { status: "tidak-ada" };
      throw e;
    }
    if (st.isSymbolicLink()) return { status: "ditolak", alasan: "symlink" };
    if (!st.isFile()) return { status: "ditolak", alasan: "bukan-berkas" };
    const asli = await fs.realpath(path);
    const root = await fs.realpath(o.root);
    if (!isInsideRoot(asli, root) || asli === root) return { status: "ditolak", alasan: "di-luar-root" };
    if (!EKSTENSI_FOTO.has(extname(asli).toLowerCase())) return { status: "ditolak", alasan: "bukan-foto" };
    try {
      await fs.unlink(asli);
    } catch (e) {
      if (kodeGalat(e) === "ENOENT") return { status: "tidak-ada" };
      throw e;
    }
    return { status: "dihapus" };
  } catch (e) {
    if (kodeGalat(e) === "ENOENT") return { status: "tidak-ada" };
    return { status: "gagal", alasan: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/**
 * Foto start lebih tua dari masa simpan → berkas dihapus, start_media_path dikosongkan,
 * start_foto_dihapus_at diisi. Foto yang juga dipakai sebagai foto report (teknisi_kunjungan_foto)
 * TIDAK dihapus berkasnya (foto report disimpan permanen) — hanya tautan start-nya dilepas.
 */
export async function bersihkanFotoStart(o: { hari?: number; batas?: number } = {}): Promise<Record<string, number>> {
  const sql = db();
  const hari = o.hari ?? teknisiFotoStartRetensiHari();
  const rows = await sql`
    SELECT p.id, p.start_media_path,
           EXISTS (SELECT 1 FROM teknisi_kunjungan_foto f WHERE f.media_path = p.start_media_path) AS dipakai_report
    FROM teknisi_plan_item p
    WHERE p.start_media_path IS NOT NULL AND p.started_at < now() - make_interval(days => ${hari})
    ORDER BY p.started_at LIMIT ${o.batas ?? 500}`;
  const hitung: Record<string, number> = { diperiksa: rows.length, dihapus: 0, "tidak-ada": 0, "dipakai-report": 0, ditolak: 0, gagal: 0 };
  const root = mediaRootWa();
  for (const r of rows) {
    let lepas = false;
    if (r.dipakai_report) {
      hitung["dipakai-report"]++;
      lepas = true;
    } else {
      const h = await hapusFotoStart(String(r.start_media_path), { root });
      hitung[h.status]++;
      lepas = h.status === "dihapus" || h.status === "tidak-ada";
    }
    if (lepas) {
      await sql`UPDATE teknisi_plan_item SET start_media_path = NULL, start_foto_dihapus_at = now() WHERE id = ${r.id}`;
    }
  }
  return hitung;
}
