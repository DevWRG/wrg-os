// Uji mesin approval kanonik F11 (migrasi 247) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-approval-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB (sent:true tanpa kirim apa pun), jadi
// aman dijalankan di mana pun selain prod. Menolak jalan bila DATABASE_URL
// menyebut "prod".
//
// Yang dibuktikan (semuanya hidup di SQL, jadi tak bisa diuji murni):
//   1. Alur baru dengan tahap hod_pengaju → grup → (nonaktif) → direktur:
//      langkah tahap nonaktif tak dibuat, urutan berlubang tetap maju benar.
//   2. Pengaju tak bisa memutuskan request sendiri, walau anggota grup tahap itu.
//   3. Bukan giliran → ditolak; dashboard & WA memakai aturan yang sama.
//   4. Satu baris induk = satu request pending (index unik ref).
//   5. Penangan konsumen dipanggil DI transaksi keputusan; error penangan
//      membatalkan keputusan.
//   6. "Menunggu Saya" hanya memuat request yang memang bisa diputus akun itu.
//   7. SLA: pengingat lalu eskalasi, masing-masing sekali.
//   8. Alur 'pengadaan' lama tetap 5 tahap dan tak butuh atribut baru.
//
// Semua baris uji (prefiks "uji-f11k") dibersihkan di awal DAN di akhir.

import { db } from "../../apps/api/src/db.js";
import {
  batalkanRequestDalamTx,
  createApprovalRequest,
  daftarKonsumen,
  decideCurrentStep,
  decideFromDashboard,
  getApprovalRequest,
  listApprovalRequests,
  resolveApproverByUserId,
  runApprovalSla,
} from "../../apps/api/src/repo/approval.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const sql = db();
const JENIS = "uji-f11k";
const GRUP = "uji-f11k-grup";
const REF = "uji_f11k_induk";

