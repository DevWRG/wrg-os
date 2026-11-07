// Uji dana ops (F138) sebagai konsumen mesin approval F11 (migrasi 248) —
// MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-dana-ops-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
//
// Yang dibuktikan:
//   1. Pengajuan baru lahir bersama approval_request alur 'dana-ops' (atomik).
//   2. Status pengajuan dibaca dari approval_step; UI per peran tetap utuh.
//   3. HoD yang mengajukan untuk dirinya sendiri tak bisa menyetujuinya.
//   4. Peran dari UI yang basi (tahap sudah maju) ditolak.
//   5. Batal sebelum ada keputusan → approval 'canceled', induk terhapus;
//      sesudah ada keputusan → 409.
//   6. Pengajuan pindahan (backfill 248) bisa diteruskan di engine.
//   7. Direktur Inbox tak menghitung pengajuan engine dua kali.
//
// Baris uji (prefiks "uji-dana") dibersihkan di awal DAN di akhir.

import { db } from "../../apps/api/src/db.js";
import { listDirekturInbox } from "../../apps/api/src/repo/direktur-inbox.js";
import {
  createFundRequest,
  decideFundRequestViaEngine,
  deleteFundRequest,
  FundRequestError,
  getFundRequest,
  listFundRequests,
} from "../../apps/api/src/repo/fund-request.js";

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

async function bersihkan() {
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'fund_request' AND title LIKE 'Dana operasional: uji-dana%'`;
  await sql`DELETE FROM fund_request WHERE purpose LIKE 'uji-dana%'`;
  await sql`DELETE FROM app_user WHERE email LIKE 'uji-dana-%@dev.local'`;
}

async function user(email: string, name: string, hodKey: string | null, role = "user", wa = "") {
  const [u] = await sql`
    INSERT INTO app_user (email, password_hash, name, role, hod_key, wa_number)
    VALUES (${email}, 'x', ${name}, ${role}, ${hodKey}, ${wa})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  return String(u.id);
}

async function gagalDengan(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof FundRequestError ? `${e.status} ${e.message}` : String(e);
  }
}

