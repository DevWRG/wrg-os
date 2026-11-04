// Uji Multi-Opsi Pipeline (#1964, migrasi 274) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-multi-opsi.ts
//
// Menolak jalan bila DATABASE_URL menyebut prod. Fixture: AM `UJI274`, faskes
// "RSUD UJI274 …" — dihapus di akhir.
//
// Yang dibuktikan:
//   1. Tambah opsi: deal asal jadi Opsi 1 (utama), opsi baru Opsi 2/3 mewarisi faskes/AM/
//      tahap, tidak utama; opsi ke-4 ditolak; deal tertutup ditolak; AM lain ditolak.
//   2. Nilai pipeline (board, laporan, leaderboard) = opsi utama saja.
//   3. Jadikan utama memindahkan nilai yang dihitung.
//   4. Opsi Won (lewat board) → opsi lain di-drop, hilang dari board, bukan Lost di
//      win-loss; menggeser opsi yang di-drop ditolak; batal Won → hidup lagi.
//   5. Won lewat #REPORT (recordReportTouch) ikut men-drop.
//   6. Opsi utama Lost → utama pindah ke opsi yang masih jalan.
//   7. Hapus opsi → grup dirapikan (tinggal satu = bubar).

import { db } from "../../apps/api/src/db.js";
import type { DataScope } from "../../apps/api/src/repo/access-scope.js";
import { FULL_SCOPE } from "../../apps/api/src/repo/access-scope.js";
import {
  createDeal, deleteDeal, getPipeline, getPipelineLeaderboard, getPipelineReport,
  jadikanOpsiUtama, recordReportTouch, tambahOpsi, transitionStage,
} from "../../apps/api/src/repo/deal.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const sql = db();
let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket : ""}`);
  if (!ok) gagal++;
};
const AM = "UJI274";
const AM_LAIN = "UJI274B";
const scAm: DataScope = { ...FULL_SCOPE, userId: "uji274", amOnly: true, amId: AM };
const scLain: DataScope = { ...FULL_SCOPE, userId: "uji274b", amOnly: true, amId: AM_LAIN };
const scAdmin: DataScope = { ...FULL_SCOPE, userId: "uji274-admin", superuser: true };

async function bersihkan() {
  await sql`DELETE FROM spt_state_log WHERE deal_id IN (SELECT deal_id FROM deal WHERE am_id IN (${AM}, ${AM_LAIN}))`;
  await sql`DELETE FROM deal WHERE am_id IN (${AM}, ${AM_LAIN})`;
  await sql`DELETE FROM master_user WHERE am_id IN (${AM}, ${AM_LAIN})`;
}
const coba = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return (e as Error).message; } };
const baris = async (id: string) => (await sql`
  SELECT stage::text AS stage, opsi_grup::text, opsi_no, opsi_utama, loss_status, opsi_drop_dari FROM deal WHERE deal_id = ${id}`)[0];
const milikAm = async () => (await getPipeline(scAm));

async function main() {
  await bersihkan();
  await sql`INSERT INTO master_user (am_id, nama, role, cabang) VALUES (${AM}, 'AM Uji274', 'AM', 'UJI274'), (${AM_LAIN}, 'AM Uji274 B', 'AM', 'UJI274')`;

  console.log("1. Tambah opsi");
  const d1 = (await createDeal(scAm, { facility_name: "RSUD UJI274 Kota", brand: "BrandX", qty_num: 1, unit_price: 300 })).deal_id;
  await transitionStage(d1, "Quotation", scAm, { note: "uji" });
  const o2 = await tambahOpsi(d1, scAm, { brand: "BrandY", coop_model: "KSO", qty_num: 1, unit_price: 250, facility_name: "nyasar" });
  const o3 = await tambahOpsi(o2.deal_id, scAm, { brand: "BrandX kecil", qty_num: 1, unit_price: 180 });
  let b1 = await baris(d1), b2 = await baris(o2.deal_id), b3 = await baris(o3.deal_id);
  cek("deal asal jadi Opsi 1 utama", b1.opsi_no === 1 && b1.opsi_utama && b1.opsi_grup === d1);
  cek("opsi baru 2 & 3, tak utama, satu grup", o2.opsi_no === 2 && o3.opsi_no === 3 && !b2.opsi_utama && !b3.opsi_utama && b2.opsi_grup === d1 && b3.opsi_grup === d1);
  cek("opsi mewarisi tahap & faskes (bukan isian)", b2.stage === "Quotation" &&
    (await sql`SELECT facility_name FROM deal WHERE deal_id = ${o2.deal_id}`)[0].facility_name === "RSUD UJI274 Kota");
  cek("opsi ke-4 ditolak", /maksimal 3/.test((await coba(() => tambahOpsi(d1, scAm, { brand: "Z" }))) ?? ""));
  cek("AM lain ditolak", /tidak berwenang/.test((await coba(() => tambahOpsi(d1, scLain, { brand: "Z" }))) ?? ""));

  console.log("2. Nilai = opsi utama");
  let p = await milikAm();
  cek("board: 3 kartu, total 300 (bukan 730)", p.total_deals === 3 && p.summary.total_value === 300, `kartu ${p.total_deals}, total ${p.summary.total_value}`);
  const kartu = p.stages.flatMap((s) => s.deals);
  cek("kartu membawa opsi_no/jumlah", kartu.every((d) => d.opsi_jumlah === 3) && kartu.filter((d) => d.opsi_utama).length === 1);
  const rep = await getPipelineReport(scAm);
  cek("laporan funnel Quotation = 1 kebutuhan, 300", rep.funnel.find((f) => f.stage === "Quotation")?.count === 1 && rep.funnel.find((f) => f.stage === "Quotation")?.value === 300);
  const lb = (await getPipelineLeaderboard(scAm)).find((r) => r.am_id === AM);
  cek("leaderboard: 1 deal, 300", lb?.deal_count === 1 && lb?.total_value === 300, JSON.stringify(lb));

  console.log("3. Jadikan utama");
  await jadikanOpsiUtama(o2.deal_id, scAm);
  p = await milikAm();
  cek("utama pindah ke Opsi 2, total 250", (await baris(o2.deal_id)).opsi_utama && !(await baris(d1)).opsi_utama && p.summary.total_value === 250);

  console.log("4. Won → drop");
  await transitionStage(o3.deal_id, "Closing-Won", scAm, { note: "RS pilih opsi 3" });
  b1 = await baris(d1); b2 = await baris(o2.deal_id); b3 = await baris(o3.deal_id);
  cek("Opsi 3 Won & utama", b3.stage === "Closing-Won" && b3.opsi_utama);
  cek("Opsi 1 & 2 di-drop (Lost + dropped, tahap asal tersimpan)",
    b1.loss_status === "dropped" && b2.loss_status === "dropped" && b2.opsi_drop_dari === "Quotation");
  p = await milikAm();
  cek("board: yang di-drop hilang, tinggal 1 kartu Won 180", p.total_deals === 1 && p.summary.total_value === 180);
  const wl = (await getPipelineReport(scAm)).winloss;
  cek("win-loss: 1 won, 0 lost (drop bukan kalah)", wl.won === 1 && wl.lost === 0, JSON.stringify(wl));
  cek("menggeser opsi di-drop ditolak", /di-drop/.test((await coba(() => transitionStage(d1, "Negotiation", scAm, { note: "x" }))) ?? ""));
  await transitionStage(o3.deal_id, "Negotiation", scAm, { note: "PO batal" });
  b1 = await baris(d1); b2 = await baris(o2.deal_id);
  cek("batal Won → Opsi 1 & 2 hidup lagi di Quotation", b1.stage === "Quotation" && b2.stage === "Quotation" && b1.loss_status == null);
  p = await milikAm();
  cek("board kembali 3 kartu, satu utama", p.total_deals === 3 && p.stages.flatMap((s) => s.deals).filter((d) => d.opsi_utama).length === 1);

  console.log("5. Won lewat #REPORT");
  await recordReportTouch(AM, d1, "deal", "kirim PO", "Closing-Won");
  b2 = await baris(o2.deal_id); b3 = await baris(o3.deal_id);
  cek("#REPORT Won ikut men-drop opsi lain", b2.loss_status === "dropped" && b3.loss_status === "dropped" && (await baris(d1)).opsi_utama);
  cek("tambah opsi ke grup yang sudah Won ditolak", /sudah Won/.test((await coba(() => tambahOpsi(d1, scAdmin, { brand: "Z" }))) ?? "") ||
    /masih berjalan/.test((await coba(() => tambahOpsi(d1, scAdmin, { brand: "Z" }))) ?? ""));

  console.log("6. Utama Lost → pindah");
  const e1 = (await createDeal(scAm, { facility_name: "RSUD UJI274 Desa", qty_num: 1, unit_price: 100 })).deal_id;
  const e2 = await tambahOpsi(e1, scAm, { brand: "B", qty_num: 1, unit_price: 90 });
  await transitionStage(e1, "Closing-Lost", scAm, { lossReason: "harga" });
  cek("utama pindah ke Opsi 2 yang masih jalan", (await baris(e2.deal_id)).opsi_utama && !(await baris(e1)).opsi_utama);

  console.log("7. Hapus opsi");
  await deleteDeal(e1, scAdmin);
  const sisa = await baris(e2.deal_id);
  cek("tinggal satu → grup bubar, tetap dihitung", sisa.opsi_grup == null && sisa.opsi_no == null && sisa.opsi_utama);

  await bersihkan();
  console.log(gagal === 0 ? "\nSEMUA LOLOS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try { await bersihkan(); } catch { /* biarkan */ }
  await sql.end();
  process.exit(1);
});
