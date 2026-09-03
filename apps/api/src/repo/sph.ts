// F15 — SPH Generator + Pricing Library (app layer di atas F142 Price Book).
// Beda dari A6 batch (salesdoc.ts getDealsNeedingDoc, estimated_value kasar):
// AM pilih baris katalog product_pricelist PERSIS (bukan ketik nama bebas)
// via form intake ATAU hashtag WA #SPH → harga per-line REAL (bukan
// placeholder), surat dirangkai LLM (services/ai) dgn fallback deterministik
// kalau AI tak terjangkau, tabel harga SELALU ditempel apa adanya dari hasil
// hitung sistem (tidak pernah diserahkan ke LLM buat dihitung ulang).

import { createHash } from "node:crypto";

import { db, isDbEnabled } from "../db.js";
import { callAi, aiDryRun } from "../ai.js";
import { PPN_PRICEBOOK, PERIODE_DEFAULT } from "./pricebook.js";

const rnd = (v: number) => Math.round(v); // half-up, sama konvensi pricebook.ts

export interface SphItemInput {
  pricelist_item_id: number;
  qty: number;
  diskon_requested: number; // fraksi, mis. 0.10 = 10%
}

export interface CreateSphInput {
  deal_id?: string | null;
  // Sejak "link data existing" (susulan F22): kalau `customer_id` DIISI, ia
  // wajib id `accurate_customer` yang benar-benar ada, dan `customer_name`
  // di-DERIVE dari mirror itu — nama dari klien diabaikan, jadi nama di surat
  // tak bisa menyimpang dari master hanya karena orang mengetik ulang.
  //
  // Tetap OPSIONAL di lapisan repo karena jalur WA `#SPH` (inbound.ts) hanya
  // punya nama yang diketik AM di pesan, tak ada id. Kewajiban memilih dari
  // katalog ditegakkan di `POST /sph` (jalur form web), bukan di sini —
  // menaruhnya di sini akan mematikan #SPH.
  //
  // Kolom DB-nya `sales_doc.customer_id VARCHAR(50)` (bukan FK sungguhan),
  // jadi id numerik Accurate disimpan sebagai string.
  customer_id?: string | null;
  // Wajib kalau `customer_id` kosong (jalur WA). Diabaikan kalau ada id.
  customer_name?: string;
  am_id?: string | null;
  periode?: string;
  items: SphItemInput[];
  created_by?: string | null;
  // Opsional krn jalur #SPH WA (format 1-baris, lihat parsers/sph.ts) tak
  // punya tempat utk ini — default "(diisi Admin Penawaran)" dipakai kalau
  // kosong. Jalur form web WAJIB isi (lihat validasi di apps/web /sph/new).
  terms?: { paymentTerms?: string; shippingTerms?: string; validityDays?: number };
}

export interface SphLineItemRow {
  id: number;
  pricelist_item_id: number;
  nama: string;
  qty: number;
  diskonRequested: number;
  diskonMaksSnapshot: number;
  priceList: number;
  hargaNett: number;
  nettPpn: number;
  belowFloor: boolean; // secara matematis harusnya selalu false kalau enforcement dijaga; ditampilkan tetap utk transparansi
  // HANDOVER §6 — true kalau nama produk ini dipakai >1 SKU (brand+nama sama,
  // varian/harga beda) SAAT draft dibuat. false = WAJIB dikonfirmasi Admin
  // Penawaran (variantConfirm) sebelum approve boleh jalan.
  variantConfirmed: boolean;
  variantConfirmedBy: string | null;
}

export interface SphDetail {
  id: string;
  dealId: string | null;
  customerName: string | null;
  status: string;
  title: string | null;
  draftText: string;
  approvedBy: string | null;
  hodReviewedBy: string | null;
  hodReviewedAt: string | null;
  createdAt: string;
  items: SphLineItemRow[];
  total: { priceList: number; nett: number; ppn: number };
}

export interface CreateSphResult {
  ok: boolean;
  error?: string;
  id?: string;
}

