// F175 — simpan #PLAN / #REPORT Teknisi (per alat) + pencocokan faskes & alat.
// Spesifikasi: docs/features/F175-plan-report-teknisi.md. Parser: parsers/teknisi.ts.
//
// Prinsip pencocokan: TIDAK MENEBAK. Faskes/alat yang tak bisa dipastikan tetap
// disimpan (supaya laporan teknisi tak hilang) tapi ditandai `perlu_cek` dengan
// alasannya, dan alasannya ikut tampil di balasan bot.
//
// Efek ke modul Aftersales (PM/tiket/install selesai) dan job Plan Tidak Realisasi
// BELUM di sini — menyusul di PR berikutnya, di belakang saklar sendiri.
import { db } from "../db.js";
import { accountIdDariTulisan } from "./akun-faskes.js";
import { normSn } from "./asetTetapRekon.js";
import { computeIsLate } from "./todo.js";
import type {
  JenisTeknisi, StatusTeknisi, TeknisiPlanItem, TeknisiReportParse,
} from "../parsers/teknisi.js";

type Sql = ReturnType<typeof db>;

/** Saklar jalur baru. Mati = Teknisi tetap lewat format sales seperti sebelumnya. */
export const teknisiPlanReportAktif = (): boolean =>
  (process.env.TEKNISI_PLAN_REPORT_ENABLED ?? "false").toLowerCase() === "true";

export const isTeknisi = (role?: string | null): boolean => (role ?? "").trim().toUpperCase() === "TEKNISI";

export interface HasilAlat {
  kso_asset_id: number | null;
  installation_unit_id: string | null;
  account_id: number | null;
  /** Nama alat untuk balasan ("Zybio EXC200"). */
  label: string | null;
  sn: string | null;
  /** null = cocok pasti. Selain itu alasan perlu_cek. */
  masalah: string | null;
}

const kunciTeks = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

let adaInstallationUnit: boolean | null = null;
async function punyaInstallationUnit(sql: Sql): Promise<boolean> {
  if (adaInstallationUnit === null) {
    // Kolom account_id (migrasi 159), bukan sekadar tabelnya: DB yang tertinggal
    // bisa punya installation_unit (130) tanpa kolom itu.
    const [r] = await sql`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'installation_unit' AND column_name = 'account_id') AS ada`;
    adaInstallationUnit = Boolean(r.ada);
  }
  return adaInstallationUnit;
}

/**
 * Cari alat dari SN (boleh 3–6 digit terakhir) dan/atau nama alat, dibatasi ke
 * faskes bila account_id diketahui. Urutan: kso_asset dulu (populasi KSO), lalu
 * installation_unit (alat beli, hanya bila modul Aftersales ada).
 */
