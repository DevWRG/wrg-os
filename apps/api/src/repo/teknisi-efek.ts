// F175 bagian 2 — efek #REPORT Teknisi ke jadwal/tiket/install + Plan Tidak Realisasi.
// Spesifikasi: docs/features/F175-plan-report-teknisi.md ("Efek dari report").
//
// SQL langsung, BUKAN memanggil maintenance.ts / serviceticket.ts / readinessboard.ts:
// modul Aftersales itu baru ada di dev. Mengimpornya membuat F175 tak bisa
// dipromosikan ke main sebelum modul itu. Tiap efek ke tabel Aftersales dijaga
// keberadaan tabelnya, jadi di main (tanpa modul) efeknya cuma jadwal_rutin (F154).
//
// Prinsip sama dengan pencocokan: TIDAK MENEBAK. Dua tiket terbuka di satu faskes =
// tak ada yang ditutup; hasilnya dicatat di kolom `efek` supaya terlihat.
import { db } from "../db.js";
import { normSn } from "./asetTetapRekon.js";

type Sql = ReturnType<typeof db>;

/** Saklar efek, TERPISAH dari saklar jalur WA: format bisa diuji dulu tanpa mengubah jadwal/tiket. */
export const teknisiEfekAktif = (): boolean =>
  (process.env.TEKNISI_EFEK_ENABLED ?? "false").toLowerCase() === "true";

const OLEH = "WA #REPORT (F175)";

const adaTabel = new Map<string, boolean>();
async function punyaTabel(sql: Sql, nama: string): Promise<boolean> {
  if (!adaTabel.has(nama)) {
    const [r] = await sql`SELECT to_regclass(${"public." + nama}) IS NOT NULL AS ada`;
    adaTabel.set(nama, Boolean(r.ada));
  }
  return adaTabel.get(nama)!;
}

interface BarisEfek {
  id: number;
  nomor_blok: number;
  jenis: string | null;
  status: string;
  kegiatan: string | null;
  kso_asset_id: number | null;
  installation_unit_id: string | null;
  account_id: number | null;
  tanggal: string;
  teknisi_nama: string | null;
  jadwal_rutin_id: number | null;
}

/**
 * PM selesai → jadwal_rutin faskes bulan itu selesai, tapi HANYA bila semua alat di
 * snapshot jadwal (jadwal_rutin.alat) sudah dilaporkan PM Selesai bulan itu.
 */
async function efekJadwalRutin(sql: Sql, b: BarisEfek): Promise<string | null> {
  if (!b.account_id) return null;
  const [j] = await sql`
    SELECT id, alat, status FROM jadwal_rutin
    WHERE ${b.jadwal_rutin_id ? sql`id = ${b.jadwal_rutin_id}` : sql`account_id = ${b.account_id}
          AND bulan = date_trunc('month', ${b.tanggal}::date)::date`} AND status <> 'batal'
    LIMIT 1`;
  if (!j) return null;
  if (j.status === "selesai") return "jadwal rutin sudah selesai";
  const terjadwal = new Set(
    ((j.alat as { sn?: string | null }[] | null) ?? []).map((a) => normSn(a.sn)).filter(Boolean),
  );
  const selesai = await sql`
    SELECT DISTINCT a.sn_raw
    FROM teknisi_kunjungan k
    JOIN teknisi_kunjungan_alat ka ON ka.kunjungan_id = k.id
    JOIN kso_asset a ON a.id = ka.kso_asset_id
    WHERE k.account_id = ${b.account_id}
      AND date_trunc('month', k.tanggal) = date_trunc('month', ${b.tanggal}::date)
      AND ka.jenis = 'PM' AND ka.status = 'Selesai'`;
  const sudah = new Set(selesai.map((r) => normSn(r.sn_raw)));
  const kurang = [...terjadwal].filter((sn) => !sudah.has(sn));
  if (kurang.length > 0) return `jadwal rutin: ${terjadwal.size - kurang.length}/${terjadwal.size} alat selesai`;
  const u = await sql`
    UPDATE jadwal_rutin SET status = 'selesai', selesai_at = now(), oleh = ${OLEH}, updated_at = now()
    WHERE id = ${j.id} AND status = 'rencana'
    RETURNING id`;
  return u.length ? "jadwal rutin bulan ini selesai" : null;
}

/** PM selesai pada unit beli → maintenance_schedule maju satu siklus (sama dengan markDone di maintenance.ts). */
async function efekMaintenance(sql: Sql, b: BarisEfek): Promise<string | null> {
  if (!b.installation_unit_id || !(await punyaTabel(sql, "maintenance_schedule"))) return null;
  const u = await sql`
    UPDATE maintenance_schedule
    SET reference_date = ${b.tanggal}::date,
        due_date = (${b.tanggal}::date + (interval_bulan || ' months')::interval)::date,
        status = 'scheduled', notified_at = NULL, last_completed_at = now(),
        last_note = ${b.kegiatan}, completed_count = completed_count + 1, updated_at = now()
    WHERE installation_unit_id = ${b.installation_unit_id}::uuid
      AND (last_completed_at IS NULL OR last_completed_at < now() - interval '1 minute')
    RETURNING due_date::text`;
  return u.length ? `PM berikutnya ${u[0].due_date}` : null;
}

