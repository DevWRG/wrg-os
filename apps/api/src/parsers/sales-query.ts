// Parser perintah WA `#SALES <period> <scope>` → periode (from/to) + scope view.
// MVP: period {hari_ini|kemarin|minggu_ini|bulan_ini|tahun_ini}, scope
// {overview(default)|per_cabang|per_am}. Robust ke variasi spasi/underscore.

export type SalesQueryScope = "overview" | "per_cabang" | "per_am";

export interface SalesQuery {
  from?: string; // undefined → analytics pakai default YTD
  to?: string;
  scope: SalesQueryScope;
  periodLabel: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

// Normalisasi: lowercase, ganti spasi ganda, samakan separator.
function norm(body: string): string {
  return body.replace(/[#]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function periodRange(text: string): { from?: string; to?: string; label: string } {
  const now = new Date();
  const today = iso(now);
  if (/\b(hari[_ ]?ini|today)\b/.test(text)) return { from: today, to: today, label: "Hari ini" };
  if (/\b(kemarin|yesterday)\b/.test(text)) {
    const y = iso(new Date(now.getTime() - 86_400_000));
    return { from: y, to: y, label: "Kemarin" };
  }
  if (/\b(minggu[_ ]?ini|this[_ ]?week)\b/.test(text)) {
    const dow = (now.getUTCDay() + 6) % 7; // Senin=0
    return { from: iso(new Date(now.getTime() - dow * 86_400_000)), to: today, label: "Minggu ini" };
  }
  if (/\b(bulan[_ ]?ini|this[_ ]?month)\b/.test(text)) {
    return { from: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`, to: today, label: "Bulan ini" };
  }
  if (/\b(tahun[_ ]?ini|this[_ ]?year|ytd)\b/.test(text)) {
    return { from: `${now.getUTCFullYear()}-01-01`, to: today, label: "Tahun ini (YTD)" };
  }
  return { label: "Year-to-date" }; // default
}

export function parseSalesQuery(body: string): SalesQuery {
  const t = norm(body);
  const p = periodRange(t);
  let scope: SalesQueryScope = "overview";
  if (/\bper[_ ]?cabang\b/.test(t)) scope = "per_cabang";
  else if (/\bper[_ ]?am\b/.test(t)) scope = "per_am";
  return { from: p.from, to: p.to, scope, periodLabel: p.label };
}
