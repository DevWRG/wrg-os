// F172 Bottom Line Alat KSO — tab di Komite KSO (migrasi 256 + 263).
//
// Model hitung = Pedoman Komite KSO Forum v01 (27 Okt 2026): satu ukuran, GPM deal.
//
//   GPM = 1 − (reagen/tes + (reagen tetap + QC per bulan)/volume + HPP/(tenor × volume)) ÷ harga/tes
//
// Zona kewenangan: ≥ 55% AM · 50–55% dua HOD · 45–50% Forum → Direktur · < 45% Direktur.
// Tiga angka turunan yang dipakai forum: volume minimum (di harga ini), harga minimum (di volume
// ini), HPP alat maksimal (bahan negosiasi ke prinsipal). Bottom standar = harga minimum di batas
// zona Forum (45%) dengan HPP penuh. Real bottom (promo / dukungan prinsipal / QC gratis) HANYA
// lewat bacaReal() — tak pernah ikut respons halaman biasa. Hemodialisa tidak memakai zona.
//
// Izin (Akses Grup) — tiga fitur:
//   kso-komite-bottomline        lihat = Forum/HOD/Finance · ubah = Direktur (keputusan, parameter)
//   kso-komite-bottomline-angka  ubah = Finance (HPP standar, biaya reagen, QC, harga pasar, acuan jenis)
//   kso-komite-bottomline-real   lihat = Direktur (angka real bottom) · ubah = catat promo/dukungan
// Gate lama sebelum fitur diatur: role direktur (semua). Role admin TIDAK otomatis lolos.

import { db } from "../db.js";
import { effectivePermissions, type Action, type Effective } from "./rbac.js";
import { GalatKso, bacaPengguna, type PenggunaKso } from "./kso-komite.js";

export const FITUR_BOTTOMLINE = "kso-komite-bottomline";
export const FITUR_ANGKA = "kso-komite-bottomline-angka";
export const FITUR_REAL = "kso-komite-bottomline-real";
export const KEPUTUSAN = ["Setuju", "Ubah", "Tahan penempatan baru", "Tarik / relokasi", "Diskusikan"] as const;

export interface IzinBottomLine { lihat: boolean; putus: boolean; angka: boolean; realLihat: boolean; realCatat: boolean }

export function izinBottomLine(u: PenggunaKso, eff: Effective): IzinBottomLine {
  const lama = u.role === "direktur" && eff.groups.length > 0;
  const boleh = (f: string, a: Action) => {
    if (eff.superuser) return true;
    const p = eff.permissions[f];
    if (p) return p.active && (a === "view" ? p.view : a === "edit" ? p.edit : a === "create" ? p.create : p.delete);
    return lama;
  };
  const angka = boleh(FITUR_ANGKA, "edit");
  const realLihat = boleh(FITUR_REAL, "view");
  const realCatat = boleh(FITUR_REAL, "edit");
  return {
    lihat: boleh(FITUR_BOTTOMLINE, "view") || angka || realLihat || realCatat,
    putus: boleh(FITUR_BOTTOMLINE, "edit"),
    angka, realLihat, realCatat,
  };
}

// ---------------------------------------------------------------- rumus (murni, diuji)

/** Angka biaya satu model. `hpp` null = belum tercatat (cicilan tak terhitung). */
export interface Angka { reagen: number | null; tetap: number; qc: number; hpp: number | null }
export interface Zona { am: number; hod: number; forum: number }
export type KodeZona = "am" | "hod" | "forum" | "direktur";

/** Biaya per tes di volume v tanpa cicilan alat: reagen + (reagen tetap + QC) ÷ v. */
export function biayaTes(a: Angka, v: number | null): number | null {
  if (a.reagen == null || !v || v <= 0) return null;
  return a.reagen + (a.tetap + a.qc) / v;
}

/** Cicilan alat per tes: HPP ÷ (tenor × v). */
export function cicilanTes(a: Angka, v: number | null, tenor: number): number | null {
  if (a.hpp == null || !v || v <= 0) return null;
  return a.hpp / (tenor * v);
}

/** GPM deal di harga & volume ini. HPP belum tercatat → null (jangan pura-pura alat gratis). */
export function gpm(a: Angka, harga: number | null, v: number | null, tenor: number): number | null {
  const b = biayaTes(a, v), c = cicilanTes(a, v, tenor);
  if (b == null || c == null || !harga || harga <= 0) return null;
  return 1 - (b + c) / harga;
}

