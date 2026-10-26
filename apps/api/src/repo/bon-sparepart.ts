// F155 Bon Sparepart Teknisi (#BON) & #OPNAME.
//
// Direktur (rapat 19 Okt 2026): teknisi membawa sparepart urgent saat kantor tutup (bypass alur PO
// customer → SJ). Gudang membuat bon; teknisi mengajukan `#BON <nama sparepart>`; `#OPNAME` menampilkan
// bon yang sudah dilaporkan vs belum + rekonsiliasi bon yang sudah jadi SJ.
//
// Keputusan user 26 Okt 2026:
//   - bon gudang di-input Admin Gudang di dashboard; teknisi melapor lewat #BON;
//   - rekonsiliasi ke SJ: otomatis bila TEPAT satu SJ cocok, selain itu diisi/dipilih manual;
//     hanya BACA mirror Accurate (accurate_delivery_order[_item]), tak menulis ke Accurate;
//   - #BON banyak baris + qty; #OPNAME read-only untuk non-teknisi; tanpa broadcast.
//
// Format:
//   #BON                         ← bantuan
//   #BON Pompa peristaltik x2    ← baris pertama boleh langsung barang
//   Lampu halogen 12V            ← tiap baris: nama [x<jumlah>] (jumlah kosong = 1)
//   Selang silikon x3
//   #BON status                  ← bon saya (30 hari)
// Jumlah hanya dikenali bentuk "x2" / "× 2" / "2 pcs" — angka polos di ujung nama dianggap bagian nama
// ("Lampu 12", "Filter 5 micron" tak boleh jadi jumlah).

import { db } from "../db.js";
import { stripInvisible } from "../parsers/dailyplan.js";

// ── Murni ────────────────────────────────────────────────────────────────

export type PerintahBon =
  | { aksi: "bantuan" }
  | { aksi: "status" }
  | { aksi: "baru"; baris: BarisBon[] };
export interface BarisBon { teks: string; query: string; qty: number }

const BON_LINE = /^\s*#\s*bon\b/i;
const QTY_AKHIR = /^(.+?)\s*(?:[x×]\s*(\d+(?:[.,]\d+)?)|\s(\d+(?:[.,]\d+)?)\s*(?:pcs|pc|unit|buah|set|pak|pack|box|btl|roll|meter|m))\s*$/i;

export function parseBon(body: string): PerintahBon {
  const baris = stripInvisible(body).split(/\r?\n/);
  const i = baris.findIndex((l) => BON_LINE.test(l));
  if (i < 0) return { aksi: "bantuan" };
  const kepala = baris[i].replace(BON_LINE, "").trim();
  if (/^status$/i.test(kepala)) return { aksi: "status" };
  const mentah = [kepala, ...baris.slice(i + 1)].map((l) => l.trim().replace(/^[-•*]\s*/, "")).filter(Boolean);
  if (!mentah.length) return { aksi: "bantuan" };
  const isi: BarisBon[] = mentah.map((t) => {
    const m = t.match(QTY_AKHIR);
    if (!m) return { teks: t, query: t, qty: 1 };
    return { teks: t, query: m[1].trim(), qty: Number((m[2] ?? m[3]).replace(",", ".")) };
  });
  return { aksi: "baru", baris: isi };
}

export const BANTUAN_BON =
  "Format #BON (sparepart yang Anda bawa dari gudang):\n#BON Pompa peristaltik x2\nLampu halogen 12V\nSelang silikon x3\n\n" +
  "Satu barang per baris, nama atau kode Accurate; jumlah ditulis x2 (kosong = 1). Cek bon Anda: #BON status";

export interface KandidatSparepart { item_id: number; no: string | null; nama: string; satuan: string | null }
export interface HasilBarisBon { ok: boolean; teks: string; masalah?: string; item?: KandidatSparepart; qty?: number }

