// F67 — rantai persetujuan insentif (migrasi 093 + 183).
//
// Model `wrg_incentive_console_v2.jsx` §VI: 7 langkah dengan segregation of duties,
// "setiap step harus di-action dari akun email/user berbeda — tidak boleh 1 orang
// pencet advance untuk 2+ step berturut-turut".
//
// Di sini aturan itu ditegakkan di DUA lapis, sengaja:
//   1. Basis data — unique (bulanan_id, siklus, actor_user_id) di insentif_approval_log.
//      Ini pagar terakhir: walau ada endpoint baru yang lupa memeriksa, satu akun tetap
//      tak bisa menandatangani dua langkah dalam satu putaran.
//   2. Aplikasi — cek wewenang per langkah lewat grup akses + pesan yang bisa dibaca
//      manusia. Tanpa lapis ini, penolakan datang sebagai error constraint 23505.
//
// Urutan langkah + grup berwenangnya TIDAK ada di berkas ini; sumbernya tabel
// insentif_approval_step (183). Mengubah "siapa boleh bayar" = UPDATE satu baris.
//
// Sejak migrasi 256 langkah 2–6 (review HOD Sales s/d Bayar HRD) berjalan di
// mesin approval F11 (alur 'insentif', tahap target grup; wewenang diatur di
// Config Approval). "Ajukan" (langkah 1, AM) tetap di sini dan membuka
// approval-nya. Status insentif_bulanan + insentif_approval_log tetap ditulis
// per tahap oleh penangan konsumen di bawah, jadi UI, Direktur Inbox, dan
// pagar unik 183 tetap berlaku.

import type { TransactionSql } from "postgres";

import { db } from "../db.js";
import {
  buatRequestDalamTx,
  daftarKonsumen,
  decideFromDashboard,
  getApprovalRequest as getEngineRequest,
  notifyCurrentStep,
} from "./approval.js";
import { effectivePermissions } from "./rbac.js";
import { resolveAkses } from "./insentif.js";
import type { DataScope } from "./access-scope.js";

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
}

/** Grup yang boleh membuka kembali rekap yang ditolak. Superuser selalu boleh. */
const GRUP_BUKA_KEMBALI = ["sales-hod"];

type Tx = TransactionSql<Record<string, unknown>>;
export const JENIS_INSENTIF = "insentif";
const REF_TABEL = "insentif_bulanan";

// Tahap engine k ↔ langkah insentif k+1. Status SAAT menunggu tahap k, dan
// status SESUDAH tahap k disetujui.
const URUTAN_DARI_STATUS: Record<string, number> = {
  submitted: 1, hod_review: 2, finance_verify: 3, corsec_compile: 4, direktur_approve: 5,
};
const STATUS_SETELAH: Record<number, string> = {
  1: "hod_review", 2: "finance_verify", 3: "corsec_compile", 4: "direktur_approve", 5: "paid",
};

interface Rekap {
  id: string;
  status: string;
  siklus: number;
  approval_request_id: string | null;
  total_insentif_am: number;
}

async function ambilRekap(amId: string, periode: string): Promise<Rekap | null> {
  const sql = db();
  const [r] = await sql<Rekap[]>`
    SELECT id::text, status, siklus, approval_request_id::text AS approval_request_id,
           total_insentif_am::float8 AS total_insentif_am
    FROM insentif_bulanan
    WHERE am_id = ${amId} AND periode = ${periode}`;
  return r ?? null;
}

