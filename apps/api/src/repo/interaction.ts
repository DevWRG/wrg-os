// F95 Interaction Log — `#CALL <faskes>: <hasil>` / `#NOTE <faskes>: <isi>` dari
// WA, dicatat per customer ke interaction_log (migrasi 208), lalu tampil di
// timeline Accounts 360 bersama aktivitas AM, perubahan tahap deal, dan faktur.
//
// SENGAJA tidak menulis ke activity_log: keputusan user 2026-10-13, #CALL/#NOTE
// tak boleh ikut KPI aktivitas AM, sedangkan ±15 query KPI menghitung semua baris
// activity_log tanpa saringan tipe/sumber.
//
// Resolusi faskes lewat customer-resolve.ts (aturan yang sama dgn #CEK CUSTOMER): satu
// identitas atau BERTANYA — catatan yang diam-diam menempel ke faskes yang salah
// lebih mahal daripada AM mengetik ulang. Kandidat diambil dua jalur, nama utuh
// dan INTI nama (kata generik dibuang, faskes_inti migrasi 176), karena nama
// Accurate sering terbalik ("WIDODO, RS KAB. NGAWI"): 'RSUD dr Widodo Ngawi'
// cuma 0,58 lawan nama utuh tapi 0,81 lawan intinya. faskes_cocok() lalu
// menolak pasangan yang miripnya hanya di kata generik + nama kota (RS
// Muhammadiyah Babat ≠ RS NU Babat).

import { db } from "../db.js";
import { jatuhTempoSql, tglBayarSql } from "./pembayaran.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { resolveCustomer, type CustCandidate, type CekResolve } from "./customer-resolve.js";

export type JenisInteraksi = "call" | "note";

export const NAMA_MATCH = 0.45; // sejajar ACCOUNT_MATCH / CEK_MATCH
export const INTI_MATCH = 0.4;
const ISI_MAKS = 2000;

const LINE: Record<JenisInteraksi, RegExp> = {
  call: /^\s*#\s*call\b/i,
  note: /^\s*#\s*note\b/i,
};

export type ParseInteraksi =
  | { ok: true; customer: string; isi: string }
  | { ok: false; alasan: "kosong" | "tanpa-isi" | "terlalu-panjang" };

/**
 * Pecah pesan jadi (nama faskes, isi). Format yang diterima:
 *   #CALL RSUD Ngawi: konfirmasi PO minggu depan
 *   #CALL RSUD Ngawi | konfirmasi PO …        (juga " - " / " — ")
 *   #NOTE RSUD Ngawi                          ← nama di baris hashtag,
 *   Kepala lab baru: dr. Sari …               ← isi di baris-baris berikutnya
 * Pemisah wajib: tanpa itu, batas nama faskes dan isinya tak bisa ditebak
 * dengan aman ("RS Islam Demo Husada minta brosur" — di mana namanya berakhir?).
 */
export function parseInteraksi(body: string | null, jenis: JenisInteraksi): ParseInteraksi {
  if (!body) return { ok: false, alasan: "kosong" };
  const lines = stripInvisible(body).split(/\r?\n/);
  const idx = lines.findIndex((l) => LINE[jenis].test(l));
  if (idx < 0) return { ok: false, alasan: "kosong" };
  const arg = lines[idx].replace(LINE[jenis], "").trim();
  const lanjutan = lines.slice(idx + 1).join("\n").trim();
  if (!arg) return { ok: false, alasan: "kosong" };

  let customer = arg;
  let isi = "";
  const m = arg.match(/^(.*?)\s*(?::|\||(?:^|\s)[-—–]\s)\s*(.*)$/);
  if (m) {
    customer = m[1];
    isi = [m[2], lanjutan].filter(Boolean).join("\n");
  } else {
    isi = lanjutan;
  }
  customer = customer.trim();
  isi = isi.trim();
  if (!customer) return { ok: false, alasan: "kosong" };
  if (!isi) return { ok: false, alasan: "tanpa-isi" };
  if (isi.length > ISI_MAKS) return { ok: false, alasan: "terlalu-panjang" };
  return { ok: true, customer, isi };
}

