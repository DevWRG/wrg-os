import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";

// F38 ED Watch & Near-Expiry Alert (PURCHASING). Lanjutan F37: F37 melacak stok
// per item per GUDANG, F38 menambah dimensi BATCH karena ED itu milik batch —
// satu SKU bisa punya beberapa batch ber-ED berbeda di gudang yang sama.
//
// Tiga hal yang perlu dipegang saat membaca file ini:
//
// 1. TIER ALERT 90/60/30 pakai penanda ANGKA (`alert_tier_terkirim`), bukan
//    boolean per-ambang. Alasannya bukan gaya: kalau cron mati seminggu dan
//    barang melompat 65 → 58 hari, tier 60 TETAP berbunyi karena syaratnya
//    `tier < yang tercatat`. Boolean per-ambang akan kehilangan lompatan itu.
//
// 2. TANGGAL DIHITUNG DI JS BERBASIS WIB, bukan `current_date` SQL. Container
//    Postgres ber-timezone Etc/UTC, jadi `current_date` adalah tanggal UTC —
//    dengan cron pagi (mis. 07:00 WIB = 00:00 UTC) selisih harinya bisa geser 1
//    dan seluruh perhitungan sisa-hari salah tanpa gejala. Pelajaran dari F45.
//
// 3. PETUNJUK KSO ITU PETUNJUK, BUKAN KEPUTUSAN. Tidak ada registri kontrak KSO
//    aktif per customer di sistem ini (tabel `kso_*` migrasi 074 itu katalog
//    harga simulator, bukan daftar kontrak). Yang ada: kategori pengadaan per
//    baris faktur `charField1` bernilai KSO/REGULAR/RUTIN/PL/ECAT — dipakai
//    produksi di view Per-Pengadaan. Jadi "item ini historisnya untuk KSO" bisa
//    diturunkan, TAPI ada bucket 'Tanpa kategori' sehingga cakupannya tidak
//    100%, dan histori ≠ komitmen kontrak. UI & pesan WA menandainya sebagai
//    petunjuk. JANGAN ubah jadi klaim pasti.

// Hari ini menurut WIB (UTC+7) — lihat poin 2 di atas.
const hariIniWib = (): string =>
  new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// Tier 0 = SUDAH LEWAT ED. Tanpa itu, batch yang siklus alert-nya normal
// (90→60→30) tak akan pernah diperingatkan saat benar-benar kedaluwarsa: tier-nya
// tetap 30, syarat `30 < 30` false. Padahal justru di titik itu saran berubah
// jadi "retur" — satu-satunya saran yang butuh tindakan segera, dan justru yang
// dibutuhkan KPI gudang "Barang expired → 0".
export const TIERS = [90, 60, 30, 0] as const;
export type Tier = (typeof TIERS)[number];

// Tier untuk sisa hari tertentu: ambang TERKECIL yang sudah terlampaui.
// 100 hari → null (belum masuk pantauan), 75 → 90, 45 → 60, 12 → 30, -3 → 0.
export function tierUntuk(sisaHari: number): Tier | null {
  if (sisaHari < 0) return 0;
  if (sisaHari <= 30) return 30;
  if (sisaHari <= 60) return 60;
  if (sisaHari <= 90) return 90;
  return null;
}

export type SaranAlokasi = "retur" | "trial" | "kso" | "reguler";

// Saran alokasi — OUTPUT REKOMENDASI, bukan FK ke entitas.
// Konsep "trial" tidak ada di sistem ini (dicari di seluruh skema & kode: nihil),
// jadi ini sengaja cuma label. Urutannya mengikuti deskripsi board
// ("KSO first, ED-short to trial") dengan satu tambahan di depan: barang yang
// SUDAH lewat ED tak boleh dialokasikan ke mana pun.
export function saranAlokasi(sisaHari: number, adaHistoriKso: boolean): SaranAlokasi {
  if (sisaHari < 0) return "retur";
  if (sisaHari <= 30) return "trial";
  if (adaHistoriKso) return "kso";
  return "reguler";
}

const LABEL_SARAN: Record<SaranAlokasi, string> = {
  retur: "sudah lewat ED — jangan dijual, proses retur/hapus",
  trial: "ED pendek — arahkan ke trial/demo atau promo",
  kso: "prioritaskan untuk KSO (petunjuk dari histori faktur)",
  reguler: "alokasi reguler",
};

