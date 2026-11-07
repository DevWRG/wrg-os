// Handler WA `#CEK CUSTOMER <nama customer>` (QW3) — cek pre-delivery singkat
// SO+SJ+TTF dalam 1 balasan, dari mirror Accurate (accurate_sales_order/
// accurate_delivery_order). AM/salesman via live call ke Accurate
// (getSalesOrderItems) — kredensial tak tersedia (mis. dev lokal) → AM
// di-skip, balasan SO/SJ tetap jalan. TTF (Surat Terima) belum punya sumber
// data/menu input → baris placeholder statis (keputusan scope QW3), bukan
// hasil query. Kurir/no. resi/tanggal TERIMA SENGAJA belum ditampilkan —
// tidak ada sumbernya di Accurate maupun tabel lain yg terhubung ke SO/SJ
// (lihat docs/features/F4-cek-faktur-so-sj-cross-ref.md).
//
// Sub-command lain dari spec asli (`#CEK SO <nomor>`, `#CEK SJ <nomor>`,
// `#CEK FAKTUR <nomor>`) diimplementasi TERPISAH di cek.ts (varian "F4 SXR",
// nomor dokumen bukan nama customer) — lihat routing di inbound.ts.
//
// ── Resolusi customer: SATU identitas dulu, baru ambil dokumennya ──
// Versi pertama (PR #868) fuzzy-match SO dan SJ SECARA TERPISAH, masing-masing
// `ORDER BY score DESC LIMIT 1`. Akibatnya dua customer berbeda dengan nama
// mirip bisa saling mencuri hasil: balasan menampilkan header customer A
// dengan SJ milik customer B — data komersial customer lain bocor ke pengirim
// yang salah (issue #839, reproduksi: scripts/db/seed-cek-dev.sql kasus #5).
//
// Sekarang: resolve DULU satu customer (`accurate_customer`, kolom `customer_id`
// dari migrasi 162), baru ambil SO & SJ yang terikat ke id itu. Dengan begitu
// dua blok balasan mustahil berasal dari customer berbeda — bukan karena
// thresholdnya dinaikkan, tapi karena strukturnya cuma punya satu identitas.
// Kalau nama query cocok ke lebih dari satu customer, balasannya BERTANYA
// (daftar kandidat), tidak memilih diam-diam — pola yang sama dipakai Phase A
// waktu kandidat SJ-nya lebih dari satu.

import { db } from "../db.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { fmtRp } from "./inbound-sales-analytics.js";
import { getSalesOrderItems } from "./accurateSync.js";
import { resolveCustomer, normNama } from "./customer-resolve.js";

const CEK_CUSTOMER_LINE = /^\s*#\s*cek\s+customer\b/i;
// Threshold sejajar ACCOUNT_MATCH (0.45, inbound.ts:424), bukan 0.3 milik
// plan/report. Yang dicocokkan sekarang adalah `accurate_customer` — tabel
// master identitas, persis kelas yang dipakai ACCOUNT_MATCH — bukan lagi teks
// bebas `customer_name` di baris transaksi. 0.3 dipertahankan cuma untuk
// jalur fallback (lihat FALLBACK_MATCH).
const CEK_MATCH = 0.45;
// Jalur fallback dipakai saat `accurate_customer` tak punya kandidat sama
// sekali (mis. dev/demo yang mirror customernya belum di-seed). Di situ
// identitasnya diambil dari NAMA di SO/SJ, jadi ambangnya boleh lebih longgar
// — gerbang anti-bocornya bukan ambang ini, melainkan aturan "satu nama
// kanonik untuk kedua tabel" di resolveCustomer().
const FALLBACK_MATCH = 0.3;

function extractCustomer(body: string | null): string | null {
  if (!body) return null;
  for (const line of stripInvisible(body).split(/\r?\n/)) {
    if (CEK_CUSTOMER_LINE.test(line)) return line.replace(CEK_CUSTOMER_LINE, "").trim();
  }
  return null;
}

export function detectCek(body: string | null): boolean {
  return extractCustomer(body) !== null;
}

// Aturan "satu identitas atau bertanya" (resolveCustomer) tinggal di
// customer-resolve.ts — dipakai juga #CALL/#NOTE (F95), dan main tak punya
// berkas ini. Diekspor ulang supaya pemanggil & tes lama tak berubah.
export { resolveCustomer, normNama, type CustCandidate, type CekResolve } from "./customer-resolve.js";

export function balasanAmbigu(q: string, names: string[]): string {
  return (
    `🔎 Nama "${q}" cocok ke ${names.length} customer — sebutkan yang mana:\n` +
    names.map((n) => `• ${n}`).join("\n") +
    `\n\nKetik ulang, mis. *#CEK CUSTOMER ${names[0]}*`
  );
}

