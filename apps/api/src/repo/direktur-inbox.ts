// F59 — Direktur Inbox: satu daftar untuk semua antrean approval yang MENUNGGU
// DIREKTUR, plus digest WA pagi.
//
// Murni BACA. Tak ada jalur tulis approve baru di sini — memutuskan tetap lewat
// layar/WA yang sudah ada (tiap sumber punya aturan wewenang sendiri). Yang
// dikerjakan modul ini hanya mengumpulkan & menyodorkan.
//
// 5 sumber MVP (keputusan user 16 Okt 2026). Tiap sumber SQL sendiri, BUKAN
// `list*` yang sudah ada, karena:
//   • status approval PO & Fund Request dihitung dari baris approval (bukan
//     kolom), dan `listFundRequests` memfilter di JS setelah LIMIT 5000;
//   • `listApprovalRequests` memanggil getApprovalRequest per baris (N+1).
// Di luar scope: Doc Klaim, Audit Finding, Deal-loss (tak jelas "milik Direktur"
// / berbasis grup akses) dan "harga/faktur/alokasi" (belum punya approval flow).
//
// Satu sumber gagal TIDAK menjatuhkan inbox: dilaporkan di `gagal`, sisanya
// tetap tampil. Inbox yang diam-diam tak lengkap lebih berbahaya daripada
// inbox yang bilang "sumber X gagal dibaca".

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

import { direkturTarget } from "./senin-brief.js";

export type JenisInbox = "approval" | "po" | "fund" | "insentif" | "lembur";

export const LABEL_JENIS: Record<JenisInbox, string> = {
  approval: "Approval F11",
  po: "Purchase Order",
  fund: "Dana Operasional",
  insentif: "Insentif",
  lembur: "Lembur",
};

export interface InboxItem {
  jenis: JenisInbox;
  /** String: tipe asli beda-beda (uuid / bigint / am_id+periode). */
  id: string;
  kode: string;
  judul: string;
  pengaju: string | null;
  nominal: number | null;
  menunggu_sejak: string;
  umur_hari: number;
  /** Path web (relatif). Sumber tanpa deep-link menunjuk halaman daftarnya. */
  link: string;
  /** Balasan WA yang sudah didukung parser (#APPROVE <kode>); null = tak ada. */
  aksi_wa: string | null;
}

export interface InboxHasil {
  generated_at: string;
  total: number;
  per_jenis: Record<JenisInbox, number>;
  items: InboxItem[];
  gagal: { jenis: JenisInbox; error: string }[];
}

// ── Fungsi murni ─────────────────────────────────────────────────

const MS_HARI = 86_400_000;

/** Umur dalam hari penuh sejak `sejak`; tanggal rusak/di masa depan = 0. */
export function umurHari(sejak: string, now: Date = new Date()): number {
  const t = new Date(sejak).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_HARI));
}

export function hitungPerJenis(items: Pick<InboxItem, "jenis">[]): Record<JenisInbox, number> {
  const out: Record<JenisInbox, number> = { approval: 0, po: 0, fund: 0, insentif: 0, lembur: 0 };
  for (const i of items) out[i.jenis] += 1;
  return out;
}

/** Tertua dulu; sama umur → jenis lalu kode, supaya urutan stabil antar-pemanggilan. */
export function urutkanInbox<T extends Pick<InboxItem, "umur_hari" | "jenis" | "kode">>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    b.umur_hari - a.umur_hari || a.jenis.localeCompare(b.jenis) || a.kode.localeCompare(b.kode));
}

function rpRingkas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  if (n >= 1e9) return `Rp ${(n / 1e9).toFixed(1).replace(".", ",")} M`;
  if (n >= 1e6) {
    const jt = n / 1e6;
    // Di bawah 100 jt satu desimal (2,5 jt ≠ 3 jt); di atasnya bulat.
    return `Rp ${(jt < 100 ? jt.toFixed(1).replace(/\.0$/, "") : String(Math.round(jt))).replace(".", ",")} jt`;
  }
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

const MAKS_BARIS_WA = 10;
const MAKS_PANJANG_WA = 3500;

