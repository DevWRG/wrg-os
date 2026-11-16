import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { addComment, generateTicketNo, transitionTicket } from "./ga-helpdesk.js";

// Aduan GA dari WhatsApp → Helpdesk GA (F139). Permintaan user 16 Nov 2026:
// semua aduan & permintaan di grup WA "Aduan GA" dicatat sebagai tiket
// Helpdesk; balasan staf GA dicatat sebagai progres atau selesai.
//
// Pola detect-leave (repo/detectleave.ts): pindai wa_message satu grup, putus
// lewat LLM (services/ai /triage-aduan-ga, flash-lite), tandai di tabel seen
// (ga_aduan_wa_seen, migrasi 324). Bedanya:
//   - pesan dikirim BERKELOMPOK (satu panggilan LLM per ≤25 pesan) beserta
//     daftar tiket terbuka — satu aduan bisa dibalas berhari-hari kemudian, jadi
//     pesan tetangga saja tak cukup untuk menautkan balasan ke tiketnya;
//   - TIDAK membalas apa pun ke grup. Pencatatan diam-diam;
//   - waktu tiket/timeline = waktu pesan, bukan waktu pemindaian, supaya
//     backfill pesan lama menghasilkan riwayat & SLA yang benar.
//
// wa_message tak menyimpan quoted-reply dan nomor pengirim grup — staf GA
// dikenali dari nama tampilan WA yang diisi lewat UI (ga_aduan_wa_config).

const grupAduan = (): string[] =>
  (process.env.GA_ADUAN_GROUP_JID || "120363412331931173@g.us")
    .split(",").map((s) => s.trim()).filter(Boolean);
const ukuranKelompok = (): number => Math.max(1, Math.min(50, Number(process.env.GA_ADUAN_BATCH) || 25));
// Batas kelompok per jalan — backfill ~230 pesan selesai dalam satu jalan,
// tapi kekeliruan (mis. loop) tak bisa menghabiskan kuota LLM mingguan.
const maksKelompok = (): number => Math.max(1, Number(process.env.GA_ADUAN_MAX_BATCH) || 12);
const JUMLAH_KONTEKS = 8;
// Di bawah ini progres/selesai tak mengubah status — cukup dicatat sebagai
// komentar (tiket tetap di status sekarang). Aduan di bawah YAKIN_ADUAN diabaikan.
const YAKIN_STATUS = 0.6;
const YAKIN_ADUAN = 0.5;

// ───────────────────────── Fungsi murni (dites) ─────────────────────────

export interface PesanAduan {
  mid: string;
  ref: string;
  pengirim: string;
  stafGa: boolean;
  isi: string;
  at: Date;
}

export interface AksiLlm {
  ref: string;
  jenis: string;
  tiket: string | null;
  judul: string | null;
  kategori: string | null;
  lokasi: string | null;
  prioritas: string | null;
  yakin: number;
}

export type Target = { ticketNo: string } | { ref: string };

export type Rencana =
  | { op: "buat"; aksi: AksiLlm }
  | { op: "progres" | "selesai" | "batal" | "komentar"; target: Target }
  | { op: "abaikan" | "tak-tertaut" | "tanpa-putusan"; catatan: string };

