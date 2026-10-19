// F90 Sales Order Entry via WA #ORDER — pesanan AM lewat WhatsApp → antrean Admin Sales.
//
// Keputusan user 19 Okt 2026:
//   - pesanan masuk ANTREAN WRG-OS; Admin Sales menginput SO di Accurate seperti biasa, sistem
//     mencocokkan dengan cermin accurate_sales_order (tanpa akses tulis ke Accurate);
//   - harga di bawah lantai price book (product_pricelist.harga_nett) DITOLAK;
//   - AM wajib konfirmasi "#ORDER ya O12" sebelum masuk antrean;
//   - menu Antrean Order + WA ke Admin Sales (ORDER_WA_ADMIN_ENABLED, default mati; penerima
//     ORDER_WA_ADMIN_TARGET — roster Admin prod 9 Pusat + 1 Kediri, tak bisa dipetakan per cabang AM).
//
// Format:
//   #ORDER RSUD Kab Kediri            ← baris pertama = faskes (atau "Faskes: …")
//   Z5 LD LYSE 500 ML 2               ← tiap baris: barang + jumlah [@ harga]
//   IDS.0299 1 @ 38jt                 ← kode item Accurate boleh langsung
//   #ORDER ya O12 · #ORDER batal O12 alasan · #ORDER status · #ORDER (bantuan)
// Faskes = cariAkun (sama dengan #CALL/#NOTE/#BRIEF). Barang = price book periode berlaku:
// kode persis, atau SEMUA kata yang ditulis ada di nama/varian/kemasan/brand/kode; >1 hasil =
// AM diminta menulis kode. Harga kosong = price list. Stok = accurate_item.quantity (hanya item
// ber-kode; prod 19 Okt: 494/1042 SKU price book punya kode Accurate).

import { db } from "../db.js";
import { cariAkun } from "./interaction.js";
import { scopeOnClause, FULL_SCOPE, type DataScope } from "./access-scope.js";
import { sendViaWaGateway } from "../wasend.js";

export const PERIODE_HARGA = process.env.ORDER_PERIODE_HARGA ?? "H2-2026";

// ── Murni ────────────────────────────────────────────────────────────────

export type Perintah =
  | { aksi: "bantuan" }
  | { aksi: "status" }
  | { aksi: "ya"; ref: number }
  | { aksi: "batal"; ref: number; alasan: string }
  | { aksi: "baru"; faskes: string; baris: BarisPesan[] };
export interface BarisPesan { teks: string; query: string; qty: number; harga: number | null }

const ORDER_LINE = /^\s*#\s*order\b/i;
const REF = /^o?(\d{1,9})$/i;

/** "38.000.000" · "38jt" · "450rb" · "1,5jt" → angka rupiah; null bila tak terbaca. */
export function bacaRupiah(t: string): number | null {
  const m = t.trim().toLowerCase().replace(/^rp\.?\s*/, "").match(/^([\d.,]+)\s*(rb|ribu|k|jt|juta)?$/);
  if (!m) return null;
  let a = m[1];
  if (m[2]) a = a.replace(/\./g, "").replace(",", ".");          // "1,5jt" → 1.5
  else a = a.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."); // "38.000.000" → 38000000
  const n = Number(a);
  if (!Number.isFinite(n) || n < 0) return null;
  const kali = m[2] === "jt" || m[2] === "juta" ? 1e6 : m[2] ? 1e3 : 1;
  return Math.round(n * kali);
}

const BARIS = /^\s*(?:[-•*]\s*)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:x|pcs|box|kit|unit|btl|botol|vial|tes|test|pack|set)?\s*(?:@\s*(.+?))?\s*$/i;