/** Service selesai → satu-satunya tiket terbuka faskes itu ditutup. Lebih dari satu = tak ditutup. */
async function efekTiket(sql: Sql, b: BarisEfek): Promise<string | null> {
  if (!b.account_id || !(await punyaTabel(sql, "service_ticket"))) return null;
  const buka = await sql`
    SELECT id::text FROM service_ticket WHERE customer_id = ${b.account_id} AND status = 'open' LIMIT 3`;
  if (buka.length === 0) return null;
  if (buka.length > 1) return `${buka.length} tiket servis terbuka di faskes ini — tutup manual`;
  const catatan = [b.kegiatan, b.teknisi_nama ? `(${b.teknisi_nama}, ${OLEH})` : `(${OLEH})`].filter(Boolean).join(" ");
  const u = await sql`
    UPDATE service_ticket SET status = 'resolved', resolved_at = now(), resolved_note = ${catatan}, updated_at = now()
    WHERE id = ${buka[0].id}::uuid AND status = 'open'
    RETURNING id`;
  return u.length ? "tiket servis ditutup" : null;
}

/** Install selesai → jadwal install unit itu done. Langkah unit (training/BAST) TIDAK dilompati. */
async function efekInstall(sql: Sql, b: BarisEfek): Promise<string | null> {
  if (!b.installation_unit_id || !(await punyaTabel(sql, "install_schedule"))) return null;
  const u = await sql`
    UPDATE install_schedule SET status = 'done', updated_at = now()
    WHERE installation_unit_id = ${b.installation_unit_id}::uuid AND status = 'scheduled'
    RETURNING id`;
  return u.length ? "jadwal install selesai" : null;
}

/**
 * Terapkan efek untuk semua alat Selesai di satu kunjungan; hasil per alat ditulis
 * ke teknisi_kunjungan_alat.efek dan dikembalikan per nomor blok (untuk balasan bot).
 * Alat `perlu_cek` dilewati — efek atas identitas yang belum pasti = tebakan.
 */
export async function terapkanEfek(kunjunganId: number): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!teknisiEfekAktif()) return out;
  const sql = db();
  const rows = await sql`
    SELECT ka.id, ka.nomor_blok, ka.jenis, ka.status, ka.kegiatan, ka.kso_asset_id,
           ka.installation_unit_id::text, k.account_id, k.tanggal::text, mu.nama AS teknisi_nama,
           p.jadwal_rutin_id
    FROM teknisi_kunjungan_alat ka
    JOIN teknisi_kunjungan k ON k.id = ka.kunjungan_id
    LEFT JOIN master_user mu ON mu.am_id = k.teknisi_id
    LEFT JOIN teknisi_plan_item p ON p.id = ka.plan_item_id
    WHERE ka.kunjungan_id = ${kunjunganId} AND ka.status = 'Selesai' AND NOT ka.perlu_cek
    ORDER BY ka.nomor_blok`;
  for (const r of rows) {
    const b: BarisEfek = {
      id: Number(r.id), nomor_blok: Number(r.nomor_blok), jenis: r.jenis, status: r.status, kegiatan: r.kegiatan,
      kso_asset_id: r.kso_asset_id == null ? null : Number(r.kso_asset_id),
      installation_unit_id: r.installation_unit_id ?? null,
      account_id: r.account_id == null ? null : Number(r.account_id), tanggal: String(r.tanggal),
      teknisi_nama: r.teknisi_nama ?? null, jadwal_rutin_id: r.jadwal_rutin_id == null ? null : Number(r.jadwal_rutin_id),
    };
    const hasil: (string | null)[] = [];
    try {
      if (b.jenis === "PM") hasil.push(await efekJadwalRutin(sql, b), await efekMaintenance(sql, b));
      else if (b.jenis === "Service") hasil.push(await efekTiket(sql, b));
      else if (b.jenis === "Install") hasil.push(await efekInstall(sql, b));
    } catch (e) {
      // Efek gagal tak boleh menggagalkan laporan yang sudah tersimpan.
      hasil.push(`efek gagal: ${(e as Error).message.slice(0, 120)}`);
    }
    const teks = hasil.filter(Boolean).join("; ");
    if (teks) {
      await sql`UPDATE teknisi_kunjungan_alat SET efek = ${teks} WHERE id = ${b.id}`;
      out.set(b.nomor_blok, teks);
    }
  }
  return out;
}

/**
 * Job harian: item plan yang sampai `sebelum` (eksklusif) tak dilaporkan sama sekali
 * → tidak_realisasi_at. Item yang dilaporkan Batal sudah tercatat lewat statusnya;
 * keduanya disatukan di view teknisi_plan_tidak_realisasi_v (migrasi 293).
 */
export async function tandaiTidakRealisasi(sebelum: string): Promise<{ ditandai: number }> {
  const rows = await db()`
    UPDATE teknisi_plan_item SET tidak_realisasi_at = now()
    WHERE tanggal < ${sebelum}::date AND reported_at IS NULL AND tidak_realisasi_at IS NULL
    RETURNING id`;
  return { ditandai: rows.length };
}
