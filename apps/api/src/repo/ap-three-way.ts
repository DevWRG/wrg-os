// F152 3-Way Match Faktur Pembelian (AP) — Faktur vs PO vs Penerimaan, migrasi 240.
//
// Keputusan Direktur: faktur dari Accurate, toleransi 0% (qty & harga persis), jadwal bayar manual.
// Fitur ini READ-ONLY: selisih hanya ditandai, penyelesaiannya di Accurate oleh admin.
//
// Dua bagian, sengaja dipisah (pola cn.ts):
//   1. LOGIKA MURNI (evaluasiBaris, evaluasiFaktur, desimal tepat) — tanpa DB, diuji di ap-three-way.test.ts.
//   2. AKSES DB — merakit konteks per baris lalu menyerahkannya ke (1). Hasil match TIDAK disimpan
//      (dihitung saat dibaca) supaya tak basi saat PO/penerimaan/faktur berubah di Accurate.
//
// Join per BARIS lewat id (probe 19 Okt 2026): faktur.purchaseOrderDetailId = purchase_order_item.accurate_detail_id (205),
// faktur.receiveItemDetailId = inbound_receiving_line.accurate_detail_id (206).

import { db } from "../db.js";

// ── Konstanta ────────────────────────────────────────────────────────────────
/** Toleransi selisih qty & harga (Direktur: harus 0%). Satu-satunya tempat angka ini hidup. */
export const TOLERANSI_PERSEN = 0;

export const STATUS_BARIS = [
  "MATCH", "PARSIAL", "SELISIH_QTY", "SELISIH_HARGA", "SELISIH_SATUAN",
  "TANPA_PO", "TANPA_PENERIMAAN", "PENERIMAAN_BELUM_FINAL", "BELUM_SINKRON",
] as const;
export type StatusBaris = (typeof STATUS_BARIS)[number];

export const STATUS_FAKTUR = ["MATCH", "PARSIAL", "SELISIH", "BELUM_LENGKAP", "DRAFT", "DIABAIKAN"] as const;
export type StatusFaktur = (typeof STATUS_FAKTUR)[number];

/** Urutan keparahan baris (terburuk dulu): selisih nyata > tautan hilang > belum final/sinkron > parsial > cocok. */
const URUTAN_BARIS: readonly StatusBaris[] = [
  "SELISIH_HARGA", "SELISIH_QTY", "SELISIH_SATUAN", "TANPA_PO", "TANPA_PENERIMAAN",
  "PENERIMAAN_BELUM_FINAL", "BELUM_SINKRON", "PARSIAL", "MATCH",
];
const SELISIH_BARIS = new Set<StatusBaris>(["SELISIH_HARGA", "SELISIH_QTY", "SELISIH_SATUAN"]);
const LENGKAPI_BARIS = new Set<StatusBaris>(["TANPA_PO", "TANPA_PENERIMAAN", "PENERIMAAN_BELUM_FINAL", "BELUM_SINKRON"]);

export const AP_LIST_MAKS = 5000;
export const AP_Q_MAKS = 100;
export const AP_SYNC_ENTITY = "purchase-invoice";
const TGL = /^\d{4}-\d{2}-\d{2}$/;