/** Harga minimum per tes agar GPM ≥ g di volume v. */
export function hargaMin(a: Angka, v: number | null, g: number, tenor: number): number | null {
  const b = biayaTes(a, v), c = cicilanTes(a, v, tenor);
  if (b == null || c == null) return null;
  return (b + c) / (1 - g);
}

/** Volume minimum per bulan agar GPM ≥ g di harga ini. null = tidak tercapai di volume berapa pun. */
export function volumeMin(a: Angka, harga: number | null, g: number, tenor: number): number | null {
  if (a.reagen == null || a.hpp == null || !harga || harga <= 0) return null;
  const sisa = harga * (1 - g) - a.reagen;
  if (sisa <= 0) return null;
  return (a.tetap + a.qc + a.hpp / tenor) / sisa;
}

/** HPP alat tertinggi agar GPM ≥ g di harga & volume ini (bahan negosiasi ke prinsipal). ≤ 0 → 0. */
export function hppMaks(a: Angka, harga: number | null, v: number | null, g: number, tenor: number): number | null {
  const b = biayaTes(a, v);
  if (b == null || !harga || harga <= 0) return null;
  return Math.max(0, (harga * (1 - g) - b) * tenor * v!);
}

export function zona(g: number | null, z: Zona): KodeZona | null {
  if (g == null) return null;
  return g >= z.am ? "am" : g >= z.hod ? "hod" : g >= z.forum ? "forum" : "direktur";
}

export interface Dukungan { jenis_dukungan: "promo" | "prinsipal" | "qc_gratis"; beli_x: number | null; gratis_y: number | null }
/** Angka real bottom: promo beli X gratis Y → HPP × X/(X+Y) (ambil yang paling murah); prinsipal → HPP 0; QC gratis → QC 0. */
export function angkaReal(a: Angka, dukungan: Dukungan[]): Angka {
  let hpp = a.hpp, qc = a.qc;
  for (const d of dukungan) {
    if (d.jenis_dukungan === "prinsipal") hpp = 0;
    else if (d.jenis_dukungan === "qc_gratis") qc = 0;
    else if (d.jenis_dukungan === "promo" && hpp != null && d.beli_x && d.gratis_y)
      hpp = Math.min(hpp, (a.hpp ?? 0) * (d.beli_x / (d.beli_x + d.gratis_y)));
  }
  return { ...a, hpp, qc };
}

/** Titik volume peta GPM & sensitivitas. */
export function gridVolume(kelompok: string, satuan: string): number[] {
  if (satuan === "tindakan") return [12, 24, 36, 48, 60, 72];
  if (["Hematologi", "Kimia Klinik", "Urinalisa"].includes(kelompok)) return [100, 250, 500, 750, 1000, 1500, 2000, 3000];
  return [10, 25, 50, 100, 200, 300, 500];
}

/** Titik harga peta GPM: rentang harga pasar ±20%, atau realisasi ±40% bila harga pasar belum diisi. */
export function gridHarga(pasarMin: number | null, pasarMax: number | null, realisasi: number | null): number[] {
  const lo = pasarMin ? pasarMin * 0.8 : realisasi ? realisasi * 0.6 : null;
  const hi = pasarMax ? pasarMax * 1.2 : pasarMin ? pasarMin * 1.4 : realisasi ? realisasi * 1.4 : null;
  if (lo == null || hi == null) return [];
  const langkah = (hi - lo) / 6;
  const bulat = (x: number) => { const p = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1); return Math.round(x / p) * p; };
  return [...new Set(Array.from({ length: 7 }, (_, i) => bulat(lo + langkah * i)))];
}

// ---------------------------------------------------------------- baca

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function izin(userId: string) {
  const u = await bacaPengguna(userId);
  if (!u) throw new GalatKso(401, "Sesi tidak dikenal.");
  const i = izinBottomLine(u, await effectivePermissions(userId));
  if (!i.lihat) throw new GalatKso(403, "Tidak punya akses ke Bottom Line Alat.");
  return { u, ...i };
}

/** Izin tab ini — dipakai halaman untuk menampilkan tab (API tetap menentukan tiap permintaan). */
export async function aksesBottomLine(userId: string): Promise<IzinBottomLine> {
  const u = await bacaPengguna(userId);
  if (!u) return { lihat: false, putus: false, angka: false, realLihat: false, realCatat: false };
  return izinBottomLine(u, await effectivePermissions(userId));
}

