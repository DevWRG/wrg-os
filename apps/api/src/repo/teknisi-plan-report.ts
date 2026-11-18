// F175 — simpan #PLAN / #REPORT Teknisi (per alat) + pencocokan faskes & alat.
// Spesifikasi: docs/features/F175-plan-report-teknisi.md. Parser: parsers/teknisi.ts.
//
// Prinsip pencocokan: TIDAK MENEBAK. Faskes/alat yang tak bisa dipastikan tetap
// disimpan (supaya laporan teknisi tak hilang) tapi ditandai `perlu_cek` dengan
// alasannya, dan alasannya ikut tampil di balasan bot.
//
// Efek ke jadwal/tiket/install (saklar TEKNISI_EFEK_ENABLED) dan job Plan Tidak
// Realisasi ada di teknisi-efek.ts.
import { db } from "../db.js";
import { accountIdDariTulisan } from "./akun-faskes.js";
import { normSn } from "./asetTetapRekon.js";
import { computeIsLate } from "./todo.js";
import { terapkanEfek } from "./teknisi-efek.js";
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
export async function jadwalRutinId(sql: Sql, accountId: number | null, tanggal: string): Promise<number | null> {
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
    // Kirim ulang #PLAN di hari yang sama = ganti item yang BELUM dilaporkan DAN belum
    // di-#START (jam mulai tak boleh hilang); item di luar plan (dari #START) tetap.
    await tx`DELETE FROM teknisi_plan_item
             WHERE teknisi_id = ${input.teknisiId} AND tanggal = ${input.tanggal} AND reported_at IS NULL
               AND started_at IS NULL AND NOT di_luar_plan`;
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
  efek: string | null;
  /** Menit #START → #REPORT (null = tanpa start). */
  durasiMenit: number | null;
  /** Pekerjaan tak pernah di-#START — diterima, ditandai. */
  tanpaStart: boolean;
  /** Item plan ini SUDAH di-#REPORT sebelumnya (laporan dobel/susulan) — diterima, ditandai. */
  sudahDilaporkan: { planNo: number; jam: string } | null;
}

/** Foto dari pengirim yang sama dalam jendela ini sebelum #REPORT ikut jadi foto kunjungan. */
export const FOTO_JENDELA_MENIT = 30;

