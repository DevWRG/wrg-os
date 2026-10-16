// F170 Komite KSO — jadwal otomatis & notifikasi (Tahap 5).
//
// Irama forum (spesifikasi bab 6, SK v1.0): Selasa & Kamis
//   14.00 agenda terbit (maks 3 Agenda A) → WA ke Komite + HOD yang diminta pendapat
//   16.00 pendapat HOD yang belum masuk → WA ke Komite
//   17.30 usulan siap diputus → WA ke Direksi (tautan layar Putusan)
//   21.30 pengingat Direksi bila masih ada yang belum diputus (batas 22.00 WIB)
// Tiap jam   : jalur cepat lewat 1 HARI KERJA tanpa putusan HOD → dianggap setuju (migrasi 231)
// Hari kerja 07.00: daftar penawaran siap terbit → WA ke Admin Sales
// Tanggal 6  : verifikasi bulan ke-6 dari laporan tes
// Event      : usulan masuk antrean HOD → WA ke HOD (perlu putusan / perlu pendapat + batasnya)
//
// Penerima = pemegang centang tab di Akses Grup (fitur kso-komite-*), BUKAN daftar nama di kode;
// HOD lewat waHod(). Setiap pesan berkunci di kso.notifikasi_terkirim → tak terkirim dua kali walau
// job berjalan ulang. Semua job memanggil kso.app_job_* sebagai akun mesin 'job-jadwal' (sekretaris),
// di transaksi `SET LOCAL ROLE wrg_app` — pagar database tetap berlaku.
// Fungsi run* menerima `sekarang` supaya bisa disimulasikan dengan tanggal palsu.

import type { TransactionSql } from "postgres";
import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { waHod } from "./hod-wa.js";

export const KSO_JOB_USER = "job-jadwal";
type Tx = TransactionSql<Record<string, unknown>>;

export async function sebagaiJob<T>(fn: (tx: Tx) => Promise<T>, user = KSO_JOB_USER): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`set local role wrg_app`;
    await tx`select set_config('wrg.kso_user', ${user}, true)`;
    return fn(tx as unknown as Tx);
  })) as T;
}

// ---------------------------------------------------------------- waktu (murni)