export async function cariAlat(
  sql: Sql, accountId: number | null, sn: string | null, alat: string | null,
): Promise<HasilAlat> {
  const kosong = (masalah: string): HasilAlat => ({
    kso_asset_id: null, installation_unit_id: null, account_id: accountId, label: alat, sn, masalah,
  });
  const n = sn ? normSn(sn).replace(/[^A-Z0-9-]/g, "") : "";
  if (n) {
    const rows = await sql`
      SELECT a.id, a.sn_raw, COALESCE(NULLIF(a.nama_alat, ''), a.type_alat) AS nama, a.account_id
      FROM kso_asset a
      WHERE a.aktif AND a.sn_key NOT LIKE 'NOSN:%'
        AND (a.sn_key = ${n} OR (length(${n}) BETWEEN 3 AND 6 AND a.sn_key LIKE '%' || ${n}))
        AND (${accountId}::bigint IS NULL OR a.account_id = ${accountId})
      ORDER BY (a.sn_key = ${n}) DESC, a.id
      LIMIT 5`;
    const persis = rows.filter((r) => normSn(r.sn_raw) === n);
    const pilih = persis.length === 1 ? persis : rows;
    if (pilih.length === 1) {
      const r = pilih[0];
      return {
        kso_asset_id: Number(r.id), installation_unit_id: null,
        account_id: r.account_id == null ? accountId : Number(r.account_id),
        label: r.nama ? String(r.nama) : alat, sn: r.sn_raw ? String(r.sn_raw) : sn, masalah: null,
      };
    }
    if (pilih.length > 1) return kosong(`SN ${sn} cocok ke ${pilih.length} alat — tulis SN lebih lengkap`);
    if (await punyaInstallationUnit(sql)) {
      const iu = await sql`
        SELECT id::text, alat_name, serial_number, account_id
        FROM installation_unit
        WHERE serial_number IS NOT NULL
          AND (upper(regexp_replace(serial_number, '\\s', '', 'g')) = ${n}
               OR (length(${n}) BETWEEN 3 AND 6 AND upper(regexp_replace(serial_number, '\\s', '', 'g')) LIKE '%' || ${n}))
          AND (${accountId}::bigint IS NULL OR account_id = ${accountId})
        LIMIT 3`;
      if (iu.length === 1) {
        return {
          kso_asset_id: null, installation_unit_id: String(iu[0].id),
          account_id: iu[0].account_id == null ? accountId : Number(iu[0].account_id),
          label: String(iu[0].alat_name), sn: String(iu[0].serial_number), masalah: null,
        };
      }
      if (iu.length > 1) return kosong(`SN ${sn} cocok ke ${iu.length} alat — tulis SN lebih lengkap`);
    }
    return kosong(accountId ? `SN ${sn} tak ditemukan di faskes ini` : `SN ${sn} tak ditemukan`);
  }
  if (alat) {
    // Teknisi sering menulis potongan SN alfanumerik ("L35", "5L40") di kolom alat.
    // Nama alat tak ketemu → coba sebagai SN; hanya dipakai bila hasilnya pasti.
    const cobaSn = async (): Promise<HasilAlat | null> => {
      if (!/\d/.test(alat) || /\s/.test(alat.trim())) return null;
      const viaSn = await cariAlat(sql, accountId, alat, null);
      return viaSn.masalah ? null : viaSn;
    };
    if (!accountId) return (await cobaSn()) ?? kosong("faskes tak dikenali, alat tak bisa dipastikan");
    const k = kunciTeks(alat);
    if (k.length < 2) return kosong(`nama alat "${alat}" terlalu pendek`);
    const rows = await sql`
      SELECT a.id, a.sn_raw, COALESCE(NULLIF(a.nama_alat, ''), a.type_alat) AS nama
      FROM kso_asset a
      WHERE a.aktif AND a.account_id = ${accountId}
        AND regexp_replace(upper(COALESCE(a.nama_alat, '') || ' ' || COALESCE(a.type_alat, '')), '[^A-Z0-9]', '', 'g')
            LIKE '%' || ${k} || '%'
      LIMIT 5`;
    if (rows.length === 1) {
      return {
        kso_asset_id: Number(rows[0].id), installation_unit_id: null, account_id: accountId,
        label: String(rows[0].nama ?? alat), sn: rows[0].sn_raw ? String(rows[0].sn_raw) : null, masalah: null,
      };
    }
    if (rows.length > 1) return kosong(`${rows.length} alat "${alat}" di faskes ini — tulis SN`);
    return (await cobaSn()) ?? kosong(`alat "${alat}" tak ditemukan di faskes ini`);
  }
  return kosong("identitas alat kosong");
}

/** jadwal_rutin aktif faskes itu di bulan `tanggal` (F154) — rujukan item plan. */
async function jadwalRutinId(sql: Sql, accountId: number | null, tanggal: string): Promise<number | null> {
  if (!accountId) return null;
  const [r] = await sql`
    SELECT id FROM jadwal_rutin
    WHERE account_id = ${accountId} AND bulan = date_trunc('month', ${tanggal}::date)::date AND status <> 'batal'
    LIMIT 1`;
  return r ? Number(r.id) : null;
}

// ---------------------------------------------------------------------------
// #PLAN
// ---------------------------------------------------------------------------

export interface PlanTersimpan {
  urut: number;
  faskes: string;
  alatLabel: string | null;
  jenis: JenisTeknisi;
  masalah: string | null;
}

