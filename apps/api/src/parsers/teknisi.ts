// F175 — parser #PLAN / #REPORT khusus Teknisi (format per alat). Pure function,
// tanpa DB, tanpa LLM. Spesifikasi: docs/features/F175-plan-report-teknisi.md.
//
// #PLAN   : `N. faskes | SN atau nama alat | jenis [T-nomor tiket]`
// #REPORT : satu pesan per kunjungan (per faskes). Identitas alat lewat nomor
//           plan (`#REPORT 1`, judul blok `#2`) ATAU `RS:` + `SN:`/`Alat:`.
//           Banyak alat = blok bernomor `1) SN … | alat | jenis`; `RS:` dan
//           `Catatan:` sesudah baris kosong berlaku ke seluruh kunjungan.
//           Tanda format WA (`*tebal*`) dibuang sebelum label dibaca.
//
// Parser ini SENGAJA tidak menebak. Yang tak terbaca dikembalikan sebagai
// `errors` supaya bot membalas dengan contoh format — diam = teknisi mengira
// laporannya masuk.
import { findDate, stripInvisible } from "./dailyplan.js";

export const JENIS_TEKNISI = [
  "PM", "Service", "Install", "Uji Fungsi", "Tarik Alat", "Training", "Kalibrasi", "Call",
] as const;
export type JenisTeknisi = (typeof JENIS_TEKNISI)[number];

export const STATUS_TEKNISI = ["Selesai", "Pending", "Batal", "Revisit"] as const;
export type StatusTeknisi = (typeof STATUS_TEKNISI)[number];

// Kunci = huruf kecil, spasi tunggal. Diurutkan dari frasa terpanjang saat
// dicocokkan supaya "refresh training" tak terbaca "training" + sisa.
const JENIS_ALIAS: Record<string, JenisTeknisi> = {
  pm: "PM", maintenance: "PM", "preventive maintenance": "PM", preventive: "PM", perawatan: "PM",
  service: "Service", servis: "Service", perbaikan: "Service", cm: "Service",
  "corrective maintenance": "Service", repair: "Service",
  install: "Install", instal: "Install", instalasi: "Install", installasi: "Install", pemasangan: "Install", pasang: "Install",
  "uji fungsi": "Uji Fungsi", uf: "Uji Fungsi", "uji fungsi alat": "Uji Fungsi",
  "tarik alat": "Tarik Alat", tarik: "Tarik Alat", penarikan: "Tarik Alat", "penarikan alat": "Tarik Alat",
  training: "Training", "refresh training": "Training", pelatihan: "Training",
  kalibrasi: "Kalibrasi", calibration: "Kalibrasi", kalib: "Kalibrasi",
  call: "Call", telepon: "Call", telp: "Call", "by phone": "Call", remote: "Call",
};
const JENIS_KEYS = Object.keys(JENIS_ALIAS).sort((a, b) => b.length - a.length);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Teks jenis → jenis kanonik; null bila tak dikenal (jangan ditebak). */
export function normalizeJenis(s: string | null | undefined): JenisTeknisi | null {
  if (!s) return null;
  const t = norm(s.replace(/[.,;]+$/, ""));
  return JENIS_ALIAS[t] ?? null;
}

// Nomor tiket servis: "T-123", "T123", "#T-123".
const TIKET = /#?\bT-?(\d{1,7})\b/i;

/**
 * Segmen jenis di #PLAN boleh membawa nomor tiket ("Service T-123"). Kembalikan
 * jenis + tiket; jenis null bila sisa teks (tanpa tiket) tak dikenal.
 */