export async function cariAkun(q: string): Promise<CekResolve> {
  const sql = db();
  const rows = await sql`
    SELECT id::text AS id, nama,
           greatest(similarity(nama, ${q}), similarity(faskes_inti(nama), faskes_inti(${q}))) AS score
    FROM (SELECT id, COALESCE(NULLIF(name,''), raw->>'name', '') AS nama FROM accurate_customer) c
    WHERE nama <> ''
      AND (similarity(nama, ${q}) >= ${NAMA_MATCH}
           OR similarity(faskes_inti(nama), faskes_inti(${q})) >= ${INTI_MATCH}
           -- semua kata inti yang diketik ada di nama faskes (trigram menghukum
           -- nama panjang; lihat faskes_inti_kata di migrasi 208)
           OR (faskes_inti_kata(${q}) <> ''
               AND faskes_sisa(faskes_inti_kata(${q}), faskes_inti_kata(nama)) = ''))
      AND faskes_cocok(${q}, nama)
    ORDER BY score DESC
    LIMIT 20`;
  // TANPA saringan "selisih skor dari juara": dicoba dan langsung salah —
  // "rs babat" diam-diam menempel ke NU Babat karena RSU Muhammadiyah Babat
  // skornya lebih rendah, padahal pengirimnya memang tak menyebut yang mana.
  // Pembeda faskes sudah dikerjakan faskes_cocok(); sisa >1 nama = bertanya.
  const kandidat: CustCandidate[] = rows.map((r) => ({ id: Number(r.id), name: String(r.nama), score: Number(r.score) }));
  return resolveCustomer(q, kandidat);
}

const LABEL: Record<JenisInteraksi, string> = { call: "Telepon", note: "Catatan" };
const CONTOH: Record<JenisInteraksi, string> = {
  call: "#CALL RSUD Ngawi: konfirmasi PO reagen minggu depan",
  note: "#NOTE RSUD Ngawi: kepala lab baru, dr. Sari",
};
const HASHTAG: Record<JenisInteraksi, string> = { call: "#CALL", note: "#NOTE" };

export function balasanFormat(jenis: JenisInteraksi, alasan: "kosong" | "tanpa-isi" | "terlalu-panjang", nama: string): string {
  if (alasan === "terlalu-panjang") return `⚠️ ${HASHTAG[jenis]} terlalu panjang (maks ${ISI_MAKS} karakter), ${nama}. Ringkas dulu, lalu kirim ulang.`;
  const sebab = alasan === "tanpa-isi"
    ? `isi ${jenis === "call" ? "hasil telepon" : "catatan"} belum ada — pisahkan nama faskes dan isinya pakai titik dua`
    : "nama faskes dan isinya belum ada";
  return `⚠️ ${HASHTAG[jenis]} belum tercatat, ${nama}: ${sebab}.\nContoh: ${CONTOH[jenis]}`;
}

export function balasanAmbiguInteraksi(jenis: JenisInteraksi, q: string, names: string[], isi: string): string {
  const potong = isi.length > 60 ? `${isi.slice(0, 57)}…` : isi;
  return (
    `🔎 "${q}" cocok ke ${names.length} faskes — ${HASHTAG[jenis]} BELUM dicatat. Sebutkan yang mana:\n` +
    names.map((n) => `• ${n}`).join("\n") +
    `\n\nKetik ulang, mis. *${HASHTAG[jenis]} ${names[0]}: ${potong}*`
  );
}

export function balasanTercatat(jenis: JenisInteraksi, faskes: string, nama: string): string {
  return `✅ ${LABEL[jenis]} tercatat untuk *${faskes}*, ${nama}. Lihat di timeline Accounts.`;
}

export interface CatatInteraksi {
  account_id: number;
  jenis: JenisInteraksi;
  isi: string;
  am_id: string | null;
  pencatat_nama: string;
  customer_query: string | null;
  source: "wa" | "web";
  group_jid?: string | null;
  wa_message_id?: string | null;
}

