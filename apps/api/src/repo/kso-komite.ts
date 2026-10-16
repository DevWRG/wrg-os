// F170 Komite KSO — layar per peran (Tahap 4).
//
// Satu menu "Komite KSO", satu tab per peran, dan tiap tab = satu fitur di matriks Akses Grup
// (keputusan 16 Okt: peran Komite/Direksi/Admin Sales/Teknik diatur di Akses Grup, bukan di
// kso.pengguna). Dua gerbang berlapis:
//   1. API memeriksa izin tab di Akses Grup (`izinTab`, meniru canOrLegacy web persis) —
//      BFF juga memeriksa, tapi API tak bergantung padanya (x-service-token bypass JWT).
//   2. Transaksi diberi identitas + peran tab (GUC wrg.kso_user/peran/ref, migrasi 230), lalu
//      pagar database (kso.wajib_peran + RLS boleh_lihat) tetap berlaku.
// Semua tulis lewat kso.app_* — tak ada UPDATE tabel kso dari sini.

import type { TransactionSql } from "postgres";
import { db } from "../db.js";
import { effectivePermissions, type Action, type Effective } from "./rbac.js";

export type TabKso = "saya" | "hod" | "agenda" | "direksi" | "penawaran" | "teknik" | "kpi";
type PeranKso = "am" | "hod" | "komite" | "direksi" | "admin_sales" | "teknik";

/** SATU sumber peta tab → fitur Akses Grup → peran database. Kunci fitur = NavItem.features di web. */
export const TAB_KSO: Record<TabKso, { fitur: string; peran: PeranKso; label: string }> = {
  saya: { fitur: "kso-komite", peran: "am", label: "Rencana Saya" },
  hod: { fitur: "kso-komite-hod", peran: "hod", label: "HOD" },
  agenda: { fitur: "kso-komite-agenda", peran: "komite", label: "Agenda Forum" },
  direksi: { fitur: "kso-komite-direksi", peran: "direksi", label: "Putusan Direksi" },
  penawaran: { fitur: "kso-komite-penawaran", peran: "admin_sales", label: "Terbitkan Penawaran" },
  teknik: { fitur: "kso-komite-teknik", peran: "teknik", label: "Jadwal Pasang" },
  kpi: { fitur: "kso-komite-kpi", peran: "komite", label: "KPI AM" },
};
export const SEMUA_TAB = Object.keys(TAB_KSO) as TabKso[];
export function isTabKso(t: string): t is TabKso {
  return (SEMUA_TAB as string[]).includes(t);
}

export interface PenggunaKso {
  id: string;
  name: string | null;
  role: string | null;
  am_id: string | null;
  hod_key: string | null;
}

/**
 * Keputusan izin tab — meniru apps/web/src/lib/perms.ts canOrLegacy() PERSIS, supaya tab yang
 * tampil di web tak pernah berujung 403 di API (dan sebaliknya):
 *   superuser / role admin → boleh · fitur sudah diatur di matriks → matriks menentukan ·
 *   user tanpa grup → tidak · selain itu → gate lama (identitas).
 * Gate lama sengaja sempit: AM (am_id) untuk Rencana Saya, HOD (hod_key) untuk tab HOD, Direktur
 * untuk Putusan Direksi; tab lain TERTUTUP sampai dicentang di Akses Grup (fitur baru default tertutup).
 */
export function putuskanIzin(u: PenggunaKso, eff: Effective, tab: TabKso, aksi: Action): boolean {
  const f = TAB_KSO[tab].fitur;
  if (eff.superuser || u.role === "admin") return true;
  const p = eff.permissions[f];
  if (p) {
    if (!p.active) return false;
    return aksi === "view" ? p.view : aksi === "create" ? p.create : aksi === "edit" ? p.edit : p.delete;
  }
  if (eff.groups.length === 0) return false;
  const lama = tab === "saya" ? !!u.am_id : tab === "hod" ? !!u.hod_key : tab === "direksi" ? u.role === "direktur" : false;
  return lama;
}