export async function simpanReportTeknisi(input: {
  teknisiId: string;
  tanggal: string;
  parse: TeknisiReportParse;
  waMessageId: string | null;
  receivedAt: string | null;
  mediaPath: string | null;
  /** Untuk menjodohkan foto yang dikirim SEBELUM teks report (WA mengirimnya terpisah). */
  pengirim?: { groupJid: string; senderName: string | null } | null;
}): Promise<{
  duplikat: boolean; faskes: string | null; alat: AlatTerlapor[]; foto: number; lokasi: "ada" | "tanpa-geotag" | "tanpa-foto";
  /** Satu #REPORT bisa memuat >1 faskes → satu kunjungan per faskes (keputusan user 16 Nov 2026). */
  kelompok: { faskes: string | null; nomor: number[] }[];
}> {
  const sql = db();
  const { parse } = input;
  // Nama/SN alat BELI (installation_unit) ikut tampil di balasan, bukan hanya alat KSO.
  const unitAda = await punyaInstallationUnit(sql);
  const plan = await sql`
    SELECT p.id, p.urut, p.account_id, p.faskes_teks, p.kso_asset_id, p.installation_unit_id::text, p.sn_teks,
           p.alat_teks, p.jenis, p.catatan_cocok, p.started_at, p.reported_at,
           COALESCE(NULLIF(a.nama_alat, ''), a.type_alat, ${unitAda ? sql`iu.alat_name` : sql`NULL`}) AS asset_nama,
           COALESCE(a.sn_raw, ${unitAda ? sql`iu.serial_number` : sql`NULL`}) AS asset_sn
    FROM teknisi_plan_item p LEFT JOIN kso_asset a ON a.id = p.kso_asset_id
    ${unitAda ? sql`LEFT JOIN installation_unit iu ON iu.id = p.installation_unit_id` : sql``}
    WHERE p.teknisi_id = ${input.teknisiId} AND p.tanggal = ${input.tanggal}`;
  const planPerUrut = new Map(plan.map((p) => [Number(p.urut), p]));

  let acc = parse.faskes ? await accountIdDariTulisan(parse.faskes) : null;
  let faskesLabel = parse.faskes;
  const masalahFaskes = parse.faskes && !acc ? `faskes "${parse.faskes}" tak dikenali` : null;

  const baris: {
    b: TeknisiReportParse["blok"][number]; planId: number | null; assetId: number | null; unitId: string | null;
    label: string | null; snTampil: string | null; jenis: JenisTeknisi | null; masalah: string | null;
    /** Faskes blok: judul blok > item plan tertaut > alat > `RS:` kunjungan. */
    akun: number | null; faskesBlok: string | null;
  }[] = [];
  for (const b of parse.blok) {
    const masalah: string[] = [];
    // Faskes di judul blok (format #PLAN "RS A | SN | jenis") didahulukan dari `RS:` kunjungan.
    const accJudul = b.faskes ? await accountIdDariTulisan(b.faskes) : null;
    let p = b.planNo != null ? planPerUrut.get(b.planNo) : undefined;
    if (b.planNo != null && !p) masalah.push(`plan #${b.planNo} tanggal ini tak ada`);
    // Judul blok HANYA nama faskes ("1. RSUD Trenggalek", 18 Nov 2026): nomor blok = nomor plan bila item itu
    // memang di faskes tersebut; selain itu satu-satunya item plan (belum dilaporkan) di faskes itu hari ini.
    if (!p && b.planNo == null && !b.sn && !b.alat && b.faskes) {
      const k = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const diFaskes = plan.filter((x) =>
        accJudul ? Number(x.account_id) === accJudul : k(x.faskes_teks) === k(b.faskes));
      const belum = diFaskes.filter((x) => !x.reported_at);
      p = diFaskes.find((x) => Number(x.urut) === (b.nomorTulis ?? b.nomor))
        ?? (belum.length === 1 ? belum[0] : diFaskes.length === 1 ? diFaskes[0] : undefined);
      if (!p) {
        masalah.push(diFaskes.length
          ? `${diFaskes.length} pekerjaan di #PLAN untuk faskes ini — tulis nomor plan (#n) atau SN`
          : "faskes ini tak ada di #PLAN hari ini — tulis SN atau nama alat");
      }
    }
    let assetId: number | null = p?.kso_asset_id != null ? Number(p.kso_asset_id) : null;
    let unitId: string | null = p?.installation_unit_id ? String(p.installation_unit_id) : null;
    let label: string | null = p ? (p.asset_nama ?? p.alat_teks ?? p.sn_teks ?? null) : null;
    let snTampil: string | null = p ? (p.asset_sn ?? p.sn_teks ?? null) : null;
    let planId: number | null = p ? Number(p.id) : null;
    if (b.faskes && !accJudul) masalah.push(`faskes "${b.faskes}" tak dikenali`);
    const accBlok = accJudul ?? acc ?? (p?.account_id != null ? Number(p.account_id) : null);
    if (!faskesLabel && b.faskes) faskesLabel = b.faskes;
    if (!faskesLabel && p) faskesLabel = String(p.faskes_teks);

    let akunAlat: number | null = null;
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
        if (a.account_id) akunAlat = a.account_id;
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
    const planTaut = planId ? plan.find((x) => Number(x.id) === planId) : undefined;
    const akunPlan = planTaut?.account_id != null ? Number(planTaut.account_id) : null;
    baris.push({
      b, planId, assetId, unitId, label, snTampil,
      akun: accJudul ?? akunPlan ?? akunAlat ?? acc,
      faskesBlok: b.faskes ?? (planTaut ? String(planTaut.faskes_teks) : null) ?? parse.faskes ?? null,
      // Jenis: tulisan blok > plan via nomor > plan yang tertaut otomatis lewat SN/alat.
      jenis: (b.jenis ?? (p?.jenis as JenisTeknisi | undefined)
        ?? (planId ? (plan.find((x) => Number(x.id) === planId)?.jenis as JenisTeknisi | undefined) : undefined)
        ?? null) as JenisTeknisi | null,
      masalah: masalah.length ? masalah.join("; ") : null,
    });
  }

  // Report merujuk plan tanpa `RS:` → faskes kunjungan dari item plan yang dirujuk (bila semuanya satu faskes).
  if (!acc) {
    const akunPlan = new Set(baris.map((x) => (x.planId ? plan.find((p) => Number(p.id) === x.planId)?.account_id : null))
      .filter((v) => v != null).map(Number));
    if (akunPlan.size === 1) acc = [...akunPlan][0];
  }

  // Kelompokkan blok per faskes (urut kemunculan). Satu faskes = perilaku lama (satu kunjungan).
  const grup: { akun: number | null; label: string | null; baris: typeof baris }[] = [];
  for (const x of baris) {
    const akun = x.akun ?? (grup.length === 0 ? acc : null);
    const kunci = (g: { akun: number | null; label: string | null }) =>
      g.akun != null ? `a${g.akun}` : `t${(g.label ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const label = x.faskesBlok ?? faskesLabel;
    const ada = grup.find((g) => kunci(g) === kunci({ akun, label }));
    if (ada) ada.baris.push(x); else grup.push({ akun, label, baris: [x] });
  }
  if (grup.length === 1) { grup[0].akun = grup[0].akun ?? acc; grup[0].label = grup[0].label ?? faskesLabel; }

  const hasil = await sql.begin(async (tx) => {
    const kunjunganIds: number[] = [];
    for (const [gi, g] of grup.entries()) {
      // wa_message_id UNIK per kunjungan: kunjungan ke-2+ dari pesan yang sama diberi akhiran #n.
      const waId = gi === 0 ? input.waMessageId : input.waMessageId ? `${input.waMessageId}#${gi + 1}` : null;
      const k = await tx`
        INSERT INTO teknisi_kunjungan (teknisi_id, tanggal, account_id, faskes_teks, catatan, wa_message_id, reported_at)
        VALUES (${input.teknisiId}, ${input.tanggal}, ${g.akun}, ${g.label}, ${parse.catatan}, ${waId},
                COALESCE(${input.receivedAt}::timestamptz, now()))
        ON CONFLICT (wa_message_id) DO NOTHING
        RETURNING id`;
      if (k.length === 0) {
        if (gi === 0) return { duplikat: true, kunjunganIds: [] as number[], foto: 0 };
        continue;
      }
      const kid = Number(k[0].id);
      kunjunganIds.push(kid);
      for (const x of g.baris) {
        await tx`
          INSERT INTO teknisi_kunjungan_alat
            (kunjungan_id, nomor_blok, plan_item_id, kso_asset_id, installation_unit_id, sn_teks, alat_teks, jenis,
             status, alasan, kegiatan, jumlah_tes, sparepart, catatan, perlu_cek, catatan_cocok)
          VALUES
            (${kid}, ${x.b.nomor}, ${x.planId}, ${x.assetId}, ${x.unitId}, ${x.b.sn}, ${x.b.alat}, ${x.jenis},
             ${x.b.status!}, ${x.b.alasan}, ${x.b.kegiatan}, ${x.b.jumlahTes}, ${x.b.sparepart}, ${x.b.catatan},
             ${x.masalah != null}, ${x.masalah})`;
        if (x.planId) {
          await tx`UPDATE teknisi_plan_item SET reported_at = COALESCE(reported_at, now()) WHERE id = ${x.planId}`;
        }
      }
    }
    // Foto (caption report & foto sebelumnya) menempel ke kunjungan pertama (faskes `RS:`/blok pertama).
    const kunjunganId = kunjunganIds[0];
    let foto = 0;
    // Report dikirim sebagai caption foto → foto kunjungan umum.
    if (input.mediaPath) {
      const f = await tx`
        INSERT INTO teknisi_kunjungan_foto (kunjungan_id, media_path, wa_message_id)
        VALUES (${kunjunganId}, ${input.mediaPath}, ${input.waMessageId})
        ON CONFLICT DO NOTHING RETURNING id`;
      foto += f.length;
    }
    // Foto yang dikirim lebih dulu (tanpa caption hashtag) oleh pengirim yang sama.
    // Pola penjodohan #KSO/#KORAN: di grup sender_jid = jid grup, jadi kuncinya
    // grup + nama pengirim. Foto yang sudah tertaut ke kunjungan lain tak diambil.
    if (input.pengirim && input.receivedAt) {
      const f = await tx`
        INSERT INTO teknisi_kunjungan_foto (kunjungan_id, media_path, wa_message_id)
        SELECT ${kunjunganId}, w.media_path, w.message_id
        FROM wa_message w
        WHERE w.group_jid = ${input.pengirim.groupJid}
          AND coalesce(w.sender_name, '') = coalesce(${input.pengirim.senderName}, '')
          AND w.message_type ~* '^image' AND w.media_path IS NOT NULL
          AND w.received_at BETWEEN ${input.receivedAt}::timestamptz - make_interval(mins => ${FOTO_JENDELA_MENIT})
                                AND ${input.receivedAt}::timestamptz
          AND w.message_id IS DISTINCT FROM ${input.waMessageId}
          AND NOT EXISTS (SELECT 1 FROM teknisi_kunjungan_foto x WHERE x.media_path = w.media_path)
        ON CONFLICT DO NOTHING
        RETURNING id`;
      foto += f.length;
    }
    return { duplikat: false, kunjunganIds, foto };
  });

  const efek = new Map<number, string>();
  for (const kid of hasil.kunjunganIds) for (const [no, t] of await terapkanEfek(kid)) efek.set(no, t);
  // Bukti lokasi = foto report ber-geotag (OCR Geo-Tagging Camera di wa-bridge → wa_message.geo_*).
  // Foto susulan sesudah balasan ini tetap terhitung di teknisi_kerja_v (325).
  let lokasi: "ada" | "tanpa-geotag" | "tanpa-foto" = "tanpa-foto";
  if (hasil.kunjunganIds.length && hasil.foto > 0) {
    const [g] = await sql`
      SELECT bool_or(w.geo_lat IS NOT NULL AND w.geo_lon IS NOT NULL) AS ada
      FROM teknisi_kunjungan_foto f JOIN wa_message w ON w.message_id = f.wa_message_id
      WHERE f.kunjungan_id IN ${sql(hasil.kunjunganIds)}`;
    lokasi = g?.ada ? "ada" : "tanpa-geotag";
  }
  // Waktu kerja = jam report − jam #START item plan yang ditaut (alat tanpa start ditandai).
  const startPerPlan = new Map(plan.map((p) => [Number(p.id), p.started_at ? new Date(p.started_at as string) : null]));
  const selesai = input.receivedAt ? new Date(input.receivedAt) : new Date();
  // Item plan yang sudah di-report SEBELUM pesan ini (snapshot `plan` diambil sebelum UPDATE di atas).
  const sudahDilaporkan = (planId: number | null): AlatTerlapor["sudahDilaporkan"] => {
    const p = planId ? plan.find((x) => Number(x.id) === planId) : undefined;
    if (!p?.reported_at || hasil.duplikat) return null;
    const jam = new Date(new Date(p.reported_at as string).getTime() + 7 * 3600_000).toISOString().slice(11, 16);
    return { planNo: Number(p.urut), jam };
  };
  const durasi = (planId: number | null): number | null => {
    const mulai = planId ? startPerPlan.get(planId) : null;
    if (!mulai) return null;
    const m = Math.round((selesai.getTime() - mulai.getTime()) / 60000);
    return m >= 0 ? m : null;
  };
  return {
    duplikat: hasil.duplikat,
    faskes: grup[0]?.label ?? faskesLabel,
    foto: hasil.foto,
    lokasi,
    kelompok: grup.map((g) => ({ faskes: g.label, nomor: g.baris.map((x) => x.b.nomor) })),
    alat: baris.map((x) => ({
      nomor: x.b.nomor, alatLabel: x.label, sn: x.snTampil, jenis: x.jenis,
      status: x.b.status!, alasan: x.b.alasan, masalah: x.masalah, efek: efek.get(x.b.nomor) ?? null,
      durasiMenit: durasi(x.planId), tanpaStart: !(x.planId && startPerPlan.get(x.planId)),
      sudahDilaporkan: sudahDilaporkan(x.planId),
    })),
  };
}