export function pisahJenisTiket(seg: string): { jenis: JenisTeknisi | null; tiket: string | null } {
  const m = seg.match(TIKET);
  const tiket = m ? `T-${m[1]}` : null;
  const sisa = (m ? seg.replace(m[0], " ") : seg).replace(/[()[\]]/g, " ");
  const t = norm(sisa);
  if (!t) return { jenis: null, tiket };
  const exact = normalizeJenis(t);
  if (exact) return { jenis: exact, tiket };
  // "PM bulanan", "Service ganti lampu" — frasa jenis di depan diterima.
  for (const k of JENIS_KEYS) {
    if (t === k || t.startsWith(k + " ")) return { jenis: JENIS_ALIAS[k], tiket };
  }
  return { jenis: null, tiket };
}

/**
 * Teks alat dari teknisi → SN atau nama alat. SN = berawalan "SN" ATAU murni
 * angka (≥3 digit, "0832"). Nama model yang memuat angka ("CM250", "DxH 560",
 * "BS-240") TETAP dianggap nama alat — pencocok di repo boleh mencoba keduanya.
 */
export function pisahSnAlat(s: string | null | undefined): { sn: string | null; alat: string | null } {
  const t = (s ?? "").trim();
  if (!t || t === "-") return { sn: null, alat: null };
  const pre = t.match(/^(?:s\/?n|no\.?\s*seri|nomor\s+seri|serial)\s*[:.#]?\s*(\S+)\s*(.*)$/i);
  if (pre) return { sn: pre[1], alat: pre[2].trim() || null };
  if (/^\d{3,}$/.test(t.replace(/[\s.-]/g, ""))) return { sn: t.replace(/[\s.]/g, ""), alat: null };
  return { sn: null, alat: t };
}

// ---------------------------------------------------------------------------
// #PLAN
// ---------------------------------------------------------------------------

export interface TeknisiPlanItem {
  urut: number;
  faskes: string;
  sn: string | null;
  alat: string | null;
  jenis: JenisTeknisi;
  tiket: string | null;
}
export interface TeknisiPlanParse {
  tanggal: string | null;
  items: TeknisiPlanItem[];
  errors: string[];
}

const HASH_LINE = /^\s*#\s*(plan|report)\b/i;
const ITEM = /^\s*(\d{1,2})\s*[.):]\s*(.*)$/;

/**
 * Buang tanda format WhatsApp (`*tebal*`, `_miring_`, `~coret~`). Teknisi sering
 * menyalin contoh yang labelnya ditebalkan ("*Status:* Selesai") — tanpa ini
 * labelnya tak terbaca. `_` hanya dibuang di tepi kata supaya "SN_123" utuh.
 */
export function bersihFormatWa(s: string): string {
  return s.replace(/[*~]/g, "").replace(/(^|[\s:])_+|_+(?=[\s:]|$)/g, "$1");
}

const barisPesan = (body: string) => stripInvisible(body ?? "").split(/\r?\n/).map(bersihFormatWa);

export function parseTeknisiPlan(body: string, nowMs?: number): TeknisiPlanParse {
  const lines = barisPesan(body);
  const h = lines.findIndex((l) => HASH_LINE.test(l));
  const out: TeknisiPlanParse = { tanggal: null, items: [], errors: [] };
  if (h < 0) return out;
  const header = lines[h].replace(HASH_LINE, "");
  out.tanggal = findDate(header, nowMs)?.iso ?? null;
  for (const raw of lines.slice(h + 1)) {
    const m = raw.match(ITEM);
    if (!m) continue;
    const urut = Number(m[1]);
    const seg = m[2].split(/\s*\|\s*/).map((x) => x.trim());
    if (seg.length < 3 || !seg[0] || !seg[1] || !seg[2]) {
      out.errors.push(`Baris ${urut}: perlu 3 bagian \`faskes | SN/alat | jenis\`.`);
      continue;
    }
    const { jenis, tiket } = pisahJenisTiket(seg.slice(2).join(" "));
    if (!jenis) {
      out.errors.push(`Baris ${urut}: jenis "${seg[2]}" tak dikenal. Pilih: ${JENIS_TEKNISI.join(" · ")}.`);
      continue;
    }
    const { sn, alat } = pisahSnAlat(seg[1]);
    out.items.push({ urut, faskes: seg[0], sn, alat, jenis, tiket });
  }
  const dup = out.items.map((i) => i.urut).filter((u, i, a) => a.indexOf(u) !== i);
  if (dup.length) out.errors.push(`Nomor ganda: ${[...new Set(dup)].join(", ")}. Tiap item perlu nomor unik.`);
  return out;
}

// ---------------------------------------------------------------------------
// #REPORT
// ---------------------------------------------------------------------------

export interface TeknisiReportBlok {
  /** Nomor blok di pesan (1-based); 1 untuk laporan satu alat tanpa blok. */
  nomor: number;
  /** Nomor item plan yang dirujuk (`#REPORT 1` / judul `#2`). */
  planNo: number | null;
  sn: string | null;
  alat: string | null;
  jenis: JenisTeknisi | null;
  status: StatusTeknisi | null;
  alasan: string | null;
  kegiatan: string | null;
  jumlahTes: number | null;
  /** null = tanpa penggantian / tak diisi. */
  sparepart: string | null;
  catatan: string | null;
  tiket: string | null;
}
export interface TeknisiReportParse {
  tanggal: string | null;
  faskes: string | null;
  catatan: string | null;
  blok: TeknisiReportBlok[];
  errors: string[];
}

type Field = "faskes" | "alat" | "sn" | "jenis" | "status" | "kegiatan" | "tes" | "sparepart" | "catatan" | "foto" | "tiket";

const LABEL: Record<string, Field> = {
  rs: "faskes", faskes: "faskes", customer: "faskes", "rumah sakit": "faskes", klinik: "faskes",
  lab: "faskes", puskesmas: "faskes", pkm: "faskes", lokasi: "faskes",
  alat: "alat", instrumen: "alat", "nama alat": "alat", "tipe alat": "alat", "type alat": "alat", unit: "alat",
  sn: "sn", "s/n": "sn", "no seri": "sn", "no. seri": "sn", "nomor seri": "sn", serial: "sn", "serial number": "sn",
  jenis: "jenis", "jenis kunjungan": "jenis", tipe: "jenis", "tipe kunjungan": "jenis",
  status: "status",
  kegiatan: "kegiatan", tindakan: "kegiatan", pekerjaan: "kegiatan", aktivitas: "kegiatan", hasil: "kegiatan",
  "jumlah tes": "tes", tes: "tes", test: "tes", "jumlah test": "tes", "jml tes": "tes", "jml test": "tes", counter: "tes",
  "pergantian sparepart": "sparepart", sparepart: "sparepart", "spare part": "sparepart", "ganti sparepart": "sparepart",
  "penggantian sparepart": "sparepart", part: "sparepart",
  catatan: "catatan", note: "catatan", notes: "catatan", ket: "catatan", keterangan: "catatan",
  foto: "foto", tiket: "tiket", "no tiket": "tiket", ticket: "tiket",
};

// Label = kata di awal baris lalu titik dua. Dibatasi 25 karakter tanpa angka
// supaya "Jam 10:30 selesai" tak terbaca sebagai label "Jam 10".
const LABEL_LINE = /^\s*([A-Za-z][A-Za-z./ ]{0,24}?)\s*:\s*(.*)$/;
const BLOK_LINE = /^\s*(\d{1,2})\s*[.)]\s*(.*)$/;
// Judul blok alat yang jelas: kosong, memuat `|`, `#nomor-plan`, atau awalan SN.
const judulBlokJelas = (t: string) =>
  !t.trim() || t.includes("|") || /^\s*#\s*\d/.test(t) || /^\s*(?:s\/?n|no\.?\s*seri|nomor\s+seri|serial)\b/i.test(t);
