import assert from "node:assert/strict";
import { test } from "node:test";

import { labelReview, labelWilayah } from "./forecast-review";

const dok = (x: Partial<Parameters<typeof labelReview>[0]>) => ({
  status: "submitted", reviewStatus: null, reviewRegion: null, reviewedBy: null, reviewNote: null, ...x,
});

test("labelReview: menunggu menyebut region HoD Sales, tanpa catatan", () => {
  assert.deepEqual(labelReview(dok({ reviewStatus: "menunggu", reviewRegion: "West" })), {
    label: "Menunggu review HoD Sales West", variant: "secondary", catatan: null,
  });
  assert.equal(labelReview(dok({ reviewStatus: "menunggu" }))?.label, "Menunggu review HoD Sales");
});

test("labelReview: disetujui/ditolak menyebut pemutus dan membawa catatan", () => {
  assert.deepEqual(labelReview(dok({ reviewStatus: "disetujui", reviewedBy: "Penguji" })), {
    label: "Disetujui oleh Penguji", variant: "default", catatan: null,
  });
  assert.deepEqual(labelReview(dok({ status: "draft", reviewStatus: "ditolak", reviewedBy: "Penguji", reviewNote: "kurangi qty" })), {
    label: "Ditolak oleh Penguji", variant: "destructive", catatan: "kurangi qty",
  });
});

test("labelReview: belum pernah diajukan → null", () => {
  assert.equal(labelReview(dok({ status: "draft" })), null);
});

test("labelWilayah: east/west → East/West, lainnya —", () => {
  assert.equal(labelWilayah("east"), "East");
  assert.equal(labelWilayah("west"), "West");
  assert.equal(labelWilayah(null), "—");
});
