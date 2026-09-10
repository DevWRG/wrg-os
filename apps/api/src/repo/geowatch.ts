import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { wibDate } from "./cashin.js";

// Sweep harian "foto visit tanpa koordinat" → grup AM.
//
// Kunjungan yang fotonya menempel TAPI tanpa koordinat tak pernah lolos filter
// menu Visits (`sales_plan.visit_lat IS NOT NULL`, repo/visit.ts). Balasan
// #REPORT sudah menagihnya sejak PR watchdog geotag, tapi balasan itu hanya
// lewat sekali di tengah keramaian grup dan hilang. Sweep ini mengumpulkannya
// jadi satu tagihan per AM di penghujung hari.
//
// Kenapa jendelanya DUA hari, bukan hari ini saja: banyak AM melapor lewat
// tengah malam (Irul/Firman rutin 00:00–05:00), jadi sapuan 21:30 hari-ini saja
// akan melewatkan mereka selamanya. Baris H-1 yang sudah dibetulkan hilang
// sendiri dari daftar, dan jendela 2 hari membatasi tiap baris maksimum
// disebut dua kali — tidak jadi tagihan abadi.
//
// Kirim ulang foto tetap berguna: photoFollowup mencocokkan caption ke
// activity_log sampai 7 hari ke belakang, dan jam kunjungan ikut di overlay
// sehingga visit_timestamp tetap benar walau fotonya dikirim besok.

export interface GeoSweepAm {
  am_id: string;
  nama: string;
  tanpa_overlay: string[];
  ocr_gagal: string[];
}

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const jumlah = (a: GeoSweepAm) => a.tanpa_overlay.length + a.ocr_gagal.length;

// Temuan terbanyak di atas. Diterapkan di pembentuk pesan, bukan cuma di
// pemanggilnya, supaya urutan pesan tak bergantung pada urutan baris SQL.
const urut = (xs: GeoSweepAm[]) =>
  [...xs].sort((a, b) => jumlah(b) - jumlah(a) || a.nama.localeCompare(b.nama));