export interface StockBatchRow {
  item_id: string;
  no: string;
  name: string;
  unit: string | null;
  warehouse_kode: string;
  warehouse_nama: string;
  batch_no: string;
  ed_date: string | null;
  quantity: number;
  sisa_hari: number | null; // null kalau ed_date null
  tier: Tier | null;
  sudah_lewat: boolean;
  ada_histori_kso: boolean;
  saran: SaranAlokasi | null;
  saran_label: string | null;
  source: string;
  alert_tier_terkirim: number | null;
  alert_terkirim_at: string | null;
  updated_at: string;
}

export interface StockBatchQuery {
  q?: string;
  warehouse?: string;
  tier?: Tier; // hanya batch yang tier-nya persis ini
  hanyaLewat?: boolean; // hanya yang sudah lewat ED
  tanpaEd?: boolean; // hanya batch yang ed_date-nya kosong (cakupan data bolong)
  limit?: number;
  offset?: number;
}

// CTE petunjuk KSO. Dibaca dari `accurate_invoice_item` (punya kolom `item_id`
// + `raw` per baris faktur) — BUKAN dari unnest `accurate_invoice.raw->detailItem`
// yang dipakai view Per-Pengadaan. Objeknya sama (`accurate_invoice_item.raw` =
// elemen `detailItem[]`, lihat accurateSync.ts), tapi di sini tak perlu membongkar
// array jsonb untuk setiap faktur — jauh lebih murah untuk cron harian.
const KSO_HIST = `
  SELECT item_id, count(*)::int AS n_kso
  FROM accurate_invoice_item
  WHERE item_id IS NOT NULL AND raw->>'charField1' = 'KSO'
  GROUP BY item_id
`;

function mapRow(r: Record<string, unknown>, hariIni: string): StockBatchRow {
  const ed = r.ed_date == null ? null : new Date(r.ed_date as string | Date).toISOString().slice(0, 10);
  const sisa =
    ed == null
      ? null
      : Math.round(
          (new Date(`${ed}T00:00:00Z`).getTime() - new Date(`${hariIni}T00:00:00Z`).getTime()) / 86_400_000,
        );
  const kso = Number(r.n_kso ?? 0) > 0;
  const saran = sisa == null ? null : saranAlokasi(sisa, kso);
  return {
    item_id: String(r.item_id),
    no: String(r.no ?? ""),
    name: String(r.name ?? ""),
    unit: r.unit == null ? null : String(r.unit),
    warehouse_kode: String(r.warehouse_kode),
    warehouse_nama: String(r.warehouse_nama ?? r.warehouse_kode),
    batch_no: String(r.batch_no),
    ed_date: ed,
    quantity: Number(r.quantity),
    sisa_hari: sisa,
    tier: sisa == null ? null : tierUntuk(sisa),
    sudah_lewat: sisa != null && sisa < 0,
    ada_histori_kso: kso,
    saran,
    saran_label: saran == null ? null : LABEL_SARAN[saran],
    source: String(r.source),
    alert_tier_terkirim: r.alert_tier_terkirim == null ? null : Number(r.alert_tier_terkirim),
    alert_terkirim_at:
      r.alert_terkirim_at == null ? null : new Date(r.alert_terkirim_at as string | Date).toISOString(),
    updated_at: new Date(r.updated_at as string | Date).toISOString(),
  };
}