const TANPA = /^(-+|—|tidak ada|tdk ada|ga ada|gak ada|nihil|none|no|0|kosong|tidak)$/i;

/** Teks status → status kanonik + alasan. */
export function parseStatus(s: string): { status: StatusTeknisi | null; alasan: string | null } {
  const t = s.trim();
  const ambil = (rest: string) => rest.replace(/^[\s,:;()\-–—]+/, "").replace(/\)\s*$/, "").trim() || null;
  let m = t.match(/^(selesai|done|ok|oke|beres|tuntas|clear|finish(?:ed)?)\b(.*)$/i);
  if (m) return { status: "Selesai", alasan: ambil(m[2]) };
  m = t.match(/^(pending|tertunda|tunda|hold)\b(.*)$/i);
  if (m) return { status: "Pending", alasan: ambil(m[2]) };
  m = t.match(/^(batal|cancel(?:led)?|gagal|tidak jadi|tdk jadi)\b(.*)$/i);
  if (m) return { status: "Batal", alasan: ambil(m[2]) };
  m = t.match(/^(revisit|kunjungan ulang|datang ulang|ulang)\b(.*)$/i);
  if (m) return { status: "Revisit", alasan: ambil(m[2]) };
  return { status: null, alasan: null };
}

function blokKosong(nomor: number): TeknisiReportBlok {
  return {
    nomor, planNo: null, sn: null, alat: null, jenis: null, status: null, alasan: null,
    kegiatan: null, jumlahTes: null, sparepart: null, catatan: null, tiket: null,
  };
}

