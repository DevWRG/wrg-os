// Unit test parser F175 #PLAN/#REPORT Teknisi. Contoh pesan diambil persis dari
// docs/features/F175-plan-report-teknisi.md. Jalankan:
//   pnpm --filter @wrg/api exec node --import tsx --test src/parsers/teknisi.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeJenis, parseStatus, parseTeknisiPlan, parseTeknisiReport, pisahJenisTiket, pisahSnAlat,
  balasanPlanTeknisi, balasanReportTeknisi, balasanFormatSalah, CONTOH_PLAN_TEKNISI, CONTOH_REPORT_TEKNISI,
} from "./teknisi.js";

const NOW = Date.parse("2026-11-07T01:00:00Z"); // 7 Nov 2026 08:00 WIB

test("plan: contoh spesifikasi — 4 item, SN vs nama alat, tiket", () => {
  const p = parseTeknisiPlan(
    "#PLAN 7 Nov\n1. RSUD Trenggalek | 0832 | PM\n2. RS PTP Jember | CM250 | Service T-123\n3. PKM Bakunase | Z360 | Install\n4. RS Al Irsyad | DxH 560 | Call",
    NOW,
  );
  assert.deepEqual(p.errors, []);
  assert.equal(p.tanggal, "2026-11-07");
  assert.equal(p.items.length, 4);
  assert.deepEqual(p.items[0], { urut: 1, faskes: "RSUD Trenggalek", sn: "0832", alat: null, jenis: "PM", tiket: null });
  assert.deepEqual(p.items[1], { urut: 2, faskes: "RS PTP Jember", sn: null, alat: "CM250", jenis: "Service", tiket: "T-123" });
  assert.equal(p.items[3].alat, "DxH 560");
  assert.equal(p.items[3].jenis, "Call");
});

test("plan: alias jenis + galat yang jelas, item lain tetap jalan", () => {
  const p = parseTeknisiPlan("#plan\n1. RS A | 1234 | Maintenance\n2. RS B | 99 | Refresh Training\n3. RS C | 5555 | jalan-jalan\n4. RS D | 7777");
  assert.equal(p.tanggal, null);
  assert.deepEqual(p.items.map((i) => i.jenis), ["PM", "Training"]);
  assert.equal(p.items[1].alat, "99"); // 2 digit tak dianggap SN
  assert.equal(p.errors.length, 2);
  assert.match(p.errors[0], /Baris 3: jenis "jalan-jalan" tak dikenal/);
  assert.match(p.errors[1], /Baris 4: perlu 3 bagian/);
});

test("plan: nomor ganda ditolak", () => {
  const p = parseTeknisiPlan("#PLAN\n1. RS A | 1234 | PM\n1. RS B | 4321 | PM");
  assert.match(p.errors.join(" "), /Nomor ganda: 1/);
});

test("helper: jenis, tiket, SN", () => {
  assert.equal(normalizeJenis("uji fungsi"), "Uji Fungsi");
  assert.equal(normalizeJenis("Servis"), "Service");
  assert.equal(normalizeJenis("ngopi"), null);
  assert.deepEqual(pisahJenisTiket("Service #T123"), { jenis: "Service", tiket: "T-123" });
  assert.deepEqual(pisahJenisTiket("PM bulanan"), { jenis: "PM", tiket: null });
  assert.deepEqual(pisahSnAlat("SN 0832 Zybio EXC200"), { sn: "0832", alat: "Zybio EXC200" });
  assert.deepEqual(pisahSnAlat("BS-240"), { sn: null, alat: "BS-240" });
  assert.deepEqual(pisahSnAlat("-"), { sn: null, alat: null });
});

test("status: kanonik + alasan", () => {
  assert.deepEqual(parseStatus("Done"), { status: "Selesai", alasan: null });
  assert.deepEqual(parseStatus("Pending sparepart"), { status: "Pending", alasan: "sparepart" });
  assert.deepEqual(parseStatus("Batal - user tidak ada"), { status: "Batal", alasan: "user tidak ada" });
  assert.deepEqual(parseStatus("Revisit"), { status: "Revisit", alasan: null });
  assert.deepEqual(parseStatus("aman"), { status: null, alasan: null });
});

