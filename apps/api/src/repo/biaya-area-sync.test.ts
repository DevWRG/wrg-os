import { test } from "node:test";
import assert from "node:assert/strict";

import { barisOtherPayment, barisPurchaseInvoice } from "./biaya-area-sync.js";

const akun = new Map([
  [1, { no: "6200-02", name: "BBM, TOL, PARKIR" }],
  [2, { no: "5100-02", name: "BIAYA KIRIM PEMBELIAN" }],
  [3, { no: "6100-01", name: "GAJI" }],
]);

test("other-payment: hanya akun 6xxx, tanggal dd/mm/yyyy → ISO, departemen '-' dianggap kosong", () => {
  const h = {
    id: 10, number: "BKK/1", transDate: "05/09/2026", description: "  BBM   KEDIRI ", payee: "BUDI",
    detailAccount: [
      { accountId: 1, amount: 1000, department: { name: "-" } },
      { accountId: 2, amount: 500 },
      { account: { no: "6100-01", name: "GAJI" }, amount: 70, department: { name: "KEDIRI" } },
    ],
  };
  const r = barisOtherPayment(h, akun, null);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].tanggal, r[0].akun, r[0].jumlah, r[0].keterangan, r[0].departemen, r[0].seq], ["2026-09-05", "6200-02", 1000, "BBM KEDIRI", null, 0]);
  assert.deepEqual([r[1].kelompok, r[1].departemen, r[1].seq], ["SDM", "KEDIRI", 2]);
});

test("purchase-invoice: detailExpense, vendor jadi payee, jumlah dari expenseAmount", () => {
  const h = { id: 20, number: "PI/1", transDate: "01/10/2026", description: "Fkt", vendor: { name: "PT KOTA JAKARTA BARAT" }, detailExpense: [{ accountId: 1, expenseAmount: 250, expenseName: "Parkir" }] };
  const r = barisPurchaseInvoice(h, akun, "2026-10-01T10:00:00+07:00");
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].sumber, r[0].payee, r[0].jumlah, r[0].keterangan], ["purchase-invoice", "PT KOTA JAKARTA BARAT", 250, "Fkt Parkir"]);
});

test("dokumen tanpa tanggal/id valid → kosong", () => {
  assert.deepEqual(barisOtherPayment({ id: 0, transDate: "x", detailAccount: [{ accountId: 1, amount: 1 }] }, akun, null), []);
});
