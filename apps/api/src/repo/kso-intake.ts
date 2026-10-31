// F170 Komite KSO — intake WhatsApp #KSO (Tahap 3).
//
// AM mengirim rencana KSO lewat bot WA yang sudah ada (keputusan 16 Okt: nomor bot sekarang,
// semua perintah lewat #KSO supaya tak bentrok dengan #KIRIM dan konfirmasi "kirim R12"):
//   #KSO <rencana>                    → draft baru (teks, atau voice note dalam ±10 menit)
//   #KSO D12 <jawaban>                → melengkapi draft
//   #KSO kirim D12                    → mengajukan (DRAFT → DIAJUKAN → jalur cepat/forum)
//   #KSO kelonggaran KSO-2026-0012 …  → minta kelonggaran (penawaran sudah terbit)
//   #KSO kalah KSO-2026-0012 …        → catat kalah
//
// Semua tulis lewat kso.app_bot_* dengan peran bot_wa (GUC wrg.kso_user di transaksi yang
// sama) — bukan akses tabel langsung. AM ditentukan dari pengirim (resolveSender ketat),
// TIDAK PERNAH dari isi pesan. Ekstraksi LLM disaring ulang di services/ai (kso_intake.py):
// kolom yang tak diucapkan AM = null → bot bertanya, tak ada nilai bawaan.

import { readFile } from "node:fs/promises";
import type { TransactionSql } from "postgres";
import { db } from "../db.js";
import { callAi } from "../ai.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { cariAkun } from "./interaction.js";

export const KSO_LINE = /^\s*#\s*kso\b/i;
export const KSO_BOT_USER = "bot-wa";
/** Jendela pemasangan voice note ↔ pesan #KSO di chat yang sama. */
export const KSO_JENDELA_SUARA_MENIT = 10;

export function ksoWaAktif(): boolean {
  return (process.env.KSO_WA_ENABLED ?? "").toLowerCase() === "true";
}

// ---------------------------------------------------------------- pengurai perintah (murni)

export type KsoAksi = "baru" | "lengkapi" | "kirim" | "kelonggaran" | "kalah" | "kosong";
export interface KsoPerintah {
  aksi: KsoAksi;
  draftId?: number;
  nomor?: string;
  isi: string;
}

const REF = /^(?:D\s*(\d{1,7})|(KSO-\d{4}-\d{3,}))\b[\s:,-]*/i;

export function parseKsoPerintah(body: string | null): KsoPerintah {
  const baris = stripInvisible(body ?? "").split(/\r?\n/);
  const i = baris.findIndex((l) => KSO_LINE.test(l));
  if (i < 0) return { aksi: "kosong", isi: "" };
  let kepala = baris[i].replace(KSO_LINE, "").trim();
  const sisa = baris.slice(i + 1).join("\n").trim();

  let aksi: KsoAksi = "baru";
  const kata = kepala.match(/^(kirim|minta\s+kelonggaran|kelonggaran|kalah)\b[\s:,-]*/i);
  if (kata) {
    const k = kata[1].toLowerCase();
    aksi = k === "kirim" ? "kirim" : k === "kalah" ? "kalah" : "kelonggaran";
    kepala = kepala.slice(kata[0].length);
  }
  let draftId: number | undefined;
  let nomor: string | undefined;
  const ref = kepala.match(REF);
  if (ref) {
    if (ref[1]) draftId = Number(ref[1]);
    if (ref[2]) nomor = ref[2].toUpperCase();
    kepala = kepala.slice(ref[0].length);
    if (aksi === "baru") aksi = "lengkapi";
  }
  const isi = [kepala.trim(), sisa].filter(Boolean).join("\n").trim();
  if (aksi === "baru" && !isi) aksi = "kosong";
  return { aksi, draftId, nomor, isi };
}

// ---------------------------------------------------------------- teks balasan (murni)