test("report: satu alat merujuk plan (#REPORT 1)", () => {
  const r = parseTeknisiReport(
    "#REPORT 1\nStatus: Selesai\nKegiatan: bersihkan probe, kalibrasi\nJumlah Tes: 2.150\nPergantian Sparepart: lampu halogen 1\nCatatan: -",
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok.length, 1);
  const b = r.blok[0];
  assert.equal(b.planNo, 1);
  assert.equal(b.status, "Selesai");
  assert.equal(b.kegiatan, "bersihkan probe, kalibrasi");
  assert.equal(b.jumlahTes, 2150);
  assert.equal(b.sparepart, "lampu halogen 1");
});

test("report: satu alat tanpa plan (RS/Alat/SN/Jenis)", () => {
  const r = parseTeknisiReport(
    "#REPORT\nRS: RS Al Irsyad\nAlat: DxH 560\nSN: 4471\nJenis: Service\nStatus: Selesai\nKegiatan: reset sensor",
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.faskes, "RS Al Irsyad");
  const b = r.blok[0];
  assert.equal(b.planNo, null);
  assert.equal(b.alat, "DxH 560");
  assert.equal(b.sn, "4471");
  assert.equal(b.jenis, "Service");
  assert.equal(b.sparepart, null);
});

test("report: banyak alat satu faskes — blok bernomor, Catatan di luar blok", () => {
  const r = parseTeknisiReport(
    [
      "#REPORT",
      "RS: RSUD Trenggalek",
      "",
      "1) SN 0832 | Zybio EXC200 | PM",
      "Status: Selesai",
      "Kegiatan: bersihkan probe, kalibrasi",
      "Jumlah Tes: 2150",
      "Pergantian Sparepart: -",
      "",
      "2) #2",
      "Status: Pending sparepart",
      "Kegiatan: cek error tray, ganti rack sementara",
      "",
      "Catatan: analis Bu Rina",
    ].join("\n"),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.faskes, "RSUD Trenggalek");
  assert.equal(r.catatan, "analis Bu Rina");
  assert.equal(r.blok.length, 2);
  assert.deepEqual(
    [r.blok[0].sn, r.blok[0].alat, r.blok[0].jenis, r.blok[0].status, r.blok[0].jumlahTes, r.blok[0].sparepart],
    ["0832", "Zybio EXC200", "PM", "Selesai", 2150, null],
  );
  assert.equal(r.blok[1].planNo, 2);
  assert.equal(r.blok[1].status, "Pending");
  assert.equal(r.blok[1].alasan, "sparepart");
  assert.equal(r.blok[1].catatan, null);
});

test("report: label tak peka huruf + alias + kegiatan multi-baris", () => {
  const r = parseTeknisiReport("#report 2\nSTATUS: ok\ntindakan: ganti lampu\nlalu kalibrasi ulang\ntes: 1,200");
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok[0].kegiatan, "ganti lampu\nlalu kalibrasi ulang");
  assert.equal(r.blok[0].jumlahTes, 1200);
});

test("report: Pending tanpa alasan ditolak; alasan dari Catatan diterima", () => {
  const tolak = parseTeknisiReport("#REPORT 1\nStatus: Pending");
  assert.match(tolak.errors.join(" "), /status Pending perlu alasan/);
  const ok = parseTeknisiReport("#REPORT 1\nStatus: Pending\nCatatan: nunggu reagen");
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.blok[0].alasan, "nunggu reagen");
});

test("report: identitas & status wajib, tanpa plan RS wajib", () => {
  const r = parseTeknisiReport("#REPORT\nAlat: DxH 560\nKegiatan: cek");
  assert.match(r.errors.join(" "), /RS:` wajib/);
  assert.match(r.errors.join(" "), /Status:` wajib/);
  const kosong = parseTeknisiReport("#REPORT\nRS: RS X\nStatus: Selesai");
  assert.match(kosong.errors.join(" "), /identitas alat kosong/);
});

test("report: Jumlah Tes bukan angka & label asing ditolak", () => {
  const r = parseTeknisiReport("#REPORT 1\nStatus: Selesai\nJumlah Tes: banyak\nKondisi: bagus");
  assert.match(r.errors.join(" "), /Jumlah Tes "banyak" harus angka/);
  assert.match(r.errors.join(" "), /Label "Kondisi" tak dikenal/);
});