/** Ref database untuk peran tab: AM → am_id, HOD → hod_key. Peran lain tak butuh ref. */
export function refUntuk(u: PenggunaKso, tab: TabKso): { ok: true; ref: string | null } | { ok: false; pesan: string } {
  const peran = TAB_KSO[tab].peran;
  if (peran === "am") return u.am_id ? { ok: true, ref: u.am_id } : { ok: false, pesan: "Akun ini belum tertaut ke AM (am_id)." };
  if (peran === "hod") return u.hod_key ? { ok: true, ref: u.hod_key } : { ok: false, pesan: "Akun ini belum tertaut ke HOD (hod_key)." };
  return { ok: true, ref: null };
}

export class GalatKso extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function bacaPengguna(userId: string): Promise<PenggunaKso | null> {
  const [u] = await db()`SELECT id::text, name, role, am_id, hod_key FROM app_user WHERE id::text = ${userId} AND active`;
  return (u as unknown as PenggunaKso) ?? null;
}

/** Tab yang boleh dilihat user ini — dipakai web untuk menyusun tab, dan API untuk menolak. */
export async function tabBoleh(userId: string): Promise<{ tab: TabKso; bolehAksi: boolean }[]> {
  const u = await bacaPengguna(userId);
  if (!u) return [];
  const eff = await effectivePermissions(userId);
  return SEMUA_TAB.filter((t) => putuskanIzin(u, eff, t, "view") && refUntuk(u, t).ok).map((t) => ({
    tab: t,
    bolehAksi: putuskanIzin(u, eff, t, "edit"),
  }));
}

type Tx = TransactionSql<Record<string, unknown>>;

/** Jalankan fn dalam satu transaksi dengan identitas + peran tab — SETELAH izin Akses Grup diperiksa. */
async function sebagaiPengguna<T>(userId: string, tab: TabKso, aksi: Action, fn: (tx: Tx, u: PenggunaKso) => Promise<T>): Promise<T> {
  const u = await bacaPengguna(userId);
  if (!u) throw new GalatKso(401, "Sesi tidak dikenal.");
  const eff = await effectivePermissions(userId);
  if (!putuskanIzin(u, eff, tab, aksi))
    throw new GalatKso(403, aksi === "view" ? `Tidak punya akses ke tab ${TAB_KSO[tab].label}.` : `Tidak berwenang bertindak di tab ${TAB_KSO[tab].label}.`);
  const r = refUntuk(u, tab);
  if (!r.ok) throw new GalatKso(403, r.pesan);
  return (await db().begin(async (tx) => {
    await tx`select set_config('wrg.kso_user', ${u.id}, true), set_config('wrg.kso_peran', ${TAB_KSO[tab].peran}, true),
                    set_config('wrg.kso_ref', ${r.ref ?? ""}, true)`;
    return fn(tx as unknown as Tx, u);
  })) as T;
}

// ---------------------------------------------------------------- baca

const ANTREAN: Record<Exclude<TabKso, "kpi">, string[]> = {
  saya: ["AM · Rencana Saya"],
  hod: ["HOD · Minta Putusan", "HOD · Minta Pendapat"],
  agenda: ["Komite · Agenda Forum", "Komite · Mandat Kedaluwarsa"],
  direksi: ["Direksi · Putusan"],
  penawaran: ["Admin Sales · Terbitkan Penawaran"],
  teknik: ["Teknik · Jadwal Pasang"],
};

export async function daftarTab(userId: string, tab: TabKso): Promise<Record<string, unknown>> {
  return sebagaiPengguna(userId, tab, "view", async (tx, u) => {
    const [ringkasan] = await tx`select * from kso.v_ringkasan`;
    if (tab === "kpi") {
      const kpi = await tx`select * from kso.v_kpi_am order by periode desc, am_nama`;
      return { tab, ringkasan, kpi };
    }
    const label = ANTREAN[tab];
    const pemilik = tab === "saya" ? u.am_id : tab === "hod" ? u.hod_key : null;
    const baris = await tx`
      select a.antrean, a.rencana_id::int as id, a.nomor, a.status, a.faskes_nama, a.alat_nama, a.capex::float8 as capex,
             a.sejak, a.batas, v.am_nama, v.cabang, v.jalur::text as jalur, v.pola_gerbang, v.gerbang_merah, v.volume_sumber
        from kso.v_antrean a join kso.v_rencana v on v.id = a.rencana_id
       where a.antrean = any(${label}) and (${pemilik}::text is null or a.pemilik_id = ${pemilik})
       order by a.batas nulls last, a.sejak desc`;
    const agenda = tab === "agenda"
      ? await tx`select forum_id::int, tanggal::text, hari, mode::text, jenis, urut, rencana_id::int, nomor, am_nama, faskes_nama,
                        alat_nama, capex::float8 as capex, pola_gerbang, gerbang_merah, status, pendapat_hod_masuk::int
                   from kso.v_agenda where tanggal >= kso.hari_ini() - 14 order by tanggal desc, jenis, urut`
      : [];
    return { tab, ringkasan, baris, agenda };
  });
}