export async function simpanPlanTeknisi(input: {
  teknisiId: string;
  role: string | null;
  tanggal: string;
  items: TeknisiPlanItem[];
  waMessageId: string | null;
  submittedAt: string | null;
}): Promise<{ items: PlanTersimpan[]; late: boolean; dilewati: number[] }> {
  const sql = db();
  const late = computeIsLate(input.tanggal, input.role, input.submittedAt);
  // Pencocokan di luar transaksi (baca-saja, bisa lambat karena katalog faskes).
  const cocok: { it: TeknisiPlanItem; acc: number | null; a: HasilAlat; masalah: string | null; jr: number | null }[] = [];
  for (const it of input.items) {
    let acc = await accountIdDariTulisan(it.faskes);
    const a = await cariAlat(sql, acc, it.sn, it.alat);
    if (!acc && a.account_id) acc = a.account_id;
    const masalah = [acc ? null : `faskes "${it.faskes}" tak dikenali`, a.masalah].filter(Boolean).join("; ") || null;
    cocok.push({ it, acc, a, masalah, jr: await jadwalRutinId(sql, acc, input.tanggal) });
  }
  const dilewati: number[] = [];
  await sql.begin(async (tx) => {
    // Kirim ulang #PLAN di hari yang sama = ganti item yang BELUM dilaporkan.
    await tx`DELETE FROM teknisi_plan_item
             WHERE teknisi_id = ${input.teknisiId} AND tanggal = ${input.tanggal} AND reported_at IS NULL`;
    for (const { it, acc, a, masalah, jr } of cocok) {
      const r = await tx`
        INSERT INTO teknisi_plan_item
          (teknisi_id, tanggal, urut, account_id, faskes_teks, kso_asset_id, installation_unit_id,
           sn_teks, alat_teks, jenis, tiket_teks, jadwal_rutin_id, catatan_cocok, wa_message_id, is_late, submitted_at)
        VALUES
          (${input.teknisiId}, ${input.tanggal}, ${it.urut}, ${acc}, ${it.faskes}, ${a.kso_asset_id},
           ${a.installation_unit_id}, ${it.sn}, ${it.alat}, ${it.jenis}, ${it.tiket}, ${jr}, ${masalah},
           ${input.waMessageId}, ${late}, COALESCE(${input.submittedAt}::timestamptz, now()))
        ON CONFLICT (teknisi_id, tanggal, urut) DO NOTHING
        RETURNING id`;
      if (r.length === 0) dilewati.push(it.urut); // nomor itu sudah dilaporkan
    }
  });
  return {
    late,
    dilewati,
    items: cocok
      .filter(({ it }) => !dilewati.includes(it.urut))
      .map(({ it, a, masalah }) => ({ urut: it.urut, faskes: it.faskes, alatLabel: a.label ?? it.alat ?? it.sn, jenis: it.jenis, masalah })),
  };
}

// ---------------------------------------------------------------------------
// #REPORT
// ---------------------------------------------------------------------------

export interface AlatTerlapor {
  nomor: number;
  alatLabel: string | null;
  sn: string | null;
  jenis: JenisTeknisi | null;
  status: StatusTeknisi;
  alasan: string | null;
  masalah: string | null;
}

