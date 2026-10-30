import { test } from "node:test";
import assert from "node:assert/strict";
import { HURUF_KUPON, buatKupon, hpTampil, kocok, normalHp, sedangBuka, slugDari, validasiAcara, validasiDaftar } from "./pameran.js";

test("no. HP: berbagai tulisan dinormalkan ke 628…, bukan seluler ditolak", () => {
  assert.equal(normalHp("0812-3456-7890"), "6281234567890");
  assert.equal(normalHp("+62 812 3456 7890"), "6281234567890");
  assert.equal(normalHp("81234567890"), "6281234567890");
  assert.equal(normalHp("6281234567890"), "6281234567890");
  assert.equal(normalHp("031-5678901"), null); // telepon rumah Surabaya
  assert.equal(normalHp("0812"), null);
  assert.equal(normalHp(""), null);
  assert.equal(normalHp(undefined), null);
  assert.equal(hpTampil("6281234567890"), "0812-3456-7890");
});

test("validasi daftar: nama, institusi, HP wajib; spasi dirapikan", () => {
  assert.match((validasiDaftar({ institusi: "RS A", no_hp: "081234567890" }) as { pesan: string }).pesan, /Nama/);
  assert.match((validasiDaftar({ nama: "dr. A", no_hp: "081234567890" }) as { pesan: string }).pesan, /institusi/);
  assert.match((validasiDaftar({ nama: "dr. A", institusi: "RS A", no_hp: "081234567890" }) as { pesan: string }).pesan, /kota\/kabupaten/);
  assert.match((validasiDaftar({ nama: "dr. A", institusi: "RS A", kab_kota_kode: "Surabaya", no_hp: "081234567890" }) as { pesan: string }).pesan, /kota\/kabupaten/);
  assert.match((validasiDaftar({ nama: "dr. A", institusi: "RS A", kab_kota_kode: "35.78", no_hp: "12" }) as { pesan: string }).pesan, /No\. HP/);
  const v = validasiDaftar({ nama: "  dr.  Budi ", institusi: "RSUD  Dr. Soetomo", kab_kota_kode: "35.78", no_hp: "0812 3456 7890" });
  assert.ok(v.ok);
  assert.deepEqual(v.isi, { nama: "dr. Budi", institusi: "RSUD Dr. Soetomo", kab_kota_kode: "35.78", no_hp: "6281234567890" });
});

test("kupon: awalan + 5 huruf tanpa karakter rancu", () => {
  const k = buatKupon("MHD");
  assert.match(k, /^MHD-[A-Z2-9]{5}$/);
  for (const ch of k.slice(4)) assert.ok(HURUF_KUPON.includes(ch));
  assert.ok(!/[01OIL]/.test(HURUF_KUPON));
  assert.equal(buatKupon("IVD", () => 0), "IVD-AAAAA");
});

test("acara: slug & awalan default, tanggal selesai ≥ mulai", () => {
  assert.equal(slugDari("Pernefri 2026 — Bali!"), "pernefri-2026-bali");
  const v = validasiAcara({ nama: "PIT Pernefri 2026", divisi: "medical_hd", tanggal_mulai: "2026-11-05", tanggal_selesai: "2026-11-07" });
  assert.ok(v.ok && v.isi.slug === "pit-pernefri-2026" && v.isi.prefix_kupon === "MHD" && v.isi.buka);
  const w = validasiAcara({ nama: "Expo", divisi: "ivd", tanggal_mulai: "2026-11-05" });
  assert.ok(w.ok && w.isi.tanggal_selesai === "2026-11-05" && w.isi.prefix_kupon === "IVD");
  assert.match((validasiAcara({ nama: "X", divisi: "ivd", tanggal_mulai: "2026-11-05", tanggal_selesai: "2026-11-01" }) as { pesan: string }).pesan, /selesai/);
  assert.match((validasiAcara({ nama: "X", divisi: "lain", tanggal_mulai: "2026-11-05" }) as { pesan: string }).pesan, /divisi/);
  assert.match((validasiAcara({ nama: "X y", divisi: "ivd", tanggal_mulai: "2026-11-05", slug: "../x" }) as { pesan: string }).pesan, /Alamat/);
  assert.match((validasiAcara({ nama: "X y", divisi: "ivd", tanggal_mulai: "2026-11-05", prefix_kupon: "M1" }) as { pesan: string }).pesan, /Awalan/);
  // jatah per IP: default 600, bisa dinaikkan untuk momen panggung, dibatasi 10–100.000
  assert.ok(v.ok && v.isi.jatah_ip === 600);
  const panggung = validasiAcara({ nama: "Stage", divisi: "medical_hd", tanggal_mulai: "2026-11-05", jatah_ip: "3000" });
  assert.ok(panggung.ok && panggung.isi.jatah_ip === 3000);
  // link pendek opsional, hanya https
  assert.ok(v.ok && v.isi.link_pendek === null);
  const ln = validasiAcara({ nama: "Stage", divisi: "medical_hd", tanggal_mulai: "2026-11-05", link_pendek: " https://s.id/wrg-pit " });
  assert.ok(ln.ok && ln.isi.link_pendek === "https://s.id/wrg-pit");
  for (const l of ["http://s.id/x", "s.id/wrg", "https://s.id/ada spasi", "javascript:alert(1)"]) {
    assert.match((validasiAcara({ nama: "X y", divisi: "ivd", tanggal_mulai: "2026-11-05", link_pendek: l }) as { pesan: string }).pesan, /Link pendek/);
  }
  for (const j of [5, 1.5, 200_000, "abc"]) {
    assert.match((validasiAcara({ nama: "X y", divisi: "ivd", tanggal_mulai: "2026-11-05", jatah_ip: j }) as { pesan: string }).pesan, /Jatah/);
  }
});

test("form buka: saklar + jendela tanggal ±1 hari", () => {
  const a = { buka: true, tanggal_mulai: "2026-11-05", tanggal_selesai: "2026-11-07" };
  assert.equal(sedangBuka(a, "2026-11-03"), false);
  assert.equal(sedangBuka(a, "2026-11-04"), true);
  assert.equal(sedangBuka(a, "2026-11-08"), true);
  assert.equal(sedangBuka(a, "2026-11-09"), false);
  assert.equal(sedangBuka({ ...a, buka: false }, "2026-11-06"), false);
  // lintas bulan
  assert.equal(sedangBuka({ buka: true, tanggal_mulai: "2026-12-01", tanggal_selesai: "2026-12-31" }, "2026-11-30"), true);
});

test("kocok: tanpa pengulangan, dibatasi jumlah calon", () => {
  const calon = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let i = 0; i < 50; i++) {
    const p = kocok(calon, 4);
    assert.equal(p.length, 4);
    assert.equal(new Set(p).size, 4);
    for (const x of p) assert.ok(calon.includes(x));
  }
  assert.equal(kocok([1, 2], 5).length, 2);
  assert.deepEqual(kocok([1, 2, 3], 2, () => 0), [1, 2]);
  assert.deepEqual(calon, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // masukan tak diubah
});
