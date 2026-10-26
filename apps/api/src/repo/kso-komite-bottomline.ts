// F172 Bottom Line Alat KSO (migrasi 256) — tab di Komite KSO.
//
// Lantai harga per tes per model alat: Direktur menetapkan, Komite memakai sebagai pegangan saat
// bilang ya atau tidak. Data dasar (unit, idle, omzet, volume historis, HPP aset tetap) live dari
// view kso_bottomline_model_v / _unit_v; parameter, biaya reagen, dan keputusan diisi dari layar.
//
//   lantai/tes = biaya reagen per tes + biaya tetap per bulan ÷ volume + (K × HPP) ÷ bulan ÷ volume
//
// Akses = fitur `kso-komite-bottomline` di Akses Grup: lihat (Komite) / ubah (Direktur). Gate lama
// sebelum fitur diatur di matriks: role direktur. Role admin TIDAK otomatis lolos — data HPP & biaya
// sensitif dan role admin dipakai juga oleh HOD (sama dengan tab Putusan Direksi).

import { db } from "../db.js";
import { effectivePermissions, type Effective } from "./rbac.js";
import { GalatKso, bacaPengguna, type PenggunaKso } from "./kso-komite.js";

export const FITUR_BOTTOMLINE = "kso-komite-bottomline";
export const KEPUTUSAN = ["Setuju", "Ubah", "Tahan penempatan baru", "Tarik / relokasi", "Diskusikan"] as const;

export function izinBottomLine(u: PenggunaKso, eff: Effective): { lihat: boolean; ubah: boolean } {
  if (eff.superuser) return { lihat: true, ubah: true };
  const p = eff.permissions[FITUR_BOTTOMLINE];
  if (p) return { lihat: p.active && p.view, ubah: p.active && p.edit };
  if (eff.groups.length === 0) return { lihat: false, ubah: false };
  const lama = u.role === "direktur";
  return { lihat: lama, ubah: lama };
}

// ---------------------------------------------------------------- rumus (murni, diuji)

export interface Parameter { k: number; bulan: number; penyangga_pct: number }

/** Biaya reagen per tes di volume v: variabel + biaya tetap bulanan dibagi volume. */
export function biayaPerTes(variabel: number | null, tetapBulan: number, v: number | null): number | null {
  if (variabel == null || !v || v <= 0) return null;
  return variabel + tetapBulan / v;
}

/** Lantai per tes. HPP kosong → lantai = biaya reagen saja (alat tanpa capex tercatat). */
export function lantai(variabel: number | null, tetapBulan: number, v: number | null, hpp: number | null, k: number, bulan: number): number | null {
  const c = biayaPerTes(variabel, tetapBulan, v);
  if (c == null) return null;
  if (!hpp || hpp <= 0) return c;
  return c + (k * hpp) / bulan / v!;
}

export type Posisi = "aman" | "tipis" | "bawah" | "na";
/** Realisasi Rp/tes dibanding lantai usulan: aman bila ≥ lantai + penyangga AM, tipis bila ≥ lantai. */
export function posisi(realisasi: number | null, lantaiUsulan: number | null, penyanggaPct: number): Posisi {
  if (!realisasi || !lantaiUsulan) return "na";
  if (realisasi >= lantaiUsulan * (1 + penyanggaPct / 100)) return "aman";
  return realisasi >= lantaiUsulan ? "tipis" : "bawah";
}

