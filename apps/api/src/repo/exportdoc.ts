import { db } from "../db.js";

// Export dokumen → HTML siap-print (port legacy export_pdf, tanpa lib PDF).
// Render sales_doc (A6) & digest_briefing (A10) dengan CSS print + tombol print.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, metaLines: string[], body: string): string {
  const meta = metaLines.map((m) => `<div class="meta">${esc(m)}</div>`).join("");
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { margin: 18mm; }
  body { font: 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; color:#111; max-width:800px; margin:24px auto; padding:0 16px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .meta { color:#666; font-size:12px; }
  .doc { white-space:pre-wrap; border:1px solid #ddd; border-radius:8px; padding:16px; margin-top:16px; background:#fafafa; }
  .print { margin-top:16px; }
  button { font:inherit; padding:8px 14px; border:1px solid #888; border-radius:6px; background:#fff; cursor:pointer; }
  @media print { .print { display:none } body{margin:0} .doc{border:none;background:none;padding:0} }
</style></head><body>
<h1>${esc(title)}</h1>${meta}
<div class="doc">${esc(body)}</div>
<div class="print"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
</body></html>`;
}

export async function renderSalesDocHtml(id: string): Promise<string | null> {
  const sql = db();
  const [r] = await sql`SELECT title, doc_type, customer_name, draft_text, status, created_at::text FROM sales_doc WHERE id = ${id}`;
  if (!r) return null;
  return page(
    String(r.title ?? r.doc_type ?? "Dokumen Penjualan"),
    [
      `Pelanggan: ${r.customer_name ?? "-"}`,
      `Tipe: ${r.doc_type ?? "-"} · Status: ${r.status} · ${String(r.created_at).slice(0, 10)}`,
    ],
    String(r.draft_text ?? ""),
  );
}

export async function renderBriefingHtml(id: string): Promise<string | null> {
  const sql = db();
  const [r] = await sql`SELECT week_start::text, raw_output, model_used, hitl_status, created_at::text FROM digest_briefing WHERE id = ${id}`;
  if (!r) return null;
  return page(
    `Briefing Eksekutif — Minggu ${r.week_start}`,
    [`Status: ${r.hitl_status} · Model: ${r.model_used ?? "-"} · ${String(r.created_at).slice(0, 10)}`],
    String(r.raw_output ?? ""),
  );
}