export function parseOrder(body: string): Perintah {
  const baris = body.replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").split(/\r?\n/);
  const i = baris.findIndex((l) => ORDER_LINE.test(l));
  if (i < 0) return { aksi: "bantuan" };
  const kepala = baris[i].replace(ORDER_LINE, "").trim();
  const kata = kepala.split(/\s+/);
  const k0 = (kata[0] ?? "").toLowerCase();
  if ((k0 === "ya" || k0 === "kirim") && REF.test(kata[1] ?? "")) return { aksi: "ya", ref: Number((kata[1].match(REF) as RegExpMatchArray)[1]) };
  if (k0 === "batal" && REF.test(kata[1] ?? "")) return { aksi: "batal", ref: Number((kata[1].match(REF) as RegExpMatchArray)[1]), alasan: kata.slice(2).join(" ").trim() };
  if (k0 === "status" && kata.length === 1) return { aksi: "status" };
  let faskes = kepala.replace(/^faskes\s*:\s*/i, "").trim();
  const isi: BarisPesan[] = [];
  for (const l of baris.slice(i + 1)) {
    const t = l.trim();
    if (!t) continue;
    if (/^faskes\s*:/i.test(t)) { faskes = t.replace(/^faskes\s*:\s*/i, "").trim(); continue; }
    const m = t.match(BARIS);
    if (!m) { isi.push({ teks: t, query: t, qty: NaN, harga: null }); continue; }
    const qty = Number(m[2].replace(",", "."));
    const harga = m[3] ? bacaRupiah(m[3]) : null;
    isi.push({ teks: t, query: m[1].trim(), qty, harga: m[3] && harga == null ? NaN : harga });
  }
  if (!faskes && !isi.length) return { aksi: "bantuan" };
  return { aksi: "baru", faskes, baris: isi };
}

export const rp = (n: number): string => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export const BANTUAN_ORDER =
  "Format #ORDER:\n#ORDER RSUD Kab Kediri\nZ5 LD LYSE 500 ML 2\nIDS.0299 1 @ 38jt\n\n" +
  "Baris pertama = faskes; tiap baris berikutnya = barang (nama atau kode Accurate) + jumlah, harga opsional (@ …). " +
  "Tanpa harga = price list. Harga di bawah harga nett price book ditolak.\n" +
  "Mengirim: #ORDER ya O12 · Membatalkan: #ORDER batal O12 alasan · Pesanan saya: #ORDER status";

// ── Item price book ──────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;
export interface ItemHarga { id: number; kode: string | null; nama: string; kemasan: string | null; priceList: number; hargaNett: number; itemId: number | null; stok: number | null }

const KODE = /^[A-Z]{2,4}\.\d{3,5}$/i;