// Rekap yang sedang menunggu tahap engine (bukan draft/rejected/paid).
const diEngine = (r: Rekap): boolean => !!r.approval_request_id && URUTAN_DARI_STATUS[r.status] != null;

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
const kapital = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);

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
  if (opts.superuser || opts.grup.includes(langkah.group_key)) return { ok: true, alasan: null };
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
    -- actor_user_id bertipe TEXT (093) sedangkan app_user.id UUID: tanpa ::text
    -- Postgres menolak query ini (uuid = text) bahkan saat riwayatnya kosong.
    LEFT JOIN app_user u ON u.id::text = l.actor_user_id
    WHERE l.bulanan_id = ${rekap.id}::bigint
    ORDER BY l.acted_at`;

  const berikutnya = await langkahDari(rekap.status);
  const grup = akses.userId ? await grupUser(akses.userId) : { keys: [], superuser: false };

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
  } else if (diEngine(rekap)) {
    // Wewenang dihitung engine (grup tahap, pengaju, satu akun satu tahap).
    const apr = await getEngineRequest(rekap.approval_request_id!, { viewerUserId: akses.userId });
    if (apr?.wewenang?.boleh) bolehMaju = true;
    else alasan = apr?.wewenang?.alasan ? kapital(apr.wewenang.alasan) : "Menunggu approver tahap ini.";
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
    // Menolak = wewenang yang sama dengan meneruskan, kecuali pada langkah pengajuan:
    // AM "menolak" rekapnya sendiri tidak punya arti.
    boleh_tolak: bolehMaju && berikutnya?.group_key != null,
    boleh_buka:
      rekap.status === "rejected" &&
      (grup.superuser || grup.keys.some((k) => GRUP_BUKA_KEMBALI.includes(k))),
    alasan,
    riwayat,
  };
}

export type AksiApproval = "maju" | "tolak" | "buka";

export interface ActApprovalArgs {
  amId: string;
  periode: string;
  aksi: AksiApproval;
  catatan?: string | null;
}

/**
 * Jalankan satu aksi rantai persetujuan.
 *
 * Perubahan status dan penulisan jejak terjadi dalam SATU transaksi: status yang maju
 * tanpa jejak berarti pembayaran tanpa tanda tangan, dan jejak tanpa status berarti
 * orang merasa sudah menyetujui padahal berkasnya tak bergerak.
 */
export async function actApproval(scope: DataScope | undefined, args: ActApprovalArgs) {
  const akses = await resolveAkses(scope);
  const boleh = akses.ams === "all" || akses.ams.includes(args.amId);
  if (!boleh) throw Object.assign(new Error("not found"), { status: 404 });
  if (!akses.userId) throw Object.assign(new Error("forbidden"), { status: 403 });

  const rekap = await ambilRekap(args.amId, args.periode);
  if (!rekap) throw Object.assign(new Error("not found"), { status: 404 });

  const grup = await grupUser(akses.userId);
  const sql = db();

  // ── Buka kembali rekap yang ditolak: putaran baru, jejak lama tetap utuh.
  if (args.aksi === "buka") {
    if (rekap.status !== "rejected") {
      throw Object.assign(new Error("hanya rekap yang ditolak yang bisa dibuka kembali"), { status: 409 });
    }
    if (!grup.superuser && !grup.keys.some((k) => GRUP_BUKA_KEMBALI.includes(k))) {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    }
    const siklusBaru = rekap.siklus + 1;
    await sql.begin(async (tx) => {
      await tx`
        UPDATE insentif_bulanan SET status = 'draft', siklus = ${siklusBaru}
        WHERE id = ${rekap.id}::bigint`;
      await tx`
        INSERT INTO insentif_approval_log
          (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
        VALUES (${rekap.id}::bigint, 1, ${rekap.siklus}, 'draft', ${akses.userId},
                ${grup.superuser ? "superuser" : akses.level}, ${args.catatan ?? null})`;
    });
    return { ok: true as const, status: "draft", siklus: siklusBaru };
  }

  // Langkah 2–6 di mesin approval: wewenang & satu-akun-satu-tahap ditegakkan
  // engine; status + jejak ditulis penangan konsumen di transaksi yang sama.
  if (diEngine(rekap)) {
    const r = await decideFromDashboard(
      rekap.approval_request_id!,
      args.aksi === "tolak" ? "reject" : "approve",
      akses.userId,
      args.catatan ?? null,
      undefined,
      { expectedUrutan: URUTAN_DARI_STATUS[rekap.status] },
    );
    if (!r.ok) {
      const e = r.error ?? "gagal memproses langkah";
      throw Object.assign(new Error(e), { status: /sudah|berubah/.test(e) ? 409 : /wajib/.test(e) ? 400 : 403 });
    }
    const after = await ambilRekap(args.amId, args.periode);
    return { ok: true as const, status: after?.status ?? rekap.status, siklus: rekap.siklus, step: URUTAN_DARI_STATUS[rekap.status] + 1 };
  }

  const langkah = await langkahDari(rekap.status);
  if (!langkah) {
    throw Object.assign(
      new Error(`status '${rekap.status}' tidak punya langkah lanjutan`),
      { status: 409 },
    );
  }

  const w = berwenang(langkah, {
    selfAmId: akses.selfAmId, amId: args.amId, grup: grup.keys, superuser: grup.superuser,
  });
  if (!w.ok) throw Object.assign(new Error(w.alasan ?? "forbidden"), { status: 403 });

  if (args.aksi === "tolak" && langkah.group_key == null) {
    throw Object.assign(new Error("langkah pengajuan tidak bisa ditolak"), { status: 409 });
  }

  // Dicek di aplikasi supaya pesannya bisa dibaca; unique index di 183 tetap yang
  // menjadi pagar terakhir kalau ada jalur lain yang lupa memeriksa.
  if (await sudahBertindak(rekap.id, rekap.siklus, akses.userId)) {
    throw Object.assign(
      new Error("Anda sudah menandatangani satu langkah di putaran ini — langkah berikutnya harus akun lain."),
      { status: 409 },
    );
  }

  const statusBaru = args.aksi === "tolak" ? "rejected" : langkah.status_ke;
  // "Ajukan" (draft → submitted) membuka approval di engine untuk langkah 2–6.
  const bukaEngine = rekap.status === "draft" && statusBaru === "submitted";
  let aprId: string | null = null;

  try {
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Tx;
      await tx`
        UPDATE insentif_bulanan SET status = ${statusBaru} WHERE id = ${rekap.id}::bigint`;
      await tx`
        INSERT INTO insentif_approval_log
          (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
        VALUES (${rekap.id}::bigint, ${langkah.step}, ${rekap.siklus}, ${statusBaru},
                ${akses.userId}, ${grup.superuser ? "superuser" : akses.level},
                ${args.catatan ?? null})`;
      if (bukaEngine) {
        const [nama] = await tx`SELECT nama FROM master_user WHERE am_id = ${args.amId}`;
        const apr = await buatRequestDalamTx(tx, {
          jenis: JENIS_INSENTIF,
          title: `Insentif ${nama?.nama ?? args.amId} — ${args.periode}`.slice(0, 200),
          nominal: Number(rekap.total_insentif_am) || null,
          requestedBy: nama?.nama ? String(nama.nama) : args.amId,
          requestedByUserId: akses.userId,
          refTabel: REF_TABEL,
          refId: rekap.id,
        });
        if (!apr.ok) throw Object.assign(new Error(apr.error), { status: 409 });
        aprId = apr.id;
        await tx`UPDATE insentif_bulanan SET approval_request_id = ${apr.id} WHERE id = ${rekap.id}::bigint`;
      }
    });
  } catch (e) {
    // 23505 = unique violation → dua tab/dua klik dari akun yang sama.
    if ((e as { code?: string }).code === "23505") {
      throw Object.assign(
        new Error("Akun ini sudah menandatangani satu langkah di putaran ini."),
        { status: 409 },
      );
    }
    throw e;
  }

  if (aprId) await notifyCurrentStep(aprId);
  return { ok: true as const, status: statusBaru, siklus: rekap.siklus, step: langkah.step };
}

// ── Penangan konsumen engine ─────────────────────────────────────────────────
// Status insentif + jejak 183 ditulis per tahap di transaksi keputusan engine.
// Unique index 183 (satu akun satu langkah per siklus) tetap jadi pagar akhir.

async function tulisLangkah(tx: Tx, bulananId: string, step: number, statusTo: string, actor: string | null, catatan: string | null) {
  const [b] = await tx`SELECT siklus FROM insentif_bulanan WHERE id = ${bulananId}::bigint FOR UPDATE`;
  if (!b) return;
  await tx`UPDATE insentif_bulanan SET status = ${statusTo} WHERE id = ${bulananId}::bigint`;
  await tx`
    INSERT INTO insentif_approval_log (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
    VALUES (${bulananId}::bigint, ${step}, ${b.siklus}, ${statusTo}, ${actor}, 'approver', ${catatan})`;
}

daftarKonsumen(
  REF_TABEL,
  async (tx, h) => {
    if (h.status === "canceled") return;
    const [b] = await tx`
      SELECT b.id, r.current_urutan FROM insentif_bulanan b JOIN approval_request r ON r.id = b.approval_request_id
      WHERE b.id = ${h.refId}::bigint AND b.approval_request_id = ${h.requestId}`;
    if (!b) return;
    const urutan = Number(b.current_urutan);
    await tulisLangkah(tx, h.refId, urutan + 1, h.status === "approved" ? "paid" : "rejected", h.olehUserId, h.catatan);
  },
  {
    setiapTahap: async (tx, t) => {
      const statusTo = STATUS_SETELAH[t.urutan];
      if (!statusTo) return;
      const [b] = await tx`SELECT 1 FROM insentif_bulanan WHERE id = ${t.refId}::bigint AND approval_request_id = ${t.requestId}`;
      if (!b) return;
      await tulisLangkah(tx, t.refId, t.urutan + 1, statusTo, t.olehUserId, t.catatan);
    },
  },
);
