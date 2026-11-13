import assert from "node:assert/strict";
import { test } from "node:test";

import { pilihIsianFormApproval } from "./approval-request-body";

test("isian form diteruskan apa adanya", () => {
  const body = { title: "Contoh", description: null, nominal: 1000, wilayah: "W1", kategori: "K1", attachments: [] };
  assert.deepEqual(pilihIsianFormApproval(body), body);
});

test("field internal & identitas pengaju dari klien dibuang", () => {
  const out = pilihIsianFormApproval({
    title: "Contoh",
    jenis: "lain",
    hodPengaju: "x",
    jikaHodKosong: "direktur",
    refTabel: "t",
    refId: "1",
    requestedBy: "palsu",
    requestedByUserId: "u-palsu",
    requestedByWa: "000",
  });
  assert.deepEqual(out, { title: "Contoh" });
});

test("body bukan objek → kosong", () => {
  assert.deepEqual(pilihIsianFormApproval(null), {});
  assert.deepEqual(pilihIsianFormApproval([1, 2]), {});
  assert.deepEqual(pilihIsianFormApproval("x"), {});
});