export async function detailRencana(userId: string, tab: TabKso, id: number): Promise<Record<string, unknown>> {
  return sebagaiPengguna(userId, tab, "view", async (tx) => {
    const [r] = await tx`select *, capex::float8 as capex from kso.v_rencana where id = ${id}`;
    if (!r) throw new GalatKso(404, "Rencana tidak ada, atau di luar akses tab ini.");
    const [gerbang, pendukung, klausul, pendapat, mandat, usulan, putusan, riwayat, agendaItem] = await Promise.all([
      tx`select no, nama, status::text, nilai from kso.gerbang_hasil where rencana_id = ${id} order by no`,
      tx`select nama, tipe::text, sip_faskes, kontak_terakhir_tanggal::text, kontak_terakhir_cara::text from kso.rencana_pendukung where rencana_id = ${id} order by id`,
      tx`select k.kode, k.label from kso.rencana_klausul rk join kso.klausul_khusus k on k.kode = rk.klausul_kode where rk.rencana_id = ${id}`,
      tx`select p.hod_id, h.nama as hod_nama, p.jenis, p.keputusan, p.catatan, p.dianggap_setuju, p.at::text
           from kso.pendapat_hod p left join kso.hod h on h.id = p.hod_id where p.rencana_id = ${id} order by p.at`,
      tx`select harga_lantai::float8, harga_target::float8, tenor_maks_bulan, capex_maks::float8, volume_minimum, klausul_dilarang,
                berlaku_sampai::text, sumber from kso.mandat where rencana_id = ${id}`,
      tx`select usulan::text, syarat, mandat_usulan, data_kurang, pemilik, tanggal_kembali::text, alasan, at::text from kso.usulan_komite_catatan where rencana_id = ${id} order by at`,
      tx`select putusan::text, catatan, at::text from kso.putusan_direksi_catatan where rencana_id = ${id}`,
      tx`select s.dari::text, s.ke::text, s.oleh, s.oleh_peran, s.at::text, u.name as oleh_nama
           from kso.riwayat_status s left join public.app_user u on u.id::text = s.oleh_user where s.rencana_id = ${id} order by s.at`,
      tx`select ai.forum_id::int, f.tanggal::text from kso.agenda_item ai join kso.forum f on f.id = ai.forum_id where ai.rencana_id = ${id} order by f.tanggal desc limit 1`,
    ]);
    return { rencana: r, gerbang, pendukung, klausul, pendapat, mandat: mandat[0] ?? null, usulan, putusan: putusan[0] ?? null, riwayat, forum: agendaItem[0] ?? null };
  });
}

// ---------------------------------------------------------------- aksi

export type AksiKso =
  | "putus-hod" | "pendapat-hod" | "usulkan" | "tarik" | "putus-direksi" | "pks" | "penawaran" | "kalah" | "serah-terima";

/** Aksi → tab yang berwenang. Satu tempat; web memakai daftar yang sama untuk menampilkan tombol. */
export const AKSI_TAB: Record<AksiKso, TabKso> = {
  "putus-hod": "hod",
  "pendapat-hod": "hod",
  usulkan: "agenda",
  tarik: "agenda",
  "putus-direksi": "direksi",
  pks: "direksi",
  penawaran: "penawaran",
  kalah: "penawaran",
  "serah-terima": "teknik",
};
export function isAksiKso(a: string): a is AksiKso {
  return a in AKSI_TAB;
}

