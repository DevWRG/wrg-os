import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aksiSla,
  cekChainUntukRequest,
  cekPatchTahap,
  cekWewenang,
  gabungPetaHod,
  pesanTargetGagal,
  pilihHodKey,
  resolveApprover,
  resolveApproverByUserId,
  snapshotTahap,
  validasiInputRequest,
  type SebabTargetGagal,
} from "./approval.js";

// Sebelum #1071 dibereskan, KEEMPAT keadaan di bawah menghasilkan satu kalimat
// yang sama: `kontak "..." belum dikonfigurasi — isi dulu di halaman config`.
// Itu benar hanya untuk keadaan pertama. Untuk tiga sisanya kalimat itu
// mengirim orang ke halaman yang salah: slot di Config Chain SUDAH terisi,
// yang bolong ada di data pengguna.
//
// Yang diuji di sini bukan kalimatnya persis, tapi dua hal yang menentukan
// apakah pesan itu berguna: (a) tiap sebab menghasilkan pesan BERBEDA, dan
// (b) pesannya menyebut tempat perbaikan yang benar.

const KASUS: SebabTargetGagal[] = [
  { sebab: "belum-dikonfigurasi", label: "HoD Sales" },
  { sebab: "hod-tanpa-pengguna", label: "HoD Bisnis", hodKey: "mufid" },
  { sebab: "hod-tanpa-wa", label: "HoD After Sales", hodKey: "muhid", nama: "Muhid" },
  { sebab: "direktur-tak-ada", label: "Direktur" },
  { sebab: "atribut-kosong", label: "HoD Sales", atribut: "wilayah" },
  { sebab: "atribut-kosong", label: "HoD Bisnis", atribut: "kategori" },
  { sebab: "grup-tanpa-wa", label: "Finance", groupKey: "finance-hod" },
];

test("tiap sebab menghasilkan pesan yang berbeda", () => {
  const pesan = KASUS.map(pesanTargetGagal);
  assert.equal(new Set(pesan).size, KASUS.length, `ada pesan yang kembar:\n${pesan.join("\n")}`);
});

test("hanya 'belum-dikonfigurasi' yang MENGARAHKAN ke Config Chain", () => {
  // Inilah inti bug-nya: dulu SEMUA sebab menunjuk ke sini.
  //
  // Pola sengaja `di halaman Config Chain` (bentuk arahan), bukan sekadar
  // `Config Chain`. Sebab "hod-tanpa-pengguna" memang MENYEBUT Config Chain,
  // tapi untuk menyangkalnya ("...bukan di Config Chain") — dan penyangkalan
  // itu berguna, ia menahan orang dari halaman yang salah. Asersi versi
  // pertama mencocokkan kata belaka, jadi ia menganggap penyangkalan itu
  // sebagai arahan dan gagal. Yang diuji seharusnya sifatnya, bukan katanya.
  const keConfig = KASUS.filter((k) => /di halaman Config Chain/i.test(pesanTargetGagal(k)));
  assert.deepEqual(
    keConfig.map((k) => k.sebab),
    ["belum-dikonfigurasi"],
  );
});

test("sebab non-config boleh menyangkal Config Chain, asal tak mengarahkan ke sana", () => {
  const p = pesanTargetGagal(KASUS[1]); // hod-tanpa-pengguna
  assert.match(p, /bukan di Config Chain/i);
  assert.doesNotMatch(p, /di halaman Config Chain/i);
});

test("sebab yang perbaikannya di data pengguna menunjuk menu Pengguna", () => {
  for (const sebab of ["hod-tanpa-pengguna", "hod-tanpa-wa", "direktur-tak-ada"] as const) {
    const k = KASUS.find((x) => x.sebab === sebab)!;
    const pesan = pesanTargetGagal(k);
    assert.match(pesan, /menu Pengguna/i, `sebab "${sebab}" tak menunjuk menu Pengguna: ${pesan}`);
  }
});

