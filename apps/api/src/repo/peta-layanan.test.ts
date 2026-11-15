import assert from "node:assert/strict";
import { test } from "node:test";

import type { BarisStatusJob } from "./job-run.js";
import { kelompokkanJob, kelompokkanLayanan, statusProses, uraiLaunchd, uraiPm2 } from "./peta-layanan.js";

const PM2 = JSON.stringify([
  { name: "wrg-prod-api", pid: 101, monit: { memory: 60 * 1048576, cpu: 1.5 }, pm2_env: { status: "online", pm_uptime: 1_700_000_000_000, restart_time: 3, RAHASIA: "jangan-bocor" } },
  { name: "wrg-prod-web", pid: 0, monit: { memory: 0, cpu: 0 }, pm2_env: { status: "errored", restart_time: 15 } },
  { name: "wrg-dev-api", pid: 201, monit: { memory: 40 * 1048576, cpu: 0 }, pm2_env: { status: "online", pm_uptime: 1_700_000_000_000, restart_time: 0 } },
  { name: "uji-klaim-web", pid: 301, monit: {}, pm2_env: { status: "online" } },
]);

const LAUNCHD = [
  "PID\tStatus\tLabel",
  "858\t0\tcom.wrg.wabridge",
  "-\t0\tcom.wrg.backup-harian",
  "-\t1\tcom.wrg.disk-watch",
  "-\t0\tcom.wrg.autodeploy",
  "-\t0\tai.openclaw.gateway",
  "480\t0\tcom.apple.ViewBridgeAuxiliary",
].join("\n");

test("uraiPm2 hanya mengambil kolom status — env (rahasia) tak ikut", () => {
  const p = uraiPm2(PM2);
  assert.equal(p.length, 4);
  assert.deepEqual(Object.keys(p[0]).sort(), ["cpu", "exit", "keadaan", "mem_mb", "mulai", "nama", "pid", "restart", "sumber"]);
  assert.equal(JSON.stringify(p).includes("jangan-bocor"), false);
  assert.equal(p[0].mem_mb, 60);
  assert.equal(p[1].pid, null);
  assert.equal(p[1].mulai, null);
});

test("uraiLaunchd: label WRG/OpenClaw saja; menetap tanpa PID = stopped, berkala exit≠0 = exit n", () => {
  const p = uraiLaunchd(LAUNCHD);
  assert.deepEqual(
    p.map((x) => [x.nama, x.keadaan]),
    [
      ["com.wrg.wabridge", "online"],
      ["com.wrg.backup-harian", "berkala"],
      ["com.wrg.disk-watch", "exit 1"],
      ["com.wrg.autodeploy", "berkala"],
      ["ai.openclaw.gateway", "stopped"],
    ],
  );
  assert.deepEqual(p.map(statusProses), ["OK", "OK", "PERINGATAN", "OK", "MATI"]);
});

test("kelompokkanLayanan: wajib yang hilang = MATI, status kelompok = terburuk", () => {
  const proses = [...uraiPm2(PM2), ...uraiLaunchd(LAUNCHD)];
  const k = kelompokkanLayanan(proses, { pm2: true, launchd: true });
  const byKunci = Object.fromEntries(k.map((x) => [x.kunci, x]));
  assert.deepEqual(
    byKunci.inti.anggota.map((a) => [a.label, a.status]),
    [
      ["API", "OK"],
      ["Web", "MATI"],
      ["AI", "MATI"],
    ],
  );
  assert.equal(byKunci.inti.anggota[2].keadaan, "tidak ditemukan");
  assert.equal(byKunci.inti.status, "MATI");
  assert.equal(byKunci.wa.status, "MATI"); // OpenClaw stopped
  assert.deepEqual(byKunci.watchdog.anggota.map((a) => a.nama), ["com.wrg.backup-harian", "com.wrg.disk-watch"]);
  assert.equal(byKunci.watchdog.status, "PERINGATAN");
  assert.deepEqual(byKunci.dev.anggota.map((a) => a.label), ["api"]);
  assert.deepEqual(byKunci.lain.anggota.map((a) => a.nama), ["uji-klaim-web"]);
  assert.equal(byKunci.demo, undefined); // kelompok kosong tak ditampilkan
  // Tiap proses muncul tepat sekali.
  assert.equal(k.flatMap((x) => x.anggota).filter((a) => a.keadaan !== "tidak ditemukan").length, proses.length);
});

test("sumber tak tersedia (laptop/CI tanpa launchd) → anggota wajib launchd tidak divonis hilang", () => {
  const k = kelompokkanLayanan(uraiPm2(PM2), { pm2: true, launchd: false });
  assert.equal(k.find((x) => x.kunci === "wa"), undefined);
  assert.deepEqual(k.find((x) => x.kunci === "edge")?.anggota.map((a) => a.nama), ["wrg-prod-cftunnel", "wrg-prod-deployhook"]);
});

const job = (nama: string, status: BarisStatusJob["status"]): BarisStatusJob => ({
  job: nama,
  expr: "0 * * * *",
  aktif: status !== "NONAKTIF",
  status,
  berikut: null,
  terakhir: null,
  terakhir_ok: null,
  gagal_7_hari: 0,
  jalan_7_hari: 0,
});

test("kelompokkanJob: per awalan nama, sisa ke Monitoring & Brief, bermasalah terdaftar", () => {
  const k = kelompokkanJob([
    job("accurate-po-sync", "OK"),
    job("stok-gudang-sync", "TERLEWAT"),
    job("invoice-reminder", "OK"),
    job("A4", "OK"),
    job("senin-brief", "GAGAL"),
    job("weekly-report", "NONAKTIF"),
  ]);
  assert.deepEqual(
    k.map((x) => [x.kunci, x.total, x.status]),
    [
      ["accurate", 2, "PERINGATAN"],
      ["finance", 1, "OK"],
      ["sales", 1, "OK"],
      ["monitor", 2, "MATI"],
    ],
  );
  assert.deepEqual(k[0].bermasalah, ["stok-gudang-sync"]);
  assert.equal(k[3].nonaktif, 1);
});