// Bersihkan isi pesan sebelum ke LLM / komentar tiket.
export function bersihkanIsi(body: string): string {
  return body
    .replace(/\[whatsapp attachment unavailable\]/gi, "(lampiran)")
    .replace(/@\d{8,}/g, "@…")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStafGa(nama: string, daftar: readonly string[]): boolean {
  const n = nama.trim().toLowerCase();
  return n !== "" && daftar.some((d) => d.trim().toLowerCase() === n);
}

// Pesan yang tak perlu ke LLM sama sekali.
export function abaikanTanpaLlm(body: string): string | null {
  const isi = body.trim();
  if (!isi) return "kosong";
  // #HELPDESK dsb. sudah ditangani jalur hashtag (inbound.ts) — jangan dobel.
  if (isi.startsWith("#")) return "hashtag";
  return null;
}

// Terjemahkan putusan LLM per pesan jadi rencana yang aman dijalankan.
// `tiketTerbuka` = nomor tiket yang ditawarkan ke LLM; target di luar itu
// (atau ref aduan baru yang tak ada di kelompok ini) dianggap tak tertaut.
export function rencanakan(pesan: PesanAduan[], aksi: AksiLlm[], tiketTerbuka: ReadonlySet<string>): Map<string, Rencana> {
  const perRef = new Map(aksi.map((a) => [a.ref, a]));
  const refAduanBaru = new Set<string>();
  const out = new Map<string, Rencana>();
  for (const p of pesan) {
    const a = perRef.get(p.ref);
    if (!a) {
      out.set(p.ref, { op: "tanpa-putusan", catatan: "LLM tak memutus pesan ini" });
      continue;
    }
    if (a.jenis === "aduan_baru") {
      // Staf GA tidak melapor ke dirinya sendiri — pertanyaan diagnosa GA
      // ("di ruternya ada nyala merah?") sempat dianggap aduan baru (uji dev 16 Nov).
      if (p.stafGa) {
        out.set(p.ref, { op: "abaikan", catatan: "pesan staf GA tak membuka tiket" });
        continue;
      }
      if (a.yakin < YAKIN_ADUAN) {
        out.set(p.ref, { op: "abaikan", catatan: `aduan ragu (yakin ${a.yakin.toFixed(2)})` });
        continue;
      }
      refAduanBaru.add(p.ref);
      out.set(p.ref, { op: "buat", aksi: a });
      continue;
    }
    if (a.jenis === "abaikan") {
      out.set(p.ref, { op: "abaikan", catatan: "obrolan" });
      continue;
    }
    // progres / selesai / komentar — butuh target yang sah.
    const t = (a.tiket ?? "").trim();
    let target: Target | null = null;
    if (tiketTerbuka.has(t)) target = { ticketNo: t };
    else if (refAduanBaru.has(t)) target = { ref: t };
    if (!target) {
      out.set(p.ref, {
        op: a.jenis === "komentar" ? "abaikan" : "tak-tertaut",
        catatan: t ? `target ${t} tidak dikenal` : "tiket tidak ditentukan",
      });
      continue;
    }
    let op: "progres" | "selesai" | "batal" | "komentar" =
      a.jenis === "selesai" ? "selesai" : a.jenis === "progres" ? "progres" : a.jenis === "batal" ? "batal" : "komentar";
    // Kabar progres hanya sah dari staf GA; pelapor boleh menyatakan selesai
    // ("wah iya nyala, terima kasih"). Putusan ragu → komentar saja.
    if (op === "progres" && !p.stafGa) op = "komentar";
    if (op !== "komentar" && a.yakin < YAKIN_STATUS) op = "komentar";
    out.set(p.ref, { op, target });
  }
  return out;
}

const fmtWib = (d: Date): string => {
  const w = new Date(d.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`;
};

export function teksKomentar(p: Pick<PesanAduan, "pengirim" | "isi" | "at">): string {
  return `💬 WA ${fmtWib(p.at)} — ${p.pengirim || "?"}: ${p.isi}`;
}

// ───────────────────────── Pengaturan (UI) ─────────────────────────

export interface GaAduanConfig {
  staf_ga_names: string[];
  group_jids: string[];
  updated_at: string | null;
  updated_by: string | null;
}

export async function getGaAduanConfig(): Promise<GaAduanConfig> {
  const [r] = await db()`SELECT staf_ga_names, updated_at, updated_by FROM ga_aduan_wa_config WHERE id`;
  return {
    staf_ga_names: (r?.staf_ga_names as string[] | undefined) ?? [],
    group_jids: grupAduan(),
    updated_at: r?.updated_at ? new Date(r.updated_at as string).toISOString() : null,
    updated_by: r?.updated_by ? String(r.updated_by) : null,
  };
}

export async function setGaAduanStaf(names: string[], updatedBy: string | null): Promise<GaAduanConfig> {
  const bersih = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20);
  await db()`
    INSERT INTO ga_aduan_wa_config (id, staf_ga_names, updated_at, updated_by)
    VALUES (true, ${bersih}, now(), ${updatedBy})
    ON CONFLICT (id) DO UPDATE SET staf_ga_names = EXCLUDED.staf_ga_names, updated_at = now(), updated_by = EXCLUDED.updated_by
  `;
  return getGaAduanConfig();
}

export interface GaAduanStatistik {
  tiket_dari_wa: number;
  tiket_terbuka: number;
  pesan_diproses: number;
  pesan_belum: number;
  per_status: Record<string, number>;
  terakhir_diproses: string | null;
}

export async function getGaAduanStatistik(): Promise<GaAduanStatistik> {
  const sql = db();
  const [t] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status IN ('open','in_progress','waiting'))::int AS terbuka
    FROM ga_tickets WHERE source_wa_message_id IS NOT NULL
  `;
  const per = await sql`SELECT status, count(*)::int AS n, max(created_at) AS akhir FROM ga_aduan_wa_seen GROUP BY status`;
  const [b] = await sql`
    SELECT count(*)::int AS n FROM wa_message m
    WHERE m.group_jid = ANY(${grupAduan()})
      AND NOT EXISTS (SELECT 1 FROM ga_aduan_wa_seen s WHERE s.message_id = COALESCE(m.message_id, m.id::text))
  `;
  const per_status: Record<string, number> = {};
  let akhir: Date | null = null;
  for (const r of per) {
    per_status[String(r.status)] = Number(r.n);
    const a = r.akhir ? new Date(r.akhir as string) : null;
    if (a && (!akhir || a > akhir)) akhir = a;
  }
  return {
    tiket_dari_wa: Number(t.total),
    tiket_terbuka: Number(t.terbuka),
    pesan_diproses: Object.values(per_status).reduce((x, y) => x + y, 0),
    pesan_belum: Number(b.n),
    per_status,
    terakhir_diproses: akhir ? akhir.toISOString() : null,
  };
}

// ───────────────────────── Pemindai ─────────────────────────

export interface GaAduanScanResult {
  dipindai: number;
  kelompok: number;
  dibuat: number;
  progres: number;
  selesai: number;
  batal: number;
  komentar: number;
  abaikan: number;
  tak_tertaut: number;
  tokens_in: number;
  tokens_out: number;
  model: string | null;
  berhenti?: string;
}

interface Kategori { id: string; sla: number; prioritas: string }

async function tandai(mid: string, status: string, ticketId: string | null, catatan: string | null): Promise<void> {
  await db()`
    INSERT INTO ga_aduan_wa_seen (message_id, status, ticket_id, catatan)
    VALUES (${mid}, ${status}, ${ticketId}, ${catatan})
    ON CONFLICT (message_id) DO NOTHING
  `;
}

async function buatTiket(p: PesanAduan, a: AksiLlm, kat: Map<string, Kategori>): Promise<string> {
  const sql = db();
  const k = kat.get(a.kategori ?? "") ?? kat.get("UMUM") ?? [...kat.values()][0];
  const prioritas = a.prioritas ?? k.prioritas;
  const slaDue = new Date(p.at.getTime() + k.sla * 3_600_000);
  const judul = (a.judul || p.isi).slice(0, 120);
  // Pesan lama (backfill) yang SLA-nya sudah lewat ditandai sudah dialert —
  // alert overdue (ke assignee + HoD) tak boleh meledak untuk aduan lama. Pola 306.
  const alertLama = slaDue.getTime() < Date.now() ? new Date().toISOString() : null;
  const deskripsi = `Dari grup WA Aduan GA (${fmtWib(p.at)}):\n${p.isi}`;
  const [ins] = await sql`
    INSERT INTO ga_tickets (
      ticket_no, title, description, category_id, priority, reporter_name_override, location,
      sla_due_at, opened_at, created_at, source_wa_message_id, sla_alert_sent_at
    ) VALUES (
      ${await generateTicketNo()}, ${judul}, ${deskripsi}, ${k.id}, ${prioritas},
      ${p.pengirim || "Pelapor WA"}, ${a.lokasi}, ${slaDue.toISOString()}, ${p.at.toISOString()}, ${p.at.toISOString()},
      ${p.mid}, ${alertLama}
    )
    ON CONFLICT (source_wa_message_id) DO NOTHING
    RETURNING id
  `;
  if (ins) return String(ins.id);
  // Sudah dibuat di jalan sebelumnya yang terputus sebelum sempat menandai.
  const [ada] = await sql`SELECT id FROM ga_tickets WHERE source_wa_message_id = ${p.mid}`;
  return String(ada.id);
}

// Naikkan status ke tujuan lewat state machine Helpdesk, dengan waktu pesan.
async function majukanStatus(ticketId: string, tujuan: "in_progress" | "completed", p: PesanAduan): Promise<boolean> {
  const sql = db();
  const [t] = await sql`SELECT status, assignee_user_id, assignee_name_override FROM ga_tickets WHERE id = ${ticketId}`;
  if (!t) return false;
  if (p.stafGa && !t.assignee_user_id && !t.assignee_name_override) {
    await sql`UPDATE ga_tickets SET assignee_name_override = ${p.pengirim}, updated_at = now() WHERE id = ${ticketId}`;
  }
  const note = `Dari WA Aduan GA — ${p.pengirim}`;
  let status = String(t.status);
  if (status === "open" || status === "waiting") {
    const r = await transitionTicket(ticketId, "in_progress", { note, at: p.at });
    if (!r.ok) return false;
    status = "in_progress";
  }
  if (tujuan === "completed" && status === "in_progress") {
    const r = await transitionTicket(ticketId, "completed", { note, at: p.at });
    return r.ok;
  }
  return status === tujuan;
}

export async function runGaAduanScan(opts: { dryRun?: boolean } = {}): Promise<GaAduanScanResult> {
  const sql = db();
  const res: GaAduanScanResult = {
    dipindai: 0, kelompok: 0, dibuat: 0, progres: 0, selesai: 0, batal: 0, komentar: 0, abaikan: 0, tak_tertaut: 0,
    tokens_in: 0, tokens_out: 0, model: null,
  };
  const cfg = await getGaAduanConfig();
  if (cfg.staf_ga_names.length === 0) return { ...res, berhenti: "nama staf GA belum diatur (Helpdesk GA → tab Aduan WA)" };

  const katRows = await sql`SELECT id, code, default_sla_hours, default_priority FROM ga_ticket_categories WHERE active`;
  const kat = new Map<string, Kategori>(
    katRows.map((r) => [String(r.code).toUpperCase(), { id: String(r.id), sla: Number(r.default_sla_hours), prioritas: String(r.default_priority) }]),
  );
  if (kat.size === 0) return { ...res, berhenti: "tak ada kategori Helpdesk aktif" };
  const grup = grupAduan();
  const sejak = process.env.GA_ADUAN_SCAN_SINCE || null;

  for (let k = 0; k < maksKelompok(); k++) {
    const rows = await sql`
      SELECT COALESCE(m.message_id, m.id::text) AS mid, m.sender_name, m.body, m.received_at
      FROM wa_message m
      WHERE m.group_jid = ANY(${grup})
        AND ${sejak ? sql`m.received_at >= ${sejak}` : sql`true`}
        AND NOT EXISTS (SELECT 1 FROM ga_aduan_wa_seen s WHERE s.message_id = COALESCE(m.message_id, m.id::text))
      ORDER BY m.received_at, m.id
      LIMIT ${ukuranKelompok()}
    `;
    if (rows.length === 0) break;

    const pesan: PesanAduan[] = [];
    for (const r of rows) {
      res.dipindai += 1;
      const body = String(r.body ?? "");
      const skip = abaikanTanpaLlm(body);
      if (skip) {
        res.abaikan += 1;
        if (!opts.dryRun) await tandai(String(r.mid), "abaikan", null, skip);
        continue;
      }
      pesan.push({
        mid: String(r.mid),
        ref: `M${pesan.length + 1}`,
        pengirim: String(r.sender_name ?? "").trim(),
        stafGa: isStafGa(String(r.sender_name ?? ""), cfg.staf_ga_names),
        isi: bersihkanIsi(body),
        at: new Date(r.received_at as string),
      });
    }
    if (pesan.length === 0) continue;

    const konteks = await sql`
      SELECT sender_name, body, received_at FROM wa_message
      WHERE group_jid = ANY(${grup}) AND received_at < ${pesan[0].at.toISOString()} AND coalesce(body, '') <> ''
      ORDER BY received_at DESC LIMIT ${JUMLAH_KONTEKS}
    `;
    const terbuka = await sql`
      SELECT id, ticket_no, title, status, opened_at, reporter_name_override FROM ga_tickets
      WHERE source_wa_message_id IS NOT NULL AND status IN ('open','in_progress','waiting')
      ORDER BY opened_at DESC LIMIT 40
    `;
    const idPerNo = new Map(terbuka.map((t) => [String(t.ticket_no), String(t.id)]));

    const { status, data } = await callAi("/triage-aduan-ga", {
      pesan: pesan.map((p) => ({ ref: p.ref, waktu: fmtWib(p.at), pengirim: p.pengirim, staf_ga: p.stafGa, isi: p.isi })),
      konteks: [...konteks].reverse().map((r, i) => ({
        ref: `K${i + 1}`, waktu: fmtWib(new Date(r.received_at as string)), pengirim: String(r.sender_name ?? ""),
        staf_ga: isStafGa(String(r.sender_name ?? ""), cfg.staf_ga_names), isi: bersihkanIsi(String(r.body ?? "")),
      })),
      tiket: terbuka.map((t) => ({
        no: String(t.ticket_no), status: String(t.status), dibuka: fmtWib(new Date(t.opened_at as string)),
        pelapor: t.reporter_name_override ? String(t.reporter_name_override) : null, judul: String(t.title),
      })),
      kategori: [...kat.keys()],
      dry_run: aiDryRun(),
    });
    // Tanpa putusan LLM sungguhan → jangan tandai apa pun; jalan berikutnya mencoba lagi.
    if (status !== 200 || data.dry_run === true || data.parse_gagal === true) {
      return { ...res, berhenti: status !== 200 ? `ai-${status}: ${String(data.error ?? "")}`.slice(0, 200) : data.parse_gagal ? "ai-json-rusak" : "ai-tanpa-llm" };
    }
    res.kelompok += 1;
    res.model = data.model ? String(data.model) : res.model;
    res.tokens_in += Number(data.tokens_in ?? 0);
    res.tokens_out += Number(data.tokens_out ?? 0);

    const rencana = rencanakan(pesan, (data.aksi as AksiLlm[]) ?? [], new Set(idPerNo.keys()));
    const idPerRef = new Map<string, string>();
    for (const p of pesan) {
      const r = rencana.get(p.ref)!;
      if ("catatan" in r) {
        if (r.op === "tak-tertaut") res.tak_tertaut += 1;
        else res.abaikan += 1;
        if (!opts.dryRun) await tandai(p.mid, r.op, null, r.catatan);
        continue;
      }
      if (r.op === "buat") {
        res.dibuat += 1;
        if (opts.dryRun) { idPerRef.set(p.ref, "dry-run"); continue; }
        const id = await buatTiket(p, r.aksi, kat);
        idPerRef.set(p.ref, id);
        await tandai(p.mid, "aduan-baru", id, null);
        continue;
      }
      const ticketId = "ticketNo" in r.target ? idPerNo.get(r.target.ticketNo) : idPerRef.get(r.target.ref);
      if (!ticketId) {
        res.tak_tertaut += 1;
        if (!opts.dryRun) await tandai(p.mid, "tak-tertaut", null, "tiket target gagal dibuat");
        continue;
      }
      if (r.op === "progres") res.progres += 1;
      else if (r.op === "selesai") res.selesai += 1;
      else if (r.op === "batal") res.batal += 1;
      else res.komentar += 1;
      if (opts.dryRun) continue;
      await addComment(ticketId, { comment: teksKomentar(p), at: p.at });
      let catatan: string | null = null;
      if (r.op === "batal") {
        const b = await transitionTicket(ticketId, "cancelled", { note: `Dibatalkan pelapor lewat WA — ${p.pengirim}`, at: p.at });
        if (!b.ok) catatan = `tak bisa dibatalkan: ${b.error ?? "?"} — dicatat sebagai komentar`;
      } else if (r.op !== "komentar") {
        const ok = await majukanStatus(ticketId, r.op === "selesai" ? "completed" : "in_progress", p);
        if (!ok) catatan = "status tak bisa dimajukan (sudah selesai/dibatalkan?) — dicatat sebagai komentar";
      }
      await tandai(p.mid, r.op, ticketId, catatan);
    }
    // dry-run tak menandai apa pun → kelompok berikutnya = pesan yang sama.
    if (opts.dryRun) break;
  }
  return res;
}
