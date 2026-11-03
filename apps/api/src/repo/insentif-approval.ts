// F67 — rantai persetujuan insentif (migrasi 093 + 183, mesin F11 sejak 270).
//
// Model `wrg_incentive_console_v2.jsx` §VI: 7 langkah dengan segregation of duties,
// "setiap step harus di-action dari akun email/user berbeda — tidak boleh 1 orang
// pencet advance untuk 2+ step berturut-turut".
//
// Sejak migrasi 270 (#1863) langkah PERSETUJUAN (2 HoD wilayah AM · 3 Finance ·
// 4 Corsec · 5 Direktur) diputus mesin approval F11 — WA #APPROVE, halaman
// /approval-requests, SLA — dengan urutan = nomor step. Yang tetap di sini:
//   • 1 Ajukan  = AM membuka approval_request (atau superuser atas nama AM).
//   • 6 Bayar   = HRD menandai dibayar; tindakan, bukan persetujuan.
//   • Buka kembali rekap yang ditolak = putaran (siklus) baru, request baru.
// insentif_bulanan.status tetap bergerak per tahap lewat kait konsumen
// (setiapTahap) — kunci lead/effort/compute membacanya.
//
// Satu akun satu langkah ditegakkan di DUA lapis:
//   1. Mesin — alur 'insentif' ber-satu_orang_satu_tahap (per request = per siklus).
//   2. Basis data — unique (bulanan_id, siklus, actor_user_id) di insentif_approval_log,
//      yang tetap ditulis tiap langkah; ini yang menjaga langkah Bayar.
//
// Grup langkah 3–5 ada di approval_chain_config jenis 'insentif' (disalin dari
// insentif_approval_step oleh 270); grup langkah Bayar tetap di insentif_approval_step.

import type { TransactionSql } from "postgres";

import { db } from "../db.js";
import { effectivePermissions } from "./rbac.js";
import { resolveAkses } from "./insentif.js";
import type { DataScope } from "./access-scope.js";
import {
  buatRequestDalamTx,
  daftarKonsumen,
  decideFromDashboard,
  getApprovalRequest,
  notifyCurrentStep,
  TolakKonsumen,
  type HasilApproval,
  type NotifyResult,
  type TahapMaju,
} from "./approval.js";

type Tx = TransactionSql<Record<string, unknown>>;

export const JENIS_INSENTIF = "insentif";
const REF_TABEL = "insentif_bulanan";
/** Step yang diputus mesin F11 (urutan approval = nomor step). */
const STEP_MESIN_DARI = 2;
const STEP_MESIN_SAMPAI = 5;
const STEP_BAYAR = 6;
const diMesin = (step: number) => step >= STEP_MESIN_DARI && step <= STEP_MESIN_SAMPAI;

export interface LangkahApproval {
  step: number;
  status_dari: string;
  status_ke: string;
  label: string;
  group_key: string | null;
  keterangan: string | null;
}

export interface JejakApproval {
  step: number;
  siklus: number;
  status_to: string;
  actor_user_id: string;
  actor_nama: string | null;
  actor_role: string;
  catatan: string | null;
  acted_at: string;
}

export interface StatusApproval {
  am_id: string;
  periode: string;
  status: string;
  siklus: number;
  /** Langkah yang akan dijalankan kalau status maju. null = sudah 'paid' atau 'rejected'. */
  berikutnya: LangkahApproval | null;
  boleh_maju: boolean;
  boleh_tolak: boolean;
  boleh_buka: boolean;
  /** Kenapa tombolnya mati. Diisi walau boleh_* true supaya UI bisa menampilkan konteks. */
  alasan: string | null;
  riwayat: JejakApproval[];
  /** Approval F11 putaran ini (langkah 2–5). null = belum diajukan / di luar mesin. */
  approval: { id: string; kode: string; status: string; urutan: number | null } | null;
}

/** Grup yang boleh membuka kembali rekap yang ditolak. Superuser selalu boleh. */
const GRUP_BUKA_KEMBALI = ["sales-hod"];

interface Rekap {
  id: string;
  status: string;
  siklus: number;
  approval_request_id: string | null;
}

