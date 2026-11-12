// Daily Summary per HOD + TUA (311) — keputusan product owner 12 Nov 2026: halaman /ds/<token> dikelompokkan per HOD
// (HOD → cabang → orang) dan memuat item TUA (OUTSTANDING > 4 jam dari resume grup WA) per HOD; pesan WA menambah
// satu baris jumlah TUA per HOD. Item TUA = teks AI, dipetakan PIC/grup → cabang → HOD. Fungsi di sini murni.
import type { AreaDs } from "./dailysummary-link.js";

export interface HodPeta { hod_key: string; nama: string; cabang: string[] }
export interface OrangPeta { nama: string; panggilan: string | null; cabang: string | null }
export interface ItemTua {
  topik: string;
  dari: string | null;
  ke: string | null;
  umur: string | null;
  status: string | null;
  cabang: string | null;
  hod_key: string | null;
}
export interface KelompokHod { hod_key: string; nama: string; cabang: string[]; tua: ItemTua[]; areas: AreaDs[] }
export interface PerHod { per_hod: KelompokHod[]; tanpa_hod: { areas: AreaDs[]; tua: ItemTua[] } }

const besar = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Kata/frasa utuh, tak peka huruf besar ("Kediri" cocok di "grup PENJUALAN KEDIRI", tidak di "Kediriku"). */
const memuat = (teks: string, frasa: string) =>
  frasa.trim().length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(frasa.trim())}($|[^\\p{L}\\p{N}])`, "iu").test(teks);

/**
 * Satu baris OUTSTANDING TUA dari resume: "• topik | dari X | ke Y | sejak jam 09:10 (umur 6 jam 5 menit) TUA |
 * status: Z" (template services/ai resume.py). Bagian yang tak ada → null; urutan bagian boleh acak.
 */
export function uraiItemTua(baris: string): Omit<ItemTua, "cabang" | "hod_key"> {
  const bagian = baris.replace(/^\s*[•\-*]\s*/, "").split("|").map((s) => s.trim()).filter(Boolean);
  const ambil = (re: RegExp) => {
    const i = bagian.findIndex((b) => re.test(b));
    return i < 0 ? null : bagian.splice(i, 1)[0];
  };
  const dari = ambil(/^dari\b/i);
  const ke = ambil(/^ke\b/i);
  const umurRaw = ambil(/\bsejak\b|\bumur\b/i);
  const status = ambil(/^status\b/i);
  const umurDlmKurung = umurRaw ? /\(([^)]*umur[^)]*)\)/i.exec(umurRaw)?.[1] : null;
  return {
    topik: (bagian.join(" | ") || baris).replace(/\bTUA\b/g, "").trim(),
    dari: dari ? dari.replace(/^dari\s*/i, "").trim() || null : null,
    ke: ke ? ke.replace(/^ke\s*/i, "").trim() || null : null,
    umur: umurRaw ? (umurDlmKurung ?? umurRaw).replace(/\bTUA\b/g, "").replace(/\s+/g, " ").trim() || null : null,
    status: status ? status.replace(/^status\s*:?\s*/i, "").trim() || null : null,
  };
}

/**
 * Cabang sebuah item TUA. Urutan: (1) PIC di "ke" = nama/panggilan karyawan → cabangnya (nama terpanjang menang);
 * (2) nama cabang di "ke" (mis. grup "PENJUALAN KEDIRI"); (3) nama cabang di topik/"dari". Tak ketemu → null.
 */
export function petakanCabang(item: Omit<ItemTua, "cabang" | "hod_key">, orang: OrangPeta[], cabangSemua: string[]): string | null {
  const ke = item.ke ?? "";
  if (ke) {
    let terbaik: { panjang: number; cabang: string } | null = null;
    for (const o of orang) {
      if (!o.cabang) continue;
      for (const n of [o.nama, o.panggilan]) {
        if (n && memuat(ke, n) && (!terbaik || n.length > terbaik.panjang)) terbaik = { panjang: n.length, cabang: besar(o.cabang) };
      }
    }
    if (terbaik) return terbaik.cabang;
  }
  const urut = [...new Set(cabangSemua.map(besar))].sort((a, b) => b.length - a.length); // "SBY 2" sebelum "SBY"
  for (const teks of [ke, `${item.topik} ${item.dari ?? ""}`]) {
    const c = urut.find((cb) => memuat(teks, cb));
    if (c) return c;
  }
  return null;
}

export function hodUntukCabang(cabang: string | null, hod: HodPeta[]): string | null {
  if (!cabang) return null;
  const c = besar(cabang);
  return hod.find((h) => h.cabang.some((x) => besar(x) === c))?.hod_key ?? null;
}

/** Item TUA mentah (baris resume) → item terpetakan ke cabang & HOD. */
export function petakanTua(baris: string[], orang: OrangPeta[], hod: HodPeta[]): ItemTua[] {
  const cabangSemua = [...hod.flatMap((h) => h.cabang), ...orang.map((o) => o.cabang ?? "").filter(Boolean)];
  return baris.map((b) => {
    const it = uraiItemTua(b);
    const cabang = petakanCabang(it, orang, cabangSemua);
    return { ...it, cabang, hod_key: hodUntukCabang(cabang, hod) };
  });
}

/** Area ringkasan (judul area dari AI = cabang) + item TUA → kelompok per HOD, sisanya "tanpa HOD". */
export function kelompokPerHod(areas: AreaDs[], tua: ItemTua[], hod: HodPeta[]): PerHod {
  const per_hod: KelompokHod[] = hod.map((h) => ({ ...h, tua: [], areas: [] }));
  const tanpa_hod: PerHod["tanpa_hod"] = { areas: [], tua: [] };
  for (const a of areas) {
    const k = hodUntukCabang(a.area, hod);
    (k ? per_hod.find((x) => x.hod_key === k)!.areas : tanpa_hod.areas).push(a);
  }
  for (const t of tua) {
    const g = t.hod_key ? per_hod.find((x) => x.hod_key === t.hod_key) : undefined;
    (g ? g.tua : tanpa_hod.tua).push(t);
  }
  return { per_hod, tanpa_hod };
}

/** Baris WA: "⏳ TUA (resume 14:00): Rocky 2 · Yogi 0 · belum terpetakan 1". null bila tak ada resume hari itu. */
export function barisTuaWa(sumber: string | null, tua: ItemTua[], hod: HodPeta[]): string | null {
  if (!sumber) return null;
  const per = hod.map((h) => `${h.nama} ${tua.filter((t) => t.hod_key === h.hod_key).length}`);
  const belum = tua.filter((t) => !t.hod_key || !hod.some((h) => h.hod_key === t.hod_key)).length;
  return `⏳ TUA (${sumber}): ${[...per, ...(belum ? [`belum terpetakan ${belum}`] : [])].join(" · ") || "tidak ada"}`;
}
