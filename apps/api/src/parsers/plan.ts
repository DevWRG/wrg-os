// Parser #PLAN (port legacy/crm skills/wrg-plan/SKILL.md): single & multi mode,
// normalisasi tujuan, deteksi late. Pure function — tanpa DB.
import { normalizeTujuan } from "./tujuan.js";

export interface PlanCustomer {
  customer: string;
  tujuan: string;
  goal: string;
}

export interface PlanResult {
  mode: "single" | "multi";
  tanggal: string | null; // ISO YYYY-MM-DD; null → caller pakai CURRENT_DATE
  is_late: boolean | null; // null kalau `now` tidak diberikan
  customers: PlanCustomer[];
  errors: string[];
}

export interface PlanOptions {
  now?: string; // ISO/wall-clock WIB, mis. "2026-05-21T08:15"
  deadline?: string; // "HH:MM", default 08:00 (lapangan); 08:30 non-lapangan
}

function parseTgl(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function computeLate(
  tanggal: string | null,
  now?: string,
  deadline = "08:00",
): boolean | null {
  if (!now || !tanggal) return null;
  const m = now.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  if (m[1] !== tanggal) return false; // late hanya kalau plan utk hari ini
  const cur = Number(m[2]) * 60 + Number(m[3]);
  const [dh, dm] = deadline.split(":");
  return cur > Number(dh) * 60 + Number(dm);
}

function stripHashtag(line: string): string {
  return line.replace(/^\s*#(plan)\b[:\s]*/i, "").trim();
}

function parseFields(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const m = l.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export function parsePlan(message: string, opts: PlanOptions = {}): PlanResult {
  const errors: string[] = [];
  const rawLines = message.split(/\r?\n/);
  // Buang baris hashtag (#PLAN) dari baris pertama yang memuatnya.
  const lines = rawLines.map((l, i) => (i === 0 ? stripHashtag(l) : l));

  // Tanggal dari field "tgl:".
  const tglLine = lines.find((l) => /^\s*tgl\s*:/i.test(l));
  const tanggal = tglLine ? parseTgl(tglLine.split(":").slice(1).join(":")) : null;
  if (tglLine && !tanggal) errors.push("Format tanggal salah (pakai tgl: DD/MM/YYYY)");

  const is_late = computeLate(tanggal, opts.now, opts.deadline ?? "08:00");

  // Multi mode: ada baris "X | Y | Z" (selain count marker "N|").
  const pipeLines = lines.filter(
    (l) => l.includes("|") && !/^\s*\d+\s*\|?\s*$/.test(l),
  );

  if (pipeLines.length > 0) {
    const customers: PlanCustomer[] = [];
    pipeLines.forEach((l, idx) => {
      const parts = l.split("|").map((p) => p.trim());
      if (!parts[0]) {
        errors.push(`Baris ${idx + 1}: nama customer kosong`);
        return;
      }
      customers.push({
        customer: parts[0],
        tujuan: normalizeTujuan(parts[1] ?? ""),
        goal: parts[2] ?? "",
      });
    });
    return { mode: "multi", tanggal, is_late, customers, errors };
  }

  // Single mode: field cust/tujuan/goal.
  const f = parseFields(lines);
  if (!f.cust) {
    errors.push("Nama customer tidak boleh kosong (cust:)");
    return { mode: "single", tanggal, is_late, customers: [], errors };
  }
  return {
    mode: "single",
    tanggal,
    is_late,
    customers: [
      { customer: f.cust, tujuan: normalizeTujuan(f.tujuan ?? ""), goal: f.goal ?? "" },
    ],
    errors,
  };
}