export async function handleCekQuery(body: string | null): Promise<string> {
  const q = extractCustomer(body);
  if (!q) return "Ketik: #CEK CUSTOMER [nama customer]";

  const sql = db();
  // Nama mirror bisa empty-string (bukan NULL) — COALESCE saja tak cukup,
  // pola yang sama dipakai resolveActivityLinks (inbound.ts:435).
  const custRows = await sql`
    SELECT id::text AS id,
           COALESCE(NULLIF(name,''), raw->>'name', '') AS name,
           similarity(COALESCE(NULLIF(name,''), raw->>'name', ''), ${q}) AS score
    FROM accurate_customer
    WHERE similarity(COALESCE(NULLIF(name,''), raw->>'name', ''), ${q}) >= ${CEK_MATCH}
    ORDER BY score DESC
    LIMIT 20
  `;
  let hasil = resolveCustomer(
    q,
    custRows.map((r) => ({ id: r.id == null ? null : Number(r.id), name: String(r.name ?? ""), score: Number(r.score) })),
  );

  // Fallback: mirror customer belum lengkap di environment ini. Identitas
  // diambil dari nama DISTINCT gabungan SO+SJ — tetap satu identitas untuk
  // kedua tabel, jadi tak bisa saling mencuri hasil.
  if (hasil.kind === "none") {
    const namaRows = await sql`
      SELECT name, max(score) AS score FROM (
        SELECT customer_name AS name, similarity(customer_name, ${q}) AS score
          FROM accurate_sales_order    WHERE similarity(customer_name, ${q}) >= ${FALLBACK_MATCH}
        UNION ALL
        SELECT customer_name AS name, similarity(customer_name, ${q}) AS score
          FROM accurate_delivery_order WHERE similarity(customer_name, ${q}) >= ${FALLBACK_MATCH}
      ) t
      WHERE name IS NOT NULL AND name <> ''
      GROUP BY name ORDER BY score DESC LIMIT 20
    `;
    hasil = resolveCustomer(
      q,
      namaRows.map((r) => ({ id: null, name: String(r.name), score: Number(r.score) })),
    );
  }

  if (hasil.kind === "none") return `Customer "${q}" tidak ditemukan di data SO/SJ.`;
  if (hasil.kind === "ambiguous") return balasanAmbigu(q, hasil.names);

  const ids = hasil.ids;
  const nama = normNama(hasil.name);
  // Baris lama yang `customer_id`-nya belum keisi (sync sebelum migrasi 162,
  // atau seed) tetap ikut lewat pencocokan nama PERSIS — bukan fuzzy, jadi
  // tidak membuka lagi jalur bocornya. Dibungkus fungsi, bukan konstanta:
  // fragmen sql`` di postgres.js sekali pakai per query.
  const cocokCustomer = () => sql`(
    customer_id = ANY(${ids}::bigint[])
    OR (customer_id IS NULL AND regexp_replace(lower(btrim(customer_name)), '\\s+', ' ', 'g') = ${nama})
  )`;

  const [so] = await sql`
    SELECT id::text AS id, number, trans_date::text AS trans_date, status, customer_name, total_amount
    FROM accurate_sales_order
    WHERE ${cocokCustomer()}
    ORDER BY trans_date DESC, id DESC LIMIT 1
  `;
  const [sj] = await sql`
    SELECT number, trans_date::text AS trans_date, status, customer_name
    FROM accurate_delivery_order
    WHERE ${cocokCustomer()}
    ORDER BY trans_date DESC, id DESC LIMIT 1
  `;
  if (!so && !sj) return `Customer "${hasil.name}" belum punya SO maupun SJ di data Accurate.`;

  // AM (salesman) — live call ke Accurate detail.do (bukan mirror lokal, sumber
  // satu-satunya utk nama AM per-SO). Gagal (kredensial tak tersedia/lokal dev,
  // atau error API) → AM cukup di-skip, jangan sampai gagalkan balasan SO/SJ.
  let amLine = "";
  if (so) {
    try {
      const det = await getSalesOrderItems(Number(so.id));
      const salesman = det.ok ? det.summary?.salesman : null;
      if (salesman) amLine = ` · AM: ${salesman}`;
    } catch {
      /* live call gagal (mis. kredensial/lokal dev) → AM di-skip, bukan error */
    }
  }

  const soBlock = so
    ? `📋 SO ${so.number ?? "-"} · ${fmtRp(Number(so.total_amount ?? 0))}\n   Status: ${so.status ?? "-"}${amLine}`
    : "📋 Belum ada SO tercatat";
  const sjBlock = sj
    ? `→ SJ ${sj.number ?? "-"} (${sj.trans_date ?? "-"})\n   Status: ${sj.status ?? "-"}`
    : "→ Belum ada SJ tercatat";
  return `🔎 *Cek Customer — ${hasil.name}*\n\n${soBlock}\n\n${sjBlock}\n\n🚩 TTF belum received`;
}
