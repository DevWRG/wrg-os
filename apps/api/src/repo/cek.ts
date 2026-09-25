import { db } from "../db.js";

// F4 #CEK Faktur/SO/SJ Cross-ref (SXR), Phase A. Lihat plan
// `docs/features/F4-cek-faktur-so-sj-cross-ref.md` untuk konteks lengkap —
// ringkas: tidak ada kolom penghubung SO↔SJ↔Faktur di mirror Accurate manapun
// (accurate_sales_order/_delivery_order cuma customer_name TEKS, bukan FK), dan
// live API Accurate cuma bisa lookup by `id`, bukan by nomor. Jadi korelasi di
// bawah ini SENGAJA heuristik (customer sama + rentang tanggal via
// CEK_DATE_WINDOW_DAYS), bukan join yang pasti benar — balasan WA selalu jujur
// soal ini, bukan cuma saat ambigu.
//
// Fase A = exact-match customer_name SAJA, TANPA fuzzy fallback (keputusan
// eksplisit user/Direktur, ADR-021/"Crawl Gate"/Sprint S9 Phase B ditunda total
// jadi issue terpisah).

export type CekDocType = "so" | "sj" | "invoice";

export interface CekAnchor {
  docType: CekDocType;
  number: string;
  customerName: string | null;
  transDate: string | null; // ISO yyyy-mm-dd
  status: string | null;
  totalAmount: number | null;
}

export interface CekCandidate {
  docType: CekDocType;
  number: string;
  transDate: string | null;
  status: string | null;
}

// postgres.js parse kolom date/timestamptz jadi objek Date — String(dateObj)
// menghasilkan format verbose (bukan ISO). Selalu lewat toISOString().
const toIsoDate = (x: unknown): string | null => (x == null ? null : new Date(x as string | Date).toISOString().slice(0, 10));

export async function findDocByNumber(number: string): Promise<CekAnchor | null> {
  const sql = db();
  const norm = number.trim();
  if (!norm) return null;

  const [so] = await sql`
    SELECT number, trans_date, customer_name, status, total_amount
    FROM accurate_sales_order WHERE lower(number) = lower(${norm}) LIMIT 1
  `;
  if (so) {
    return {
      docType: "so",
      number: String(so.number ?? norm),
      customerName: so.customer_name == null ? null : String(so.customer_name),
      transDate: toIsoDate(so.trans_date),
      status: so.status == null ? null : String(so.status),
      totalAmount: so.total_amount == null ? null : Number(so.total_amount),
    };
  }

  const [sj] = await sql`
    SELECT number, trans_date, customer_name, status
    FROM accurate_delivery_order WHERE lower(number) = lower(${norm}) LIMIT 1
  `;
  if (sj) {
    return {
      docType: "sj",
      number: String(sj.number ?? norm),
      customerName: sj.customer_name == null ? null : String(sj.customer_name),
      transDate: toIsoDate(sj.trans_date),
      status: sj.status == null ? null : String(sj.status),
      totalAmount: null,
    };
  }

  // Invoice tak punya customer_name sendiri — resolve via customer_id ke
  // accurate_customer, sekaligus jadi kunci korelasi yang paling reliable
  // (satu2nya dari 3 tabel yang punya FK customer_id asli, bukan teks bebas).
  const [inv] = await sql`
    SELECT i.number, i.tanggal AS trans_date, i.status, i.total, c.name AS customer_name
    FROM accurate_invoice i
    LEFT JOIN accurate_customer c ON c.id = i.customer_id
    WHERE lower(i.number) = lower(${norm}) LIMIT 1
  `;
  if (inv) {
    return {
      docType: "invoice",
      number: String(inv.number ?? norm),
      customerName: inv.customer_name == null ? null : String(inv.customer_name),
      transDate: toIsoDate(inv.trans_date),
      status: inv.status == null ? null : String(inv.status),
      totalAmount: inv.total == null ? null : Number(inv.total),
    };
  }

  return null;
}

async function findSoCandidates(customerName: string, dateFrom: string, dateTo: string): Promise<CekCandidate[]> {
  const sql = db();
  const rows = await sql`
    SELECT number, trans_date, status FROM accurate_sales_order
    WHERE lower(trim(customer_name)) = lower(trim(${customerName}))
      AND trans_date BETWEEN ${dateFrom} AND ${dateTo}
    ORDER BY trans_date DESC LIMIT 10
  `;
  return rows.map((r) => ({ docType: "so" as const, number: String(r.number ?? ""), transDate: toIsoDate(r.trans_date), status: r.status == null ? null : String(r.status) }));
}

async function findSjCandidates(customerName: string, dateFrom: string, dateTo: string): Promise<CekCandidate[]> {
  const sql = db();
  const rows = await sql`
    SELECT number, trans_date, status FROM accurate_delivery_order
    WHERE lower(trim(customer_name)) = lower(trim(${customerName}))
      AND trans_date BETWEEN ${dateFrom} AND ${dateTo}
    ORDER BY trans_date DESC LIMIT 10
  `;
  return rows.map((r) => ({ docType: "sj" as const, number: String(r.number ?? ""), transDate: toIsoDate(r.trans_date), status: r.status == null ? null : String(r.status) }));
}

