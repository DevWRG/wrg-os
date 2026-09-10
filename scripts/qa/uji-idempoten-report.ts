// Uji idempotensi #REPORT — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_INBOUND_PROCESS=true WA_DRY_RUN=true \
//     npx tsx scripts/qa/uji-idempoten-report.ts
//
// Kenapa di sini dan bukan sebagai unit test: perilakunya hidup di SQL
// (pencarian baris yang sudah ada + UPDATE), jadi tak ada yang tersisa untuk
// diuji tanpa database. `pnpm test` hanya menjaring apps/*/src dan murni.
//
// Dipakai sebagai bukti sebelum/sesudah: pada kode SEBELUM idempotensi, langkah
// 2 menghasilkan 4 baris (bukan 2) dan 5 pemeriksaan gagal. Kalau suatu saat
// idempotensinya rusak, harness ini menangkapnya dengan cara yang sama.
//
// Semua baris uji dibersihkan di awal DAN di akhir; ia memakai AM 10 pada
// 2026-04-15, tanggal yang sengaja dipilih karena kosong di dev.

import { db } from "../../apps/api/src/db.js";
import { processInboundMessage, type WaRow } from "../../apps/api/src/repo/inbound.js";

const AM = "10";
const TGL = "2026-04-15";
const JID = "628554231400@s.whatsapp.net";
const GRUP = "uji-idempoten@g.us";

const sql = db();
const baris = () => sql<{ id: string; customer_name: string; hasil: string | null; plan_id: string | null;
  photo_path: string | null; is_unmatched: boolean }[]>`
  SELECT id, customer_name, hasil, plan_id, photo_path, is_unmatched
    FROM activity_log WHERE am_id = ${AM} AND tanggal = ${TGL} ORDER BY id`;

const pesan = (body: string, n: number): WaRow => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  group_jid: GRUP, sender_jid: JID, sender_name: "Uji", body,
  message_type: "text", message_id: `uji-${n}`, received_at: `${TGL}T12:00:00+07:00`,
});

let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket : ""}`);
  if (!ok) gagal++;
};

async function main() {
  // bersihkan sisa uji sebelumnya
  await sql`DELETE FROM activity_log WHERE am_id = ${AM} AND tanggal = ${TGL}`;
  await sql`DELETE FROM sales_plan   WHERE am_id = ${AM} AND tanggal = ${TGL}`;
  await sql`DELETE FROM wa_message   WHERE group_jid = ${GRUP}`;
  await sql`
    INSERT INTO sales_plan (am_id, tanggal, customer_name, seq)
    VALUES (${AM}, ${TGL}, 'RS Uji Alpha', 1), (${AM}, ${TGL}, 'RS Uji Beta', 2)`;

  console.log("1) kiriman pertama");
  await processInboundMessage(pesan(
    `#REPORT 15/4/2026\n1. RS Uji Alpha\nhasil: kunjungan pertama\n2. RS Uji Beta\nhasil: bertemu analis`, 1));
  let r = await baris();
  cek("2 baris lahir", r.length === 2, `dapat ${r.length}`);
  cek("keduanya terikat rencana", r.every((x) => x.plan_id !== null && !x.is_unmatched));

  // simulasikan foto menempel belakangan (photoFollowup)
  await sql`UPDATE activity_log SET photo_path = '/uji/foto.jpg' WHERE id = ${Number(r[0].id)}`;
  const idAwal = r.map((x) => Number(x.id));
  const planAwal = r.map((x) => x.plan_id);

  console.log("2) kiriman ULANG dengan hasil yang dikoreksi");
  await processInboundMessage(pesan(
    `#REPORT 15/4/2026\n1. RS Uji Alpha\nhasil: kunjungan pertama, DIKOREKSI bertemu dr Andi\n2. RS Uji Beta\nhasil: bertemu analis dan kepala lab`, 2));
  r = await baris();
  cek("tetap 2 baris (tidak beranak)", r.length === 2, `dapat ${r.length}`);
  cek("id baris tidak berubah", r.map((x) => Number(x.id)).join() === idAwal.join());
  cek("hasil TERPERBARUI", (r[0].hasil ?? "").includes("DIKOREKSI"));
  cek("FOTO selamat", r[0].photo_path === "/uji/foto.jpg", String(r[0].photo_path));
  cek("plan_id selamat", r.map((x) => x.plan_id).join() === planAwal.join());

  console.log("3) kiriman BERTAHAP: customer baru di hari yang sama");
  await processInboundMessage(pesan(
    `#REPORT 15/4/2026\n1. RS Uji Gamma\nhasil: prospek baru tanpa rencana`, 3));
  r = await baris();
  cek("jadi 3 baris", r.length === 3, `dapat ${r.length}`);
  cek("yang baru tak terikat rencana", r.some((x) => x.customer_name.includes("Gamma") && x.is_unmatched));
  cek("dua baris lama tetap utuh", r.filter((x) => x.photo_path === "/uji/foto.jpg").length === 1);

  console.log("4) data LAMA: duplikat di mana baris KEDUA yang terikat rencana");
  // Bentuk yang nyata di prod sebelum idempotensi (Iqbal 7 Sep): dua baris nama
  // sama, yang tertua TAK terikat, yang kedua memegang rencananya. Kiriman ulang
  // harus memperbarui yang TERIKAT — bukan mengikat yang tertua ke rencana yang
  // sama, karena itu membuat dua baris memegang satu rencana.
  await sql`DELETE FROM activity_log WHERE am_id = ${AM} AND tanggal = ${TGL}`;
  await sql`UPDATE sales_plan SET reported = false, activity_id = NULL WHERE am_id = ${AM} AND tanggal = ${TGL}`;
  const [pAlpha] = await sql<{ id: string }[]>`
    SELECT id FROM sales_plan WHERE am_id = ${AM} AND tanggal = ${TGL} AND customer_name = 'RS Uji Alpha'`;
  await sql`
    INSERT INTO activity_log (am_id, plan_id, tanggal, customer_name, hasil, source, is_unmatched)
    VALUES (${AM}, NULL, ${TGL}, 'RS Uji Alpha', 'yatim lama', 'wa-inbound', true),
           (${AM}, ${Number(pAlpha.id)}, ${TGL}, 'RS Uji Alpha', 'terikat lama', 'wa-inbound', false)`;
  await processInboundMessage(pesan(
    `#REPORT 15/4/2026\n1. RS Uji Alpha\nhasil: kiriman ulang sesudah duplikat lama`, 4));
  r = await baris();
  const terikat = r.filter((x) => x.plan_id !== null);
  cek("tak ada baris tambahan", r.length === 2, `dapat ${r.length}`);
  cek("HANYA SATU baris memegang rencana", terikat.length === 1, `dapat ${terikat.length}`);
  cek("yang diperbarui adalah baris yang TERIKAT",
      (terikat[0]?.hasil ?? "").includes("kiriman ulang"), terikat[0]?.hasil ?? "-");

  // bersihkan
  await sql`DELETE FROM activity_log WHERE am_id = ${AM} AND tanggal = ${TGL}`;
  await sql`DELETE FROM sales_plan   WHERE am_id = ${AM} AND tanggal = ${TGL}`;
  await sql`DELETE FROM wa_message   WHERE group_jid = ${GRUP}`;
  console.log(gagal === 0 ? "\nSEMUA LULUS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}
main();
