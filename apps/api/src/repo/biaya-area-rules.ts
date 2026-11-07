// F150 (tahap 2) — aturan menandai AREA pada baris biaya Accurate. Logika MURNI (tanpa DB),
// dipakai puller `biaya-area-sync.ts` dan diuji di `biaya-area-rules.test.ts`.
//
// Keputusan Direktur (2026-10-27): area ditentukan (a) aturan di bawah, dan (b) kolom
// Departemen Accurate bila terisi (menang atas aturan). Urutan:
//   0. akun 6100 / 6300 → KANTOR PUSAT (tak dibagi);
//   1. Departemen terisi dan dikenal sebagai area → itu;
//   2. override payee manual (biaya_kamus_payee);
//   3. payee / keterangan "ST <kota>" → area titik layanan;
//   4. payee = karyawan cabang (bukan Pusat) → cabang karyawan PADA TANGGAL transaksi;
//   5. kota di keterangan (kamus area_kota + alias) → area; >1 area berbeda → dibagi rata;
//   6. payee = karyawan Pusat → KANTOR PUSAT; sisanya → KANTOR PUSAT ("tak tertebak").
// Untuk sumber Faktur Pembelian, kota TIDAK dicari di nama vendor ("PT KOTA JAKARTA BARAT").

export const KANTOR_PUSAT = "KANTOR PUSAT";

export type KelompokBiaya = "SDM" | "OPERASIONAL" | "LUAR USAHA";
export type SumberBiaya = "other-payment" | "purchase-invoice" | "journal-voucher";

/** 6100 SDM, 6200 operasional, 6300 luar usaha; selain itu (HPP 5100, pajak 7200, dst) bukan biaya F150. */
export function kelompokAkun(no: string | number | null | undefined): KelompokBiaya | null {
  const s = String(no ?? "");
  if (s.startsWith("6100")) return "SDM";
  if (s.startsWith("6200")) return "OPERASIONAL";
  if (s.startsWith("6300")) return "LUAR USAHA";
  return null;
}

