import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { normalizeWa } from "./master.js";

// F45 — Pickup Pre-Visit Verification (SHIPPING). Jadwal trip Kirim-Tagih
// (kirim barang / tagih faktur / dua-duanya) + verifikasi H-1 otomatis untuk
// mencegah "rebound trip": kurir sudah jalan, ternyata customer tutup (libur
// nasional / cuti bersama / akhir pekan) atau tak tahu harus menemui siapa.
//
// Sumber dependency "F14" di board = kalender libur + backup PIC. Keduanya
// SUDAH ADA di sistem, jadi F45 tinggal memakainya:
//   - `master_holiday` (011, di-seed 069/070: 17 libur nasional + 8 cuti
//     bersama 2026) — sudah dipakai isWorkday() di scheduler.
//   - `crm_contact` (056, F62) — multi-PIC per account, `is_primary` menandai
//     yang utama; sisanya jadi kandidat BACKUP.
//
// BATAS YANG JUJUR — apa yang TIDAK bisa diverifikasi sistem:
//   `crm_contact` tak punya kolom ketersediaan (jam kerja / hari aktif / cuti
//   PIC). Jadi fitur ini TIDAK bisa bilang "PIC-nya ada di tempat besok". Yang
//   dilakukan: cek hari libur (bisa dipastikan) + sodorkan PIC utama BESERTA
//   backup-nya supaya kurir punya nomor kedua kalau yang pertama tak jawab.
//   Jangan ubah pesan WA jadi mengesankan ketersediaan PIC sudah dicek.

export type PickupTujuan = "kirim" | "tagih" | "kirim+tagih";
export type PickupStatus = "rencana" | "selesai" | "batal";

export interface PickupPlanInput {
  tanggal: string; // YYYY-MM-DD
  customer_name: string;
  account_id?: number | null; // di-resolve di form (picker), bukan fuzzy di sini
  cabang?: string | null;
  tujuan?: PickupTujuan;
  sj_number?: string | null;
  kurir_name?: string | null;
  kurir_wa_number?: string | null;
  catatan?: string | null;
  created_by?: string | null;
}

export interface PickupPlanRow {
  id: string;
  tanggal: string;
  customer_name: string;
  account_id: number | null;
  cabang: string | null;
  tujuan: PickupTujuan;
  sj_number: string | null;
  kurir_name: string | null;
  kurir_wa_number: string | null;
  status: PickupStatus;
  catatan: string | null;
  previsit_notified_at: string | null;
  previsit_catatan: string | null;
  previsit_bermasalah: boolean;
  created_by: string | null;
  created_at: string;
}

// postgres.js mem-parse kolom date/timestamptz jadi objek Date — `String(x)`
// menghasilkan bentuk verbose ("Wed Aug 05 2026 07:00:00 GMT+0700"), bukan ISO.
// Dua helper ini aman dipanggil baik x sudah Date maupun masih string.
const toIsoDate = (x: unknown): string => new Date(x as string | Date).toISOString().slice(0, 10);
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

// Guard sebelum cast `::uuid` di SQL. Tanpa ini, id ngawur (link basi/bookmark)
// bikin Postgres error 22P02 → HTTP 500 + detail tipe kolom bocor ke klien,
// padahal maksudnya 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Nomor WA disimpan ternormalisasi (62xxxx) — sama seperti `master_user.wa_number`.
// Kalau disimpan mentah, dua penulisan nomor yang sama ("628123" vs "0812-3456")
// memecah pengelompokan pesan per kurir. String kosong → null.
const waOrNull = (raw: string | null | undefined): string | null => {
  const n = normalizeWa((raw ?? "").trim());
  return n ? n : null;
};

function mapRow(r: Record<string, unknown>): PickupPlanRow {
  return {
    id: String(r.id),
    tanggal: toIsoDate(r.tanggal),
    customer_name: String(r.customer_name),
    account_id: r.account_id == null ? null : Number(r.account_id),
    cabang: r.cabang == null ? null : String(r.cabang),
    tujuan: String(r.tujuan) as PickupTujuan,
    sj_number: r.sj_number == null ? null : String(r.sj_number),
    kurir_name: r.kurir_name == null ? null : String(r.kurir_name),
    kurir_wa_number: r.kurir_wa_number == null ? null : String(r.kurir_wa_number),
    status: String(r.status) as PickupStatus,
    catatan: r.catatan == null ? null : String(r.catatan),
    previsit_notified_at: r.previsit_notified_at == null ? null : toIsoTs(r.previsit_notified_at),
    previsit_catatan: r.previsit_catatan == null ? null : String(r.previsit_catatan),
    previsit_bermasalah: Boolean(r.previsit_bermasalah),
    created_by: r.created_by == null ? null : String(r.created_by),
    created_at: toIsoTs(r.created_at),
  };
}

