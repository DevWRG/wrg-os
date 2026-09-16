// Parser hashtag WA #SPH (F15) — shortcut 1-item, dipisah `|`. Format:
//   #SPH <customer> | <kode> | <qty> | <diskon%>
// Multi-item / cari-by-nama TIDAK didukung di jalur ini (pakai form web
// /sph/new) — kode WAJIB (bukan nama) supaya tak kena masalah 22-nama-kembar
// (HANDOVER §6) sama sekali di jalur WA. Pure function (tanpa DB).

const SPH_PREFIX = /^\s*#\s*sph\b/i;

export interface ParsedSphMessage {
  customerName: string;
  kode: string;
  qty: number;
  diskonRequested: number; // fraksi, mis. 0.10
}

export type ParseSphResult = ParsedSphMessage | { error: string };

export function parseSphMessage(line: string): ParseSphResult | null {
  const rest = line.replace(SPH_PREFIX, "").trim();
  if (!rest) return null;

  const parts = rest.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length !== 4) {
    return { error: `format harus "Customer | Kode | Qty | Diskon%" (4 bagian dipisah "|", dapat ${parts.length})` };
  }
  const [customerName, kode, qtyRaw, diskonRaw] = parts;

  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: `qty "${qtyRaw}" harus angka > 0` };
  }

  // Diskon WAJIB pakai tanda % — angka polos ("10") ambigu (10% atau 0.10 =
  // 1000%?), jangan ditebak (pelajaran lama repo ini soal locale angka CSV).
  const m = diskonRaw.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (!m) {
    return { error: `diskon "${diskonRaw}" wajib pakai tanda %, mis. "10%"` };
  }
  const diskonRequested = Number(m[1].replace(",", ".")) / 100;

  return { customerName, kode, qty, diskonRequested };
}