/** Murni: nilai satu baris terhadap kandidat master item (dipisah supaya bisa diuji tanpa DB). */
export function nilaiBarisBon(b: BarisBon, kandidat: KandidatSparepart[]): HasilBarisBon {
  if (!Number.isFinite(b.qty) || b.qty <= 0) return { ok: false, teks: b.teks, masalah: "jumlah tak terbaca — tulis mis. \"Pompa x2\"" };
  if (!kandidat.length) return { ok: false, teks: b.teks, masalah: "barang tidak ditemukan di master Accurate — coba kata lain atau kode item" };
  if (kandidat.length > 1) {
    return { ok: false, teks: b.teks, masalah: `cocok ke ${kandidat.length >= 6 ? "banyak" : kandidat.length} barang, tulis kodenya: ${kandidat.slice(0, 3).map((k) => `${k.no ?? "tanpa kode"} ${k.nama}`).join(" · ")}` };
  }
  return { ok: true, teks: b.teks, item: kandidat[0], qty: b.qty };
}

const fmtQty = (n: number): string => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
export const kodeBon = (id: number | string): string => `BN${id}`;

export interface BonItem { urut: number; item_id: number | null; item_no: string | null; item_nama: string; qty: number; satuan: string | null; dilaporkan_qty: number }
export interface BonRow {
  id: number;
  kode: string;
  teknisi_id: string;
  teknisi_nama: string;
  asal: "gudang" | "teknisi";
  status: "dibuat" | "dilaporkan" | "selesai" | "batal";
  customer_nama: string | null;
  catatan: string | null;
  dibuat_oleh: string;
  dibuat_at: string;
  dilaporkan_at: string | null;
  sj_number: string | null;
  sj_sumber: "otomatis" | "manual" | null;
  hari: number;                 // umur sejak dibuat (hari penuh)
  item: BonItem[];
}

export interface Opname {
  /** Bon gudang yang belum (lengkap) dilaporkan teknisinya. */
  belum_dilaporkan: BonRow[];
  /** Sudah dilaporkan teknisi, SJ belum ditemukan/tertaut. */
  dilaporkan_belum_sj: BonRow[];
  /** Lahir dari #BON tanpa bon gudang (dan belum selesai). */
  tanpa_bon_gudang: BonRow[];
  /** SJ tertaut (rekonsiliasi selesai), terbaru dulu. */
  selesai: BonRow[];
}

/** Murni (diuji): kelompokkan bon ke empat daftar opname. `batal` dibuang. */
export function kelompokOpname(rows: BonRow[]): Opname {
  const aktif = rows.filter((r) => r.status !== "batal");
  return {
    belum_dilaporkan: aktif.filter((r) => r.status === "dibuat"),
    dilaporkan_belum_sj: aktif.filter((r) => r.status === "dilaporkan" && r.asal === "gudang"),
    tanpa_bon_gudang: aktif.filter((r) => r.status === "dilaporkan" && r.asal === "teknisi"),
    selesai: aktif.filter((r) => r.status === "selesai"),
  };
}

const ringkasItem = (b: BonRow): string => b.item.slice(0, 3).map((i) => `${i.item_nama} ×${fmtQty(i.qty)}`).join(", ") + (b.item.length > 3 ? ` +${b.item.length - 3}` : "");
const umur = (h: number): string => (h <= 0 ? "hari ini" : `${h} hari lalu`);
const BATAS = 8;
function blok(judul: string, rows: BonRow[], baris: (b: BonRow) => string): string[] {
  if (!rows.length) return [];
  return [``, `${judul} (${rows.length}):`, ...rows.slice(0, BATAS).map(baris), ...(rows.length > BATAS ? [`… +${rows.length - BATAS} lagi — lihat menu Bon Sparepart`] : [])];
}