/** WA tak menampilkan kurung sudut (dibuang) — judul bebas dari user dibersihkan. */
const bersihWa = (s: string): string => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

/**
 * Digest WA pagi: hitungan per jenis + 10 item tertua + petunjuk balasan.
 * Tak ada batas panjang di wasend.ts, jadi dipotong di sini.
 */
export function formatWaDigest(items: InboxItem[], link: string | null): string {
  const per = hitungPerJenis(items);
  const ringkas = (Object.keys(per) as JenisInbox[]).filter((j) => per[j] > 0)
    .map((j) => `${LABEL_JENIS[j]} ${per[j]}`).join(" · ");
  const baris = [`*Direktur Inbox* · ${items.length} menunggu keputusan`, ringkas, ""];
  const urut = urutkanInbox(items);
  for (const i of urut.slice(0, MAKS_BARIS_WA)) {
    const nominal = rpRingkas(i.nominal);
    baris.push(`• ${i.kode} · ${bersihWa(i.judul)}${nominal ? ` · ${nominal}` : ""} · ${i.umur_hari} hari`);
  }
  if (urut.length > MAKS_BARIS_WA) baris.push(`…dan ${urut.length - MAKS_BARIS_WA} lainnya`);
  const kodeWa = urut.filter((i) => i.aksi_wa).slice(0, 1).map((i) => i.kode);
  if (kodeWa.length) {
    baris.push("", `Untuk approval F11 & lembur, balas: #APPROVE ${kodeWa[0]} atau #REJECT ${kodeWa[0]} alasan`);
  }
  if (link) baris.push("", `Detail & tautan ke tiap layar: ${link}`);
  const teks = baris.join("\n");
  return teks.length <= MAKS_PANJANG_WA ? teks : `${teks.slice(0, MAKS_PANJANG_WA - 1)}…`;
}

/** Tanda isi inbox untuk anti-dobel; urutan kode tak berpengaruh. */
export function tandaInbox(items: Pick<InboxItem, "jenis" | "kode">[]): string {
  return items.map((i) => `${i.jenis}:${i.kode}`).sort().join("|");
}

// ── Sumber ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));
const sn = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function item(p: Omit<InboxItem, "umur_hari"> & { now: Date }): InboxItem {
  const { now, ...rest } = p;
  return { ...rest, umur_hari: umurHari(p.menunggu_sejak, now) };
}

/** F11: request pending yang tahap AKTIF-nya milik Direktur. */
async function sumberApproval(now: Date): Promise<InboxItem[]> {
  const rows: Row[] = await db()`
    SELECT r.id::text AS id, r.kode, r.title, r.nominal::float8 AS nominal, r.requested_by,
           COALESCE(s.notified_at, r.created_at)::text AS sejak
    FROM approval_request r
    JOIN approval_step s ON s.request_id = r.id AND s.urutan = r.current_urutan
    WHERE r.status = 'pending' AND s.status = 'pending' AND s.target_type = 'direktur'
  `;
  return rows.map((r) => item({
    jenis: "approval", id: s(r.id), kode: s(r.kode), judul: s(r.title), pengaju: sn(r.requested_by),
    nominal: num(r.nominal), menunggu_sejak: s(r.sejak), link: `/approval-requests/${s(r.id)}`,
    aksi_wa: `#APPROVE ${s(r.kode)}`, now,
  }));
}

/**
 * F35: tier-1 (HoD Business + HoD Finance) lengkap, Direktur belum, tak ada yang
 * menolak — sama dengan computeApprovalStatus === 'pending_direktur'. PO tanpa
 * lini (pra-F35, legacy_exempt), PO dari Accurate (approval di Accurate) dan PO
 * batal dikecualikan.
 */