interface Param { tenor: number; zona: Zona }
async function bacaParam(): Promise<Param & { diubah_at: string | null }> {
  const [p] = await db()`SELECT bulan, gpm_am, gpm_hod, gpm_forum, diubah_at::text AS diubah_at FROM kso_bottomline_parameter WHERE id = 1`;
  return {
    tenor: Number(p?.bulan ?? 36),
    zona: { am: Number(p?.gpm_am ?? 0.55), hod: Number(p?.gpm_hod ?? 0.5), forum: Number(p?.gpm_forum ?? 0.45) },
    diubah_at: (p?.diubah_at as string) ?? null,
  };
}

const angkaDari = (m: Record<string, unknown>): Angka => ({
  reagen: n(m.biaya_per_tes), tetap: n(m.biaya_tetap_bulan) ?? 0, qc: n(m.qc_bulan) ?? 0, hpp: n(m.hpp),
});

/** Harga acuan zona = harga pasar terendah (konservatif); kalau belum diisi, realisasi Rp/tes OS. */
const hargaAcuan = (m: Record<string, unknown>) => n(m.harga_pasar_min) ?? n(m.rupiah_per_tes);

/** Angka turunan satu model di harga & volume acuan — dipakai baris standar maupun real. */
function turunan(a: Angka, harga: number | null, vol: number | null, p: Param, hd: boolean) {
  if (hd) return { gpm: null, zona: null, volume_min: null, harga_min: null, hpp_maks: null, bottom: null };
  const g = gpm(a, harga, vol, p.tenor);
  return {
    gpm: g, zona: zona(g, p.zona),
    volume_min: { am: volumeMin(a, harga, p.zona.am, p.tenor), hod: volumeMin(a, harga, p.zona.hod, p.tenor), forum: volumeMin(a, harga, p.zona.forum, p.tenor) },
    harga_min: { am: hargaMin(a, vol, p.zona.am, p.tenor), hod: hargaMin(a, vol, p.zona.hod, p.tenor), forum: hargaMin(a, vol, p.zona.forum, p.tenor) },
    hpp_maks: hppMaks(a, harga, vol, p.zona.forum, p.tenor),
    bottom: hargaMin(a, vol, p.zona.forum, p.tenor),
  };
}