export function balasanOpname(o: Opname, ditautkan = 0): string {
  const kosong = !o.belum_dilaporkan.length && !o.dilaporkan_belum_sj.length && !o.tanpa_bon_gudang.length;
  const out = [`📦 *Opname bon sparepart*${ditautkan ? ` — ${ditautkan} bon baru tertaut ke SJ` : ""}`];
  if (kosong) out.push("Tidak ada bon yang menggantung. ✅");
  out.push(
    ...blok("⏳ Belum dilaporkan teknisi", o.belum_dilaporkan, (b) => {
      const sebagian = b.item.some((i) => i.dilaporkan_qty > 0);
      return `• ${b.kode} ${b.teknisi_nama} — ${ringkasItem(b)}${sebagian ? " (sebagian dilaporkan)" : ""}, ${umur(b.hari)}`;
    }),
    ...blok("🧾 Dilaporkan, SJ belum ada", o.dilaporkan_belum_sj, (b) => `• ${b.kode} ${b.teknisi_nama} — ${ringkasItem(b)}, ${umur(b.hari)}`),
    ...blok("⚠️ #BON tanpa bon gudang", o.tanpa_bon_gudang, (b) => `• ${b.kode} ${b.teknisi_nama} — ${ringkasItem(b)}, ${umur(b.hari)}`),
    ...blok("✅ Sudah jadi SJ (terbaru)", o.selesai.slice(0, 5), (b) => `• ${b.kode} ${b.teknisi_nama} → ${b.sj_number}`),
  );
  return out.join("\n");
}

// ── Master sparepart ─────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;

/** Item Accurate: kode persis, atau SEMUA kata ada di nama/kode. Master tak punya kategori sparepart
 *  (accurate_item.category = jenis teknis INVENTORY/SERVICE), jadi pencarian lewat nama. */
