// Uji approval Finance maintenance GA (F137) di mesin F11 (migrasi 249) —
// MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-ga-maintenance-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
//
// Yang dibuktikan:
//   1. Biaya ≤ ambang → langsung done + jadwal berikutnya, tanpa approval.
//   2. Biaya > ambang → pending_finance + approval alur 'ga-maintenance' (atomik).
//   3. Hanya anggota grup Finance yang bisa memutus; penyelesai tak bisa
//      menyetujui approval-nya sendiri walau anggota grup.
//   4. Disetujui (dashboard) → done + approved_by = akun pemutus + recurrence.
//   5. Ditolak → in_progress; selesai ulang dengan biaya < ambang TETAP butuh
//      approval (bukan jalan pintas), lalu disetujui via WA → done.
//   6. Jadwal pindahan (backfill 249) bisa diputus di engine.
//
// Baris uji (aset "UJI-GA-*") dibersihkan di awal DAN di akhir.

import { db } from "../../apps/api/src/db.js";
import { decideCurrentStep, decideFromDashboard, resolveApproverByUserId } from "../../apps/api/src/repo/approval.js";
import {
  approveSchedule,
  completeSchedule,
  createSchedule,
  getSchedule,
  startSchedule,
  type GaMaintenanceRow,
} from "../../apps/api/src/repo/ga-maintenance.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const sql = db();
const GRUP = "finance-hod";
let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket : ""}`);
  if (!ok) gagal++;
};
const isRow = (x: unknown): x is GaMaintenanceRow => !!x && typeof x === "object" && "status" in (x as object);
let grupDibuat = false;

async function bersihkan() {
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'ga_maintenance_schedules' AND title LIKE 'Maintenance GA: UJI-GA-%'`;
  await sql`DELETE FROM ga_maintenance_schedules WHERE asset_id IN (SELECT id FROM ga_assets WHERE asset_code LIKE 'UJI-GA-%')`;
  await sql`DELETE FROM ga_assets WHERE asset_code LIKE 'UJI-GA-%'`;
  await sql`DELETE FROM ga_asset_categories WHERE nama = 'UJI-GA kategori'`;
  await sql`DELETE FROM app_user WHERE email LIKE 'uji-ga-%@dev.local'`;
  if (grupDibuat) await sql`DELETE FROM access_group WHERE key = ${GRUP}`;
}

async function user(email: string, name: string, wa: string) {
  const [u] = await sql`INSERT INTO app_user (email, password_hash, name, role, wa_number) VALUES (${email}, 'x', ${name}, 'user', ${wa}) RETURNING id`;
  return String(u.id);
}

async function jadwal(assetId: string, recur = 0) {
  const r = await createSchedule({ asset_id: assetId, due_date: "2026-11-01", cost_budget: 1_000_000, recur_months: recur });
  if (!isRow(r)) throw new Error(`createSchedule: ${JSON.stringify(r)}`);
  const st = await startSchedule(r.id);
  if (!st.ok) throw new Error(st.error);
  return r.id;
}

