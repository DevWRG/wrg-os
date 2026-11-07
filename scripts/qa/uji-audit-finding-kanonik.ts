// Uji F60 Audit Findings sebagai konsumen mesin approval F11 (migrasi 255) —
// MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-audit-finding-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
// Config tahap 'audit-finding' dicadangkan di awal & dipulihkan di akhir.
//
// Yang dibuktikan:
//   1. Panel config (id grup) menulis config engine (key grup); syarat min. 2 tahap.
//   2. Ajukan penutupan → approval engine + finding pending_closure (atomik);
//      pengajuan kedua ditolak.
//   3. Bukan anggota grup ditolak; pengaju ditolak; orang yang sama tak bisa
//      memutus dua tahap (satu_orang_satu_tahap); klik basi ditolak.
//   4. Semua tahap setuju → finding closed; ditolak → in_progress, bisa diajukan ulang.
//   5. Bentuk activeRequest (id grup, pemutus) sama dengan F60 lama.
//   6. Pengajuan F60 lama yang dipindah (backfill 255) bisa diteruskan.

import { db } from "../../apps/api/src/db.js";
import {
  decideStep,
  getActiveApprovalRequest,
  getFinding,
  listChainConfig,
  requestClosure,
  updateChainConfigStep,
} from "../../apps/api/src/repo/audit-finding.js";

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
let cadangan: { urutan: number; group_key: string | null; aktif: boolean }[] = [];

async function bersihkan(pulihkanConfig: boolean) {
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'audit_finding' AND ref_id IN (SELECT id::text FROM audit_finding WHERE title LIKE 'uji-af %')`;
  await sql`DELETE FROM audit_finding WHERE title LIKE 'uji-af %'`;
  if (pulihkanConfig) {
    for (const c of cadangan) {
      await sql`UPDATE approval_chain_config SET group_key = ${c.group_key}, aktif = ${c.aktif} WHERE jenis = 'audit-finding' AND urutan = ${c.urutan}`;
    }
    await sql`DELETE FROM app_user WHERE email LIKE 'uji-af-%@dev.local'`;
    await sql`DELETE FROM access_group WHERE key LIKE 'uji-af-%'`;
  }
}

async function user(nama: string, wa: string) {
  const [u] = await sql`INSERT INTO app_user (email, password_hash, name, role, wa_number) VALUES (${`uji-af-${nama}@dev.local`}, 'x', ${`Uji ${nama}`}, 'user', ${wa})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  return String(u.id);
}

async function finding(status = "in_progress") {
  const [{ seq }] = await sql`SELECT floor(random() * 1e9)::bigint AS seq`;
  const [f] = await sql`INSERT INTO audit_finding (kode, title, status) VALUES (${`UJI-AF-${seq}`}, ${`uji-af ${seq}`}, ${status}) RETURNING id`;
  return String(f.id);
}