const teks = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const angka = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const tanggal = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Validasi isian form sebelum ke database. Mengembalikan pesan galat untuk manusia, atau null. */
export function validasiAksi(aksi: AksiKso, b: Record<string, unknown>): string | null {
  switch (aksi) {
    case "putus-hod":
      return ["setuju", "tolak", "naikkan"].includes(String(b.keputusan)) ? null : "Pilih Setuju, Tolak, atau Naikkan ke forum.";
    case "pendapat-hod":
      return teks(b.catatan) ? null : "Pendapat wajib diisi.";
    case "usulkan": {
      const u = String(b.usulan);
      if (!["DIREKOMENDASIKAN", "DIREKOMENDASIKAN_BERSYARAT", "DITAHAN", "TIDAK_DIREKOMENDASIKAN"].includes(u)) return "Pilih usulan komite.";
      if (u === "DITAHAN" && (!teks(b.data_kurang) || !teks(b.pemilik) || !tanggal(b.tanggal_kembali)))
        return "Usulan DITAHAN wajib mengisi tiga kolom: data yang kurang, siapa yang melengkapi, dan tanggal kembali ke forum.";
      if (u === "DIREKOMENDASIKAN_BERSYARAT" && !teks(b.syarat)) return "Usulan bersyarat wajib menyebut syaratnya.";
      if (u === "TIDAK_DIREKOMENDASIKAN" && !teks(b.alasan)) return "Sebutkan alasan tidak direkomendasikan.";
      return null;
    }
    case "tarik":
      return teks(b.alasan) ? null : "Alasan menarik ke forum wajib diisi.";
    case "putus-direksi": {
      const p = String(b.putusan);
      if (!["SETUJU", "BERSYARAT", "TOLAK"].includes(p)) return "Pilih Setuju, Bersyarat, atau Tolak.";
      if (p === "TOLAK") return teks(b.catatan) ? null : "Sebutkan alasan penolakan.";
      for (const [k, l] of [["lantai", "harga lantai"], ["target", "harga pembuka"], ["tenor_maks", "tenor maksimal"], ["capex_maks", "capex maksimal"], ["volume_min", "volume minimum"]] as const)
        if (angka(b[k]) === null) return `Mandat wajib lengkap: ${l} belum diisi.`;
      if ((angka(b.target) ?? 0) < (angka(b.lantai) ?? 0)) return "Harga pembuka tidak boleh di bawah harga lantai.";
      if (p === "BERSYARAT" && !teks(b.catatan)) return "Putusan bersyarat wajib menyebut syaratnya di catatan.";
      return null;
    }
    case "pks":
      return angka(b.harga_deal) ? null : "Harga per test di PKS wajib diisi.";
    case "penawaran":
      return angka(b.harga) ? null : "Harga penawaran wajib diisi.";
    case "kalah":
      return teks(b.alasan) ? null : "Alasan kalah wajib diisi.";
    case "serah-terima":
      return teks(b.nomor_seri) ? null : "Nomor seri alat wajib diisi.";
  }
}