export async function listStockBatch(qy: StockBatchQuery = {}): Promise<{
  rows: StockBatchRow[];
  total_rows: number;
}> {
  const sql = db();
  const limit = Math.min(Math.max(Number(qy.limit) || 200, 1), 20000);
  const offset = Math.max(Number(qy.offset) || 0, 0);
  const q = (qy.q ?? "").trim();
  const wh = (qy.warehouse ?? "").trim();
  const hariIni = hariIniWib();

  const rows = await sql`
    WITH kso AS (${sql.unsafe(KSO_HIST)}), dasar AS (
      SELECT sb.item_id, ai.no, ai.name, ai.unit, sb.warehouse_kode, w.nama AS warehouse_nama,
             sb.batch_no, sb.ed_date, sb.quantity, sb.source,
             sb.alert_tier_terkirim, sb.alert_terkirim_at, sb.updated_at,
             COALESCE(k.n_kso, 0) AS n_kso,
             CASE WHEN sb.ed_date IS NULL THEN NULL
                  ELSE (sb.ed_date - ${hariIni}::date) END AS sisa_hari
      FROM item_stock_batch sb
      JOIN accurate_item ai ON ai.id = sb.item_id
      -- INNER JOIN + gerbang jenis: batch di gudang VIRTUAL DI CUSTOMER tak
      -- pernah ikut, dan gudang yang dinonaktifkan juga tidak. Beda dari F37 yang
      -- LEFT JOIN dari accurate_item (di sana item tanpa data harus tetap muncul);
      -- di sini baris tanpa gudang cabang yang sah memang tak boleh ada.
      JOIN warehouse w ON w.kode = sb.warehouse_kode AND w.jenis = 'cabang' AND w.aktif
      LEFT JOIN kso k ON k.item_id = sb.item_id
      WHERE (${q} = '' OR ai.no ILIKE ${"%" + q + "%"} OR ai.name ILIKE ${"%" + q + "%"}
             OR sb.batch_no ILIKE ${"%" + q + "%"})
        AND (${wh} = '' OR sb.warehouse_kode = ${wh})
    ), difilter AS (
      SELECT * FROM dasar
      WHERE (${qy.tanpaEd ?? false} = false OR ed_date IS NULL)
        AND (${qy.hanyaLewat ?? false} = false OR (ed_date IS NOT NULL AND sisa_hari < 0))
        -- Filter tier di sini SALING LEPAS (0-30 / 31-60 / 61-90), SENGAJA beda
        -- dari predikat kumulatif di runEdWatch. Alasannya: filter ini jalur
        -- drill-down dari kartu ringkasan, dan kartunya juga saling lepas —
        -- kalau di sini kumulatif, tombol "≤ 30 hari" mengembalikan LEBIH BANYAK
        -- baris daripada angka di kartu yang baru diklik (terukur: kartu 1,
        -- tombol 2, karena batch yang sudah lewat ED ikut terbawa). Batch yang
        -- sudah lewat punya tombolnya sendiri ("lewat=1").
        --
        -- Yang kumulatif tetap runEdWatch — di sana justru harus, karena batch
        -- yang sudah lewat pun perlu diperingatkan kalau belum pernah.
        AND (${qy.tier ?? null}::int IS NULL OR (
              ed_date IS NOT NULL AND
              CASE WHEN sisa_hari < 0 THEN 0
                   WHEN sisa_hari <= 30 THEN 30
                   WHEN sisa_hari <= 60 THEN 60
                   WHEN sisa_hari <= 90 THEN 90
                   ELSE NULL END = ${qy.tier ?? null}::int))
    )
    SELECT *, count(*) OVER () AS total_rows
    FROM difilter
    -- ED terdekat dulu; ed_date NULL di akhir (bukan di depan lewat NULLS FIRST).
    ORDER BY ed_date ASC NULLS LAST, no, batch_no
    LIMIT ${limit} OFFSET ${offset}
  `;

  // Sama pola F37: halaman kosong tak punya baris untuk membaca total_rows.
  if (rows.length === 0 && offset > 0) {
    const probe = await listStockBatch({ ...qy, limit: 1, offset: 0 });
    return { rows: [], total_rows: probe.total_rows };
  }

  return {
    total_rows: rows.length ? Number(rows[0].total_rows) : 0,
    rows: rows.map((r) => mapRow(r, hariIni)),
  };
}

export interface StockBatchSummary {
  hari_ini: string; // tanggal WIB yang dipakai menghitung sisa hari
  batch_total: number;
  batch_tanpa_ed: number; // cakupan data bolong — bukan "aman"
  qty_total: number;
  tier: { tier: Tier; batch: number; qty: number }[];
  sudah_lewat: { batch: number; qty: number };
  per_gudang: { kode: string; nama: string; batch: number; qty: number; terdekat: string | null }[];
  terakhir_update: string | null;
}