/** Tanggal WIB (YYYY-MM-DD) dari sebuah Date. */
export function tanggalWib(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tanggalManusia(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${HARI[d.getUTCDay()]} ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`;
}
export function hariForum(iso: string): boolean {
  const g = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return g === 2 || g === 4;
}
/** Forum berikutnya untuk usulan yang masuk pada `sekarang`: Selasa/Kamis; sesudah 14.00 WIB → forum sesudahnya. */
export function forumBerikutnya(sekarang: Date): string {
  const wib = new Date(sekarang.getTime() + 7 * 3600_000);
  const lewat14 = wib.getUTCHours() >= 14;
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + i));
    const iso = d.toISOString().slice(0, 10);
    if (hariForum(iso) && !(i === 0 && lewat14)) return iso;
  }
  return tanggalWib(sekarang);
}
const jamWib = (ts: string | Date | null) =>
  ts ? new Date(ts).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
const rpJt = (n: unknown) => `Rp ${(Number(n) / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
const tautan = () => `${(process.env.WEB_PUBLIC_URL ?? "").replace(/\/$/, "")}/kso-komite`;

// ---------------------------------------------------------------- teks pesan (murni)

export interface ItemAgenda { jenis: string; nomor: string | null; faskes_nama: string; alat_nama: string; capex: number; gerbang_merah: string | null; am_nama: string }

export function pesanAgenda(tgl: string, items: ItemAgenda[]): string {
  const a = items.filter((x) => x.jenis === "A");
  const b = items.filter((x) => x.jenis === "B");
  const out = [`*Agenda Forum Komite KSO — ${tanggalManusia(tgl)}, 16.00 WIB*`];
  if (a.length === 0) out.push("\nTidak ada usulan baru → slot menjadi *tinjauan portofolio* (forum tidak pernah batal).");
  else {
    out.push(`\nAgenda A (${a.length}) — diuji forum:`);
    a.forEach((x, i) => out.push(`${i + 1}. ${x.nomor} · ${x.faskes_nama} · ${x.alat_nama} · ${rpJt(x.capex)}${x.gerbang_merah ? ` · gerbang tak hijau: ${x.gerbang_merah}` : ""} (AM ${x.am_nama})`));
  }
  if (b.length) {
    out.push(`\nAgenda B (${b.length}) — laporan putusan jalur cepat:`);
    b.forEach((x, i) => out.push(`${i + 1}. ${x.nomor} · ${x.faskes_nama} · ${x.alat_nama}`));
  }
  out.push("\nPendapat HOD ditunggu sampai 16.00. Data yang masuk sesudah 14.00 = forum berikutnya.");
  if (tautan() !== "/kso-komite") out.push(tautan());
  return out.join("\n");
}

export function pesanHod(jenis: "putusan" | "pendapat", nama: string, r: { nomor: string | null; faskes_nama: string; alat_nama: string; capex: number }, batas: string): string {
  return jenis === "putusan"
    ? `Halo ${nama}, ada usulan KSO *perlu PUTUSAN* Anda (jalur cepat):\n${r.nomor} · ${r.faskes_nama} · ${r.alat_nama} · ${rpJt(r.capex)}\n` +
        `Buka tab HOD → "Putuskan": Setuju / Tolak / Naikkan ke forum.\nBatas: ${batas}. Lewat batas = dianggap setuju.${tautan() !== "/kso-komite" ? `\n${tautan()}` : ""}`
    : `Halo ${nama}, ada usulan KSO *perlu PENDAPAT* Anda (jalur forum):\n${r.nomor} · ${r.faskes_nama} · ${r.alat_nama} · ${rpJt(r.capex)}\n` +
        `Buka tab HOD → "Beri pendapat" (bukan putusan).\nBatas: ${batas}.${tautan() !== "/kso-komite" ? `\n${tautan()}` : ""}`;
}

export function pesanDaftar(judul: string, baris: { nomor: string | null; faskes_nama: string; alat_nama: string; capex: number }[], penutup: string): string {
  return [`*${judul}* (${baris.length})`, ...baris.map((x, i) => `${i + 1}. ${x.nomor} · ${x.faskes_nama} · ${x.alat_nama} · ${rpJt(x.capex)}`), "", penutup,
    ...(tautan() !== "/kso-komite" ? [tautan()] : [])].join("\n");
}

// ---------------------------------------------------------------- penerima & kirim

export interface Penerima { nama: string; wa: string }

/** Pemegang centang tab (view) di Akses Grup yang punya nomor WA. Grup superuser TIDAK ikut (admin tak dibanjiri). */
export async function penerimaFitur(fitur: string, termasukDirektur = false): Promise<Penerima[]> {
  const rows = await db()`
    SELECT DISTINCT u.name, btrim(u.wa_number) AS wa FROM app_user u
      JOIN app_user_group m ON m.user_id = u.id
      JOIN access_permission ap ON ap.group_id = m.group_id
     WHERE u.active AND NULLIF(btrim(u.wa_number), '') IS NOT NULL
       AND ap.feature_key = ${fitur} AND ap.active AND ap.can_view
    UNION
    SELECT u.name, btrim(u.wa_number) FROM app_user u
     WHERE ${termasukDirektur} AND u.active AND u.role = 'direktur' AND NULLIF(btrim(u.wa_number), '') IS NOT NULL`;
  return rows.map((r) => ({ nama: String(r.name ?? ""), wa: String(r.wa) }));
}

export interface HasilKirim { kunci: string; ke: string; terkirim: boolean; alasan?: string }

/** Kirim satu pesan SEKALI per kunci. Tanda dibatalkan bila tak benar-benar terkirim (dry-run/stub/gagal). */
export async function kirimSekali(kunci: string, jenis: string, ke: string, isi: string): Promise<HasilKirim> {
  const baru = await sebagaiJob(async (tx) => (await tx`select kso.app_job_tandai_notif(${kunci}, ${jenis}) as b`)[0].b === true);
  if (!baru) return { kunci, ke, terkirim: false, alasan: "sudah pernah dikirim" };
  const gw = await sendViaWaGateway(ke, isi);
  const nyata = gw.sent && !gw.stub && !gw.dryRun;
  if (!nyata) await sebagaiJob(async (tx) => { await tx`select kso.app_job_batal_notif(${kunci})`; });
  return { kunci, ke, terkirim: nyata, alasan: nyata ? undefined : gw.dryRun ? "dry-run" : gw.stub ? "stub" : gw.error ?? "gagal" };
}

async function kirimKe(penerima: Penerima[], kunciDasar: string, jenis: string, isi: string): Promise<HasilKirim[]> {
  const out: HasilKirim[] = [];
  for (const p of penerima) out.push(await kirimSekali(`${kunciDasar}:${p.wa}`, jenis, p.wa, isi));
  return out;
}

// ---------------------------------------------------------------- job

const ANTREAN_SQL = (tx: Tx, label: string) => tx`
  select a.rencana_id::int as id, a.nomor, a.faskes_nama, a.alat_nama, a.capex::float8 as capex, a.batas, v.am_nama
    from kso.v_antrean a join kso.v_rencana v on v.id = a.rencana_id where a.antrean = ${label} order by a.sejak`;

/** 14.00 Selasa/Kamis — agenda terbit + WA Komite + HOD yang diminta pendapat atas Agenda A. */
export async function runAgenda(sekarang = new Date()) {
  const tgl = tanggalWib(sekarang);
  if (!hariForum(tgl)) return { tgl, lewati: "bukan Selasa/Kamis" };
  const { items, hod } = await sebagaiJob(async (tx) => {
    const [f] = await tx`select kso.app_job_susun_agenda(${tgl})::int as id`;
    const items = (await tx`select jenis, nomor, faskes_nama, alat_nama, capex::float8 as capex, gerbang_merah, am_nama, rencana_id::int
                              from kso.v_agenda where forum_id = ${f.id} and rencana_id is not null order by jenis, urut`) as unknown as (ItemAgenda & { rencana_id: number })[];
    const hod = await tx`select ai.rencana_id::int, h.hod_id from kso.agenda_item ai cross join lateral kso.hod_untuk(ai.rencana_id) h
                          where ai.forum_id = ${f.id} and ai.jenis = 'A'`;
    return { items, hod };
  });
  const kirim = await kirimKe(await penerimaFitur("kso-komite-agenda"), `agenda:${tgl}`, "agenda", pesanAgenda(tgl, items));
  for (const h of hod) {
    const w = await waHod(String(h.hod_id));
    const it = items.find((x) => x.rencana_id === Number(h.rencana_id));
    if (w && it) kirim.push(await kirimSekali(`hod-pendapat:${h.rencana_id}:${h.hod_id}`, "hod", w.wa, pesanHod("pendapat", w.nama, it, `${tanggalManusia(tgl)} 16.00 WIB`)));
  }
  return { tgl, agenda_a: items.filter((x) => x.jenis === "A").length, agenda_b: items.filter((x) => x.jenis === "B").length, kirim };
}

/** 16.00 Selasa/Kamis — pendapat HOD yang belum masuk untuk Agenda A hari ini → Komite. */
export async function runPendapatBelumMasuk(sekarang = new Date()) {
  const tgl = tanggalWib(sekarang);
  if (!hariForum(tgl)) return { tgl, lewati: "bukan Selasa/Kamis" };
  const kurang = await sebagaiJob(async (tx) => tx`
    select ai.rencana_id::int, r.nomor, f2.nama as faskes_nama, h.hod_id, hh.nama as hod_nama
      from kso.forum fo join kso.agenda_item ai on ai.forum_id = fo.id and ai.jenis = 'A'
      join kso.rencana_kso r on r.id = ai.rencana_id join kso.faskes f2 on f2.id = r.faskes_id
      cross join lateral kso.hod_untuk(ai.rencana_id) h left join kso.hod hh on hh.id = h.hod_id
     where fo.tanggal = ${tgl}
       and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = ai.rencana_id and p.hod_id = h.hod_id)`);
  if (kurang.length === 0) return { tgl, kurang: 0, kirim: [] };
  const isi = [`*Pendapat HOD belum masuk — forum ${tanggalManusia(tgl)} 16.00*`, ...kurang.map((k) => `· ${k.nomor} ${k.faskes_nama}: ${k.hod_nama ?? k.hod_id}`),
    "", "Forum tetap berjalan; catat di forum bahwa pendapat tidak masuk."].join("\n");
  return { tgl, kurang: kurang.length, kirim: await kirimKe(await penerimaFitur("kso-komite-agenda"), `pendapat-kurang:${tgl}`, "komite", isi) };
}

/** 17.30 (daftar) & 21.30 (pengingat) Selasa/Kamis — usulan menunggu putusan Direksi. */
export async function runDireksi(jenis: "daftar" | "pengingat", sekarang = new Date()) {
  const tgl = tanggalWib(sekarang);
  if (!hariForum(tgl)) return { tgl, lewati: "bukan Selasa/Kamis" };
  const baris = await sebagaiJob(async (tx) => ANTREAN_SQL(tx, "Direksi · Putusan"));
  if (baris.length === 0) return { tgl, jumlah: 0, kirim: [] };
  const isi = jenis === "daftar"
    ? pesanDaftar(`Usulan Komite KSO menunggu putusan Direksi — ${tanggalManusia(tgl)}`, baris as never, "Batas putusan 22.00 WIB. Setuju/Bersyarat wajib menetapkan mandat negosiasi.")
    : pesanDaftar("Pengingat: usulan KSO BELUM diputus", baris as never, "Batas 22.00 WIB malam ini.");
  return { tgl, jumlah: baris.length, kirim: await kirimKe(await penerimaFitur("kso-komite-direksi", true), `direksi-${jenis}:${tgl}`, "direksi", isi) };
}

/** Tiap jam — jalur cepat yang lewat 1 hari kerja tanpa putusan HOD → dianggap setuju. */
export async function runLewatBatasHod() {
  const n = await sebagaiJob(async (tx) => Number((await tx`select kso.app_job_lewat_batas_hod() as n`)[0].n));
  return { dianggap_setuju: n };
}

/** 07.00 hari kerja — penawaran siap terbit → Admin Sales. */
export async function runPenawaranPagi(sekarang = new Date()) {
  const tgl = tanggalWib(sekarang);
  const baris = await sebagaiJob(async (tx) => ANTREAN_SQL(tx, "Admin Sales · Terbitkan Penawaran"));
  if (baris.length === 0) return { tgl, jumlah: 0, kirim: [] };
  const isi = pesanDaftar(`Penawaran KSO siap diterbitkan — ${tanggalManusia(tgl)}`, baris as never, "Hanya mandat yang masih berlaku. Di bawah harga lantai ditolak sistem.");
  return { tgl, jumlah: baris.length, kirim: await kirimKe(await penerimaFitur("kso-komite-penawaran"), `penawaran:${tgl}`, "admin_sales", isi) };
}

/** Tanggal 6 — isi verifikasi bulan ke-6 dari laporan tes (migrasi 231). */
export async function runVerifikasiBulan6(sekarang = new Date()) {
  const tgl = tanggalWib(sekarang);
  return sebagaiJob(async (tx) => (await tx`select kso.app_job_verifikasi_bulan6(${tgl}) as h`)[0].h as Record<string, unknown>);
}

/** Event — usulan baru masuk antrean HOD (dipanggil sesudah #KSO kirim). */
export async function notifHodMasukAntrean(rencanaId: number, sekarang = new Date()) {
  const { r, seats } = await sebagaiJob(async (tx) => {
    const [r] = await tx`select id::int, nomor, faskes_nama, alat_nama, capex::float8 as capex, status::text, diajukan_at from kso.v_rencana where id = ${rencanaId}`;
    const seats = r ? await tx`select hod_id, kso.batas_putusan_hod(${r.diajukan_at}::timestamptz) as batas from kso.hod_untuk(${rencanaId})` : [];
    return { r, seats };
  });
  if (!r || !["JALUR_CEPAT", "JALUR_FORUM"].includes(String(r.status))) return { rencanaId, kirim: [] };
  const jenis = r.status === "JALUR_CEPAT" ? "putusan" : "pendapat";
  const kirim: HasilKirim[] = [];
  for (const s of seats) {
    const w = await waHod(String(s.hod_id));
    if (!w) { kirim.push({ kunci: `hod-${jenis}:${rencanaId}:${s.hod_id}`, ke: "-", terkirim: false, alasan: "HOD tanpa nomor WA" }); continue; }
    const batas = jenis === "putusan" ? jamWib(s.batas as string) : `${tanggalManusia(forumBerikutnya(sekarang))} 16.00 WIB`;
    kirim.push(await kirimSekali(`hod-${jenis}:${rencanaId}:${s.hod_id}`, "hod", w.wa, pesanHod(jenis, w.nama, r as never, batas)));
  }
  return { rencanaId, jenis, kirim };
}
