#!/usr/bin/env node
// Menolak nomor migrasi ganda BARU sebelum ter-merge.
//
// Migrasi dieksekusi menurut urutan ABJAD NAMA FILE — scripts/db/migrate.sh:
// `for f in "$INIT_DIR"/*.sql`. Jadi nomor di depan nama itu penentu urutan
// eksekusi, bukan label. Dua orang yang memilih nomor sama membuat urutan
// bergantung pada sisa nama file, dan tak ada satu pun gerbang yang gagal:
// baru terlihat saat deploy hampir menyentuh skema prod.
//
// Cek ini dijalankan di CI (.github/workflows/ci.yml).
//
// ── Kenapa ada BASELINE, bukan langsung bersih ────────────────────────────────
// Saat cek ini dipasang, dev sudah punya 11 nomor bertabrakan (32 file) dari
// PR fitur yang masuk paralel, dan jumlahnya masih bertambah beberapa menit
// sekali. Memblokir semuanya sekaligus akan membekukan PR seluruh tim sampai
// penomoran dibereskan. Jadi kondisi saat itu dicatat sebagai BASELINE —
// ditoleransi sebagai utang — sementara tabrakan BARU tetap ditolak.
//
// Aturannya: satu nomor gagal kalau punya >1 file DAN ada file yang bukan
// baseline. Jadi menambah file ke nomor yang sudah bertabrakan pun ditolak.
//
// Dikunci per NAMA FILE, bukan per nomor. Versi pertama cek ini memakai nomor
// dan itu menyembunyikan duplikat nyata: dua file di 069 masih pending, tapi
// seluruh nomor 069 ikut dikecualikan.
//
// BASELINE ini utang, bukan restu. Membereskannya = rename file yang BELUM
// applied ke nomor bebas di ekor, lalu hapus dari daftar di bawah. JANGAN
// rename file yang SUDAH applied: ledger schema_migrations memakai nama file,
// jadi file applied yang di-rename tampak pending lalu DIEKSEKUSI ULANG.
// Periksa dulu:
//   psql -d wrg_os_prod -c "SELECT filename FROM schema_migrations WHERE filename LIKE '0XX%'"
// Dan jaga ketergantungan saat memilih nomor baru — beberapa migrasi merujuk
// tabel yang dibuat migrasi lain, dan urutannya sekarang benar hanya karena
// kebetulan nomornya berurutan.
import { readdirSync } from "node:fs";

const DIR = "infra/postgres/init";
const POLA = /^(\d{3})_[a-z0-9_]+\.sql$/;

const BASELINE = new Set([
  "043_pricelist.sql",
  "043_watchpoint_husni_milestones.sql",
  "068_activity_link_visit_target.sql",
  "068_atk_master.sql",
  "068_dana_ops.sql",
  "068_inbound_receiving.sql",
  "068_installation_lifecycle.sql",
  "068_supplier_eta.sql",
  "069_atk_stock_movement.sql",
  "069_maintenance_schedule.sql",
  "069_pipeline_stage_7.sql",
  "069_seed_master_holiday_2026.sql",
  "070_atk_stock_opname.sql",
  "070_seed_cuti_bersama_2026.sql",
  "070_service_ticket_triage.sql",
  "070_teknisi_readiness_board.sql",
  "071_atk_transaction_category.sql",
  "071_product_pricelist.sql",
  "076_pricelist_price_list.sql",
  "076_shipment_tracking.sql",
  "077_pricebook_setup_publish.sql",
  "077_proficiency_test_document.sql",
  "077_shipment_tracking_geo.sql",
  "078_fund_request.sql",
  "078_inventory_relocation_request.sql",
  "078_npk_am.sql",
  "078_purchase_order.sql",
  "078_shipment_tracking_terima.sql",
  "078_vendor_management.sql",
  "079_master_user_golongan.sql",
  "079_purchase_order_approval.sql",
  "079_shipment_tracking_bukti.sql",
  "080_purchase_forecast.sql",
  "080_vehicle_operational_log.sql",
  "080_watchpoint_metric_target.sql",
  "081_accurate_so_do_items.sql",
  "081_pickup_plan.sql",
  "095_accurate_so_do_number_key.sql",
  "095_lpse_tender_tracker.sql",
  "098_kso_revenue.sql",
  "098_sph_generator.sql",
  "106_approval_engine.sql",
  "106_kso_tren_bulanan.sql",
  "107_forecast_submission.sql",
  "107_kso_aturan_atribusi_tunggal.sql",
]);

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const salahPola = [];
const perNomor = new Map();

for (const f of files) {
  const m = POLA.exec(f);
  if (!m) { salahPola.push(f); continue; }
  if (!perNomor.has(m[1])) perNomor.set(m[1], []);
  perNomor.get(m[1]).push(f);
}

const baru = [...perNomor.entries()]
  .filter(([, fs]) => fs.length > 1 && fs.some((f) => !BASELINE.has(f)))
  .sort();

const utang = [...perNomor.entries()].filter(([, fs]) => fs.length > 1).length;
const dipakai = [...perNomor.keys()].map(Number);
const berikut = String(Math.max(...dipakai) + 1).padStart(3, "0");

if (salahPola.length === 0 && baru.length === 0) {
  console.log(
    `\u2713 ${files.length} migrasi, tak ada nomor ganda baru. ` +
      `Utang baseline: ${utang} nomor. Nomor bebas berikutnya: ${berikut}.`,
  );
  process.exit(0);
}

if (salahPola.length > 0) {
  console.error(`\u2717 ${salahPola.length} nama file tak berpola NNN_nama_snake_case.sql:`);
  for (const f of salahPola) console.error(`    ${f}`);
}

if (baru.length > 0) {
  console.error(`\u2717 ${baru.length} nomor migrasi bertabrakan (di luar baseline):`);
  for (const [n, fs] of baru) {
    console.error(`    ${n} → ${fs.map((f) => (BASELINE.has(f) ? `${f} (baseline)` : `${f}  \u2190 BARU`)).join("  ·  ")}`);
  }
  console.error(
    `\n  Pakai nomor bebas: ${berikut} atau lebih.` +
      `\n  Nomor menentukan urutan eksekusi — kalau migrasimu merujuk tabel yang` +
      `\n  dibuat migrasi lain, pastikan nomornya lebih besar dari migrasi itu.`,
  );
}

process.exit(1);
