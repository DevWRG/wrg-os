import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { recordCompetitor } from "./competitor.js";

// extract_competitor — port wrg-crm/scripts/extract_competitor.sh.
// Ambil baris activity_log.hasil yang belum di-ekstrak → services/ai
// /extract-competitor (LLM) → recordCompetitor() per sebutan → tandai di
// competitor_extraction_state (idempoten). TANPA kirim WA (pure data → DB).

interface Mention {
  vendor?: string | null;
  produk?: string | null;
  produk_kategori?: string | null;
  harga_text?: string | null;
  harga_numeric?: number | null;
  konteks?: string | null;
}

export interface ExtractCompetitorResult {
  processed: number; total_mentions: number; skipped: number;
}

export async function runExtractCompetitor(
  opts: { dryRun?: boolean; limit?: number; backfillDays?: number } = {},
): Promise<ExtractCompetitorResult> {
  const sql = db();
  const limit = opts.limit ?? 20; // batasi per-run untuk hindari lonjakan biaya API
  const res: ExtractCompetitorResult = { processed: 0, total_mentions: 0, skipped: 0 };

  // Kandidat: hasil cukup panjang & belum di-state. backfill → batasi N hari.
  const rows = opts.backfillDays
    ? await sql`
        SELECT al.id, al.am_id, al.customer_name, al.tanggal::text AS tanggal, al.hasil
        FROM activity_log al
        LEFT JOIN competitor_extraction_state ces ON ces.activity_id = al.id
        WHERE al.tanggal >= CURRENT_DATE - (${opts.backfillDays} || ' days')::interval
          AND al.hasil IS NOT NULL AND length(al.hasil) > 30 AND ces.activity_id IS NULL
        ORDER BY al.id DESC LIMIT ${limit}
      `
    : await sql`
        SELECT al.id, al.am_id, al.customer_name, al.tanggal::text AS tanggal, al.hasil
        FROM activity_log al
        LEFT JOIN competitor_extraction_state ces ON ces.activity_id = al.id
        WHERE al.hasil IS NOT NULL AND length(al.hasil) > 30 AND ces.activity_id IS NULL
        ORDER BY al.id DESC LIMIT ${limit}
      `;

  for (const r of rows) {
    const activityId = Number(r.id);
    const { status, data } = await callAi("/extract-competitor", {
      customer: r.customer_name ? String(r.customer_name) : "",
      tanggal: String(r.tanggal),
      hasil: String(r.hasil),
      dry_run: aiDryRun(),
    });
    if (status !== 200) { res.skipped += 1; continue; } // jangan tandai — coba lagi nanti

    const mentions = (Array.isArray(data.mentions) ? data.mentions : []) as Mention[];
    let n = 0;
    if (!opts.dryRun) {
      for (const m of mentions) {
        const vendor = (m.vendor ?? "").trim();
        const produk = (m.produk ?? "").trim();
        if (!vendor && !produk) continue;
        await recordCompetitor({
          am_id: r.am_id ? String(r.am_id) : undefined,
          customer_name: r.customer_name ? String(r.customer_name) : undefined,
          tanggal: String(r.tanggal),
          vendor: vendor || produk, // vendor wajib di recordCompetitor; fallback ke produk
          produk: produk || undefined,
          produk_kategori: m.produk_kategori ?? undefined,
          harga_text: m.harga_text ?? undefined,
          harga_numeric: m.harga_numeric ?? undefined,
          konteks: m.konteks ?? undefined,
          source: "extract",
        });
        n += 1;
      }
      const model = String(data.model ?? "");
      await sql`
        INSERT INTO competitor_extraction_state (activity_id, n_mentions, extraction_model)
        VALUES (${activityId}, ${n}, ${model})
        ON CONFLICT (activity_id) DO UPDATE SET
          extracted_at = now(), n_mentions = EXCLUDED.n_mentions, extraction_model = EXCLUDED.extraction_model
      `;
    } else {
      n = mentions.filter((m) => (m.vendor ?? "").trim() || (m.produk ?? "").trim()).length;
    }
    res.processed += 1;
    res.total_mentions += n;
  }
  return res;
}