export function rp(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")} jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export const KSO_BANTUAN =
  "Format #KSO:\n" +
  "#KSO\nFaskes: RS Swasta A, Surabaya\nAlat: 1 unit Z3\nVolume: 900 test/bulan\nSumber: data LIS 3 bulan\n" +
  "Pendukung: dr. Rina SpPK, kepala instalasi lab\nDiminta: tenor 36 bulan, tanpa klausul khusus\n\n" +
  `Boleh juga kirim "#KSO" lalu voice note dalam ${KSO_JENDELA_SUARA_MENIT} menit.\n` +
  "Melengkapi: #KSO D12 <jawaban> · Mengajukan: #KSO kirim D12";

/** Terjemahan galat fungsi kso.* ke bahasa manusia. Tak pernah menampilkan nama fungsi/kode. */
export function terjemahGalatKso(pesan: string, ref: string): string {
  if (/SUMBER_VOLUME_KOSONG/.test(pesan))
    return `Volume — dari mana angkanya? Boleh "catatan lisan", boleh "belum ada", tapi tidak boleh kosong.\nJawab: #KSO ${ref} sumber <dari mana>`;
  const kurang = pesan.match(/KOLOM_WAJIB_KOSONG:\s*(.+)/);
  if (kurang) {
    const label: Record<string, string> = {
      volume_estimasi: "estimasi volume test per bulan",
      harga_per_test: "harga per test",
      tenor_bulan: "tenor (bulan, sejak serah terima)",
      "pendukung (min 1)": "minimal satu pendukung di RS",
      jumlah: "jumlah unit",
      klausul: 'klausul khusus (jawab "tidak ada" kalau tidak ada)',
    };
    const daftar = kurang[1].split(",").map((s) => label[s.trim()] ?? s.trim());
    return `Belum bisa diajukan, masih kurang: ${daftar.join("; ")}.\nJawab: #KSO ${ref} <jawaban>`;
  }
  if (/BUKAN_MILIK_PENGIRIM|RENCANA_TIDAK_ADA/.test(pesan)) return "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.";
  if (/DRAFT_TERKUNCI|TIDAK_BISA_DIAJUKAN/.test(pesan)) return `Rencana ${ref} sudah diajukan — isiannya tidak bisa diubah lagi lewat WA.`;
  if (/BUKAN_TAHAP_NEGOSIASI/.test(pesan)) return "Minta kelonggaran hanya untuk rencana yang penawarannya sudah terbit.";
  if (/GRUP_DIBEKUKAN/.test(pesan)) return "Grup faskes ini sedang dibekukan Direksi (SK Pasal 14) — belum bisa diproses.";
  if (/TRANSISI_TIDAK_SAH/.test(pesan)) return `Aksi itu tidak berlaku untuk status ${ref} sekarang.`;
  if (/ALASAN_STRATEGIS_WAJIB/.test(pesan))
    return `GPM di bawah batas Forum (zona Direktur) — tulis alasan strategisnya dulu.\nJawab: #KSO ${ref} alasan strategis <alasan>`;
  return "Maaf, permintaan belum bisa diproses. Coba lagi, atau hubungi admin.";
}

export interface DraftTampil {
  id: number;
  nomor: string | null;
  status: string;
  faskes: string;
  cabang: string | null;
  alat: string;
  alat_kode: string;
  jumlah: number;
  volume_estimasi: number | null;
  volume_sumber: string | null;
  harga_per_test: number | null;
  harga_standar: number | null;
  kategori: string;
  tenor_bulan: number | null;
  unit_status: string | null;
  klausul: string[];
  kolom_dinyatakan: string[];
  pendukung: { nama: string; tipe: string }[];
  gerbang: { no: number; nama: string; status: string; nilai: string | null }[];
  kursi_hod: number;
  /** F170 v2 (266): zona dari GPM saja + GPM deal — null bila data GPM belum lengkap. */
  zona_dasar: "am" | "hod" | "forum" | "direktur" | null;
  gpm_deal: number | null;
}

/**
 * Perkiraan jalur sebelum dikirim — cermin kso.ajukan (266): level zona GPM, satu gerbang 2–7 tidak hijau
 * (atau klausul belum dijawab) = naik satu level, routing HOD < 2 kursi di level HOD = forum.
 * Aturan grup mitra tidak terlihat di draft — final tetap saat dikirim.
 */
export function perkiraanZona(d: Pick<DraftTampil, "zona_dasar" | "gerbang" | "kursi_hod" | "kolom_dinyatakan">): "am" | "hod" | "forum" | "direktur" {
  const LEVEL = ["am", "hod", "forum", "direktur"] as const;
  let lv = d.zona_dasar ? LEVEL.indexOf(d.zona_dasar) : 2;
  const belumKlausul = !d.kolom_dinyatakan.includes("klausul");
  if (belumKlausul || d.gerbang.some((x) => x.no >= 2 && x.status !== "hijau")) lv = Math.min(lv + 1, 3);
  if (lv === 1 && d.kursi_hod < 2) lv = 2;
  return LEVEL[lv];
}

const TEKS_ZONA: Record<"am" | "hod" | "forum" | "direktur", string> = {
  am: "ZONA AM: kamu memutus sendiri, mandat otomatis terbit",
  hod: "ZONA 2 HOD: jalur cepat, dua HOD memutus maks. 1 hari kerja",
  forum: "ZONA FORUM: agenda forum Selasa/Kamis, Direktur memutus",
  direktur: "ZONA DIREKTUR: lewat forum, Direktur memutus — wajib alasan strategis",
};

const IKON: Record<string, string> = { hijau: "✅", merah: "❌", belum: "❔" };
const LABEL_KLAUSUL: Record<string, string> = {
  eksklusivitas: "eksklusivitas",
  jaminan_volume: "jaminan volume",
  alat_jatuh: "alat jadi milik RS",
  tanpa_eskalasi: "tanpa eskalasi harga",
  tanpa_lapor: "tanpa lapor test",
  tanpa_denda: "tanpa denda",
  draft_rs: "draft PKS dari RS",
};

/** Pertanyaan untuk kolom yang masih kosong — urut dari yang menghentikan pengajuan. */
export function pertanyaanKurang(d: DraftTampil, tanpaTipe: string[] = []): string[] {
  const q: string[] = [];
  if (!d.volume_sumber?.trim())
    q.push(
      `Volume${d.volume_estimasi != null ? ` ${d.volume_estimasi} test/bulan` : ""} — dari mana angkanya? Boleh "catatan lisan", boleh "belum ada", tapi tidak boleh kosong.`,
    );
  if (d.volume_estimasi == null) q.push("Berapa estimasi volume test per bulan?");
  if (!d.kolom_dinyatakan.includes("jumlah")) q.push(`Berapa unit ${d.alat_kode}?`);
  if (d.harga_per_test == null)
    q.push(
      d.harga_standar != null
        ? `Harga per test? Daftar standar ${d.kategori.toLowerCase()} ${rp(d.harga_standar)}/test — pakai harga daftar, atau sebut angka lain?`
        : "Berapa harga per test yang diusulkan?",
    );
  if (d.tenor_bulan == null) q.push("Tenor berapa bulan (dihitung sejak serah terima)?");
  if (!d.kolom_dinyatakan.includes("klausul"))
    q.push(
      `Ada permintaan klausul khusus dari RS (${Object.values(LABEL_KLAUSUL).join(", ")})? Jawab "tidak ada" kalau tidak ada.`,
    );
  for (const n of tanpaTipe)
    q.push(`Apa peran ${n}? (manajemen / dokter user / kepala instalasi / analis-perawat / pengadaan)`);
  if (d.pendukung.length === 0 && tanpaTipe.length === 0)
    q.push("Siapa pendukung di RS? Satu orang per baris: nama, peran (manajemen / dokter user / kepala instalasi / analis-perawat / pengadaan).");
  return q;
}

/** Balasan empat bagian (spesifikasi bab 2.3): nomor draft · isian & dari sistem · HASIL GERBANG · yang kurang. */
export function formatBalasanDraft(
  d: DraftTampil,
  o: { baru: boolean; nama: string; transkrip?: string; tanpaTipe?: string[]; catatan?: string[] },
): string {
  const ref = `D${d.id}`;
  const out: string[] = [];
  out.push(`Draft ${ref} ${o.baru ? "dibuat" : "diperbarui"}, ${o.nama}.`);
  if (o.transkrip) out.push(`\nTranskrip voice note:\n«${o.transkrip}»`);

  out.push("\nIsian (periksa, kamu yang bertanggung jawab atas isinya):");
  out.push(`· Faskes: ${d.faskes}${d.cabang ? ` (${d.cabang})` : ""}`);
  out.push(`· Alat: ${d.kolom_dinyatakan.includes("jumlah") ? `${d.jumlah} × ` : ""}${d.alat}`);
  if (d.volume_estimasi != null) out.push(`· Volume: ${d.volume_estimasi} test/bulan`);
  if (d.volume_sumber) out.push(`· Sumber volume: "${d.volume_sumber}"`);
  if (d.harga_per_test != null) out.push(`· Harga: ${rp(d.harga_per_test)}/test`);
  if (d.tenor_bulan != null) out.push(`· Tenor: ${d.tenor_bulan} bulan`);
  if (d.unit_status) out.push(`· Status unit: ${d.unit_status.replace(/_/g, " ")}`);
  if (d.kolom_dinyatakan.includes("klausul"))
    out.push(`· Klausul khusus: ${d.klausul.length ? d.klausul.map((k) => LABEL_KLAUSUL[k] ?? k).join(", ") : "tidak ada"}`);
  for (const p of d.pendukung) out.push(`· Pendukung: ${p.nama} (${p.tipe.replace(/_/g, " ")})`);

  const g = (no: number) => d.gerbang.find((x) => x.no === no);
  const sistem = [g(1), g(3), g(5)].filter((x) => x?.nilai);
  if (sistem.length) {
    out.push("\nDari sistem:");
    const label: Record<number, string> = { 1: "GPM deal", 3: "Relokasi", 5: "Piutang faskes" };
    for (const x of sistem) out.push(`· ${label[x!.no]}: ${x!.nilai}`);
  }

  const hijau = d.gerbang.filter((x) => x.status === "hijau").length;
  const klausulBelum = !d.kolom_dinyatakan.includes("klausul");
  out.push(`\nGerbang: ${hijau} dari 7 hijau → ${TEKS_ZONA[perkiraanZona(d)]} (perkiraan; final saat dikirim)`);
  for (const x of d.gerbang)
    if (x.status !== "hijau" || (x.no === 7 && klausulBelum))
      out.push(`${x.no === 7 && klausulBelum ? IKON.belum : IKON[x.status] ?? "❔"} ${x.no}. ${x.nama}: ${x.no === 7 && klausulBelum ? "belum dijawab" : x.nilai ?? "-"}`);
  if (d.kursi_hod < 2 && perkiraanZona({ ...d, kursi_hod: 2 }) === "hod") out.push(`ℹ️ Cabang ini tanpa HOD Area — usulan masuk forum.`);
  for (const c of o.catatan ?? []) out.push(`ℹ️ ${c}`);

  const q = pertanyaanKurang(d, o.tanpaTipe);
  if (q.length) {
    out.push(`\n${q.length === 1 ? "Kurang satu" : `Kurang ${q.length}`}:`);
    q.forEach((t, i) => out.push(q.length === 1 ? t : `${i + 1}. ${t}`));
    out.push(`\nJawab: #KSO ${ref} <jawaban>`);
  } else {
    out.push(`\nBalas "#KSO kirim ${ref}" untuk mengajukan.`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- DB (sebagai bot_wa)

type Tx = TransactionSql<Record<string, unknown>>;

/** Satu transaksi dengan identitas bot: set_config dan panggilan kso.app_bot_* WAJIB di tx yang sama (pool). */
export async function sebagaiBot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`set local role wrg_app`; // dev = prod: pagar peran & RLS berlaku walau koneksi superuser
    await tx`select set_config('wrg.kso_user', ${KSO_BOT_USER}, true)`;
    return fn(tx as unknown as Tx);
  })) as T;
}

