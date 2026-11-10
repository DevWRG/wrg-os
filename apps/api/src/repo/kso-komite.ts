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
import { daftarKurang, type CocokIsian, type ItemKurang } from "./kso-format.js";
import { saringDaftarFilter, saringDaftarTab, saringDetail, type ModeSaring } from "./kso-saring.js";

export type TabKso = "saya" | "hod" | "agenda" | "direksi" | "sekretariat" | "penawaran" | "teknik" | "kpi";
type PeranKso = "am" | "hod" | "komite" | "direksi" | "sekretaris" | "admin_sales" | "teknik";

/** SATU sumber peta tab → fitur Akses Grup → peran database. Kunci fitur = NavItem.features di web. */
export const TAB_KSO: Record<TabKso, { fitur: string; peran: PeranKso; label: string }> = {
  saya: { fitur: "kso-komite", peran: "am", label: "Rencana Saya" },
  hod: { fitur: "kso-komite-hod", peran: "hod", label: "HOD" },
  agenda: { fitur: "kso-komite-agenda", peran: "komite", label: "Agenda Forum" },
  direksi: { fitur: "kso-komite-direksi", peran: "direksi", label: "Putusan Direksi" },
  sekretariat: { fitur: "kso-komite-sekretariat", peran: "sekretaris", label: "Sekretariat" },
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
  if (eff.superuser) return true;
  // Putusan Direksi TIDAK ikut konvensi "admin lolos semua" (keputusan Direktur 20 Okt): role admin
  // dipakai juga oleh HOD (Mufid), jadi tab ini hanya lewat centang Akses Grup / role direktur.
  if (u.role === "admin" && tab !== "direksi") return true;
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

// ---------------------------------------------------------------- siapa boleh melihat margin & HPP (10 Nov 2026)

/** Tab yang pemegangnya memang melihat angka (Komite, Sekretariat, Direksi; KPI = Komite). */
const TAB_BERANGKA: TabKso[] = ["agenda", "sekretariat", "direksi", "kpi"];

/** Bahan keputusan "boleh melihat margin/HPP" untuk satu pengguna. */
export interface KonteksAngka {
  superuser: boolean;
  role: string | null;
  am_id: string | null;
  /** Jenis kursi HOD milik akun (kso.hod.jenis): 'bisnis' = HOD Business, 'area' = HOD Sales. Bisa lebih dari satu. */
  jenisHod: string[];
  /** Tab Komite KSO yang boleh dilihat akun ini (putuskanIzin view). */
  tabLihat: TabKso[];
  /** Finance pengisi angka Bottom Line / pemegang real bottom (kso-komite-bottomline-angka ubah, -real). */
  pengisiAngka?: boolean;
}

/**
 * Keputusan product owner 10 Nov: yang boleh melihat margin & HPP hanya HOD Business, Komite, Sekretariat, Direksi
 * (+ superuser, role admin/direktur, Finance pengisi angka). Akun yang memegang KEDUA kursi HOD (Sales & Business)
 * = HOD Business (boleh).
 */
export function bolehLihatAngka(k: KonteksAngka): boolean {
  if (k.superuser || k.role === "admin" || k.role === "direktur") return true;
  if (k.jenisHod.includes("bisnis")) return true;
  if (k.tabLihat.some((t) => TAB_BERANGKA.includes(t))) return true;
  return !!k.pengisiAngka;
}

/**
 * Penyaring respons untuk satu tab. Tab AM selalu disaring (tab milik AM sendiri). Tab HOD, Admin Sales, Teknik
 * disaring kecuali akunnya berhak (bolehLihatAngka) — akun yang juga Komite melihat angka yang sama di tab Agenda.
 * Admin Sales tetap menerima harga pembuka mandat (harga di penawaran yang mereka terbitkan).
 */
export function modeSaringTab(tab: TabKso, k: KonteksAngka): ModeSaring | null {
  const peran = TAB_KSO[tab].peran;
  if (peran === "am") return "semua";
  if (peran === "komite" || peran === "direksi" || peran === "sekretaris") return null;
  if (bolehLihatAngka(k)) return null;
  return peran === "admin_sales" ? "pembuka" : "semua";
}

/** Bottom Line Alat (biaya, HPP, GPM per model) tertutup untuk AM, HOD Sales, Admin Sales — walau grupnya diberi centang lihat. */
export function bottomLineTerbatas(k: KonteksAngka): boolean {
  if (bolehLihatAngka(k)) return false;
  return !!k.am_id || k.jenisHod.length > 0 || k.tabLihat.includes("penawaran") || k.tabLihat.includes("hod") || k.tabLihat.includes("saya");
}

/**
 * Jenis kursi HOD akun: app_user.hod_key DAN kso.hod_akun (keduanya, bukan coalesce — akun yang punya kursi Sales dan
 * Business dihitung Business). Sumber = kso.hod.jenis (disegarkan malam dari master_hod.peran "Sales …"/"Business …");
 * cadangan master_hod.peran bila kursinya belum ada di kso.hod. Galat = [] (tertutup: diperlakukan bukan HOD Business).
 */
export async function jenisKursiHod(userId: string): Promise<string[]> {
  try {
    const rows = await db()`
      SELECT DISTINCT COALESCE(h.jenis::text, CASE WHEN mh.peran ~* '^business' THEN 'bisnis' WHEN mh.peran ~* '^sales' THEN 'area' END) AS jenis
        FROM (SELECT NULLIF(btrim(u.hod_key), '') AS k FROM app_user u WHERE u.id::text = ${userId}
              UNION SELECT ha.hod_id FROM kso.hod_akun ha WHERE ha.user_id = ${userId}) s
        LEFT JOIN kso.hod h ON h.id = s.k LEFT JOIN master_hod mh ON mh.hod_key = s.k
       WHERE s.k IS NOT NULL`;
    return rows.map((r) => r.jenis).filter((j): j is string => typeof j === "string");
  } catch {
    return [];
  }
}

/** Susun KonteksAngka dari pengguna + izin efektif (satu kueri kursi HOD). */
export async function konteksAngka(u: PenggunaKso, eff: Effective, pengisiAngka = false): Promise<KonteksAngka> {
  return {
    superuser: eff.superuser, role: u.role, am_id: u.am_id, jenisHod: await jenisKursiHod(u.id),
    tabLihat: SEMUA_TAB.filter((t) => putuskanIzin(u, eff, t, "view")), pengisiAngka,
  };
}

export class GalatKso extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function bacaPengguna(userId: string): Promise<PenggunaKso | null> {
  // Kursi HOD: app_user.hod_key bila ada, kalau tidak dari tautan khusus KSO (migrasi 233).
  // hod_key app_user TIDAK diisi sebagai gantinya: kolom itu juga menentukan cakupan data di
  // semua menu (resolveScope) — keputusan user 17 Okt.
  const [u] = await db()`
    SELECT u.id::text, u.name, u.role, u.am_id,
           COALESCE(NULLIF(u.hod_key, ''), (SELECT ha.hod_id FROM kso.hod_akun ha WHERE ha.user_id = u.id::text)) AS hod_key
      FROM app_user u WHERE u.id::text = ${userId} AND u.active`;
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
async function sebagaiPengguna<T>(userId: string, tab: TabKso, aksi: Action, fn: (tx: Tx, u: PenggunaKso, eff: Effective) => Promise<T>): Promise<T> {
  const u = await bacaPengguna(userId);
  if (!u) throw new GalatKso(401, "Sesi tidak dikenal.");
  const eff = await effectivePermissions(userId);
  if (!putuskanIzin(u, eff, tab, aksi))
    throw new GalatKso(403, aksi === "view" ? `Tidak punya akses ke tab ${TAB_KSO[tab].label}.` : `Tidak berwenang bertindak di tab ${TAB_KSO[tab].label}.`);
  const r = refUntuk(u, tab);
  if (!r.ok) throw new GalatKso(403, r.pesan);
  return (await db().begin(async (tx) => {
    // Selalu sebagai wrg_app: di prod koneksinya memang wrg_app, tapi di dev (socket, superuser)
    // RLS & pagar fungsi terlewati — uji dev 16 Okt: pita ringkasan AM menampilkan angka seluruh
    // perusahaan. SET LOCAL ROLE membuat dev = prod dan lapisan database selalu berlaku.
    await tx`set local role wrg_app`;
    await tx`select set_config('wrg.kso_user', ${u.id}, true), set_config('wrg.kso_peran', ${TAB_KSO[tab].peran}, true),
                    set_config('wrg.kso_ref', ${r.ref ?? ""}, true)`;
    return fn(tx as unknown as Tx, u, eff);
  })) as T;
}

// ---------------------------------------------------------------- baca

const ANTREAN: Record<Exclude<TabKso, "kpi">, string[]> = {
  saya: ["AM · Rencana Saya"],
  hod: ["HOD · Minta Putusan", "HOD · Minta Pendapat"],
  agenda: ["Komite · Agenda Forum", "Komite · Mandat Kedaluwarsa"],
  direksi: ["Direksi · Putusan"],
  sekretariat: ["Sekretariat · Terbitkan Penawaran", "Sekretariat · Cocokkan PKS"],
  penawaran: ["Admin Sales · Terbitkan Penawaran"],
  teknik: ["Teknik · Jadwal Pasang"],
};

/** Penyaring margin/HPP untuk tab ini (null = tampil apa adanya). Dihitung di luar transaksi peran. */
async function modeUntuk(u: PenggunaKso, eff: Effective, tab: TabKso): Promise<ModeSaring | null> {
  const peran = TAB_KSO[tab].peran;
  if (peran === "komite" || peran === "direksi" || peran === "sekretaris") return null;
  return modeSaringTab(tab, await konteksAngka(u, eff));
}

export async function daftarTab(userId: string, tab: TabKso): Promise<Record<string, unknown>> {
  return sebagaiPengguna(userId, tab, "view", async (tx, u, eff) => {
    const mode = await modeUntuk(u, eff, tab);
    const saring = (d: Record<string, unknown>) => (mode ? saringDaftarTab(d, mode) : d);
    const [ringkasan] = await tx`select * from kso.v_ringkasan`;
    if (tab === "kpi") {
      const kpi = await tx`select * from kso.v_kpi_am order by periode desc, am_nama`;
      return saring({ tab, ringkasan, kpi });
    }
    const label = ANTREAN[tab];
    const pemilik = tab === "saya" ? u.am_id : tab === "hod" ? u.hod_key : null;
    const baris = await tx`
      select a.antrean, a.rencana_id::int as id, a.nomor, a.status, a.faskes_nama, a.alat_nama, a.capex::float8 as capex,
             a.sejak, a.batas, v.am_nama, v.cabang, v.jalur::text as jalur, v.pola_gerbang, v.gerbang_merah, v.volume_sumber,
             r.zona, r.gpm_deal::float8 as gpm_deal, r.volume_terverifikasi
        from kso.v_antrean a join kso.v_rencana v on v.id = a.rencana_id join kso.rencana_kso r on r.id = a.rencana_id
       where a.antrean = any(${label}) and (${pemilik}::text is null or a.pemilik_id = ${pemilik})
       order by a.batas nulls last, a.sejak desc`;
    const agenda = tab === "agenda"
      ? await tx`select forum_id::int, tanggal::text, hari, mode::text, jenis, urut, rencana_id::int, nomor, am_nama, faskes_nama,
                        alat_nama, capex::float8 as capex, pola_gerbang, gerbang_merah, status, pendapat_hod_masuk::int
                   from kso.v_agenda where tanggal >= kso.hari_ini() - 14 order by tanggal desc, jenis, urut`
      : [];
    // F170 v2 (Pedoman): bukti volume zona Forum & Direktur menunggu verifikasi Sekretaris
    const verifikasi = tab === "sekretariat"
      ? await tx`select 'Sekretariat · Verifikasi Volume' as antrean, r.id::int as id, v.nomor, v.status::text as status, v.faskes_nama,
                        v.alat_nama, v.capex::float8 as capex, r.diajukan_at as sejak, null::timestamptz as batas, v.am_nama, v.cabang,
                        v.jalur::text as jalur, v.pola_gerbang, v.gerbang_merah, v.volume_sumber,
                        r.zona, r.gpm_deal::float8 as gpm_deal, r.volume_terverifikasi
                   from kso.rencana_kso r join kso.v_rencana v on v.id = r.id
                  where r.zona in ('forum','direktur') and r.volume_terverifikasi is null and r.volume_sumber_label = 'data'
                    and r.status in ('DIAJUKAN','JALUR_FORUM','DIAGENDAKAN')
                  order by r.diajukan_at`
      : [];
    return saring({ tab, ringkasan, baris, agenda, verifikasi });
  });
}

export async function detailRencana(userId: string, tab: TabKso, id: number): Promise<Record<string, unknown>> {
  let mode = null as ModeSaring | null;
  const d = await sebagaiPengguna(userId, tab, "view", async (tx, u, eff) => {
    mode = await modeUntuk(u, eff, tab);
    const [r] = await tx`select *, capex::float8 as capex from kso.v_rencana where id = ${id}`;
    if (!r) throw new GalatKso(404, "Rencana tidak ada, atau di luar akses tab ini.");
    // isi PKS (migrasi 242) tidak ada di v_rencana — dibaca dari tabelnya (RLS boleh_lihat sama)
    const [pks] = await tx`select harga_deal::float8 as harga_deal, pks_tenor_bulan, pks_volume_minimum, pks_klausul,
                                  zona, zona_dasar, gpm_deal::float8 as gpm_deal, alasan_strategis, harga_pesaing::float8 as harga_pesaing,
                                  volume_terverifikasi, volume_verifikasi_catatan, volume_verifikasi_at::text as volume_verifikasi_at,
                                  hari_kerja, coalesce((select p.hari_kerja from public.kso_bottomline_parameter p where p.id = 1), 25)::int as hari_kerja_default,
                                  fee_persen::float8 as fee_persen, klausul_ada, klausul_detail, kompetitor_alat,
                                  (harga_per_test * (1 - coalesce(fee_persen, 0) / 100))::float8 as harga_bersih
                             from kso.rencana_kso where id = ${id}`;
    Object.assign(r, pks ?? {});
    // angka GPM per zona (268) — hanya untuk rencana yang boleh dilihat peran tab ini
    const [angkaGpm] = await tx`select gpm::float8, zona, hd, catatan, biaya_per_tes::float8, harga_am::float8, harga_hod::float8,
                                       harga_forum::float8, volume_min_forum::float8 from kso.app_angka_gpm(${id})`;
    const [gerbang, pendukung, klausul, pendapat, mandat, usulan, putusan, riwayat, agendaItem, klausulKhusus] = await Promise.all([
      tx`select no, nama, status::text, nilai from kso.gerbang_hasil where rencana_id = ${id} order by no`,
      tx`select nama, tipe::text, sip_faskes, kontak_terakhir_tanggal::text, kontak_terakhir_cara::text from kso.rencana_pendukung where rencana_id = ${id} order by id`,
      tx`select k.kode, k.label from kso.rencana_klausul rk join kso.klausul_khusus k on k.kode = rk.klausul_kode where rk.rencana_id = ${id}`,
      tx`select p.hod_id, h.nama as hod_nama, p.jenis, p.keputusan, p.catatan, p.dianggap_setuju, p.at::text
           from kso.pendapat_hod p left join kso.hod h on h.id = p.hod_id where p.rencana_id = ${id} order by p.at`,
      tx`select harga_lantai::float8, harga_target::float8, harga_pembuka::float8, volume_terbukti, tenor_maks_bulan, capex_maks::float8,
                volume_minimum, klausul_dilarang, klausul_wajib, berlaku_sampai::text, sumber from kso.mandat where rencana_id = ${id}`,
      tx`select usulan::text, syarat, mandat_usulan, data_kurang, pemilik, tanggal_kembali::text, alasan, at::text from kso.usulan_komite_catatan where rencana_id = ${id} order by at`,
      tx`select putusan::text, catatan, at::text from kso.putusan_direksi_catatan where rencana_id = ${id}`,
      tx`select s.dari::text, s.ke::text, s.oleh, s.oleh_peran, s.oleh_user, s.at::text
           from kso.riwayat_status s where s.rencana_id = ${id} order by s.at`,
      tx`select ai.forum_id::int, f.tanggal::text from kso.agenda_item ai join kso.forum f on f.id = ai.forum_id where ai.rencana_id = ${id} order by f.tanggal desc limit 1`,
      // pilihan centang form PKS: klausul khusus RS (yang "tanpa_*" = kebalikan perlindungan wajib, tak perlu dicentang)
      tx`select kode, label from kso.klausul_khusus where kode not like 'tanpa%' order by urut`,
    ]);
    // 302: lampiran PDF Simulator CPRR (terbaru dulu) + daftar "Belum lengkap" (sumber sama dengan balasan WA)
    const lampiran = await tx`select id::int, wa_message_id, lolos, cocok, hasil_ocr->'isian' as isian, hasil_ocr->>'galat' as galat,
                                     coalesce((hasil_ocr->>'ok')::boolean, false) as ok, hasil_ocr->'peringatan' as peringatan,
                                     hasil_ocr->'isian'->>'tanggal' as tanggal, dibuat_at::text, media_path is not null as ada_berkas
                                from kso.rencana_lampiran where rencana_id = ${id} order by dibuat_at desc, id desc`;
    const [kd] = await bahanKurang(tx, [id]);
    return { rencana: r, gerbang, pendukung, klausul, pendapat, mandat: mandat[0] ?? null, usulan, putusan: putusan[0] ?? null, riwayat,
             forum: agendaItem[0] ?? null, klausul_khusus: klausulKhusus, angka_gpm: angkaGpm ?? null,
             lampiran_terakhir: lampiran[0] ?? null, lampiran, kurang: kd ? kurangDari(kd) : [] };
  });
  // Nama pelaku dibaca DI LUAR transaksi peran (koneksi biasa API): wrg_app tak dijamin boleh
  // membaca app_user di setiap lingkungan, dan nama akun bukan data KSO yang perlu RLS.
  const riwayat = d.riwayat as unknown as { oleh_user: string | null }[];
  const ids = [...new Set(riwayat.map((h) => h.oleh_user).filter((x): x is string => !!x))];
  const nama = new Map<string, string>();
  if (ids.length) for (const u of await db()`SELECT id::text, name FROM app_user WHERE id::text = ANY(${ids})`) nama.set(String(u.id), String(u.name));
  d.riwayat = riwayat.map(({ oleh_user, ...h }) => ({ ...h, oleh_nama: oleh_user ? nama.get(oleh_user) ?? null : null })) as never;
  return mode ? saringDetail(d, mode) : d;
}

// ---------------------------------------------------------------- 302: belum lengkap · lolos tanpa forum · berkas PDF

interface BarisKurang {
  id: number; status: string; volume_estimasi: number | null; tenor_bulan: number | null; harga_per_test: number | null;
  fee_persen: number | null; kolom_dinyatakan: string[]; klausul_ada: boolean | null; klausul_detail: string | null;
  pendukung: { nama: string; tipe: string }[]; unit_status: string | null; volume_sumber: string | null; zona_dasar: string | null;
  alasan_strategis: string | null; hd: boolean | null;
  lampiran: { lolos: boolean; cocok: Record<string, CocokIsian> | null; galat: string | null } | null;
}

/** Bahan daftarKurang per rencana (RLS peran tab berlaku: hanya rencana yang boleh dilihat). */
async function bahanKurang(tx: Tx, ids: number[]): Promise<BarisKurang[]> {
  if (!ids.length) return [];
  return (await tx`
    select r.id::int, r.status::text, r.volume_estimasi, r.tenor_bulan, r.harga_per_test::float8, r.fee_persen::float8, r.kolom_dinyatakan,
           r.klausul_ada, r.klausul_detail, r.unit_status::text, r.volume_sumber, r.zona_dasar, r.alasan_strategis,
           coalesce((select json_agg(json_build_object('nama', p.nama, 'tipe', p.tipe)) from kso.rencana_pendukung p where p.rencana_id = r.id), '[]') as pendukung,
           (select g.hd from kso.app_angka_gpm(r.id) g) as hd,
           (select json_build_object('lolos', l.lolos, 'cocok', l.cocok,
                                     'galat', case when coalesce((l.hasil_ocr->>'ok')::boolean, false) then null
                                                   else coalesce(l.hasil_ocr->>'galat', 'tidak-terbaca') end)
              from kso.rencana_lampiran l where l.rencana_id = r.id order by l.dibuat_at desc, l.id desc limit 1) as lampiran
      from kso.rencana_kso r where r.id = any(${ids})`) as unknown as BarisKurang[];
}
const kurangDari = (b: BarisKurang): ItemKurang[] =>
  daftarKurang({ ...b, angka: b.hd == null ? null : { hd: b.hd } }, `D${b.id}`);

export type FilterKso = "belum-lengkap" | "lolos-tanpa-forum";
export function isFilterKso(f: string): f is FilterKso {
  return f === "belum-lengkap" || f === "lolos-tanpa-forum";
}

/**
 * Daftar per filter, dalam akses tab (AM = miliknya, Komite/Sekretariat/Direksi = semua; RLS boleh_lihat):
 *   belum-lengkap     : DRAFT/DITAHAN yang daftar kurangnya tidak kosong (+ kurang per baris)
 *   lolos-tanpa-forum : DIPUTUS_AM (zona AM, mandat otomatis) dan DIPUTUS_HOD (jalur cepat) + mandatnya
 */
export async function daftarFilter(userId: string, tab: TabKso, filter: FilterKso): Promise<Record<string, unknown>> {
  return sebagaiPengguna(userId, tab, "view", async (tx, u, eff) => {
    const mode = await modeUntuk(u, eff, tab);
    const saring = (d: Record<string, unknown>) => (mode ? saringDaftarFilter(d, mode) : d);
    const status = filter === "belum-lengkap" ? ["DRAFT", "DITAHAN"] : ["DIPUTUS_AM", "DIPUTUS_HOD"];
    const baris = await tx`
      select r.id::int, r.nomor, r.status::text, r.jalur::text as jalur, v.am_nama, v.cabang, v.faskes_nama, v.alat_nama,
             r.zona, r.zona_dasar, r.gpm_deal::float8 as gpm_deal, r.harga_per_test::float8 as harga_per_test, r.fee_persen::float8 as fee_persen,
             (r.harga_per_test * (1 - coalesce(r.fee_persen, 0) / 100))::float8 as harga_bersih, r.volume_estimasi, r.tenor_bulan,
             r.dibuat_at::text, r.diajukan_at::text, r.diubah_at::text,
             (select json_build_object('id', l.id, 'lolos', l.lolos, 'tanggal', l.hasil_ocr->'isian'->>'tanggal', 'dibuat_at', l.dibuat_at)
                from kso.rencana_lampiran l where l.rencana_id = r.id order by l.dibuat_at desc, l.id desc limit 1) as lampiran,
             (select json_build_object('harga_pembuka', m.harga_pembuka, 'harga_target', m.harga_target, 'harga_lantai', m.harga_lantai,
                                       'volume_terbukti', m.volume_terbukti, 'berlaku_sampai', m.berlaku_sampai, 'sumber', m.sumber)
                from kso.mandat m where m.rencana_id = r.id) as mandat
        from kso.rencana_kso r join kso.v_rencana v on v.id = r.id
       where r.status::text = any(${status})
       order by coalesce(r.diajukan_at, r.diubah_at) desc
       limit 500`;
    if (filter === "lolos-tanpa-forum") return saring({ tab, filter, baris });
    const bahan = new Map((await bahanKurang(tx, baris.map((b) => Number(b.id)))).map((b) => [b.id, b]));
    const isi = baris.map((b) => ({ ...b, kurang: bahan.has(Number(b.id)) ? kurangDari(bahan.get(Number(b.id))!) : [] }))
      .filter((b) => b.kurang.length > 0);
    return saring({ tab, filter, baris: isi });
  });
}

/** Path berkas PDF lampiran — hanya bila rencananya boleh dilihat peran tab ini (RLS). API yang menyajikan berkasnya. */
export async function berkasLampiran(userId: string, tab: TabKso, id: number, lampiranId: number): Promise<string> {
  return sebagaiPengguna(userId, tab, "view", async (tx, u, eff) => {
    // PDF Simulator memuat capex, reagen, QC, base cost, CPRR per tes (HPP) → hanya untuk yang berhak melihat angka
    if (await modeUntuk(u, eff, tab)) throw new GalatKso(403, "Berkas PDF Simulator memuat angka biaya — tidak dibuka untuk tab ini.");
    const [l] = await tx`select media_path from kso.rencana_lampiran where id = ${lampiranId} and rencana_id = ${id}`;
    if (!l?.media_path) throw new GalatKso(404, "Lampiran tidak ada, atau di luar akses tab ini.");
    return String(l.media_path);
  });
}

// ---------------------------------------------------------------- aksi

export type AksiKso =
  | "putus-hod" | "pendapat-hod" | "usulkan" | "tarik" | "putus-direksi" | "pks" | "penawaran" | "kalah" | "serah-terima"
  | "verifikasi-volume";

/**
 * Aksi → tab yang berwenang, urut prioritas. Satu aksi bisa dari lebih dari satu tab (penawaran &
 * kalah: Sekretariat atau Admin Sales cadangan); API memakai tab PERTAMA yang boleh "edit" bagi user.
 * PKS hanya Sekretariat (keputusan 21 Okt: dipindah total dari Direksi).
 */
export const AKSI_TAB: Record<AksiKso, TabKso[]> = {
  "putus-hod": ["hod"],
  "pendapat-hod": ["hod"],
  usulkan: ["agenda"],
  tarik: ["agenda"],
  "putus-direksi": ["direksi"],
  pks: ["sekretariat"],
  penawaran: ["sekretariat", "penawaran"],
  kalah: ["sekretariat", "penawaran"],
  "serah-terima": ["teknik"],
  // F170 v2 (268/266): bukti volume zona Forum & Direktur — Sekretaris
  "verifikasi-volume": ["sekretariat"],
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
      if (!angka(b.harga_deal)) return "Harga per test di PKS wajib diisi.";
      if (!angka(b.tenor_bulan)) return "Tenor di PKS (bulan) wajib diisi.";
      if (angka(b.volume_minimum) === null) return "Volume minimum di PKS wajib diisi.";
      if (!Array.isArray(b.klausul)) return "Centang klausul yang ada di naskah PKS.";
      return null;
    case "penawaran":
      return angka(b.harga) ? null : "Harga penawaran wajib diisi.";
    case "kalah":
      return teks(b.alasan) ? null : "Alasan kalah wajib diisi.";
    case "serah-terima":
      return teks(b.nomor_seri) ? null : "Nomor seri alat wajib diisi.";
    case "verifikasi-volume":
      if (typeof b.sah !== "boolean") return "Pilih: bukti sah atau ditolak.";
      return b.sah || teks(b.catatan) ? null : "Bukti ditolak wajib disertai alasan.";
  }
}

/** Label manusia untuk kode klausul (perlindungan wajib WRG + klausul khusus RS, migrasi 228/242). */
export const LABEL_KLAUSUL: Record<string, string> = {
  eskalasi_tahunan: "kenaikan harga tahunan",
  lapor_test: "kewajiban lapor jumlah test",
  denda_telat: "denda keterlambatan bayar",
  eksklusivitas: "eksklusivitas",
  jaminan_volume: "jaminan volume",
  alat_jatuh: "alat jatuh ke RS",
  draft_rs: "draft PKS dari RS",
};
const labelKlausul = (t: string) => t.replace(/[a-z]+(?:_[a-z]+)+|eksklusivitas/g, (k) => LABEL_KLAUSUL[k] ?? k);

/** Galat database → kalimat untuk layar. Kode galat tak pernah sampai ke pengguna. */
export function terjemahGalatWeb(m: string): { status: number; pesan: string } {
  // rincian ketidakcocokan PKS ikut tampil (tanpa kode): Sekretaris perlu tahu bagian mana yang salah
  const pks = /PKS_TIDAK_COCOK: (.+)$/.exec(m.split("\n")[0]);
  if (pks) return { status: 409, pesan: `PKS tidak cocok dengan putusan — ${labelKlausul(pks[1])}. Tidak boleh ditandatangani.` };
  const peta: [RegExp, number, string][] = [
    [/PERAN_TIDAK_BERWENANG/, 403, "Tidak berwenang untuk aksi ini."],
    [/HOD_TIDAK_BERWENANG/, 403, "Rencana ini bukan wewenang kursi HOD Anda."],
    [/BUKAN_JALUR_CEPAT/, 409, "Rencana sudah tidak di jalur cepat — putusan HOD tidak berlaku lagi."],
    [/BUKAN_JALUR_FORUM/, 409, "Rencana tidak sedang menunggu forum."],
    [/BELUM_DIAGENDAKAN/, 409, "Rencana belum masuk agenda forum."],
    [/BELUM_ADA_USULAN_KOMITE/, 409, "Belum ada usulan komite untuk diputus."],
    [/MANDAT_TIDAK_LENGKAP/, 400, "Mandat wajib lengkap: lantai, pembuka, tenor, capex, volume minimum."],
    [/MANDAT_URUTAN_HARGA/, 400, "Urutan harga mandat salah: harga pembuka ≥ target ≥ batas bawah."],
    [/MANDAT_KEDALUWARSA/, 409, "Mandat sudah kedaluwarsa — tarik kembali ke forum."],
    [/TIDAK_ADA_MANDAT/, 409, "Belum ada mandat negosiasi — penawaran tidak boleh terbit."],
    [/KELUAR_MANDAT/, 409, "Di luar batas mandat (di bawah harga lantai atau melebihi batas lain)."],
    [/GRUP_DIBEKUKAN/, 409, "Grup faskes ini dibekukan (SK Pasal 14/16) — tidak ada belanja modal baru."],
    [/NOMOR_SERI_WAJIB/, 400, "Nomor seri alat wajib diisi."],
    [/PKS_TIDAK_LENGKAP/, 400, "Harga per test, tenor, dan volume minimum di PKS wajib diisi."],
    [/TRANSISI_TIDAK_SAH/, 409, "Aksi ini tidak berlaku untuk status rencana sekarang."],
    [/BUKAN_TAHAP_VERIFIKASI/, 409, "Bukti volume hanya bisa diverifikasi sebelum putusan."],
    [/ALASAN_WAJIB/, 400, "Bukti ditolak wajib disertai alasan."],
  ];
  for (const [re, status, pesan] of peta) if (re.test(m)) return { status, pesan };
  return { status: 500, pesan: "Aksi gagal diproses. Coba lagi atau hubungi admin." };
}

/** Tab pertama (urut AKSI_TAB) tempat user boleh menjalankan aksi; tanpa tab = tab pertama (ditolak 403). */
async function tabUntukAksi(userId: string, aksi: AksiKso): Promise<TabKso> {
  const daftar = AKSI_TAB[aksi];
  if (daftar.length === 1) return daftar[0];
  const u = await bacaPengguna(userId);
  if (!u) return daftar[0];
  const eff = await effectivePermissions(userId);
  return daftar.find((t) => putuskanIzin(u, eff, t, "edit") && refUntuk(u, t).ok) ?? daftar[0];
}

export async function jalankanAksi(userId: string, id: number, aksi: AksiKso, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const salah = validasiAksi(aksi, b);
  if (salah) throw new GalatKso(400, salah);
  const tab = await tabUntukAksi(userId, aksi);
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
                     ${angka(b.lantai)}, ${angka(b.target)}, ${angka(b.tenor_maks)}, ${angka(b.capex_maks)}, ${angka(b.volume_min)}, ${dilarang},
                     ${angka(b.pembuka)})::text as status`;
          return { status: r.status };
        }
        case "pks": {
          const klausul = (b.klausul as unknown[]).map(String).filter((k) => /^[a-z_]{2,40}$/.test(k));
          await tx`select kso.app_cocokkan_pks(${id}, ${angka(b.harga_deal)}, ${angka(b.tenor_bulan)}, ${angka(b.volume_minimum)}, ${klausul})`;
          return { ok: true };
        }
        case "penawaran":
          await tx`select kso.app_terbitkan_penawaran(${id}, ${angka(b.harga)})`;
          return { ok: true };
        case "kalah":
          await tx`select kso.app_catat_kalah(${id}, ${teks(b.alasan)})`;
          return { ok: true };
        case "serah-terima":
          await tx`select kso.app_serah_terima(${id}, ${teks(b.nomor_seri)}, ${tanggal(b.tanggal)})`;
          return { ok: true };
        case "verifikasi-volume":
          await tx`select kso.app_verifikasi_volume(${id}, ${b.sah === true}, ${teks(b.catatan)})`;
          return { ok: true };
      }
    });
  } catch (e) {
    if (e instanceof GalatKso) throw e;
    const t = terjemahGalatWeb((e as Error).message);
    throw new GalatKso(t.status, t.pesan);
  }
}
