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
import { effectivePermissions } from "./rbac.js";
import {
  accountIdDariCustomer,
  bolehFinalSph,
  bolehReviewSph,
  hodBusiness,
  nomorTujuan,
  samaOrang,
  type IdentitasPelaku,
} from "../lib/sales-doc-gate.js";
import { aksiSph, polaCariSph, type AksiSph } from "../lib/sph-alur.js";
import {
  NOMOR_DRAF,
  SYARAT_DEFAULT,
  ambilNomor,
  formatNomorSph,
  gabungSyarat,
  kakiSurat,
  kodeTengahSah,
  nomorUrutSah,
  perbaruiTeksSph,
  syaratDariInputLama,
  tanggalIndo,
  tanggalWib,
  type PenandaTangan,
  type SyaratSph,
} from "../lib/sph-cetak.js";

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
  // Penanda pembuat utk larangan "pembuat tak boleh review/finalisasi SPH-nya
  // sendiri" (lib/sales-doc-gate.ts). Web: app_user.id sesi; WA #SPH: am_id pengirim.
  created_by_user_id?: string | null;
  created_by_am_id?: string | null;
  // Opsional. Kosong → syarat default dari sph_pengaturan (diatur admin), jadi
  // jalur #SPH WA (format 1-baris, tak punya tempat utk syarat) tetap dapat
  // syarat yang layak cetak, bukan placeholder. `terms` = bentuk lama form
  // /sph/new; `syarat` = bentuk baru (lib/sph-cetak.ts SyaratSph). Keduanya
  // masih bisa diubah per SPH selama draft/hod_review (ubahSyaratSph).
  terms?: { paymentTerms?: string; shippingTerms?: string; validityDays?: number };
  syarat?: Partial<SyaratSph>;
}