async function bacaDraft(tx: Tx, id: number): Promise<DraftTampil | null> {
  const [r] = await tx`
    select r.id::int, r.nomor, r.status::text, f.nama as faskes, f.cabang, a.nama as alat, a.kode as alat_kode,
           r.jumlah, r.volume_estimasi, r.volume_sumber, r.harga_per_test::float8, k.harga_standar_per_test::float8 as harga_standar,
           k.label as kategori, r.tenor_bulan, r.unit_status::text, r.kolom_dinyatakan,
           coalesce((select array_agg(klausul_kode order by klausul_kode) from kso.rencana_klausul where rencana_id = r.id), '{}') as klausul,
           coalesce((select json_agg(json_build_object('nama', nama, 'tipe', tipe) order by id) from kso.rencana_pendukung where rencana_id = r.id), '[]') as pendukung,
           coalesce((select json_agg(json_build_object('no', no, 'nama', nama, 'status', status, 'nilai', nilai) order by no) from kso.gerbang_hasil where rencana_id = r.id), '[]') as gerbang,
           (select count(*)::int from kso.hod_untuk(r.id)) as kursi_hod, r.zona_dasar, r.gpm_deal::float8 as gpm_deal
      from kso.rencana_kso r join kso.faskes f on f.id = r.faskes_id
      join kso.alat a on a.kode = r.alat_kode join kso.kategori k on k.kode = a.kategori
     where r.id = ${id}`;
  return (r as unknown as DraftTampil) ?? null;
}