async function logHumanAction(
  eventType: string,
  actor: string | null | undefined,
  payload: Record<string, unknown>,
  decision: string,
): Promise<void> {
  const sql = db();
  const hash = createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex");
  // agent_id FK ke agent_registry (cuma A1-A12 terdaftar) — dicatat sbg 'A6'
  // spt aksi manusia lain di siklus sales_doc (salesdoc.ts), walau baris ini
  // asalnya dari form intake F15, bukan batch LLM A6. Satu domain, satu jejak audit.
  await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES
      ('D1', ${`sph-${hash.slice(0, 8)}`}, 'A6', 5, ${eventType}, 'R2', ${hash}, ${hash},
       ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])}, ${actor ?? null}, ${decision})
  `;
}

function priceTableBlock(items: SphLineItemRow[], total: SphDetail["total"]): string {
  const rows = items
    .map(
      (it, i) =>
        `| ${i + 1} | ${it.nama} | ${it.qty} | Rp${it.hargaNett.toLocaleString("id-ID")} | Rp${(it.hargaNett * it.qty).toLocaleString("id-ID")} |`,
    )
    .join("\n");
  return (
    `| No | Produk | Qty | Harga Nett/Unit | Jumlah |\n${rows}\n\n` +
    `Subtotal Nett: Rp${total.nett.toLocaleString("id-ID")}\n` +
    `PPN 11% (dari nett): Rp${(total.ppn - total.nett).toLocaleString("id-ID")}\n` +
    `Total: Rp${total.ppn.toLocaleString("id-ID")}`
  );
}

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
// WIB (+7) — pola sama dgn wibDate() di inbound.ts/reminder.ts, hindari
// jebakan `current_date`/`new Date()` UTC yg beda hari dgn WIB dini hari.
function tanggalIndoWib(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.getUTCDate()} ${BULAN_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface SphTerms {
  // "Nomor SPH" BELUM ada skema penomoran resmi dari Direktur (beda dari
  // tanggal yg bisa dipastikan dari server) — dibiarkan actionable-placeholder,
  // BUKAN ditebak sendiri (nomor dokumen biasanya terikat sistem
  // penomoran/register fisik perusahaan, bukan hal yg aman diasumsikan).
  nomor?: string;
  paymentTerms: string;
  shippingTerms: string;
  validityDays?: number; // default 14
}

// Header/footer surat SELALU ditulis sistem (bukan AI) — nomor/tanggal/syarat
// itu FAKTA, bukan prosa, jadi tak pernah didelegasikan ke LLM (pelajaran dari
// insiden tabel dobel: apa pun yg dibiarkan AI tulis sendiri, LLM cenderung
// tetap menulisnya walau sudah dibilang "jangan", risikonya nomor/tanggal beda
// dgn yang sebenarnya).
function letterHeader(customerName: string, nomor?: string): string {
  return `SURAT PENAWARAN HARGA (SPH)\nNomor: ${nomor || "[diisi Admin Penawaran]"} | Tanggal: ${tanggalIndoWib()}\n\nKepada Yth. ${customerName}\n`;
}
function letterFooter(terms: SphTerms): string {
  const hari = terms.validityDays ?? 14;
  return (
    `\nSyarat & Ketentuan:\n` +
    `- Pembayaran: ${terms.paymentTerms}\n` +
    `- Pengiriman: ${terms.shippingTerms}\n` +
    `- Masa berlaku penawaran: ${hari} hari sejak tanggal di atas\n\n` +
    `Hormat kami,\nTim Penjualan WRG\n`
  );
}

// Draft deterministik penuh (fallback kalau AI tak terjangkau/mati).
function renderSphTextFallback(
  customerName: string,
  items: SphLineItemRow[],
  total: SphDetail["total"],
  terms: SphTerms,
): string {
  return (
    `${letterHeader(customerName, terms.nomor)}\n` +
    `Bersama ini PT Wahana Rizky Gumilang (WRG) menyampaikan penawaran harga sebagai berikut:\n\n` +
    `${priceTableBlock(items, total)}\n` +
    letterFooter(terms)
  );
}

// LLM (services/ai /sales-doc, agen A6) HANYA diminta menulis 1-3 kalimat
// pengantar — nomor/tanggal/tabel/syarat/penutup SEMUA ditulis sistem (lihat
// letterHeader/letterFooter/priceTableBlock), tak ada satu pun bagian
// struktural/faktual yg didelegasikan ke LLM. Gagal/AI mati → fallback
// deterministik penuh (tidak pernah blank/error ke user).
async function draftSphText(
  customerName: string,
  items: SphLineItemRow[],
  total: SphDetail["total"],
  terms: SphTerms,
): Promise<{ text: string; model: string | null }> {
  const table = priceTableBlock(items, total);
  try {
    const { status, data } = await callAi("/sales-doc", {
      customer_name: customerName,
      stage: "Quotation",
      estimated_value: total.ppn,
      product_ids: items.map((it) => it.nama),
      doc_type: "sph",
      dry_run: aiDryRun(),
      // Larang LLM/template gambar nomor/tanggal/tabel/syarat/penutup sendiri
      // (lihat services/ai salesdoc.py) — semua itu ditulis sistem, AI cuma
      // kontribusi kalimat pengantar.
      has_final_pricing: true,
    });
    if (status >= 400) throw new Error(`status ${status}`);
    const intro = String(data.draft_text ?? "").trim();
    if (!intro) throw new Error("draft_text kosong");
    return {
      text: `${letterHeader(customerName, terms.nomor)}\n${intro}\n\n${table}\n${letterFooter(terms)}`,
      model: (data.model as string | undefined) ?? null,
    };
  } catch {
    // services/ai tak jalan (ECONNREFUSED) atau error lain — jangan sampai
    // gagal bikin draft SPH cuma krn AI service down, pakai template penuh.
    return { text: renderSphTextFallback(customerName, items, total, terms), model: null };
  }
}

export async function createSphDraft(input: CreateSphInput): Promise<CreateSphResult> {
  if (!isDbEnabled()) return { ok: false, error: "DATABASE_URL off" };
  if (!input.items || input.items.length === 0) return { ok: false, error: "minimal 1 item" };
  const sql = db();
  const periode = input.periode || PERIODE_DEFAULT;

  // Resolusi customer. Pola sama installation.ts: id divalidasi ke mirror
  // SEBELUM insert, dan namanya diambil dari hasil lookup — bukan dipercaya
  // dari input klien. NULLIF(name,'') karena kolom mirror bisa empty-string
  // (bukan NULL), jadi COALESCE saja tak cukup; jatuh ke `no` supaya nama di
  // surat tak pernah kosong.
  const rawCid = String(input.customer_id ?? "").trim();
  let customerId: string | null = null;
  let customerName = String(input.customer_name ?? "").trim();
  if (rawCid) {
    if (!/^\d+$/.test(rawCid)) {
      return { ok: false, error: `customer_id "${rawCid}" bukan id Accurate yang sah` };
    }
    const [cust] = await sql<{ id: string; nama: string }[]>`
      SELECT id::text AS id, COALESCE(NULLIF(name, ''), no, '') AS nama
      FROM accurate_customer WHERE id = ${Number(rawCid)}
    `;
    if (!cust) {
      return {
        ok: false,
        error: `customer #${rawCid} tak ada di katalog Accurate — pilih dari daftar, atau sinkronkan katalog customer dulu`,
      };
    }
    customerId = cust.id;
    customerName = String(cust.nama).trim();
  }
  if (!customerName) {
    return { ok: false, error: "customer wajib — pilih dari katalog (form web) atau tulis namanya (#SPH)" };
  }

  const ids = input.items.map((it) => it.pricelist_item_id);
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, nama, brand, price_list, diskon_maks
    FROM product_pricelist
    WHERE periode = ${periode} AND id = ANY(${ids})
  `;
  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  // HANDOVER §6 — set (brand,nama) yg dipakai >1 SKU di SELURUH katalog
  // periode ini (bukan cuma di antara item yg diminta) — itu yg menentukan
  // baris mana WAJIB dikonfirmasi Admin Penawaran nanti.
  const ambiguousRows = await sql<Record<string, unknown>[]>`
    SELECT brand, nama FROM product_pricelist WHERE periode = ${periode} GROUP BY brand, nama HAVING count(*) > 1
  `;
  const ambiguousSet = new Set(ambiguousRows.map((r) => `${r.brand}::${r.nama}`));

  const lineItems: (SphLineItemRow & { priceListRaw: number })[] = [];
  for (const it of input.items) {
    const row = byId.get(it.pricelist_item_id);
    if (!row) return { ok: false, error: `item katalog #${it.pricelist_item_id} tidak ditemukan di periode ${periode}` };
    if (!(it.qty > 0)) return { ok: false, error: `qty item "${row.nama}" harus > 0` };
    const diskonMaks = Number(row.diskon_maks);
    if (it.diskon_requested < 0 || it.diskon_requested > diskonMaks) {
      return {
        ok: false,
        error: `diskon utk "${row.nama}" (${(it.diskon_requested * 100).toFixed(0)}%) melebihi diskon maks SKU ini (${(diskonMaks * 100).toFixed(0)}%)`,
      };
    }
    const priceList = Number(row.price_list);
    const hargaNett = rnd(priceList * (1 - it.diskon_requested));
    const nettPpn = rnd(hargaNett * (1 + PPN_PRICEBOOK));
    // Matematis harusnya selalu false selama diskon_requested <= diskon_maks
    // (harga_nett floor = hasil hitung PERSIS di diskon_maks) — flag tetap
    // dihitung, bukan diasumsikan, buat jaga-jaga kalau asumsi ini pernah salah.
    const floor = rnd(priceList * (1 - diskonMaks));
    lineItems.push({
      id: 0,
      pricelist_item_id: it.pricelist_item_id,
      nama: String(row.nama),
      qty: it.qty,
      diskonRequested: it.diskon_requested,
      diskonMaksSnapshot: diskonMaks,
      priceList,
      priceListRaw: priceList,
      hargaNett,
      nettPpn,
      belowFloor: hargaNett < floor,
      variantConfirmed: !ambiguousSet.has(`${row.brand}::${row.nama}`),
      variantConfirmedBy: null,
    });
  }

  const total = lineItems.reduce(
    (acc, it) => ({
      priceList: acc.priceList + it.priceList * it.qty,
      nett: acc.nett + it.hargaNett * it.qty,
      ppn: acc.ppn + it.nettPpn * it.qty,
    }),
    { priceList: 0, nett: 0, ppn: 0 },
  );
  const terms: SphTerms = {
    paymentTerms: input.terms?.paymentTerms?.trim() || "(diisi Admin Penawaran)",
    shippingTerms: input.terms?.shippingTerms?.trim() || "(diisi Admin Penawaran)",
    validityDays: input.terms?.validityDays,
  };
  const { text: draftText, model } = await draftSphText(customerName, lineItems, total, terms);
  const title = `SPH — ${customerName}`;

  const docRows = await sql`
    INSERT INTO sales_doc (deal_id, customer_id, customer_name, doc_type, title, draft_text, status, generated_by, model_used)
    VALUES (${input.deal_id ?? null}, ${customerId}, ${customerName}, 'sph', ${title}, ${draftText}, 'draft', 'A6', ${model})
    RETURNING id
  `;
  const docId = docRows[0].id as string;

  for (const it of lineItems) {
    await sql`
      INSERT INTO sph_line_item
        (sales_doc_id, pricelist_item_id, qty, diskon_requested, nama_snapshot, price_list, diskon_maks_snapshot, harga_nett, nett_ppn, variant_confirmed)
      VALUES
        (${docId}, ${it.pricelist_item_id}, ${it.qty}, ${it.diskonRequested}, ${it.nama}, ${it.priceListRaw}, ${it.diskonMaksSnapshot}, ${it.hargaNett}, ${it.nettPpn}, ${it.variantConfirmed})
    `;
  }

  await logHumanAction(
    "sph.draft.create",
    input.created_by,
    { doc_id: docId, customer_id: customerId, customer_name: customerName, item_count: lineItems.length, total, model },
    "create",
  );

  return { ok: true, id: docId };
}