/** Titik volume untuk tabel sensitivitas. */
export function gridVolume(kelompok: string, satuan: string): number[] {
  if (satuan === "tindakan") return [12, 24, 36, 48, 60, 72];
  if (["Hematologi", "Kimia Klinik", "Urinalisa"].includes(kelompok)) return [100, 250, 500, 750, 1000, 1500, 2000];
  return [10, 25, 50, 100, 200, 300, 500];
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

/** Boleh lihat tab ini? Dipakai halaman & BFF untuk menampilkan tab (API tetap menentukan). */
export async function aksesBottomLine(userId: string): Promise<{ lihat: boolean; ubah: boolean }> {
  const u = await bacaPengguna(userId);
  if (!u) return { lihat: false, ubah: false };
  return izinBottomLine(u, await effectivePermissions(userId));
}

export async function bacaBottomLine(userId: string) {
  const { ubah } = await izin(userId);
  const sql = db();
  const [p] = await sql`SELECT k, bulan, penyangga_pct, diubah_at::text AS diubah_at FROM kso_bottomline_parameter WHERE id = 1`;
  const par: Parameter = { k: Number(p?.k ?? 3), bulan: Number(p?.bulan ?? 36), penyangga_pct: Number(p?.penyangga_pct ?? 20) };
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
    const a = n(m.biaya_per_tes), bt = n(m.biaya_tetap_bulan) ?? 0, vol = n(m.volume), hpp = n(m.hpp), rpt = n(m.rupiah_per_tes);
    const usulan = lantai(a, bt, vol, hpp, par.k, par.bulan);
    const hppU = n(d?.hpp) ?? hpp, volU = n(d?.volume) ?? vol, kU = n(d?.k) ?? par.k;
    const hitung = lantai(a, bt, volU, hppU, kU, par.bulan);
    const final = d ? (n(d.lantai_final) ?? hitung) : null;
    return {
      model_key: key, kelompok: m.kelompok, jenis: m.jenis, model: m.model, satuan: m.satuan,
      unit: Number(m.unit), idle: Number(m.idle), tanpa_faskes: Number(m.tanpa_faskes),
      omzet_12: n(m.omzet_12), omzet_unit_bln: n(m.omzet_unit_bln),
      hpp, hpp_tgl: m.hpp_tgl ? String(m.hpp_tgl).slice(0, 10) : null, hpp_median: n(m.hpp_median), hpp_sumber: m.hpp_sumber,
      unit_ber_hpp: Number(m.unit_ber_hpp),
      rupiah_per_tes: rpt, rupiah_per_tes_sumber: m.rupiah_per_tes_sumber, volume: vol,
      biaya_per_tes: a, biaya_tetap_bulan: bt, biaya_sumber: m.biaya_sumber, biaya_keyakinan: m.biaya_keyakinan,
      biaya_di_volume: biayaPerTes(a, bt, vol),
      lantai_usulan: usulan, lantai_hitung: hitung, lantai_final: final,
      posisi: posisi(rpt, usulan, par.penyangga_pct),
      grid: gridVolume(String(m.kelompok), String(m.satuan)),
      keputusan: d ? {
        hpp: n(d.hpp), volume: n(d.volume), k: n(d.k), lantai_final: n(d.lantai_final), keputusan: d.keputusan ?? null,
        catatan: d.catatan ?? "", diputus_at: d.diputus_at, diputus_nama: d.diputus_nama ?? null,
      } : null,
      units: unitMap.get(key) ?? [],
    };
  });
  const periode = models[0] ? { dari: String(models[0].periode_dari).slice(0, 10), sampai: String(models[0].periode_sampai).slice(0, 10) } : null;
  return { bolehUbah: ubah, parameter: { ...par, diubah_at: p?.diubah_at ?? null }, periode, jenis, baris };
}

// ---------------------------------------------------------------- tulis

const angka = (v: unknown, nama: string, { min = 0, boleh0 = false } = {}): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < min || (!boleh0 && x === 0)) throw new GalatKso(400, `${nama} harus angka ${boleh0 ? "≥ 0" : "> 0"}.`);
  return x;
};

async function wajibUbah(userId: string) {
  const i = await izin(userId);
  if (!i.ubah) throw new GalatKso(403, "Hanya Direktur (centang ubah Bottom Line Alat) yang bisa mengubah.");
  return i.u;
}