export async function stockBatchSummary(): Promise<StockBatchSummary> {
  const sql = db();
  const hariIni = hariIniWib();

  const [agg] = await sql`
    WITH d AS (
      SELECT sb.quantity, sb.ed_date,
             CASE WHEN sb.ed_date IS NULL THEN NULL ELSE (sb.ed_date - ${hariIni}::date) END AS sisa
      FROM item_stock_batch sb
      JOIN warehouse w ON w.kode = sb.warehouse_kode AND w.jenis = 'cabang' AND w.aktif
    )
    SELECT count(*)::int AS batch_total,
           count(*) FILTER (WHERE ed_date IS NULL)::int AS batch_tanpa_ed,
           COALESCE(sum(quantity), 0) AS qty_total,
           count(*) FILTER (WHERE sisa IS NOT NULL AND sisa < 0)::int AS lewat_batch,
           COALESCE(sum(quantity) FILTER (WHERE sisa IS NOT NULL AND sisa < 0), 0) AS lewat_qty,
           -- "sisa >= 0" WAJIB: tanpa itu batch yang sudah lewat ED (sisa negatif)
           -- ikut terhitung di tier 30 SEKALIGUS di sudah_lewat, jadi pembaca yang
           -- menjumlahkan kartu tidak akan pernah cocok dengan total. Sekarang
           -- semua ember saling lepas: lewat + 30 + 60 + 90 + >90 + tanpa_ed = total.
           count(*) FILTER (WHERE sisa IS NOT NULL AND sisa >= 0 AND sisa <= 30)::int AS t30_batch,
           COALESCE(sum(quantity) FILTER (WHERE sisa IS NOT NULL AND sisa >= 0 AND sisa <= 30), 0) AS t30_qty,
           count(*) FILTER (WHERE sisa IS NOT NULL AND sisa > 30 AND sisa <= 60)::int AS t60_batch,
           COALESCE(sum(quantity) FILTER (WHERE sisa IS NOT NULL AND sisa > 30 AND sisa <= 60), 0) AS t60_qty,
           count(*) FILTER (WHERE sisa IS NOT NULL AND sisa > 60 AND sisa <= 90)::int AS t90_batch,
           COALESCE(sum(quantity) FILTER (WHERE sisa IS NOT NULL AND sisa > 60 AND sisa <= 90), 0) AS t90_qty
    FROM d
  `;

  const perWh = await sql`
    SELECT w.kode, w.nama, count(sb.batch_no)::int AS batch,
           COALESCE(sum(sb.quantity), 0) AS qty,
           min(sb.ed_date) AS terdekat
    FROM warehouse w
    LEFT JOIN item_stock_batch sb ON sb.warehouse_kode = w.kode
    WHERE w.jenis = 'cabang' AND w.aktif
    GROUP BY w.kode, w.nama, w.urutan
    ORDER BY w.urutan, w.kode
  `;
  const [upd] = await sql`
    SELECT max(sb.updated_at) AS t FROM item_stock_batch sb
    JOIN warehouse w ON w.kode = sb.warehouse_kode AND w.jenis = 'cabang' AND w.aktif
  `;

  return {
    hari_ini: hariIni,
    batch_total: Number(agg.batch_total),
    batch_tanpa_ed: Number(agg.batch_tanpa_ed),
    qty_total: Number(agg.qty_total),
    // Ember di ringkasan sengaja SALING LEPAS (0-30 / 31-60 / 61-90, dan yang
    // sudah lewat ED dihitung TERPISAH) supaya angkanya bisa dijumlahkan
    // pembaca. Tier di baris tabel tetap KUMULATIF (<=30 → 30, termasuk yang
    // negatif) karena itu yang menentukan kapan alert berbunyi — dua definisi
    // berbeda untuk dua keperluan berbeda, dan bedanya dijelaskan di UI.
    tier: [
      { tier: 30, batch: Number(agg.t30_batch), qty: Number(agg.t30_qty) },
      { tier: 60, batch: Number(agg.t60_batch), qty: Number(agg.t60_qty) },
      { tier: 90, batch: Number(agg.t90_batch), qty: Number(agg.t90_qty) },
    ],
    sudah_lewat: { batch: Number(agg.lewat_batch), qty: Number(agg.lewat_qty) },
    per_gudang: perWh.map((r) => ({
      kode: String(r.kode),
      nama: String(r.nama),
      batch: Number(r.batch),
      qty: Number(r.qty),
      terdekat: r.terdekat == null ? null : new Date(r.terdekat as string | Date).toISOString().slice(0, 10),
    })),
    terakhir_update: upd?.t == null ? null : new Date(upd.t as string | Date).toISOString(),
  };
}

// Batas baris per pesan. Tanpa cap, run pertama setelah import penuh bisa memuat
// seluruh batch ≤90 hari sekaligus — pada katalog ~5.800 SKU (satu SKU bisa banyak
// batch) itu ratusan KB. Dua-duanya buruk: gateway menolak → alert tak pernah
// terkirim dan diulang tiap hari tanpa lolos; atau WA memotong isinya → penanda
// tetap terbakar untuk baris yang tak pernah terbaca. Pola cap mengikuti
// repo/notiftua.ts (top-N + "…+N lainnya").
const MAX_BARIS_PESAN = 40;