/** Simpan satu interaksi. Pesan WA yang sama diproses dua kali → baris lama dipakai lagi. */
export async function catatInteraksi(x: CatatInteraksi): Promise<{ id: string; baru: boolean }> {
  const sql = db();
  const [r] = await sql`
    INSERT INTO interaction_log (account_id, jenis, isi, am_id, pencatat_nama, customer_query, source, group_jid, wa_message_id)
    VALUES (${x.account_id}, ${x.jenis}, ${x.isi}, ${x.am_id}, ${x.pencatat_nama}, ${x.customer_query},
            ${x.source}, ${x.group_jid ?? null}, ${x.wa_message_id ?? null})
    ON CONFLICT (wa_message_id) DO NOTHING
    RETURNING id::text`;
  if (r) return { id: String(r.id), baru: true };
  const [lama] = await sql`SELECT id::text FROM interaction_log WHERE wa_message_id = ${x.wa_message_id ?? null}`;
  return { id: String(lama?.id ?? ""), baru: false };
}

// ── Timeline Accounts 360 ───────────────────────────────────────────────────

export type JenisTimeline = "call" | "note" | "aktivitas" | "deal" | "faktur" | "demo" | "trial" | "bayar";

export interface TimelineItem {
  jenis: JenisTimeline;
  waktu: string; // ISO; aktivitas & faktur cuma bertanggal → jam 00:00 WIB
  judul: string | null;
  isi: string | null;
  oleh: string | null;
  ref: string;
  // khusus faktur
  nilai?: number;
  sisa?: number;
  status?: string | null;
}

// Kursor = (waktu, jenis, ref) baris terakhir halaman sebelumnya. Waktu saja
// tak cukup: faktur & aktivitas bertanggal tanpa jam, jadi puluhan baris bisa
// berbagi waktu yang sama dan sebagian akan terlompati di halaman berikutnya.
export function encodeKursor(it: Pick<TimelineItem, "waktu" | "jenis" | "ref">): string {
  return Buffer.from(JSON.stringify([it.waktu, it.jenis, it.ref])).toString("base64url");
}
export function decodeKursor(k: string | null | undefined): [string, string, string] | null {
  if (!k) return null;
  try {
    const v = JSON.parse(Buffer.from(k, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "string") && !Number.isNaN(Date.parse(v[0]))) {
      return v as [string, string, string];
    }
  } catch { /* kursor rusak → anggap halaman pertama */ }
  return null;
}

/**
 * Gabungan kronologis (terbaru dulu) dari empat sumber untuk satu account:
 * interaksi F95, aktivitas AM (activity_log), perubahan tahap deal, faktur.
 * Akses SUDAH dicek pemanggil lewat getAccount(id, scope) — fungsi ini tak
 * menyaring scope lagi, jadi jangan dipanggil tanpa cek itu.
 */