export async function cariSparepart(q: string, limit = 6): Promise<KandidatSparepart[]> {
  const sql = db();
  const t = q.trim();
  if (!t) return [];
  const pola = t.split(/\s+/).filter(Boolean).map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`);
  const rows = await sql`
    SELECT id, no, name, unit FROM accurate_item
    WHERE upper(no) = ${t.toUpperCase()}
       OR (SELECT bool_and(concat_ws(' ', name, no) ILIKE w) FROM unnest(${pola}::text[]) AS w)
    ORDER BY (upper(no) = ${t.toUpperCase()}) DESC, length(name), name
    LIMIT ${limit}`;
  const hasil = rows.map((r) => ({ item_id: Number(r.id), no: r.no ? String(r.no) : null, nama: String(r.name ?? r.no ?? ""), satuan: r.unit ? String(r.unit) : null }));
  // kode persis menang atas pencocokan kata
  const persis = hasil.filter((h) => h.no && h.no.toUpperCase() === t.toUpperCase());
  return persis.length === 1 ? persis : hasil;
}

// ── Kueri ────────────────────────────────────────────────────────────────

export class BonError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string, public field?: string) { super(message); }
}

const KOLOM_BON = (sql: Sql) => sql`
  b.id::int AS id, b.teknisi_id::text, b.teknisi_nama, b.asal, b.status, b.customer_nama, b.catatan, b.dibuat_oleh,
  b.dibuat_at, b.dilaporkan_at, b.sj_number, b.sj_sumber,
  GREATEST(0, floor(extract(epoch FROM (now() - b.dibuat_at)) / 86400))::int AS hari,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('urut', i.urut, 'item_id', i.item_id, 'item_no', i.item_no, 'item_nama', i.item_nama,
                                                'qty', i.qty::float8, 'satuan', i.satuan, 'dilaporkan_qty', i.dilaporkan_qty::float8) ORDER BY i.urut)
            FROM bon_sparepart_item i WHERE i.bon_id = b.id), '[]'::jsonb) AS item`;

function mapBon(r: Record<string, unknown>): BonRow {
  return {
    id: Number(r.id), kode: kodeBon(Number(r.id)), teknisi_id: String(r.teknisi_id), teknisi_nama: String(r.teknisi_nama),
    asal: r.asal as BonRow["asal"], status: r.status as BonRow["status"],
    customer_nama: r.customer_nama ? String(r.customer_nama) : null, catatan: r.catatan ? String(r.catatan) : null,
    dibuat_oleh: String(r.dibuat_oleh), dibuat_at: new Date(r.dibuat_at as string).toISOString(),
    dilaporkan_at: r.dilaporkan_at ? new Date(r.dilaporkan_at as string).toISOString() : null,
    sj_number: r.sj_number ? String(r.sj_number) : null, sj_sumber: (r.sj_sumber as BonRow["sj_sumber"]) ?? null,
    hari: Number(r.hari), item: (r.item as BonItem[]) ?? [],
  };
}

export interface ItemInput { item_id: number; qty: number }

/** Bon gudang (dashboard). Nama/kode/satuan item diambil dari master — bukan dari klien. */
export async function buatBonGudang(
  b: { teknisi_id: string; item: ItemInput[]; customer_nama?: string | null; customer_id?: number | null; catatan?: string | null },
  oleh: string,
): Promise<{ id: number; kode: string }> {
  const sql = db();
  if (!b.item?.length) throw new BonError(400, "isi minimal satu sparepart", "item");
  if (b.item.length > 30) throw new BonError(400, "maksimal 30 baris per bon", "item");
  const [t] = await sql`SELECT id::text, nama FROM teknisi_capacity WHERE id = ${b.teknisi_id}::uuid AND aktif`.catch(() => []);
  if (!t) throw new BonError(400, "teknisi tidak ditemukan / nonaktif", "teknisi_id");
  const gabung = new Map<number, number>();
  for (const it of b.item) {
    const qty = Number(it.qty);
    if (!Number.isInteger(Number(it.item_id)) || !(qty > 0) || qty > 100000) throw new BonError(400, "item/jumlah tidak valid", "item");
    gabung.set(Number(it.item_id), (gabung.get(Number(it.item_id)) ?? 0) + qty);
  }
  const master = await sql`SELECT id, no, name, unit FROM accurate_item WHERE id = ANY(${[...gabung.keys()]}::bigint[])`;
  if (master.length !== gabung.size) throw new BonError(400, "ada sparepart yang tak ada di master Accurate", "item");
  const id = await sql.begin(async (tx) => {
    const x = tx as unknown as Sql;
    const [o] = await x`
      INSERT INTO bon_sparepart (teknisi_id, teknisi_nama, asal, status, customer_nama, customer_id, catatan, dibuat_oleh)
      VALUES (${t.id}::uuid, ${t.nama}, 'gudang', 'dibuat', ${(b.customer_nama ?? "").trim().slice(0, 200) || null}, ${b.customer_id ?? null},
              ${(b.catatan ?? "").trim().slice(0, 1000) || null}, ${oleh}) RETURNING id`;
    let urut = 0;
    for (const m of master) {
      urut += 1;
      await x`INSERT INTO bon_sparepart_item (bon_id, urut, item_id, item_no, item_nama, qty, satuan)
              VALUES (${o.id}, ${urut}, ${m.id}, ${m.no}, ${String(m.name ?? m.no ?? "")}, ${gabung.get(Number(m.id)) as number}, ${m.unit ?? null})`;
    }
    return Number(o.id);
  });
  return { id, kode: kodeBon(id) };
}

/** Laporan teknisi (#BON): isi dulu bon gudang `dibuat` miliknya (terlama dulu); sisa → bon baru asal 'teknisi'. */
export async function laporBon(
  t: { id: string; nama: string },
  baris: { item: KandidatSparepart; qty: number }[],
  wa: { messageId: string | null },
): Promise<{ lengkap: string[]; sebagian: string[]; tanpaBon: { kode: string; item: string }[] }> {
  const sql = db();
  const lengkap = new Set<number>();
  const sebagian = new Set<number>();
  const sisa: { item: KandidatSparepart; qty: number }[] = [];
  await sql.begin(async (tx) => {
    const x = tx as unknown as Sql;
    for (const b of baris) {
      let perlu = b.qty;
      const cand = await x`
        SELECT i.bon_id, i.urut, i.qty, i.dilaporkan_qty FROM bon_sparepart_item i
        JOIN bon_sparepart bs ON bs.id = i.bon_id
        WHERE bs.teknisi_id = ${t.id}::uuid AND bs.status = 'dibuat' AND bs.asal = 'gudang'
          AND i.item_id = ${b.item.item_id} AND i.dilaporkan_qty < i.qty
        ORDER BY bs.dibuat_at, bs.id FOR UPDATE OF i`;
      for (const c of cand) {
        if (perlu <= 0) break;
        const ruang = Number(c.qty) - Number(c.dilaporkan_qty);
        const pakai = Math.min(ruang, perlu);
        await x`UPDATE bon_sparepart_item SET dilaporkan_qty = dilaporkan_qty + ${pakai} WHERE bon_id = ${c.bon_id} AND urut = ${c.urut}`;
        perlu -= pakai;
        sebagian.add(Number(c.bon_id));
      }
      if (perlu > 0) sisa.push({ item: b.item, qty: perlu });
    }
    for (const bonId of sebagian) {
      const [p] = await x`SELECT bool_and(dilaporkan_qty >= qty) AS penuh FROM bon_sparepart_item WHERE bon_id = ${bonId}`;
      if (p?.penuh) {
        await x`UPDATE bon_sparepart SET status = 'dilaporkan', dilaporkan_at = now(), wa_message_id = ${wa.messageId}, updated_at = now() WHERE id = ${bonId} AND status = 'dibuat'`;
        lengkap.add(bonId);
      }
    }
  });
  const tanpaBon: { kode: string; item: string }[] = [];
  if (sisa.length) {
    const id = await sql.begin(async (tx) => {
      const x = tx as unknown as Sql;
      const [o] = await x`
        INSERT INTO bon_sparepart (teknisi_id, teknisi_nama, asal, status, dibuat_oleh, dilaporkan_at, wa_message_id, catatan)
        VALUES (${t.id}::uuid, ${t.nama}, 'teknisi', 'dilaporkan', ${t.nama}, now(), ${wa.messageId}, 'Dilaporkan lewat #BON tanpa bon gudang') RETURNING id`;
      let urut = 0;
      for (const s of sisa) {
        urut += 1;
        await x`INSERT INTO bon_sparepart_item (bon_id, urut, item_id, item_no, item_nama, qty, satuan, dilaporkan_qty)
                VALUES (${o.id}, ${urut}, ${s.item.item_id}, ${s.item.no}, ${s.item.nama}, ${s.qty}, ${s.item.satuan}, ${s.qty})`;
      }
      return Number(o.id);
    });
    tanpaBon.push({ kode: kodeBon(id), item: sisa.map((s) => `${s.item.nama} ×${fmtQty(s.qty)}`).join(", ") });
  }
  return {
    lengkap: [...lengkap].map(kodeBon),
    sebagian: [...sebagian].filter((b) => !lengkap.has(b)).map(kodeBon),
    tanpaBon,
  };
}

export function balasanLapor(nama: string, h: Awaited<ReturnType<typeof laporBon>>): string {
  const out = [`✅ #BON tercatat, ${nama}.`];
  if (h.lengkap.length) out.push(`Cocok dengan bon gudang: ${h.lengkap.join(", ")} (lengkap).`);
  if (h.sebagian.length) out.push(`Cocok sebagian dengan bon gudang: ${h.sebagian.join(", ")} — sisanya masih ditunggu laporannya.`);
  for (const b of h.tanpaBon) out.push(`⚠️ ${b.kode}: ${b.item} — belum ada bon gudangnya. Minta gudang mencatat bonnya; sementara ditandai di #OPNAME.`);
  return out.join("\n");
}