export class ApError extends Error {
  constructor(
    public status: 400 | 404,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

// ── 1. Logika murni ──────────────────────────────────────────────────────────

const SKALA = 9;
const SATU = 10n ** BigInt(SKALA);

/**
 * Desimal tepat → bigint berskala 1e9 (tanpa float). Terima number (dari JSON Accurate) atau string
 * (numeric Postgres). null/''/tak-angka → null.
 */
export function keDesimal(v: unknown): bigint | null {
  if (v == null || v === "") return null;
  let t = typeof v === "number" ? (Number.isFinite(v) ? (/e/i.test(String(v)) ? v.toFixed(SKALA) : String(v)) : "") : String(v).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const neg = t.startsWith("-");
  t = t.replace(/^[+-]/, "");
  const [bulat, pecah = ""] = t.split(".");
  const n = BigInt(bulat) * SATU + BigInt((pecah + "0".repeat(SKALA)).slice(0, SKALA));
  return neg ? -n : n;
}

/** Sama persis (toleransi 0). Salah satu tak terbaca → false. */
export const samaDesimal = (a: unknown, b: unknown): boolean => {
  const x = keDesimal(a);
  const y = keDesimal(b);
  return x !== null && y !== null && x === y;
};

const normSatuan = (u: string | null | undefined): string => (u ?? "").trim().toLowerCase();

/**
 * Bentuk baku diskon Accurate ('', '0', '35', '10+5', '12,5'?). Tak ada diskon → "0".
 * Bagian tak terbaca membuat hasil null (tak bisa dibandingkan, jangan dianggap sama).
 */
export function bakukanDiskon(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const bagian = raw.trim().split("+").map((p) => p.trim()).filter((p) => p !== "");
  const out: string[] = [];
  for (const p of bagian) {
    const d = keDesimal(p);
    if (d === null) return null;
    if (d !== 0n) out.push(d.toString());
  }
  return out.length ? out.join("+") : "0";
}

export interface BarisFaktur {
  accurate_detail_id: number;
  item_no: string | null;
  item_desc: string;
  qty: number | string;
  return_qty: number | string;
  unit_name: string | null;
  unit_price: number | string | null;
  disc_raw: string | null;
  disc_amount: number | string;
  accurate_po_detail_id: number | null;
  accurate_receive_detail_id: number | null;
}

export interface KonteksBaris {
  /** null = baris PO tak ada di cermin lokal. */
  po: { qty_ordered: number | string; unit: string | null; unit_price: number | string | null; disc_raw: string | null } | null;
  /** null = baris penerimaan tak ada di cermin lokal. */
  penerimaan: { qty: number | string; unit: string | null; final: boolean } | null;
  /** Σ qty netto faktur FINAL lain pada baris PO / baris penerimaan yang sama (tidak termasuk baris ini). */
  qty_lain_po: number | string;
  qty_lain_penerimaan: number | string;
}

export interface Temuan {
  status: StatusBaris;
  pesan: string;
}
export interface HasilBaris {
  status: StatusBaris;
  temuan: Temuan[];
}

/** Penerimaan dianggap sudah masuk bila disetujui dan bukan "Diajukan"/draft. */
export function penerimaanFinal(statusName: string | null, approval: string | null): boolean {
  return approval === "APPROVED" && !/ajukan|draft/i.test(statusName ?? "");
}

/** Faktur final = disetujui, bukan draft (`DFT.n [...]`), bukan batal. Hanya faktur final ikut hitungan kumulatif. */
export function fakturDraft(number: string, approval: string | null): boolean {
  return number.startsWith("DFT.") || approval !== "APPROVED";
}
export const fakturBatal = (statusName: string | null): boolean => /batal|cancel|void/i.test(statusName ?? "");

/**
 * Evaluasi satu baris faktur. `finalFaktur` false (draft) tetap dievaluasi sebagai pratinjau
 * "kalau diposting"; kumulatif memakai faktur final lain saja.
 */
export function evaluasiBaris(b: BarisFaktur, k: KonteksBaris): HasilBaris {
  const temuan: Temuan[] = [];
  const tambah = (status: StatusBaris, pesan: string) => temuan.push({ status, pesan });

  const qty = keDesimal(b.qty);
  const ret = keDesimal(b.return_qty) ?? 0n;
  const netto = qty === null ? null : qty - ret;
  if (netto === null) tambah("SELISIH_QTY", "qty faktur tak terbaca");
  else if (netto < 0n) tambah("SELISIH_QTY", "qty retur melebihi qty faktur");

  // ── PO ──
  if (b.accurate_po_detail_id == null) tambah("TANPA_PO", "baris faktur tidak menaut ke PO");
  else if (!k.po) tambah("BELUM_SINKRON", "baris PO belum ada di cermin (belum sinkron / di luar cakupan)");
  else {
    if (normSatuan(b.unit_name) !== normSatuan(k.po.unit)) {
      tambah("SELISIH_SATUAN", `satuan faktur ${b.unit_name ?? "—"} ≠ PO ${k.po.unit ?? "—"}`);
    }
    if (!samaDesimal(b.unit_price, k.po.unit_price)) {
      tambah("SELISIH_HARGA", `harga satuan faktur ${b.unit_price ?? "—"} ≠ PO ${k.po.unit_price ?? "—"}`);
    }
    const dPo = bakukanDiskon(k.po.disc_raw);
    const dFak = bakukanDiskon(b.disc_raw);
    if (k.po.disc_raw == null) tambah("BELUM_SINKRON", "diskon PO belum tersinkron");
    else if (dPo === null || dFak === null) tambah("SELISIH_HARGA", "diskon tak terbaca, tak bisa dibandingkan");
    else if (dPo !== dFak) tambah("SELISIH_HARGA", `diskon faktur ${dFak}% ≠ PO ${dPo}%`);
    else if (dFak === "0" && (keDesimal(b.disc_amount) ?? 0n) !== 0n) {
      tambah("SELISIH_HARGA", `faktur memberi potongan nominal ${b.disc_amount} yang tak ada di PO`);
    }
    if (netto !== null && netto > 0n) {
      const total = netto + (keDesimal(k.qty_lain_po) ?? 0n);
      const pesan = keDesimal(k.po.qty_ordered);
      if (pesan !== null && total > pesan) tambah("SELISIH_QTY", `total qty difakturkan ${fmt(total)} melebihi qty PO ${fmt(pesan)}`);
    }
  }

  // ── Penerimaan ──
  if (b.accurate_receive_detail_id == null) tambah("TANPA_PENERIMAAN", "baris faktur tidak menaut ke penerimaan");
  else if (!k.penerimaan) tambah("BELUM_SINKRON", "baris penerimaan belum ada di cermin (belum sinkron / di luar cakupan)");
  else if (!k.penerimaan.final) tambah("PENERIMAAN_BELUM_FINAL", "penerimaan belum final (masih diajukan)");
  else {
    if (k.penerimaan.unit != null && b.unit_name != null && normSatuan(b.unit_name) !== normSatuan(k.penerimaan.unit)) {
      tambah("SELISIH_SATUAN", `satuan faktur ${b.unit_name} ≠ penerimaan ${k.penerimaan.unit}`);
    }
    if (netto !== null && netto > 0n) {
      const total = netto + (keDesimal(k.qty_lain_penerimaan) ?? 0n);
      const terima = keDesimal(k.penerimaan.qty);
      if (terima !== null) {
        if (total > terima) tambah("SELISIH_QTY", `total qty difakturkan ${fmt(total)} melebihi qty diterima ${fmt(terima)}`);
        else if (total < terima) tambah("PARSIAL", `baru ${fmt(total)} dari ${fmt(terima)} diterima yang difakturkan`);
      }
    }
  }

  const status = URUTAN_BARIS.find((s) => temuan.some((t) => t.status === s)) ?? "MATCH";
  return { status, temuan };
}

const fmt = (n: bigint): string => {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const bulat = abs / SATU;
  const pecah = (abs % SATU).toString().padStart(SKALA, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${bulat}${pecah ? `.${pecah}` : ""}`;
};

export interface HeaderFaktur {
  number: string;
  approval_status: string | null;
  status_name: string | null;
}

export interface HasilFaktur {
  status: StatusFaktur;
  /** Status terburuk baris, juga untuk DRAFT (pratinjau). Null bila tak ada baris barang. */
  status_baris: StatusBaris | null;
  per_status: Partial<Record<StatusBaris, number>>;
  alasan?: string;
}

/** Gabungkan hasil baris jadi status faktur. Draft/batal/tanpa baris barang tidak dinilai sebagai faktur final. */
export function evaluasiFaktur(h: HeaderFaktur, hasil: HasilBaris[]): HasilFaktur {
  const per: Partial<Record<StatusBaris, number>> = {};
  for (const r of hasil) per[r.status] = (per[r.status] ?? 0) + 1;
  const terburuk = URUTAN_BARIS.find((s) => (per[s] ?? 0) > 0) ?? null;

  if (fakturBatal(h.status_name)) return { status: "DIABAIKAN", status_baris: terburuk, per_status: per, alasan: "faktur dibatalkan" };
  if (hasil.length === 0) return { status: "DIABAIKAN", status_baris: null, per_status: per, alasan: "tanpa baris barang" };
  if (fakturDraft(h.number, h.approval_status)) return { status: "DRAFT", status_baris: terburuk, per_status: per, alasan: "faktur belum disetujui (draft)" };
  if (terburuk && SELISIH_BARIS.has(terburuk)) return { status: "SELISIH", status_baris: terburuk, per_status: per };
  if (terburuk && LENGKAPI_BARIS.has(terburuk)) return { status: "BELUM_LENGKAP", status_baris: terburuk, per_status: per };
  if (terburuk === "PARSIAL") return { status: "PARSIAL", status_baris: terburuk, per_status: per };
  return { status: "MATCH", status_baris: terburuk, per_status: per };
}

// ── 2. Akses DB ──────────────────────────────────────────────────────────────

const clean = (v: unknown, max: number): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, max) : null;
};
const tglSah = (v: string): boolean => {
  if (!TGL.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`);
  // Bulan/hari di luar rentang (2026-13-01) → Invalid Date; 2026-02-30 → bergeser. Keduanya ditolak.
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
};
const tglOpsi = (v: string | null | undefined, field: string): string | null => {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (!tglSah(t)) throw new ApError(400, `${field} harus berformat YYYY-MM-DD`, field);
  return t;
};

export interface FakturBarisHasil {
  accurate_detail_id: number;
  item_no: string | null;
  item_desc: string;
  qty: string;
  return_qty: string;
  unit_name: string | null;
  unit_price: string | null;
  disc_raw: string | null;
  disc_amount: string;
  po_number: string | null;
  receive_number: string | null;
  supplier_doc_number: string | null;
  status: StatusBaris;
  temuan: Temuan[];
}
export interface FakturRingkas {
  accurate_id: number;
  number: string;
  bill_number: string | null;
  vendor_id: number | null;
  vendor_name: string;
  trans_date: string;
  due_date: string | null;
  status_name: string | null;
  approval_status: string | null;
  total_amount: string | null;
  hasil: HasilFaktur;
  jumlah_baris: number;
  po_numbers: string[];
  supplier_docs: string[];
}
export interface FakturDetail extends FakturRingkas {
  description: string | null;
  baris: FakturBarisHasil[];
}

interface RowFaktur {
  accurate_id: string | number;
  number: string;
  bill_number: string | null;
  vendor_id: string | number | null;
  vendor_name: string;
  trans_date: string;
  due_date: string | null;
  status_name: string | null;
  approval_status: string | null;
  total_amount: string | null;
  description: string | null;
}

// Faktur final = disetujui, bukan draft (`DFT.n [...]`), bukan batal — sama dengan fakturDraft/fakturBatal.
const finalSql = (a: string) =>
  `${a}.approval_status = 'APPROVED' AND ${a}.number NOT LIKE 'DFT.%' AND COALESCE(${a}.status_name, '') !~* 'batal|cancel|void'`;

// Satu query: baris + konteks PO/penerimaan + kumulatif faktur FINAL lain. Agregat kumulatif dihitung SEKALI per
// baris PO/penerimaan (CTE group-by, linear) — bukan LATERAL per baris, yang kuadratik bila banyak faktur menumpuk
// di satu baris. "Lain" = total faktur final − baris ini (bila faktur ini final) + baris saudara di faktur YANG SAMA
// bila faktur ini belum final (barang sama di dua baris draft = total gabungan).
async function barisFaktur(ids: number[]): Promise<Map<number, FakturBarisHasil[]>> {
  const sql = db();
  const fx = sql.unsafe(finalSql("xi"));
  const fl = sql.unsafe(finalSql("li"));
  const rows = await sql`
    WITH dasar AS (
      SELECT accurate_po_detail_id AS po_id, accurate_receive_detail_id AS rcv_id
      FROM accurate_purchase_invoice_line WHERE invoice_id = ANY(${ids}::bigint[])
    ),
    fin_po AS (
      SELECT x.accurate_po_detail_id AS k, sum(x.qty - x.return_qty) AS q
      FROM accurate_purchase_invoice_line x JOIN accurate_purchase_invoice xi ON xi.accurate_id = x.invoice_id
      WHERE x.accurate_po_detail_id IN (SELECT po_id FROM dasar WHERE po_id IS NOT NULL) AND ${fx}
      GROUP BY 1
    ),
    fin_rcv AS (
      SELECT x.accurate_receive_detail_id AS k, sum(x.qty - x.return_qty) AS q
      FROM accurate_purchase_invoice_line x JOIN accurate_purchase_invoice xi ON xi.accurate_id = x.invoice_id
      WHERE x.accurate_receive_detail_id IN (SELECT rcv_id FROM dasar WHERE rcv_id IS NOT NULL) AND ${fx}
      GROUP BY 1
    ),
    isi AS (
      SELECT l.*, (${fl}) AS inv_final, (l.qty - l.return_qty) AS netto,
        sum(l.qty - l.return_qty) OVER (PARTITION BY l.invoice_id, l.accurate_po_detail_id) - (l.qty - l.return_qty) AS sib_po,
        sum(l.qty - l.return_qty) OVER (PARTITION BY l.invoice_id, l.accurate_receive_detail_id) - (l.qty - l.return_qty) AS sib_rcv
      FROM accurate_purchase_invoice_line l JOIN accurate_purchase_invoice li ON li.accurate_id = l.invoice_id
      WHERE l.invoice_id = ANY(${ids}::bigint[])
    )
    SELECT l.*,
      (poi.accurate_detail_id IS NOT NULL) AS po_ada, poi.qty_ordered, poi.unit AS po_unit,
      poi.unit_price AS po_unit_price, poi.disc_raw AS po_disc_raw,
      (rl.accurate_detail_id IS NOT NULL) AS rcv_ada, rl.qty AS rcv_qty, rl.unit AS rcv_unit,
      r.accurate_status AS rcv_status, r.accurate_approval AS rcv_approval, r.supplier_doc_number,
      CASE WHEN l.accurate_po_detail_id IS NULL THEN 0 WHEN l.inv_final
        THEN COALESCE(fp.q, 0) - l.netto ELSE COALESCE(fp.q, 0) + l.sib_po END AS qty_lain_po,
      CASE WHEN l.accurate_receive_detail_id IS NULL THEN 0 WHEN l.inv_final
        THEN COALESCE(fr.q, 0) - l.netto ELSE COALESCE(fr.q, 0) + l.sib_rcv END AS qty_lain_rcv
    FROM isi l
    LEFT JOIN purchase_order_item poi ON poi.accurate_detail_id = l.accurate_po_detail_id
    LEFT JOIN inbound_receiving_line rl ON rl.accurate_detail_id = l.accurate_receive_detail_id
    LEFT JOIN inbound_receiving r ON r.id = rl.receiving_id
    LEFT JOIN fin_po fp ON fp.k = l.accurate_po_detail_id
    LEFT JOIN fin_rcv fr ON fr.k = l.accurate_receive_detail_id
    ORDER BY l.invoice_id, l.accurate_detail_id
  `;
  const out = new Map<number, FakturBarisHasil[]>();
  for (const r of rows as unknown as Record<string, unknown>[]) {
    const b: BarisFaktur = {
      accurate_detail_id: Number(r.accurate_detail_id),
      item_no: (r.item_no as string | null) ?? null,
      item_desc: String(r.item_desc),
      qty: String(r.qty),
      return_qty: String(r.return_qty ?? 0),
      unit_name: (r.unit_name as string | null) ?? null,
      unit_price: r.unit_price != null ? String(r.unit_price) : null,
      disc_raw: (r.disc_raw as string | null) ?? null,
      disc_amount: String(r.disc_amount ?? 0),
      accurate_po_detail_id: r.accurate_po_detail_id != null ? Number(r.accurate_po_detail_id) : null,
      accurate_receive_detail_id: r.accurate_receive_detail_id != null ? Number(r.accurate_receive_detail_id) : null,
    };
    const k: KonteksBaris = {
      po: r.po_ada ? { qty_ordered: String(r.qty_ordered), unit: (r.po_unit as string | null) ?? null, unit_price: r.po_unit_price != null ? String(r.po_unit_price) : null, disc_raw: (r.po_disc_raw as string | null) ?? null } : null,
      penerimaan: r.rcv_ada ? { qty: String(r.rcv_qty), unit: (r.rcv_unit as string | null) ?? null, final: penerimaanFinal((r.rcv_status as string | null) ?? null, (r.rcv_approval as string | null) ?? null) } : null,
      qty_lain_po: String(r.qty_lain_po ?? 0),
      qty_lain_penerimaan: String(r.qty_lain_rcv ?? 0),
    };
    const h = evaluasiBaris(b, k);
    const arr = out.get(Number(r.invoice_id)) ?? [];
    arr.push({
      accurate_detail_id: b.accurate_detail_id, item_no: b.item_no, item_desc: b.item_desc, qty: String(b.qty),
      return_qty: String(b.return_qty), unit_name: b.unit_name, unit_price: b.unit_price != null ? String(b.unit_price) : null,
      disc_raw: b.disc_raw, disc_amount: String(b.disc_amount),
      po_number: (r.po_number as string | null) ?? null, receive_number: (r.receive_number as string | null) ?? null,
      supplier_doc_number: (r.supplier_doc_number as string | null) ?? null,
      status: h.status, temuan: h.temuan,
    });
    out.set(Number(r.invoice_id), arr);
  }
  return out;
}

function rakit(f: RowFaktur, baris: FakturBarisHasil[]): FakturRingkas {
  const hasil = evaluasiFaktur(
    { number: f.number, approval_status: f.approval_status, status_name: f.status_name },
    baris.map((b) => ({ status: b.status, temuan: b.temuan })),
  );
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    accurate_id: Number(f.accurate_id),
    number: f.number,
    bill_number: f.bill_number,
    vendor_id: f.vendor_id != null ? Number(f.vendor_id) : null,
    vendor_name: f.vendor_name,
    trans_date: String(f.trans_date),
    due_date: f.due_date != null ? String(f.due_date) : null,
    status_name: f.status_name,
    approval_status: f.approval_status,
    total_amount: f.total_amount,
    hasil,
    jumlah_baris: baris.length,
    po_numbers: uniq(baris.map((b) => b.po_number)),
    supplier_docs: uniq(baris.map((b) => b.supplier_doc_number)),
  };
}

const HEADER_KOLOM = `f.accurate_id, f.number, f.bill_number, f.vendor_id, f.vendor_name, f.trans_date::text AS trans_date,
  f.due_date::text AS due_date, f.status_name, f.approval_status, f.total_amount::text AS total_amount, f.description`;

export interface ApListOpts {
  status?: string | null;
  q?: string | null;
  vendor_id?: number | null;
  dari?: string | null;
  sampai?: string | null;
  limit?: number | null;
  offset?: number | null;
}
export const AP_PAGE_DEFAULT = 50;
export const AP_PAGE_MAKS = 500;

export interface ApRingkasan {
  total: number;
  per_status: Record<StatusFaktur, number>;
}
export interface ApListResult {
  items: FakturRingkas[];
  total: number;
  ringkasan: ApRingkasan;
  terpotong: boolean;
  sinkron: { last_synced_at: string | null; last_run_ok: boolean | null; ringkasan: unknown } | null;
}

const isStatusFaktur = (v: unknown): v is StatusFaktur => (STATUS_FAKTUR as readonly string[]).includes(String(v));

export async function listFaktur(o: ApListOpts = {}): Promise<ApListResult> {
  const status = o.status ? String(o.status).toUpperCase() : null;
  if (status && !isStatusFaktur(status)) throw new ApError(400, `status harus salah satu dari ${STATUS_FAKTUR.join(", ")}`, "status");
  const dari = tglOpsi(o.dari, "dari");
  const sampai = tglOpsi(o.sampai, "sampai");
  if (dari && sampai && dari > sampai) throw new ApError(400, "dari tidak boleh setelah sampai", "dari");
  const q = clean(o.q, AP_Q_MAKS);
  const limit = Math.min(Math.max(Math.trunc(o.limit ?? AP_PAGE_DEFAULT) || AP_PAGE_DEFAULT, 1), AP_PAGE_MAKS);
  const offset = Math.max(Math.trunc(o.offset ?? 0) || 0, 0);

  const sql = db();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const vendor = o.vendor_id != null && Number.isFinite(o.vendor_id) ? o.vendor_id : null;
  const fak = (await sql`
    SELECT ${sql.unsafe(HEADER_KOLOM)}
    FROM accurate_purchase_invoice f
    WHERE (${dari}::date IS NULL OR f.trans_date >= ${dari}::date)
      AND (${sampai}::date IS NULL OR f.trans_date <= ${sampai}::date)
      AND (${vendor}::bigint IS NULL OR f.vendor_id = ${vendor}::bigint)
      AND (${like}::text IS NULL
        OR f.number ILIKE ${like} OR f.bill_number ILIKE ${like} OR f.vendor_name ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM accurate_purchase_invoice_line l
          LEFT JOIN inbound_receiving_line rl ON rl.accurate_detail_id = l.accurate_receive_detail_id
          LEFT JOIN inbound_receiving r ON r.id = rl.receiving_id
          WHERE l.invoice_id = f.accurate_id
            AND (l.po_number ILIKE ${like} OR l.receive_number ILIKE ${like} OR r.supplier_doc_number ILIKE ${like})
        ))
    ORDER BY f.trans_date DESC, f.accurate_id DESC
    LIMIT ${AP_LIST_MAKS + 1}
  `) as unknown as RowFaktur[];
  const terpotong = fak.length > AP_LIST_MAKS;
  const rows = terpotong ? fak.slice(0, AP_LIST_MAKS) : fak;

  const baris = rows.length ? await barisFaktur(rows.map((r) => Number(r.accurate_id))) : new Map<number, FakturBarisHasil[]>();
  const semua = rows.map((r) => rakit(r, baris.get(Number(r.accurate_id)) ?? []));

  const per = Object.fromEntries(STATUS_FAKTUR.map((s) => [s, 0])) as Record<StatusFaktur, number>;
  for (const f of semua) per[f.hasil.status]++;
  const tersaring = status ? semua.filter((f) => f.hasil.status === status) : semua;

  return {
    items: tersaring.slice(offset, offset + limit),
    total: tersaring.length,
    ringkasan: { total: semua.length, per_status: per },
    terpotong,
    sinkron: await keadaanSinkron(),
  };
}

export async function getFaktur(id: number): Promise<FakturDetail | null> {
  const sql = db();
  const [f] = (await sql`SELECT ${sql.unsafe(HEADER_KOLOM)} FROM accurate_purchase_invoice f WHERE f.accurate_id = ${id}`) as unknown as RowFaktur[];
  if (!f) return null;
  const baris = (await barisFaktur([id])).get(id) ?? [];
  return { ...rakit(f, baris), description: f.description, baris };
}

async function keadaanSinkron(): Promise<ApListResult["sinkron"]> {
  const sql = db();
  const [r] = await sql`
    SELECT last_synced_at::text AS last_synced_at, last_run_ok, last_run_summary
    FROM accurate_sync_state WHERE entity = ${AP_SYNC_ENTITY}
  `;
  return r ? { last_synced_at: r.last_synced_at as string, last_run_ok: r.last_run_ok as boolean, ringkasan: r.last_run_summary } : null;
}

// ── Cermin (dipakai accurateSync.syncPurchaseInvoices) ──────────────────────

export interface AccurateInvoiceHeader {
  accurate_id: number;
  number: string;
  bill_number: string | null;
  vendor_id: number | null;
  vendor_name: string;
  trans_date: string;
  due_date: string | null;
  status_name: string | null;
  approval_status: string | null;
  total_amount: number | null;
  description: string | null;
  last_update: string | null;
  opt_lock: number | null;
}
export interface AccurateInvoiceLine {
  accurate_detail_id: number;
  item_no: string | null;
  item_desc: string;
  qty: number;
  return_qty: number;
  unit_name: string | null;
  unit_ratio: number | null;
  unit_price: number | null;
  disc_raw: string | null;
  disc_amount: number;
  total_price: number | null;
  accurate_po_id: number | null;
  accurate_po_detail_id: number | null;
  po_number: string | null;
  accurate_receive_id: number | null;
  accurate_receive_detail_id: number | null;
  receive_number: string | null;
}

const txt = (v: unknown): string | null => (v != null && String(v).trim() ? String(v) : null);
const idPos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const angka = (v: unknown): number => Number(v ?? 0) || 0;
const angkaOpsi = (v: unknown): number | null => (v == null || v === "" ? null : Number(v) || 0);

/**
 * purchase-invoice/detail.do → baris cermin. Hanya baris BARANG (detailItem); biaya/pembulatan
 * (detailExpense, mis. -0,5) bukan bagian match. Id PO/penerimaan diambil di tingkat baris.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function petakanBarisDetail(d: any): AccurateInvoiceLine[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((d?.detailItem ?? []) as any[])
    .filter((it) => it?.id != null)
    .map((it) => ({
      accurate_detail_id: Number(it.id),
      item_no: txt(it.item?.no),
      item_desc: String(it.detailName ?? it.item?.name ?? "(tanpa nama)"),
      qty: angka(it.quantity),
      return_qty: angka(it.returnQuantity),
      unit_name: txt(it.itemUnit?.name),
      unit_ratio: angkaOpsi(it.unitRatio),
      unit_price: angkaOpsi(it.unitPrice),
      disc_raw: it.itemDiscPercent != null ? String(it.itemDiscPercent).trim() : null,
      disc_amount: angka(it.itemCashDiscount),
      total_price: angkaOpsi(it.totalPrice),
      accurate_po_id: idPos(it.purchaseOrderId ?? it.purchaseOrder?.id),
      accurate_po_detail_id: idPos(it.purchaseOrderDetailId),
      po_number: txt(it.purchaseOrder?.number),
      accurate_receive_id: idPos(it.receiveItemId ?? it.receiveItem?.id),
      accurate_receive_detail_id: idPos(it.receiveItemDetailId),
      receive_number: txt(it.receiveItem?.number),
    }));
}

/** Batas hapus sekali sapu: lebih dari ini = respons Accurate mencurigakan (terpotong), jangan menghapus. */
export const PRUNE_MAKS_PERSEN = 20;

/**
 * Buang faktur cermin (bertanggal >= since) yang tak lagi ada di daftar Accurate — dihapus/dibatalkan permanen
 * di sana, kalau tidak jadi hantu yang ikut hitungan kumulatif. Hanya dipanggil setelah sapuan PENUH yang tak terpotong.
 */
export async function pruneInvoices(seenIds: number[], since: string): Promise<{ pruned: number; skipped: boolean }> {
  const sql = db();
  if (seenIds.length === 0) return { pruned: 0, skipped: true };
  const [r] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE NOT (accurate_id = ANY(${seenIds}::bigint[])))::int AS hilang
    FROM accurate_purchase_invoice WHERE trans_date >= ${since}::date
  `;
  const total = Number(r?.total ?? 0);
  const hilang = Number(r?.hilang ?? 0);
  if (hilang === 0) return { pruned: 0, skipped: false };
  if (total > 0 && (hilang * 100) / total > PRUNE_MAKS_PERSEN) return { pruned: 0, skipped: true };
  await sql`DELETE FROM accurate_purchase_invoice WHERE trans_date >= ${since}::date AND NOT (accurate_id = ANY(${seenIds}::bigint[]))`;
  return { pruned: hilang, skipped: false };
}

export async function upsertAccurateInvoices(rows: AccurateInvoiceHeader[]): Promise<number> {
  const sql = db();
  for (const r of rows) {
    await sql`
      INSERT INTO accurate_purchase_invoice (
        accurate_id, number, bill_number, vendor_id, vendor_name, trans_date, due_date, status_name,
        approval_status, total_amount, description, accurate_last_update, opt_lock, synced_at
      )
      VALUES (
        ${r.accurate_id}, ${r.number}, ${r.bill_number}, ${r.vendor_id},
        COALESCE((SELECT NULLIF(name, '') FROM accurate_vendor WHERE id = ${r.vendor_id}), ${r.vendor_name}),
        ${r.trans_date}, ${r.due_date}, ${r.status_name}, ${r.approval_status}, ${r.total_amount}, ${r.description},
        ${r.last_update}, ${r.opt_lock}, now()
      )
      ON CONFLICT (accurate_id) DO UPDATE SET
        number = EXCLUDED.number, bill_number = EXCLUDED.bill_number, vendor_id = EXCLUDED.vendor_id,
        vendor_name = EXCLUDED.vendor_name, trans_date = EXCLUDED.trans_date, due_date = EXCLUDED.due_date,
        status_name = EXCLUDED.status_name, approval_status = EXCLUDED.approval_status,
        total_amount = EXCLUDED.total_amount, description = EXCLUDED.description,
        accurate_last_update = EXCLUDED.accurate_last_update, opt_lock = EXCLUDED.opt_lock, synced_at = now()
    `;
  }
  return rows.length;
}

// Detail ditarik ulang bila lastUpdate berubah, atau optLock (bila list menyediakannya) berubah.
const PENDING_WHERE = `items_last_update IS DISTINCT FROM accurate_last_update
  OR (opt_lock IS NOT NULL AND items_opt_lock IS DISTINCT FROM opt_lock)`;

export async function pendingInvoiceDetails(limit: number): Promise<{ accurate_id: number; last_update: string | null; opt_lock: number | null }[]> {
  const sql = db();
  const rows = await sql`
    SELECT accurate_id, accurate_last_update::text AS last_update, opt_lock
    FROM accurate_purchase_invoice WHERE ${sql.unsafe(PENDING_WHERE)}
    ORDER BY trans_date DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({ accurate_id: Number(r.accurate_id), last_update: (r.last_update as string | null) ?? null, opt_lock: r.opt_lock != null ? Number(r.opt_lock) : null }));
}