export async function bacaBottomLine(userId: string) {
  const iz = await izin(userId);
  const sql = db();
  const p = await bacaParam();
  const [models, kep, units, jenis] = await Promise.all([
    sql`SELECT * FROM kso_bottomline_model_v ORDER BY kelompok, unit DESC, model`,
    sql`SELECT k.*, k.diputus_at::text AS diputus_at, u.name AS diputus_nama
          FROM kso_bottomline_keputusan k LEFT JOIN app_user u ON u.id::text = k.diputus_oleh`,
    sql`SELECT model_key, faskes, skema, bulan_aktif, omzet_12, hpp_sn, account_id IS NULL AS tanpa_faskes
          FROM kso_bottomline_unit_v ORDER BY model_key, omzet_12 DESC NULLS LAST`,
    sql`SELECT jenis, kelompok, satuan, rupiah_per_tes_manual, margin_kotor FROM kso_bottomline_jenis ORDER BY kelompok, jenis`,
  ]);
  const kepMap = new Map(kep.map((r) => [String(r.model_key), r]));
  const unitMap = new Map<string, unknown[]>();
  for (const r of units) {
    const key = String(r.model_key);
    const omzet = n(r.omzet_12);
    const bln = Number(r.bulan_aktif);
    const status = r.tanpa_faskes ? "Tanpa faskes" : !omzet || omzet <= 0 ? "Idle" : "Jalan";
    (unitMap.get(key) ?? unitMap.set(key, []).get(key)!).push({
      faskes: r.faskes, skema: r.skema, status, bulan_aktif: bln,
      omzet_bln: omzet && omzet > 0 ? Math.round(omzet / bln) : 0, hpp_sn: n(r.hpp_sn),
    });
  }
  const baris = models.map((m) => {
    const key = String(m.model_key);
    const d = kepMap.get(key);
    const a = angkaDari(m);
    const hd = m.satuan === "tindakan";
    const rpt = n(m.rupiah_per_tes), volHist = n(m.volume);
    const volAcuan = n(d?.volume) ?? volHist;
    const harga = hargaAcuan(m);
    const t = turunan(a, harga, volAcuan, p, hd);
    // GPM realisasi = di Rp/tes & volume historis OS (apa yang sedang terjadi), bukan harga pasar
    const gReal = hd ? null : gpm(a, rpt, volHist, p.tenor);
    return {
      model_key: key, kelompok: m.kelompok, jenis: m.jenis, model: m.model, satuan: m.satuan, hd,
      unit: Number(m.unit), idle: Number(m.idle), tanpa_faskes: Number(m.tanpa_faskes),
      omzet_12: n(m.omzet_12), omzet_unit_bln: n(m.omzet_unit_bln),
      hpp: a.hpp, hpp_aset: n(m.hpp_aset), hpp_tgl: m.hpp_tgl ? String(m.hpp_tgl).slice(0, 10) : null, hpp_median: n(m.hpp_median),
      hpp_sumber: m.hpp_sumber, unit_ber_hpp: Number(m.unit_ber_hpp),
      rupiah_per_tes: rpt, rupiah_per_tes_sumber: m.rupiah_per_tes_sumber, volume: volHist, volume_acuan: volAcuan,
      biaya_per_tes: a.reagen, biaya_tetap_bulan: a.tetap, qc_bulan: a.qc,
      biaya_sumber: m.biaya_sumber, biaya_keyakinan: m.biaya_keyakinan,
      harga_pasar_min: n(m.harga_pasar_min), harga_pasar_max: n(m.harga_pasar_max), harga_acuan: harga,
      harga_acuan_sumber: n(m.harga_pasar_min) != null ? "harga pasar terendah" : rpt != null ? "realisasi OS" : null,
      biaya_di_volume: biayaTes(a, volAcuan), cicilan_di_volume: cicilanTes(a, volAcuan, p.tenor),
      gpm_realisasi: gReal, zona_realisasi: zona(gReal, p.zona),
      ...t,
      bottom_final: d ? (n(d.lantai_final) ?? t.bottom) : null,
      grid_volume: gridVolume(String(m.kelompok), String(m.satuan)),
      grid_harga: gridHarga(n(m.harga_pasar_min), n(m.harga_pasar_max), rpt),
      keputusan: d ? {
        volume: n(d.volume), lantai_final: n(d.lantai_final), keputusan: d.keputusan ?? null,
        catatan: d.catatan ?? "", diputus_at: d.diputus_at, diputus_nama: d.diputus_nama ?? null,
      } : null,
      units: unitMap.get(key) ?? [],
    };
  });
  const periode = models[0] ? { dari: String(models[0].periode_dari).slice(0, 10), sampai: String(models[0].periode_sampai).slice(0, 10) } : null;
  return {
    izin: { putus: iz.putus, angka: iz.angka, realLihat: iz.realLihat, realCatat: iz.realCatat },
    parameter: { tenor: p.tenor, gpm_am: p.zona.am, gpm_hod: p.zona.hod, gpm_forum: p.zona.forum, diubah_at: p.diubah_at },
    periode, jenis, baris,
  };
}

/** Real bottom — HANYA fitur kso-komite-bottomline-real (lihat). Dukungan berlaku hari ini (WIB). */
export async function bacaReal(userId: string) {
  const iz = await izin(userId);
  if (!iz.realLihat && !iz.realCatat) throw new GalatKso(403, "Real bottom hanya untuk Direktur.");
  const sql = db();
  const dukungan = await sql`
    SELECT d.id, d.model_key, d.jenis_dukungan, d.beli_x, d.gratis_y, d.berlaku_mulai::text AS berlaku_mulai,
           d.berlaku_sampai::text AS berlaku_sampai, d.catatan, u.name AS dicatat_nama, d.dicatat_at::text AS dicatat_at,
           (d.berlaku_mulai <= (now() AT TIME ZONE 'Asia/Jakarta')::date
             AND (d.berlaku_sampai IS NULL OR d.berlaku_sampai >= (now() AT TIME ZONE 'Asia/Jakarta')::date)) AS berlaku
      FROM kso_bottomline_dukungan d LEFT JOIN app_user u ON u.id::text = d.dicatat_oleh
     WHERE d.dicabut_at IS NULL ORDER BY d.model_key, d.berlaku_mulai DESC`;
  // pencatat tanpa hak lihat (mis. Finance) hanya melihat daftar dukungan, bukan angka real bottom
  if (!iz.realLihat) return { izin: { realLihat: false, realCatat: iz.realCatat }, dukungan, model: [] };
  const p = await bacaParam();
  const [models, kep] = await Promise.all([
    sql`SELECT * FROM kso_bottomline_model_v`,
    sql`SELECT model_key, volume FROM kso_bottomline_keputusan`,
  ]);
  const volKep = new Map(kep.map((r) => [String(r.model_key), n(r.volume)]));
  const perModel = new Map<string, Dukungan[]>();
  for (const d of dukungan) {
    if (!d.berlaku) continue;
    const key = String(d.model_key);
    (perModel.get(key) ?? perModel.set(key, []).get(key)!).push(d as unknown as Dukungan);
  }
  const model = models.filter((m) => perModel.has(String(m.model_key))).map((m) => {
    const key = String(m.model_key);
    const real = angkaReal(angkaDari(m), perModel.get(key)!);
    const vol = volKep.get(key) ?? n(m.volume);
    return { model_key: key, model: m.model, hpp_real: real.hpp, qc_real: real.qc, ...turunan(real, hargaAcuan(m), vol, p, m.satuan === "tindakan") };
  });
  return { izin: { realLihat: true, realCatat: iz.realCatat }, dukungan, model };
}

