import { test } from "node:test";
import assert from "node:assert/strict";

import { bacaRupiah, nilaiBaris, parseOrder, ringkasDraft, type ItemHarga } from "./order-wa.js";

// F90 #ORDER — pengurai & aturan harga (19 Okt 2026).

test("bacaRupiah: titik ribuan, rb, jt, desimal", () => {
  assert.equal(bacaRupiah("38.000.000"), 38_000_000);
  assert.equal(bacaRupiah("Rp 450.000"), 450_000);
  assert.equal(bacaRupiah("38jt"), 38_000_000);
  assert.equal(bacaRupiah("1,5jt"), 1_500_000);
  assert.equal(bacaRupiah("450rb"), 450_000);
  assert.equal(bacaRupiah("450000"), 450_000);
  assert.equal(bacaRupiah("murah"), null);
});

test("parseOrder: perintah ya/batal/status/bantuan", () => {
  assert.deepEqual(parseOrder("#ORDER ya O12"), { aksi: "ya", ref: 12 });
  assert.deepEqual(parseOrder("#order YA o7"), { aksi: "ya", ref: 7 });
  assert.deepEqual(parseOrder("#ORDER batal O12 salah faskes"), { aksi: "batal", ref: 12, alasan: "salah faskes" });
  assert.deepEqual(parseOrder("#ORDER status"), { aksi: "status" });
  assert.deepEqual(parseOrder("#ORDER"), { aksi: "bantuan" });
});

test("parseOrder: faskes + baris barang (nama berangka, kode, harga, Faskes:)", () => {
  const p = parseOrder("#ORDER RSUD Kab Kediri\nZ5 LD LYSE 500 ML 2\n- IDS.0299 1 @ 38jt\nGluco strip 10 box @ 230.400");
  assert.equal(p.aksi, "baru");
  if (p.aksi !== "baru") return;
  assert.equal(p.faskes, "RSUD Kab Kediri");
  assert.deepEqual(p.baris.map((b) => [b.query, b.qty, b.harga]), [["Z5 LD LYSE 500 ML", 2, null], ["IDS.0299", 1, 38_000_000], ["Gluco strip", 10, 230_400]]);
  const q = parseOrder("#ORDER\nFaskes: PKM Gondang\nreagen x");
  assert.ok(q.aksi === "baru" && q.faskes === "PKM Gondang" && Number.isNaN(q.baris[0].qty));
  const h = parseOrder("#ORDER RS A\nZybio 2 @ murah");
  assert.ok(h.aksi === "baru" && Number.isNaN(h.baris[0].harga as number));
});

const item = (x: Partial<ItemHarga> = {}): ItemHarga => ({ id: 1, kode: "HMG.0167", nama: "ZYBIO Z5 LD LYSE 500 ML", kemasan: "Botol", priceList: 1_000_000, hargaNett: 800_000, itemId: 10, stok: 5, ...x });

test("nilaiBaris: harga kosong = price list; di bawah lantai ditolak; ambigu & tak ketemu", () => {
  const ok = nilaiBaris({ teks: "z5 2", query: "z5", qty: 2, harga: null }, [item()]);
  assert.equal(ok.ok, true); assert.equal(ok.harga, 1_000_000);
  assert.equal(nilaiBaris({ teks: "z5 2 @ 800rb", query: "z5", qty: 2, harga: 800_000 }, [item()]).ok, true); // tepat lantai boleh
  const rendah = nilaiBaris({ teks: "z5 2 @ 799rb", query: "z5", qty: 2, harga: 799_000 }, [item()]);
  assert.equal(rendah.ok, false); assert.match(rendah.masalah as string, /di bawah harga nett Rp 800\.000 — ditolak/);
  assert.match(nilaiBaris({ teks: "x 1", query: "x", qty: 1, harga: null }, []).masalah as string, /tidak ditemukan/);
  assert.match(nilaiBaris({ teks: "z 1", query: "z", qty: 1, harga: null }, [item(), item({ id: 2, kode: "HMG.0165" })]).masalah as string, /tulis kodenya: HMG\.0167/);
  assert.match(nilaiBaris({ teks: "reagen x", query: "reagen x", qty: NaN, harga: null }, [item()]).masalah as string, /jumlah tak terbaca/);
});

test("ringkasDraft: total, stok kurang ditandai, perintah konfirmasi", () => {
  const b = nilaiBaris({ teks: "z5 7", query: "z5", qty: 7, harga: null }, [item()]);
  const t = ringkasDraft(12, "RSUD KAB. KEDIRI", [b], "Aulia");
  assert.match(t, /Draft O12\* — RSUD KAB\. KEDIRI/);
  assert.match(t, /⚠️ stok 5/);
  assert.match(t, /Total Rp 7\.000\.000/);
  assert.match(t, /#ORDER ya O12/);
  assert.doesNotMatch(t, /[<>]/);
});