async function main() {
  // Pengajuan pindahan (dibuat fixture sebelum migrasi 248) tak dihapus di awal.
  const pindahan = await sql`SELECT id, purpose FROM fund_request WHERE purpose LIKE 'uji-dana %' AND approval_request_id IS NOT NULL ORDER BY purpose`;
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'fund_request' AND title LIKE 'Dana operasional: uji-dana-baru%'`;
  await sql`DELETE FROM fund_request WHERE purpose LIKE 'uji-dana-baru%'`;

  const hodDana = await user("uji-dana-hod@dev.local", "Uji HoD Dana", "uji-hod-dana", "hod", "6280000018801");
  const staf = await user("uji-dana-staf@dev.local", "Uji Staf", null, "user", "6280000018802");
  let [d] = await sql`SELECT id FROM app_user WHERE role = 'direktur' AND active ORDER BY created_at LIMIT 1`;
  const direktur = d ? String(d.id) : await user("uji-dana-dir@dev.local", "Uji Direktur", null, "direktur", "6280000018809");

  console.log("1. Pengajuan baru");
  const baru = await createFundRequest({
    requester_name: "Uji Staf", requester_email: "uji-dana-staf@dev.local", requester_user_id: staf,
    purpose: "uji-dana-baru bensin", amount_requested: 150000, hod_approver_key: "uji-hod-dana", cabang: "SBY",
  });
  cek("approval_request terbentuk & tertaut", !!baru.approval_request_id && !!baru.approval_kode, baru.approval_kode ?? "");
  cek("notifikasi tahap HoD terkirim", baru.notify?.ok === true, baru.notify?.error);
  cek("status awal pending_hod, 2 baris peran", baru.approval_status === "pending_hod" && baru.approvals.length === 2);
  const [jumlah] = await sql`SELECT count(*)::int AS n FROM fund_request_approval WHERE fund_request_id = ${baru.id}`;
  cek("tak ada lagi baris fund_request_approval untuk pengajuan baru", jumlah.n === 0);

  console.log("2. Wewenang");
  const lihatHod = await getFundRequest(baru.id, { viewerUserId: hodDana });
  const lihatStaf = await getFundRequest(baru.id, { viewerUserId: staf });
  cek("HoD terpilih: boleh, tahap hod", lihatHod?.approval?.wewenang?.boleh === true && lihatHod.approval.current_role === "hod");
  cek("pengaju: tidak boleh", lihatStaf?.approval?.wewenang?.boleh === false);
  const salahPeran = await gagalDengan(() => decideFundRequestViaEngine(baru.id, "direktur", "approve", direktur));
  cek("klik peran Direktur saat tahap HoD ditolak", salahPeran?.startsWith("409") === true, salahPeran ?? "");
  const tolakKosong = await gagalDengan(() => decideFundRequestViaEngine(baru.id, "hod", "reject", hodDana, ""));
  cek("tolak tanpa alasan ditolak", tolakKosong !== null, tolakKosong ?? "");
  const ok1 = await decideFundRequestViaEngine(baru.id, "hod", "approve", hodDana, "oke");
  cek("HoD setuju → pending_direktur", ok1.approval_status === "pending_direktur");
  const batalTelat = await gagalDengan(() => deleteFundRequest(baru.id, "Uji Staf"));
  cek("batal sesudah ada keputusan → 409", batalTelat?.startsWith("409") === true, batalTelat ?? "");

  const inbox = await listDirekturInbox();
  const dobel = inbox.items.filter((x) => x.judul?.includes("uji-dana-baru"));
  cek("Direktur Inbox memuat pengajuan sekali saja", dobel.length === 1, JSON.stringify(dobel.map((x) => x.jenis)));

  const ok2 = await decideFundRequestViaEngine(baru.id, "direktur", "approve", direktur);
  cek("Direktur setuju → approved", ok2.approval_status === "approved");
  const daftar = await listFundRequests({ status: "approved" });
  cek("filter status di daftar ikut engine", daftar.some((x) => x.id === baru.id));

  console.log("3. HoD mengajukan untuk dirinya sendiri");
  const sendiri = await createFundRequest({
    requester_name: "Uji HoD Dana", requester_email: "uji-dana-hod@dev.local", requester_user_id: hodDana,
    purpose: "uji-dana-baru sendiri", amount_requested: 50000, hod_approver_key: "uji-hod-dana",
  });
  const sendiriDecide = await gagalDengan(() => decideFundRequestViaEngine(sendiri.id, "hod", "approve", hodDana));
  cek("HoD tak bisa menyetujui pengajuannya sendiri", sendiriDecide !== null && /sendiri/.test(sendiriDecide), sendiriDecide ?? "");

  console.log("4. Batal sebelum keputusan");
  const aprId = sendiri.approval_request_id!;
  const del = await deleteFundRequest(sendiri.id, "Uji HoD Dana");
  const [apr] = await sql`SELECT status FROM approval_request WHERE id = ${aprId}`;
  cek("induk terhapus, approval jadi canceled", del.deleted === 1 && apr?.status === "canceled", apr?.status);

  console.log("5. Pengajuan pindahan (backfill 248)");
  if (pindahan.length === 0) {
    console.log("  (lewati — tak ada fixture pindahan 'uji-dana A/B' di DB ini)");
  }
  for (const p of pindahan) {
    const fr = await getFundRequest(String(p.id), { viewerUserId: direktur });
    if (String(p.purpose).includes("menunggu HoD")) {
      cek("A: pindahan menunggu HoD", fr?.approval_status === "pending_hod" && fr.approval?.current_role === "hod");
      const r = await decideFundRequestViaEngine(String(p.id), "hod", "approve", hodDana);
      cek("A: HoD bisa meneruskan di engine", r.approval_status === "pending_direktur");
    } else if (String(p.purpose).includes("menunggu Direktur")) {
      const hodRow = fr?.approvals.find((a) => a.approver_role === "hod");
      cek("B: keputusan HoD lama terbawa", hodRow?.status === "approved" && hodRow.note === "ok lanjut");
      cek("B: Direktur boleh memutus", fr?.approval?.wewenang?.boleh === true, fr?.approval?.wewenang?.alasan ?? "");
      const r = await decideFundRequestViaEngine(String(p.id), "direktur", "approve", direktur);
      cek("B: Direktur setuju → approved", r.approval_status === "approved");
    }
  }
  const lama = await sql`SELECT purpose FROM fund_request WHERE purpose LIKE 'uji-dana %' AND approval_request_id IS NULL ORDER BY purpose`;
  for (const l of lama) {
    const rows = await listFundRequests({});
    const r = rows.find((x) => x.purpose === l.purpose);
    const harap = String(l.purpose).includes("ditolak") ? "rejected" : "approved";
    cek(`pengajuan lama "${l.purpose}" tetap ${harap}`, r?.approval_status === harap, r?.approval_status);
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