export async function simpanParameter(userId: string, b: Record<string, unknown>) {
  const u = await wajibUbah(userId);
  const k = angka(b.k, "K"), bulan = angka(b.bulan, "Bulan"), buf = angka(b.penyangga_pct, "Penyangga AM", { boleh0: true });
  if (k == null || bulan == null || buf == null) throw new GalatKso(400, "Isi K, bulan, dan penyangga AM.");
  if (!Number.isInteger(bulan)) throw new GalatKso(400, "Bulan harus bilangan bulat.");
  return db().begin(async (tx) => {
    await tx`UPDATE kso_bottomline_parameter SET k = ${k}, bulan = ${bulan}, penyangga_pct = ${buf},
                    diubah_oleh = ${u.id}, diubah_at = now() WHERE id = 1`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh)
             VALUES ('parameter', 'global', ${tx.json({ k, bulan, penyangga_pct: buf })}, ${u.id})`;
    return { ok: true };
  });
}

export async function simpanKeputusan(userId: string, b: Record<string, unknown>) {
  const u = await wajibUbah(userId);
  const key = typeof b.model_key === "string" ? b.model_key : "";
  const keputusan = b.keputusan == null || b.keputusan === "" ? null : String(b.keputusan);
  if (keputusan && !(KEPUTUSAN as readonly string[]).includes(keputusan)) throw new GalatKso(400, "Pilihan keputusan tidak dikenal.");
  const hpp = angka(b.hpp, "HPP"), volume = angka(b.volume, "Volume acuan"), k = angka(b.k, "K"), lantaiFinal = angka(b.lantai_final, "Bottom line final");
  const catatan = typeof b.catatan === "string" ? b.catatan.trim().slice(0, 1000) : "";
  const sql = db();
  const [m] = await sql`SELECT * FROM kso_bottomline_model_v WHERE model_key = ${key}`;
  if (!m) throw new GalatKso(404, "Model alat tidak ada di populasi KSO.");
  const [p] = await sql`SELECT k, bulan FROM kso_bottomline_parameter WHERE id = 1`;
  const volU = volume ?? n(m.volume);
  const hitung = lantai(n(m.biaya_per_tes), n(m.biaya_tetap_bulan) ?? 0, volU, hpp ?? n(m.hpp), k ?? Number(p.k), Number(p.bulan));
  const isi = { hpp, volume, k, lantai_final: lantaiFinal, lantai_hitung: hitung == null ? null : Math.round(hitung), keputusan, catatan };
  return sql.begin(async (tx) => {
    await tx`INSERT INTO kso_bottomline_keputusan (model_key, jenis, model, hpp, volume, k, lantai_final, lantai_hitung, keputusan, catatan, diputus_oleh)
             VALUES (${key}, ${m.jenis}, ${m.model}, ${hpp}, ${volume}, ${k}, ${lantaiFinal}, ${isi.lantai_hitung}, ${keputusan}, ${catatan}, ${u.id})
             ON CONFLICT (model_key) DO UPDATE SET hpp = excluded.hpp, volume = excluded.volume, k = excluded.k,
               lantai_final = excluded.lantai_final, lantai_hitung = excluded.lantai_hitung, keputusan = excluded.keputusan,
               catatan = excluded.catatan, diputus_oleh = excluded.diputus_oleh, diputus_at = now()`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh) VALUES ('keputusan', ${key}, ${tx.json(isi)}, ${u.id})`;
    return { ok: true, lantai_hitung: isi.lantai_hitung };
  });
}

export async function simpanBiaya(userId: string, b: Record<string, unknown>) {
  const u = await wajibUbah(userId);
  const key = typeof b.model_key === "string" ? b.model_key : "";
  const sql = db();
  const [m] = await sql`SELECT 1 FROM kso_bottomline_model_v WHERE model_key = ${key}`;
  if (!m) throw new GalatKso(404, "Model alat tidak ada di populasi KSO.");
  const a = angka(b.biaya_per_tes, "Biaya reagen per tes", { boleh0: true });
  const bt = angka(b.biaya_tetap_bulan, "Biaya tetap per bulan", { boleh0: true }) ?? 0;
  if (a == null) throw new GalatKso(400, "Isi biaya reagen per tes.");
  const keyakinan = ["High", "Med", "Low"].includes(String(b.keyakinan)) ? String(b.keyakinan) : null;
  const sumber = typeof b.sumber === "string" && b.sumber.trim() ? b.sumber.trim().slice(0, 300) : "isian Direktur";
  return sql.begin(async (tx) => {
    await tx`INSERT INTO kso_bottomline_biaya (model_key, biaya_per_tes, biaya_tetap_bulan, sumber, keyakinan, diubah_oleh)
             VALUES (${key}, ${a}, ${bt}, ${sumber}, ${keyakinan}, ${u.id})
             ON CONFLICT (model_key) DO UPDATE SET biaya_per_tes = excluded.biaya_per_tes, biaya_tetap_bulan = excluded.biaya_tetap_bulan,
               sumber = excluded.sumber, keyakinan = excluded.keyakinan, diubah_oleh = excluded.diubah_oleh, diubah_at = now()`;
    await tx`INSERT INTO kso_bottomline_log (jenis_ubah, kunci, isi, oleh)
             VALUES ('biaya', ${key}, ${tx.json({ biaya_per_tes: a, biaya_tetap_bulan: bt, sumber, keyakinan })}, ${u.id})`;
    return { ok: true };
  });
}

export async function simpanJenis(userId: string, b: Record<string, unknown>) {
  const u = await wajibUbah(userId);
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