async function idDariNomor(tx: Tx, p: KsoPerintah): Promise<number | null> {
  if (p.draftId) return p.draftId;
  if (!p.nomor) return null;
  const [r] = await tx`select id::int from kso.rencana_kso where nomor = ${p.nomor}`;
  return r ? Number(r.id) : null;
}

type Cocok<T> = { kind: "one"; nilai: T; nama: string } | { kind: "none" } | { kind: "ambiguous"; names: string[] };

/** Faskes HANYA dari master (spesifikasi 2.4: tidak pernah membuat faskes baru dari intake). */
async function cocokFaskes(tx: Tx, teks: string): Promise<Cocok<string>> {
  const akun = await cariAkun(teks);
  if (akun.kind === "none") return { kind: "none" };
  if (akun.kind === "ambiguous") return { kind: "ambiguous", names: akun.names.slice(0, 3) };
  const rows = await tx`select id, nama from kso.faskes where id = any(${akun.ids.map(String)})`;
  if (rows.length === 1) return { kind: "one", nilai: String(rows[0].id), nama: String(rows[0].nama) };
  return rows.length === 0 ? { kind: "none" } : { kind: "ambiguous", names: rows.slice(0, 3).map((r) => String(r.nama)) };
}

/** Alat dari katalog kso.alat: kode yang disebut sebagai kata utuh ("Z3", "EXZ8000", "DN-X6"). Ambigu → 2–3 pilihan. */
export function pilihAlat(teks: string, katalog: { kode: string; nama: string }[]): Cocok<string> {
  const t = ` ${teks.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  const kena = katalog.filter((a) => {
    const k = a.kode.toUpperCase().replace(/[^A-Z0-9]+/g, "");
    const n = a.nama.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    return t.includes(` ${k} `) || (k.length >= 4 && t.replace(/ /g, "").includes(k)) || (n.length >= 4 && t.includes(` ${n} `));
  });
  if (kena.length === 1) return { kind: "one", nilai: kena[0].kode, nama: kena[0].nama };
  if (kena.length > 1) return { kind: "ambiguous", names: kena.slice(0, 3).map((a) => a.kode) };
  return { kind: "none" };
}

// ---------------------------------------------------------------- handler

export interface KsoKonteks {
  am_id: string;
  nama: string;
  /** Teks rencana: isi pesan #KSO, atau transkrip voice note. */
  teks: string;
  perintah: KsoPerintah;
  transkrip?: string;
  wa_message_id: string | null;
}

interface Isian {
  faskes_teks?: string | null;
  alat_teks?: string | null;
  jumlah?: number | null;
  volume_estimasi?: number | null;
  volume_sumber?: string | null;
  harga_per_test?: number | null;
  pakai_harga_daftar?: boolean | null;
  tenor_bulan?: number | null;
  unit_status?: string | null;
  biaya_instalasi?: number | null;
  klausul_khusus?: string[] | null;
  pendukung?: { nama: string; tipe: string | null; tanggal: string | null; cara: string | null }[];
  kompetitor_alat?: string | null;
  kompetitor_kontrak_habis?: string | null;
  risiko_catatan?: string | null;
  lead_asal?: string | null;
}

async function ekstrak(teks: string): Promise<Isian | null> {
  const r = await callAi("/kso/ekstrak", { teks }, { timeoutMs: 60_000 });
  if (r.status >= 400 || r.data.galat) return null;
  return (r.data.isian as Isian) ?? null;
}

export async function transkripSuara(mediaPath: string): Promise<string | null> {
  let b64: string;
  try {
    b64 = (await readFile(mediaPath)).toString("base64");
  } catch {
    return null;
  }
  const fmt = (mediaPath.split(".").pop() ?? "ogg").toLowerCase();
  const r = await callAi("/transkrip", { audio_b64: b64, format: fmt }, { timeoutMs: 90_000 });
  if (r.status >= 400 || r.data.galat) return null;
  const t = String(r.data.teks ?? "").trim();
  return t || null;
}

/** Ubah hasil ekstraksi jadi p_isian lengkapi_draft: HANYA kunci yang bernilai. */
function isianLengkapi(x: Isian, hargaStandar: number | null): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const salin = ["jumlah", "volume_estimasi", "volume_sumber", "harga_per_test", "tenor_bulan", "unit_status", "biaya_instalasi",
    "kompetitor_alat", "kompetitor_kontrak_habis", "risiko_catatan", "lead_asal"] as const;
  for (const k of salin) if (x[k] != null) o[k] = x[k];
  if (o.harga_per_test == null && x.pakai_harga_daftar === true && hargaStandar != null) o.harga_per_test = hargaStandar;
  if (Array.isArray(x.klausul_khusus)) o.klausul = x.klausul_khusus;
  return o;
}

function pendukungLengkap(x: Isian) {
  const ok = (x.pendukung ?? []).filter((p) => p.tipe);
  return {
    json: ok.map((p) => ({ nama: p.nama, tipe: p.tipe, ...(p.tanggal ? { tanggal: p.tanggal } : {}), ...(p.cara ? { cara: p.cara } : {}) })),
    tanpaTipe: (x.pendukung ?? []).filter((p) => !p.tipe).map((p) => p.nama),
  };
}

/** Kerjakan satu perintah #KSO. Mengembalikan teks balasan + ringkasan untuk processed_result. */
export async function prosesKso(k: KsoKonteks): Promise<{ balasan: string; hasil: Record<string, unknown> }> {
  const p = k.perintah;
  const ref = p.nomor ?? (p.draftId ? `D${p.draftId}` : "");

  const amAda = await sebagaiBot(async (tx) => (await tx`select 1 from kso.am where id = ${k.am_id}`).length > 0);
  if (!amAda)
    return { balasan: `Maaf ${k.nama}, Anda belum terdaftar sebagai AM di Komite KSO. Hubungi admin.`, hasil: { error: "bukan-am-kso" } };

  if (p.aksi === "kosong") return { balasan: KSO_BANTUAN, hasil: { aksi: "bantuan" } };

  if (p.aksi === "kirim" || p.aksi === "kelonggaran" || p.aksi === "kalah") {
    if (!ref) return { balasan: `Sebutkan nomornya, mis. "#KSO ${p.aksi} D12".`, hasil: { error: "tanpa-ref" } };
    if (p.aksi !== "kirim" && !p.isi) return { balasan: `Sebutkan alasannya, mis. "#KSO ${p.aksi} ${ref} RS minta harga di bawah lantai".`, hasil: { error: "tanpa-alasan" } };
    try {
      return await sebagaiBot(async (tx) => {
        const id = await idDariNomor(tx, p);
        if (!id) return { balasan: "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.", hasil: { error: "ref-tidak-ada", ref } };
        if (p.aksi === "kirim") {
          const [j] = await tx`select kso.app_bot_ajukan(${id}, ${k.am_id})::text as jalur`;
          const [r] = await tx`select nomor, alasan_forum from kso.rencana_kso where id = ${id}`;
          const [z] = await tx`select r.zona, r.gpm_deal::float8 as gpm, m.harga_pembuka::float8 as pembuka, m.harga_target::float8 as target,
                                      m.harga_lantai::float8 as lantai, m.berlaku_sampai::text as sampai
                                 from kso.rencana_kso r left join kso.mandat m on m.rencana_id = r.id where r.id = ${id}`;
          const gpm = z?.gpm != null ? ` (GPM ${(Number(z.gpm) * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)` : "";
          return {
            balasan:
              `${r.nomor} diajukan, ${k.nama}.\n` +
              (j.jalur === "AM"
                ? `→ ZONA AM${gpm}: kamu memutus sendiri. Mandat berlaku s/d ${z.sampai}: harga pembuka ${rp(z.pembuka)}, target ${rp(z.target)}, batas bawah ${rp(z.lantai)}/test. Di bawah batas bawah → #KSO kelonggaran.`
                : j.jalur === "CEPAT"
                  ? `→ ZONA 2 HOD${gpm}: dua HOD memutus maksimal 1 hari kerja.`
                  : `→ ${z?.zona === "direktur" ? "ZONA DIREKTUR" : "ZONA FORUM"}${gpm}${r.alasan_forum ? ` (${r.alasan_forum})` : ""}: masuk agenda forum Selasa/Kamis berikutnya (batas data 14.00), Direktur memutus.`),
            hasil: { aksi: "kirim", rencana_id: id, nomor: r.nomor, jalur: j.jalur },
          };
        }
        if (p.aksi === "kelonggaran") await tx`select kso.app_bot_minta_kelonggaran(${id}, ${k.am_id}, ${p.isi})`;
        else await tx`select kso.app_bot_catat_kalah(${id}, ${k.am_id}, ${p.isi})`;
        return {
          balasan: p.aksi === "kelonggaran" ? `Permintaan kelonggaran ${ref} dicatat — dibahas di forum berikutnya.` : `${ref} dicatat kalah. Terima kasih sudah melapor.`,
          hasil: { aksi: p.aksi, rencana_id: id },
        };
      });
    } catch (e) {
      const m = (e as Error).message;
      return { balasan: terjemahGalatKso(m, ref), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
    }
  }

  // baru / lengkapi: ekstraksi LLM dulu (di luar transaksi — bisa 10–60 detik)
  if (!k.teks.trim()) return { balasan: `Isinya kosong. ${p.aksi === "lengkapi" ? `Jawab: #KSO ${ref} <jawaban>` : KSO_BANTUAN}`, hasil: { error: "isi-kosong" } };
  const x = await ekstrak(k.teks);
  if (!x) return { balasan: "Maaf, pesan belum bisa dibaca sistem (AI sedang gangguan). Coba kirim ulang beberapa menit lagi.", hasil: { error: "ekstraksi-gagal" } };

  try {
    return await sebagaiBot(async (tx) => {
      const catatan: string[] = [];
      const { json: pendukung, tanpaTipe } = pendukungLengkap(x);

      if (p.aksi === "lengkapi") {
        const id = await idDariNomor(tx, p);
        if (!id) return { balasan: "Rencana itu bukan atas nama Anda, atau nomornya tidak ada.", hasil: { error: "ref-tidak-ada", ref } };
        const awal = await bacaDraft(tx, id);
        const isian = isianLengkapi(x, awal?.harga_standar ?? null);
        if (x.alat_teks) {
          const katalog = (await tx`select kode, nama from kso.alat`) as unknown as { kode: string; nama: string }[];
          const a = pilihAlat(x.alat_teks, katalog);
          if (a.kind === "one") isian.alat_kode = a.nilai;
          else catatan.push(`Alat "${x.alat_teks}" ${a.kind === "none" ? "tidak ada di katalog" : `ambigu (${a.names.join(" / ")})`} — alat tidak diubah.`);
        }
        if (x.faskes_teks && awal && !awal.faskes.toLowerCase().includes(x.faskes_teks.toLowerCase()))
          catatan.push("Faskes tidak bisa diganti di draft yang sama — kirim #KSO baru untuk faskes lain.");
        if (pendukung.length) isian.pendukung = pendukung;
        if (Object.keys(isian).length === 0 && tanpaTipe.length === 0)
          return {
            balasan: `Tidak ada isian baru yang terbaca dari jawabanmu untuk ${ref}. Tulis langsung, mis. "#KSO ${ref} tenor 36 bulan".`,
            hasil: { aksi: "lengkapi", rencana_id: id, kosong: true },
          };
        await tx`select kso.app_bot_lengkapi_draft(${id}, ${k.am_id}, ${tx.json(isian as never)})`;
        const d = await bacaDraft(tx, id);
        return {
          balasan: formatBalasanDraft(d!, { baru: false, nama: k.nama, transkrip: k.transkrip, tanpaTipe, catatan }),
          hasil: { aksi: "lengkapi", rencana_id: id, kunci: Object.keys(isian) },
        };
      }

      // baru
      if (!x.faskes_teks)
        return { balasan: `Faskesnya belum disebut, ${k.nama}. Tulis "Faskes: <nama RS/klinik>, <kota>" lalu kirim ulang #KSO.`, hasil: { error: "faskes-kosong" } };
      const f = await cocokFaskes(tx, x.faskes_teks);
      if (f.kind === "none")
        return { balasan: `Faskes "${x.faskes_teks}" tidak ketemu di master, ${k.nama}. Draft BELUM dibuat — cek ejaan nama faskes lalu kirim ulang #KSO.`, hasil: { error: "faskes-tidak-ada", q: x.faskes_teks } };
      if (f.kind === "ambiguous")
        return {
          balasan: `Faskes "${x.faskes_teks}" ada beberapa, ${k.nama}:\n${f.names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\nKirim ulang #KSO dengan nama faskes yang lebih lengkap. Draft BELUM dibuat.`,
          hasil: { error: "faskes-ambigu", kandidat: f.names },
        };
      const katalog = (await tx`select kode, nama from kso.alat`) as unknown as { kode: string; nama: string }[];
      const a = x.alat_teks ? pilihAlat(x.alat_teks, katalog) : ({ kind: "none" } as const);
      if (a.kind !== "one")
        return {
          balasan:
            (a.kind === "ambiguous"
              ? `Alat "${x.alat_teks}" cocok ke beberapa tipe: ${a.names.join(" / ")}.`
              : `Alat${x.alat_teks ? ` "${x.alat_teks}"` : ""} ${x.alat_teks ? "tidak ada di katalog KSO" : "belum disebut"}.`) +
            `\nPilihan: ${katalog.map((c) => c.kode).join(", ")}. Kirim ulang #KSO dengan tipe alatnya. Draft BELUM dibuat.`,
          hasil: { error: a.kind === "ambiguous" ? "alat-ambigu" : "alat-tidak-ada", q: x.alat_teks },
        };

      const [kat] = await tx`select k.harga_standar_per_test::float8 as h from kso.alat a join kso.kategori k on k.kode = a.kategori where a.kode = ${a.nilai}`;
      const isian = isianLengkapi(x, kat?.h ?? null);
      // buat_draft rujukan butuh nilai jumlah (coalesce 1) — yang DINYATAKAN dicatat lewat lengkapi_draft
      const [b] = await tx`
        select kso.app_bot_buat_draft(${k.am_id}, ${f.nilai}, ${a.nilai}, ${(isian.jumlah as number) ?? null}, ${(isian.volume_estimasi as number) ?? null},
          ${(isian.volume_sumber as string) ?? null}, ${(isian.harga_per_test as number) ?? null}, null, null, '{}'::text[],
          ${tx.json(pendukung as never)}, ${k.wa_message_id}, null, null)::int as id`;
      await tx`select kso.app_bot_lengkapi_draft(${b.id}, ${k.am_id}, ${tx.json(isian as never)})`;
      const d = await bacaDraft(tx, b.id);
      return {
        balasan: formatBalasanDraft(d!, { baru: true, nama: k.nama, transkrip: k.transkrip, tanpaTipe, catatan }),
        hasil: { aksi: "baru", rencana_id: b.id, faskes_id: f.nilai, alat: a.nilai, kunci: Object.keys(isian) },
      };
    });
  } catch (e) {
    const m = (e as Error).message;
    return { balasan: terjemahGalatKso(m, ref || "D?"), hasil: { error: "kso-galat", galat: m.slice(0, 200) } };
  }
}