async function main() {
  const pindahan = await sql`
    SELECT f.id FROM audit_finding f WHERE f.title = 'uji-af pindahan' AND f.approval_request_id IS NOT NULL
  `;
  cadangan = (await sql`SELECT urutan, group_key, aktif FROM approval_chain_config WHERE jenis = 'audit-finding'`).map((r) => ({
    urutan: Number(r.urutan), group_key: r.group_key ? String(r.group_key) : null, aktif: Boolean(r.aktif),
  }));
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'audit_finding' AND ref_id IN (SELECT id::text FROM audit_finding WHERE title LIKE 'uji-af %' AND title <> 'uji-af pindahan')`;
  await sql`DELETE FROM audit_finding WHERE title LIKE 'uji-af %' AND title <> 'uji-af pindahan'`;

  const [g1] = await sql`INSERT INTO access_group (key, name) VALUES ('uji-af-l1', 'Uji Layer 1') ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const [g2] = await sql`INSERT INTO access_group (key, name) VALUES ('uji-af-l2', 'Uji Layer 2') ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const pic = await user("pic", "6280000022001");
  const a1 = await user("a1", "6280000022002");
  const a2 = await user("a2", "6280000022003");
  const dobel = await user("dobel", "6280000022004");
  for (const [u, g] of [[a1, g1.id], [a2, g2.id], [dobel, g1.id], [dobel, g2.id], [pic, g1.id]] as const) {
    await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${u}, ${g}) ON CONFLICT DO NOTHING`;
  }

  console.log("1. Config panel → engine");
  for (const c of cadangan) await updateChainConfigStep(c.urutan, { enabled: false, accessGroupId: null });
  const f0 = await finding();
  const kurang = await requestClosure(f0, pic);
  cek("kurang dari 2 tahap aktif → ditolak", !kurang.ok, kurang.error);
  await updateChainConfigStep(1, { accessGroupId: Number(g1.id), enabled: true });
  await updateChainConfigStep(2, { accessGroupId: Number(g2.id), enabled: true });
  const cfg = await listChainConfig();
  const [eng] = await sql`SELECT group_key FROM approval_chain_config WHERE jenis = 'audit-finding' AND urutan = 2`;
  cek("panel memakai id grup, engine menyimpan key", cfg.find((c) => c.urutan === 2)?.accessGroupId === Number(g2.id) && eng.group_key === "uji-af-l2");

  console.log("2. Ajukan penutupan");
  const r1 = await requestClosure(f0, pic);
  const f0a = await getFinding(f0);
  cek("approval engine + finding pending_closure", r1.ok && f0a?.status === "pending_closure", r1.error);
  const r1b = await requestClosure(f0, pic);
  cek("pengajuan kedua ditolak", !r1b.ok, r1b.error);
  const act = await getActiveApprovalRequest(f0);
  cek("activeRequest bentuk F60: id grup & 2 langkah", act?.steps.length === 2 && act.steps[0].accessGroupId === Number(g1.id) && act.requestedBy === pic);

  console.log("3. Wewenang");
  const luar = await decideStep({ requestId: r1.requestId!, action: "approve", deciderUserId: a2, expectedUrutan: 1 });
  cek("bukan anggota grup tahap ini ditolak", !luar.ok, luar.error);
  const sendiri = await decideStep({ requestId: r1.requestId!, action: "approve", deciderUserId: pic, expectedUrutan: 1 });
  cek("pengaju (anggota grup) ditolak", !sendiri.ok, sendiri.error);
  const d1 = await decideStep({ requestId: r1.requestId!, action: "approve", deciderUserId: dobel, expectedUrutan: 1 });
  cek("anggota dua grup menyetujui tahap 1", d1.ok && d1.status === "pending", d1.error);
  const basi = await decideStep({ requestId: r1.requestId!, action: "approve", deciderUserId: a1, expectedUrutan: 1 });
  cek("klik basi (masih lihat tahap 1) ditolak", !basi.ok && /tahap sudah berubah/.test(basi.error ?? ""), basi.error);
  const dua = await decideStep({ requestId: r1.requestId!, action: "approve", deciderUserId: dobel, expectedUrutan: 2 });
  cek("orang yang sama tak bisa memutus tahap 2", !dua.ok && /satu tahap/.test(dua.error ?? ""), dua.error);
  const act2 = await getActiveApprovalRequest(f0);
  cek("pemutus tahap 1 tercatat sebagai id akun", act2?.steps[0].decidedBy === dobel);
  const d2 = await decideStep({ requestId: r1.requestId!, action: "approve", deciderUserId: a2, note: "oke", expectedUrutan: 2 });
  cek("tahap terakhir disetujui → finding closed", d2.ok && (await getFinding(f0))?.status === "closed", d2.error);

  console.log("4. Ditolak lalu ajukan ulang");
  const f1 = await finding();
  const r2 = await requestClosure(f1, pic);
  const tolak = await decideStep({ requestId: r2.requestId!, action: "reject", deciderUserId: a1, note: "bukti kurang", expectedUrutan: 1 });
  cek("ditolak → finding in_progress", tolak.ok && (await getFinding(f1))?.status === "in_progress", tolak.error);
  const ulang = await requestClosure(f1, pic);
  cek("bisa diajukan ulang", ulang.ok, ulang.error);

  console.log("5. Pengajuan F60 lama (backfill 255)");
  if (pindahan.length === 0) console.log("  (lewati — tak ada fixture 'uji-af pindahan' di DB ini)");
  for (const p of pindahan) {
    const a = await getActiveApprovalRequest(String(p.id));
    const [lama] = await sql`SELECT status, dipindah_ke FROM audit_finding_approval_request WHERE finding_id = ${p.id} ORDER BY requested_at DESC LIMIT 1`;
    cek("pindahan: aktif di engine, baris lama canceled + dipindah_ke", !!a && lama?.status === "canceled" && String(lama.dipindah_ke) === a.id);
    cek("pindahan: keputusan tahap 1 lama ikut", a?.steps[0].status === "approved" && a.currentUrutan === 2, `${a?.steps[0].status}/${a?.currentUrutan}`);
    const r = await decideStep({ requestId: a!.id, action: "approve", deciderUserId: a2, expectedUrutan: 2 });
    cek("pindahan: tahap 2 disetujui → closed", r.ok && (await getFinding(String(p.id)))?.status === "closed", r.error);
  }

  await bersihkan(true);
  console.log(gagal === 0 ? "\nSEMUA LOLOS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await bersihkan(true);
  } catch {
    /* abaikan */
  }
  await sql.end();
  process.exit(1);
});