export async function getSphDetail(id: string): Promise<SphDetail | null> {
  const sql = db();
  const docRows = await sql`
    SELECT id, deal_id, customer_name, status, title, draft_text, approved_by,
           hod_reviewed_by, hod_reviewed_at::text, created_at::text
    FROM sales_doc WHERE id = ${id} AND doc_type = 'sph'
  `;
  if (docRows.length === 0) return null;
  const d = docRows[0];

  const itemRows = await sql`
    SELECT id, pricelist_item_id, nama_snapshot, qty, diskon_requested, diskon_maks_snapshot,
           price_list, harga_nett, nett_ppn, variant_confirmed, variant_confirmed_by
    FROM sph_line_item WHERE sales_doc_id = ${id} ORDER BY id
  `;
  const items: SphLineItemRow[] = itemRows.map((r) => {
    const diskonMaks = Number(r.diskon_maks_snapshot);
    const priceList = Number(r.price_list);
    const hargaNett = Number(r.harga_nett);
    const floor = rnd(priceList * (1 - diskonMaks));
    return {
      id: Number(r.id),
      pricelist_item_id: Number(r.pricelist_item_id),
      nama: String(r.nama_snapshot),
      qty: Number(r.qty),
      diskonRequested: Number(r.diskon_requested),
      diskonMaksSnapshot: diskonMaks,
      priceList,
      hargaNett,
      nettPpn: Number(r.nett_ppn),
      belowFloor: hargaNett < floor,
      variantConfirmed: r.variant_confirmed === true,
      variantConfirmedBy: r.variant_confirmed_by ? String(r.variant_confirmed_by) : null,
    };
  });
  const total = items.reduce(
    (acc, it) => ({
      priceList: acc.priceList + it.priceList * it.qty,
      nett: acc.nett + it.hargaNett * it.qty,
      ppn: acc.ppn + it.nettPpn * it.qty,
    }),
    { priceList: 0, nett: 0, ppn: 0 },
  );

  return {
    id: String(d.id),
    dealId: d.deal_id ? String(d.deal_id) : null,
    customerName: d.customer_name ? String(d.customer_name) : null,
    status: String(d.status),
    title: d.title ? String(d.title) : null,
    draftText: String(d.draft_text ?? ""),
    approvedBy: d.approved_by ? String(d.approved_by) : null,
    hodReviewedBy: d.hod_reviewed_by ? String(d.hod_reviewed_by) : null,
    hodReviewedAt: d.hod_reviewed_at ? String(d.hod_reviewed_at) : null,
    createdAt: String(d.created_at),
    items,
    total,
  };
}

