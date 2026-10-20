// F170 Komite KSO — Susunan Komite (migrasi 241).
//
// Jabatan (Ketua/Sekretaris KSO Forum, Product Development, cadangan) dan pemegangnya diisi dari
// UI — nama orang TIDAK pernah ditulis di kode (keputusan user 21 Okt: ganti orang cukup dari layar).
// Ganti pemegang = baris lama ditutup (selesai) + baris baru; riwayat tetap utuh untuk risalah lama.
// Akses: lihat = siapa pun yang membuka satu tab Komite KSO; ubah = fitur `kso-komite-susunan`
// (edit) di Akses Grup atau grup superuser. Role admin TIDAK otomatis boleh mengubah (sama dengan
// tab Putusan Direksi: role admin juga dipakai HOD).

import { db } from "../db.js";
import { effectivePermissions, type Effective } from "./rbac.js";
import { GalatKso, bacaPengguna, tabBoleh, type PenggunaKso } from "./kso-komite.js";

export const FITUR_SUSUNAN = "kso-komite-susunan";
export const KOMITE = ["kso_forum", "product_development"] as const;
export type Komite = (typeof KOMITE)[number];

export function bolehUbahSusunan(_u: PenggunaKso, eff: Effective): boolean {
  if (eff.superuser) return true;
  const p = eff.permissions[FITUR_SUSUNAN];
  return !!p && p.active && p.edit;
}

async function izin(userId: string): Promise<{ u: PenggunaKso; ubah: boolean }> {
  const u = await bacaPengguna(userId);
  if (!u) throw new GalatKso(401, "Sesi tidak dikenal.");
  const ubah = bolehUbahSusunan(u, await effectivePermissions(userId));
  if (!ubah && (await tabBoleh(userId)).length === 0) throw new GalatKso(403, "Tidak punya akses ke Komite KSO.");
  return { u, ubah };
}

export interface Jabatan {
  kode: string; label: string; komite: Komite; urut: number; aktif: boolean;
  pemegang: { user_id: string; nama: string | null; mulai: string } | null;
}

export async function bacaSusunan(userId: string) {
  const { ubah } = await izin(userId);
  const sql = db();
  const baris = await sql`
    SELECT j.kode, j.label, j.komite, j.urut, j.aktif, p.user_id, u.name AS nama, p.mulai::text AS mulai
      FROM kso_komite_jabatan j
      LEFT JOIN kso_komite_pemegang p ON p.jabatan_kode = j.kode AND p.selesai IS NULL
      LEFT JOIN app_user u ON u.id::text = p.user_id
     ORDER BY j.urut, j.label`;
  const jabatan: Jabatan[] = baris.map((r) => ({
    kode: String(r.kode), label: String(r.label), komite: r.komite as Komite, urut: Number(r.urut), aktif: !!r.aktif,
    pemegang: r.user_id ? { user_id: String(r.user_id), nama: (r.nama as string | null) ?? null, mulai: String(r.mulai) } : null,
  }));
  const riwayat = await sql`
    SELECT p.jabatan_kode, j.label, p.user_id, u.name AS nama, p.mulai::text AS mulai, p.selesai::text AS selesai,
           d.name AS dicatat_oleh, p.dicatat_at::text AS dicatat_at
      FROM kso_komite_pemegang p
      JOIN kso_komite_jabatan j ON j.kode = p.jabatan_kode
      LEFT JOIN app_user u ON u.id::text = p.user_id
      LEFT JOIN app_user d ON d.id::text = p.dicatat_oleh
     ORDER BY p.dicatat_at DESC LIMIT 50`;
  // daftar akun hanya untuk yang boleh mengubah (pemilih pemegang)
  const akun = ubah ? await sql`SELECT id::text, name FROM app_user WHERE active ORDER BY name` : [];
  return { bolehUbah: ubah, jabatan, riwayat, akun };
}