async function ambilRekap(amId: string, periode: string): Promise<Rekap | null> {
  const sql = db();
  const [r] = await sql<Rekap[]>`
    SELECT id::text, status, siklus, approval_request_id::text FROM insentif_bulanan
    WHERE am_id = ${amId} AND periode = ${periode}`;
  return r ?? null;
}

/**
 * HoD wilayah AM = pemutus langkah 2: cabang master_user → hod_territory.
 * null bila cabang kosong atau dipegang lebih dari satu HoD — pengajuan ditolak
 * dengan pesan yang bisa diperbaiki admin, bukan dialihkan diam-diam (Direktur
 * sudah memegang langkah 5, dan satu orang hanya boleh memutus satu tahap).
 */
async function hodWilayahAm(tx: Tx, amId: string): Promise<{ hodKey: string | null; cabang: string | null; nama: string | null }> {
  const [m] = await tx`SELECT nama, NULLIF(btrim(cabang), '') AS cabang FROM master_user WHERE am_id = ${amId}`;
  const cabang = m?.cabang ? String(m.cabang) : null;
  const nama = m?.nama ? String(m.nama) : null;
  if (!cabang) return { hodKey: null, cabang, nama };
  const h = await tx`SELECT DISTINCT hod_key FROM hod_territory WHERE upper(btrim(cabang)) = upper(${cabang})`;
  return { hodKey: h.length === 1 ? String(h[0].hod_key) : null, cabang, nama };
}

async function langkahDari(status: string): Promise<LangkahApproval | null> {
  const sql = db();
  const [l] = await sql<LangkahApproval[]>`
    SELECT step, status_dari, status_ke, label, group_key, keterangan
    FROM insentif_approval_step WHERE status_dari = ${status}`;
  return l ?? null;
}

async function grupUser(userId: string): Promise<{ keys: string[]; superuser: boolean }> {
  try {
    const eff = await effectivePermissions(userId);
    return { keys: eff.groups.map((g) => g.key), superuser: eff.superuser };
  } catch {
    // RBAC/DB belum siap → anggap tanpa grup. Fail-closed: lebih baik tombolnya mati
    // daripada seseorang menyetujui pembayaran karena tabel izin sedang tak terbaca.
    return { keys: [], superuser: false };
  }
}

/**
 * Apakah user ini berwenang menjalankan `langkah` untuk rekap milik `amId`.
 *
 * Dipakai untuk langkah DI LUAR mesin F11: Ajukan (1) dan Bayar (6).
 *
 * Dua aturan yang tak boleh dilonggarkan:
 *   • Langkah tanpa group_key (pengajuan) milik AM-nya sendiri. Orang lain mengajukan
 *     atas nama AM = menandatangani berkasnya.
 *   • Langkah SELAIN pengajuan tertutup untuk AM yang bersangkutan, walau kebetulan dia
 *     anggota grup yang berwenang (mis. AM yang juga HoD). Inti segregation of duties:
 *     yang mengajukan tidak boleh ikut menyetujui.
 *
 * Diekspor supaya bisa diuji tanpa DB — ini fungsi yang memutuskan siapa boleh
 * menandatangani pembayaran, jadi ia pantas punya tes sendiri.
 */
export function berwenang(
  langkah: LangkahApproval,
  opts: { selfAmId: string | null; amId: string; grup: string[]; superuser: boolean },
): { ok: boolean; alasan: string | null } {
  const dirinya = opts.selfAmId != null && opts.selfAmId === opts.amId;

  if (langkah.group_key == null) {
    if (dirinya || opts.superuser) return { ok: true, alasan: null };
    return { ok: false, alasan: "Pengajuan hanya bisa dilakukan AM yang bersangkutan." };
  }

  if (dirinya) {
    return { ok: false, alasan: "Tidak boleh menyetujui insentif sendiri." };
  }
  // Tanpa jalan pintas superuser (keputusan pemilik 3 Nov 2026, sama dengan konsumen
  // F11 lain): yang menandatangani harus anggota grupnya. Admin mengatur anggota grup.
  if (opts.grup.includes(langkah.group_key)) return { ok: true, alasan: null };
  return { ok: false, alasan: `Langkah ini milik grup "${langkah.group_key}".` };
}