async function sumberPo(now: Date): Promise<InboxItem[]> {
  const rows: Row[] = await db()`
    SELECT po.id::text AS id, po.po_number, po.vendor_name, po.created_by,
           COALESCE(po.total_amount, it.total)::float8 AS nominal,
           COALESCE(a.tier1_at, po.created_at)::text AS sejak
    FROM purchase_order po
    JOIN (
      SELECT purchase_order_id,
        bool_or(status = 'rejected') AS any_rejected,
        bool_and(status = 'approved') FILTER (WHERE approver_role IN ('hod_business', 'hod_finance')) AS tier1,
        max(decided_at) FILTER (WHERE approver_role IN ('hod_business', 'hod_finance')) AS tier1_at,
        bool_or(status = 'pending' AND approver_role = 'direktur') AS direktur_pending
      FROM purchase_order_approval GROUP BY purchase_order_id
    ) a ON a.purchase_order_id = po.id
    LEFT JOIN (
      SELECT purchase_order_id, SUM(unit_price * qty_ordered) AS total
      FROM purchase_order_item GROUP BY purchase_order_id
    ) it ON it.purchase_order_id = po.id
    WHERE po.lini IS NOT NULL AND po.source IS DISTINCT FROM 'accurate' AND po.cancelled_at IS NULL
      AND NOT COALESCE(a.any_rejected, false) AND COALESCE(a.tier1, false) AND COALESCE(a.direktur_pending, false)
  `;
  return rows.map((r) => item({
    jenis: "po", id: s(r.id), kode: s(r.po_number), judul: s(r.vendor_name) || "PO", pengaju: sn(r.created_by),
    nominal: num(r.nominal), menunggu_sejak: s(r.sejak), link: `/purchase-orders?q=${encodeURIComponent(s(r.po_number))}`,
    aksi_wa: null, now,
  }));
}

/** F138: HoD sudah menyetujui, Direktur belum memutus. Tak punya kolom kode → 8 hex id. */
async function sumberFund(now: Date): Promise<InboxItem[]> {
  const rows: Row[] = await db()`
    SELECT fr.id::text AS id, fr.purpose, fr.requester_name, fr.amount_requested::float8 AS nominal,
           COALESCE(hod.decided_at, fr.created_at)::text AS sejak
    FROM fund_request fr
    JOIN fund_request_approval hod ON hod.fund_request_id = fr.id AND hod.approver_role = 'hod' AND hod.status = 'approved'
    JOIN fund_request_approval dir ON dir.fund_request_id = fr.id AND dir.approver_role = 'direktur' AND dir.status = 'pending'
  `;
  return rows.map((r) => item({
    jenis: "fund", id: s(r.id), kode: `FR-${s(r.id).slice(0, 8).toUpperCase()}`, judul: s(r.purpose),
    pengaju: sn(r.requester_name), nominal: num(r.nominal), menunggu_sejak: s(r.sejak), link: "/fund-requests",
    aksi_wa: null, now,
  }));
}

/**
 * F67: rekap yang sedang di langkah milik grup `direktur` (diturunkan dari
 * insentif_approval_step, bukan di-hardcode). `direktur_approve` = SUDAH
 * disetujui Direktur (giliran HRD) — bukan antrean Direktur.
 */
async function sumberInsentif(now: Date): Promise<InboxItem[]> {
  const rows: Row[] = await db()`
    SELECT b.id::text AS id, b.am_id, b.periode, b.total_insentif_am::float8 AS nominal,
           COALESCE(m.nama, b.am_id) AS nama,
           COALESCE((SELECT max(l.acted_at) FROM insentif_approval_log l
                     WHERE l.bulanan_id = b.id AND l.status_to = b.status), b.computed_at)::text AS sejak
    FROM insentif_bulanan b
    JOIN insentif_approval_step st ON st.status_dari = b.status AND st.group_key = 'direktur'
    LEFT JOIN master_user m ON m.am_id = b.am_id
  `;
  return rows.map((r) => item({
    jenis: "insentif", id: s(r.id), kode: `INS-${s(r.periode)}-${s(r.am_id)}`, judul: `Insentif ${s(r.nama)} · ${s(r.periode)}`,
    pengaju: null, nominal: num(r.nominal), menunggu_sejak: s(r.sejak),
    link: `/insentif/tim/${encodeURIComponent(s(r.am_id))}?periode=${encodeURIComponent(s(r.periode))}`,
    aksi_wa: null, now,
  }));
}

/**
 * Lembur: pending DAN tanpa HoD pemutus (hod_key NULL) → jatuh ke Direktur.
 * Direktur sebenarnya boleh memutus semua lembur; yang ditampilkan hanya yang
 * tak punya pemutus lain supaya inbox tak penuh antrean milik HoD.
 */
