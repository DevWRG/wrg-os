// F145 Simulator KSO — kelola harga beli (migrasi 264, Pedoman Komite KSO Forum v01 Fase B).
//
// Finance mengisi harga beli WRG per kemasan reagen / kit parameter, kode barang Accurate (untuk saran
// harga dari PO terakhir), dan pemetaan analyzer → model F172 (sumber HPP alat). Simulator sendiri tetap
// baca-saja dari /kso/master; yang disimpan di sini hanya angka MASTER, bukan hasil simulasi.
//
// Izin: fitur `kso-simulator-hargabeli` (lihat = buka layar kelola, ubah = simpan). Tidak ada gate lama
// (fitur baru default tertutup); role admin TIDAK otomatis — sama dengan F172 (role admin juga HOD).
// API memeriksa sendiri karena x-service-token BFF mem-bypass JWT.

import { db } from "../db.js";
import { effectivePermissions, type Effective } from "./rbac.js";

export const FITUR_HARGA_BELI = "kso-simulator-hargabeli";

export class GalatHargaBeli extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function izinHargaBeli(eff: Effective): { lihat: boolean; ubah: boolean } {
  if (eff.superuser) return { lihat: true, ubah: true };
  const p = eff.permissions[FITUR_HARGA_BELI];
  if (!p || !p.active) return { lihat: false, ubah: false };
  return { lihat: p.view || p.edit, ubah: p.edit };
}

async function izin(userId: string) {
  if (!userId) throw new GalatHargaBeli(401, "Sesi tidak dikenal.");
  const i = izinHargaBeli(await effectivePermissions(userId));
  if (!i.lihat) throw new GalatHargaBeli(403, "Tidak punya akses ke kelola harga beli Simulator KSO.");
  return i;
}

/** Boleh membuka layar kelola? Dipakai halaman untuk menampilkan tombolnya. */
export async function aksesHargaBeli(userId: string) {
  if (!userId) return { lihat: false, ubah: false };
  return izinHargaBeli(await effectivePermissions(userId));
}

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

export async function daftarHargaBeli(userId: string) {
  const { ubah } = await izin(userId);
  const sql = db();
  const [reagen, parameter, analyzer, model] = await Promise.all([
    sql`SELECT r.id, a.kategori, a.kode AS analyzer, a.label AS analyzer_label, r.kode, r.jenis, r.nama, r.pack,
               r.harga_dp, r.harga_pl, r.harga_beli, r.accurate_item_no, r.harga_beli_sumber, r.harga_beli_at::text AS harga_beli_at,
               po.item_desc AS po_item, po.unit AS po_unit, po.unit_price AS po_harga, po.po_number, po.order_date::text AS po_tanggal, po.vendor_name AS po_vendor
          FROM kso_reagent r JOIN kso_analyzer a ON a.id = r.analyzer_id
          LEFT JOIN kso_harga_po_v po ON po.item_no = r.accurate_item_no
         WHERE a.aktif ORDER BY a.urutan, a.kategori, a.kode, r.urutan, r.kode`,
    sql`SELECT p.id, p.grup, p.no, p.nama, p.panel, p.pack, p.tests_per_kit,
               p.harga_dp, p.harga_pl, p.harga_beli, p.accurate_item_no, p.harga_beli_sumber, p.harga_beli_at::text AS harga_beli_at,
               po.item_desc AS po_item, po.unit AS po_unit, po.unit_price AS po_harga, po.po_number, po.order_date::text AS po_tanggal, po.vendor_name AS po_vendor
          FROM kso_parameter p LEFT JOIN kso_harga_po_v po ON po.item_no = p.accurate_item_no
         WHERE p.aktif ORDER BY p.grup, p.no`,
    sql`SELECT a.id, a.kategori, a.kode, a.label, a.default_capex, a.default_capex_pl, a.model_key, m.hpp, m.hpp_sumber
          FROM kso_analyzer a LEFT JOIN kso_bottomline_model_v m ON m.model_key = a.model_key
         WHERE a.aktif ORDER BY a.urutan, a.kategori, a.kode`,
    sql`SELECT model_key, model, jenis, hpp FROM kso_bottomline_model_v ORDER BY kelompok, model`,
  ]);
  const baris = (r: Record<string, unknown>) => ({
    ...r,
    harga_dp: n(r.harga_dp), harga_pl: n(r.harga_pl), harga_beli: n(r.harga_beli), po_harga: n(r.po_harga),
  });
  return {
    bolehUbah: ubah,
    reagen: reagen.map(baris),
    parameter: parameter.map(baris),
    analyzer: analyzer.map((a) => ({ ...a, default_capex: n(a.default_capex), default_capex_pl: n(a.default_capex_pl), hpp: n(a.hpp) })),
    model: model.map((m) => ({ model_key: m.model_key, model: m.model, jenis: m.jenis, hpp: n(m.hpp) })),
  };
}

const KODE_BARANG = /^[A-Za-z0-9._\-/ ]{1,60}$/;

/** Simpan harga beli + kode barang (reagen/parameter) atau pemetaan model (analyzer). Kosong = hapus isian. */
export async function simpanHargaBeli(userId: string, b: Record<string, unknown>) {
  const { ubah } = await izin(userId);
  if (!ubah) throw new GalatHargaBeli(403, "Hanya Finance (centang ubah kelola harga beli) yang bisa menyimpan.");
  const tipe = String(b.tipe ?? "");
  const id = Number(b.id);
  if (!["reagen", "parameter", "analyzer"].includes(tipe) || !Number.isInteger(id) || id <= 0) throw new GalatHargaBeli(400, "permintaan tidak sah");
  const sql = db();

  if (tipe === "analyzer") {
    const key = b.model_key == null || b.model_key === "" ? null : String(b.model_key);
    if (key) {
      const [m] = await sql`SELECT 1 FROM kso_bottomline_model_v WHERE model_key = ${key}`;
      if (!m) throw new GalatHargaBeli(404, "Model alat tidak ada di populasi KSO.");
    }
    const r = await sql`UPDATE kso_analyzer SET model_key = ${key}, updated_at = now() WHERE id = ${id} RETURNING id`;
    if (r.length === 0) throw new GalatHargaBeli(404, "Analyzer tidak ada.");
    return { ok: true };
  }

  const harga = b.harga_beli == null || b.harga_beli === "" ? null : Number(b.harga_beli);
  if (harga != null && !(Number.isFinite(harga) && harga >= 0)) throw new GalatHargaBeli(400, "Harga beli harus angka ≥ 0.");
  const item = typeof b.accurate_item_no === "string" && b.accurate_item_no.trim() ? b.accurate_item_no.trim() : null;
  if (item && !KODE_BARANG.test(item)) throw new GalatHargaBeli(400, "Kode barang Accurate tidak sah.");
  const sumber = harga == null ? null : b.sumber === "po" ? "PO Accurate terakhir" : "isian Finance";
  const r = tipe === "reagen"
    ? await sql`UPDATE kso_reagent SET harga_beli = ${harga}, accurate_item_no = ${item}, harga_beli_sumber = ${sumber},
                       harga_beli_oleh = ${userId}, harga_beli_at = now(), updated_at = now() WHERE id = ${id} RETURNING id`
    : await sql`UPDATE kso_parameter SET harga_beli = ${harga}, accurate_item_no = ${item}, harga_beli_sumber = ${sumber},
                       harga_beli_oleh = ${userId}, harga_beli_at = now(), updated_at = now() WHERE id = ${id} RETURNING id`;
  if (r.length === 0) throw new GalatHargaBeli(404, "Barang tidak ada.");
  return { ok: true };
}