export async function balasanBonTeknisi(t: { id: string; nama: string }, body: string, messageId: string | null): Promise<string> {
  const cmd = parseBon(body);
  const sql = db();
  if (cmd.aksi === "bantuan") return BANTUAN_BON;
  if (cmd.aksi === "status") {
    const rows = await sql`SELECT ${KOLOM_BON(sql)} FROM bon_sparepart b WHERE b.teknisi_id = ${t.id}::uuid AND b.status <> 'batal'
                           AND b.dibuat_at > now() - interval '30 days' ORDER BY b.id DESC LIMIT 8`;
    if (!rows.length) return `Belum ada bon 30 hari terakhir, ${t.nama}.`;
    const lbl: Record<string, string> = { dibuat: "belum dilaporkan", dilaporkan: "dilaporkan, menunggu SJ", selesai: "sudah jadi SJ" };
    return [`📋 Bon ${t.nama} (30 hari):`, ...rows.map(mapBon).map((b) => `• ${b.kode} ${ringkasItem(b)} — ${lbl[b.status] ?? b.status}${b.sj_number ? ` (${b.sj_number})` : ""}`)].join("\n");
  }
  if (cmd.baris.length > 30) return "Maksimal 30 baris per #BON — pecah jadi beberapa pesan.";
  const hasil: HasilBarisBon[] = [];
  for (const b of cmd.baris) hasil.push(nilaiBarisBon(b, Number.isFinite(b.qty) && b.qty > 0 ? await cariSparepart(b.query) : []));
  const gagal = hasil.filter((h) => !h.ok);
  if (gagal.length) return [`⚠️ ${gagal.length} baris perlu diperbaiki, ${t.nama} — #BON BELUM dicatat:`, ...gagal.map((g) => `• "${g.teks}": ${g.masalah}`)].join("\n");
  const h = await laporBon(t, hasil.map((x) => ({ item: x.item as KandidatSparepart, qty: x.qty as number })), { messageId });
  return balasanLapor(t.nama, h);
}