/**
 * Foto susulan tanpa hashtag dari Teknisi → kunjungan terakhirnya dalam jendela
 * FOTO_JENDELA_MENIT. Caption `1`/`2` = nomor blok; 3+ digit/karakter = ekor SN alat
 * di kunjungan itu; selain itu (atau tak cocok) = foto kunjungan umum.
 * null = tak ada kunjungan dalam jendela (biar caller memakai jalur foto lama).
 */
export async function tempelFotoTeknisi(input: {
  teknisiId: string;
  mediaPath: string;
  caption: string | null;
  waMessageId: string | null;
  receivedAt: string;
}): Promise<{ kunjungan_id: number; nomor_blok: number | null; faskes: string | null } | null> {
  const sql = db();
  // Semua kunjungan dari pesan #REPORT terakhir dalam jendela (satu report bisa >1 faskes → >1 kunjungan).
  const ks = await sql`
    SELECT id, faskes_teks FROM teknisi_kunjungan
    WHERE teknisi_id = ${input.teknisiId}
      AND reported_at = (
        SELECT max(reported_at) FROM teknisi_kunjungan
        WHERE teknisi_id = ${input.teknisiId}
          AND reported_at BETWEEN ${input.receivedAt}::timestamptz - make_interval(mins => ${FOTO_JENDELA_MENIT})
                              AND ${input.receivedAt}::timestamptz + interval '1 minute')
    ORDER BY id`;
  if (ks.length === 0) return null;
  const alat = await sql`
    SELECT ka.id, ka.kunjungan_id, ka.nomor_blok, COALESCE(a.sn_raw, ka.sn_teks) AS sn, p.urut AS plan_urut
    FROM teknisi_kunjungan_alat ka LEFT JOIN kso_asset a ON a.id = ka.kso_asset_id
    LEFT JOIN teknisi_plan_item p ON p.id = ka.plan_item_id
    WHERE ka.kunjungan_id IN ${sql(ks.map((k) => Number(k.id)))} ORDER BY ka.nomor_blok`;
  const cap = (input.caption ?? "").replace(/<media:[^>]*>/gi, "").replace(/\[whatsapp attachment unavailable\]/gi, "").trim();
  let pilih: { id: number; nomor: number; kunjungan: number } | null = null;
  const no = cap.match(/^#?\s*(\d{1,2})\s*$/);
  if (no) {
    // Angka = nomor blok di report, atau nomor PLAN (teknisi menulis "2" untuk #REPORT 2 yang
    // hanya punya satu blok). Nomor blok didahulukan bila keduanya cocok.
    const a = alat.find((x) => Number(x.nomor_blok) === Number(no[1]) && (alat.length > 1 || x.plan_urut == null))
      ?? alat.find((x) => x.plan_urut != null && Number(x.plan_urut) === Number(no[1]))
      ?? alat.find((x) => Number(x.nomor_blok) === Number(no[1]));
    if (a) pilih = { id: Number(a.id), nomor: Number(a.nomor_blok), kunjungan: Number(a.kunjungan_id) };
  } else if (/^[A-Za-z0-9-]{3,}$/.test(cap)) {
    const ekor = normSn(cap);
    const cocok = alat.filter((x) => x.sn && normSn(x.sn).endsWith(ekor));
    if (cocok.length === 1) pilih = { id: Number(cocok[0].id), nomor: Number(cocok[0].nomor_blok), kunjungan: Number(cocok[0].kunjungan_id) };
  }
  // Tak cocok = foto kunjungan umum → kunjungan pertama dari report itu.
  const kid = pilih?.kunjungan ?? Number(ks[0].id);
  await sql`
    INSERT INTO teknisi_kunjungan_foto (kunjungan_id, kunjungan_alat_id, media_path, wa_message_id)
    VALUES (${kid}, ${pilih?.id ?? null}, ${input.mediaPath}, ${input.waMessageId})
    ON CONFLICT (kunjungan_id, media_path) DO NOTHING`;
  const fk = ks.find((k) => Number(k.id) === kid);
  return { kunjungan_id: kid, nomor_blok: pilih?.nomor ?? null, faskes: fk?.faskes_teks ?? null };
}
