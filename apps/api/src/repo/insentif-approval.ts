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

import { db } from "../db.js";
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

interface Rekap {
  id: string;
  status: string;
  siklus: number;
}

async function ambilRekap(amId: string, periode: string): Promise<Rekap | null> {
  const sql = db();
  const [r] = await sql<Rekap[]>`
    SELECT id::text, status, siklus FROM insentif_bulanan
    WHERE am_id = ${amId} AND periode = ${periode}`;
  return r ?? null;
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
    LEFT JOIN app_user u ON u.id = l.actor_user_id
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

  try {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE insentif_bulanan SET status = ${statusBaru} WHERE id = ${rekap.id}::bigint`;
      await tx`
        INSERT INTO insentif_approval_log
          (bulanan_id, step, siklus, status_to, actor_user_id, actor_role, catatan)
        VALUES (${rekap.id}::bigint, ${langkah.step}, ${rekap.siklus}, ${statusBaru},
                ${akses.userId}, ${grup.superuser ? "superuser" : akses.level},
                ${args.catatan ?? null})`;
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

  return { ok: true as const, status: statusBaru, siklus: rekap.siklus, step: langkah.step };
}