// ---------------------------------------------------------------- tulis

const angka = (v: unknown, nama: string, { boleh0 = false } = {}): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0 || (!boleh0 && x === 0)) throw new GalatKso(400, `${nama} harus angka ${boleh0 ? "≥ 0" : "> 0"}.`);
  return x;
};
const pecahan = (v: unknown, nama: string): number => {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0 || x >= 1) throw new GalatKso(400, `${nama} diisi pecahan 0–1 (mis. 0,45).`);
  return x;
};

async function wajib(userId: string, hak: Exclude<keyof IzinBottomLine, "lihat">, pesan: string) {
  const i = await izin(userId);
  if (!i[hak]) throw new GalatKso(403, pesan);
  return i.u;
}

async function modelAda(key: string) {
  const [m] = await db()`SELECT * FROM kso_bottomline_model_v WHERE model_key = ${key}`;
  if (!m) throw new GalatKso(404, "Model alat tidak ada di populasi KSO.");
  return m;
}

export async function simpanParameter(userId: string, b: Record<string, unknown>) {
  const u = await wajib(userId, "putus", "Hanya Direktur yang mengubah parameter.");
  const tenor = angka(b.tenor, "Tenor");
  if (tenor == null || !Number.isInteger(tenor)) throw new GalatKso(400, "Tenor harus bilangan bulat bulan.");
  const am = pecahan(b.gpm_am, "Batas zona AM"), hod = pecahan(b.gpm_hod, "Batas zona HOD"), forum = pecahan(b.gpm_forum, "Batas zona Forum");
  if (!(am > hod && hod > forum)) throw new GalatKso(400, "Batas zona harus berurutan: AM > HOD > Forum.");
  return db().begin(async (tx) => {
    await tx`UPDATE kso_bottomline_parameter SET bulan = ${tenor}, gpm_am = ${am}, gpm_hod = ${hod}, gpm_forum = ${forum},
                    diubah_oleh = ${u.id}, diubah_at = now() WHERE id = 1`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh)
             VALUES ('parameter', 'global', ${tx.json({ tenor, gpm_am: am, gpm_hod: hod, gpm_forum: forum })}, ${u.id})`;
    return { ok: true };
  });
}

export async function simpanKeputusan(userId: string, b: Record<string, unknown>) {
  const u = await wajib(userId, "putus", "Hanya Direktur yang memutus.");
  const key = typeof b.model_key === "string" ? b.model_key : "";
  const keputusan = b.keputusan == null || b.keputusan === "" ? null : String(b.keputusan);
  if (keputusan && !(KEPUTUSAN as readonly string[]).includes(keputusan)) throw new GalatKso(400, "Pilihan keputusan tidak dikenal.");
  const volume = angka(b.volume, "Volume acuan"), lantaiFinal = angka(b.lantai_final, "Bottom line final");
  const catatan = typeof b.catatan === "string" ? b.catatan.trim().slice(0, 1000) : "";
  const m = await modelAda(key);
  const p = await bacaParam();
  const bottom = m.satuan === "tindakan" ? null : hargaMin(angkaDari(m), volume ?? n(m.volume), p.zona.forum, p.tenor);
  const isi = { volume, lantai_final: lantaiFinal, lantai_hitung: bottom == null ? null : Math.round(bottom), keputusan, catatan };
  return db().begin(async (tx) => {
    // hpp & k (model lantai lama, 256) dikosongkan: HPP sekarang milik Finance (angka), K tak dipakai
    await tx`INSERT INTO kso_bottomline_keputusan (model_key, jenis, model, volume, lantai_final, lantai_hitung, keputusan, catatan, diputus_oleh)
             VALUES (${key}, ${m.jenis}, ${m.model}, ${volume}, ${lantaiFinal}, ${isi.lantai_hitung}, ${keputusan}, ${catatan}, ${u.id})
             ON CONFLICT (model_key) DO UPDATE SET hpp = NULL, k = NULL, volume = excluded.volume,
               lantai_final = excluded.lantai_final, lantai_hitung = excluded.lantai_hitung, keputusan = excluded.keputusan,
               catatan = excluded.catatan, diputus_oleh = excluded.diputus_oleh, diputus_at = now()`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh) VALUES ('keputusan', ${key}, ${tx.json(isi)}, ${u.id})`;
    return { ok: true, lantai_hitung: isi.lantai_hitung };
  });
}