async function sumberLembur(now: Date): Promise<InboxItem[]> {
  const rows: Row[] = await db()`
    SELECT kode, nama, uraian, tanggal_lembur::text AS tanggal, created_at::text AS sejak
    FROM overtime_request WHERE status = 'pending' AND hod_key IS NULL
  `;
  return rows.map((r) => item({
    jenis: "lembur", id: s(r.kode), kode: s(r.kode), judul: `${s(r.nama)} · lembur ${s(r.tanggal)}`,
    pengaju: sn(r.nama), nominal: null, menunggu_sejak: s(r.sejak), link: "/overtime", aksi_wa: `#APPROVE ${s(r.kode)}`, now,
  }));
}

const SUMBER: Record<JenisInbox, (now: Date) => Promise<InboxItem[]>> = {
  approval: sumberApproval, po: sumberPo, fund: sumberFund, insentif: sumberInsentif, lembur: sumberLembur,
};

export async function listDirekturInbox(now: Date = new Date()): Promise<InboxHasil> {
  const jenis = Object.keys(SUMBER) as JenisInbox[];
  const hasil = await Promise.allSettled(jenis.map((j) => SUMBER[j](now)));
  const items: InboxItem[] = [];
  const gagal: InboxHasil["gagal"] = [];
  hasil.forEach((h, i) => {
    if (h.status === "fulfilled") items.push(...h.value);
    else gagal.push({ jenis: jenis[i], error: h.reason instanceof Error ? h.reason.message : String(h.reason) });
  });
  const urut = urutkanInbox(items);
  return { generated_at: now.toISOString(), total: urut.length, per_jenis: hitungPerJenis(urut), items: urut, gagal };
}

// ── Digest WA ────────────────────────────────────────────────────

export interface HasilDigest {
  total: number;
  gagal: InboxHasil["gagal"];
  wa_preview: string;
  wa?: { target: string | null; sent: boolean; error?: string; skipped?: string };
}

const wibTanggal = (now: Date): string => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * Digest pagi ke Direktur. `dryRun` = susun saja (tak kirim, tak menulis notif_state).
 * Inbox kosong → tak kirim (bukan "kosong" tiap pagi). Isi sama + hari sama → tak
 * dikirim ulang; hari baru dengan isi sama TETAP dikirim (antrean yang belum
 * diputus memang harus diingatkan lagi).
 */
export async function runDirekturInbox(opts: { dryRun?: boolean; target?: string; now?: Date } = {}): Promise<HasilDigest> {
  const now = opts.now ?? new Date();
  const inbox = await listDirekturInbox(now);
  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  const wa_preview = inbox.total ? formatWaDigest(inbox.items, base ? `${base}/direktur-inbox` : null) : "";
  const dasar = { total: inbox.total, gagal: inbox.gagal, wa_preview };

  const target = opts.target?.trim() || process.env.DIREKTUR_INBOX_TARGET?.trim() || (await direkturTarget());
  if (opts.dryRun) return { ...dasar, wa: { target, sent: false, skipped: "dry-run" } };
  if (inbox.total === 0) return { ...dasar, wa: { target, sent: false, skipped: "inbox kosong" } };
  if (!target) return { ...dasar, wa: { target: null, sent: false, error: "nomor WA Direktur tak ditemukan (app_user role direktur / DIREKTUR_INBOX_TARGET)" } };

  const sql = db();
  const sig = `${wibTanggal(now)}#${tandaInbox(inbox.items)}`;
  const [prev] = await sql`SELECT signature FROM notif_state WHERE key = 'direktur-inbox'`;
  if (prev && String(prev.signature) === sig) return { ...dasar, wa: { target, sent: false, skipped: "anti-dobel" } };

  const r = await sendViaWaGateway(target, wa_preview);
  if (r.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at) VALUES ('direktur-inbox', ${sig}, ${inbox.total}, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${sig}, count = ${inbox.total}, sent_at = now()
    `;
  }
  return { ...dasar, wa: { target, sent: r.sent, error: r.error } };
}