export async function listPickupPlans(opts: {
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<PickupPlanRow[]> {
  const sql = db();
  // `|| 200` (bukan `?? 200`) supaya NaN dari `Number("abc")` ikut tertangkap —
  // idiom sama endpoint lain di index.ts. Tanpa ini `LIMIT NaN` → 500.
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
  const rows = await sql`
    SELECT * FROM pickup_plan
    WHERE (${opts.status ?? null}::text IS NULL OR status = ${opts.status ?? null})
      AND (${opts.from ?? null}::date IS NULL OR tanggal >= ${opts.from ?? null}::date)
      AND (${opts.to ?? null}::date IS NULL OR tanggal <= ${opts.to ?? null}::date)
    ORDER BY tanggal DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function createPickupPlan(input: PickupPlanInput): Promise<PickupPlanRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO pickup_plan
      (tanggal, customer_name, account_id, cabang, tujuan, sj_number,
       kurir_name, kurir_wa_number, catatan, created_by)
    VALUES
      (${input.tanggal}::date, ${input.customer_name}, ${input.account_id ?? null},
       ${input.cabang ?? null}, ${input.tujuan ?? "kirim"}, ${input.sj_number ?? null},
       ${input.kurir_name ?? null}, ${waOrNull(input.kurir_wa_number)},
       ${input.catatan ?? null}, ${input.created_by ?? null})
    RETURNING *
  `;
  return mapRow(rows[0]);
}

// Ubah status (selesai/batal) atau perbaiki isi plan. Kalau `tanggal` digeser,
// hasil verifikasi lama tidak berlaku lagi → reset penanda notif supaya cron
// memverifikasi ulang untuk tanggal baru (pola sama F50: `stnk_alert_sent_at`
// di-reset saat `stnk_expiry` diperbarui).
export async function updatePickupPlan(
  id: string,
  patch: { status?: PickupStatus; tanggal?: string; catatan?: string | null; kurir_wa_number?: string | null },
): Promise<PickupPlanRow | null> {
  const sql = db();
  if (!UUID_RE.test(id)) return null;
  // Normalisasi dulu — kalau klien mengirim string kosong/spasi, hasilnya null
  // (kolom benar-benar dikosongkan) bukan " " yang lolos cek falsy di UI.
  const waPatch = patch.kurir_wa_number === undefined ? null : waOrNull(patch.kurir_wa_number);
  const rows = await sql`
    UPDATE pickup_plan SET
      status          = COALESCE(${patch.status ?? null}, status),
      tanggal         = COALESCE(${patch.tanggal ?? null}::date, tanggal),
      catatan         = CASE WHEN ${patch.catatan ?? null}::text IS NOT NULL THEN ${patch.catatan ?? null} ELSE catatan END,
      kurir_wa_number = CASE WHEN ${patch.kurir_wa_number === undefined ? false : true} THEN ${waPatch} ELSE kurir_wa_number END,
      previsit_notified_at = CASE WHEN ${patch.tanggal ?? null}::date IS NOT NULL THEN NULL ELSE previsit_notified_at END,
      previsit_catatan     = CASE WHEN ${patch.tanggal ?? null}::date IS NOT NULL THEN NULL ELSE previsit_catatan END,
      previsit_bermasalah  = CASE WHEN ${patch.tanggal ?? null}::date IS NOT NULL THEN false ELSE previsit_bermasalah END,
      updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function deletePickupPlan(id: string): Promise<boolean> {
  const sql = db();
  if (!UUID_RE.test(id)) return false;
  const rows = await sql`DELETE FROM pickup_plan WHERE id = ${id}::uuid RETURNING id`;
  return rows.length > 0;
}

export interface PicKontak {
  nama: string;
  jabatan: string | null;
  hp_wa: string | null;
  is_primary: boolean;
}

// PIC utama + backup untuk satu account. Urutan sama dgn repo/account.ts:
// is_primary dulu, lalu seq, lalu id — jadi elemen [0] = PIC utama dan
// sisanya kandidat backup. account_id NULL → array kosong (tidak menebak).
async function kontakAccount(accountId: number | null): Promise<PicKontak[]> {
  if (accountId == null) return [];
  const sql = db();
  const rows = await sql`
    SELECT nama, jabatan, hp_wa, is_primary
    FROM crm_contact
    WHERE account_id = ${accountId}
    ORDER BY is_primary DESC, seq, id
  `;
  return rows.map((r) => ({
    nama: String(r.nama),
    jabatan: r.jabatan == null ? null : String(r.jabatan),
    hp_wa: r.hp_wa == null ? null : String(r.hp_wa),
    is_primary: Boolean(r.is_primary),
  }));
}

export interface PreVisitTemuan {
  plan_id: string;
  customer_name: string;
  tanggal: string;
  tujuan: PickupTujuan;
  libur: string | null; // keterangan hari libur, null kalau bukan libur
  akhir_pekan: boolean;
  kalender_ada: boolean; // false = kalender libur tahun itu belum diisi
  pic_utama: PicKontak | null;
  pic_backup: PicKontak[];
  bermasalah: boolean;
  catatan: string;
}

// Kondisi kalender untuk SATU tanggal — dihitung sekali lalu dipakai ulang
// untuk semua plan bertanggal sama (satu run cron selalu satu tanggal).
interface KondisiTanggal {
  libur: string | null;
  akhir_pekan: boolean;
  // FALSE = `master_holiday` belum punya baris apa pun untuk tahun itu, jadi
  // "tidak ada libur" TIDAK boleh dilaporkan sebagai "aman" — kita memang tak
  // punya kalendernya. Seed resmi baru mencakup 2026 (migrasi 069 + 070).
  kalender_ada: boolean;
}

async function kondisiTanggal(tanggal: string): Promise<KondisiTanggal> {
  const sql = db();
  const [libur] = await sql`
    SELECT keterangan FROM master_holiday WHERE tanggal = ${tanggal}::date
  `;
  const [cov] = await sql`
    SELECT count(*)::int AS n FROM master_holiday
    WHERE tanggal >= date_trunc('year', ${tanggal}::date)
      AND tanggal <  date_trunc('year', ${tanggal}::date) + interval '1 year'
  `;
  // DOW dihitung di JS — tanggal sudah berbentuk YYYY-MM-DD, tak perlu
  // round-trip ke DB. getUTCDay() aman karena string ISO diparse sbg UTC.
  const dow = new Date(`${tanggal}T00:00:00Z`).getUTCDay();
  return {
    libur: libur ? String(libur.keterangan) : null,
    akhir_pekan: dow === 0 || dow === 6,
    kalender_ada: Number(cov.n) > 0,
  };
}

// Verifikasi satu plan: apa saja yang perlu diketahui kurir sebelum berangkat.
// Sengaja TIDAK melakukan fuzzy-match nama customer → account: kalau
// `account_id` kosong, PIC dilaporkan "belum ditautkan" (bukan ditebak) —
// lihat peringatan di migrasi 068 soal faskes bernama sama persis.
async function verifikasi(plan: PickupPlanRow, kondisi: KondisiTanggal): Promise<PreVisitTemuan> {
  const kontak = await kontakAccount(plan.account_id);

  const alasan: string[] = [];
  if (kondisi.libur) alasan.push(`hari libur: ${kondisi.libur}`);
  if (kondisi.akhir_pekan) alasan.push("jatuh di akhir pekan");
  if (!kondisi.kalender_ada) {
    alasan.push(`kalender libur ${plan.tanggal.slice(0, 4)} belum diisi → cek manual`);
  }
  if (plan.account_id == null) alasan.push("customer belum ditautkan ke akun → PIC tak bisa dicek");
  else if (kontak.length === 0) alasan.push("akun belum punya kontak PIC");

  return {
    plan_id: plan.id,
    customer_name: plan.customer_name,
    tanggal: plan.tanggal,
    tujuan: plan.tujuan,
    libur: kondisi.libur,
    akhir_pekan: kondisi.akhir_pekan,
    kalender_ada: kondisi.kalender_ada,
    pic_utama: kontak[0] ?? null,
    pic_backup: kontak.slice(1),
    bermasalah: alasan.length > 0,
    catatan: alasan.length ? alasan.join("; ") : "aman — hari kerja, PIC tersedia di data",
  };
}

function buildMessage(temuan: PreVisitTemuan[]): string {
  const tanggal = temuan[0]?.tanggal ?? "";
  const lines = [`🚚 *Cek sebelum jalan besok (${tanggal})*`];
  for (const t of temuan) {
    lines.push("", `*${t.customer_name}* — ${t.tujuan}`);
    if (t.libur) lines.push(`⚠️ LIBUR: ${t.libur} — kemungkinan tutup, konfirmasi dulu`);
    if (t.akhir_pekan) lines.push("⚠️ Akhir pekan — pastikan ada yang menerima");
    if (!t.kalender_ada) {
      lines.push(`⚠️ Kalender libur ${t.tanggal.slice(0, 4)} belum diisi di sistem — cek manual`);
    }
    if (t.pic_utama) {
      const j = t.pic_utama.jabatan ? ` (${t.pic_utama.jabatan})` : "";
      lines.push(`👤 PIC: ${t.pic_utama.nama}${j}${t.pic_utama.hp_wa ? ` — ${t.pic_utama.hp_wa}` : ""}`);
      for (const b of t.pic_backup) {
        const bj = b.jabatan ? ` (${b.jabatan})` : "";
        lines.push(`↳ backup: ${b.nama}${bj}${b.hp_wa ? ` — ${b.hp_wa}` : ""}`);
      }
    } else {
      lines.push("👤 PIC: belum ada di data — cari kontaknya dulu sebelum berangkat");
    }
  }
  lines.push("", "_Ketersediaan PIC tidak dicek sistem — hanya hari libur. Tetap konfirmasi via telepon._");
  return lines.join("\n");
}

// Besok menurut WIB (UTC+7) — pola sama `wibDate()` di scheduler.ts. WAJIB
// dihitung di JS, JANGAN pakai `current_date + 1` di SQL: container Postgres
// ber-timezone Etc/UTC, jadi `current_date` adalah tanggal UTC. Dengan cron
// default 16:00 WIB (=09:00 UTC) keduanya kebetulan sama, TAPI kalau
// PREVISIT_CHECK_CRON digeser ke pagi (mis. 06:00 WIB = 23:00 UTC hari
// sebelumnya) `current_date + 1` akan menunjuk HARI INI menurut WIB — salah
// tanggal tanpa error apa pun.
const besokWib = (): string =>
  new Date(Date.now() + 7 * 3600 * 1000 + 86_400_000).toISOString().slice(0, 10);

// Cron H-1: verifikasi semua trip yang direncanakan BESOK dan belum diberi
// tahu. Mengikuti pola am_reminder mode h-minus-1 (repo/reminder.ts getDue),
// tapi tanggalnya dihitung di JS berbasis WIB — bukan `current_date + 1` SQL
// (lihat komentar besokWib di atas).
//
// Pengiriman WA dikelompokkan PER KURIR: kunci grup = nomor kurir yang sudah
// DINORMALISASI (normalizeWa) — kalau pakai string mentah, "628123" dan
// "0812-3456" milik orang yang SAMA jadi 2 grup → kurir dapat 2 pesan yang
// masing-masing cuma memuat sebagian stop, membatalkan tujuan "1 pesan per
// kurir". Plan tanpa nomor masuk grup fallback env PREVISIT_WA_TARGET; kalau
// env itu juga kosong → TIDAK dikirim & tidak ditandai (pola anti-broadcast
// F24/F50 — jangan pernah fallback diam-diam ke grup besar).
export async function runPreVisitCheck(opts: { to?: string; tanggal?: string } = {}): Promise<{
  tanggal: string;
  count: number;
  notified_ids: string[];
  bermasalah: number;
  // `message` ikut dikembalikan (pola sama runReminders) supaya trigger manual
  // POST /pickup-plan/previsit/run bisa dipakai memeriksa isi pesan tanpa
  // menunggu WA benar-benar terkirim.
  batches: { to: string; count: number; message: string; gateway: WaSendResult | null; skipped?: string }[];
}> {
  const sql = db();
  // `tanggal` bisa dioverride untuk test/recovery (mis. cron mati semalam).
  const tanggalTarget = opts.tanggal ?? besokWib();
  const rows = await sql`
    SELECT * FROM pickup_plan
    WHERE tanggal = ${tanggalTarget}::date
      AND status = 'rencana'
      AND previsit_notified_at IS NULL
    ORDER BY kurir_wa_number NULLS LAST, customer_name
  `;
  const plans = rows.map(mapRow);
  if (plans.length === 0) {
    return { tanggal: tanggalTarget, count: 0, notified_ids: [], bermasalah: 0, batches: [] };
  }

  // Kondisi kalender dihitung SEKALI untuk tanggal target (semua plan di satu
  // run pasti bertanggal sama) — bukan per plan.
  const kondisi = await kondisiTanggal(tanggalTarget);

  // Verifikasi dulu semuanya, lalu simpan hasilnya — hasil tetap tercatat di DB
  // walau WA gagal terkirim (biar tetap terlihat di UI).
  const temuanPerPlan = new Map<string, PreVisitTemuan>();
  for (const p of plans) temuanPerPlan.set(p.id, await verifikasi(p, kondisi));

  // Satu UPDATE untuk semua baris (bukan N query). Pakai jsonb_to_recordset,
  // BUKAN `unnest(...::boolean[])`: postgres.js salah menyimpulkan tipe untuk
  // array boolean → "cannot cast type boolean to boolean[]".
  const payload = [...temuanPerPlan.entries()].map(([id, t]) => ({
    id,
    catatan: t.catatan,
    bermasalah: t.bermasalah,
  }));
  await sql`
    UPDATE pickup_plan p SET
      previsit_catatan = v.catatan,
      previsit_bermasalah = v.bermasalah,
      updated_at = now()
    FROM jsonb_to_recordset(${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
      AS v(id uuid, catatan text, bermasalah boolean)
    WHERE p.id = v.id
  `;

  const fallback = normalizeWa((opts.to || process.env.PREVISIT_WA_TARGET || "").trim());
  const groups = new Map<string, PickupPlanRow[]>();
  for (const p of plans) {
    // normalizeWa() supaya varian penulisan nomor yang sama tidak memecah grup.
    const key = normalizeWa((p.kurir_wa_number ?? "").trim()) || fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const notified: string[] = [];
  const batches: { to: string; count: number; message: string; gateway: WaSendResult | null; skipped?: string }[] = [];

  for (const [waTarget, grup] of groups) {
    const message = buildMessage(grup.map((p) => temuanPerPlan.get(p.id)!));
    if (!waTarget) {
      // Tak ada tujuan jelas → skip, JANGAN broadcast ke grup mana pun.
      batches.push({ to: "", count: grup.length, message, gateway: null, skipped: "no-target" });
      continue;
    }
    const gateway = await sendViaWaGateway(waTarget, message);
    batches.push({ to: waTarget, count: grup.length, message, gateway });
    // gateway.sent juga true di mode stub & dry-run (lihat wasend.ts) — tanpa
    // gerbang ini, plan ditandai ter-notifikasi walau WA tak pernah benar-benar
    // dikirim. gagal kirim (atau stub/dry-run) → jangan tandai, cron besok retry.
    if (!gateway.sent || gateway.stub || gateway.dryRun) continue;

    const grupIds = grup.map((p) => p.id);
    await sql`
      UPDATE pickup_plan SET previsit_notified_at = now(), updated_at = now()
      WHERE id = ANY(${grupIds}::uuid[])
    `;
    notified.push(...grupIds);
  }

  return {
    tanggal: tanggalTarget,
    count: plans.length,
    notified_ids: notified,
    bermasalah: [...temuanPerPlan.values()].filter((t) => t.bermasalah).length,
    batches,
  };
}

// Dipakai UI: pratinjau verifikasi satu plan tanpa mengirim WA & tanpa
// menandai apa pun (tombol "cek sekarang" di halaman jadwal).
export async function previewPreVisit(id: string): Promise<PreVisitTemuan | null> {
  const sql = db();
  if (!UUID_RE.test(id)) return null; // id ngawur → 404, bukan 500 dari cast ::uuid
  const rows = await sql`SELECT * FROM pickup_plan WHERE id = ${id}::uuid`;
  if (!rows.length) return null;
  const plan = mapRow(rows[0]);
  return verifikasi(plan, await kondisiTanggal(plan.tanggal));
}
