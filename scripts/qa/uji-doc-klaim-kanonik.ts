// Uji DOC #KLAIM sebagai konsumen mesin approval F11 (migrasi 250) —
// MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-doc-klaim-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
//
// Yang dibuktikan:
//   1. Klaim baru (input manual) lahir bersama approval alur 'doc-klaim'.
//   2. HoD pengaju menyetujui dari dashboard dengan nominal lebih kecil →
//      status disetujui + nominal_disetujui ikut.
//   3. Admin/Direktur tak lagi bisa mewakili HoD; pengaju tak bisa memutus.
//   4. #APPROVE (WA) pada klaim yang nominal notanya tak terbaca ditolak
//      dengan arahan ke dashboard; klaim tetap 'baru', approval tetap pending.
//   5. Tolak → ditolak + catatan.
//   6. Klaim tanpa HoD dialihkan ke Direktur.
//   7. Hapus klaim baru → approval canceled.
//   8. Klaim pindahan (backfill 250) bisa diputus.
//
// Baris uji (karyawan "Uji Klaim *") dibersihkan di awal DAN di akhir.

import { db } from "../../apps/api/src/db.js";
import { decideCurrentStep, getApprovalRequest, resolveApproverByUserId } from "../../apps/api/src/repo/approval.js";
import {
  createKlaimManual,
  decideKlaim,
  deleteKlaim,
  getKlaim,
  type AktorKlaim,
  type DocKlaimRow,
} from "../../apps/api/src/repo/doc-klaim.js";

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
const isRow = (x: unknown): x is DocKlaimRow => !!x && typeof x === "object" && "status" in (x as object);

async function bersihkan(semua: boolean) {
  const filter = semua ? sql`e.nama LIKE 'Uji Klaim%'` : sql`e.nama LIKE 'Uji Klaim Baru%'`;
  await sql`
    DELETE FROM approval_request WHERE ref_tabel = 'doc_klaim' AND ref_id IN (
      SELECT d.id::text FROM doc_klaim d JOIN employee e ON e.id = d.employee_id WHERE ${filter})
  `;
  await sql`DELETE FROM doc_klaim d USING employee e WHERE e.id = d.employee_id AND ${filter}`;
  if (semua) {
    await sql`DELETE FROM employee WHERE nama LIKE 'Uji Klaim%'`;
    await sql`DELETE FROM app_user WHERE email LIKE 'uji-klaim-%@dev.local'`;
  }
}

