import { test } from "node:test";
import assert from "node:assert/strict";

import { catatanJadwalWa, type JadwalSj } from "./pickup-plan.js";

// Sambungan Jadwal Kirim-Tagih (F45) ↔ hashtag shipping: baris tambahan di
// balasan bot. Jadwal = rencana; #KIRIM/#BAST = kejadian nyata, ketemu di No. SJ.
const jadwal: JadwalSj = {
  id: "x",
  tanggal: "2026-10-15",
  tujuan: "kirim",
  kurir_name: "Munir",
  kurir_wa_number: "6281234567890",
};
const dasar = { jadwal, ditutup: [] as JadwalSj[], senderNumber: "6281234567890", pelaku: "Munir" };

test("#KIRIM oleh kurir terjadwal → sebut jadwal, tanpa peringatan", () => {
  assert.equal(catatanJadwalWa({ ...dasar, kind: "kirim" }), "📅 Jadwal 2026-10-15 · kurir Munir");
});

test("#KIRIM nomor beda format tapi orang sama → tetap dianggap kurir terjadwal", () => {
  const r = catatanJadwalWa({ ...dasar, kind: "kirim", senderNumber: "081234567890", pelaku: "Pak Munir" });
  assert.equal(r, "📅 Jadwal 2026-10-15 · kurir Munir");
});

test("#KIRIM dari grup (nomor = JID grup) tapi nama roster cocok → tanpa peringatan", () => {
  const r = catatanJadwalWa({ ...dasar, kind: "kirim", senderNumber: "120363409252019573", pelaku: "munir" });
  assert.equal(r, "📅 Jadwal 2026-10-15 · kurir Munir");
});

test("#KIRIM oleh orang lain → jadwal + tanda bukan kurir terjadwal", () => {
  const r = catatanJadwalWa({ ...dasar, kind: "kirim", senderNumber: "6289999999999", pelaku: "Eko" });
  assert.equal(r, "📅 Jadwal 2026-10-15 · kurir Munir\n⚠️ Yang mengirim Eko, bukan kurir terjadwal.");
});

test("#KIRIM tanpa jadwal → tak ada baris tambahan", () => {
  assert.equal(catatanJadwalWa({ ...dasar, kind: "kirim", jadwal: null }), null);
});

test("#BAST menutup jadwal kirim → sebut SELESAI", () => {
  const r = catatanJadwalWa({ ...dasar, kind: "bast", jadwal: null, ditutup: [jadwal] });
  assert.equal(r, "📅 Jadwal Kirim-Tagih 2026-10-15 ditandai *SELESAI*.");
});

test("#BAST jadwal kirim+tagih → tak ditutup, minta tutup manual", () => {
  const kt = { ...jadwal, tujuan: "kirim+tagih" as const };
  const r = catatanJadwalWa({ ...dasar, kind: "bast", jadwal: kt, ditutup: [] });
  assert.match(r ?? "", /kirim\+tagih\) belum ditutup/);
});

test("#TERIMA / #BUKTI → tak ada baris tambahan", () => {
  assert.equal(catatanJadwalWa({ ...dasar, kind: "terima" }), null);
  assert.equal(catatanJadwalWa({ ...dasar, kind: "bukti" }), null);
});
