// Parser #REPORT (port legacy/crm skills/wrg-report/SKILL.md): Mode A (single) &
// Mode B (EOD multi, pisah "---"). Fuzzy match ke plan dilakukan terpisah (fuzzy.ts).
export interface ReportItem {
  customer: string;
  hasil: string;
  next_action: string;
}

export interface ReportResult {
  mode: "A" | "B";
  tanggal: string | null;
  items: ReportItem[];
  errors: string[];
}

function parseTgl(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseFields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of block.split(/\r?\n/)) {
    const m = l.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

function toItem(f: Record<string, string>, errors: string[], label: string): ReportItem | null {
  if (!f.cust) {
    errors.push(`${label}: nama customer kosong (cust:)`);
    return null;
  }
  if (!f.hasil) {
    errors.push(`${label}: field hasil kosong`);
    return null;
  }
  return { customer: f.cust, hasil: f.hasil, next_action: f.next ?? "" };
}

export function parseReport(message: string): ReportResult {
  const errors: string[] = [];
  const body = message.replace(/^\s*#report\b[:\s]*/i, "").trim();

  // Mode B: ada separator "---".
  if (/(^|\n)\s*---\s*(\n|$)/.test(body)) {
    const segments = body.split(/\n\s*---\s*\n/);
    // Segmen pertama bisa cuma "tgl: ..." (header). Deteksi tgl di seluruh body.
    const tglMatch = body.match(/tgl\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const tanggal = tglMatch ? parseTgl(tglMatch[1]) : null;

    const items: ReportItem[] = [];
    segments.forEach((seg, i) => {
      const f = parseFields(seg);
      if (!f.cust) return; // header / segmen kosong → skip
      const it = toItem(f, errors, `Customer ${i + 1}`);
      if (it) items.push(it);
    });
    if (items.length === 0) errors.push("Tidak ada customer valid di Mode B");
    return { mode: "B", tanggal, items, errors };
  }

  // Mode A: single.
  const f = parseFields(body);
  const it = toItem(f, errors, "Report");
  return { mode: "A", tanggal: null, items: it ? [it] : [], errors };
}