function buildMessage(semua: StockBatchRow[], hariIni: string): string {
  const lines = [`⏳ *Peringatan ED / kedaluwarsa (${hariIni})*`];
  // Paling mendesak dulu, supaya yang terpotong adalah yang ED-nya paling jauh —
  // bukan sembarang baris.
  const urut = [...semua].sort((a, b) => (a.sisa_hari ?? 0) - (b.sisa_hari ?? 0));
  const sisaTakTampil = Math.max(0, urut.length - MAX_BARIS_PESAN);
  const rows = urut.slice(0, MAX_BARIS_PESAN);
  // Dikelompokkan per gudang: tindakannya (relokasi/promo/retur) selalu per
  // lokasi fisik, jadi daftar yang teracak antar-gudang tak bisa langsung dipakai.
  const perWh = new Map<string, StockBatchRow[]>();
  for (const r of rows) {
    if (!perWh.has(r.warehouse_kode)) perWh.set(r.warehouse_kode, []);
    perWh.get(r.warehouse_kode)!.push(r);
  }
  for (const [kode, grup] of perWh) {
    lines.push("", `*${kode} — ${grup[0].warehouse_nama}*`);
    for (const r of grup) {
      const sisa = r.sudah_lewat
        ? `SUDAH LEWAT ${Math.abs(r.sisa_hari ?? 0)} hari`
        : `${r.sisa_hari} hari lagi`;
      lines.push(
        `• ${r.no} — ${r.name}`,
        `  batch ${r.batch_no} · ED ${r.ed_date} (${sisa}) · ${r.quantity}${r.unit ? " " + r.unit : ""}`,
        `  → ${r.saran_label}`,
      );
    }
  }
  if (sisaTakTampil > 0) {
    lines.push(
      "",
      `_…dan ${sisaTakTampil} batch lainnya. Buka Inventory → tab "ED & Kedaluwarsa" untuk daftar lengkap._`,
    );
  }
  lines.push(
    "",
    "_Saran alokasi & penanda KSO adalah PETUNJUK dari histori faktur, bukan komitmen kontrak. Keputusan akhir tetap di tim gudang & supply chain._",
  );
  return lines.join("\n");
}

