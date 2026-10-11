// Parser hashtag WA #SPH (F15) — shortcut 1-item, dipisah `|`. Format:
//   #SPH <customer> | <kode> | <qty> | <diskon%>
// Multi-item / cari-by-nama TIDAK didukung di jalur ini (pakai form web
// /sph/new) — kode WAJIB (bukan nama) supaya tak kena masalah 22-nama-kembar
// (HANDOVER §6) sama sekali di jalur WA. Pure function (tanpa DB).

const SPH_PREFIX = /^\s*#\s*sph\b/i;
const QTY_MAKS = 100_000;

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

  // Digit polos saja. Number() menerima "1e9" (1 miliar) dan "0x10" (=16), dan
  // qty raksasa meledak "numeric field overflow" saat INSERT → AM tak dibalas
  // apa pun (uji dev 12 Okt 2026). Batas atas jauh di atas order wajar.
  const qty = /^\d{1,6}$/.test(qtyRaw) ? Number(qtyRaw) : NaN;
  if (!(qty >= 1 && qty <= QTY_MAKS)) {
    return { error: `qty "${qtyRaw}" harus bilangan bulat 1–${QTY_MAKS.toLocaleString("id-ID")}` };
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