/** Angka Finance per model: HPP standar, biaya reagen, reagen tetap, QC, harga pasar. Kosong = ikut data OS. */
export async function simpanAngka(userId: string, b: Record<string, unknown>) {
  const u = await wajib(userId, "angka", "Hanya Finance (centang ubah angka Bottom Line) yang mengubah HPP & biaya.");
  const key = typeof b.model_key === "string" ? b.model_key : "";
  await modelAda(key);
  const isi = {
    hpp_standar: angka(b.hpp_standar, "HPP standar"),
    biaya_per_tes: angka(b.biaya_per_tes, "Reagen per tes", { boleh0: true }),
    biaya_tetap_bulan: angka(b.biaya_tetap_bulan, "Reagen tetap per bulan", { boleh0: true }) ?? 0,
    qc_bulan: angka(b.qc_bulan, "QC per bulan", { boleh0: true }) ?? 0,
    harga_pasar_min: angka(b.harga_pasar_min, "Harga pasar terendah"),
    harga_pasar_max: angka(b.harga_pasar_max, "Harga pasar tertinggi"),
    keyakinan: ["High", "Med", "Low"].includes(String(b.keyakinan)) ? String(b.keyakinan) : null,
    sumber: typeof b.sumber === "string" && b.sumber.trim() ? b.sumber.trim().slice(0, 300) : "isian Finance",
  };
  if (isi.harga_pasar_min != null && isi.harga_pasar_max != null && isi.harga_pasar_max < isi.harga_pasar_min)
    throw new GalatKso(400, "Harga pasar tertinggi tidak boleh di bawah yang terendah.");
  return db().begin(async (tx) => {
    await tx`INSERT INTO kso_bottomline_biaya (model_key, hpp_standar, biaya_per_tes, biaya_tetap_bulan, qc_bulan,
                                               harga_pasar_min, harga_pasar_max, sumber, keyakinan, diubah_oleh)
             VALUES (${key}, ${isi.hpp_standar}, ${isi.biaya_per_tes}, ${isi.biaya_tetap_bulan}, ${isi.qc_bulan},
                     ${isi.harga_pasar_min}, ${isi.harga_pasar_max}, ${isi.sumber}, ${isi.keyakinan}, ${u.id})
             ON CONFLICT (model_key) DO UPDATE SET hpp_standar = excluded.hpp_standar, biaya_per_tes = excluded.biaya_per_tes,
               biaya_tetap_bulan = excluded.biaya_tetap_bulan, qc_bulan = excluded.qc_bulan,
               harga_pasar_min = excluded.harga_pasar_min, harga_pasar_max = excluded.harga_pasar_max,
               sumber = excluded.sumber, keyakinan = excluded.keyakinan, diubah_oleh = excluded.diubah_oleh, diubah_at = now()`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh) VALUES ('angka', ${key}, ${tx.json(isi)}, ${u.id})`;
    return { ok: true };
  });
}

export async function simpanJenis(userId: string, b: Record<string, unknown>) {
  const u = await wajib(userId, "angka", "Hanya Finance yang mengubah acuan per jenis.");
  const jenis = typeof b.jenis === "string" ? b.jenis : "";
  const rpt = angka(b.rupiah_per_tes_manual, "Rp/tes acuan");
  const gm = b.margin_kotor == null || b.margin_kotor === "" ? null : Number(b.margin_kotor);
  if (gm != null && !(Number.isFinite(gm) && gm >= 0 && gm < 1)) throw new GalatKso(400, "Margin kotor diisi pecahan 0–0,99 (mis. 0,53).");
  return db().begin(async (tx) => {
    // jenis baru dari spreadsheet (belum di-seed 256) ikut tersimpan; kelompok default = nama jenis
    const [ada] = await tx`SELECT 1 FROM kso_bottomline_model_v WHERE jenis = ${jenis} LIMIT 1`;
    if (!ada) throw new GalatKso(404, "Jenis alat tidak dikenal.");
    await tx`INSERT INTO kso_bottomline_jenis (jenis, kelompok, rupiah_per_tes_manual, margin_kotor, diubah_oleh)
             VALUES (${jenis}, ${jenis}, ${rpt}, ${gm}, ${u.id})
             ON CONFLICT (jenis) DO UPDATE SET rupiah_per_tes_manual = excluded.rupiah_per_tes_manual,
               margin_kotor = excluded.margin_kotor, diubah_oleh = excluded.diubah_oleh, diubah_at = now()`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh)
             VALUES ('jenis', ${jenis}, ${tx.json({ rupiah_per_tes_manual: rpt, margin_kotor: gm })}, ${u.id})`;
    return { ok: true };
  });
}