/** Apakah user sudah pernah bertindak di siklus ini (pagar satu akun satu langkah). */
async function sudahBertindak(bulananId: string, siklus: number, userId: string): Promise<boolean> {
  const sql = db();
  const [r] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM insentif_approval_log
    WHERE bulanan_id = ${bulananId}::bigint AND siklus = ${siklus}
      AND actor_user_id = ${userId} AND status_to <> 'draft'`;
  return (r?.n ?? 0) > 0;
}

/** Status + riwayat rantai persetujuan satu rekap. Scope-nya sama dengan baca rincian. */
export async function getApproval(
  scope: DataScope | undefined,
  amId: string,
  periode: string,
): Promise<StatusApproval> {
  const akses = await resolveAkses(scope);
  const boleh = akses.ams === "all" || akses.ams.includes(amId);
  // 404, bukan 403 — sama alasannya dengan getInsentifDetail (§E.2.5).
  if (!boleh) throw Object.assign(new Error("not found"), { status: 404 });

  const rekap = await ambilRekap(amId, periode);
  if (!rekap) throw Object.assign(new Error("not found"), { status: 404 });

  const sql = db();
  const riwayat = await sql<JejakApproval[]>`
    SELECT l.step, l.siklus, l.status_to, l.actor_user_id, u.name AS actor_nama,
           l.actor_role, l.catatan, l.acted_at::text AS acted_at
    FROM insentif_approval_log l
    LEFT JOIN app_user u ON u.id::text = l.actor_user_id
    WHERE l.bulanan_id = ${rekap.id}::bigint
    ORDER BY l.acted_at`;

  const berikutnya = await langkahDari(rekap.status);
  const grup = akses.userId ? await grupUser(akses.userId) : { keys: [], superuser: false };
  const detail = rekap.approval_request_id
    ? await getApprovalRequest(rekap.approval_request_id, { viewerUserId: akses.userId })
    : null;
  const approval = detail
    ? { id: detail.id, kode: detail.kode, status: detail.status, urutan: detail.currentUrutan }
    : null;

  let bolehMaju = false;
  let alasan: string | null = null;

  if (rekap.status === "paid") {
    alasan = "Sudah dibayar.";
  } else if (rekap.status === "rejected") {
    alasan = "Ditolak — buka kembali untuk memulai putaran baru.";
  } else if (!berikutnya) {
    alasan = `Tidak ada langkah lanjutan untuk status '${rekap.status}'.`;
  } else if (!akses.userId) {
    alasan = "Identitas tidak dikenal.";
  } else if (diMesin(berikutnya.step)) {
    // Wewenang langkah 2–5 = aturan mesin F11 (sama persis dengan #APPROVE di WA).
    if (!detail || detail.status !== "pending") {
      alasan = "Approval rekap ini belum tercatat di mesin persetujuan — hubungi admin.";
    } else if (detail.currentUrutan !== berikutnya.step) {
      alasan = `Status rekap dan approval ${detail.kode} tidak sejalan — hubungi admin.`;
    } else if (detail.wewenang?.boleh) {
      bolehMaju = true;
    } else {
      alasan = detail.wewenang?.alasan ?? "Bukan giliran Anda.";
    }
  } else {
    const w = berwenang(berikutnya, {
      selfAmId: akses.selfAmId, amId, grup: grup.keys, superuser: grup.superuser,
    });
    if (!w.ok) {
      alasan = w.alasan;
    } else if (await sudahBertindak(rekap.id, rekap.siklus, akses.userId)) {
      alasan = "Anda sudah menandatangani satu langkah di putaran ini — langkah berikutnya milik akun lain.";
    } else {
      bolehMaju = true;
    }
  }

  return {
    am_id: amId,
    periode,
    status: rekap.status,
    siklus: rekap.siklus,
    berikutnya,
    boleh_maju: bolehMaju,
    // Menolak hanya di langkah persetujuan (2–5). Ajukan tak bisa "ditolak" AM-nya
    // sendiri, dan Bayar adalah tindakan — keberatan diajukan sebelum Direktur setuju.
    boleh_tolak: bolehMaju && berikutnya != null && diMesin(berikutnya.step),
    boleh_buka:
      rekap.status === "rejected" &&
      (grup.superuser || grup.keys.some((k) => GRUP_BUKA_KEMBALI.includes(k))),
    alasan,
    riwayat,
    approval,
  };
}

export type AksiApproval = "maju" | "tolak" | "buka";

export interface ActApprovalArgs {
  amId: string;
  periode: string;
  aksi: AksiApproval;
  catatan?: string | null;
  /** Step yang dilihat pemutus di layar — penjaga klik basi. */
  step?: number | null;
}

const galat = (pesan: string, status: number) => Object.assign(new Error(pesan), { status });

/**
 * Jalankan satu aksi rantai persetujuan.
 *
 * Perubahan status dan penulisan jejak terjadi dalam SATU transaksi: status yang maju
 * tanpa jejak berarti pembayaran tanpa tanda tangan, dan jejak tanpa status berarti
 * orang merasa sudah menyetujui padahal berkasnya tak bergerak. Untuk langkah 2–5,
 * transaksinya milik mesin F11 dan status bergerak lewat penangan konsumen di bawah.
 */
export async function actApproval(scope: DataScope | undefined, args: ActApprovalArgs) {
  const akses = await resolveAkses(scope);
  const boleh = akses.ams === "all" || akses.ams.includes(args.amId);
  if (!boleh) throw galat("not found", 404);
  if (!akses.userId) throw galat("forbidden", 403);
  const userId = akses.userId;

  const rekap = await ambilRekap(args.amId, args.periode);
  if (!rekap) throw galat("not found", 404);

  const grup = await grupUser(userId);
  const peran = grup.superuser ? "superuser" : akses.level;
  const sql = db();

  // ── Buka kembali rekap yang ditolak: putaran baru, jejak lama tetap utuh.
  if (args.aksi === "buka") {
    if (rekap.status !== "rejected") {
      throw galat("hanya rekap yang ditolak yang bisa dibuka kembali", 409);
    }
    if (!grup.superuser && !grup.keys.some((k) => GRUP_BUKA_KEMBALI.includes(k))) {
      throw galat("forbidden", 403);
    }
    const siklusBaru = rekap.siklus + 1;
    const n = await sql.begin(async (tx) => {
      const r = await tx`
        UPDATE insentif_bulanan SET status = 'draft', siklus = ${siklusBaru}
        WHERE id = ${rekap.id}::bigint AND status = 'rejected' AND siklus = ${rekap.siklus}`;
      if (r.count === 0) return 0;
      await tx`
        INSERT INTO insentif_approval_log
          (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
        VALUES (${rekap.id}::bigint, 1, ${rekap.siklus}, 'draft', ${userId}, ${peran}, ${args.catatan ?? null})`;
      return r.count;
    });
    if (n === 0) throw galat("rekap sudah berubah — muat ulang", 409);
    return { ok: true as const, status: "draft", siklus: siklusBaru };
  }

  const langkah = await langkahDari(rekap.status);
  if (!langkah) throw galat(`status '${rekap.status}' tidak punya langkah lanjutan`, 409);
  if (args.step != null && Number(args.step) !== langkah.step) {
    throw galat(`langkah sudah berubah (sekarang langkah ${langkah.step}) — muat ulang lalu putuskan lagi`, 409);
  }

  // ── Langkah 2–5: diputus mesin F11. Wewenang, satu-orang-satu-tahap, alasan
  // tolak wajib, dan perpindahan status semuanya di sana + penangan konsumen.
  if (diMesin(langkah.step)) {
    if (!rekap.approval_request_id) throw galat("approval rekap ini belum tercatat di mesin persetujuan — hubungi admin", 409);
    const r = await decideFromDashboard(
      rekap.approval_request_id,
      args.aksi === "tolak" ? "reject" : "approve",
      userId,
      args.catatan ?? null,
      undefined,
      { expectedUrutan: langkah.step },
    );
    if (!r.ok) throw galat(r.error ?? "gagal memutus", 409);
    const sesudah = await ambilRekap(args.amId, args.periode);
    return {
      ok: true as const, status: sesudah?.status ?? rekap.status, siklus: rekap.siklus, step: langkah.step,
      kode: r.kode, notify: r.nextNotify ?? null,
    };
  }

  // ── Langkah 1 (Ajukan) & 6 (Bayar): di luar mesin.
  const w = berwenang(langkah, {
    selfAmId: akses.selfAmId, amId: args.amId, grup: grup.keys, superuser: grup.superuser,
  });
  if (!w.ok) throw galat(w.alasan ?? "forbidden", 403);
  if (args.aksi === "tolak") {
    throw galat(
      langkah.step === STEP_BAYAR
        ? "langkah Bayar tidak bisa ditolak — rekap sudah disetujui Direktur"
        : "langkah pengajuan tidak bisa ditolak",
      409,
    );
  }

  // Dicek di aplikasi supaya pesannya bisa dibaca; unique index di 183 tetap yang
  // menjadi pagar terakhir kalau ada jalur lain yang lupa memeriksa.
  if (await sudahBertindak(rekap.id, rekap.siklus, userId)) {
    throw galat("Anda sudah menandatangani satu langkah di putaran ini — langkah berikutnya harus akun lain.", 409);
  }

  let approvalBaru: { id: string; kode: string } | null = null;
  try {
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Tx;
      const [kunci] = await tx`
        SELECT status, siklus FROM insentif_bulanan WHERE id = ${rekap.id}::bigint FOR UPDATE`;
      if (!kunci || kunci.status !== langkah.status_dari || Number(kunci.siklus) !== rekap.siklus) {
        throw galat("rekap sudah berubah — muat ulang", 409);
      }

      if (langkah.step === 1) {
        const hod = await hodWilayahAm(tx, args.amId);
        if (!hod.hodKey) {
          throw galat(
            hod.cabang
              ? `HoD wilayah untuk cabang ${hod.cabang} belum terpetakan (atau lebih dari satu) — admin perlu membereskan pemetaan HoD↔cabang dulu.`
              : "Cabang AM ini kosong di data karyawan — HoD wilayahnya tak bisa ditentukan.",
            409,
          );
        }
        // Pengaju = akun AM-nya, walau yang menekan superuser: mesin menolak pengaju
        // memutus permintaannya sendiri, dan itu harus berlaku untuk AM, bukan admin.
        const [u] = await tx`SELECT id FROM app_user WHERE am_id = ${args.amId} AND active ORDER BY created_at LIMIT 1`;
        const made = await buatRequestDalamTx(tx, {
          jenis: JENIS_INSENTIF,
          title: `Insentif ${args.periode} — ${hod.nama ?? args.amId}`.slice(0, 200),
          requestedBy: hod.nama ?? args.amId,
          requestedByUserId: u ? String(u.id) : null,
          hodPengaju: hod.hodKey,
          refTabel: REF_TABEL,
          refId: rekap.id,
        });
        if (!made.ok) throw galat(`gagal membuka approval: ${made.error}`, 409);
        approvalBaru = { id: made.id, kode: made.kode };
        await tx`
          UPDATE insentif_bulanan SET status = ${langkah.status_ke}, approval_request_id = ${made.id}
          WHERE id = ${rekap.id}::bigint`;
      } else {
        await tx`UPDATE insentif_bulanan SET status = ${langkah.status_ke} WHERE id = ${rekap.id}::bigint`;
      }
      await tx`
        INSERT INTO insentif_approval_log
          (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
        VALUES (${rekap.id}::bigint, ${langkah.step}, ${rekap.siklus}, ${langkah.status_ke},
                ${userId}, ${peran}, ${args.catatan ?? null})`;
    });
  } catch (e) {
    // 23505 = unique violation → dua tab/dua klik dari akun yang sama.
    if ((e as { code?: string }).code === "23505") {
      throw galat("Akun ini sudah menandatangani satu langkah di putaran ini.", 409);
    }
    throw e;
  }

  // WA ke HoD wilayah SESUDAH commit — pengajuan yang batal tak boleh terkirim.
  let notify: NotifyResult | null = null;
  const baru = approvalBaru as { id: string; kode: string } | null;
  if (baru) notify = await notifyCurrentStep(baru.id);

  return {
    ok: true as const, status: langkah.status_ke, siklus: rekap.siklus, step: langkah.step,
    kode: baru?.kode ?? null, notify,
  };
}

// ── Konsumen mesin F11 ─────────────────────────────────────────────
//
// Dipanggil DI DALAM transaksi keputusan mesin (WA #APPROVE, /approval-requests,
// atau kartu Insentif). Setiap perpindahan status dijaga: baris harus masih
// menunjuk request yang sama DAN masih di status asal langkahnya. Kalau tidak,
// keputusannya dibatalkan (TolakKonsumen) — lebih baik pemutus diminta muat ulang
// daripada status rekap dan approval berselisih.

async function catatLangkah(
  tx: Tx,
  t: { requestId: string; refId: string; olehUserId: string | null; catatan: string | null },
  step: number,
  statusKe: (l: LangkahApproval) => string,
): Promise<void> {
  const [l] = await tx`
    SELECT step, status_dari, status_ke, label, group_key, keterangan
    FROM insentif_approval_step WHERE step = ${step}`;
  if (!l) throw new TolakKonsumen(`langkah insentif ${step} tidak dikenal`);
  const langkah = l as unknown as LangkahApproval;
  const ke = statusKe(langkah);
  const [b] = await tx`
    UPDATE insentif_bulanan SET status = ${ke}
    WHERE id = ${t.refId}::bigint AND approval_request_id = ${t.requestId}::uuid AND status = ${langkah.status_dari}
    RETURNING siklus`;
  if (!b) throw new TolakKonsumen("status rekap insentif sudah berubah — muat ulang lalu putuskan lagi");
  if (!t.olehUserId) return;
  // Pagar unik 183 (satu akun satu langkah per siklus) dicek dulu supaya penolakannya
  // terbaca manusia, bukan error constraint yang membatalkan transaksi mesin.
  const [dobel] = await tx`
    SELECT 1 FROM insentif_approval_log
    WHERE bulanan_id = ${t.refId}::bigint AND siklus = ${b.siklus} AND actor_user_id = ${t.olehUserId}
      AND status_to <> 'draft'`;
  if (dobel) throw new TolakKonsumen("akun ini sudah menandatangani satu langkah di putaran ini");
  await tx`
    INSERT INTO insentif_approval_log
      (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
    VALUES (${t.refId}::bigint, ${step}, ${b.siklus}, ${ke}, ${t.olehUserId}, 'approval', ${t.catatan})`;
}

async function penangan(tx: Tx, h: HasilApproval): Promise<void> {
  if (h.status === "canceled") {
    // Dibatalkan dari sisi approval: rekap kembali ke draft di putaran baru supaya
    // pemutus yang sudah tanda tangan di request batal tak terkunci pagar 183.
    const [b] = await tx`
      UPDATE insentif_bulanan SET status = 'draft', siklus = siklus + 1
      WHERE id = ${h.refId}::bigint AND approval_request_id = ${h.requestId}::uuid
        AND status IN ('submitted', 'hod_review', 'finance_verify', 'corsec_compile')
      RETURNING siklus`;
    if (b) {
      await tx`
        INSERT INTO insentif_approval_log
          (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
        VALUES (${h.refId}::bigint, 1, ${Number(b.siklus) - 1}, 'draft', ${h.olehUserId ?? "system"},
                'approval', ${h.catatan ?? `approval ${h.kode} dibatalkan`})`;
    }
    return;
  }
  const [r] = await tx`SELECT current_urutan FROM approval_request WHERE id = ${h.requestId}::uuid`;
  const step = Number(r?.current_urutan);
  await catatLangkah(tx, h, step, (l) => (h.status === "approved" ? l.status_ke : "rejected"));
}

async function setiapTahap(tx: Tx, t: TahapMaju): Promise<void> {
  await catatLangkah(tx, t, t.urutanSelesai, (l) => l.status_ke);
}

daftarKonsumen(REF_TABEL, penangan, { setiapTahap });