async function cariItem(sql: Sql, q: string): Promise<ItemHarga[]> {
  const kata = q.split(/\s+/).filter(Boolean);
  const kode = kata.length === 1 && KODE.test(kata[0]) ? kata[0].toUpperCase() : null;
  const pola = kata.map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`);
  const rows = await sql`
    SELECT p.id, p.kode, p.nama, p.varian, p.kemasan, p.price_list, p.harga_nett, it.id AS item_id, it.quantity
    FROM product_pricelist p
    LEFT JOIN accurate_item it ON it.no = p.kode
    WHERE p.periode = ${PERIODE_HARGA}
      AND ${kode ? sql`upper(p.kode) = ${kode}` : sql`(SELECT bool_and(concat_ws(' ', p.nama, p.varian, p.kemasan, p.brand, p.kode) ILIKE w) FROM unnest(${pola}::text[]) AS w)`}
    ORDER BY length(p.nama), p.price_list DESC
    LIMIT 6`;
  return rows.map((r) => ({
    id: Number(r.id), kode: r.kode ? String(r.kode) : null,
    nama: [r.nama, r.varian].filter(Boolean).join(" — "), kemasan: r.kemasan ? String(r.kemasan) : null,
    priceList: Number(r.price_list) || 0, hargaNett: Number(r.harga_nett) || 0,
    itemId: r.item_id == null ? null : Number(r.item_id), stok: r.quantity == null ? null : Number(r.quantity),
  }));
}

export interface HasilBaris { ok: boolean; teks: string; masalah?: string; item?: ItemHarga; qty?: number; harga?: number }

/** Murni: nilai satu baris terhadap kandidat item (dipisah supaya bisa diuji tanpa DB). */
export function nilaiBaris(b: BarisPesan, kandidat: ItemHarga[]): HasilBaris {
  if (!Number.isFinite(b.qty) || b.qty <= 0) return { ok: false, teks: b.teks, masalah: "jumlah tak terbaca — tulis nama barang lalu jumlahnya, mis. \"Z5 LD LYSE 2\"" };
  if (Number.isNaN(b.harga as number)) return { ok: false, teks: b.teks, masalah: "harga tak terbaca — contoh \"@ 450rb\" atau \"@ 38.000.000\"" };
  if (!kandidat.length) return { ok: false, teks: b.teks, masalah: "barang tidak ditemukan di price book — coba kata lain atau kode Accurate" };
  if (kandidat.length > 1) return { ok: false, teks: b.teks, masalah: `cocok ke ${kandidat.length >= 6 ? "banyak" : kandidat.length} barang, tulis kodenya: ${kandidat.slice(0, 3).map((k) => `${k.kode ?? "tanpa kode"} ${k.nama}`).join(" · ")}` };
  const item = kandidat[0];
  const harga = b.harga ?? item.priceList;
  if (harga < item.hargaNett) return { ok: false, teks: b.teks, masalah: `harga ${rp(harga)} di bawah harga nett ${rp(item.hargaNett)} — ditolak` };
  return { ok: true, teks: b.teks, item, qty: b.qty, harga };
}

export function ringkasDraft(id: number, faskes: string, baris: HasilBaris[], nama: string): string {
  const total = baris.reduce((s, b) => s + (b.harga ?? 0) * (b.qty ?? 0), 0);
  const out = [`🧾 *Draft O${id}* — ${faskes}`];
  for (const b of baris) {
    const it = b.item as ItemHarga;
    const stok = it.stok == null ? "" : it.stok <= 0 ? " · ⚠️ stok 0" : it.stok < (b.qty ?? 0) ? ` · ⚠️ stok ${it.stok.toLocaleString("id-ID")}` : ` · stok ${it.stok.toLocaleString("id-ID")}`;
    out.push(`• ${it.nama}${it.kode ? ` [${it.kode}]` : ""} × ${(b.qty ?? 0).toLocaleString("id-ID")}${it.kemasan ? ` ${it.kemasan}` : ""} @ ${rp(b.harga ?? 0)}${stok}`);
  }
  out.push(`Total ${rp(total)} (sebelum PPN).`, `Benar, ${nama}? Balas *#ORDER ya O${id}* untuk mengirim ke Admin Sales, atau #ORDER batal O${id}.`);
  return out.join("\n");
}

// ── Kueri ────────────────────────────────────────────────────────────────

export class OrderError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string, public field?: string) { super(message); }
}
export interface Pengirim { am_id: string; nama: string; role: string | null }

const bolehPesan = (p: Pengirim): boolean => ["am", "hod", "admin", "direktur"].includes((p.role ?? "").toLowerCase());