// ── Rekonsiliasi SJ ──────────────────────────────────────────────────────

const PASANGAN_SJ = (sql: Sql, bonId?: number) => sql`
  SELECT b.id::int AS bon_id, d.id AS sj_id, d.number
  FROM bon_sparepart b
  JOIN accurate_delivery_order d
    ON d.trans_date BETWEEN (b.dilaporkan_at AT TIME ZONE 'Asia/Jakarta')::date - 1 AND (b.dilaporkan_at AT TIME ZONE 'Asia/Jakarta')::date + 14
   AND (b.customer_id IS NULL OR d.customer_id = b.customer_id)
  WHERE b.status = 'dilaporkan' AND b.sj_id IS NULL AND b.dilaporkan_at IS NOT NULL
    ${bonId ? sql`AND b.id = ${bonId}` : sql``}
    AND EXISTS (SELECT 1 FROM bon_sparepart_item i WHERE i.bon_id = b.id AND i.item_no IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM bon_sparepart_item i WHERE i.bon_id = b.id AND i.item_no IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM accurate_delivery_order_item di WHERE di.delivery_id = d.id AND di.item_no = i.item_no))
    AND NOT EXISTS (SELECT 1 FROM bon_sparepart x WHERE x.sj_id = d.id AND x.status <> 'batal')
  ORDER BY d.trans_date, d.id`;

/** Murni (diuji): pilih pasangan bon→SJ yang aman ditautkan otomatis — bon punya TEPAT satu kandidat dan
 *  SJ itu bukan kandidat bon lain (dua bon berebut satu SJ → biarkan manual). */
export function pilihTautanOtomatis(pasangan: { bon_id: number; sj_id: number; number: string }[]): { bon_id: number; sj_id: number; number: string }[] {
  const perBon = new Map<number, typeof pasangan>();
  const perSj = new Map<number, Set<number>>();
  for (const p of pasangan) {
    perBon.set(p.bon_id, [...(perBon.get(p.bon_id) ?? []), p]);
    perSj.set(p.sj_id, (perSj.get(p.sj_id) ?? new Set()).add(p.bon_id));
  }
  return [...perBon.values()].filter((l) => l.length === 1 && (perSj.get(l[0].sj_id)?.size ?? 0) === 1).map((l) => l[0]);
}

/** Tautkan otomatis bon `dilaporkan` ke SJ mirror. Mengembalikan jumlah bon yang tertaut. */
export async function rekonsiliasiBon(): Promise<number> {
  const sql = db();
  const rows = await PASANGAN_SJ(sql);
  const pilih = pilihTautanOtomatis(rows.map((r) => ({ bon_id: Number(r.bon_id), sj_id: Number(r.sj_id), number: String(r.number) })));
  let n = 0;
  for (const p of pilih) {
    const u = await sql`
      UPDATE bon_sparepart SET status = 'selesai', sj_id = ${p.sj_id}, sj_number = ${p.number}, sj_sumber = 'otomatis', sj_at = now(), sj_oleh = 'otomatis', updated_at = now()
      WHERE id = ${p.bon_id} AND status = 'dilaporkan' AND sj_id IS NULL RETURNING id`.catch(() => []); // indeks unik: SJ keburu dipakai
    n += u.length;
  }
  return n;
}