// Cron ed-watch: cari batch yang MELINTASI ambang baru (90/60/30) dan belum
// diberitahukan di ambang itu, kirim WA, lalu catat tier-nya.
//
// Anti-broadcast (pola F24/F45/F50): tanpa tujuan WA yang jelas, TIDAK dikirim
// dan tidak ditandai — jangan pernah fallback diam-diam ke grup besar.
// Retry-safe: penanda hanya di-set kalau gateway benar-benar mengirim.
export async function runEdWatch(
  opts: { to?: string; tanggal?: string; tandai?: boolean } = {},
): Promise<{
  hari_ini: string;
  count: number;
  notified: number;
  message: string | null;
  gateway: WaSendResult | null;
  skipped?: string;
  per_tier: { tier: Tier; count: number }[];
}> {
  const sql = db();
  const hariIni = opts.tanggal ?? hariIniWib();

  const rows = await sql`
    WITH kso AS (${sql.unsafe(KSO_HIST)})
    SELECT sb.item_id, ai.no, ai.name, ai.unit, sb.warehouse_kode, w.nama AS warehouse_nama,
           sb.batch_no, sb.ed_date, sb.quantity, sb.source,
           sb.alert_tier_terkirim, sb.alert_terkirim_at, sb.updated_at,
           COALESCE(k.n_kso, 0) AS n_kso,
           (sb.ed_date - ${hariIni}::date) AS sisa_hari
    FROM item_stock_batch sb
    JOIN accurate_item ai ON ai.id = sb.item_id
    JOIN warehouse w ON w.kode = sb.warehouse_kode AND w.jenis = 'cabang' AND w.aktif
    LEFT JOIN kso k ON k.item_id = sb.item_id
    WHERE sb.ed_date IS NOT NULL
      AND sb.quantity > 0                       -- batch habis tak perlu diperingatkan
      AND sb.ed_date <= ${hariIni}::date + 90   -- di luar 90 hari belum dipantau
      AND (
        sb.alert_tier_terkirim IS NULL
        OR CASE WHEN (sb.ed_date - ${hariIni}::date) < 0 THEN 0
                WHEN (sb.ed_date - ${hariIni}::date) <= 30 THEN 30
                WHEN (sb.ed_date - ${hariIni}::date) <= 60 THEN 60
                ELSE 90 END < sb.alert_tier_terkirim
      )
    ORDER BY w.urutan, sb.ed_date, ai.no
  `;

  const due = rows.map((r) => mapRow(r, hariIni));
  const perTier = TIERS.map((t) => ({ tier: t, count: due.filter((d) => d.tier === t).length }));
  if (due.length === 0) {
    return { hari_ini: hariIni, count: 0, notified: 0, message: null, gateway: null, per_tier: perTier };
  }

  const message = buildMessage(due, hariIni);
  const target = (opts.to || process.env.ED_WATCH_WA_TARGET || "").trim();
  if (!target) {
    return {
      hari_ini: hariIni, count: due.length, notified: 0, message,
      gateway: null, skipped: "no-target", per_tier: perTier,
    };
  }

  const gateway = await sendViaWaGateway(target, message);
  // `sent: true` TIDAK berarti pesan sampai. sendViaWaGateway mengembalikannya
  // juga di dua mode yang tak mengirim apa pun: stub (WA_SEND_URL kosong) dan
  // DRY-RUN — dan WA_DRY_RUN DEFAULT-nya "true" (langkah go-live terakhir justru
  // menyetelnya ke "false").
  //
  // Kalau penanda tier dibakar di mode itu, urutan go-live yang ditulis repo
  // sendiri (set target + ED_WATCH_ENABLED=true, WA_DRY_RUN masih true) akan
  // menandai SEMUA batch ≤90 hari tanpa satu pesan terkirim — dan karena
  // syaratnya `tier < yang tercatat`, ambang itu TAK AKAN BERBUNYI LAGI
  // selamanya. Pemulihannya hanya lewat UPDATE SQL manual. WA_TEST_TARGET punya
  // efek sama: pesan dialihkan ke penguji, penanda produksi tetap terbakar.
  // Override `tanggal` itu ALAT UJI ambang. Kalau ia ikut menandai, satu panggilan
  // bertanggal masa depan akan mencatat tier kecil ke batch PRODUKSI dan mematikan
  // alert nyatanya selamanya. Jadi default-nya tidak menandai — harus diminta
  // eksplisit lewat `tandai: true`.
  const bolehTandai = opts.tanggal == null || opts.tandai === true;
  const benarTerkirim = gateway.sent && !gateway.stub && !gateway.dryRun && bolehTandai;
  if (!benarTerkirim) {
    return {
      hari_ini: hariIni, count: due.length, notified: 0, message, gateway,
      // Alasan spesifik, bukan cuma "gagal" — supaya operator tahu apakah ini
      // masalah gateway atau memang mode aman yang sengaja tidak menandai.
      skipped: !gateway.sent
        ? "gateway-gagal"
        : gateway.stub
          ? "stub-tidak-menandai"
          : gateway.dryRun
            ? "dry-run-tidak-menandai"
            : "tanggal-override-tanpa-tandai",
      per_tier: perTier,
    };
  }

  // Catat tier per baris lewat satu UPDATE (jsonb_to_recordset — bukan
  // unnest(...::int[]), postgres.js salah menyimpulkan tipe array angka/boolean).
  const payload = due.map((d) => ({
    item_id: Number(d.item_id),
    warehouse_kode: d.warehouse_kode,
    batch_no: d.batch_no,
    tier: d.tier,
  }));
  await sql`
    UPDATE item_stock_batch sb SET
      alert_tier_terkirim = v.tier,
      alert_terkirim_at = now()
      -- "updated_at" SENGAJA tidak disentuh: kolom itu berarti "kapan ANGKA-nya
      -- terakhir diperbarui" dan dipakai UI/ringkasan menandai data basi.
      -- Mengirim alert bukan perubahan angka — kalau ikut di-set, batch yang
      -- opname-nya 6 bulan lalu tampak segar hanya karena hari ini melintasi
      -- ambang. Waktu penandaan sudah dicatat "alert_terkirim_at".
    FROM jsonb_to_recordset(${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
      AS v(item_id bigint, warehouse_kode text, batch_no text, tier int)
    WHERE sb.item_id = v.item_id
      AND sb.warehouse_kode = v.warehouse_kode
      AND sb.batch_no = v.batch_no
  `;

  return {
    hari_ini: hariIni, count: due.length, notified: due.length,
    message, gateway, per_tier: perTier,
  };
}