const AREA_NORM: Record<string, string> = { PUSAT: KANTOR_PUSAT, "JAWA TENGAH": "SOLO & YOGYAKARTA" };
export const normArea = (a: unknown): string => {
  const u = String(a ?? "").trim().toUpperCase();
  return AREA_NORM[u] ?? u;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface KataKota {
  kata: string;
  area: string;
}

/** Baris area_kota ("KAB. BADUNG") → kata kunci inti ("BADUNG"); alias tambahan menyusul, tak menimpa. */
export function susunKamusKota(areaKota: { kota: string; cabang: string }[], alias: KataKota[] = []): KataKota[] {
  const peta = new Map<string, string>();
  const tambah = (k: string, area: string) => {
    const kata = k.trim().toUpperCase();
    if (kata.length >= 3 && !peta.has(kata)) peta.set(kata, normArea(area));
  };
  for (const r of areaKota) tambah(r.kota.replace(/^(KAB\.|KOTA)\s+/i, ""), r.cabang);
  for (const a of alias) tambah(a.kata, a.area);
  // Terpanjang dulu: "JAKARTA SELATAN" menang atas "JAKARTA".
  return [...peta].map(([kata, area]) => ({ kata, area })).sort((a, b) => b.kata.length - a.kata.length);
}

interface KotaRe extends KataKota {
  re: RegExp;
}
const kompilKota = (k: KataKota[]): KotaRe[] => k.map((x) => ({ ...x, re: new RegExp(`(^|[^A-Z])${esc(x.kata)}(?=[^A-Z]|$)`, "g") }));

/** Semua kota yang muncul di teks; teks yang sudah cocok ditutup agar "SBY" tak ikut terbaca dari "SBY 2". */
export function cariSemuaKota(teks: string, kamus: KotaRe[]): KataKota[] {
  let t = String(teks ?? "").toUpperCase();
  const ketemu: KataKota[] = [];
  for (const k of kamus) {
    k.re.lastIndex = 0;
    if (k.re.test(t)) {
      ketemu.push({ kata: k.kata, area: k.area });
      k.re.lastIndex = 0;
      t = t.replace(k.re, (m, pre: string) => `${pre}${" ".repeat(m.length - pre.length)}`);
    }
  }
  return ketemu;
}

export interface RiwayatCabang {
  cabang: string;
  berlaku_mulai: string; // YYYY-MM-DD
}
export interface Karyawan {
  nama: string;
  panggilan: string | null;
  cabang: string; // master_user.cabang sekarang
  riwayat?: RiwayatCabang[]; // am_cabang_riwayat
}

/** Cabang efektif pada tanggal T: riwayat terakhir dengan berlaku_mulai <= T, else cabang sekarang (sama dengan migrasi 193). */
export function cabangPadaTanggal(k: Karyawan, tanggal: string): string {
  const r = (k.riwayat ?? []).filter((x) => x.berlaku_mulai <= tanggal).sort((a, b) => (a.berlaku_mulai < b.berlaku_mulai ? 1 : -1))[0];
  return normArea(r ? r.cabang : k.cabang);
}

const BUKAN_ORANG =
  /\b(BANK|MANDIRI|BCA|BNI|BRI|BSI|JATIM|NIAGA|CIMB|PARCEL|EXPRESS|EXPRES|POS|JNE|J&T|TIKI|SICEPAT|PT|CV|TOKO|TK|UD|RS|RSU|RSUD|APOTIK|APOTEK|KLINIK|PLN|PDAM|TELKOM|GOOGLE|PERTAMINA|DINKES|ST)\b/;

/** Kata pertama payee dicocokkan ke panggilan / kata pertama nama. */
export function susunKamusOrang(karyawan: Karyawan[]): Map<string, Karyawan[]> {
  const m = new Map<string, Karyawan[]>();
  for (const k of karyawan) {
    for (const kata of [k.panggilan, String(k.nama ?? "").split(/\s+/)[0]]) {
      const u = String(kata ?? "").trim().toUpperCase();
      if (u.length < 3) continue;
      const arr = m.get(u) ?? [];
      if (!arr.includes(k)) arr.push(k);
      m.set(u, arr);
    }
  }
  return m;
}

export type CocokOrang = { status: "OK"; cabang: string; nama: string } | { status: "AMBIGU"; cabang: string[]; nama: string[] };

export function cariOrang(payee: string, tanggal: string, orang: Map<string, Karyawan[]>): CocokOrang | null {
  const p = String(payee ?? "").toUpperCase().trim();
  if (!p || BUKAN_ORANG.test(p)) return null;
  const cocok = orang.get(p.split(/[\s(,.]+/)[0]);
  if (!cocok?.length) return null;
  const cab = new Set(cocok.map((k) => cabangPadaTanggal(k, tanggal)));
  if (cab.size > 1) return { status: "AMBIGU", cabang: [...cab], nama: cocok.map((k) => k.nama) };
  return { status: "OK", cabang: [...cab][0], nama: cocok[0].nama };
}

export interface KonteksArea {
  kota: KotaRe[];
  orang: Map<string, Karyawan[]>;
  /** Nama area yang sah (dari area_kota + KANTOR PUSAT); Departemen di luar daftar diabaikan. */
  areaSah: Set<string>;
  /** override payee manual: PAYEE UPPERCASE → area */
  payeeManual: Map<string, string>;
}

export function buatKonteks(opts: {
  areaKota: { kota: string; cabang: string }[];
  alias?: KataKota[];
  karyawan: Karyawan[];
  payeeManual?: { payee: string; area: string }[];
}): KonteksArea {
  const kamus = susunKamusKota(opts.areaKota, opts.alias);
  const areaSah = new Set<string>([KANTOR_PUSAT, ...kamus.map((k) => k.area)]);
  return {
    kota: kompilKota(kamus),
    orang: susunKamusOrang(opts.karyawan),
    areaSah,
    payeeManual: new Map((opts.payeeManual ?? []).map((p) => [p.payee.trim().toUpperCase(), normArea(p.area)])),
  };
}

export interface InputBiaya {
  sumber: SumberBiaya;
  tanggal: string; // YYYY-MM-DD
  akun: string;
  keterangan: string;
  payee: string;
  memo?: string;
  departemen?: string | null;
}

export interface HasilArea {
  /** Area utama; "MULTI" bila dibagi (lihat `bagi`). */
  area: string;
  dasar: string;
  /** Area yang dibagi rata (>1) — null bila satu area. */
  bagi: string[] | null;
  /** true bila area ditebak (bukan Departemen / manual / aturan akun) — dipakai untuk % tertandai. */
  tertandai: boolean;
}

const pusat = (dasar: string): HasilArea => ({ area: KANTOR_PUSAT, dasar, bagi: null, tertandai: false });

export function tebakArea(b: InputBiaya, ctx: KonteksArea): HasilArea {
  const kel = kelompokAkun(b.akun);
  if (kel === "SDM" || kel === "LUAR USAHA") return pusat(`akun ${kel} → Kantor Pusat`);

  const dep = normArea(b.departemen);
  if (dep && ctx.areaSah.has(dep)) return { area: dep, dasar: "departemen Accurate", bagi: null, tertandai: dep !== KANTOR_PUSAT };

  const payee = String(b.payee ?? "").trim();
  const manual = ctx.payeeManual.get(payee.toUpperCase());
  if (manual) return { area: manual, dasar: "payee manual", bagi: null, tertandai: manual !== KANTOR_PUSAT };

  const st = payee.toUpperCase().match(/^ST\s+([A-Z][A-Z &]+)/) ?? String(b.keterangan ?? "").toUpperCase().match(/\bST\s+([A-Z]{3,})/);
  if (st) {
    const k = cariSemuaKota(st[1], ctx.kota)[0];
    if (k) return { area: k.area, dasar: `titik layanan ST ${k.kata}`, bagi: null, tertandai: k.area !== KANTOR_PUSAT };
  }

  const org = cariOrang(payee, b.tanggal, ctx.orang);
  if (org?.status === "OK" && org.cabang !== KANTOR_PUSAT) return { area: org.cabang, dasar: "payee = karyawan cabang", bagi: null, tertandai: true };

  // Faktur pembelian: payee = nama vendor → bukan sumber kota.
  const teksKota = b.sumber === "purchase-invoice" ? `${b.keterangan ?? ""} ${b.memo ?? ""}` : `${b.keterangan ?? ""} ${b.memo ?? ""} ${payee}`;
  const kota = cariSemuaKota(teksKota, ctx.kota);
  const areas = [...new Set(kota.map((k) => k.area))];
  if (areas.length === 1) return { area: areas[0], dasar: `kota di keterangan (${kota[0].kata})`, bagi: null, tertandai: areas[0] !== KANTOR_PUSAT };
  if (areas.length > 1) return { area: "MULTI", dasar: `multi-area (${kota.map((k) => k.kata).join(", ")})`, bagi: areas, tertandai: true };

  if (org?.status === "OK") return pusat("payee = karyawan Pusat");
  return pusat("tak tertebak");
}

/** Pecah jumlah ke area: satu area → utuh; multi → rata (sisa pembulatan ke area terakhir). */
export function alokasiJumlah(jumlah: number, h: HasilArea): { area: string; jumlah: number }[] {
  if (!h.bagi || h.bagi.length < 2) return [{ area: h.area, jumlah }];
  const per = Math.floor(jumlah / h.bagi.length);
  return h.bagi.map((area, i) => ({ area, jumlah: i === h.bagi!.length - 1 ? jumlah - per * (h.bagi!.length - 1) : per }));
}