async function findInvoiceCandidates(customerName: string, dateFrom: string, dateTo: string): Promise<CekCandidate[]> {
  const sql = db();
  const rows = await sql`
    SELECT i.number, i.tanggal AS trans_date, i.status
    FROM accurate_invoice i
    JOIN accurate_customer c ON c.id = i.customer_id
    WHERE lower(trim(c.name)) = lower(trim(${customerName}))
      AND i.tanggal BETWEEN ${dateFrom} AND ${dateTo}
    ORDER BY i.tanggal DESC LIMIT 10
  `;
  return rows.map((r) => ({ docType: "invoice" as const, number: String(r.number ?? ""), transDate: toIsoDate(r.trans_date), status: r.status == null ? null : String(r.status) }));
}

// Independen dari hasil pencarian kandidat di atas — kalau nama customer ini
// terdaftar >1 kali di Accurate, korelasi manapun tak bisa dipastikan milik
// entitas yang sama walau kandidatnya cuma 1 dan kelihatan rapi.
async function customerNameDuplicateCount(customerName: string): Promise<number> {
  const sql = db();
  const [row] = await sql`SELECT count(*)::int AS n FROM accurate_customer WHERE lower(trim(name)) = lower(trim(${customerName}))`;
  return Number(row?.n ?? 0);
}

const DOC_LABEL: Record<CekDocType, string> = { so: "SO", sj: "SJ", invoice: "Faktur" };

const fmtTanggal = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const fmtRupiah = (n: number | null): string | null => (n == null ? null : `Rp${n.toLocaleString("id-ID")}`);

export async function buildCekReply(query: string): Promise<string> {
  const anchor = await findDocByNumber(query);
  if (!anchor) {
    return `🔎 Dokumen "${query}" tidak ditemukan di data lokal. SO/SJ cuma simpan ±500 transaksi terbaru — kalau dokumen ini lebih lama, cek langsung di Accurate.`;
  }

  const amount = fmtRupiah(anchor.totalAmount);
  const lines: string[] = [
    `📄 *${DOC_LABEL[anchor.docType]} ${anchor.number}* — status: ${anchor.status ?? "-"}, tanggal: ${fmtTanggal(anchor.transDate)}${amount ? `, total: ${amount}` : ""}`,
  ];

  if (!anchor.customerName || !anchor.transDate) {
    lines.push("⚠️ Data customer/tanggal pada dokumen ini tidak lengkap — korelasi ke dokumen lain tidak bisa dilakukan.");
    return lines.join("\n");
  }

  const windowDays = Number(process.env.CEK_DATE_WINDOW_DAYS) || 14;
  const anchorMs = new Date(`${anchor.transDate}T00:00:00Z`).getTime();
  const dateFrom = new Date(anchorMs - windowDays * 86400000).toISOString().slice(0, 10);
  const dateTo = new Date(anchorMs + windowDays * 86400000).toISOString().slice(0, 10);

  const otherTypes = (["so", "sj", "invoice"] as CekDocType[]).filter((t) => t !== anchor.docType);
  for (const t of otherTypes) {
    const candidates =
      t === "so"
        ? await findSoCandidates(anchor.customerName, dateFrom, dateTo)
        : t === "sj"
          ? await findSjCandidates(anchor.customerName, dateFrom, dateTo)
          : await findInvoiceCandidates(anchor.customerName, dateFrom, dateTo);

    if (candidates.length === 0) {
      lines.push(`${DOC_LABEL[t]}: tidak ditemukan di ±${windowDays} hari & customer sama (cakupan data lokal — SO/SJ terbatas ±500 transaksi terbaru).`);
    } else if (candidates.length === 1) {
      const c = candidates[0];
      lines.push(`${DOC_LABEL[t]}: ${c.number} (${c.status ?? "-"}, ${fmtTanggal(c.transDate)})`);
    } else {
      const list = candidates.map((c) => `  • ${c.number} (${c.status ?? "-"}, ${fmtTanggal(c.transDate)})`).join("\n");
      lines.push(`${DOC_LABEL[t]}: ada ${candidates.length} kemungkinan (customer sama, ±${windowDays} hari) — cek manual:\n${list}`);
    }
  }

  if ((await customerNameDuplicateCount(anchor.customerName)) > 1) {
    lines.push("⚠️ Nama customer ini terdaftar >1 kali di Accurate — korelasi di atas tak bisa dipastikan milik entitas yang sama.");
  }
  lines.push("ℹ️ Korelasi berdasarkan nama customer + rentang tanggal, BUKAN ID resmi Accurate — bukan hasil pasti, cek manual kalau perlu kepastian.");

  return lines.join("\n");
}
