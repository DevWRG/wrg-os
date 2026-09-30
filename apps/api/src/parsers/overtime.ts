// Parser hashtag WA #OVERTIME — pengajuan lembur SEBELUM lembur. Format bebas
// tapi durasi wajib di depan, uraian sesudahnya:
//   #overtime 2 jam 30 menit - closing laporan bulanan
//   #overtime 90 menit: susun stok opname
//   #overtime 1,5 jam untuk input faktur
//   #overtime 2jam kirim barang ke gudang
// Pure function (tanpa DB).

export interface ParsedOvertime {
  menit: number;
  uraian: string;
}

export type OvertimeParseResult = ParsedOvertime | { error: string };

const MAKS_MENIT = 12 * 60; // 12 jam — di atas ini hampir pasti salah ketik

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const JAM = String.raw`(?:jam|j)`;
const MNT = String.raw`(?:menit|mnt|min|m)`;

function angka(s: string): number {
  return Number(s.replace(",", "."));
}

export function parseOvertimeArg(arg: string): OvertimeParseResult {
  const text = arg.trim();
  if (!text) return { error: "kosong" };

  // "2 jam 30 menit" | "2 jam" | "90 menit" | "1,5 jam". Diikat ke AWAL teks
  // supaya angka di dalam uraian ("input 20 faktur") tak dibaca sebagai durasi.
  const re = new RegExp(String.raw`^(?:(${NUM})\s*${JAM}\b)?\s*(?:(${NUM})\s*${MNT}\b)?`, "i");
  const m = text.match(re);
  const jamStr = m?.[1];
  const mntStr = m?.[2];
  if (!m || (!jamStr && !mntStr)) return { error: "durasi-tidak-terbaca" };

  const menit = Math.round((jamStr ? angka(jamStr) * 60 : 0) + (mntStr ? angka(mntStr) : 0));
  if (menit <= 0) return { error: "durasi-nol" };
  if (menit > MAKS_MENIT) return { error: "durasi-terlalu-panjang" };

  const uraian = text
    .slice(m[0].length)
    .replace(/^[\s\-–—:,.;]+/, "")
    .replace(/^(?:untuk|buat|utk)\s+/i, "")
    .trim();
  if (!uraian) return { error: "uraian-kosong" };

  return { menit, uraian };
}

export function formatDurasi(menit: number): string {
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  if (j && m) return `${j} jam ${m} menit`;
  if (j) return `${j} jam`;
  return `${m} menit`;
}