/** Catat dukungan prinsipal / promo (real bottom). Bertanggal; cabut = dicabut_at, riwayat tetap. */
export async function simpanDukungan(userId: string, b: Record<string, unknown>) {
  const u = await wajib(userId, "realCatat", "Hanya Direktur/Finance (centang ubah real bottom) yang mencatat dukungan prinsipal.");
  const tgl = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if (b.cabut != null) {
    const id = Number(b.cabut);
    if (!Number.isInteger(id) || id <= 0) throw new GalatKso(400, "permintaan tidak sah");
    return db().begin(async (tx) => {
      const r = await tx`UPDATE kso_bottomline_dukungan SET dicabut_at = now() WHERE id = ${id} AND dicabut_at IS NULL RETURNING model_key`;
      if (r.length === 0) throw new GalatKso(404, "Dukungan tidak ada atau sudah dicabut.");
      await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh) VALUES ('dukungan', ${String(r[0].model_key)}, ${tx.json({ cabut: id })}, ${u.id})`;
      return { ok: true };
    });
  }
  const key = typeof b.model_key === "string" ? b.model_key : "";
  await modelAda(key);
  const jenis = String(b.jenis_dukungan ?? "");
  if (!["promo", "prinsipal", "qc_gratis"].includes(jenis)) throw new GalatKso(400, "Pilih jenis dukungan: promo, alat didukung prinsipal, atau QC gratis.");
  const x = jenis === "promo" ? Number(b.beli_x) : null, y = jenis === "promo" ? Number(b.gratis_y) : null;
  if (jenis === "promo" && !(Number.isInteger(x) && x! > 0 && Number.isInteger(y) && y! > 0)) throw new GalatKso(400, "Promo wajib isi beli X dan gratis Y (bilangan bulat > 0).");
  const mulai = tgl(b.berlaku_mulai), sampai = tgl(b.berlaku_sampai);
  if (!mulai) throw new GalatKso(400, "Isi tanggal mulai berlaku.");
  if (sampai && sampai < mulai) throw new GalatKso(400, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  const catatan = typeof b.catatan === "string" ? b.catatan.trim().slice(0, 500) : null;
  return db().begin(async (tx) => {
    const [r] = await tx`INSERT INTO kso_bottomline_dukungan (model_key, jenis_dukungan, beli_x, gratis_y, berlaku_mulai, berlaku_sampai, catatan, dicatat_oleh)
                         VALUES (${key}, ${jenis}, ${x}, ${y}, ${mulai}, ${sampai}, ${catatan}, ${u.id}) RETURNING id`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh)
             VALUES ('dukungan', ${key}, ${tx.json({ id: Number(r.id), jenis, beli_x: x, gratis_y: y, mulai, sampai })}, ${u.id})`;
    return { ok: true, id: Number(r.id) };
  });
}