export async function kandidatSj(bonId: number): Promise<{ sj_id: number; number: string }[]> {
  const rows = await PASANGAN_SJ(db(), bonId);
  return rows.map((r) => ({ sj_id: Number(r.sj_id), number: String(r.number) }));
}

export async function tautkanSjManual(id: string, nomor: string, oleh: string): Promise<{ id: number; kode: string }> {
  if (!/^\d+$/.test(id)) throw new BonError(400, "id tidak valid");
  const no = nomor.trim();
  if (!no) throw new BonError(400, "isi nomor SJ", "sj_number");
  const sql = db();
  const [b] = await sql`SELECT status FROM bon_sparepart WHERE id = ${id}::bigint`;
  if (!b) throw new BonError(404, "bon tidak ditemukan");
  if (!["dibuat", "dilaporkan"].includes(String(b.status))) throw new BonError(409, `bon berstatus ${b.status}, tak bisa ditautkan`, "status");
  const [d] = await sql`SELECT id, number FROM accurate_delivery_order WHERE upper(number) = upper(${no}) LIMIT 1`;
  if (!d) throw new BonError(404, `SJ ${no} tidak ada di mirror Accurate (belum tersinkron atau salah ketik)`, "sj_number");
  const [pakai] = await sql`SELECT id FROM bon_sparepart WHERE sj_id = ${d.id} AND status <> 'batal' AND id <> ${id}::bigint LIMIT 1`;
  if (pakai) throw new BonError(409, `SJ ${d.number} sudah dipakai ${kodeBon(Number(pakai.id))}`, "sj_number");
  await sql`
    UPDATE bon_sparepart SET status = 'selesai', sj_id = ${d.id}, sj_number = ${String(d.number)}, sj_sumber = 'manual', sj_at = now(), sj_oleh = ${oleh},
           dilaporkan_at = COALESCE(dilaporkan_at, now()), updated_at = now()
    WHERE id = ${id}::bigint`;
  return { id: Number(id), kode: kodeBon(id) };
}

export async function batalkanBon(id: string, alasan: string, oleh: string): Promise<{ id: number; kode: string }> {
  if (!/^\d+$/.test(id)) throw new BonError(400, "id tidak valid");
  const a = alasan.trim();
  if (!a) throw new BonError(400, "isi alasan batal", "alasan");
  const sql = db();
  const u = await sql`
    UPDATE bon_sparepart SET status = 'batal', batal_alasan = ${a.slice(0, 500)}, batal_oleh = ${oleh}, updated_at = now()
    WHERE id = ${id}::bigint AND status IN ('dibuat', 'dilaporkan') RETURNING id`;
  if (!u.length) throw new BonError(409, "bon tidak ada atau sudah selesai/batal");
  return { id: Number(id), kode: kodeBon(id) };
}

export async function daftarBon(status?: string) {
  const sql = db();
  const ditautkan = await rekonsiliasiBon().catch(() => 0);
  const rows = await sql`
    SELECT ${KOLOM_BON(sql)} FROM bon_sparepart b
    WHERE b.dibuat_at > now() - interval '120 days'
      ${status ? sql`AND b.status = ${status}` : sql`AND b.status <> 'batal'`}
    ORDER BY b.id DESC LIMIT 500`;
  const bon = rows.map(mapBon);
  const teknisi = await sql`SELECT tc.id::text, tc.nama FROM teknisi_capacity tc WHERE tc.aktif ORDER BY tc.nama`;
  return { ditautkan, opname: kelompokOpname(bon), bon, teknisi: teknisi.map((t) => ({ id: String(t.id), nama: String(t.nama) })) };
}

export async function balasanOpnameWa(): Promise<string> {
  const d = await daftarBon();
  return balasanOpname(d.opname, d.ditautkan);
}
