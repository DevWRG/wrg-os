import assert from "node:assert/strict";
import { test } from "node:test";

import { bacaRentang, putuskanCakupanKinerja, ringkasKerja, teknisiEfektif, type KerjaRow } from "./kinerja-teknisi.js";

const id = (o: Partial<Parameters<typeof putuskanCakupanKinerja>[1] & object> = {}) =>
  ({ role: null, superuser: false, semuaView: false, amId: null, ...o });

test("cakupan: operator, admin/direktur/superuser/izin semua → semua; lainnya → diri sendiri", () => {
  assert.deepEqual(putuskanCakupanKinerja(false, null), { semua: true });
  assert.deepEqual(putuskanCakupanKinerja(true, id({ role: "admin" })), { semua: true });
  assert.deepEqual(putuskanCakupanKinerja(true, id({ role: "Direktur" })), { semua: true });
  assert.deepEqual(putuskanCakupanKinerja(true, id({ superuser: true })), { semua: true });
  assert.deepEqual(putuskanCakupanKinerja(true, id({ role: "hod", semuaView: true })), { semua: true });
  assert.deepEqual(putuskanCakupanKinerja(true, id({ role: "staff", amId: " T-1 " })), { semua: false, amId: "T-1" });
  assert.deepEqual(putuskanCakupanKinerja(true, id({ role: "staff" })), { semua: false, amId: null });
  assert.deepEqual(putuskanCakupanKinerja(true, null), { semua: false, amId: null });
});

test("teknisi efektif: cakupan terbatas mengabaikan parameter (tak bisa intip teknisi lain)", () => {
  assert.equal(teknisiEfektif({ semua: false, amId: "T-1" }, "T-2"), "T-1");
  assert.equal(teknisiEfektif({ semua: false, amId: null }, "T-2"), null);
  assert.equal(teknisiEfektif({ semua: true }, "T-2"), "T-2");
  assert.equal(teknisiEfektif({ semua: true }, " "), undefined);
  assert.equal(teknisiEfektif({ semua: true }, null), undefined);
});

test("rentang tanggal: default hari ini, validasi format, urutan, maksimal 92 hari", () => {
  assert.deepEqual(bacaRentang(undefined, undefined, "2026-11-16"), { dari: "2026-11-16", sampai: "2026-11-16" });
  assert.deepEqual(bacaRentang("2026-11-01", "2026-11-30", "x"), { dari: "2026-11-01", sampai: "2026-11-30" });
  assert.throws(() => bacaRentang("16-11-2026", undefined, "x"), /YYYY-MM-DD/);
  assert.throws(() => bacaRentang("2026-11-10", "2026-11-01", "x"), /sebelum/);
  assert.throws(() => bacaRentang("2026-01-01", "2026-12-31", "x"), /maksimal 92/);
});

const kerja = (o: Partial<KerjaRow>): KerjaRow => ({
  plan_item_id: 1, teknisi_id: "T-1", teknisi_nama: "Budi", tanggal: "2026-11-16", urut: 1, jenis: "PM", faskes: "RS A",
  di_luar_plan: false, plan_telat: false, started_at: null, selesai_at: null, status_report: null, durasi_menit: null,
  report_tanpa_start: false, start_tanpa_report: false, tanpa_laporan: false, berlokasi: false, lokasi_alamat: null,
  jumlah_foto: 0, foto_kurang: false, foto_tes: 0, foto_kondisi: 0, sla_respon_menit: null, sla_selesai_menit: null, lewat_eta: null, ...o,
});

test("ringkasan per teknisi: kepatuhan, durasi, SLA vs ETA", () => {
  const r = ringkasKerja([
    kerja({ urut: 1, plan_telat: true, started_at: "s", selesai_at: "e", status_report: "Selesai", durasi_menit: 90, berlokasi: true }),
    kerja({ urut: 2, plan_telat: true, jenis: "Service", started_at: "s", selesai_at: "e", status_report: "Selesai", durasi_menit: 30,
            sla_respon_menit: 60, sla_selesai_menit: 120, lewat_eta: true }),
    kerja({ urut: 3, selesai_at: "e", status_report: "Pending", report_tanpa_start: true }),
    kerja({ urut: 51, di_luar_plan: true, started_at: "s", start_tanpa_report: true }),
    kerja({ urut: 4, tanggal: "2026-11-15", tanpa_laporan: true }),
    kerja({ teknisi_id: "T-2", teknisi_nama: "Agus", jenis: "Service", sla_respon_menit: 30, lewat_eta: false }),
  ]);
  assert.deepEqual(r.map((x) => x.teknisi_nama), ["Agus", "Budi"]);
  const b = r[1];
  assert.equal(b.pekerjaan, 5);
  assert.equal(b.di_luar_plan, 1);
  assert.equal(b.dimulai, 3);
  assert.equal(b.dilaporkan, 3);
  assert.equal(b.selesai, 2);
  assert.equal(b.report_tanpa_start, 1);
  assert.equal(b.start_tanpa_report, 1);
  assert.equal(b.tanpa_laporan, 1);
  assert.equal(b.hari_plan_telat, 1);
  assert.equal(b.report_berlokasi, 1);
  assert.equal(b.rata_durasi_menit, 60);
  assert.equal(b.tiket, 1);
  assert.equal(b.rata_sla_respon_menit, 60);
  assert.equal(b.rata_sla_selesai_menit, 120);
  assert.equal(b.lewat_eta, 1);
  assert.equal(r[0].tiket, 1);
  assert.equal(r[0].lewat_eta, 0);
});