test("report: header tanggal + nomor plan", () => {
  const r = parseTeknisiReport("#REPORT 3 7 Nov\nStatus: Selesai", NOW);
  assert.equal(r.tanggal, "2026-11-07");
  assert.equal(r.blok[0].planNo, 3);
});

test("balasan report: format spesifikasi, ekor SN, alasan, perlu cek", () => {
  const t = balasanReportTeknisi({
    faskes: "RSUD Trenggalek",
    alat: [
      { nomor: 1, alatLabel: "Zybio EXC200", sn: "0832", jenis: "PM", status: "Selesai", alasan: null, masalah: null },
      { nomor: 2, alatLabel: "Mindray BS-240", sn: "201911194", jenis: "Service", status: "Pending", alasan: "sparepart", masalah: "SN 99 tak ditemukan di faskes ini" },
    ],
  });
  assert.equal(
    t,
    "✅ RSUD Trenggalek — 2 alat tercatat\n1. Zybio EXC200 (…0832) · PM · Selesai\n2. Mindray BS-240 (…1194) · Service · Pending sparepart\n   ⚠️ perlu cek: SN 99 tak ditemukan di faskes ini",
  );
});

test("balasan plan & format salah", () => {
  const t = balasanPlanTeknisi({
    nama: "Budi", tanggalTampil: "Sab, 7 Nov 2026", late: true, dilewati: [3],
    items: [{ urut: 1, faskes: "RS A", alatLabel: "EXC200", jenis: "PM", masalah: "faskes \"RS A\" tak dikenali" }],
  });
  assert.match(t, /^✅ Plan tercatat, Budi\n📅 Sab, 7 Nov 2026 · 1 alat\n⚠️ telat/);
  assert.match(t, /No\. 3 sudah dilaporkan/);
  assert.match(t, /⚠️ No\. 1: faskes "RS A" tak dikenali/);
  assert.doesNotMatch(t, /RS A · EXC200/); // daftar item tak diulang
  const bersih = balasanPlanTeknisi({
    nama: "Budi", tanggalTampil: "Sab, 7 Nov 2026", late: false, dilewati: [],
    items: [
      { urut: 1, faskes: "RS A", alatLabel: "EXC200", jenis: "PM", masalah: null },
      { urut: 2, faskes: "RS A", alatLabel: "Z3", jenis: "Service", masalah: null },
    ],
  });
  assert.equal(bersih, "✅ Plan tercatat, Budi\n📅 Sab, 7 Nov 2026 · 2 alat");
  const f = balasanFormatSalah("report", "Budi", ["Blok 1: `Status:` wajib"]);
  assert.match(f, /belum tersimpan, Budi:\n• Blok 1/);
  assert.match(f, /#REPORT 1\nStatus: Selesai/);
});

test("report: jenis default dari shortcut (#servis) bila blok tak menulis jenis", () => {
  const r = parseTeknisiReport("#REPORT\nRS: RS A\nSN: 1234\nStatus: Selesai", undefined, { jenisDefault: "Service" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok[0].jenis, "Service");
  const tulis = parseTeknisiReport("#REPORT\nRS: RS A\nSN: 1234\nJenis: PM\nStatus: Selesai", undefined, { jenisDefault: "Service" });
  assert.equal(tulis.blok[0].jenis, "PM");
});

test("balasan report: baris efek + jumlah foto", () => {
  const t = balasanReportTeknisi({
    faskes: "RS A", foto: 2,
    alat: [{ nomor: 1, alatLabel: "EXC200", sn: "0832", jenis: "PM", status: "Selesai", alasan: null, masalah: null, efek: "jadwal rutin bulan ini selesai" }],
  });
  assert.equal(t, "✅ RS A — 1 alat tercatat\n1. EXC200 (…0832) · PM · Selesai\n   ↳ jadwal rutin bulan ini selesai\n📷 2 foto terlampir");
});

test("teks galat tanpa kurung sudut — WhatsApp membuang <...>", () => {
  const r = parseTeknisiReport("#REPORT\nRS: RS A\n\n1) ??? | ???\nStatus: mantap\n\n2) SN 1234\nKegiatan: x");
  assert.ok(r.errors.length >= 2);
  for (const e of r.errors) assert.doesNotMatch(e, /<[^>]*>/, e);
  for (const t of [CONTOH_PLAN_TEKNISI, CONTOH_REPORT_TEKNISI]) assert.doesNotMatch(t, /<[^>]*>/);
});


test("report: label bertanda tebal WA (*Status:*) terbaca", () => {
  const r = parseTeknisiReport("#REPORT 1\n*Status:* Selesai\n*Kegiatan:* _cek_ tray\n~Catatan:~ -");
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok[0].status, "Selesai");
  assert.equal(r.blok[0].kegiatan, "cek tray");
  const p = parseTeknisiPlan("#PLAN\n1. *RSUD A* | 0832 | *PM*");
  assert.deepEqual(p.errors, []);
  assert.deepEqual([p.items[0].faskes, p.items[0].jenis], ["RSUD A", "PM"]);
});

test("report: baris kosong antara judul blok dan isinya tak memutus blok", () => {
  const r = parseTeknisiReport(
    "#REPORT\nRS: RSUD A\n\n1) SN 0832 | EXC200 | PM\n\nStatus: Selesai\n\nKegiatan: bersihkan probe\n\n2) #2\n\nStatus: Pending reagen\n\nCatatan: analis Bu Rina",
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok.length, 2);
  assert.deepEqual([r.blok[0].status, r.blok[0].kegiatan], ["Selesai", "bersihkan probe"]);
  assert.deepEqual([r.blok[1].planNo, r.blok[1].status, r.blok[1].alasan], [2, "Pending", "reagen"]);
  // Catatan sesudah baris kosong tetap milik kunjungan (bentuk spesifikasi).
  assert.equal(r.catatan, "analis Bu Rina");
  assert.equal(r.blok[1].catatan, null);
});

test("report: Catatan tepat di bawah isian blok = catatan alat itu", () => {
  const r = parseTeknisiReport("#REPORT\nRS: RSUD A\n\n1) SN 0832 | EXC200 | PM\nStatus: Selesai\nCatatan: tray retak");
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok[0].catatan, "tray retak");
  assert.equal(r.catatan, null);
});