async function main() {
  // Pindahan (fixture sebelum migrasi 249) disimpan dulu.
  const pindahan = await sql`
    SELECT s.id FROM ga_maintenance_schedules s JOIN ga_assets a ON a.id = s.asset_id
    WHERE a.asset_code = 'UJI-GA-PINDAHAN' AND s.approval_request_id IS NOT NULL
  `;
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'ga_maintenance_schedules' AND title LIKE 'Maintenance GA: UJI-GA-BARU%'`;
  await sql`DELETE FROM ga_maintenance_schedules WHERE asset_id IN (SELECT id FROM ga_assets WHERE asset_code LIKE 'UJI-GA-BARU%')`;
  await sql`DELETE FROM ga_assets WHERE asset_code LIKE 'UJI-GA-BARU%'`;
  await sql`DELETE FROM app_user WHERE email LIKE 'uji-ga-%@dev.local'`;

  let [g] = await sql`SELECT id FROM access_group WHERE key = ${GRUP}`;
  if (!g) {
    [g] = await sql`INSERT INTO access_group (key, name) VALUES (${GRUP}, 'Finance (uji)') RETURNING id`;
    grupDibuat = true;
  }
  const fin = await user("uji-ga-fin@dev.local", "Uji Finance", "6280000019901");
  const gaStaf = await user("uji-ga-staf@dev.local", "Uji Staf GA Finance", "6280000019902");
  const luar = await user("uji-ga-luar@dev.local", "Uji Luar", "6280000019903");
  for (const uid of [fin, gaStaf]) await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${uid}, ${g.id}) ON CONFLICT DO NOTHING`;

  let [kat] = await sql`SELECT id FROM ga_asset_categories WHERE nama = 'UJI-GA kategori'`;
  if (!kat) [kat] = await sql`INSERT INTO ga_asset_categories (code, nama) VALUES ('UJI-GA', 'UJI-GA kategori') RETURNING id`;
  const [aset] = await sql`INSERT INTO ga_assets (asset_code, nama, category_id) VALUES ('UJI-GA-BARU-1', 'Genset uji', ${kat.id}) RETURNING id`;
  const assetId = String(aset.id);
  const aktor = { actor_user_id: gaStaf, actor_name: "Uji Staf GA Finance" };

  console.log("1. Biaya di bawah ambang");
  const j1 = await jadwal(assetId, 3);
  const c1 = await completeSchedule(j1, { cost_actual: 2_000_000, ...aktor });
  cek("langsung done tanpa approval", isRow(c1) && c1.status === "done" && !c1.approval_request_id);
  const [rec1] = await sql`SELECT count(*)::int AS n FROM ga_maintenance_schedules WHERE recur_parent_id = ${j1}`;
  cek("jadwal berikutnya dibuat", rec1.n === 1);

  console.log("2. Biaya di atas ambang → approval");
  const j2 = await jadwal(assetId, 6);
  const c2 = await completeSchedule(j2, { cost_actual: 7_500_000, ...aktor });
  cek("status pending_finance + approval tertaut", isRow(c2) && c2.status === "pending_finance" && !!c2.approval_request_id, isRow(c2) ? c2.approval_kode ?? "" : JSON.stringify(c2));
  cek("notifikasi ke grup Finance terkirim", isRow(c2) && c2.notify?.ok === true, isRow(c2) ? c2.notify?.error : "");
  const apr2 = isRow(c2) ? c2.approval_request_id! : "";
  const [peng] = await sql`SELECT requested_by_user_id FROM approval_request WHERE id = ${apr2}`;
  cek("penyelesai tercatat sebagai pengaju", String(peng?.requested_by_user_id) === gaStaf);

  console.log("3. Wewenang");
  const luarR = await decideFromDashboard(apr2, "approve", luar);
  cek("bukan anggota grup ditolak", !luarR.ok, luarR.error);
  const sendiri = await decideFromDashboard(apr2, "approve", gaStaf);
  cek("penyelesai (anggota grup) tak bisa menyetujui sendiri", !sendiri.ok && /sendiri/.test(sendiri.error ?? ""), sendiri.error);
  const tombolLama = await approveSchedule(j2, { approved_by: luar, legacy_allowed: true });
  cek("tombol Approve lama ikut aturan engine", !isRow(tombolLama), "error" in tombolLama ? tombolLama.error : "");

  console.log("4. Disetujui via tombol /ga-aset");
  const ok = await approveSchedule(j2, { approved_by: fin });
  cek("done + approved_by = akun Finance", isRow(ok) && ok.status === "done" && ok.approved_by === fin);
  const [rec2] = await sql`SELECT count(*)::int AS n FROM ga_maintenance_schedules WHERE recur_parent_id = ${j2}`;
  cek("jadwal berikutnya dibuat sesudah approval", rec2.n === 1);

  console.log("5. Ditolak lalu diselesaikan ulang");
  const j3 = await jadwal(assetId);
  const c3 = await completeSchedule(j3, { cost_actual: 8_000_000, ...aktor });
  const apr3 = isRow(c3) ? c3.approval_request_id! : "";
  const tolak = await decideFromDashboard(apr3, "reject", fin, "nota kurang");
  const s3 = await getSchedule(j3);
  cek("ditolak → kembali in_progress", tolak.ok && s3?.status === "in_progress" && !s3.completed_at, s3?.status);
  const ulang = await completeSchedule(j3, { cost_actual: 4_000_000, ...aktor });
  cek("selesai ulang di bawah ambang TETAP butuh approval", isRow(ulang) && ulang.status === "pending_finance" && ulang.approval_request_id !== apr3);
  const kode = isRow(ulang) ? ulang.approval_kode! : "";
  const viaWa = await decideCurrentStep(kode, "approve", (await resolveApproverByUserId(fin))!, null);
  const s3b = await getSchedule(j3);
  cek("disetujui via WA → done", viaWa.ok && s3b?.status === "done" && s3b.approved_by === fin, viaWa.error);

  console.log("6. Jadwal pindahan (backfill 249)");
  if (pindahan.length === 0) console.log("  (lewati — tak ada fixture UJI-GA-PINDAHAN di DB ini)");
  for (const p of pindahan) {
    const s = await getSchedule(String(p.id));
    cek("pindahan: pending_finance + punya kode", s?.status === "pending_finance" && !!s.approval_kode, s?.approval_kode ?? "");
    const r = await decideFromDashboard(s!.approval_request_id!, "approve", fin);
    const s2 = await getSchedule(String(p.id));
    cek("pindahan: disetujui → done", r.ok && s2?.status === "done", r.error);
  }

  await bersihkan();
  console.log(gagal === 0 ? "\nSEMUA LOLOS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await bersihkan();
  } catch {
    /* abaikan */
  }
  await sql.end();
  process.exit(1);
});