export async function simpanReportTeknisi(input: {
  teknisiId: string;
  tanggal: string;
  parse: TeknisiReportParse;
  waMessageId: string | null;
  receivedAt: string | null;
  mediaPath: string | null;
}): Promise<{ duplikat: boolean; faskes: string | null; alat: AlatTerlapor[] }> {
  const sql = db();
  const { parse } = input;
  const plan = await sql`
    SELECT p.id, p.urut, p.account_id, p.faskes_teks, p.kso_asset_id, p.installation_unit_id::text, p.sn_teks,
           p.alat_teks, p.jenis, p.catatan_cocok,
           COALESCE(NULLIF(a.nama_alat, ''), a.type_alat) AS asset_nama, a.sn_raw AS asset_sn
    FROM teknisi_plan_item p LEFT JOIN kso_asset a ON a.id = p.kso_asset_id
    WHERE p.teknisi_id = ${input.teknisiId} AND p.tanggal = ${input.tanggal}`;
  const planPerUrut = new Map(plan.map((p) => [Number(p.urut), p]));

  let acc = parse.faskes ? await accountIdDariTulisan(parse.faskes) : null;
  let faskesLabel = parse.faskes;
  const masalahFaskes = parse.faskes && !acc ? `faskes "${parse.faskes}" tak dikenali` : null;

  const baris: {
    b: TeknisiReportParse["blok"][number]; planId: number | null; assetId: number | null; unitId: string | null;
    label: string | null; snTampil: string | null; jenis: JenisTeknisi | null; masalah: string | null;
  }[] = [];
  for (const b of parse.blok) {
    const masalah: string[] = [];
    const p = b.planNo != null ? planPerUrut.get(b.planNo) : undefined;
    if (b.planNo != null && !p) masalah.push(`plan #${b.planNo} tanggal ini tak ada`);
    let assetId: number | null = p?.kso_asset_id != null ? Number(p.kso_asset_id) : null;
    let unitId: string | null = p?.installation_unit_id ? String(p.installation_unit_id) : null;
    let label: string | null = p ? (p.asset_nama ?? p.alat_teks ?? p.sn_teks ?? null) : null;
    let snTampil: string | null = p ? (p.asset_sn ?? p.sn_teks ?? null) : null;
    let planId: number | null = p ? Number(p.id) : null;
    const accBlok = acc ?? (p?.account_id != null ? Number(p.account_id) : null);
    if (!faskesLabel && p) faskesLabel = String(p.faskes_teks);

    if (b.sn || b.alat) {
      const a = await cariAlat(sql, accBlok, b.sn, b.alat);
      if (a.masalah) {
        masalah.push(a.masalah);
      } else if (p && ((assetId && a.kso_asset_id && assetId !== a.kso_asset_id) || (unitId && a.installation_unit_id && unitId !== a.installation_unit_id))) {
        // Nomor plan + SN sekaligus, tapi menunjuk alat berbeda: jangan pilih salah
        // satu — lepas keduanya, biar peninjau yang memutuskan.
        masalah.push(`SN/alat tak cocok dengan plan #${b.planNo} — cek nomor plan`);
        assetId = null; unitId = null; planId = null;
      } else {
        assetId = a.kso_asset_id ?? assetId;
        unitId = a.installation_unit_id ?? unitId;
        if (!acc && a.account_id) acc = a.account_id;
      }
      label = a.label ?? label ?? b.alat;
      snTampil = a.sn ?? b.sn ?? snTampil;
    } else if (p && !assetId && !unitId && p.catatan_cocok) {
      masalah.push("alat di plan belum dikenali");
    }
    if (masalahFaskes && !p) masalah.push(masalahFaskes);

    // Laporan tanpa nomor plan tapi alatnya ada di plan hari ini → tautkan otomatis.
    if (!planId && !p && (assetId || unitId)) {
      const cocokPlan = plan.filter((x) =>
        (assetId && Number(x.kso_asset_id) === assetId) || (unitId && x.installation_unit_id === unitId));
      if (cocokPlan.length === 1) planId = Number(cocokPlan[0].id);
    }
    baris.push({
      b, planId, assetId, unitId, label, snTampil,
      jenis: (b.jenis ?? (p?.jenis as JenisTeknisi | undefined) ?? null) as JenisTeknisi | null,
      masalah: masalah.length ? masalah.join("; ") : null,
    });
  }

  const hasil = await sql.begin(async (tx) => {
    const k = await tx`
      INSERT INTO teknisi_kunjungan (teknisi_id, tanggal, account_id, faskes_teks, catatan, wa_message_id, reported_at)
      VALUES (${input.teknisiId}, ${input.tanggal}, ${acc}, ${faskesLabel}, ${parse.catatan}, ${input.waMessageId},
              COALESCE(${input.receivedAt}::timestamptz, now()))
      ON CONFLICT (wa_message_id) DO NOTHING
      RETURNING id`;
    if (k.length === 0) return { duplikat: true };
    const kunjunganId = Number(k[0].id);
    for (const x of baris) {
      await tx`
        INSERT INTO teknisi_kunjungan_alat
          (kunjungan_id, nomor_blok, plan_item_id, kso_asset_id, installation_unit_id, sn_teks, alat_teks, jenis,
           status, alasan, kegiatan, jumlah_tes, sparepart, catatan, perlu_cek, catatan_cocok)
        VALUES
          (${kunjunganId}, ${x.b.nomor}, ${x.planId}, ${x.assetId}, ${x.unitId}, ${x.b.sn}, ${x.b.alat}, ${x.jenis},
           ${x.b.status!}, ${x.b.alasan}, ${x.b.kegiatan}, ${x.b.jumlahTes}, ${x.b.sparepart}, ${x.b.catatan},
           ${x.masalah != null}, ${x.masalah})`;
      if (x.planId) {
        await tx`UPDATE teknisi_plan_item SET reported_at = COALESCE(reported_at, now()) WHERE id = ${x.planId}`;
      }
    }
    // Report dikirim sebagai caption foto → foto kunjungan umum.
    if (input.mediaPath) {
      await tx`
        INSERT INTO teknisi_kunjungan_foto (kunjungan_id, media_path, wa_message_id)
        VALUES (${kunjunganId}, ${input.mediaPath}, ${input.waMessageId})
        ON CONFLICT DO NOTHING`;
    }
    return { duplikat: false };
  });

  return {
    duplikat: hasil.duplikat,
    faskes: faskesLabel,
    alat: baris.map((x) => ({
      nomor: x.b.nomor, alatLabel: x.label, sn: x.snTampil, jenis: x.jenis,
      status: x.b.status!, alasan: x.b.alasan, masalah: x.masalah,
    })),
  };
}