/** Balasan WA untuk satu pesan #ORDER. Menulis draft/antrean bila perlu. */
export async function balasanOrder(body: string, p: Pengirim, sumberJid: string | null): Promise<string> {
  if (!bolehPesan(p)) return `#ORDER khusus tim sales (AM/HoD), ${p.nama}.`;
  const cmd = parseOrder(body);
  const sql = db();
  if (cmd.aksi === "bantuan") return BANTUAN_ORDER;
  if (cmd.aksi === "status") {
    const rows = await sql`
      SELECT o.id, o.status, o.so_number, COALESCE(NULLIF(ac.name, ''), 'Customer #' || o.account_id) AS faskes, o.dibuat_at
      FROM order_wa o LEFT JOIN accurate_customer ac ON ac.id = o.account_id
      WHERE o.am_id = ${p.am_id} AND o.dibuat_at > now() - interval '30 days' ORDER BY o.id DESC LIMIT 8`;
    if (!rows.length) return `Belum ada pesanan 30 hari terakhir, ${p.nama}.`;
    const lbl: Record<string, string> = { draft: "draft — belum dikirim", antrean: "di antrean Admin", diproses: "sedang diinput Admin", selesai: "masuk Accurate", batal: "batal" };
    return [`📋 Pesanan ${p.nama} (30 hari):`, ...rows.map((r) => `• O${r.id} ${r.faskes} — ${lbl[String(r.status)] ?? r.status}${r.so_number ? ` (${r.so_number})` : ""}`)].join("\n");
  }
  if (cmd.aksi === "ya" || cmd.aksi === "batal") {
    const [o] = await sql`SELECT id, am_id, status, account_id, dibuat_at FROM order_wa WHERE id = ${cmd.ref}`;
    if (!o || String(o.am_id) !== p.am_id) return `Pesanan O${cmd.ref} tidak ditemukan atas nama ${p.nama}.`;
    if (cmd.aksi === "ya") {
      if (o.status !== "draft") return `O${cmd.ref} sudah ${o.status === "batal" ? "dibatalkan" : "dikirim"} sebelumnya.`;
      if (Date.now() - new Date(o.dibuat_at as string).getTime() > 24 * 3600_000) return `Draft O${cmd.ref} sudah lewat 24 jam — kirim ulang #ORDER supaya harga & stok diperiksa ulang.`;
      await sql`UPDATE order_wa SET status = 'antrean', dikonfirmasi_at = now(), updated_at = now() WHERE id = ${cmd.ref} AND status = 'draft'`;
      await kabariAdmin(sql, cmd.ref).catch((e) => console.error("[order-wa] notifikasi admin gagal:", (e as Error).message));
      return `✅ O${cmd.ref} masuk antrean Admin Sales. Cek kapan saja dengan #ORDER status.`;
    }
    if (!["draft", "antrean"].includes(String(o.status))) return `O${cmd.ref} sudah ${o.status === "batal" ? "dibatalkan" : "diproses Admin"} — hubungi Admin Sales untuk mengubahnya.`;
    await sql`UPDATE order_wa SET status = 'batal', batal_alasan = ${cmd.alasan || "dibatalkan AM"}, batal_oleh = ${p.nama}, updated_at = now() WHERE id = ${cmd.ref}`;
    return `O${cmd.ref} dibatalkan.`;
  }
  // baru
  if (!cmd.faskes) return `Faskes belum ditulis. ${BANTUAN_ORDER}`;
  if (!cmd.baris.length) return `Barang belum ditulis — tiap baris sesudah nama faskes: nama/kode barang + jumlah.\n\n${BANTUAN_ORDER}`;
  if (cmd.baris.length > 30) return "Maksimal 30 baris barang per #ORDER — pecah jadi beberapa pesanan.";
  const f = await cariAkun(cmd.faskes);
  if (f.kind === "none") return `Faskes "${cmd.faskes}" tidak ditemukan di Accurate. Tulis nama lebih lengkap (jenis + nama + kota). Draft BELUM dibuat.`;
  if (f.kind === "ambiguous") return `Faskes "${cmd.faskes}" cocok ke beberapa:\n${f.names.slice(0, 5).map((n, i) => `${i + 1}. ${n}`).join("\n")}\nKirim ulang dengan nama yang lebih lengkap. Draft BELUM dibuat.`;
  const hasil: HasilBaris[] = [];
  for (const b of cmd.baris) hasil.push(nilaiBaris(b, Number.isFinite(b.qty) ? await cariItem(sql, b.query) : []));
  const gagal = hasil.filter((h) => !h.ok);
  if (gagal.length) return [`⚠️ ${gagal.length} baris perlu diperbaiki, ${p.nama} — draft BELUM dibuat:`, ...gagal.map((g) => `• "${g.teks}": ${g.masalah}`)].join("\n");
  const id = await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [o] = await t`INSERT INTO order_wa (am_id, account_id, teks_asli, sumber_jid) VALUES (${p.am_id}, ${f.ids[0]}, ${body.slice(0, 4000)}, ${sumberJid}) RETURNING id`;
    let urut = 0;
    for (const h of hasil) {
      const it = h.item as ItemHarga;
      urut += 1;
      await t`INSERT INTO order_wa_item (order_id, urut, teks_asli, pricebook_id, kode, item_id, nama, qty, satuan, harga, harga_list, harga_nett, stok)
              VALUES (${o.id}, ${urut}, ${h.teks}, ${it.id}, ${it.kode}, ${it.itemId}, ${it.nama}, ${h.qty as number}, ${it.kemasan}, ${h.harga as number}, ${it.priceList}, ${it.hargaNett}, ${it.stok})`;
    }
    return Number(o.id);
  });
  return ringkasDraft(id, f.name, hasil, p.nama);
}