export interface SphLineItemRow {
  id: number;
  pricelist_item_id: number;
  nama: string;
  kemasan: string | null; // satuan/kemasan snapshot (null utk SPH sebelum migrasi 300)
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
  customerId: string | null; // id accurate_customer (teks); null/nama utk SPH dari #SPH WA
  customerName: string | null;
  status: string;
  title: string | null;
  draftText: string;
  approvedBy: string | null;
  hodReviewedBy: string | null;
  hodReviewedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  nomorDokumen: string | null;
  // Syarat tersimpan digabung ke default — SPH lama (sebelum migrasi 300) tak
  // punya kolom ini, jadi tampil dgn default yang berlaku sekarang.
  syarat: SyaratSph;
  penandaTangan: PenandaTangan | null;
  penandaTanganUserId: string | null;
  customerAlamat: string | null;
  customerKota: string | null;
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

// Header/footer surat SELALU ditulis sistem (bukan AI) — nomor/tanggal/syarat
// itu FAKTA, bukan prosa, jadi tak pernah didelegasikan ke LLM (pelajaran dari
// insiden tabel dobel: apa pun yg dibiarkan AI tulis sendiri, LLM cenderung
// tetap menulisnya walau sudah dibilang "jangan", risikonya nomor/tanggal beda
// dgn yang sebenarnya).
//
// Nomor surat resmi baru diberikan saat finalisasi (finalisasiSph) — draft
// bertuliskan NOMOR_DRAF, lalu baris "Nomor: … | Tanggal: …" dan bagian
// "Syarat & Ketentuan" diganti utuh lewat perbaruiTeksSph (lib/sph-cetak.ts).
function letterHeader(customerName: string): string {
  return `SURAT PENAWARAN HARGA (SPH)\nNomor: ${NOMOR_DRAF} | Tanggal: ${tanggalIndo(new Date())}\n\nKepada Yth. ${customerName}\n`;
}
function letterFooter(syarat: SyaratSph): string {
  return kakiSurat(syarat);
}

// Draft deterministik penuh (fallback kalau AI tak terjangkau/mati).
function renderSphTextFallback(
  customerName: string,
  items: SphLineItemRow[],
  total: SphDetail["total"],
  terms: SyaratSph,
): string {
  return (
    `${letterHeader(customerName)}\n` +
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
  terms: SyaratSph,
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
      text: `${letterHeader(customerName)}\n${intro}\n\n${table}\n${letterFooter(terms)}`,
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
    SELECT id, nama, brand, kemasan, price_list, diskon_maks
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
    if (!(it.qty > 0) || !Number.isInteger(it.qty)) {
      return { ok: false, error: `qty item "${row.nama}" harus bilangan bulat > 0` };
    }
    const diskonMaks = Number(row.diskon_maks);
    if (it.diskon_requested < 0) {
      return { ok: false, error: `diskon utk "${row.nama}" tidak boleh negatif (${(it.diskon_requested * 100).toFixed(0)}%)` };
    }
    if (it.diskon_requested > diskonMaks) {
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
      kemasan: row.kemasan ? String(row.kemasan).trim() || null : null,
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
  const terms = gabungSyarat(
    await syaratDefaultSph(),
    syaratDariInputLama(input.terms),
    input.syarat as Record<string, unknown> | undefined,
  );
  const { text: draftText, model } = await draftSphText(customerName, lineItems, total, terms);
  const title = `SPH — ${customerName}`;

  const docRows = await sql`
    INSERT INTO sales_doc (deal_id, customer_id, customer_name, doc_type, title, draft_text, status, generated_by, model_used, syarat)
    VALUES (${input.deal_id ?? null}, ${customerId}, ${customerName}, 'sph', ${title}, ${draftText}, 'draft', 'A6', ${model},
            ${sql.json(terms as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  const docId = docRows[0].id as string;

  for (const it of lineItems) {
    await sql`
      INSERT INTO sph_line_item
        (sales_doc_id, pricelist_item_id, qty, diskon_requested, nama_snapshot, price_list, diskon_maks_snapshot, harga_nett, nett_ppn, variant_confirmed, kemasan_snapshot)
      VALUES
        (${docId}, ${it.pricelist_item_id}, ${it.qty}, ${it.diskonRequested}, ${it.nama}, ${it.priceListRaw}, ${it.diskonMaksSnapshot}, ${it.hargaNett}, ${it.nettPpn}, ${it.variantConfirmed}, ${it.kemasan})
    `;
  }

  await logHumanAction(
    "sph.draft.create",
    input.created_by,
    {
      doc_id: docId,
      customer_id: customerId,
      customer_name: customerName,
      item_count: lineItems.length,
      total,
      model,
      created_by_user_id: input.created_by_user_id ?? null,
      created_by_am_id: input.created_by_am_id ?? null,
    },
    "create",
  );

  return { ok: true, id: docId };
}

export async function getSphDetail(id: string): Promise<SphDetail | null> {
  const sql = db();
  const docRows = await sql`
    SELECT sd.id, sd.deal_id, sd.customer_id, sd.customer_name, sd.status, sd.title, sd.draft_text, sd.approved_by,
           sd.hod_reviewed_by, sd.hod_reviewed_at::text, sd.created_at::text, sd.approved_at::text,
           sd.nomor_dokumen, sd.syarat, sd.penanda_tangan_nama, sd.penanda_tangan_jabatan,
           sd.penanda_tangan_user_id::text AS penanda_tangan_user_id,
           -- Alamat hanya bila mirror Accurate membawanya (raw saat ini belum
           -- selalu memuat billStreet/billCity) — kosong = tak dicetak.
           NULLIF(trim(ac.raw->>'billStreet'), '') AS alamat,
           NULLIF(trim(ac.raw->>'billCity'), '') AS kota
    FROM sales_doc sd
    LEFT JOIN accurate_customer ac
      -- CASE (bukan AND) supaya cast tak pernah dievaluasi utk nama teks dari #SPH.
      ON ac.id = CASE WHEN sd.customer_id ~ '^[0-9]{1,18}$' THEN sd.customer_id::bigint END
    WHERE sd.id = ${id} AND sd.doc_type = 'sph'
  `;
  if (docRows.length === 0) return null;
  const d = docRows[0];

  const itemRows = await sql`
    SELECT li.id, li.pricelist_item_id, li.nama_snapshot, li.qty, li.diskon_requested, li.diskon_maks_snapshot,
           li.price_list, li.harga_nett, li.nett_ppn, li.variant_confirmed, li.variant_confirmed_by,
           COALESCE(li.kemasan_snapshot, NULLIF(trim(pp.kemasan), '')) AS kemasan
    FROM sph_line_item li
    LEFT JOIN product_pricelist pp ON pp.id = li.pricelist_item_id
    WHERE li.sales_doc_id = ${id} ORDER BY li.id
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
      kemasan: r.kemasan ? String(r.kemasan) : null,
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
    customerId: d.customer_id ? String(d.customer_id) : null,
    customerName: d.customer_name ? String(d.customer_name) : null,
    status: String(d.status),
    title: d.title ? String(d.title) : null,
    draftText: String(d.draft_text ?? ""),
    approvedBy: d.approved_by ? String(d.approved_by) : null,
    hodReviewedBy: d.hod_reviewed_by ? String(d.hod_reviewed_by) : null,
    hodReviewedAt: d.hod_reviewed_at ? String(d.hod_reviewed_at) : null,
    createdAt: String(d.created_at),
    approvedAt: d.approved_at ? String(d.approved_at) : null,
    nomorDokumen: d.nomor_dokumen ? String(d.nomor_dokumen) : null,
    syarat: gabungSyarat(await syaratDefaultSph(), d.syarat as Record<string, unknown> | null),
    penandaTangan: d.penanda_tangan_nama
      ? { nama: String(d.penanda_tangan_nama), jabatan: d.penanda_tangan_jabatan ? String(d.penanda_tangan_jabatan) : null }
      : null,
    penandaTanganUserId: d.penanda_tangan_user_id ? String(d.penanda_tangan_user_id) : null,
    customerAlamat: d.alamat ? String(d.alamat) : null,
    customerKota: d.kota ? String(d.kota) : null,
    items,
    total,
  };
}

export interface SphActionResult {
  ok: boolean;
  error?: string;
  status?: string;
  forbidden?: boolean; // ditolak krn izin/identitas → route balas 403
}

// Pelaku aksi dari SESI (x-user-id yg diteruskan BFF), bukan dari body.
// nama = name || email, sama dgn actorName() di web (lib/feature-guard.ts).
export interface PelakuSesi extends IdentitasPelaku {
  userId: string;
  nama: string;
  role: string | null;
  superuser: boolean;
  hodPeran: string | null; // master_hod.peran bila hod_key user AKTIF, selain itu null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function pelakuDariUser(userId: string | null | undefined): Promise<PelakuSesi | null> {
  const id = String(userId ?? "").trim();
  if (!UUID_RE.test(id)) return null; // app_user.id uuid — id rusak jangan sampai jadi error cast
  const sql = db();
  const [u] = await sql`
    SELECT u.id::text AS id, u.name, u.email, u.role, u.am_id, h.peran AS hod_peran
    FROM app_user u
    LEFT JOIN master_hod h ON h.hod_key = u.hod_key AND h.aktif
    WHERE u.id = ${id}
  `;
  if (!u) return null;
  let superuser = false;
  try {
    superuser = (await effectivePermissions(id)).superuser;
  } catch {
    /* RBAC belum siap → anggap non-superuser */
  }
  return {
    userId: String(u.id),
    nama: String(u.name ?? "").trim() || String(u.email),
    amId: u.am_id ? String(u.am_id) : null,
    role: u.role ? String(u.role) : null,
    superuser,
    hodPeran: u.hod_peran ? String(u.hod_peran) : null,
  };
}

// sales_doc tak punya kolom pembuat → ambil dari audit_log 'sph.draft.create'
// (human_actor + penanda di payload). null = tak tercatat (SPH lama/seed):
// larangan pembuat tak bisa ditegakkan utk dokumen itu.
export async function pembuatSph(docId: string): Promise<IdentitasPelaku | null> {
  const sql = db();
  const [r] = await sql`
    SELECT human_actor, payload->>'created_by_user_id' AS user_id, payload->>'created_by_am_id' AS am_id
    FROM audit_log
    WHERE event_type = 'sph.draft.create' AND payload->>'doc_id' = ${docId}
    ORDER BY occurred_at ASC
    LIMIT 1
  `;
  if (!r) return null;
  return {
    nama: r.human_actor ? String(r.human_actor) : null,
    userId: r.user_id ? String(r.user_id) : null,
    amId: r.am_id ? String(r.am_id) : null,
  };
}

async function pelakuPembuat(docId: string, pelaku: IdentitasPelaku): Promise<boolean> {
  const pembuat = await pembuatSph(docId);
  return !!pembuat && samaOrang(pelaku, pembuat);
}

// Dipakai approveSalesDoc (tahap 2) & confirmSphVariant.
export async function cekFinalSph(docId: string, pelaku: IdentitasPelaku): Promise<string | null> {
  const p = bolehFinalSph({ isCreator: await pelakuPembuat(docId, pelaku) });
  return p.ok ? null : p.error;
}

// Tahap 1/2: HOD Business review. draft → hod_review. Khusus doc_type='sph'
// (doc_type lain tetap 1 tahap via approveSalesDoc di salesdoc.ts).
// Peninjau = pelaku sesi; boleh hanya HoD Business aktif (atau admin/superuser)
// dan BUKAN pembuat SPH (lib/sales-doc-gate.ts bolehReviewSph).
export async function hodReviewSph(id: string, reviewer: PelakuSesi): Promise<SphActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, doc_type FROM sales_doc WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "dokumen tidak ditemukan" };
  if (rows[0].doc_type !== "sph") return { ok: false, error: "bukan dokumen SPH" };
  if (rows[0].status !== "draft") return { ok: false, error: `dokumen sudah ${rows[0].status}` };
  const p = bolehReviewSph({
    hodPeran: reviewer.hodPeran,
    role: reviewer.role,
    superuser: reviewer.superuser,
    isCreator: await pelakuPembuat(id, reviewer),
  });
  if (!p.ok) return { ok: false, error: p.error, forbidden: true };
  await sql`UPDATE sales_doc SET status = 'hod_review', hod_reviewed_by = ${reviewer.nama}, hod_reviewed_at = now() WHERE id = ${id}`;
  await logHumanAction("sph.hod_review", reviewer.nama, { doc_id: id, reviewer_user_id: reviewer.userId }, "review");
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
  pelaku: PelakuSesi,
): Promise<SphActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM sph_line_item WHERE id = ${lineItemId} AND sales_doc_id = ${salesDocId}`;
  if (rows.length === 0) return { ok: false, error: "baris item tidak ditemukan di dokumen ini" };
  const tolak = await cekFinalSph(salesDocId, pelaku);
  if (tolak) return { ok: false, error: tolak, forbidden: true };
  await sql`
    UPDATE sph_line_item SET variant_confirmed = true, variant_confirmed_by = ${pelaku.nama}, variant_confirmed_at = now()
    WHERE id = ${lineItemId}
  `;
  await logHumanAction("sph.variant_confirm", pelaku.nama, { line_item_id: lineItemId, doc_id: salesDocId }, "confirm");
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

// ── Dokumen cetak: pengaturan, syarat, penanda tangan, nomor (migrasi 300) ──

export interface PengaturanSph {
  kodeTengah: string;
  nomorBerikutnya: number;
  resetTahunan: boolean;
  tahunBerjalan: number | null;
  syaratDefault: SyaratSph;
  updatedBy: string | null;
  updatedAt: string | null;
  // Pratinjau nomor yg AKAN diberikan bila SPH difinalisasi sekarang.
  contohNomor: string;
}

// Baris tunggal sph_pengaturan. null = migrasi 300 belum jalan.
async function bacaPengaturanRow(): Promise<Record<string, unknown> | null> {
  const sql = db();
  try {
    const [r] = await sql`
      SELECT kode_tengah, nomor_berikutnya, reset_tahunan, tahun_berjalan, syarat_default, updated_by, updated_at::text
      FROM sph_pengaturan WHERE id = 1`;
    return r ?? null;
  } catch {
    return null;
  }
}

export async function syaratDefaultSph(): Promise<SyaratSph> {
  const r = await bacaPengaturanRow();
  return gabungSyarat(SYARAT_DEFAULT, (r?.syarat_default as Record<string, unknown> | undefined) ?? null);
}

export async function getPengaturanSph(): Promise<PengaturanSph | null> {
  const r = await bacaPengaturanRow();
  if (!r) return null;
  const state = {
    nomorBerikutnya: Number(r.nomor_berikutnya),
    resetTahunan: r.reset_tahunan === true,
    tahunBerjalan: r.tahun_berjalan == null ? null : Number(r.tahun_berjalan),
  };
  const t = tanggalWib(new Date());
  const { dipakai } = ambilNomor(state, t.tahun);
  return {
    kodeTengah: String(r.kode_tengah),
    ...state,
    syaratDefault: gabungSyarat(SYARAT_DEFAULT, r.syarat_default as Record<string, unknown> | null),
    updatedBy: r.updated_by ? String(r.updated_by) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    contohNomor: formatNomorSph(dipakai, String(r.kode_tengah), t.bulan, t.tahun),
  };
}

export interface UbahPengaturanInput {
  kodeTengah?: unknown;
  nomorBerikutnya?: unknown;
  resetTahunan?: unknown;
  syaratDefault?: unknown;
}

// Hanya admin/superuser (dicek di sini dari pelaku sesi, dan di BFF).
export async function ubahPengaturanSph(input: UbahPengaturanInput, pelaku: PelakuSesi): Promise<SphActionResult> {
  if (!(pelaku.superuser || /^admin$/i.test(String(pelaku.role ?? "")))) {
    return { ok: false, error: "pengaturan SPH hanya untuk admin/superuser", forbidden: true };
  }
  const now = await getPengaturanSph();
  if (!now) return { ok: false, error: "tabel sph_pengaturan belum ada (migrasi 300 belum dijalankan)" };
  let kode = now.kodeTengah;
  if (input.kodeTengah !== undefined) {
    kode = String(input.kodeTengah ?? "").trim();
    if (!kodeTengahSah(kode)) return { ok: false, error: "kode tengah hanya huruf/angka/titik/strip, 1-30 karakter, tanpa garis miring" };
  }
  let nomor = now.nomorBerikutnya;
  if (input.nomorBerikutnya !== undefined) {
    const n = Number(input.nomorBerikutnya);
    if (!nomorUrutSah(n)) return { ok: false, error: "nomor berikutnya harus bilangan bulat 1 - 9.999.999" };
    nomor = n;
  }
  const reset = input.resetTahunan === undefined ? now.resetTahunan : input.resetTahunan === true;
  const syarat =
    input.syaratDefault && typeof input.syaratDefault === "object"
      ? gabungSyarat(now.syaratDefault, input.syaratDefault as Record<string, unknown>)
      : now.syaratDefault;
  const sql = db();
  await sql`
    UPDATE sph_pengaturan SET kode_tengah = ${kode}, nomor_berikutnya = ${nomor}, reset_tahunan = ${reset},
      syarat_default = ${sql.json(syarat as unknown as Parameters<typeof sql.json>[0])},
      updated_by = ${pelaku.nama}, updated_at = now()
    WHERE id = 1`;
  await logHumanAction(
    "sph.pengaturan.ubah",
    pelaku.nama,
    { sebelum: { ...now, contohNomor: undefined }, sesudah: { kodeTengah: kode, nomorBerikutnya: nomor, resetTahunan: reset, syaratDefault: syarat } },
    "update",
  );
  return { ok: true };
}

// Syarat per SPH — boleh diubah selama draft/hod_review (izin edit Sales Docs
// dicek di BFF), terkunci setelah approved. draft_text ikut diperbarui supaya
// pratinjau & kiriman WA sama dengan PDF.
export async function ubahSyaratSph(id: string, input: unknown, pelaku: PelakuSesi): Promise<SphActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "syarat wajib berupa objek" };
  const sql = db();
  const [d] = await sql`
    SELECT status, doc_type, syarat, draft_text, penanda_tangan_nama, penanda_tangan_jabatan
    FROM sales_doc WHERE id = ${id}`;
  if (!d) return { ok: false, error: "dokumen tidak ditemukan" };
  if (d.doc_type !== "sph") return { ok: false, error: "bukan dokumen SPH" };
  if (d.status !== "draft" && d.status !== "hod_review") {
    return { ok: false, error: `syarat terkunci — dokumen sudah ${d.status}` };
  }
  const dasar = gabungSyarat(await syaratDefaultSph(), d.syarat as Record<string, unknown> | null);
  const baru = gabungSyarat(dasar, input as Record<string, unknown>);
  const ttd = d.penanda_tangan_nama
    ? { nama: String(d.penanda_tangan_nama), jabatan: d.penanda_tangan_jabatan ? String(d.penanda_tangan_jabatan) : null }
    : null;
  const teks = perbaruiTeksSph(String(d.draft_text ?? ""), { syarat: baru, ttd });
  // Status dicek ulang di WHERE: approve yg jalan serentak tak boleh kebobolan
  // perubahan syarat sesudah nomor diberikan.
  const upd = await sql`
    UPDATE sales_doc SET syarat = ${sql.json(baru as unknown as Parameters<typeof sql.json>[0])}, draft_text = ${teks}
    WHERE id = ${id} AND status IN ('draft', 'hod_review') RETURNING id`;
  if (upd.length === 0) return { ok: false, error: "status dokumen berubah — muat ulang" };
  await logHumanAction("sph.syarat.ubah", pelaku.nama, { doc_id: id, sebelum: dasar, sesudah: baru }, "update");
  return { ok: true };
}

export interface KandidatTtd {
  userId: string;
  nama: string;
  jabatan: string | null;
  peran: string[]; // 'approver' | 'hod_review' | 'pembuat' — label pilihan
}

// Pilihan penanda tangan: pengguna AKTIF yang ber-akses menu Sales Docs
// (admin, superuser, atau grup dgn izin lihat 'sales-docs') + peninjau HoD
// tahap 1 + pembuat SPH (AM, walau tak ber-akses Sales Docs). Jabatan dari
// app_user.title, cadangan master_user.posisi; boleh diubah saat memilih.
export async function kandidatPenandaTangan(docId: string, pelaku: PelakuSesi | null): Promise<KandidatTtd[]> {
  const sql = db();
  const [rev] = await sql`
    SELECT payload->>'reviewer_user_id' AS uid FROM audit_log
    WHERE event_type = 'sph.hod_review' AND payload->>'doc_id' = ${docId}
    ORDER BY occurred_at DESC LIMIT 1`;
  const pembuat = await pembuatSph(docId);
  const ids = new Set<string>();
  const hodId = rev?.uid && UUID_RE.test(String(rev.uid)) ? String(rev.uid) : null;
  if (hodId) ids.add(hodId);
  let pembuatId = pembuat?.userId && UUID_RE.test(pembuat.userId) ? pembuat.userId : null;
  if (!pembuatId && pembuat?.amId) {
    const [u] = await sql`SELECT id::text AS id FROM app_user WHERE am_id = ${pembuat.amId} AND active LIMIT 1`;
    pembuatId = u ? String(u.id) : null;
  }
  if (pembuatId) ids.add(pembuatId);
  const rows = await sql`
    SELECT u.id::text AS id, COALESCE(NULLIF(trim(u.name), ''), u.email) AS nama,
           COALESCE(NULLIF(trim(u.title), ''), NULLIF(trim(mu.posisi), '')) AS jabatan
    FROM app_user u
    LEFT JOIN master_user mu ON mu.am_id = u.am_id
    WHERE u.active AND (
      u.id = ANY(${[...ids]}::uuid[])
      OR u.role = 'admin'
      OR EXISTS (SELECT 1 FROM app_user_group m JOIN access_group g ON g.id = m.group_id
                 WHERE m.user_id = u.id AND g.superuser)
      OR EXISTS (SELECT 1 FROM app_user_group m JOIN access_permission ap ON ap.group_id = m.group_id
                 WHERE m.user_id = u.id AND ap.feature_key = 'sales-docs' AND ap.active AND ap.can_view)
    )
    ORDER BY 2`;
  const out = rows.map((r) => {
    const peran: string[] = [];
    if (pelaku && r.id === pelaku.userId) peran.push("approver");
    if (r.id === hodId) peran.push("hod_review");
    if (r.id === pembuatId) peran.push("pembuat");
    return { userId: String(r.id), nama: String(r.nama), jabatan: r.jabatan ? String(r.jabatan) : null, peran };
  });
  // Urutan pilihan: approver (default) → HoD → pembuat → sisanya alfabetis.
  const bobot = (k: KandidatTtd) =>
    k.peran.includes("approver") ? 0 : k.peran.includes("hod_review") ? 1 : k.peran.includes("pembuat") ? 2 : 3;
  return out.sort((a, b) => bobot(a) - bobot(b));
}

export interface PilihanTtd {
  userId?: unknown;
  jabatan?: unknown;
}

// Pilihan → penanda tangan tervalidasi. Nama SELALU dari app_user (tak bisa
// diketik bebas — mencegah nama karangan di surat resmi); jabatan boleh
// diubah teks (cadangan: jabatan master). userId kosong → approver sendiri.
async function resolusiTtd(
  docId: string,
  pelaku: PelakuSesi,
  pilihan: PilihanTtd | null | undefined,
): Promise<{ ok: true; ttd: PenandaTangan; userId: string } | { ok: false; error: string }> {
  const kandidat = await kandidatPenandaTangan(docId, pelaku);
  const uid = String(pilihan?.userId ?? "").trim() || pelaku.userId;
  let k = kandidat.find((x) => x.userId === uid);
  if (!k && uid === pelaku.userId) {
    // Approver lolos gerbang edit di BFF walau mungkin tak tercantum di daftar
    // (mis. izin lewat jalur lama) — dirinya sendiri selalu boleh.
    k = { userId: pelaku.userId, nama: pelaku.nama, jabatan: null, peran: ["approver"] };
  }
  if (!k) return { ok: false, error: "penanda tangan harus dipilih dari daftar pengguna yang tersedia" };
  const jabatanTeks = typeof pilihan?.jabatan === "string" ? pilihan.jabatan.replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return { ok: true, ttd: { nama: k.nama, jabatan: jabatanTeks || k.jabatan }, userId: k.userId };
}

// Ganti penanda tangan sebelum dicetak/dikirim: status hod_review atau approved.
export async function setPenandaTanganSph(id: string, pilihan: PilihanTtd, pelaku: PelakuSesi): Promise<SphActionResult> {
  const sql = db();
  const [d] = await sql`SELECT status, doc_type, syarat, draft_text FROM sales_doc WHERE id = ${id}`;
  if (!d) return { ok: false, error: "dokumen tidak ditemukan" };
  if (d.doc_type !== "sph") return { ok: false, error: "bukan dokumen SPH" };
  if (d.status !== "hod_review" && d.status !== "approved") {
    return { ok: false, error: `penanda tangan hanya bisa dipilih saat hod_review/approved (sekarang ${d.status})` };
  }
  const tolak = await cekFinalSph(id, pelaku);
  if (tolak) return { ok: false, error: tolak, forbidden: true };
  const r = await resolusiTtd(id, pelaku, pilihan);
  if (!r.ok) return { ok: false, error: r.error };
  const syarat = gabungSyarat(await syaratDefaultSph(), d.syarat as Record<string, unknown> | null);
  const teks = perbaruiTeksSph(String(d.draft_text ?? ""), { syarat, ttd: r.ttd });
  const upd = await sql`
    UPDATE sales_doc SET penanda_tangan_nama = ${r.ttd.nama}, penanda_tangan_jabatan = ${r.ttd.jabatan},
      penanda_tangan_user_id = ${r.userId}, draft_text = ${teks}
    WHERE id = ${id} AND status IN ('hod_review', 'approved') RETURNING id`;
  if (upd.length === 0) return { ok: false, error: "status dokumen berubah — muat ulang" };
  await logHumanAction("sph.penanda_tangan", pelaku.nama, { doc_id: id, user_id: r.userId, ...r.ttd }, "update");
  return { ok: true };
}

// Tahap 2 SPH: beri nomor surat + kunci syarat + simpan penanda tangan +
// status approved — SATU transaksi. Baris sph_pengaturan dikunci FOR UPDATE
// sehingga dua finalisasi serentak antre (tak ada nomor kembar); baris
// sales_doc juga dikunci & status dicek ulang di dalam transaksi supaya dua
// klik "Approve" tak menghabiskan dua nomor. Gerbang (pembuat, varian kembar)
// sudah dicek pemanggil (approveSalesDoc) sebelum masuk sini.
export async function finalisasiSph(
  id: string,
  pelaku: PelakuSesi,
  pilihan: PilihanTtd | null | undefined,
): Promise<SphActionResult & { nomor?: string }> {
  const r = await resolusiTtd(id, pelaku, pilihan);
  if (!r.ok) return { ok: false, error: r.error };
  const sqlRoot = db();
  const syaratDefault = await syaratDefaultSph();
  try {
    return await sqlRoot.begin(async (txRaw) => {
      const tx = txRaw as unknown as typeof sqlRoot;
      const [d] = await tx`SELECT status, syarat, draft_text FROM sales_doc WHERE id = ${id} FOR UPDATE`;
      if (!d) return { ok: false, error: "dokumen tidak ditemukan" };
      if (d.status !== "hod_review") return { ok: false, error: `dokumen sudah ${d.status} (butuh status "hod_review")` };
      const [p] = await tx`
        SELECT kode_tengah, nomor_berikutnya, reset_tahunan, tahun_berjalan FROM sph_pengaturan WHERE id = 1 FOR UPDATE`;
      if (!p) return { ok: false, error: "pengaturan penomoran SPH belum ada (migrasi 300)" };
      const now = new Date();
      const t = tanggalWib(now);
      const { dipakai, sesudah } = ambilNomor(
        {
          nomorBerikutnya: Number(p.nomor_berikutnya),
          resetTahunan: p.reset_tahunan === true,
          tahunBerjalan: p.tahun_berjalan == null ? null : Number(p.tahun_berjalan),
        },
        t.tahun,
      );
      const nomor = formatNomorSph(dipakai, String(p.kode_tengah), t.bulan, t.tahun);
      const syarat = gabungSyarat(syaratDefault, d.syarat as Record<string, unknown> | null);
      const teks = perbaruiTeksSph(String(d.draft_text ?? ""), { nomor, tanggal: tanggalIndo(now), syarat, ttd: r.ttd });
      await tx`
        UPDATE sph_pengaturan SET nomor_berikutnya = ${sesudah.nomorBerikutnya}, tahun_berjalan = ${sesudah.tahunBerjalan}
        WHERE id = 1`;
      await tx`
        UPDATE sales_doc SET status = 'approved', approved_by = ${pelaku.nama}, approved_at = ${now},
          nomor_dokumen = ${nomor}, syarat = ${tx.json(syarat as unknown as Parameters<typeof tx.json>[0])},
          penanda_tangan_nama = ${r.ttd.nama}, penanda_tangan_jabatan = ${r.ttd.jabatan},
          penanda_tangan_user_id = ${r.userId}, draft_text = ${teks}
        WHERE id = ${id}`;
      return { ok: true, status: "approved", nomor };
    });
  } catch (e) {
    // 23505 = unique_violation pada sales_doc_nomor_dokumen_uq: "nomor
    // berikutnya" diset mundur ke angka yg sudah terpakai. Transaksi batal →
    // counter tak bergeser; admin perlu membetulkan pengaturan.
    if ((e as { code?: string }).code === "23505") {
      return { ok: false, error: "nomor SPH berikutnya sudah pernah dipakai — periksa 'nomor berikutnya' di Pengaturan SPH" };
    }
    throw e;
  }
}

// ── Layar daftar & detail SPH (alur ramah pengguna) ──
// Semua di bawah ini HANYA baca. Aksi apa yang boleh dilakukan penonton
// dihitung lib/sph-alur.ts (aturan disalin dari gerbang aksi, tak diubah);
// gerbang sesungguhnya tetap di route aksi masing-masing.

export interface SphListRow {
  id: string;
  customerName: string | null;
  customerId: string | null;
  status: string;
  nomorDokumen: string | null;
  createdAt: string;
  hodReviewedBy: string | null;
  approvedBy: string | null;
  pembuat: string | null;
  jumlahItem: number;
  variantPending: number;
  total: number; // nett + PPN
  aksi: AksiSph;
}

export interface SphListResult {
  rows: SphListRow[];
  counts: Record<string, number>; // per status + 'semua' + 'saya' (perlu aksi saya)
}

interface DocRingkas {
  id: string;
  customer_name: string | null;
  customer_id: string | null;
  status: string;
  nomor_dokumen: string | null;
  created_at: string;
  hod_reviewed_by: string | null;
  approved_by: string | null;
  n: number;
  pending: number;
  total: number;
}

// Pembuat per dokumen (audit 'sph.draft.create' tertua) — satu query utk banyak id.
async function pembuatBanyak(ids: string[]): Promise<Map<string, IdentitasPelaku>> {
  const out = new Map<string, IdentitasPelaku>();
  if (ids.length === 0) return out;
  const sql = db();
  const rows = await sql`
    SELECT DISTINCT ON (payload->>'doc_id') payload->>'doc_id' AS doc_id, human_actor,
           payload->>'created_by_user_id' AS user_id, payload->>'created_by_am_id' AS am_id
    FROM audit_log
    WHERE event_type = 'sph.draft.create' AND payload->>'doc_id' = ANY(${ids})
    ORDER BY payload->>'doc_id', occurred_at ASC`;
  for (const r of rows) {
    out.set(String(r.doc_id), {
      nama: r.human_actor ? String(r.human_actor) : null,
      userId: r.user_id ? String(r.user_id) : null,
      amId: r.am_id ? String(r.am_id) : null,
    });
  }
  return out;
}

const bolehReviewPeran = (p: PelakuSesi | null) =>
  !!p && (p.superuser || /^admin$/i.test(String(p.role ?? "")) || hodBusiness(p.hodPeran));

export async function listSph(
  pelaku: PelakuSesi | null,
  bisaEdit: boolean,
  opts: { status?: string | null; q?: string | null; limit?: number } = {},
): Promise<SphListResult> {
  const sql = db();
  const pola = polaCariSph(opts.q);
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  const cari = pola
    ? sql`AND (sd.customer_name ILIKE ${pola} OR sd.nomor_dokumen ILIKE ${pola})`
    : sql``;
  // 'saya' = perlu aksi saya → hanya status yang masih berjalan, disaring di bawah.
  const st = String(opts.status ?? "").trim();
  const filterStatus =
    st === "saya"
      ? sql`AND sd.status IN ('draft', 'hod_review', 'approved')`
      : st && st !== "semua"
        ? sql`AND sd.status = ${st}`
        : sql``;
  const docs = (await sql`
    SELECT sd.id::text AS id, sd.customer_name, sd.customer_id, sd.status, sd.nomor_dokumen,
           sd.created_at::text AS created_at, sd.hod_reviewed_by, sd.approved_by,
           COALESCE(t.n, 0)::int AS n, COALESCE(t.pending, 0)::int AS pending, COALESCE(t.total, 0)::float8 AS total
    FROM sales_doc sd
    LEFT JOIN LATERAL (
      SELECT count(*) AS n, count(*) FILTER (WHERE NOT li.variant_confirmed) AS pending,
             sum(li.nett_ppn * li.qty) AS total
      FROM sph_line_item li WHERE li.sales_doc_id = sd.id
    ) t ON true
    WHERE sd.doc_type = 'sph' ${filterStatus} ${cari}
    ORDER BY sd.created_at DESC
    LIMIT ${limit}`) as unknown as DocRingkas[];

  // Hitungan tab: per status (ikut kata kunci cari) + "perlu aksi saya".
  const cnt = await sql`
    SELECT sd.status, count(*)::int AS n FROM sales_doc sd
    WHERE sd.doc_type = 'sph' ${cari} GROUP BY sd.status`;
  const counts: Record<string, number> = { semua: 0, saya: 0 };
  for (const r of cnt) {
    counts[String(r.status)] = Number(r.n);
    counts.semua += Number(r.n);
  }
  // Untuk hitungan 'saya' perlu semua dokumen yang masih berjalan, bukan cuma
  // halaman yang sedang dibuka.
  const terbuka = (st === "saya"
    ? docs
    : await sql`
        SELECT sd.id::text AS id, sd.status, COALESCE(t.pending, 0)::int AS pending
        FROM sales_doc sd
        LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE NOT li.variant_confirmed) AS pending
                           FROM sph_line_item li WHERE li.sales_doc_id = sd.id) t ON true
        WHERE sd.doc_type = 'sph' AND sd.status IN ('draft', 'hod_review', 'approved') ${cari}
        LIMIT 500`) as unknown as Pick<DocRingkas, "id" | "status" | "pending">[];

  const pembuat = await pembuatBanyak([...new Set([...docs.map((d) => d.id), ...terbuka.map((d) => d.id)])]);
  const reviewPeran = bolehReviewPeran(pelaku);
  const hitungAksi = (d: Pick<DocRingkas, "id" | "status" | "pending">) => {
    const p = pembuat.get(d.id);
    return aksiSph({
      status: d.status,
      isCreator: !!pelaku && !!p && samaOrang(pelaku, p),
      bolehReviewPeran: reviewPeran,
      bisaEdit,
      variantPending: Number(d.pending),
    });
  };
  counts.saya = terbuka.filter((d) => hitungAksi(d).perluAksiSaya).length;

  let rows: SphListRow[] = docs.map((d) => ({
    id: d.id,
    customerName: d.customer_name,
    customerId: d.customer_id,
    status: d.status,
    nomorDokumen: d.nomor_dokumen,
    createdAt: d.created_at,
    hodReviewedBy: d.hod_reviewed_by,
    approvedBy: d.approved_by,
    pembuat: pembuat.get(d.id)?.nama ?? null,
    jumlahItem: Number(d.n),
    variantPending: Number(d.pending),
    total: Math.round(Number(d.total)),
    aksi: hitungAksi(d),
  }));
  if (st === "saya") rows = rows.filter((r) => r.aksi.perluAksiSaya);
  return { rows, counts };
}

export interface RiwayatSph {
  jenis: string; // event_type audit_log
  oleh: string | null;
  waktu: string;
  judul: string; // label peristiwa ("Disetujui & diberi nomor", …)
  keterangan: string | null; // rincian (nomor, tujuan tersamar, nama penanda tangan)
}

const LABEL_RIWAYAT: Record<string, string> = {
  "sph.draft.create": "SPH dibuat",
  "sph.hod_review": "Direview HoD Business",
  "sph.variant_confirm": "Varian item dikonfirmasi",
  "sph.syarat.ubah": "Syarat & ketentuan diubah",
  "sph.penanda_tangan": "Penanda tangan diganti",
  "sales.doc.approve": "Disetujui & diberi nomor",
  "sales.doc.send": "Dikirim ke customer",
  "sales.doc.cancel": "Dibatalkan",
};

// Nomor WA di riwayat disamarkan — cukup 4 digit terakhir utk penanda.
const samarkan = (n: unknown) => {
  const s = String(n ?? "").replace(/\D/g, "");
  return s.length > 4 ? `…${s.slice(-4)}` : s;
};

export interface KonteksSph {
  aksi: AksiSph;
  pembuat: string | null;
  saya: { isCreator: boolean; bolehReviewPeran: boolean; bisaEdit: boolean };
  riwayat: RiwayatSph[];
}

export async function konteksSph(id: string, pelaku: PelakuSesi | null, bisaEdit: boolean): Promise<KonteksSph | null> {
  const sql = db();
  const [d] = await sql`
    SELECT sd.status, (SELECT count(*)::int FROM sph_line_item li WHERE li.sales_doc_id = sd.id AND NOT li.variant_confirmed) AS pending
    FROM sales_doc sd WHERE sd.id = ${id} AND sd.doc_type = 'sph'`;
  if (!d) return null;
  const p = await pembuatSph(id);
  const isCreator = !!pelaku && !!p && samaOrang(pelaku, p);
  const reviewPeran = bolehReviewPeran(pelaku);
  const ev = await sql`
    SELECT event_type, human_actor, occurred_at::text AS waktu, payload
    FROM audit_log
    WHERE payload->>'doc_id' = ${id}
      AND event_type = ANY(${Object.keys(LABEL_RIWAYAT)})
    ORDER BY occurred_at ASC
    LIMIT 100`;
  const riwayat: RiwayatSph[] = ev.map((e) => {
    const pl = (e.payload ?? {}) as Record<string, unknown>;
    let ket: string | null = null;
    if (e.event_type === "sales.doc.approve" && pl.nomor) ket = `Nomor ${String(pl.nomor)}`;
    else if (e.event_type === "sales.doc.send" && pl.to) ket = `ke WA ${samarkan(pl.to)}`;
    else if (e.event_type === "sph.penanda_tangan" && pl.nama) ket = String(pl.nama);
    return {
      jenis: String(e.event_type),
      oleh: e.human_actor ? String(e.human_actor) : null,
      waktu: String(e.waktu),
      judul: LABEL_RIWAYAT[String(e.event_type)] ?? String(e.event_type),
      keterangan: ket,
    };
  });
  return {
    aksi: aksiSph({ status: String(d.status), isCreator, bolehReviewPeran: reviewPeran, bisaEdit, variantPending: Number(d.pending) }),
    pembuat: p?.nama ?? null,
    saya: { isCreator, bolehReviewPeran: reviewPeran, bisaEdit },
    riwayat,
  };
}

export interface KontakWaSph {
  id: number;
  nama: string;
  jabatan: string | null;
  hpWa: string; // ternormalkan 62…
  utama: boolean;
}

// Pilihan tujuan kirim: kontak WA customer di Accounts — sumber yang SAMA
// dengan pemeriksaan tujuanDiizinkan di sendSalesDoc, jadi apa pun yang
// tampil di sini pasti diterima endpoint kirim.
export async function kontakWaSph(id: string): Promise<KontakWaSph[] | null> {
  const sql = db();
  const [d] = await sql`SELECT customer_id FROM sales_doc WHERE id = ${id} AND doc_type = 'sph'`;
  if (!d) return null;
  const accountId = accountIdDariCustomer(d.customer_id ? String(d.customer_id) : null);
  if (!accountId) return [];
  const rows = await sql`
    SELECT id, nama, jabatan, hp_wa, is_primary FROM crm_contact
    WHERE account_id = ${accountId}::bigint AND hp_wa IS NOT NULL
    ORDER BY is_primary DESC, seq, nama`;
  const out: KontakWaSph[] = [];
  const sudah = new Set<string>();
  for (const r of rows) {
    const n = nomorTujuan(String(r.hp_wa));
    if (!n || sudah.has(n)) continue;
    sudah.add(n);
    out.push({ id: Number(r.id), nama: String(r.nama), jabatan: r.jabatan ? String(r.jabatan) : null, hpWa: n, utama: r.is_primary === true });
  }
  return out;
}