export interface SphActionResult {
  ok: boolean;
  error?: string;
  status?: string;
}

// Tahap 1/2: HOD Business review. draft → hod_review. Khusus doc_type='sph'
// (doc_type lain tetap 1 tahap via approveSalesDoc di salesdoc.ts).
export async function hodReviewSph(id: string, reviewerId?: string): Promise<SphActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, doc_type FROM sales_doc WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "dokumen tidak ditemukan" };
  if (rows[0].doc_type !== "sph") return { ok: false, error: "bukan dokumen SPH" };
  if (rows[0].status !== "draft") return { ok: false, error: `dokumen sudah ${rows[0].status}` };
  await sql`UPDATE sales_doc SET status = 'hod_review', hod_reviewed_by = ${reviewerId ?? null}, hod_reviewed_at = now() WHERE id = ${id}`;
  await logHumanAction("sph.hod_review", reviewerId, { doc_id: id }, "review");
  return { ok: true, status: "hod_review" };
}

// HANDOVER §6 — dipanggil dari approveSalesDoc (salesdoc.ts) sbg GATE sebelum
// finalize: baris nama-kembar yg belum dikonfirmasi Admin Penawaran menahan
// approve, biar mis-quote varian gak lolos ke customer.
export async function unconfirmedVariantItems(
  salesDocId: string,
): Promise<{ id: number; nama: string }[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, nama_snapshot AS nama FROM sph_line_item
    WHERE sales_doc_id = ${salesDocId} AND variant_confirmed = false
    ORDER BY id
  `;
  return rows.map((r) => ({ id: Number(r.id), nama: String(r.nama) }));
}

// Admin Penawaran konfirmasi 1 baris nama-kembar sudah benar variannya.
// salesDocId WAJIB cocok — cegah lineItemId nyasar (typo/salah dokumen) diam-diam
// mengonfirmasi baris di SPH lain.
export async function confirmSphVariant(
  salesDocId: string,
  lineItemId: number,
  confirmedBy?: string,
): Promise<SphActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM sph_line_item WHERE id = ${lineItemId} AND sales_doc_id = ${salesDocId}`;
  if (rows.length === 0) return { ok: false, error: "baris item tidak ditemukan di dokumen ini" };
  await sql`
    UPDATE sph_line_item SET variant_confirmed = true, variant_confirmed_by = ${confirmedBy ?? null}, variant_confirmed_at = now()
    WHERE id = ${lineItemId}
  `;
  await logHumanAction("sph.variant_confirm", confirmedBy, { line_item_id: lineItemId, doc_id: salesDocId }, "confirm");
  return { ok: true };
}

// Dipakai #SPH shortcut WA (inbound.ts) — kode Accurate lebih stabil drpd
// nama (gak ada masalah 22-nama-kembar krn kode itu sendiri = kunci SKU).
export async function findPricelistByKode(
  kode: string,
  periode = PERIODE_DEFAULT,
): Promise<{ id: number; nama: string; diskonMaks: number } | null> {
  const sql = db();
  const rows = await sql`SELECT id, nama, diskon_maks FROM product_pricelist WHERE periode = ${periode} AND kode = ${kode}`;
  // 0 (tak ketemu) atau >1 (seharusnya gak pernah, tapi jangan tebak) →
  // treat sbg "tak ketemu", arahkan AM pakai form web yg bisa cari+pilih.
  if (rows.length !== 1) return null;
  return { id: Number(rows[0].id), nama: String(rows[0].nama), diskonMaks: Number(rows[0].diskon_maks) };
}