const waAdminAktif = (): boolean => (process.env.ORDER_WA_ADMIN_ENABLED ?? "false").toLowerCase() === "true";

async function kabariAdmin(sql: Sql, id: number) {
  const target = (process.env.ORDER_WA_ADMIN_TARGET ?? "").trim();
  if (!waAdminAktif() || !target) return;
  const [o] = await sql`
    SELECT o.id, COALESCE(NULLIF(ac.name, ''), 'Customer #' || o.account_id) AS faskes, COALESCE(mu.nama, o.am_id) AS am,
           (SELECT count(*) FROM order_wa_item i WHERE i.order_id = o.id)::int AS baris,
           (SELECT sum(i.qty * i.harga) FROM order_wa_item i WHERE i.order_id = o.id)::float8 AS total
    FROM order_wa o LEFT JOIN accurate_customer ac ON ac.id = o.account_id LEFT JOIN master_user mu ON mu.am_id = o.am_id
    WHERE o.id = ${id}`;
  if (!o) return;
  await sendViaWaGateway(target, `🧾 Pesanan baru *O${o.id}* — ${o.faskes} (AM ${o.am}), ${o.baris} barang, ${rp(Number(o.total) || 0)}. Rincian: menu Antrean Order.`);
}

// ── Antrean (web) ────────────────────────────────────────────────────────

/** Cocokkan pesanan antrean/diproses dengan SO Accurate: faskes sama, SO tertanggal −1..+14 hari dari
 *  konfirmasi, dan (bila pesanan punya item ber-kode) minimal satu kode item sama. SO yang sudah
 *  dipakai pesanan lain dilewati. Hasil: status selesai, selesai_oleh 'otomatis'. */
export async function cocokkanSo(): Promise<number> {
  const sql = db();
  const rows = await sql`
    WITH kandidat AS (
      SELECT o.id AS order_id, so.id AS so_id, so.number, so.trans_date,
             row_number() OVER (PARTITION BY o.id ORDER BY so.trans_date, so.id) AS rn
      FROM order_wa o
      JOIN accurate_sales_order so ON so.customer_id = o.account_id
       AND so.trans_date BETWEEN (o.dikonfirmasi_at AT TIME ZONE 'Asia/Jakarta')::date - 1 AND (o.dikonfirmasi_at AT TIME ZONE 'Asia/Jakarta')::date + 14
      WHERE o.status IN ('antrean', 'diproses') AND o.dikonfirmasi_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM order_wa x WHERE x.so_id = so.id)
        AND (NOT EXISTS (SELECT 1 FROM order_wa_item i WHERE i.order_id = o.id AND i.kode IS NOT NULL)
             OR EXISTS (SELECT 1 FROM order_wa_item i JOIN accurate_sales_order_item si ON si.order_id = so.id AND si.item_no = i.kode WHERE i.order_id = o.id))
    )
    UPDATE order_wa o SET status = 'selesai', so_id = k.so_id, so_number = k.number, selesai_at = now(), selesai_oleh = 'otomatis', updated_at = now()
    FROM kandidat k WHERE k.order_id = o.id AND k.rn = 1
    RETURNING o.id`;
  return rows.length;
}