export async function timelineAkun(accountId: number, opts: { limit?: number; kursor?: string | null } = {}): Promise<{ items: TimelineItem[]; berikutnya: string | null }> {
  const sql = db();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const k = decodeKursor(opts.kursor);
  const rows = await sql`
    SELECT * FROM (
      SELECT il.jenis, il.created_at AS waktu, NULL::text AS judul, il.isi,
             il.pencatat_nama AS oleh, il.id::text AS ref,
             NULL::float8 AS nilai, NULL::float8 AS sisa, NULL::text AS status
      FROM interaction_log il WHERE il.account_id = ${accountId}
      UNION ALL
      SELECT 'aktivitas', (al.tanggal::timestamp AT TIME ZONE 'Asia/Jakarta'),
             COALESCE(al.activity_type, 'Aktivitas'),
             concat_ws(chr(10), NULLIF(btrim(al.hasil),''),
                       'Next: ' || NULLIF(btrim(al.next_action),'')),
             COALESCE(NULLIF(mu.nama,''), al.am_id), al.id::text,
             NULL, NULL, NULL
      FROM activity_log al LEFT JOIN master_user mu ON mu.am_id = al.am_id
      WHERE al.account_id = ${accountId}
      UNION ALL
      SELECT 'deal', sl.occurred_at,
             COALESCE(sl.from_stage::text || ' → ', '') || sl.to_stage::text,
             concat_ws(' · ', NULLIF(btrim(concat_ws(' ', d.brand, d.product)), ''), NULLIF(btrim(sl.reason),'')),
             COALESCE(NULLIF(cmu.nama,''), sl.changed_by), sl.id::text,
             NULL, NULL, NULL
      FROM spt_state_log sl JOIN deal d ON d.deal_id = sl.deal_id
      LEFT JOIN master_user cmu ON cmu.am_id = sl.changed_by
      WHERE d.account_id = ${accountId}
      UNION ALL
      SELECT 'faktur', (ai.tanggal::timestamp AT TIME ZONE 'Asia/Jakarta'),
             ai.number, NULL, NULLIF(ai.salesman_name,''), ai.id::text,
             (ai.total - COALESCE(ai.tax_amount,0))::float8, COALESCE(ai.outstanding,0)::float8, NULLIF(ai.status,'')
      FROM accurate_invoice ai WHERE ai.customer_id = ${accountId}
      UNION ALL
      -- F131 pelunasan faktur: tanggal bayar sebenarnya (lastPaymentDateView,
      -- cadangan lunas_at) + lama bayar & keterlambatan dari jatuh tempo.
      -- status = 'telat' / 'tepat' / NULL (jatuh tempo tak diketahui).
      SELECT 'bayar', (b.bayar::timestamp AT TIME ZONE 'Asia/Jakarta'), ai.number,
             concat('Lunas ', b.bayar - ai.tanggal, ' hari setelah faktur',
                    CASE WHEN b.due IS NULL THEN ''
                         WHEN b.bayar > b.due THEN ' · telat ' || (b.bayar - b.due) || ' hari dari jatuh tempo'
                         ELSE ' · tepat waktu' END),
             NULL, ai.id::text,
             (ai.total - COALESCE(ai.tax_amount,0))::float8, 0::float8,
             CASE WHEN b.due IS NULL THEN NULL WHEN b.bayar > b.due THEN 'telat' ELSE 'tepat' END
      FROM accurate_invoice ai
      CROSS JOIN LATERAL (SELECT ${tglBayarSql(sql)} AS bayar, ${jatuhTempoSql(sql)} AS due) b
      WHERE ai.customer_id = ${accountId} AND ai.status = 'PAID' AND b.bayar IS NOT NULL AND b.bayar >= ai.tanggal
      UNION ALL
      -- F18 demo/trial (migrasi 210). Waktu = hari demo / mulai trial.
      SELECT dt.jenis, (dt.tanggal::timestamp AT TIME ZONE 'Asia/Jakarta'),
             dt.kode || ' · ' || dt.alat,
             concat_ws(chr(10),
               CASE WHEN dt.hasil IS NOT NULL THEN 'Hasil: ' || dt.hasil || COALESCE(' — ' || NULLIF(btrim(dt.alasan_hasil),''), '')
                    WHEN dt.tanggal_selesai IS NOT NULL THEN 'Trial s/d ' || to_char(dt.tanggal_selesai, 'DD-MM-YYYY') || ' · belum ada hasil'
                    ELSE 'Belum ada hasil' END,
               NULLIF(btrim(dt.catatan),'')),
             COALESCE(NULLIF(dmu.nama,''), dt.am_id), dt.id::text,
             NULL, NULL, NULL
      FROM demo_trial dt LEFT JOIN master_user dmu ON dmu.am_id = dt.am_id
      WHERE dt.account_id = ${accountId}
    ) t
    ${k ? sql`WHERE (t.waktu, t.jenis, t.ref) < (${k[0]}::timestamptz, ${k[1]}, ${k[2]})` : sql``}
    ORDER BY t.waktu DESC, t.jenis DESC, t.ref DESC
    LIMIT ${limit + 1}`;
  const items: TimelineItem[] = rows.slice(0, limit).map((r) => {
    const it: TimelineItem = {
      jenis: String(r.jenis) as JenisTimeline,
      waktu: new Date(r.waktu as string).toISOString(),
      judul: r.judul == null ? null : String(r.judul),
      isi: r.isi == null || r.isi === "" ? null : String(r.isi),
      oleh: r.oleh == null || r.oleh === "" ? null : String(r.oleh),
      ref: String(r.ref),
    };
    if (it.jenis === "faktur" || it.jenis === "bayar") {
      it.nilai = Number(r.nilai ?? 0);
      it.sisa = Number(r.sisa ?? 0);
      it.status = r.status == null ? null : String(r.status);
    }
    return it;
  });
  return { items, berikutnya: rows.length > limit ? encodeKursor(items[items.length - 1]) : null };
}