// `iso` sudah tanggal kalender WIB (dari wibDate()), jadi hari-nya dihitung
// sebagai UTC murni. Menyusunnya sebagai instan `+07:00` lalu getUTCDay() salah
// satu hari — instannya jatuh di 17:00 UTC hari SEBELUMNYA.
const tglDisplay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${HARI[d.getUTCDay()]} ${iso}`;
};

// Diekspor untuk diuji tanpa DB (repo/geowatch.test.ts).
export function buildGeoSweepMessage(tanggal: string, perAm: GeoSweepAm[]): string | null {
  // Sunyi kalau bersih. Job harian yang tetap berkicau "0 masalah" akan
  // diabaikan dalam sepekan, dan itu membunuh gunanya saat benar-benar ada.
  if (perAm.length === 0) return null;
  const urutan = urut(perAm);
  const total = urutan.reduce((s, a) => s + jumlah(a), 0);
  const lines = [
    `📍 *Foto visit tanpa koordinat — ${tglDisplay(tanggal)}*`,
    `${total} kunjungan dari ${urutan.length} AM belum terhitung di menu Visits.`,
    "",
  ];
  for (const a of urutan) {
    lines.push(`*${a.nama}* (${jumlah(a)})`);
    // Dua sebab, dua obat — sama seperti balasan #REPORT. Menggabungkannya
    // membuat AM yang overlay-nya sudah benar disuruh kunjungan ulang.
    if (a.tanpa_overlay.length > 0) {
      lines.push(`• Tanpa overlay geotag: ${a.tanpa_overlay.join(", ")}`);
    }
    if (a.ocr_gagal.length > 0) {
      lines.push(`• Koordinat gagal dibaca: ${a.ocr_gagal.join(", ")}`);
    }
    lines.push("");
  }
  // Legenda hanya memuat sebab yang BENAR-BENAR muncul hari itu. Uji dry-run
  // 2026-07-09 di dev: 35 temuan, semuanya "tanpa overlay", tapi kaki pesan
  // tetap mencetak instruksi "koordinat gagal dibaca" yang tak berlaku. Baris
  // per-AM sudah kondisional sejak awal; legendanya tertinggal. Menambah satu
  // instruksi yang tidak relevan pada pesan yang justru dibuat supaya dibaca
  // adalah cara pelan-pelan membuatnya diabaikan.
  const adaTanpaOverlay = urutan.some((a) => a.tanpa_overlay.length > 0);
  const adaOcrGagal = urutan.some((a) => a.ocr_gagal.length > 0);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  if (adaTanpaOverlay) {
    lines.push("*Tanpa overlay* → foto ulang pakai Geo-Tagging Camera. Kirim ulang dari galeri tak menolong, overlay-nya tak ikut.");
  }
  if (adaOcrGagal) {
    lines.push("*Koordinat gagal dibaca* → kirim ulang foto yang sama, pastikan baris `Lat … Long …` utuh dan tak tertutup jari/stiker.");
  }
  lines.push(
    "",
    "Kirim dengan caption `Nama Customer` — masih kebaca sampai 7 hari ke belakang, jam kunjungan tetap ikut dari overlay.",
  );
  return lines.join("\n");
}

export async function runGeoSweep(to?: string, tanggal?: string): Promise<{
  tanggal: string;
  am_terdampak: number;
  customer: number;
  per_am: GeoSweepAm[];
  message: string | null;
  gateway: WaSendResult | null;
  audit_id: string | null;
}> {
  const sql = db();
  const tgl = tanggal ?? wibDate();
  // `photo_geotag IS NULL` = tak ada overlay sama sekali.
  // `->>'lat' IS NULL` = overlay terbaca (jam masuk) tapi koordinatnya gagal
  // OCR — lihat tempelFotoLaporan di repo/inbound.ts yang tetap menyimpan geo
  // walau cuma jamnya yang utuh.
  const rows = await sql<{ am_id: string; nama: string; customer_name: string; ada_overlay: boolean }[]>`
    SELECT al.am_id,
           COALESCE(NULLIF(initcap(mu.panggilan), ''), mu.nama, al.am_id) AS nama,
           al.customer_name,
           (al.photo_geotag IS NOT NULL) AS ada_overlay
      FROM activity_log al
      JOIN master_user mu ON mu.am_id = al.am_id
     WHERE al.tanggal BETWEEN ${tgl}::date - 1 AND ${tgl}::date
       AND al.plan_id IS NOT NULL
       AND al.photo_path IS NOT NULL
       AND (al.photo_geotag IS NULL OR al.photo_geotag->>'lat' IS NULL)
     ORDER BY nama, al.id
  `;
  const byAm = new Map<string, GeoSweepAm>();
  for (const r of rows) {
    let e = byAm.get(r.am_id);
    if (!e) {
      e = { am_id: r.am_id, nama: String(r.nama), tanpa_overlay: [], ocr_gagal: [] };
      byAm.set(r.am_id, e);
    }
    // Customer yang sama bisa muncul dua kali (baris H-1 dan hari ini) —
    // cukup sebut sekali, biar daftarnya tak berbunyi seperti dua masalah.
    const bucket = r.ada_overlay ? e.ocr_gagal : e.tanpa_overlay;
    const nama = String(r.customer_name);
    if (!bucket.includes(nama)) bucket.push(nama);
  }
  const perAm = urut([...byAm.values()]);
  const customer = perAm.reduce((s, a) => s + jumlah(a), 0);
  const message = buildGeoSweepMessage(tgl, perAm);
  if (message === null) {
    return { tanggal: tgl, am_terdampak: 0, customer: 0, per_am: [], message: null, gateway: null, audit_id: null };
  }

  // Target = grup AM. Sama dengan pengingat kepatuhan AM (repo/compliance.ts),
  // karena yang bisa membetulkan fotonya adalah AM-nya sendiri.
  const target = to || process.env.GEO_SWEEP_WA_TARGET || process.env.COMPLIANCE_AM_GROUP || process.env.REMINDER_WA_TARGET || "";
  const gateway = await sendViaWaGateway(target || "_am_group", message);
  if (!gateway.sent) {
    return { tanggal: tgl, am_terdampak: perAm.length, customer, per_am: perAm, message, gateway, audit_id: null };
  }

  const inputHash = createHash("sha256").update(`${tgl}:${customer}:${perAm.map((a) => a.am_id).join(",")}`).digest("hex");
  const outputHash = createHash("sha256").update(message).digest("hex");
  const payload = {
    tanggal: tgl,
    am_terdampak: perAm.length,
    customer,
    per_am: perAm.map((a) => ({ am_id: a.am_id, nama: a.nama, tanpa_overlay: a.tanpa_overlay.length, ocr_gagal: a.ocr_gagal.length })),
  };
  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`geosweep-${inputHash.slice(0, 8)}`}, NULL, 4, 'crm.compliance.geo_sweep', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return { tanggal: tgl, am_terdampak: perAm.length, customer, per_am: perAm, message, gateway, audit_id: a.id as string };
}