/** Galat database → kalimat untuk layar. Kode galat tak pernah sampai ke pengguna. */
export function terjemahGalatWeb(m: string): { status: number; pesan: string } {
  const peta: [RegExp, number, string][] = [
    [/PERAN_TIDAK_BERWENANG/, 403, "Tidak berwenang untuk aksi ini."],
    [/HOD_TIDAK_BERWENANG/, 403, "Rencana ini bukan wewenang kursi HOD Anda."],
    [/BUKAN_JALUR_CEPAT/, 409, "Rencana sudah tidak di jalur cepat — putusan HOD tidak berlaku lagi."],
    [/BUKAN_JALUR_FORUM/, 409, "Rencana tidak sedang menunggu forum."],
    [/BELUM_DIAGENDAKAN/, 409, "Rencana belum masuk agenda forum."],
    [/BELUM_ADA_USULAN_KOMITE/, 409, "Belum ada usulan komite untuk diputus."],
    [/MANDAT_TIDAK_LENGKAP/, 400, "Mandat wajib lengkap: lantai, pembuka, tenor, capex, volume minimum."],
    [/MANDAT_KEDALUWARSA/, 409, "Mandat sudah kedaluwarsa — tarik kembali ke forum."],
    [/TIDAK_ADA_MANDAT/, 409, "Belum ada mandat negosiasi — penawaran tidak boleh terbit."],
    [/KELUAR_MANDAT/, 409, "Di luar batas mandat (di bawah harga lantai atau melebihi batas lain)."],
    [/GRUP_DIBEKUKAN/, 409, "Grup faskes ini dibekukan (SK Pasal 14/16) — tidak ada belanja modal baru."],
    [/NOMOR_SERI_WAJIB/, 400, "Nomor seri alat wajib diisi."],
    [/TRANSISI_TIDAK_SAH/, 409, "Aksi ini tidak berlaku untuk status rencana sekarang."],
  ];
  for (const [re, status, pesan] of peta) if (re.test(m)) return { status, pesan };
  return { status: 500, pesan: "Aksi gagal diproses. Coba lagi atau hubungi admin." };
}

export async function jalankanAksi(userId: string, id: number, aksi: AksiKso, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const salah = validasiAksi(aksi, b);
  if (salah) throw new GalatKso(400, salah);
  const tab = AKSI_TAB[aksi];
  try {
    return await sebagaiPengguna(userId, tab, "edit", async (tx) => {
      switch (aksi) {
        case "putus-hod": {
          const [r] = await tx`select kso.app_putus_hod(${id}, ${String(b.keputusan)}, ${teks(b.catatan)})::text as status`;
          return { status: r.status };
        }
        case "pendapat-hod":
          await tx`select kso.app_pendapat_hod(${id}, ${teks(b.catatan)})`;
          return { ok: true };
        case "usulkan": {
          const [f] = await tx`select ai.forum_id from kso.agenda_item ai join kso.forum f on f.id = ai.forum_id
                                where ai.rencana_id = ${id} order by f.tanggal desc limit 1`;
          if (!f) throw new GalatKso(409, "Rencana belum masuk agenda forum.");
          const syarat = teks(b.syarat) ? [{ isi: teks(b.syarat), tipe: "masuk_pks" }] : null;
          await tx`select kso.app_usulkan(${id}, ${f.forum_id}, ${String(b.usulan)}::kso.usulan_komite, ${syarat ? tx.json(syarat as never) : null},
                                          ${teks(b.data_kurang)}, ${teks(b.pemilik)}, ${tanggal(b.tanggal_kembali)}, ${teks(b.alasan)}, null)`;
          return { ok: true };
        }
        case "tarik":
          await tx`select kso.app_tarik_ke_forum(${id}, ${teks(b.alasan)})`;
          return { ok: true };
        case "putus-direksi": {
          const dilarang = Array.isArray(b.klausul_dilarang) ? b.klausul_dilarang.map(String) : [];
          const [r] = await tx`select kso.app_putus_direksi(${id}, ${String(b.putusan)}::kso.putusan_direksi, ${teks(b.catatan)},
                     ${angka(b.lantai)}, ${angka(b.target)}, ${angka(b.tenor_maks)}, ${angka(b.capex_maks)}, ${angka(b.volume_min)}, ${dilarang})::text as status`;
          return { status: r.status };
        }
        case "pks":
          await tx`select kso.app_catat_pks(${id}, ${angka(b.harga_deal)})`;
          return { ok: true };
        case "penawaran":
          await tx`select kso.app_terbitkan_penawaran(${id}, ${angka(b.harga)})`;
          return { ok: true };
        case "kalah":
          await tx`select kso.app_catat_kalah(${id}, ${teks(b.alasan)})`;
          return { ok: true };
        case "serah-terima":
          await tx`select kso.app_serah_terima(${id}, ${teks(b.nomor_seri)}, ${tanggal(b.tanggal)})`;
          return { ok: true };
      }
    });
  } catch (e) {
    if (e instanceof GalatKso) throw e;
    const t = terjemahGalatWeb((e as Error).message);
    throw new GalatKso(t.status, t.pesan);
  }
}