// Judul blok: "#2", "SN 0832 | Zybio EXC200 | PM", "0832 | EXC200 | PM",
// "#2 | PM". Kembalikan galat bila ada bagian yang tak terbaca.
function bacaJudul(b: TeknisiReportBlok, judul: string): string | null {
  const seg = judul.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
  for (const s of seg) {
    const ref = s.match(/^#\s*(\d{1,2})$/);
    if (ref) { b.planNo = Number(ref[1]); continue; }
    const jt = pisahJenisTiket(s);
    if (jt.jenis) { b.jenis = jt.jenis; if (jt.tiket) b.tiket = jt.tiket; continue; }
    if (!jt.jenis && jt.tiket && s.replace(TIKET, "").trim() === "") { b.tiket = jt.tiket; continue; }
    const sa = pisahSnAlat(s);
    if (sa.sn && !b.sn) { b.sn = sa.sn; if (sa.alat && !b.alat) b.alat = sa.alat; continue; }
    if (sa.alat && !b.alat) { b.alat = sa.alat; continue; }
    return `Blok ${b.nomor}: judul "${judul}" tak terbaca. Pakai \`#NOMOR-PLAN\` atau \`SN … | alat | jenis\`.`;
  }
  return null;
}

export function parseTeknisiReport(
  body: string,
  nowMs?: number,
  // Shortcut #install/#servis/#training/#kalibrasi: jenis dari hashtag bila blok tak menulisnya.
  opts: { jenisDefault?: JenisTeknisi } = {},
): TeknisiReportParse {
  const lines = barisPesan(body);
  const out: TeknisiReportParse ={ tanggal: null, faskes: null, catatan: null, blok: [], errors: [] };
  const h = lines.findIndex((l) => HASH_LINE.test(l));
  if (h < 0) return out;

  // Header: "#REPORT", "#REPORT 1", "#REPORT 7 Nov", "#REPORT 1 7 Nov".
  let header = lines[h].replace(HASH_LINE, "");
  const d = findDate(header, nowMs);
  if (d) { out.tanggal = d.iso; header = header.replace(d.matched, " "); }
  const hNo = header.match(/^\s*#?\s*(\d{1,2})\s*$/);
  const headerPlanNo = hNo ? Number(hNo[1]) : null;

  // Konteks tingkat kunjungan (di luar blok) — juga menampung isian laporan
  // satu alat tanpa blok bernomor.
  const top = blokKosong(1);
  top.planNo = headerPlanNo;
  let cur: TeknisiReportBlok | null = null;
  // Blok yang statusnya ditulis tapi tak dikenal — jangan ditagih "Status wajib" lagi.
  const statusSalah = new Set<TeknisiReportBlok>();
  let last: { b: TeknisiReportBlok | null; f: Field } | null = null;
  const tambah = (prev: string | null, v: string) => (prev ? `${prev}\n${v}` : v);

  const isi = (b: TeknisiReportBlok, f: Field, v: string, visit: boolean) => {
    switch (f) {
      case "faskes": if (v) out.faskes = v; return;
      case "catatan":
        if (visit) out.catatan = tambah(out.catatan, v); else b.catatan = tambah(b.catatan, v);
        return;
      case "foto": return;
      case "alat": { const sa = pisahSnAlat(v); if (sa.sn && !b.sn) b.sn = sa.sn; b.alat = sa.alat ?? b.alat; return; }
      case "sn": b.sn = v.replace(/^(?:s\/?n)\s*/i, "").trim() || null; return;
      case "jenis": {
        const jt = pisahJenisTiket(v);
        if (!jt.jenis) { out.errors.push(`Blok ${b.nomor}: jenis "${v}" tak dikenal. Pilih: ${JENIS_TEKNISI.join(" · ")}.`); return; }
        b.jenis = jt.jenis; if (jt.tiket) b.tiket = jt.tiket; return;
      }
      case "tiket": { const m = v.match(TIKET); b.tiket = m ? `T-${m[1]}` : (v || null); return; }
      case "status": {
        const st = parseStatus(v);
        if (!st.status) {
          statusSalah.add(b);
          out.errors.push(`Blok ${b.nomor}: status "${v}" tak dikenal. Pakai Selesai / Pending ALASAN / Batal ALASAN / Revisit.`);
          return;
        }
        b.status = st.status; b.alasan = st.alasan; return;
      }
      case "kegiatan": b.kegiatan = tambah(b.kegiatan, v); return;
      case "tes": {
        if (!v || TANPA.test(v)) { b.jumlahTes = null; return; }
        const n = v.replace(/\s*(tes|test)\s*$/i, "").replace(/[.,\s]/g, "");
        if (!/^\d+$/.test(n)) { out.errors.push(`Blok ${b.nomor}: Jumlah Tes "${v}" harus angka.`); return; }
        b.jumlahTes = Number(n); return;
      }
      case "sparepart": b.sparepart = !v || TANPA.test(v) ? null : tambah(b.sparepart, v); return;
    }
  };

  // Baris kosong TIDAK menutup blok — teknisi sering memberi jarak antara judul
  // blok dan isinya, atau di tengah Kegiatan. Yang berubah sesudah baris kosong
  // hanya `Catatan:` (pindah ke tingkat kunjungan, bentuk "…\n\nCatatan: …" di
  // spesifikasi) dan baris bernomor (selalu blok alat baru).
  let jeda = false;
  for (const raw of lines.slice(h + 1)) {
    if (!raw.trim()) { jeda = true; continue; }
    const lanjutan = !!last && (last.f === "kegiatan" || last.f === "catatan" || last.f === "sparepart");
    const bm = raw.match(BLOK_LINE);
    // "1. bersihkan probe" tepat di bawah Kegiatan = daftar isi kegiatan, bukan
    // alat baru — kecuali judulnya jelas judul alat (`|`, `#2`, `SN …`).
    if (bm && !(lanjutan && !jeda && !judulBlokJelas(bm[2]))) {
      cur = blokKosong(out.blok.length + 1);
      out.blok.push(cur);
      last = null;
      jeda = false;
      const e = bm[2].trim() ? bacaJudul(cur, bm[2].trim()) : null;
      if (e) out.errors.push(e);
      continue;
    }
    const lm = bm ? null : raw.match(LABEL_LINE);
    const f = lm ? LABEL[norm(lm[1])] : undefined;
    if (lm && f) {
      const v = lm[2].trim();
      // RS selalu tingkat kunjungan; Catatan sebelum blok pertama atau sesudah
      // baris kosong juga. Isian lain masuk blok terakhir.
      const keKunjungan = !cur || (jeda && f === "catatan");
      const b = keKunjungan || !cur ? top : cur;
      isi(b, f, v, keKunjungan && f === "catatan" && out.blok.length > 0);
      last = { b, f };
      jeda = false;
      continue;
    }
    jeda = false;
    // Label asing ditolak, KECUALI di dalam teks bebas Kegiatan/Catatan
    // ("Kegiatan: cek tray\nhasil akhir: normal") — di sana ia isi kalimat.
    if (lm && !f && !lanjutan) {
      out.errors.push(`Label "${lm[1].trim()}" tak dikenal.`);
      continue;
    }
    // Baris lanjutan dari isian sebelumnya (kegiatan/catatan multi-baris).
    if (last && lanjutan) {
      isi(last.b ?? top, last.f, raw.trim(), !last.b || (last.b === top && out.blok.length > 0));
      continue;
    }
    out.errors.push(`Baris "${raw.trim().slice(0, 40)}" tak terbaca — pakai label seperti \`Status:\` / \`Kegiatan:\`.`);
  }

  if (out.blok.length === 0) {
    // Laporan satu alat tanpa blok. Catatan di sini milik alat itu sekaligus kunjungan.
    if (top.catatan) out.catatan = top.catatan;
    out.blok.push(top);
  } else {
    if (top.catatan) out.catatan = tambah(out.catatan, top.catatan);
    const nyasar = top.status || top.kegiatan || top.jumlahTes != null || top.sn || top.alat;
    if (nyasar) out.errors.push("Isian alat di luar blok bernomor — taruh `Status:`/`Kegiatan:` di bawah `1) …`.");
  }

  for (const b of out.blok) {
    if (!b.jenis && opts.jenisDefault) b.jenis = opts.jenisDefault;
    if (b.planNo == null && !b.sn && !b.alat) {
      out.errors.push(`Blok ${b.nomor}: identitas alat kosong — tulis nomor plan (\`#1\`) atau \`SN:\`/\`Alat:\`.`);
    }
    if (b.planNo == null && !out.faskes) {
      out.errors.push(`Blok ${b.nomor}: tanpa nomor plan, \`RS:\` wajib diisi.`);
    }
    if (!b.status) {
      if (!statusSalah.has(b)) out.errors.push(`Blok ${b.nomor}: \`Status:\` wajib (Selesai / Pending ALASAN / Batal ALASAN / Revisit).`);
    } else if ((b.status === "Pending" || b.status === "Batal") && !b.alasan) {
      const alasan = b.catatan ?? (out.blok.length === 1 ? out.catatan : null);
      if (alasan) b.alasan = alasan;
      else out.errors.push(`Blok ${b.nomor}: status ${b.status} perlu alasan (mis. \`Status: ${b.status} sparepart belum datang\`).`);
    }
  }
  // Galat dari label yang sama bisa tercatat dua kali (mis. jenis di judul & baris).
  out.errors = [...new Set(out.errors)];
  return out;
}

// ---------------------------------------------------------------------------
// Contoh format untuk balasan bot saat pesan tak terbaca.
// ---------------------------------------------------------------------------

export const CONTOH_PLAN_TEKNISI = [
  "#PLAN 7 Nov",
  "1. RSUD Trenggalek | 0832 | PM",
  "2. RS PTP Jember | CM250 | Service",
  `Jenis: ${JENIS_TEKNISI.join(" · ")}`,
].join("\n");

export const CONTOH_REPORT_TEKNISI = [
  "#REPORT 1",
  "Status: Selesai",
  "Kegiatan: bersihkan probe, kalibrasi",
  "Jumlah Tes: 2150",
  "Pergantian Sparepart: -",
  "",
  "atau tanpa plan:",
  "#REPORT",
  "RS: RS Al Irsyad",
  "Alat: DxH 560",
  "SN: 4471",
  "Jenis: Service",
  "Status: Selesai",
  "Kegiatan: reset sensor",
  "",
  "beberapa alat di satu RS:",
  "#REPORT",
  "RS: RSUD Trenggalek",
  "1) SN 0832 | EXC200 | PM",
  "Status: Selesai",
  "2) #2",
  "Status: Pending sparepart",
].join("\n");

// ---------------------------------------------------------------------------
// Balasan bot (pure, supaya bisa diuji tanpa DB).
// ---------------------------------------------------------------------------

const ekorSn = (sn: string | null) => (sn ? `…${sn.replace(/\s/g, "").slice(-4)}` : null);

export function balasanPlanTeknisi(input: {
  nama: string;
  tanggalTampil: string;
  late: boolean;
  items: { urut: number; faskes: string; alatLabel: string | null; jenis: string; masalah: string | null }[];
  dilewati: number[];
}): string {
  // Daftar item TIDAK diulang di balasan (permintaan user 14 Nov 2026: teknisi sudah
  // menulisnya sendiri). Yang ditampilkan hanya ringkasan + item yang bermasalah.
  const baris = [`✅ Plan tercatat, ${input.nama}`, `📅 ${input.tanggalTampil} · ${input.items.length} alat`];
  if (input.late) baris.push("⚠️ telat (lewat batas)");
  const bermasalah = input.items.filter((i) => i.masalah);
  if (bermasalah.length) {
    baris.push("");
    for (const it of bermasalah) baris.push(`⚠️ No. ${it.urut}: ${it.masalah}`);
  }
  if (input.dilewati.length) {
    baris.push("", `ℹ️ No. ${input.dilewati.join(", ")} sudah dilaporkan — tak diganti.`);
  }
  if (bermasalah.length) {
    baris.push("", "Item bertanda ⚠️ tetap tersimpan; laporkan dengan SN supaya alatnya pasti.");
  }
  return baris.join("\n");
}

export function balasanReportTeknisi(input: {
  faskes: string | null;
  alat: { nomor: number; alatLabel: string | null; sn: string | null; jenis: string | null; status: string; alasan: string | null; masalah: string | null; efek?: string | null }[];
  foto?: number;
}): string {
  const n = input.alat.length;
  const baris = [`✅ ${input.faskes ?? "Kunjungan"} — ${n} alat tercatat`];
  for (const a of input.alat) {
    const sn = ekorSn(a.sn);
    const nama = [a.alatLabel ?? "alat ?", sn ? `(${sn})` : null].filter(Boolean).join(" ");
    const status = a.alasan && a.status !== "Selesai" ? `${a.status} ${a.alasan}` : a.status;
    baris.push(`${a.nomor}. ${nama} · ${a.jenis ?? "jenis ?"} · ${status}`);
    if (a.masalah) baris.push(`   ⚠️ perlu cek: ${a.masalah}`);
    if (a.efek) baris.push(`   ↳ ${a.efek}`);
  }
  if (input.foto) baris.push(`📷 ${input.foto} foto terlampir`);
  return baris.join("\n");
}

export function balasanFormatSalah(kind: "plan" | "report", nama: string, errors: string[]): string {
  const contoh = kind === "plan" ? CONTOH_PLAN_TEKNISI : CONTOH_REPORT_TEKNISI;
  return [
    `⚠️ ${kind === "plan" ? "Plan" : "Report"} teknisi belum tersimpan, ${nama}:`,
    ...errors.slice(0, 6).map((e) => `• ${e}`),
    "",
    "Kirim ulang lengkap. Contoh:",
    contoh,
  ].join("\n");
}