export async function daftarOrder(sc: DataScope = FULL_SCOPE, status?: string) {
  const sql = db();
  const dicocokkan = await cocokkanSo().catch(() => 0);
  const rows = await sql`
    SELECT o.id::text, o.status, o.am_id, COALESCE(mu.nama, o.am_id) AS am, upper(btrim(COALESCE(mu.cabang, ''))) AS cabang,
           o.account_id::text, COALESCE(NULLIF(ac.name, ''), 'Customer #' || o.account_id) AS faskes,
           o.dibuat_at, o.dikonfirmasi_at, o.diproses_oleh, o.diproses_at, o.so_number, o.selesai_at, o.selesai_oleh, o.batal_alasan, o.catatan,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('urut', i.urut, 'kode', i.kode, 'nama', i.nama, 'qty', i.qty, 'satuan', i.satuan, 'harga', i.harga,
                                                          'harga_list', i.harga_list, 'harga_nett', i.harga_nett, 'stok', i.stok) ORDER BY i.urut)
                     FROM order_wa_item i WHERE i.order_id = o.id), '[]'::jsonb) AS item
    FROM order_wa o
    LEFT JOIN master_user mu ON mu.am_id = o.am_id
    LEFT JOIN accurate_customer ac ON ac.id = o.account_id
    WHERE o.dibuat_at > now() - interval '120 days'
      ${status ? sql`AND o.status = ${status}` : sql`AND o.status <> 'draft'`}
      ${scopeOnClause(sql, sc, sql`o.am_id`, sql`mu.cabang`)}
    ORDER BY CASE o.status WHEN 'antrean' THEN 0 WHEN 'diproses' THEN 1 ELSE 2 END, o.dikonfirmasi_at DESC NULLS LAST, o.id DESC
    LIMIT 500`;
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    dicocokkan, ringkas: { antrean: n("antrean"), diproses: n("diproses"), selesai: n("selesai"), batal: n("batal") },
    order: rows.map((r) => ({ ...r, item: (r.item as unknown[]) ?? [], total: ((r.item as { qty: number; harga: number }[]) ?? []).reduce((s, i) => s + Number(i.qty) * Number(i.harga), 0) })),
  };
}

export async function ubahStatusOrder(id: string, b: { status: string; so_number?: string | null; alasan?: string | null; catatan?: string | null }, oleh: string) {
  if (!/^\d+$/.test(id)) throw new OrderError(400, "id tidak valid");
  const sql = db();
  const [o] = await sql`SELECT status FROM order_wa WHERE id = ${id}::bigint`;
  if (!o) throw new OrderError(404, "pesanan tidak ditemukan");
  const dari = String(o.status);
  const ke = b.status;
  const boleh: Record<string, string[]> = { antrean: ["diproses", "selesai", "batal"], diproses: ["antrean", "selesai", "batal"], selesai: ["diproses"], draft: ["batal"], batal: [] };
  if (!(boleh[dari] ?? []).includes(ke)) throw new OrderError(409, `status ${dari} tidak bisa diubah ke ${ke}`, "status");
  const so = (b.so_number ?? "").trim() || null;
  const alasan = (b.alasan ?? "").trim() || null;
  if (ke === "selesai" && !so) throw new OrderError(400, "isi nomor SO Accurate", "so_number");
  if (ke === "batal" && !alasan) throw new OrderError(400, "isi alasan batal", "alasan");
  const [u] = await sql`
    UPDATE order_wa SET status = ${ke}::text,
      diproses_oleh = CASE WHEN ${ke}::text = 'diproses' THEN ${oleh}::text ELSE diproses_oleh END,
      diproses_at = CASE WHEN ${ke}::text = 'diproses' THEN now() ELSE diproses_at END,
      so_number = CASE WHEN ${ke}::text = 'selesai' THEN ${so}::text WHEN ${ke}::text = 'diproses' AND ${dari}::text = 'selesai' THEN NULL ELSE so_number END,
      so_id = CASE WHEN ${ke}::text = 'selesai' THEN (SELECT id FROM accurate_sales_order WHERE number = ${so}::text LIMIT 1) WHEN ${ke}::text = 'diproses' THEN NULL ELSE so_id END,
      selesai_at = CASE WHEN ${ke}::text = 'selesai' THEN now() WHEN ${ke}::text = 'diproses' THEN NULL ELSE selesai_at END,
      selesai_oleh = CASE WHEN ${ke}::text = 'selesai' THEN ${oleh}::text WHEN ${ke}::text = 'diproses' THEN NULL ELSE selesai_oleh END,
      batal_alasan = CASE WHEN ${ke}::text = 'batal' THEN ${alasan}::text ELSE batal_alasan END,
      batal_oleh = CASE WHEN ${ke}::text = 'batal' THEN ${oleh}::text ELSE batal_oleh END,
      catatan = COALESCE(${(b.catatan ?? "").trim() || null}::text, catatan),
      updated_at = now()
    WHERE id = ${id}::bigint RETURNING id::text, status`;
  return u;
}