export async function countPendingInvoiceDetails(): Promise<number> {
  const sql = db();
  const [r] = await sql`SELECT count(*)::int AS n FROM accurate_purchase_invoice WHERE ${sql.unsafe(PENDING_WHERE)}`;
  return Number(r?.n ?? 0);
}

export async function replaceInvoiceLines(
  invoiceId: number, lastUpdate: string | null, optLock: number | null, lines: AccurateInvoiceLine[],
): Promise<number> {
  const sql = db();
  return sql.begin(async (tx) => {
    const ids = lines.map((l) => l.accurate_detail_id);
    await tx`
      DELETE FROM accurate_purchase_invoice_line
      WHERE invoice_id = ${invoiceId} AND NOT (accurate_detail_id = ANY(${ids}::bigint[]))
    `;
    for (const l of lines) {
      await tx`
        INSERT INTO accurate_purchase_invoice_line (
          accurate_detail_id, invoice_id, item_no, item_desc, qty, return_qty, unit_name, unit_ratio, unit_price,
          disc_raw, disc_amount, total_price, accurate_po_id, accurate_po_detail_id, po_number,
          accurate_receive_id, accurate_receive_detail_id, receive_number
        )
        VALUES (
          ${l.accurate_detail_id}, ${invoiceId}, ${l.item_no}, ${l.item_desc}, ${l.qty}, ${l.return_qty}, ${l.unit_name},
          ${l.unit_ratio}, ${l.unit_price}, ${l.disc_raw}, ${l.disc_amount}, ${l.total_price}, ${l.accurate_po_id},
          ${l.accurate_po_detail_id}, ${l.po_number}, ${l.accurate_receive_id}, ${l.accurate_receive_detail_id}, ${l.receive_number}
        )
        ON CONFLICT (accurate_detail_id) DO UPDATE SET
          invoice_id = EXCLUDED.invoice_id, item_no = EXCLUDED.item_no, item_desc = EXCLUDED.item_desc,
          qty = EXCLUDED.qty, return_qty = EXCLUDED.return_qty, unit_name = EXCLUDED.unit_name,
          unit_ratio = EXCLUDED.unit_ratio, unit_price = EXCLUDED.unit_price, disc_raw = EXCLUDED.disc_raw,
          disc_amount = EXCLUDED.disc_amount, total_price = EXCLUDED.total_price,
          accurate_po_id = EXCLUDED.accurate_po_id, accurate_po_detail_id = EXCLUDED.accurate_po_detail_id,
          po_number = EXCLUDED.po_number, accurate_receive_id = EXCLUDED.accurate_receive_id,
          accurate_receive_detail_id = EXCLUDED.accurate_receive_detail_id, receive_number = EXCLUDED.receive_number,
          updated_at = now()
      `;
    }
    await tx`
      UPDATE accurate_purchase_invoice SET items_last_update = ${lastUpdate}, items_opt_lock = ${optLock}
      WHERE accurate_id = ${invoiceId}
    `;
    return lines.length;
  });
}