const teks = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const tanggal = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const hariIniWib = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** Tetapkan (atau kosongkan, user_id null) pemegang satu jabatan mulai tanggal tertentu. */
export async function simpanPemegang(userId: string, b: Record<string, unknown>) {
  const { u, ubah } = await izin(userId);
  if (!ubah) throw new GalatKso(403, "Tidak berwenang mengubah Susunan Komite.");
  const kode = teks(b.jabatan_kode);
  const baru = teks(b.user_id);
  const mulai = tanggal(b.mulai) ?? hariIniWib();
  if (!kode) throw new GalatKso(400, "Pilih jabatannya.");
  return db().begin(async (tx) => {
    const [j] = await tx`SELECT kode FROM kso_komite_jabatan WHERE kode = ${kode}`;
    if (!j) throw new GalatKso(404, "Jabatan tidak ada.");
    if (baru) {
      const [akun] = await tx`SELECT 1 FROM app_user WHERE id::text = ${baru} AND active`;
      if (!akun) throw new GalatKso(400, "Akun tidak ditemukan atau tidak aktif.");
    }
    const [lama] = await tx`SELECT id, user_id, mulai::text AS mulai FROM kso_komite_pemegang
                             WHERE jabatan_kode = ${kode} AND selesai IS NULL FOR UPDATE`;
    if (lama && String(lama.user_id) === baru) return { ok: true, berubah: false };
    if (lama) {
      if (mulai < String(lama.mulai)) throw new GalatKso(409, `Tanggal mulai tidak boleh sebelum pemegang sekarang mulai (${lama.mulai}).`);
      // baris lama ditutup sehari sebelum pemegang baru mulai (atau hari yang sama bila mulai bersamaan)
      await tx`UPDATE kso_komite_pemegang SET selesai = GREATEST(mulai, ${mulai}::date - 1) WHERE id = ${lama.id}`;
    }
    if (baru) await tx`INSERT INTO kso_komite_pemegang (jabatan_kode, user_id, mulai, dicatat_oleh) VALUES (${kode}, ${baru}, ${mulai}, ${u.id})`;
    return { ok: true, berubah: true };
  });
}

const slugKode = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "jabatan";

/** Tambah jabatan baru (tanpa kode) atau ubah label/komite/urutan/aktif jabatan yang ada. */
export async function simpanJabatan(userId: string, b: Record<string, unknown>) {
  const { ubah } = await izin(userId);
  if (!ubah) throw new GalatKso(403, "Tidak berwenang mengubah Susunan Komite.");
  const label = teks(b.label);
  const komite = String(b.komite ?? "");
  if (!label) throw new GalatKso(400, "Nama jabatan wajib diisi.");
  if (!(KOMITE as readonly string[]).includes(komite)) throw new GalatKso(400, "Pilih komitenya: KSO Forum atau Product Development.");
  const urut = Number.isInteger(b.urut) ? Number(b.urut) : null;
  const aktif = typeof b.aktif === "boolean" ? b.aktif : true;
  const kode = teks(b.kode);
  const sql = db();
  if (kode) {
    const r = await sql`UPDATE kso_komite_jabatan SET label = ${label}, komite = ${komite}, urut = COALESCE(${urut}, urut),
                               aktif = ${aktif}, diubah_at = now() WHERE kode = ${kode} RETURNING kode`;
    if (r.length === 0) throw new GalatKso(404, "Jabatan tidak ada.");
    return { ok: true, kode };
  }
  const dasar = slugKode(label);
  const ada = new Set((await sql`SELECT kode FROM kso_komite_jabatan WHERE kode LIKE ${dasar + "%"}`).map((r) => String(r.kode)));
  let baru = dasar;
  for (let i = 2; ada.has(baru); i++) baru = `${dasar}_${i}`;
  await sql`INSERT INTO kso_komite_jabatan (kode, label, komite, urut, aktif)
            VALUES (${baru}, ${label}, ${komite}, COALESCE(${urut}, (SELECT COALESCE(max(urut), 0) + 10 FROM kso_komite_jabatan)), ${aktif})`;
  return { ok: true, kode: baru };
}

/** Pemegang aktif per kode jabatan (untuk teks WA). Jabatan nonaktif / kosong tidak ikut. */
export async function pemegangAktif(): Promise<Map<string, { label: string; nama: string }>> {
  const rows = await db()`
    SELECT j.kode, j.label, u.name AS nama FROM kso_komite_jabatan j
      JOIN kso_komite_pemegang p ON p.jabatan_kode = j.kode AND p.selesai IS NULL
      JOIN app_user u ON u.id::text = p.user_id
     WHERE j.aktif`;
  return new Map(rows.map((r) => [String(r.kode), { label: String(r.label), nama: String(r.nama ?? "") }]));
}