test("report: Kegiatan berupa daftar bernomor + paragraf kedua", () => {
  const r = parseTeknisiReport("#REPORT 1\nStatus: Selesai\nKegiatan:\n1. bersihkan probe\n2. kalibrasi\n\nlanjut cek QC");
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok.length, 1);
  assert.equal(r.blok[0].kegiatan, "1. bersihkan probe\n2. kalibrasi\nlanjut cek QC");
});

test("report: daftar kegiatan di blok, lalu blok berikutnya tetap terbaca", () => {
  const r = parseTeknisiReport(
    "#REPORT\nRS: RSUD A\n\n1) SN 0832 | EXC200 | PM\nStatus: Selesai\nKegiatan:\n1. bersihkan probe\n2. kalibrasi\n2) SN 1194 | BS-240 | Service\nStatus: Selesai\nPergantian Sparepart: -\n\n3) Z360\nStatus: Revisit",
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.blok.length, 3);
  assert.equal(r.blok[0].kegiatan, "1. bersihkan probe\n2. kalibrasi");
  assert.deepEqual([r.blok[1].sn, r.blok[1].jenis], ["1194", "Service"]);
  // Sesudah baris kosong, "3) Z360" (tanpa `|`) tetap blok baru, bukan isi sparepart.
  assert.deepEqual([r.blok[2].alat, r.blok[2].status, r.blok[1].sparepart], ["Z360", "Revisit", null]);
});

test("contoh balasan memuat bentuk banyak alat, tanpa nomor tiket", () => {
  assert.match(CONTOH_REPORT_TEKNISI, /RS: RSUD Trenggalek\n1\) SN 0832 \| EXC200 \| PM/);
  assert.doesNotMatch(CONTOH_PLAN_TEKNISI, /T-\d/);
  // Contoh banyak alat harus lolos parser sendiri.
  const multi = CONTOH_REPORT_TEKNISI.split("beberapa alat di satu RS:\n")[1];
  assert.deepEqual(parseTeknisiReport(multi).errors, []);
});