async function user(email: string, name: string, o: { role?: string; hodKey?: string | null; amId?: string | null }) {
  const [u] = await sql`
    INSERT INTO app_user (email, password_hash, name, role, hod_key, am_id, wa_number)
    VALUES (${email}, 'x', ${name}, ${o.role ?? "user"}, ${o.hodKey ?? null}, ${o.amId ?? null}, '6280000020' || floor(random()*900+100)::text)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  return String(u.id);
}

async function employee(id: string, nama: string, amId: string, hodKey: string | null) {
  await sql`
    INSERT INTO employee (id, nama, am_id, hod_key) VALUES (${id}, ${nama}, ${amId}, ${hodKey})
    ON CONFLICT (id) DO UPDATE SET am_id = EXCLUDED.am_id, hod_key = EXCLUDED.hod_key
  `;
}

const aktor = (userId: string, o: Partial<AktorKlaim> = {}): AktorKlaim =>
  ({ userId, amId: null, hodKey: null, role: "user", superuser: false, finance: false, ...o });

async function main() {
  const pindahan = await sql`
    SELECT d.id FROM doc_klaim d JOIN employee e ON e.id = d.employee_id
    WHERE e.nama = 'Uji Klaim Pindahan' AND d.approval_request_id IS NOT NULL
  `;
  await bersihkan(false);

  const hod = await user("uji-klaim-hod@dev.local", "Uji HoD Klaim", { role: "hod", hodKey: "uji-hod-klaim" });
  const staf = await user("uji-klaim-staf@dev.local", "Uji Staf Klaim", { amId: "uji-am-klaim" });
  const admin = await user("uji-klaim-admin@dev.local", "Uji Admin", { role: "admin" });
  let [d] = await sql`SELECT id FROM app_user WHERE role = 'direktur' AND active ORDER BY created_at LIMIT 1`;
  const direktur = d ? String(d.id) : await user("uji-klaim-dir@dev.local", "Uji Direktur", { role: "direktur" });
  await employee("uji-klaim-baru-1", "Uji Klaim Baru Staf", "uji-am-klaim", "uji-hod-klaim");
  await employee("uji-klaim-baru-2", "Uji Klaim Baru TanpaHoD", "uji-am-klaim-2", null);

  console.log("1. Klaim baru");
  const k1 = await createKlaimManual({ employee_id: "uji-klaim-baru-1", nominal: "Rp 150.000", pihak: "Toko ATK", kategori: "kebutuhan_kantor" });
  cek("approval tertaut", isRow(k1) && !!k1.approval_request_id && !!k1.approval_kode, isRow(k1) ? k1.approval_kode ?? "" : JSON.stringify(k1));
  const id1 = isRow(k1) ? k1.id : "";
  const apr1 = await getApprovalRequest(isRow(k1) ? k1.approval_request_id! : "");
  cek("tahap HoD = HoD pengaju; pengaju = akun staf", apr1?.steps[0].hodKey === "uji-hod-klaim" && apr1.steps[0].notifiedAt !== null);

  console.log("2. Wewenang");
  const viaAdmin = await decideKlaim(id1, { decision: "disetujui" }, aktor(admin, { role: "admin", superuser: true }));
  cek("admin tak bisa mewakili HoD", !viaAdmin.ok, viaAdmin.error);
  const viaDir = await decideKlaim(id1, { decision: "disetujui" }, aktor(direktur, { role: "direktur" }));
  cek("Direktur tak bisa mewakili HoD (HoD tercatat)", !viaDir.ok, viaDir.error);
  const viaStaf = await decideKlaim(id1, { decision: "disetujui" }, aktor(staf, { amId: "uji-am-klaim" }));
  cek("pengaju tak bisa memutus", !viaStaf.ok, viaStaf.error);
  const lebih = await decideKlaim(id1, { decision: "disetujui", nominal_disetujui: 200000 }, aktor(hod, { hodKey: "uji-hod-klaim" }));
  cek("nominal melebihi nota ditolak sebelum ke engine", !lebih.ok, lebih.error);
  const ok1 = await decideKlaim(id1, { decision: "disetujui", nominal_disetujui: 120000, catatan: "parkir tak diganti" }, aktor(hod, { hodKey: "uji-hod-klaim" }));
  const r1 = await getKlaim(id1);
  cek("HoD setujui 120rb → disetujui + nominal ikut", ok1.ok && r1?.status === "disetujui" && r1.nominal_disetujui === 120000 && r1.catatan === "parkir tak diganti", ok1.error);

  console.log("3. #APPROVE WA, nota tak terbaca");
  await sql`UPDATE employee SET hod_key = 'uji-hod-klaim' WHERE id = 'uji-klaim-baru-1'`;
  const k2raw = await sql`
    INSERT INTO doc_klaim (employee_id, am_id, hod_key, nominal, model_used, ocr_dry_run)
    VALUES ('uji-klaim-baru-1', 'uji-am-klaim', 'uji-hod-klaim', 'tak jelas', 'manual', false) RETURNING id
  `;
  // Klaim dengan nota tak terbaca tak bisa lewat createKlaimManual (validasi
  // nominal) — buka approval-nya lewat jalur yang sama dengan backfill.
  const id2 = String(k2raw[0].id);
  const [{ kode2, apr2 }] = await sql`
    WITH n AS (SELECT nextval('approval_request_kode_seq') AS n),
    r AS (
      INSERT INTO approval_request (kode, jenis, title, requested_by, requested_by_user_id, current_urutan, hod_pengaju, ref_tabel, ref_id)
      SELECT 'APR-' || lpad(n::text, 6, '0'), 'doc-klaim', 'Klaim: uji nota buram', 'Uji Staf', ${staf}, 1, 'uji-hod-klaim', 'doc_klaim', ${id2} FROM n
      RETURNING id, kode)
    SELECT kode AS kode2, id AS apr2 FROM r
  `;
  await sql`INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key) VALUES (${apr2}, 1, 'HoD', 'hod_pengaju', 'uji-hod-klaim')`;
  await sql`UPDATE doc_klaim SET approval_request_id = ${apr2} WHERE id = ${id2}`;
  const wa = await decideCurrentStep(String(kode2), "approve", (await resolveApproverByUserId(hod))!, null);
  const r2 = await getKlaim(id2);
  const a2 = await getApprovalRequest(String(apr2));
  cek("WA #APPROVE ditolak dengan arahan ke dashboard", !wa.ok && /doc-klaim/.test(wa.error ?? ""), wa.error);
  cek("klaim tetap baru, approval tetap pending", r2?.status === "baru" && a2?.status === "pending");
  const tolak = await decideKlaim(id2, { decision: "ditolak" }, aktor(hod, { hodKey: "uji-hod-klaim" }));
  cek("tolak dari dashboard tanpa alasan ditolak", !tolak.ok, tolak.error);
  const tolak2 = await decideKlaim(id2, { decision: "ditolak", catatan: "nota buram" }, aktor(hod, { hodKey: "uji-hod-klaim" }));
  const r2b = await getKlaim(id2);
  cek("tolak dengan alasan → ditolak + catatan", tolak2.ok && r2b?.status === "ditolak" && r2b.catatan === "nota buram", tolak2.error);

  console.log("4. Klaim tanpa HoD → Direktur");
  const k3 = await createKlaimManual({ employee_id: "uji-klaim-baru-2", nominal: "50000" });
  const apr3 = await getApprovalRequest(isRow(k3) ? k3.approval_request_id! : "");
  cek("langkah dialihkan ke Direktur", apr3?.steps[0].targetType === "direktur" && /Direktur/.test(apr3.steps[0].label), apr3?.steps[0].label);
  const viaDir3 = await decideKlaim(isRow(k3) ? k3.id : "", { decision: "disetujui" }, aktor(direktur, { role: "direktur" }));
  cek("Direktur menyetujui → disetujui, nominal = nota", viaDir3.ok && (await getKlaim(isRow(k3) ? k3.id : ""))?.nominal_disetujui === 50000, viaDir3.error);

  console.log("5. Hapus klaim baru");
  const k4 = await createKlaimManual({ employee_id: "uji-klaim-baru-1", nominal: "10000" });
  const apr4 = isRow(k4) ? k4.approval_request_id! : "";
  const del = await deleteKlaim(isRow(k4) ? k4.id : "");
  const [s4] = await sql`SELECT status FROM approval_request WHERE id = ${apr4}`;
  cek("klaim terhapus, approval canceled", del.ok && s4?.status === "canceled", s4?.status);

  console.log("6. Klaim pindahan (backfill 250)");
  if (pindahan.length === 0) console.log("  (lewati — tak ada fixture 'Uji Klaim Pindahan' di DB ini)");
  for (const p of pindahan) {
    const k = await getKlaim(String(p.id));
    cek("pindahan: baru + punya kode", k?.status === "baru" && !!k.approval_kode, k?.approval_kode ?? "");
    const r = await decideKlaim(String(p.id), { decision: "disetujui" }, aktor(hod, { hodKey: "uji-hod-klaim" }));
    cek("pindahan: HoD menyetujui → disetujui", r.ok && (await getKlaim(String(p.id)))?.status === "disetujui", r.error);
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