test("pesan menyebut label tahap — tanpa itu, request mana yang tertahan jadi tebakan", () => {
  for (const k of KASUS) {
    assert.match(pesanTargetGagal(k), new RegExp(k.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("sebab hod menyebut hod_key-nya, supaya bisa dicari di data", () => {
  assert.match(pesanTargetGagal(KASUS[1]), /mufid/);
  assert.match(pesanTargetGagal(KASUS[2]), /muhid/);
});

test("hod-tanpa-wa menyebut NAMA orangnya, bukan cuma hod_key", () => {
  // Bedanya dgn hod-tanpa-pengguna: di sini orangnya ADA dan sudah tertaut,
  // jadi menyebut namanya membuat perbaikannya satu langkah — buka orang itu,
  // isi nomornya.
  assert.match(pesanTargetGagal(KASUS[2]), /Muhid/);
});

// ── Routing tahap per atribut request (#1071, migrasi 190) ─────────────────
// Keputusan pemilik fitur: tahap 1 ikut wilayah pengaju, tahap 2 ikut kategori
// barang. Peta di bawah = seed migrasi 190.
const TAHAP1 = { routing: "wilayah" as const, hodKey: null, hodKeyMap: { east: "rocky", west: "yogi" } };
const TAHAP2 = { routing: "kategori" as const, hodKey: null, hodKeyMap: { IVD: "mufid", Medical: "arman" } };
const TAHAP4 = { routing: "tetap" as const, hodKey: "ika", hodKeyMap: null };

test("tahap 1 memilih HoD Sales dari wilayah pengaju", () => {
  assert.deepEqual(pilihHodKey(TAHAP1, { wilayah: "east", kategori: null }), { hodKey: "rocky" });
  assert.deepEqual(pilihHodKey(TAHAP1, { wilayah: "west", kategori: "IVD" }), { hodKey: "yogi" });
});

test("tahap 2 memilih HoD Bisnis dari kategori barang", () => {
  assert.deepEqual(pilihHodKey(TAHAP2, { wilayah: "east", kategori: "IVD" }), { hodKey: "mufid" });
  assert.deepEqual(pilihHodKey(TAHAP2, { wilayah: null, kategori: "Medical" }), { hodKey: "arman" });
});

test("atribut kosong dilaporkan sebagai 'kurang', BUKAN dijatuhkan ke hod_key slot", () => {
  // hod_key slot sengaja diisi di sini: kalau pilihHodKey jatuh ke nilai itu,
  // request tanpa wilayah akan diam-diam dikirim ke satu orang tetap.
  const slotBerisi = { ...TAHAP1, hodKey: "rocky" };
  assert.deepEqual(pilihHodKey(slotBerisi, { wilayah: null, kategori: "IVD" }), { kurang: "wilayah" });
  assert.deepEqual(pilihHodKey(TAHAP2, { wilayah: "east", kategori: null }), { kurang: "kategori" });
});

test("peta tanpa entri untuk nilainya = belum dikonfigurasi (hodKey null), bukan 'kurang'", () => {
  const petaSebagian = { ...TAHAP1, hodKeyMap: { east: "rocky" } };
  assert.deepEqual(pilihHodKey(petaSebagian, { wilayah: "west", kategori: null }), { hodKey: null });
});

test("tahap 'tetap' mengabaikan atribut request", () => {
  assert.deepEqual(pilihHodKey(TAHAP4, { wilayah: null, kategori: null }), { hodKey: "ika" });
  assert.deepEqual(pilihHodKey(TAHAP4, { wilayah: "west", kategori: "Medical" }), { hodKey: "ika" });
});

test("pesan atribut-kosong menyebut atribut yang hilang dan tak mengarah ke Config Chain", () => {
  const w = pesanTargetGagal({ sebab: "atribut-kosong", label: "HoD Sales", atribut: "wilayah" });
  const k = pesanTargetGagal({ sebab: "atribut-kosong", label: "HoD Bisnis", atribut: "kategori" });
  assert.match(w, /wilayah/);
  assert.match(k, /kategori/);
  assert.doesNotMatch(w, /di halaman Config Chain/i);
  assert.doesNotMatch(k, /di halaman Config Chain/i);
});

test("gabung peta: kunci di luar kosakata routing ditolak", () => {
  // "East" (huruf besar) dan "ivd" adalah salah ketik yang paling mungkin.
  assert.equal(gabungPetaHod("wilayah", TAHAP1.hodKeyMap, { East: "rocky" }).ok, false);
  assert.equal(gabungPetaHod("kategori", TAHAP2.hodKeyMap, { ivd: "mufid" }).ok, false);
  assert.equal(gabungPetaHod("tetap", null, { east: "rocky" }).ok, false);
});

test("gabung peta: ubah satu entri, entri lain tetap; null menghapus", () => {
  const g = gabungPetaHod("wilayah", TAHAP1.hodKeyMap, { west: "rocky" });
  assert.deepEqual(g, { ok: true, peta: { east: "rocky", west: "rocky" } });
  const h = gabungPetaHod("kategori", TAHAP2.hodKeyMap, { Medical: null });
  assert.deepEqual(h, { ok: true, peta: { IVD: "mufid" } });
});

// Di grup, sender_jid = group_jid. Itu bukan orang → tak boleh jadi approver,
// dan penolakan terjadi SEBELUM query (tak butuh DB).
test("resolveApprover: JID grup ditolak tanpa menyentuh DB", async () => {
  assert.equal(await resolveApprover("120363409252019573@g.us"), null);
  assert.equal(await resolveApprover(null), null);
});

// ── Mesin kanonik multi-alur (migrasi 247) ─────────────────────────────────

test("pesan grup-tanpa-wa menyebut grupnya dan menunjuk Akses Grup / Pengguna", () => {
  const p = pesanTargetGagal({ sebab: "grup-tanpa-wa", label: "Finance", groupKey: "finance-hod" });
  assert.match(p, /finance-hod/);
  assert.match(p, /Akses Grup/);
  assert.match(p, /menu Pengguna/);
});

const REQ = { wilayah: "east", kategori: "IVD", hodPengaju: "arman" };

test("snapshot: hod_pengaju memakai HoD yang dibawa request, bukan config", () => {
  const s = snapshotTahap({ targetType: "hod_pengaju", routing: "tetap", hodKey: "ika", hodKeyMap: null, groupKey: null }, REQ);
  assert.deepEqual(s, { hodKey: "arman", groupKey: null });
});

test("snapshot: grup menyimpan group_key, tanpa hod_key", () => {
  const s = snapshotTahap({ targetType: "grup", routing: "tetap", hodKey: null, hodKeyMap: null, groupKey: "finance-hod" }, REQ);
  assert.deepEqual(s, { hodKey: null, groupKey: "finance-hod" });
});

test("snapshot: hod ber-routing tetap memakai peta (perilaku alur pengadaan tak berubah)", () => {
  assert.deepEqual(snapshotTahap({ targetType: "hod", groupKey: null, ...TAHAP1 }, REQ), { hodKey: "rocky", groupKey: null });
  assert.deepEqual(snapshotTahap({ targetType: "hod", groupKey: null, ...TAHAP4 }, REQ), { hodKey: "ika", groupKey: null });
  assert.deepEqual(
    snapshotTahap({ targetType: "hod", groupKey: null, ...TAHAP1 }, { wilayah: null, kategori: null, hodPengaju: null }),
    { hodKey: null, groupKey: null },
  );
});

test("snapshot: direktur tak menyimpan hod_key walau slot config terisi", () => {
  const s = snapshotTahap({ targetType: "direktur", routing: "tetap", hodKey: "x", hodKeyMap: null, groupKey: "y" }, REQ);
  assert.deepEqual(s, { hodKey: null, groupKey: null });
});

const ANDI = { userId: "u-andi", hodKey: "arman", role: "hod", groups: ["finance-hod"] };

test("wewenang: pengaju TIDAK boleh memutuskan permintaannya sendiri, walau pemegang tahap", () => {
  const alasan = cekWewenang({ target_type: "hod_pengaju", hod_key: "arman", group_key: null }, ANDI, "u-andi");
  assert.match(alasan ?? "", /tidak boleh memutuskannya sendiri/);
});

test("wewenang: larangan diri sendiri berlaku juga untuk Direktur", () => {
  const dir = { userId: "u-dir", hodKey: null, role: "direktur", groups: [] };
  assert.notEqual(cekWewenang({ target_type: "direktur", hod_key: null, group_key: null }, dir, "u-dir"), null);
  assert.equal(cekWewenang({ target_type: "direktur", hod_key: null, group_key: null }, dir, "u-lain"), null);
});

test("wewenang: tiap jenis target hanya terbuka untuk pemegangnya", () => {
  assert.equal(cekWewenang({ target_type: "hod", hod_key: "arman", group_key: null }, ANDI, null), null);
  assert.notEqual(cekWewenang({ target_type: "hod", hod_key: "mufid", group_key: null }, ANDI, null), null);
  assert.equal(cekWewenang({ target_type: "grup", hod_key: null, group_key: "finance-hod" }, ANDI, null), null);
  assert.notEqual(cekWewenang({ target_type: "grup", hod_key: null, group_key: "hrd" }, ANDI, null), null);
  assert.notEqual(cekWewenang({ target_type: "direktur", hod_key: null, group_key: null }, ANDI, null), null);
});

test("wewenang: tahap tanpa pemegang tak bisa diputus siapa pun (hod_key null ≠ hod_key null milik akun)", () => {
  const tanpaHod = { userId: "u-x", hodKey: null, role: "user", groups: [] };
  assert.notEqual(cekWewenang({ target_type: "hod", hod_key: null, group_key: null }, tanpaHod, null), null);
  assert.notEqual(cekWewenang({ target_type: "grup", hod_key: null, group_key: null }, tanpaHod, null), null);
});

test("SLA: belum lewat → tak ada aksi; lewat 1× → ingatkan; lewat 2× → eskalasi", () => {
  const t0 = new Date("2026-10-25T01:00:00Z");
  const jam = (h: number) => new Date(t0.getTime() + h * 3600_000);
  const t = { notifiedAt: t0, remindedAt: null, escalatedAt: null };
  assert.equal(aksiSla(t, 24, true, jam(23)), null);
  assert.equal(aksiSla(t, 24, true, jam(24)), "ingatkan");
  assert.equal(aksiSla({ ...t, remindedAt: jam(24) }, 24, true, jam(30)), null);
  assert.equal(aksiSla({ ...t, remindedAt: jam(24) }, 24, true, jam(48)), "eskalasi");
  assert.equal(aksiSla({ ...t, remindedAt: jam(24), escalatedAt: jam(48) }, 24, true, jam(100)), null);
});

test("SLA: job yang lama mati langsung eskalasi, tak mengirim pengingat basi dulu", () => {
  const t0 = new Date("2026-10-25T01:00:00Z");
  assert.equal(aksiSla({ notifiedAt: t0, remindedAt: null, escalatedAt: null }, 24, true, new Date(t0.getTime() + 72 * 3600_000)), "eskalasi");
});

test("SLA: alur tanpa eskalasi cukup mengingatkan sekali", () => {
  const t0 = new Date("2026-10-25T01:00:00Z");
  const lama = new Date(t0.getTime() + 100 * 3600_000);
  assert.equal(aksiSla({ notifiedAt: t0, remindedAt: null, escalatedAt: null }, 24, false, lama), "ingatkan");
  assert.equal(aksiSla({ notifiedAt: t0, remindedAt: lama, escalatedAt: null }, 24, false, lama), null);
});

test("SLA: tanpa sla_jam atau belum dinotif → tak dihitung", () => {
  const t0 = new Date("2026-10-25T01:00:00Z");
  assert.equal(aksiSla({ notifiedAt: t0, remindedAt: null, escalatedAt: null }, null, true, new Date(t0.getTime() + 1e9)), null);
  assert.equal(aksiSla({ notifiedAt: null, remindedAt: null, escalatedAt: null }, 1, true, new Date()), null);
});

test("patch tahap: field yang diabaikan resolusi target ditolak", () => {
  assert.equal(cekPatchTahap({ targetType: "hod", routing: "tetap" }, { hodKey: "ika" }), null);
  assert.notEqual(cekPatchTahap({ targetType: "hod", routing: "wilayah" }, { hodKey: "ika" }), null);
  assert.notEqual(cekPatchTahap({ targetType: "grup", routing: "tetap" }, { hodKey: "ika" }), null);
  assert.equal(cekPatchTahap({ targetType: "grup", routing: "tetap" }, { groupKey: "finance-hod" }), null);
  assert.notEqual(cekPatchTahap({ targetType: "hod_pengaju", routing: "tetap" }, { groupKey: "x" }), null);
  assert.notEqual(cekPatchTahap({ targetType: "hod_pengaju", routing: "tetap" }, { waNumberOverride: "62811" }), null);
  assert.equal(cekPatchTahap({ targetType: "direktur", routing: "tetap" }, { waNumberOverride: "62811" }), null);
  assert.equal(cekPatchTahap({ targetType: "hod_pengaju", routing: "tetap" }, { aktif: false }), null);
});

test("alur bertahap hod_pengaju menolak request tanpa HoD pengaju", () => {
  const chain = [{ targetType: "hod_pengaju" as const, label: "HoD Divisi" }, { targetType: "direktur" as const, label: "Direktur" }];
  assert.match(cekChainUntukRequest(chain, null) ?? "", /HoD Divisi/);
  assert.equal(cekChainUntukRequest(chain, "arman"), null);
  assert.notEqual(cekChainUntukRequest([], "arman"), null);
});

test("input: ref_tabel & ref_id harus berpasangan", () => {
  const dasar = { title: "x", requestedBy: "y" };
  assert.equal(validasiInputRequest(dasar), null);
  assert.equal(validasiInputRequest({ ...dasar, refTabel: "fund_request", refId: "1" }), null);
  assert.notEqual(validasiInputRequest({ ...dasar, refTabel: "fund_request" }), null);
  assert.notEqual(validasiInputRequest({ ...dasar, refId: "1" }), null);
});

test("resolveApproverByUserId: id bukan uuid ditolak tanpa menyentuh DB", async () => {
  assert.equal(await resolveApproverByUserId("1 OR 1=1"), null);
  assert.equal(await resolveApproverByUserId(null), null);
});

test("HoD pengaju kosong: default menolak, opsi 'direktur' mengizinkan (dialihkan)", () => {
  const chain = [{ targetType: "hod_pengaju" as const, label: "HoD" }];
  assert.notEqual(cekChainUntukRequest(chain, null), null);
  assert.notEqual(cekChainUntukRequest(chain, null, "tolak"), null);
  assert.equal(cekChainUntukRequest(chain, null, "direktur"), null);
});