let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket : ""}`);
  if (!ok) gagal++;
};

async function bersihkan() {
  await sql`DELETE FROM approval_request WHERE jenis = ${JENIS} OR title LIKE 'uji-f11k%'`;
  await sql`DELETE FROM approval_chain_config WHERE jenis = ${JENIS}`;
  await sql`DELETE FROM approval_alur WHERE jenis = ${JENIS}`;
  await sql`DELETE FROM app_user WHERE email LIKE 'uji-f11k-%@dev.local'`;
  await sql`DELETE FROM access_group WHERE key = ${GRUP}`;
}

async function buatUser(nama: string, opts: { role?: string; hodKey?: string | null; wa: string }) {
  const [u] = await sql`
    INSERT INTO app_user (email, password_hash, name, role, hod_key, wa_number, active)
    VALUES (${`uji-f11k-${nama}@dev.local`}, 'x', ${`Uji ${nama}`}, ${opts.role ?? "user"}, ${opts.hodKey ?? null}, ${opts.wa}, true)
    RETURNING id
  `;
  return String(u.id);
}

async function main() {
  await bersihkan();

  // ── Fixture ────────────────────────────────────────────────────────
  const [g] = await sql`INSERT INTO access_group (key, name) VALUES (${GRUP}, 'Uji F11K') RETURNING id`;
  const pengaju = await buatUser("pengaju", { hodKey: "uji-hod-a", wa: "6280000017701" });
  const hodB = await buatUser("hodb", { hodKey: "uji-hod-b", wa: "6280000017702" });
  const fin1 = await buatUser("fin1", { wa: "6280000017703" });
  const fin2 = await buatUser("fin2", { wa: "6280000017704" });
  const luar = await buatUser("luar", { hodKey: "uji-hod-c", wa: "6280000017705" });
  for (const uid of [fin1, fin2, pengaju]) {
    await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${uid}, ${g.id})`;
  }
  // Direktur: pakai yang ada di dev kalau ada; kalau tidak, buat.
  let [dir] = await sql`SELECT id FROM app_user WHERE role = 'direktur' AND active AND wa_number <> '' ORDER BY created_at LIMIT 1`;
  const direktur = dir ? String(dir.id) : await buatUser("direktur", { role: "direktur", wa: "6280000017709" });

  await sql`INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi) VALUES (${JENIS}, 'Uji F11K', 2, true)`;
  await sql`
    INSERT INTO approval_chain_config (jenis, urutan, label, target_type, group_key, aktif) VALUES
      (${JENIS}, 1, 'HoD Divisi', 'hod_pengaju', NULL, true),
      (${JENIS}, 2, 'Finance', 'grup', ${GRUP}, true),
      (${JENIS}, 3, 'Tahap Mati', 'direktur', NULL, false),
      (${JENIS}, 4, 'Direktur', 'direktur', NULL, true)
  `;

  const dipanggil: string[] = [];
  let lempar = false;
  daftarKonsumen(REF, async (tx, h) => {
    if (lempar) throw new Error("penangan sengaja gagal");
    dipanggil.push(`${h.status}:${h.refId}`);
    // Bukti berjalan di transaksi yang sama: status request sudah terlihat final.
    const [r] = await tx`SELECT status FROM approval_request WHERE id = ${h.requestId}`;
    dipanggil.push(`tx-lihat:${r.status}`);
  });

  console.log("1. Buat request alur baru");
  const tanpaHod = await createApprovalRequest({ jenis: JENIS, title: "uji-f11k tanpa hod", requestedBy: "Uji pengaju", requestedByUserId: pengaju });
  cek("alur ber-tahap hod_pengaju menolak request tanpa HoD pengaju", !tanpaHod.ok, tanpaHod.error);

  const r1 = await createApprovalRequest({
    jenis: JENIS, title: "uji-f11k dana", requestedBy: "Uji pengaju", requestedByUserId: pengaju,
    hodPengaju: "uji-hod-b", refTabel: REF, refId: "1", nominal: 1500000,
  });
  cek("request dibuat & tahap 1 dinotif", r1.ok && r1.notify?.ok === true, r1.error ?? r1.notify?.error);
  const d1 = await getApprovalRequest(r1.id!);
  cek("tahap nonaktif tak dibuatkan langkah", JSON.stringify(d1?.steps.map((s) => s.urutan)) === "[1,2,4]", JSON.stringify(d1?.steps.map((s) => s.urutan)));
  cek("snapshot hod_pengaju = HoD yang dibawa request", d1?.steps[0].hodKey === "uji-hod-b");
  cek("SLA due terisi dari notified_at + sla_jam", !!d1?.slaDueAt);

  const dobel = await createApprovalRequest({
    jenis: JENIS, title: "uji-f11k dana dobel", requestedBy: "Uji pengaju", requestedByUserId: pengaju,
    hodPengaju: "uji-hod-b", refTabel: REF, refId: "1",
  });
  cek("baris induk yang sama tak bisa punya 2 request pending", !dobel.ok, dobel.error);

  console.log("2. Wewenang");
  const salahOrang = await decideFromDashboard(r1.id!, "approve", luar);
  cek("HoD lain ditolak", !salahOrang.ok, salahOrang.error);
  const tolakTanpaAlasan = await decideFromDashboard(r1.id!, "reject", hodB, "  ");
  cek("tolak dari dashboard wajib alasan", !tolakTanpaAlasan.ok, tolakTanpaAlasan.error);

  const menungguHodB = await listApprovalRequests({ menungguUserId: hodB, jenis: JENIS });
  const menungguLuar = await listApprovalRequests({ menungguUserId: luar, jenis: JENIS });
  cek("'Menunggu Saya' HoD B memuat request", menungguHodB.some((x) => x.id === r1.id));
  cek("'Menunggu Saya' HoD lain kosong", menungguLuar.length === 0);
  const lihatB = await getApprovalRequest(r1.id!, { viewerUserId: hodB });
  const lihatLuar = await getApprovalRequest(r1.id!, { viewerUserId: luar });
  cek("detail: wewenang HoD B = boleh", lihatB?.wewenang?.boleh === true);
  cek("detail: wewenang HoD lain = tidak", lihatLuar?.wewenang?.boleh === false);

  const okB = await decideFromDashboard(r1.id!, "approve", hodB);
  cek("HoD B setujui via dashboard → lanjut ke grup", okB.ok && okB.status === "pending", okB.error);

  const sendiri = await decideFromDashboard(r1.id!, "approve", pengaju);
  cek("pengaju (anggota grup) TAK boleh memutus request sendiri", !sendiri.ok && /sendiri/.test(sendiri.error ?? ""), sendiri.error);
  const menungguPengaju = await listApprovalRequests({ menungguUserId: pengaju, jenis: JENIS });
  cek("'Menunggu Saya' pengaju tak memuat request sendiri", !menungguPengaju.some((x) => x.id === r1.id));

  const ap = await resolveApproverByUserId(fin1);
  const viaWa = await decideCurrentStep(d1!.kode, "approve", ap!, null);
  cek("anggota grup setujui via WA → tahap 3 (mati) dilompati ke Direktur", viaWa.ok && viaWa.status === "pending", viaWa.error);
  const d1b = await getApprovalRequest(r1.id!);
  cek("current_urutan = 4", d1b?.currentUrutan === 4, String(d1b?.currentUrutan));
  cek("kanal keputusan tercatat", d1b?.steps[0].decidedVia === "dashboard" && d1b?.steps[1].decidedVia === "wa");

  console.log("3. Penangan konsumen");
  lempar = true;
  const gagalPenangan = await decideFromDashboard(r1.id!, "approve", direktur).catch((e: Error) => ({ ok: false, error: e.message }));
  const d1c = await getApprovalRequest(r1.id!);
  cek("penangan gagal → keputusan ikut batal (masih pending di tahap 4)", !gagalPenangan.ok && d1c?.status === "pending" && d1c.currentUrutan === 4);
  lempar = false;
  const final = await decideFromDashboard(r1.id!, "approve", direktur);
  cek("Direktur setujui → approved", final.ok && final.status === "approved", final.error);
  cek("penangan dipanggil sekali, di dalam transaksi", JSON.stringify(dipanggil) === JSON.stringify(["approved:1", "tx-lihat:approved"]), JSON.stringify(dipanggil));
  const lagi = await decideFromDashboard(r1.id!, "approve", direktur);
  cek("keputusan ulang ditolak", !lagi.ok);

  console.log("4. Reject & batal");
  const r2 = await createApprovalRequest({ jenis: JENIS, title: "uji-f11k tolak", requestedBy: "Uji pengaju", requestedByUserId: pengaju, hodPengaju: "uji-hod-b", refTabel: REF, refId: "2" });
  const tolak = await decideFromDashboard(r2.id!, "reject", hodB, "anggaran habis");
  cek("tolak di tahap 1 menghentikan request", tolak.ok && tolak.status === "rejected");
  cek("penangan menerima rejected", dipanggil.includes("rejected:2"));
  const r2b = await createApprovalRequest({ jenis: JENIS, title: "uji-f11k ajukan ulang", requestedBy: "Uji pengaju", requestedByUserId: pengaju, hodPengaju: "uji-hod-b", refTabel: REF, refId: "2" });
  cek("induk yang ditolak boleh diajukan ulang", r2b.ok, r2b.error);
  const batal = await sql.begin((tx) => batalkanRequestDalamTx(tx as never, { refTabel: REF, refId: "2" }, "Uji pengaju", "ditarik"));
  const d2b = await getApprovalRequest(r2b.id!);
  cek("batal dari sisi induk → canceled, langkah pending jadi skipped", batal.ok && d2b?.status === "canceled" && d2b.steps.every((s) => s.status !== "pending"));
  cek("batal dari sisi induk tak memanggil balik penangan", !dipanggil.some((x) => x.startsWith("canceled")));

  console.log("5. SLA");
  const r3 = await createApprovalRequest({ jenis: JENIS, title: "uji-f11k sla", requestedBy: "Uji pengaju", requestedByUserId: pengaju, hodPengaju: "uji-hod-b", refTabel: REF, refId: "3" });
  await sql`UPDATE approval_step SET notified_at = now() - interval '3 hours' WHERE request_id = ${r3.id!} AND urutan = 1`;
  const s1 = await runApprovalSla();
  const st1 = (await getApprovalRequest(r3.id!))!.steps[0];
  cek("lewat 1× SLA → pengingat", !!st1.remindedAt && !st1.escalatedAt, JSON.stringify(s1));
  const s2 = await runApprovalSla();
  cek("pengingat tak terulang", s2.diingatkan === 0 && s2.dieskalasi === 0, JSON.stringify(s2));
  await sql`UPDATE approval_step SET notified_at = now() - interval '5 hours' WHERE request_id = ${r3.id!} AND urutan = 1`;
  await runApprovalSla();
  const st3 = (await getApprovalRequest(r3.id!))!.steps[0];
  cek("lewat 2× SLA → eskalasi", !!st3.escalatedAt);
  const s4 = await runApprovalSla();
  const st4 = (await getApprovalRequest(r3.id!))!.steps[0];
  cek("eskalasi tak terulang", st4.escalatedAt === st3.escalatedAt, JSON.stringify(s4));

  console.log("6. Alur pengadaan lama");
  const r4 = await createApprovalRequest({ title: "uji-f11k pengadaan", requestedBy: "Uji pengaju", wilayah: "east", kategori: "IVD" });
  const d4 = await getApprovalRequest(r4.id!);
  cek("default jenis = pengadaan, 5 tahap", d4?.jenis === "pengadaan" && d4.steps.length === 5, `${d4?.jenis} ${d4?.steps.length}`);
  cek("routing wilayah/kategori tetap jalan", d4?.steps[0].hodKey === "rocky" && d4?.steps[1].hodKey === "mufid", `${d4?.steps[0].hodKey}/${d4?.steps[1].hodKey}`);

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
